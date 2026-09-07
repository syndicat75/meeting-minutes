/**
 * @file server/ai/meetingSummaryService.ts
 * @description 전체 회의 대화록(merged transcripts)을 기반으로 종합 회의록 요약 및 액션 아이템을 추출하는 서비스.
 * OpenAI(gpt-4o-mini 또는 gpt-4o) 및 Gemini(gemini-3.6-flash)를 지원하며,
 * 엄격한 JSON 스키마를 통해 주요 논의사항, 결정사항, 실행 항목(담당자/기한/타임스탬프/신뢰도), 미결사항을 생성합니다.
 */

import { getServerEnv, SERVER_CONFIG } from '../config.js';
import { getOpenAIClient } from './openaiTranscription.js';
import { GoogleGenAI } from '@google/genai';

/**
 * 액션 아이템 스키마
 */
export interface ExtractedActionItem {
  task: string;
  assignee: string | null;
  dueDate: string | null;
  sourceTimestamp?: number;
  confidence: 'high' | 'medium' | 'low';
}

/**
 * 종합 회의 요약 결과 스키마
 */
export interface ComprehensiveMeetingSummary {
  provider: 'openai' | 'gemini';
  model: string;
  overview: string;
  keyDiscussions: string[];
  decisions: string[];
  actionItems: ExtractedActionItem[];
  pendingIssues: string[];
  nextSteps: string[];
}

/**
 * 요약 입력 컨텍스트
 */
export interface SummaryInputContext {
  meetingId: string;
  title: string;
  agenda?: string;
  department?: string;
  date?: string;
  attendees?: Array<{ name: string; role?: string; position?: string }>;
  fullTranscript: string;
}

/**
 * OpenAI를 활용하여 구조화된 회의 요약 생성
 */
async function summarizeWithOpenAI(
  context: SummaryInputContext,
  apiKey: string,
  modelName: string
): Promise<ComprehensiveMeetingSummary> {
  console.log('[SUMMARY] summarizeWithOpenAI called', { model: modelName, meetingId: context.meetingId });
  const client = getOpenAIClient();

  const attendeeListStr = (context.attendees || [])
    .map((a) => `${a.name}(${a.role || ''} ${a.position || ''})`.trim())
    .join(', ');

  const systemPrompt = `당신은 대한민국 최고 수준의 기업/산업현장 전문 회의록 작성 AI 비서입니다.
제공된 회의 전사문(대화록)과 회의 기본 정보를 면밀히 분석하여, 실제 비즈니스 및 공공 업무에 바로 채택될 수 있는 고품질 종합 회의록 요약을 JSON 형식으로만 작성하세요.

반드시 지켜야 할 규칙:
1. 없는 내용을 상상하거나 지어내지(Hallucination) 마십시오.
2. 액션 아이템(Action Items)에는 반드시 실행 가능한 구체적 작업, 명확한 담당자(불명확 시 null), 완료 기한(언급 없으면 null), 신뢰도('high'|'medium'|'low')를 부여하세요.
3. 응답은 반드시 순수한 JSON 문자열이어야 하며, 마크다운 코드블록(\`\`\`json) 없이 JSON 객체 본문만 출력해야 합니다.`;

  const userPrompt = `[회의 정보]
- 제목: ${context.title}
- 안건: ${context.agenda || '명시되지 않음'}
- 사업장/부서: ${context.department || '명시되지 않음'}
- 일자: ${context.date || '명시되지 않음'}
- 참석자: ${attendeeListStr || '정보 없음'}

[전체 회의 전사 대화록]
${context.fullTranscript}

다음 JSON 스키마 규격으로만 응답하세요:
{
  "overview": "전체 회의의 핵심 배경, 목적 및 총평을 담은 3~5문장의 완성도 높은 개요 요약문",
  "keyDiscussions": ["주요 논의사항 1", "주요 논의사항 2", ...],
  "decisions": ["합의 및 확정된 결정사항 1", "결정사항 2", ...],
  "actionItems": [
    {
      "task": "구체적 실행 과업 내용",
      "assignee": "담당자 성명 또는 null",
      "dueDate": "완료 예정일자 또는 null",
      "confidence": "high"
    }
  ],
  "pendingIssues": ["추후 재검토 또는 미결정 사항 1", ...],
  "nextSteps": ["차기 회의 또는 후속 조치 사항 1", ...]
}`;

  const completion = await client.chat.completions.create({
    model: modelName,
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt },
    ],
    response_format: { type: 'json_object' },
    temperature: 0.3,
  });

  const content = completion.choices[0]?.message?.content || '{}';
  const parsed = JSON.parse(content);

  return {
    provider: 'openai',
    model: modelName,
    overview: parsed.overview || '회의 요약 내용이 없습니다.',
    keyDiscussions: Array.isArray(parsed.keyDiscussions) ? parsed.keyDiscussions : [],
    decisions: Array.isArray(parsed.decisions) ? parsed.decisions : [],
    actionItems: Array.isArray(parsed.actionItems) ? parsed.actionItems : [],
    pendingIssues: Array.isArray(parsed.pendingIssues) ? parsed.pendingIssues : [],
    nextSteps: Array.isArray(parsed.nextSteps) ? parsed.nextSteps : [],
  };
}

/**
 * Gemini를 활용하여 구조화된 회의 요약 생성 (Fallback 및 기본 지원)
 */
async function summarizeWithGemini(
  context: SummaryInputContext,
  apiKey: string,
  modelName: string
): Promise<ComprehensiveMeetingSummary> {
  console.log('[SUMMARY] summarizeWithGemini called', { model: modelName, meetingId: context.meetingId });
  const ai = new GoogleGenAI({ apiKey });

  const attendeeListStr = (context.attendees || [])
    .map((a) => `${a.name}(${a.role || ''} ${a.position || ''})`.trim())
    .join(', ');

  const prompt = `당신은 대한민국 최고 수준의 기업/산업현장 전문 회의록 작성 AI 비서입니다.
제공된 회의 전사문(대화록)과 회의 정보를 분석하여 종합 회의록 요약을 순수 JSON으로만 작성하세요.
JSON 응답 외에 마크다운이나 다른 설명 텍스트를 일절 출력하지 마십시오.

[회의 정보]
- 제목: ${context.title}
- 안건: ${context.agenda || '명시되지 않음'}
- 부서: ${context.department || '명시되지 않음'}
- 일자: ${context.date || '명시되지 않음'}
- 참석자: ${attendeeListStr || '정보 없음'}

[전체 회의 전사 대화록]
${context.fullTranscript}

[출력 스키마]
{
  "overview": "전체 회의 총평 및 개요",
  "keyDiscussions": ["주요 논의사항"],
  "decisions": ["결정사항"],
  "actionItems": [
    {
      "task": "실행 작업",
      "assignee": "담당자 성명 또는 null",
      "dueDate": "완료 예정일자 또는 null",
      "confidence": "high"
    }
  ],
  "pendingIssues": ["미결사항"],
  "nextSteps": ["다음 회의 확인사항"]
}`;

  const response = await ai.models.generateContent({
    model: modelName,
    contents: prompt,
    config: {
      responseMimeType: 'application/json',
      temperature: 0.3,
    },
  });

  const responseText = response.text || '{}';
  const cleanJson = responseText.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim();
  const parsed = JSON.parse(cleanJson);

  return {
    provider: 'gemini',
    model: modelName,
    overview: parsed.overview || '회의 요약 내용이 없습니다.',
    keyDiscussions: Array.isArray(parsed.keyDiscussions) ? parsed.keyDiscussions : [],
    decisions: Array.isArray(parsed.decisions) ? parsed.decisions : [],
    actionItems: Array.isArray(parsed.actionItems) ? parsed.actionItems : [],
    pendingIssues: Array.isArray(parsed.pendingIssues) ? parsed.pendingIssues : [],
    nextSteps: Array.isArray(parsed.nextSteps) ? parsed.nextSteps : [],
  };
}

/**
 * 전체 회의 대화록 기반 통합 회의 요약 실행
 * OpenAI 우선 시도, 실패 시 Gemini Fallback
 * @param {SummaryInputContext} context 회의 정보 및 대화록
 * @returns {Promise<ComprehensiveMeetingSummary>} 구조화된 회의 요약
 */
export async function generateMeetingSummary(
  context: SummaryInputContext
): Promise<ComprehensiveMeetingSummary> {
  console.log('[SUMMARY] generateMeetingSummary called', { meetingId: context.meetingId });
  const env = getServerEnv();

  const hasOpenAiKey = Boolean(env.openaiApiKey && env.openaiApiKey.trim() !== '' && env.openaiApiKey !== 'MY_OPENAI_API_KEY');
  const hasGeminiKey = Boolean(env.geminiApiKey && env.geminiApiKey.trim() !== '' && env.geminiApiKey !== 'MY_GEMINI_API_KEY');

  if (!hasOpenAiKey && !hasGeminiKey) {
    const err: any = new Error('회의 요약에 필요한 AI API Key가 서버에 설정되어 있지 않습니다.');
    err.statusCode = 503;
    throw err;
  }

  // 1. OpenAI 시도
  if (hasOpenAiKey) {
    try {
      const summary = await summarizeWithOpenAI(
        context,
        env.openaiApiKey!,
        env.openaiSummaryModel || 'gpt-4o-mini'
      );
      return summary;
    } catch (openAiErr) {
      console.warn('[SUMMARY] OpenAI summary failed, falling back to Gemini', openAiErr);
      if (!hasGeminiKey) {
        throw openAiErr;
      }
    }
  }

  // 2. Gemini Fallback
  if (hasGeminiKey) {
    return await summarizeWithGemini(
      context,
      env.geminiApiKey!,
      env.geminiModel || SERVER_CONFIG.geminiModel
    );
  }

  throw new Error('사용 가능한 AI 요약 서비스가 없습니다.');
}
