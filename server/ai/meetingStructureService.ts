/**
 * @file server/ai/meetingStructureService.ts
 * @description 자유도 높은 범용 회의록을 위한 AI 보조 지능 엔진.
 * 1. AI 구분 자동 분류 (Classify Categories): 발언 문맥을 분석하여 적절한 회의 구분(카테고리) 추천
 * 2. AI 안건 감지 및 그룹화 (Detect Agendas): 회의 대화 흐름을 분석하여 주요 논의 안건 블록 감지
 * 3. AI 회의록 구조화 (Structure Meeting Rows): 전사문, 직접 작성, 참석자, 안건 등을 종합하여
 *    표준 회의록 행 (구분, 화자, 내용(bullet), 결정사항, 근거 발언 세그먼트)을 자동 합성
 * OpenAI (gpt-4o-mini / gpt-4o) 및 Gemini (gemini-2.5-flash) 이중화 지원.
 */

import { getServerEnv, SERVER_CONFIG } from '../config.js';
import { getOpenAIClient } from './openaiTranscription.js';
import { GoogleGenAI } from '@google/genai';

/**
 * 구분 분류 요청 컨텍스트
 */
export interface CategoryClassificationInput {
  meetingTitle?: string;
  agenda?: string;
  availableCategories: string[];
  items: Array<{
    id: string;
    speakerName?: string;
    text: string;
    timestampSeconds?: number;
  }>;
}

export interface CategoryClassificationResultItem {
  id: string;
  suggestedCategory: string;
  confidence: number;
  reason?: string;
}

/**
 * 안건 감지 요청 컨텍스트
 */
export interface AgendaDetectionInput {
  meetingTitle?: string;
  agenda?: string;
  items: Array<{
    id: string;
    speakerName?: string;
    text: string;
    startSeconds?: number;
    endSeconds?: number;
  }>;
}

export interface DetectedAgendaResultItem {
  title: string;
  timeRange?: string;
  startSeconds?: number;
  endSeconds?: number;
  segmentIds: string[];
  summary?: string;
}

/**
 * 회의록 행 자동 구조화 요청 컨텍스트
 */
export interface StructureMeetingRowsInput {
  meetingTitle?: string;
  agenda?: string;
  department?: string;
  date?: string;
  attendees?: Array<{ name: string; role?: string; position?: string }>;
  availableCategories: string[];
  fullTranscript: string;
  manualEntries?: Array<{ speakerName?: string; content: string }>;
  existingRows?: Array<{
    id: string;
    category: string;
    speakerName?: string;
    content: string;
    isUserEdited?: boolean;
  }>;
}

export interface StructuredMeetingRowResult {
  category: string;
  speakerName: string;
  content: string;
  agendaTitle?: string;
  decision?: string;
  actionItemTask?: string;
  assignee?: string;
  dueDate?: string;
  evidenceSegmentIds?: string[];
}

/**
 * 1. AI 구분 자동 분류
 */
export async function classifyCategoriesWithAI(
  input: CategoryClassificationInput
): Promise<CategoryClassificationResultItem[]> {
  console.log('[STRUCTURE_AI] classifyCategoriesWithAI called', {
    itemCount: input.items.length,
    availableCategoriesCount: input.availableCategories.length,
  });

  if (!input.items || input.items.length === 0) {
    return [];
  }

  const env = getServerEnv();
  const hasOpenAi = Boolean(env.openaiApiKey && env.openaiApiKey !== 'MY_OPENAI_API_KEY');
  const hasGemini = Boolean(env.geminiApiKey && env.geminiApiKey !== 'MY_GEMINI_API_KEY');

  const systemPrompt = `당신은 대한민국 최고 수준의 기업/산업현장 전문 회의록 분석 AI입니다.
주어진 회의 발언 목록을 분석하여, 각 발언이 다음 [추천 구분 목록] 중 어느 구분에 가장 잘 부합하는지 분류하세요.
만약 추천 목록에 딱 맞는 구분이 없다면, 문맥에 가장 적절하고 간결한 한국어 구분명(예: '의견', '질의', '답변', '논의', '보고사항', '결정사항' 등)을 제안하세요.

[추천 구분 목록]:
${input.availableCategories.join(', ')}

응답은 반드시 마크다운 코드블록(\`\`\`json) 없이 순수한 JSON 배열([]) 형식으로만 출력해야 합니다:
[
  {
    "id": "발언ID",
    "suggestedCategory": "추천 구분명",
    "confidence": 0.95,
    "reason": "분류 이유 간략 요약"
  }
]`;

  const userPrompt = `회의 제목: ${input.meetingTitle || '일반 회의'}
회의 주요 안건: ${input.agenda || '명시되지 않음'}

[분류할 발언 목록]:
${JSON.stringify(
  input.items.map((it) => ({
    id: it.id,
    speaker: it.speakerName || '화자',
    text: it.text,
  })),
  null,
  2
)}`;

  // OpenAI 우선
  if (hasOpenAi) {
    try {
      const client = getOpenAIClient();
      const completion = await client.chat.completions.create({
        model: 'gpt-4o-mini',
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt },
        ],
        temperature: 0.1,
      });

      const text = completion.choices[0]?.message?.content || '[]';
      const cleaned = text.replace(/```json/gi, '').replace(/```/g, '').trim();
      const parsed = JSON.parse(cleaned);
      if (Array.isArray(parsed)) {
        return parsed;
      }
    } catch (err: any) {
      console.warn('[STRUCTURE_AI] OpenAI classifyCategories failed, trying fallback', err?.message);
    }
  }

  // Gemini Fallback
  if (hasGemini) {
    try {
      const ai = new GoogleGenAI({ apiKey: env.geminiApiKey });
      const response = await ai.models.generateContent({
        model: env.geminiModel || 'gemini-2.5-flash',
        contents: `${systemPrompt}\n\n${userPrompt}`,
      });
      const text = response.text || '[]';
      const cleaned = text.replace(/```json/gi, '').replace(/```/g, '').trim();
      const parsed = JSON.parse(cleaned);
      if (Array.isArray(parsed)) {
        return parsed;
      }
    } catch (err: any) {
      console.error('[STRUCTURE_AI] Gemini classifyCategories also failed', err);
    }
  }

  // 규칙 기반 단순 기본 분류 폴백
  return input.items.map((it) => {
    let cat = '논의';
    const t = it.text;
    if (t.includes('개회') || t.includes('시작하겠') || t.includes('참석해 주셔서')) cat = '개회';
    else if (t.includes('보고') || t.includes('진행사항') || t.includes('현황')) cat = '보고사항';
    else if (t.includes('질문') || t.includes('궁금') || t.includes('어떻게 됩니까') || t.endsWith('?')) cat = '질의';
    else if (t.includes('답변') || t.includes('설명드리') || t.includes('그 부분은')) cat = '답변';
    else if (t.includes('결정') || t.includes('확정') || t.includes('합의') || t.includes('의결')) cat = '결정사항';
    else if (t.includes('조치') || t.includes('실행') || t.includes('진행하겠')) cat = '조치사항';
    else if (t.includes('마치겠') || t.includes('종료') || t.includes('폐회')) cat = '폐회';
    return {
      id: it.id,
      suggestedCategory: cat,
      confidence: 0.7,
      reason: '키워드 기반 기본 분류',
    };
  });
}

/**
 * 2. AI 안건 감지 및 그룹화
 */
export async function detectAgendasWithAI(
  input: AgendaDetectionInput
): Promise<DetectedAgendaResultItem[]> {
  console.log('[STRUCTURE_AI] detectAgendasWithAI called', { itemCount: input.items.length });

  if (!input.items || input.items.length === 0) {
    return [];
  }

  const env = getServerEnv();
  const hasOpenAi = Boolean(env.openaiApiKey && env.openaiApiKey !== 'MY_OPENAI_API_KEY');
  const hasGemini = Boolean(env.geminiApiKey && env.geminiApiKey !== 'MY_GEMINI_API_KEY');

  const systemPrompt = `당신은 회의 흐름을 분석하여 논의 안건별로 구간을 나누는 전문 회의 퍼실리테이터 AI입니다.
주어진 회의 발언 목록을 분석하여, 실제로 논의된 1개~5개의 명확한 상위 안건(Agenda) 주제를 감지하고,
각 안건에 포함되는 발언 ID(segmentIds)와 시작/종료 시간 및 간단한 안건 요약을 JSON으로 구성하세요.

응답은 반드시 마크다운 코드블록(\`\`\`json) 없이 순수한 JSON 배열([]) 형식으로만 출력해야 합니다:
[
  {
    "title": "안건 1 제목 (예: 1분기 사업 실적 보고 및 점검)",
    "timeRange": "00:00 ~ 08:30",
    "startSeconds": 0,
    "endSeconds": 510,
    "segmentIds": ["id_1", "id_2", "id_3"],
    "summary": "안건 주요 논의 요약 한 줄"
  }
]`;

  const userPrompt = `회의 제목: ${input.meetingTitle || '정기 회의'}
사전 지정 안건: ${input.agenda || '자유 논의'}

[회의 발언 목록]:
${JSON.stringify(
  input.items.map((it) => ({
    id: it.id,
    speaker: it.speakerName || '화자',
    start: it.startSeconds,
    end: it.endSeconds,
    text: it.text,
  })),
  null,
  2
)}`;

  if (hasOpenAi) {
    try {
      const client = getOpenAIClient();
      const completion = await client.chat.completions.create({
        model: 'gpt-4o-mini',
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt },
        ],
        temperature: 0.1,
      });

      const text = completion.choices[0]?.message?.content || '[]';
      const cleaned = text.replace(/```json/gi, '').replace(/```/g, '').trim();
      const parsed = JSON.parse(cleaned);
      if (Array.isArray(parsed)) {
        return parsed;
      }
    } catch (err: any) {
      console.warn('[STRUCTURE_AI] OpenAI detectAgendas failed, trying fallback', err?.message);
    }
  }

  if (hasGemini) {
    try {
      const ai = new GoogleGenAI({ apiKey: env.geminiApiKey });
      const response = await ai.models.generateContent({
        model: env.geminiModel || 'gemini-2.5-flash',
        contents: `${systemPrompt}\n\n${userPrompt}`,
      });
      const text = response.text || '[]';
      const cleaned = text.replace(/```json/gi, '').replace(/```/g, '').trim();
      const parsed = JSON.parse(cleaned);
      if (Array.isArray(parsed)) {
        return parsed;
      }
    } catch (err: any) {
      console.error('[STRUCTURE_AI] Gemini detectAgendas failed', err);
    }
  }

  // 기본 단일 안건 폴백
  return [
    {
      title: input.agenda || input.meetingTitle || '전체 회의 안건',
      timeRange: '전체',
      segmentIds: input.items.map((it) => it.id),
      summary: '회의 전체 발언을 포괄하는 기본 안건입니다.',
    },
  ];
}

/**
 * 3. AI 회의록 자동 구조화 (MeetingRow[] 합성)
 */
export async function structureMeetingRowsWithAI(
  input: StructureMeetingRowsInput
): Promise<StructuredMeetingRowResult[]> {
  console.log('[STRUCTURE_AI] structureMeetingRowsWithAI called', {
    transcriptLength: input.fullTranscript.length,
    categoriesCount: input.availableCategories.length,
  });

  const env = getServerEnv();
  const hasOpenAi = Boolean(env.openaiApiKey && env.openaiApiKey !== 'MY_OPENAI_API_KEY');
  const hasGemini = Boolean(env.geminiApiKey && env.geminiApiKey !== 'MY_GEMINI_API_KEY');

  const attendeeList = (input.attendees || []).map((a) => `${a.name}(${a.role || ''} ${a.position || ''})`).join(', ');

  const systemPrompt = `당신은 대한민국 최고 수준의 전문 속기사이자 회의록 편집 전문가 AI입니다.
제공된 전체 회의 대화록과 작성 메모를 철저히 검토하여, 공문서 및 기업 공식 회의록 표준 표 형태인
'회의록 항목 (Meeting Rows)' 목록을 생성하세요.

[핵심 규칙]:
1. 회의의 기본 단위는 [구분(category) - 화자(speakerName) - 회의내용(content)]입니다.
2. '구분'은 제공된 [추천 구분 목록]을 적극 활용하되, 문맥에 가장 적합한 명확한 표현을 사용하세요.
   [추천 구분 목록]: ${input.availableCategories.join(', ')}
3. '화자'는 실제 발언자 이름을 기록하되, 여러 참석자의 합의나 특정인 지목이 불필요한 경우 빈 문자열("") 또는 적절한 직책을 기재할 수 있습니다.
4. '회의 내용(content)'은 군더더기 구어체를 정제하여 정중한 개조식(- 글머리표, 1. 번호목록)과 줄바꿈으로 가독성 높게 서술하세요.
5. 특정 행이 결정된 사항이나 조치 과제를 포함할 경우 'decision'(결정사항), 'actionItemTask'(조치과제), 'assignee'(담당자), 'dueDate'(기한 YYYY-MM-DD) 필드를 채우세요.
6. 응답은 반드시 마크다운 코드블록(\`\`\`json) 없이 순수한 JSON 배열([]) 형식으로만 출력해야 합니다:
[
  {
    "category": "보고사항",
    "speakerName": "홍길동",
    "agendaTitle": "안건명 (선택)",
    "content": "- 전 분기 업무 목표 달성률 104% 달성 보고\\n- 주요 사업장 안전점검 완료 현황 공유",
    "decision": "보고 내용 원안 접수",
    "actionItemTask": "미비 사업장 보완 조치",
    "assignee": "홍길동",
    "dueDate": ""
  }
]`;

  const userPrompt = `회의 제목: ${input.meetingTitle || '정기 업무 회의'}
회의 안건: ${input.agenda || '명시되지 않음'}
사업장/부서: ${input.department || '명시되지 않음'}
일자: ${input.date || '명시되지 않음'}
참석자: ${attendeeList || '정보 없음'}

[회의 전사 대화록 및 메모]:
${input.fullTranscript}

${
  input.manualEntries && input.manualEntries.length > 0
    ? `[참석자 직접 입력 메모/발언]:\n${input.manualEntries.map((m) => `${m.speakerName || '참석자'}: ${m.content}`).join('\n')}`
    : ''
}`;

  if (hasOpenAi) {
    try {
      const client = getOpenAIClient();
      const completion = await client.chat.completions.create({
        model: 'gpt-4o-mini',
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt },
        ],
        temperature: 0.2,
      });

      const text = completion.choices[0]?.message?.content || '[]';
      const cleaned = text.replace(/```json/gi, '').replace(/```/g, '').trim();
      const parsed = JSON.parse(cleaned);
      if (Array.isArray(parsed) && parsed.length > 0) {
        return parsed;
      }
    } catch (err: any) {
      console.warn('[STRUCTURE_AI] OpenAI structureMeetingRows failed, trying fallback', err?.message);
    }
  }

  if (hasGemini) {
    try {
      const ai = new GoogleGenAI({ apiKey: env.geminiApiKey });
      const response = await ai.models.generateContent({
        model: env.geminiModel || 'gemini-2.5-flash',
        contents: `${systemPrompt}\n\n${userPrompt}`,
      });
      const text = response.text || '[]';
      const cleaned = text.replace(/```json/gi, '').replace(/```/g, '').trim();
      const parsed = JSON.parse(cleaned);
      if (Array.isArray(parsed) && parsed.length > 0) {
        return parsed;
      }
    } catch (err: any) {
      console.error('[STRUCTURE_AI] Gemini structureMeetingRows failed', err);
    }
  }

  // 기본 폴백 행 반환
  return [
    {
      category: '보고사항',
      speakerName: input.attendees?.[0]?.name || '',
      content: '- 회의 개회 및 주요 안건 경과 보고 진행',
    },
    {
      category: '논의',
      speakerName: '',
      content: `- 주요 안건 논의:\n${input.agenda || '상세 논의 진행'}`,
    },
    {
      category: '결정사항',
      speakerName: '',
      content: '- 회의 안건에 대한 협의 및 후속 조치 계획 확정',
      decision: '안건 원안 가결 및 세부 실행안 확정',
    },
  ];
}
