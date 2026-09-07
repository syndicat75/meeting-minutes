/**
 * @file server/gemini.ts
 * @description Google Gemini 2.5 Flash 기반 음성 전사(STT) 및 회의록 구조화 요약 AI 모듈.
 * 가짜(Mock) 성공 응답을 일절 배제하고, 실제 AI 모델 추론만을 수행하며, 키 미설정 시 명확한 503 에러를 반환합니다.
 */

import { GoogleGenAI, Type, Schema } from '@google/genai';
import { getServerEnv, SERVER_CONFIG } from './config';

/**
 * Gemini 클라이언트 지연 초기화 인스턴스
 */
let genAiClient: GoogleGenAI | null = null;

/**
 * Gemini SDK 클라이언트 취득 함수
 * @returns {GoogleGenAI} 초기화된 GenAI 인스턴스
 * @throws {Error} GEMINI_API_KEY 미설정 시 503 에러 발생
 */
export function getGeminiClient(): GoogleGenAI {
  console.log('[GEMINI] getGeminiClient called');
  const { geminiApiKey } = getServerEnv();

  if (!geminiApiKey || geminiApiKey.trim() === '' || geminiApiKey === 'MY_GEMINI_API_KEY') {
    console.error('[GEMINI] GEMINI_API_KEY is not set or placeholder');
    const error: any = new Error(
      '서버에 GEMINI_API_KEY 환경변수가 설정되지 않았습니다. Vercel 프로젝트 Settings > Environment Variables 또는 .env에 유효한 GEMINI_API_KEY를 등록해주세요.'
    );
    error.statusCode = 503;
    error.code = 'GEMINI_API_KEY_NOT_CONFIGURED';
    throw error;
  }

  if (!genAiClient) {
    genAiClient = new GoogleGenAI({ apiKey: geminiApiKey });
  }

  return genAiClient;
}

/**
 * 대화록 세그먼트 인터페이스
 */
export interface TranscriptSegment {
  id: string;
  startSeconds: number;
  endSeconds: number;
  speakerId: string;
  text: string;
  needsReview: boolean;
}

/**
 * 음성 버퍼를 Gemini 2.5 Flash 모델로 전송하여 화자별 대화록으로 전사
 * @param {Buffer} audioBuffer 오디오 원시 바이너리 데이터
 * @param {string} mimeType 오디오 MIME 타입 (예: audio/webm, audio/mp4)
 * @param {object} meetingContext 회의 컨텍스트 정보 (제목, 안건, 참석자 명단)
 * @returns {Promise<TranscriptSegment[]>} 화자 분리 대화록 배열
 */
export async function transcribeAudioWithGemini(
  audioBuffer: Buffer,
  mimeType: string,
  meetingContext: {
    meetingTitle: string;
    agenda?: string;
    attendeeNames?: string[];
  }
): Promise<TranscriptSegment[]> {
  console.log('[GEMINI] transcribeAudioWithGemini called', {
    bufferBytes: audioBuffer.length,
    mimeType,
    meetingTitle: meetingContext.meetingTitle,
  });

  if (!audioBuffer || audioBuffer.length === 0) {
    const error: any = new Error('전사할 오디오 버퍼가 비어 있습니다.');
    error.statusCode = 400;
    error.code = 'EMPTY_AUDIO_BUFFER';
    throw error;
  }

  const ai = getGeminiClient();
  const base64Audio = audioBuffer.toString('base64');

  const systemPrompt = `당신은 대한민국 산업안전 및 기업 회의록 전문 음성 전사 AI입니다.
입력된 회의 음성을 정확하게 청취하고, 화자별 발언 단위(Transcript Segments)로 전사하십시오.

[엄격한 처리 규칙]
1. 실제 음성에 기록된 발언만 전사하십시오. 음성에 없는 대화나 임의의 예시를 지어내거나(환각) 추측하지 마십시오.
2. 화자는 실제 성명을 임의 확정하지 말고 "speaker_1", "speaker_2", "speaker_3" 형태로 분류하십시오.
3. 소음, 동시 발화, 발음 불명확으로 확인이 필요한 구간은 needsReview: true로 설정하십시오.
4. startSeconds와 endSeconds는 음성의 실제 타임스탬프(초 단위 정수 또는 소수점 1자리)로 작성하십시오.
5. 회의 기본 정보: 제목 "${meetingContext.meetingTitle}", 안건: "${meetingContext.agenda || '일반 안건'}"
참고 참석자 명단: ${(meetingContext.attendeeNames || []).join(', ') || '미지정'}

반드시 아래 JSON 스키마를 만족하는 순수 JSON 문자열로만 응답하십시오:
{
  "transcripts": [
    {
      "id": "seg_1",
      "startSeconds": 0,
      "endSeconds": 15,
      "speakerId": "speaker_1",
      "text": "실제 청취된 발언 내용",
      "needsReview": false
    }
  ]
}`;

  try {
    const response = await ai.models.generateContent({
      model: SERVER_CONFIG.geminiModel,
      contents: [
        {
          role: 'user',
          parts: [
            { text: systemPrompt },
            {
              inlineData: {
                mimeType: mimeType || 'audio/webm',
                data: base64Audio,
              },
            },
          ],
        },
      ],
      config: {
        responseMimeType: 'application/json',
        temperature: 0.1,
      },
    });

    const responseText = response.text || '{}';
    let parsed: any;
    try {
      parsed = JSON.parse(responseText);
    } catch (parseErr) {
      console.error('[GEMINI] Failed to parse JSON response from Gemini', { responseText });
      const error: any = new Error('Gemini 응답 JSON 파싱 실패: 모델이 유효한 JSON을 반환하지 않았습니다.');
      error.statusCode = 502;
      error.code = 'INVALID_AI_RESPONSE';
      throw error;
    }

    const rawTranscripts = Array.isArray(parsed.transcripts) ? parsed.transcripts : [];
    if (rawTranscripts.length === 0) {
      console.warn('[GEMINI] Model returned empty transcript segments');
    }

    // 세그먼트 데이터 정규화
    const transcripts: TranscriptSegment[] = rawTranscripts.map((item: any, idx: number) => ({
      id: item.id || `seg_${idx + 1}`,
      startSeconds: typeof item.startSeconds === 'number' ? item.startSeconds : 0,
      endSeconds: typeof item.endSeconds === 'number' ? item.endSeconds : 0,
      speakerId: item.speakerId || 'speaker_1',
      text: String(item.text || '').trim(),
      needsReview: Boolean(item.needsReview),
    }));

    console.log('[GEMINI] Audio transcription successful', { segmentCount: transcripts.length });
    return transcripts;
  } catch (err: any) {
    if (err.statusCode) throw err;
    console.error('[GEMINI] Audio transcription API error', err);
    const error: any = new Error(`Gemini AI 음성 전사 처리 실패: ${err?.message || '알 수 없는 오류'}`);
    error.statusCode = 502;
    error.code = 'GEMINI_INFERENCE_ERROR';
    error.details = String(err);
    throw error;
  }
}

/**
 * 회의 대화록과 안건을 분석하여 구조화된 회의록 요약 데이터 생성
 * @param {object} payload 회의 요약 분석 페이로드
 * @returns {Promise<any>} 구조화된 회의록 요약 객체
 */
export async function summarizeMeetingWithGemini(payload: {
  meetingTitle: string;
  agenda: string;
  department: string;
  attendees: any[];
  transcripts: TranscriptSegment[];
  speakerMapping?: Record<string, string>;
}): Promise<any> {
  console.log('[GEMINI] summarizeMeetingWithGemini called', {
    meetingTitle: payload.meetingTitle,
    transcriptCount: payload.transcripts?.length,
  });

  if (!payload.transcripts || !Array.isArray(payload.transcripts) || payload.transcripts.length === 0) {
    const error: any = new Error('요약할 대화록 데이터가 없습니다. 먼저 음성 전사를 완료해주세요.');
    error.statusCode = 400;
    error.code = 'NO_TRANSCRIPTS';
    throw error;
  }

  const ai = getGeminiClient();

  // 화자 매핑 반영 대화록 텍스트 조합
  const formattedTranscript = payload.transcripts
    .map((seg) => {
      const mappedAttendeeId = payload.speakerMapping ? payload.speakerMapping[seg.speakerId] : null;
      let speakerName = seg.speakerId;
      if (mappedAttendeeId && Array.isArray(payload.attendees)) {
        const att = payload.attendees.find((a: any) => a.id === mappedAttendeeId);
        if (att) speakerName = `${att.name}(${att.role})`;
      }
      return `[ID: ${seg.id}] [${seg.startSeconds}초~${seg.endSeconds}초] ${speakerName}: ${seg.text}`;
    })
    .join('\n');

  const systemPrompt = `당신은 대한민국 공공기관 및 대기업 산업안전보건/위험성평가 회의록 전문 분석 AI입니다.
제공된 실제 대화록(Transcript)만을 철저히 근거로 하여 회의록 요약 및 표준 양식 채우기 데이터를 생성하십시오.

[엄격한 작성 규칙]
1. 대화록에 명시적으로 언급되지 않은 사실, 결정, 담당자, 기한을 절대 지어내지(환각) 마십시오.
2. 담당자나 기한이 언급되지 않았다면 반드시 "미지정"으로 명시하십시오.
3. 제안/검토 의견과 최종 확정된 결정을 명확히 구분하십시오.
4. 주요 결정 사항 및 후속 조치에는 근거가 되는 발언의 id (예: "seg_1", "seg_2")를 evidenceSegmentIds 배열에 정확히 매핑하십시오.
5. 표준 양식의 '구분 / 내용' 표에 들어갈 문안을 suggestedContentRows에 구성하십시오. (구분: 개회 및 보고, 안건 심의, 결정 및 조치사항 등)
6. 유해위험요인과 개선대책이 논의된 경우 riskAssessments에 정형화하십시오.

[회의 기본 정보]
- 회의 제목: ${payload.meetingTitle}
- 사업장/부서: ${payload.department || '미지정'}
- 회의 안건: ${payload.agenda || '미지정'}

[실제 대화록 본문]
${formattedTranscript}
`;

  const summarySchema: Schema = {
    type: Type.OBJECT,
    properties: {
      executiveSummary: { type: Type.STRING, description: '전체 회의 핵심 요약 (3~5문장)' },
      agendaDiscussions: {
        type: Type.ARRAY,
        items: {
          type: Type.OBJECT,
          properties: {
            agendaTitle: { type: Type.STRING },
            discussion: { type: Type.STRING },
            evidenceSegmentIds: { type: Type.ARRAY, items: { type: Type.STRING } },
          },
          required: ['agendaTitle', 'discussion'],
        },
      },
      decisions: {
        type: Type.ARRAY,
        items: {
          type: Type.OBJECT,
          properties: {
            text: { type: Type.STRING },
            evidenceSegmentIds: { type: Type.ARRAY, items: { type: Type.STRING } },
          },
          required: ['text'],
        },
      },
      pendingItems: {
        type: Type.ARRAY,
        items: {
          type: Type.OBJECT,
          properties: {
            text: { type: Type.STRING },
            evidenceSegmentIds: { type: Type.ARRAY, items: { type: Type.STRING } },
          },
          required: ['text'],
        },
      },
      actionItems: {
        type: Type.ARRAY,
        items: {
          type: Type.OBJECT,
          properties: {
            id: { type: Type.STRING },
            task: { type: Type.STRING },
            assignee: { type: Type.STRING },
            dueDate: { type: Type.STRING },
            status: { type: Type.STRING, enum: ['pending', 'in_progress', 'completed'] },
            evidenceSegmentIds: { type: Type.ARRAY, items: { type: Type.STRING } },
          },
          required: ['id', 'task', 'assignee', 'dueDate', 'status'],
        },
      },
      suggestedContentRows: {
        type: Type.ARRAY,
        items: {
          type: Type.OBJECT,
          properties: {
            id: { type: Type.STRING },
            category: { type: Type.STRING },
            content: { type: Type.STRING },
            order: { type: Type.INTEGER },
          },
          required: ['id', 'category', 'content', 'order'],
        },
      },
      riskAssessments: {
        type: Type.ARRAY,
        items: {
          type: Type.OBJECT,
          properties: {
            riskFactor: { type: Type.STRING },
            countermeasure: { type: Type.STRING },
            assignee: { type: Type.STRING },
            dueDate: { type: Type.STRING },
          },
          required: ['riskFactor', 'countermeasure', 'assignee', 'dueDate'],
        },
      },
    },
    required: [
      'executiveSummary',
      'agendaDiscussions',
      'decisions',
      'pendingItems',
      'actionItems',
      'suggestedContentRows',
    ],
  };

  try {
    const response = await ai.models.generateContent({
      model: SERVER_CONFIG.geminiModel,
      contents: [{ role: 'user', parts: [{ text: systemPrompt }] }],
      config: {
        responseMimeType: 'application/json',
        responseSchema: summarySchema,
        temperature: 0.1,
      },
    });

    const parsed = JSON.parse(response.text || '{}');
    const resultSummary = {
      ...parsed,
      generatedAt: new Date().toISOString(),
      version: 1,
      isReviewedByUser: false,
    };

    console.log('[GEMINI] Meeting summary generated successfully');
    return resultSummary;
  } catch (err: any) {
    if (err.statusCode) throw err;
    console.error('[GEMINI] Meeting summarization API error', err);
    const error: any = new Error(`Gemini AI 회의록 요약 처리 실패: ${err?.message || '알 수 없는 오류'}`);
    error.statusCode = 502;
    error.code = 'GEMINI_INFERENCE_ERROR';
    error.details = String(err);
    throw error;
  }
}
