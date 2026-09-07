/**
 * @file server/ai/contextCorrectionService.ts
 * @description 전체 회의 문맥(회의명, 안건, 부서, 참석자 명단, 전문용어 사전)을 기반으로
 * 음성인식(STT) 오타 및 화자 발언을 자연스럽게 교정하는 전용 AI 서비스 모듈입니다.
 * 
 * 주요 기능:
 * 1. 음성인식 모델과 분리된 별도 텍스트 모델(OpenAI gpt-4o-mini 또는 Gemini 3.6 Flash) 사용
 * 2. 원본 발언 보존 및 제안 방식(Diff 지원)
 * 3. 3단계 교정 강도: 최소 교정(맞춤법), 문맥 교정(기본값, STT오류 수정), 회의록 문체 정리(구어체 정리)
 * 4. 고유명사(참석자, 부서명, 전문용어 사전) 및 숫자/기한 보호 규칙 적용
 * 5. 불명확한 발언은 임의 수정 없이 [확인 필요] 및 isUncertain 플래그 부여
 */

import { getServerEnv, SERVER_CONFIG } from '../config.js';
import { getOpenAIClient } from './openaiTranscription.js';
import { GoogleGenAI } from '@google/genai';

/**
 * 교정 강도 수준
 * - minimal: 최소 교정 (맞춤법, 띄어쓰기 위주)
 * - context: 문맥 교정 (기본값: 음성인식 유사음 오류를 문맥 및 용어사전에 맞춰 교정)
 * - formal: 회의록 문체 정리 (구어체를 간결하고 정돈된 회의록 문장으로 정리)
 */
export type CorrectionLevel = 'minimal' | 'context' | 'formal';

/**
 * 교정 대상 세그먼트 입력 데이터
 */
export interface CorrectionCandidateSegment {
  id: string;
  speakerId: string;
  speakerName?: string;
  startSeconds?: number;
  endSeconds?: number;
  text: string;
  isUserEdited?: boolean;
}

/**
 * 개별 발언 교정 제안 결과
 */
export interface SegmentCorrectionProposal {
  segmentId: string;
  originalText: string;
  correctedText: string;
  hasChanges: boolean;
  reason: string;
  isUncertain: boolean;
  confidence: number;
}

/**
 * 문맥 교정 입력 컨텍스트
 */
export interface ContextCorrectionInput {
  meetingId: string;
  meetingTitle?: string;
  agenda?: string;
  department?: string;
  attendees?: Array<{ name: string; role?: string; position?: string }>;
  customTerms?: string[];
  correctionLevel?: CorrectionLevel;
  excludeUserEdited?: boolean;
  segments: CorrectionCandidateSegment[];
}

/**
 * 문맥 교정 최종 응답 결과
 */
export interface ContextCorrectionResult {
  success: boolean;
  provider: 'openai' | 'gemini';
  model: string;
  proposals: SegmentCorrectionProposal[];
  summaryMessage: string;
  changedCount: number;
  totalCount: number;
}

/**
 * 시스템 프롬프트 및 가이드라인 생성 헬퍼
 * @param {ContextCorrectionInput} context 회의 문맥 데이터
 * @returns {string} 완성된 시스템 프롬프트
 */
function buildCorrectionSystemPrompt(context: ContextCorrectionInput): string {
  console.log('[CONTEXT_CORRECTION] buildCorrectionSystemPrompt called', {
    meetingTitle: context.meetingTitle,
    level: context.correctionLevel,
    termsCount: context.customTerms?.length || 0,
  });

  const level = context.correctionLevel || 'context';

  const attendeeListStr = (context.attendees || [])
    .map((a) => `${a.name}${a.role || a.position ? `(${a.role || a.position})` : ''}`)
    .join(', ') || '지정 없음';

  const defaultTerms = ['위험성평가', '아차사고', 'TBM', 'LOTO', '산업안전보건위원회', '남부권역'];
  const mergedTerms = Array.from(new Set([...defaultTerms, ...(context.customTerms || [])]));
  const termsListStr = mergedTerms.join(', ');

  let levelInstruction = '';
  switch (level) {
    case 'minimal':
      levelInstruction = '1단계 [최소 교정]: 명백한 한글 맞춤법, 띄어쓰기, 문장 부호 오류만 최소한으로 수정하세요. 단어 어휘나 문장 구조는 손대지 마세요.';
      break;
    case 'formal':
      levelInstruction = '3단계 [회의록 문체 정리]: 음성인식 유사음 오류를 문맥에 맞게 수정하고, 발화자의 구어체나 말버릇(예: ~했구요, 저기, 그게, 어...)을 정돈된 회의록 문장으로 단정하게 정리하되 핵심 발언 의미와 뉘앙스는 절대 훼손하지 마세요.';
      break;
    case 'context':
    default:
      levelInstruction = '2단계 [문맥 교정 (기본값)]: 단순 맞춤법뿐만 아니라, 음성인식(STT)에서 발생하는 발음 유사 오인식(예: 남부 권역 -> 나무 권역, 티비엠 -> TBM, 아차사고 -> 앗차사고)을 전체 회의 문맥과 전문용어 사전에 맞춰 자연스럽게 교정하세요. 문장 본래 어투는 가급적 유지하세요.';
      break;
  }

  return `당신은 최고 수준의 한국어 비즈니스 회의록 전문 에디터입니다.
음성인식(STT) 엔진이 전사한 회의 대화록을 전체 회의 문맥을 고려하여 정밀 교정합니다.

[회의 기본 정보]
- 회의 제목: ${context.meetingTitle || '일반 회의'}
- 주요 안건: ${context.agenda || '상세 안건 없음'}
- 주관 부서: ${context.department || '미지정'}
- 참석자 명단: ${attendeeListStr}
- 필수 보호 전문용어 사전: ${termsListStr}

[교정 모드]
${levelInstruction}

[절대 엄수해야 할 6대 원칙]
1. 고유명사 보호: 회의 제목, 안건, 참석자 이름, 직급, 부서명, 전문용어 사전의 단어는 절대 왜곡하거나 다른 단어로 바꾸지 마세요.
2. 사실/수치 보존: 발언에 포함된 숫자, 금액, 기한, 날짜, 백분율 등은 절대 임의로 추측 변경하지 마세요.
3. 내용 추가 금지: 실제 발언에 없던 새로운 사실, 결론, 부연설명을 지어내어 추가하지 마세요.
4. 불확실한 발언 처리: 음질 저하나 불분명한 발음으로 단어 의미를 확신할 수 없는 경우, 억지로 추측해 고치지 말고 isUncertain: true로 지정하고 해당 단어 뒤에 [확인 필요]를 붙이세요. (예: "그 부분은 [확인 필요]로 처리하겠습니다.")
5. 수정 필요 없는 문장: 이미 올바르거나 수정할 필요가 없는 문장은 hasChanges: false로 두고 correctedText를 originalText와 완전히 동일하게 유지하세요.
6. JSON 출력: 반드시 유효한 JSON 배열 포맷만 출력하세요. 마크다운 따옴표나 기타 설명 문구 없이 오직 순수 JSON 배열만 반환해야 합니다.

[반환 JSON 스키마]
[
  {
    "segmentId": "세그먼트 고유 ID",
    "originalText": "원본 문장",
    "correctedText": "교정된 문장 (수정 없으면 원본 동일)",
    "hasChanges": true 또는 false,
    "reason": "수정 이유 요약 (예: '음성인식 오류 교정: 나무 권역 -> 남부 권역', '맞춤법 교정', 또는 '수정 사항 없음')",
    "isUncertain": true 또는 false (불확실 발언 여부),
    "confidence": 0.0 ~ 1.0 사이의 신뢰도 수치
  }
]`;
}

/**
 * OpenAI 모델(OPENAI_CORRECTION_MODEL: gpt-4o-mini)을 사용하여 문맥 교정 수행
 * @param {ContextCorrectionInput} context 문맥 입력
 * @param {string} apiKey OpenAI API 키
 * @param {string} modelName 모델명
 * @returns {Promise<SegmentCorrectionProposal[]>} 제안 배열
 */
async function correctWithOpenAI(
  context: ContextCorrectionInput,
  apiKey: string,
  modelName: string
): Promise<SegmentCorrectionProposal[]> {
  console.log('[CONTEXT_CORRECTION] correctWithOpenAI called', {
    model: modelName,
    meetingId: context.meetingId,
    segmentCount: context.segments.length,
  });

  const client = getOpenAIClient();
  const systemPrompt = buildCorrectionSystemPrompt(context);

  // 입력 세그먼트 간소화 (토큰 절약 및 식별 보장)
  const inputSegments = context.segments.map((seg) => ({
    segmentId: seg.id,
    speaker: seg.speakerName || seg.speakerId,
    text: seg.text,
  }));

  const userPrompt = `다음 회의 대화록 세그먼트들을 검토하고 교정 결과를 JSON 배열로 반환하세요:\n\n${JSON.stringify(inputSegments, null, 2)}`;

  const response = await client.chat.completions.create({
    model: modelName,
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt },
    ],
    response_format: { type: 'json_object' },
    temperature: 0.2,
  });

  const content = response.choices[0]?.message?.content?.trim() || '[]';
  console.log('[CONTEXT_CORRECTION] OpenAI response received, bytes:', content.length);

  try {
    const parsed = JSON.parse(content);
    const rawArray = Array.isArray(parsed) ? parsed : parsed.proposals || parsed.corrections || parsed.segments || [];

    return mapToSegmentCorrectionProposals(rawArray, context.segments);
  } catch (parseErr) {
    console.error('[CONTEXT_CORRECTION] JSON parse failed on OpenAI output', parseErr, content);
    throw new Error('OpenAI 교정 응답 파싱 실패');
  }
}

/**
 * Gemini 모델(gemini-3.6-flash)을 fallback으로 사용하여 문맥 교정 수행
 * @param {ContextCorrectionInput} context 문맥 입력
 * @param {string} apiKey Gemini API 키
 * @param {string} modelName Gemini 모델명
 * @returns {Promise<SegmentCorrectionProposal[]>} 제안 배열
 */
async function correctWithGemini(
  context: ContextCorrectionInput,
  apiKey: string,
  modelName: string
): Promise<SegmentCorrectionProposal[]> {
  console.log('[CONTEXT_CORRECTION] correctWithGemini called', {
    model: modelName,
    meetingId: context.meetingId,
    segmentCount: context.segments.length,
  });

  const ai = new GoogleGenAI({ apiKey });
  const systemPrompt = buildCorrectionSystemPrompt(context);

  const inputSegments = context.segments.map((seg) => ({
    segmentId: seg.id,
    speaker: seg.speakerName || seg.speakerId,
    text: seg.text,
  }));

  const prompt = `${systemPrompt}\n\n[검토 대상 발언 목록]\n${JSON.stringify(inputSegments, null, 2)}`;

  const response = await ai.models.generateContent({
    model: modelName,
    contents: prompt,
    config: {
      responseMimeType: 'application/json',
      temperature: 0.2,
    },
  });

  const rawText = (response.text || '').trim();
  console.log('[CONTEXT_CORRECTION] Gemini response received, bytes:', rawText.length);

  try {
    const parsed = JSON.parse(rawText);
    const rawArray = Array.isArray(parsed) ? parsed : parsed.proposals || parsed.corrections || parsed.segments || [];

    return mapToSegmentCorrectionProposals(rawArray, context.segments);
  } catch (parseErr) {
    console.error('[CONTEXT_CORRECTION] JSON parse failed on Gemini output', parseErr, rawText);
    throw new Error('Gemini 교정 응답 파싱 실패');
  }
}

/**
 * LLM 응답을 안전하게 SegmentCorrectionProposal 규격으로 매핑
 * @param {any[]} rawArray LLM 원본 파싱 배열
 * @param {CorrectionCandidateSegment[]} originalSegments 원본 세그먼트
 * @returns {SegmentCorrectionProposal[]} 표준 제안 객체 배열
 */
function mapToSegmentCorrectionProposals(
  rawArray: any[],
  originalSegments: CorrectionCandidateSegment[]
): SegmentCorrectionProposal[] {
  console.log('[CONTEXT_CORRECTION] mapToSegmentCorrectionProposals called', {
    rawCount: rawArray.length,
    originalCount: originalSegments.length,
  });

  const resultMap = new Map<string, any>();
  rawArray.forEach((item) => {
    if (item && item.segmentId) {
      resultMap.set(item.segmentId, item);
    }
  });

  return originalSegments.map((orig) => {
    const match = resultMap.get(orig.id);
    if (!match) {
      return {
        segmentId: orig.id,
        originalText: orig.text,
        correctedText: orig.text,
        hasChanges: false,
        reason: '수정 사항 없음',
        isUncertain: false,
        confidence: 1.0,
      };
    }

    const corrected = (match.correctedText || orig.text).trim();
    const hasChanges = Boolean(match.hasChanges) || corrected !== orig.text.trim();

    return {
      segmentId: orig.id,
      originalText: orig.text,
      correctedText: corrected,
      hasChanges,
      reason: match.reason || (hasChanges ? '문맥 어휘 및 맞춤법 교정' : '수정 사항 없음'),
      isUncertain: Boolean(match.isUncertain),
      confidence: typeof match.confidence === 'number' ? match.confidence : 0.9,
    };
  });
}

/**
 * 대화록 AI 문맥 검토 및 오타 교정 실행 (Primary: OpenAI gpt-4o-mini -> Fallback: Gemini 3.6 Flash)
 * @param {ContextCorrectionInput} input 교정 컨텍스트 및 발언 목록
 * @returns {Promise<ContextCorrectionResult>} 교정 제안 결과
 */
export async function executeContextCorrection(
  input: ContextCorrectionInput
): Promise<ContextCorrectionResult> {
  console.log('[CONTEXT_CORRECTION] executeContextCorrection called', {
    meetingId: input.meetingId,
    level: input.correctionLevel,
    excludeUserEdited: input.excludeUserEdited,
    totalSegments: input.segments.length,
  });

  // 사용자 수정 항목 제외 옵션 적용
  const targetSegments = (input.excludeUserEdited ?? true)
    ? input.segments.filter((s) => !s.isUserEdited)
    : input.segments;

  if (targetSegments.length === 0) {
    console.log('[CONTEXT_CORRECTION] No target segments to correct after filtering');
    return {
      success: true,
      provider: 'openai',
      model: 'none',
      proposals: [],
      summaryMessage: '교정 대상 발언이 없습니다. (사용자가 이미 수정한 발언 제외됨)',
      changedCount: 0,
      totalCount: input.segments.length,
    };
  }

  const env = getServerEnv();
  const openaiApiKey = env.openaiApiKey;
  const geminiApiKey = env.geminiApiKey;
  const correctionModel = env.openaiCorrectionModel || SERVER_CONFIG.openaiCorrectionModel;

  const preparedInput: ContextCorrectionInput = {
    ...input,
    segments: targetSegments,
  };

  // 1. Primary 시도: OpenAI gpt-4o-mini
  if (openaiApiKey && openaiApiKey !== 'MY_OPENAI_API_KEY') {
    try {
      console.log('[CONTEXT_CORRECTION] Attempting OpenAI correction with model:', correctionModel);
      const proposals = await correctWithOpenAI(preparedInput, openaiApiKey, correctionModel);
      const changedCount = proposals.filter((p) => p.hasChanges).length;

      return {
        success: true,
        provider: 'openai',
        model: correctionModel,
        proposals,
        summaryMessage: `전체 ${targetSegments.length}개 발언 중 ${changedCount}개 발언에 대한 교정안이 제안되었습니다.`,
        changedCount,
        totalCount: targetSegments.length,
      };
    } catch (openAiErr: any) {
      console.warn('[CONTEXT_CORRECTION] OpenAI correction failed, trying Gemini fallback:', openAiErr.message);
    }
  }

  // 2. Fallback 시도: Gemini 3.6 Flash
  if (geminiApiKey && geminiApiKey !== 'MY_GEMINI_API_KEY') {
    try {
      const geminiModel = env.geminiModel || SERVER_CONFIG.geminiModel;
      console.log('[CONTEXT_CORRECTION] Attempting Gemini fallback correction with model:', geminiModel);
      const proposals = await correctWithGemini(preparedInput, geminiApiKey, geminiModel);
      const changedCount = proposals.filter((p) => p.hasChanges).length;

      return {
        success: true,
        provider: 'gemini',
        model: geminiModel,
        proposals,
        summaryMessage: `(Gemini 백업 사용) 전체 ${targetSegments.length}개 발언 중 ${changedCount}개 발언에 대한 교정안이 제안되었습니다.`,
        changedCount,
        totalCount: targetSegments.length,
      };
    } catch (geminiErr: any) {
      console.error('[CONTEXT_CORRECTION] Gemini fallback correction also failed:', geminiErr);
      throw new Error(`AI 문맥 교정에 실패했습니다: ${geminiErr.message}`);
    }
  }

  throw new Error('AI 문맥 교정을 실행할 수 있는 유효한 API Key(OpenAI 또는 Gemini)가 설정되어 있지 않습니다.');
}
