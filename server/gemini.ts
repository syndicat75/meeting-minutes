/**
 * @file server/gemini.ts
 * @description Google Gemini 3.6 Flash 기반 음성 전사(STT) 및 회의록 구조화 요약 AI 모듈.
 * 가짜(Mock) 성공 응답을 일절 배제하고, 실제 AI 모델 추론만을 수행하며, 키 미설정 시 명확한 503 에러를 반환합니다.
 */

import { GoogleGenAI, Type, Schema } from '@google/genai';
import { getServerEnv, SERVER_CONFIG } from './config.js';

/**
 * 서버 전역 Gemini 모델 설정
 * Vercel 및 로컬 환경변수(GEMINI_MODEL)를 최우선으로 적용하며, 기본값은 gemini-3.6-flash 입니다.
 */
export const GEMINI_MODEL: string =
  process.env.GEMINI_MODEL || SERVER_CONFIG.geminiModel || 'gemini-3.6-flash';

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
    const error: any = new Error('GEMINI_API_KEY가 서버에 설정되어 있지 않습니다.');
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
 * 화자별 대화 항목 인터페이스
 */
export interface TranscriptionSpeakerItem {
  speaker: string;
  startTime?: string;
  endTime?: string;
  text: string;
}

/**
 * 기존 대화록 세그먼트 인터페이스 (UI 호환용)
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
 * 통합 화자 분리 전사 결과 인터페이스
 */
export interface TranscriptionResult {
  success: boolean;
  transcript: string;
  speakers: TranscriptionSpeakerItem[];
  fullTranscript: string;
  summary: string;
  transcripts: TranscriptSegment[];
}

/**
 * "MM:SS" 또는 "HH:MM:SS" 타임스탬프 문자열을 초 단위 숫자로 변환하는 헬퍼 함수
 * @param {string | undefined} timeStr 타임스탬프 문자열
 * @param {number} fallback 기본 초 단위 값
 * @returns {number} 초 단위 숫자
 */
function parseTimeStringToSeconds(timeStr: string | undefined, fallback: number = 0): number {
  if (!timeStr) return fallback;
  const parts = timeStr.trim().split(':').map((p) => parseFloat(p));
  if (parts.some((p) => isNaN(p))) return fallback;

  if (parts.length === 2) {
    return Math.round((parts[0] * 60 + parts[1]) * 10) / 10;
  } else if (parts.length === 3) {
    return Math.round((parts[0] * 3600 + parts[1] * 60 + parts[2]) * 10) / 10;
  }
  return fallback;
}

/**
 * 음성 버퍼를 Gemini 3.6 Flash 모델로 전송하여 화자별 대화록으로 전사
 * @param {Buffer} audioBuffer 오디오 원시 바이너리 데이터
 * @param {string} mimeType 오디오 MIME 타입 (예: audio/webm, audio/webm;codecs=opus)
 * @param {object} meetingContext 회의 컨텍스트 정보 (제목, 안건, 참석자 명단)
 * @returns {Promise<TranscriptionResult>} 화자 분리 전사 결과 객체
 */
export async function transcribeAudioWithGemini(
  audioBuffer: Buffer,
  mimeType: string,
  meetingContext: {
    meetingTitle: string;
    agenda?: string;
    attendeeNames?: string[];
  }
): Promise<TranscriptionResult> {
  console.log('[transcription] Gemini model:', GEMINI_MODEL);

  if (!audioBuffer || audioBuffer.length === 0) {
    const error: any = new Error('전사할 오디오 버퍼가 비어 있습니다.');
    error.statusCode = 400;
    error.code = 'EMPTY_AUDIO_BUFFER';
    throw error;
  }

  // 1. MIME 타입 정규화: audio/webm;codecs=opus -> audio/webm
  const rawMime = mimeType || 'audio/webm';
  const normalizedMimeType = rawMime.split(';')[0].trim().toLowerCase() || 'audio/webm';

  console.log('[transcription] request', {
    model: GEMINI_MODEL,
    mimeType: normalizedMimeType,
    fileSize: audioBuffer.length,
    meetingTitle: meetingContext.meetingTitle,
  });

  const ai = getGeminiClient();
  const base64Audio = audioBuffer.toString('base64');

  const systemPrompt = `당신은 대한민국 산업안전보건 및 기업 회의록 전문 음성 전사 AI입니다.
입력된 회의 음성을 정확하게 청취하고, 화자 분리 대화록과 전체 전사문, 핵심 요약을 생성하십시오.

[엄격한 처리 규칙]
1. 실제 음성에 기록된 발언만 전사하십시오. 음성에 없는 대화나 임의의 예시를 지어내거나(환각) 추측하지 마십시오.
2. 화자는 "화자 1", "화자 2", "화자 3" 형태로 식별하십시오.
3. 소음 구간이나 발음 불명확 구간은 무리하게 추측하지 말고 가능한 들리는 대로 정확히 기재하십시오.
4. startTime과 endTime은 "MM:SS" 형태(예: "00:00", "00:15")로 작성하십시오.
5. 회의 기본 정보: 제목 "${meetingContext.meetingTitle}", 안건: "${meetingContext.agenda || '일반 안건'}"
참고 참석자 명단: ${(meetingContext.attendeeNames || []).join(', ') || '미지정'}

반드시 아래 JSON 스키마를 만족하는 순수 JSON으로 응답하십시오:
{
  "speakers": [
    {
      "speaker": "화자 1",
      "startTime": "00:00",
      "endTime": "00:08",
      "text": "발언 내용"
    }
  ],
  "fullTranscript": "전체 회의 내용",
  "summary": "회의 핵심 요약"
}`;

  const transcriptionSchema: Schema = {
    type: Type.OBJECT,
    properties: {
      speakers: {
        type: Type.ARRAY,
        items: {
          type: Type.OBJECT,
          properties: {
            speaker: { type: Type.STRING },
            startTime: { type: Type.STRING },
            endTime: { type: Type.STRING },
            text: { type: Type.STRING },
          },
          required: ['speaker', 'text'],
        },
      },
      fullTranscript: { type: Type.STRING },
      summary: { type: Type.STRING },
    },
    required: ['speakers', 'fullTranscript', 'summary'],
  };

  try {
    const response = await ai.models.generateContent({
      model: GEMINI_MODEL,
      contents: [
        {
          role: 'user',
          parts: [
            { text: systemPrompt },
            {
              inlineData: {
                mimeType: normalizedMimeType,
                data: base64Audio,
              },
            },
          ],
        },
      ],
      config: {
        responseMimeType: 'application/json',
        responseSchema: transcriptionSchema,
        temperature: 0.1,
      },
    });

    let responseText = (response.text || '').trim();

    // 마크다운 코드 펜스(```json ... ```) 안전 제거
    if (responseText.startsWith('```json')) {
      responseText = responseText.replace(/^```json\s*/i, '').replace(/```\s*$/, '').trim();
    } else if (responseText.startsWith('```')) {
      responseText = responseText.replace(/^```\s*/, '').replace(/```\s*$/, '').trim();
    }

    let parsed: any;
    try {
      parsed = JSON.parse(responseText);
    } catch (parseErr) {
      console.error('[transcription] Gemini response JSON parse failed. Raw response snippet:', responseText.slice(0, 300));
      const error: any = new Error('Gemini 응답 JSON 파싱 실패: 모델이 유효한 JSON을 반환하지 않았습니다.');
      error.statusCode = 502;
      error.code = 'INVALID_AI_RESPONSE';
      throw error;
    }

    const rawSpeakers = Array.isArray(parsed.speakers) ? parsed.speakers : [];
    const fullTranscript = String(parsed.fullTranscript || '').trim() ||
      rawSpeakers.map((s: any) => `${s.speaker}: ${s.text}`).join('\n');
    const summary = String(parsed.summary || '').trim();

    const speakers: TranscriptionSpeakerItem[] = rawSpeakers.map((s: any, idx: number) => ({
      speaker: s.speaker || `화자 ${idx + 1}`,
      startTime: s.startTime || '00:00',
      endTime: s.endTime || '00:00',
      text: String(s.text || '').trim(),
    }));

    // 기존 프론트엔드 호환용 transcripts 세그먼트 생성
    let currentSeconds = 0;
    const transcripts: TranscriptSegment[] = speakers.map((s, idx) => {
      const start = parseTimeStringToSeconds(s.startTime, currentSeconds);
      const end = parseTimeStringToSeconds(s.endTime, start + 5);
      currentSeconds = end;

      // speaker_1, speaker_2 형태로 ID 규격화
      const speakerNumMatch = s.speaker.match(/\d+/);
      const speakerId = speakerNumMatch ? `speaker_${speakerNumMatch[0]}` : `speaker_${idx + 1}`;

      return {
        id: `seg_${idx + 1}`,
        startSeconds: start,
        endSeconds: end,
        speakerId,
        text: s.text,
        needsReview: false,
      };
    });

    console.log('[transcription] Audio transcription successful', {
      speakerCount: speakers.length,
      fullTranscriptLength: fullTranscript.length,
    });

    return {
      success: true,
      transcript: fullTranscript,
      speakers,
      fullTranscript,
      summary,
      transcripts,
    };
  } catch (err: any) {
    if (err.statusCode && err.code === 'GEMINI_API_KEY_NOT_CONFIGURED') {
      throw err;
    }

    // 3. Gemini API 오류 원인을 지정된 형식으로 서버 로그에 상세 출력
    console.error('[transcription] Gemini API error', err);

    const httpStatus =
      err?.status ||
      err?.statusCode ||
      err?.response?.status ||
      (err?.message?.includes('429') ? 429 : 500);

    const errorMessage = err?.message || String(err);

    console.error('[transcription] Diagnostics:', {
      model: GEMINI_MODEL,
      mimeType: normalizedMimeType,
      fileSizeBytes: audioBuffer.length,
      httpStatus,
      errorMessage,
    });

    let mappedStatusCode = 500;
    let userErrorMessage = 'AI 음성 전사 처리 중 서버 오류가 발생했습니다.';

    const isModelNotFound =
      httpStatus === 404 ||
      errorMessage.includes('NOT_FOUND') ||
      errorMessage.includes('no longer available') ||
      (errorMessage.toLowerCase().includes('model') &&
        (errorMessage.includes('404') || errorMessage.includes('not found')));

    if (isModelNotFound) {
      mappedStatusCode = 404;
      userErrorMessage =
        '현재 설정된 AI 모델을 사용할 수 없습니다. 관리자에게 Gemini 모델 설정 확인을 요청해주세요.';
    } else if (httpStatus === 401 || httpStatus === 403) {
      mappedStatusCode = 401;
      userErrorMessage = 'Gemini API 인증 오류가 발생했습니다. 서버 API Key를 확인해주세요.';
    } else if (httpStatus === 429) {
      mappedStatusCode = 429;
      userErrorMessage = 'Gemini API 사용량 또는 분당 요청 한도(Quota)가 초과되었습니다. 잠시 후 다시 시도해주세요.';
    } else if (httpStatus === 400) {
      mappedStatusCode = 400;
      userErrorMessage = '오디오 또는 Gemini 요청 형식 오류가 발생했습니다.';
    } else if (httpStatus === 413) {
      mappedStatusCode = 413;
      userErrorMessage = '오디오 파일 크기가 허용 한도를 초과했습니다.';
    } else if (httpStatus === 503) {
      mappedStatusCode = 503;
      userErrorMessage = 'Gemini 서비스에 일시적인 장애가 발생했습니다. 잠시 후 다시 시도해주세요.';
    } else {
      userErrorMessage = `Gemini 모델 추론 오류: ${errorMessage}`;
    }

    const error: any = new Error(userErrorMessage);
    error.statusCode = mappedStatusCode;
    error.code = 'GEMINI_INFERENCE_ERROR';
    error.detail = errorMessage;
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

  console.log('[summary] Gemini model:', GEMINI_MODEL);

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
      model: GEMINI_MODEL,
      contents: [{ role: 'user', parts: [{ text: systemPrompt }] }],
      config: {
        responseMimeType: 'application/json',
        responseSchema: summarySchema,
        temperature: 0.1,
      },
    });

    let responseText = (response.text || '{}').trim();
    if (responseText.startsWith('```json')) {
      responseText = responseText.replace(/^```json\s*/i, '').replace(/```\s*$/, '').trim();
    } else if (responseText.startsWith('```')) {
      responseText = responseText.replace(/^```\s*/, '').replace(/```\s*$/, '').trim();
    }

    let parsed: any;
    try {
      parsed = JSON.parse(responseText);
    } catch (parseErr) {
      console.error('[summarize] Gemini response JSON parse failed. Raw response snippet:', responseText.slice(0, 300));
      const error: any = new Error('Gemini 요약 응답 JSON 파싱 실패');
      error.statusCode = 502;
      error.code = 'INVALID_AI_RESPONSE';
      throw error;
    }
    const resultSummary = {
      ...parsed,
      generatedAt: new Date().toISOString(),
      version: 1,
      isReviewedByUser: false,
    };

    console.log('[GEMINI] Meeting summary generated successfully with model:', GEMINI_MODEL);
    return resultSummary;
  } catch (err: any) {
    if (err.statusCode) throw err;
    console.error('[GEMINI] Meeting summarization API error', err);

    const errorMessage = err?.message || String(err);
    const httpStatus = err?.status || err?.statusCode || (errorMessage.includes('404') ? 404 : 500);

    const isModelNotFound =
      httpStatus === 404 ||
      errorMessage.includes('NOT_FOUND') ||
      errorMessage.includes('no longer available') ||
      (errorMessage.toLowerCase().includes('model') &&
        (errorMessage.includes('404') || errorMessage.includes('not found')));

    if (isModelNotFound) {
      const error: any = new Error(
        '현재 설정된 AI 모델을 사용할 수 없습니다. 관리자에게 Gemini 모델 설정 확인을 요청해주세요.'
      );
      error.statusCode = 404;
      error.code = 'MODEL_NOT_FOUND';
      error.details = errorMessage;
      throw error;
    }

    const error: any = new Error(`Gemini AI 회의록 요약 처리 실패: ${errorMessage}`);
    error.statusCode = 502;
    error.code = 'GEMINI_INFERENCE_ERROR';
    error.details = String(err);
    throw error;
  }
}
