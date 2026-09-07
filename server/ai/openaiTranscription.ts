/**
 * @file server/ai/openaiTranscription.ts
 * @description OpenAI Transcription API 기반 오디오 화자 분리(Diarization) 음성 전사 모듈.
 * 모델 gpt-4o-transcribe-diarize를 활용하여 오디오를 화자별 발언 단위로 분리 전사합니다.
 * API 키는 일절 외부에 노출하지 않으며, 401/403 설정 오류와 일시적 5xx/429 장애를 정밀하게 분류합니다.
 */

import OpenAI, { toFile } from 'openai';
import { getServerEnv, SERVER_CONFIG } from '../config.js';

/**
 * 화자별 발언 단위 인터페이스
 */
export interface SpeakerEntry {
  speaker: string;
  startTime: number;
  endTime: number;
  text: string;
}

/**
 * 프론트엔드 호환 대화록 세그먼트 인터페이스
 */
export interface LegacyTranscriptSegment {
  id: string;
  startSeconds: number;
  endSeconds: number;
  speakerId: string;
  speakerName?: string;
  text: string;
  originalAiText?: string;
  isUserEdited?: boolean;
  needsReview: boolean;
  confidence?: number;
}

/**
 * OpenAI 전사 결과 인터페이스
 */
export interface OpenAITranscriptionResult {
  success: boolean;
  provider: 'openai';
  fallbackUsed: false;
  speakers: SpeakerEntry[];
  fullTranscript: string;
  summary: null;
  transcripts: LegacyTranscriptSegment[];
}

/**
 * OpenAI 클라이언트 지연 인스턴스
 */
let openaiClient: OpenAI | null = null;

/**
 * OpenAI 클라이언트 취득 헬퍼
 * @returns {OpenAI} 초기화된 OpenAI 인스턴스
 */
export function getOpenAIClient(): OpenAI {
  console.log('[OPENAI] getOpenAIClient called');
  const { openaiApiKey } = getServerEnv();

  if (!openaiApiKey || openaiApiKey.trim() === '' || openaiApiKey === 'MY_OPENAI_API_KEY') {
    const err: any = new Error('OPENAI_API_KEY가 서버에 설정되어 있지 않습니다.');
    err.statusCode = 401;
    err.code = 'MISSING_OPENAI_API_KEY';
    err.isConfigError = true;
    throw err;
  }

  if (!openaiClient) {
    openaiClient = new OpenAI({
      apiKey: openaiApiKey,
    });
  }

  return openaiClient;
}

/**
 * 오디오 MIME 타입 및 파일명 보정 헬퍼
 * @param {string} mimeType 입력 MIME 타입
 * @returns {{ extension: string, normalizedMime: string }}
 */
function normalizeAudioFileInfo(mimeType: string): { extension: string; normalizedMime: string } {
  console.log('[OPENAI] normalizeAudioFileInfo called', { mimeType });
  const baseMime = (mimeType || 'audio/webm').split(';')[0].trim().toLowerCase();

  switch (baseMime) {
    case 'audio/mp3':
    case 'audio/mpeg':
      return { extension: 'mp3', normalizedMime: 'audio/mpeg' };
    case 'audio/wav':
    case 'audio/x-wav':
      return { extension: 'wav', normalizedMime: 'audio/wav' };
    case 'audio/m4a':
    case 'audio/x-m4a':
    case 'audio/mp4':
      return { extension: 'm4a', normalizedMime: 'audio/m4a' };
    case 'audio/ogg':
      return { extension: 'ogg', normalizedMime: 'audio/ogg' };
    case 'audio/webm':
    case 'video/webm':
    default:
      return { extension: 'webm', normalizedMime: 'audio/webm' };
  }
}

/**
 * OpenAI 응답에서 화자 분리 데이터 추출 및 정규화
 * @param {any} rawResponse OpenAI audio.transcriptions.create 응답 데이터
 * @param {string[]} attendeeNames 회의 참석자 명단 (매핑 힌트용)
 * @returns {{ speakers: SpeakerEntry[], fullTranscript: string, transcripts: LegacyTranscriptSegment[] }}
 */
function parseOpenAIDiarizationResponse(
  rawResponse: any,
  attendeeNames: string[] = []
): {
  speakers: SpeakerEntry[];
  fullTranscript: string;
  transcripts: LegacyTranscriptSegment[];
} {
  console.log('[OPENAI] parseOpenAIDiarizationResponse called');

  const fullTranscript = (rawResponse?.text || '').trim();
  const speakers: SpeakerEntry[] = [];
  const transcripts: LegacyTranscriptSegment[] = [];

  // 1. OpenAI Diarization 결과 구조 확인 (diarization, segments, utterances, words 등)
  const segmentsSource =
    rawResponse?.segments ||
    rawResponse?.diarization ||
    rawResponse?.utterances ||
    [];

  if (Array.isArray(segmentsSource) && segmentsSource.length > 0) {
    segmentsSource.forEach((seg: any, idx: number) => {
      const segText = (seg.text || seg.transcript || '').trim();
      if (!segText) return;

      const startTime = typeof seg.start === 'number' ? seg.start : typeof seg.startTime === 'number' ? seg.startTime : 0;
      const endTime = typeof seg.end === 'number' ? seg.end : typeof seg.endTime === 'number' ? seg.endTime : startTime + 2;
      
      // 화자 식별자 정규화: "A" -> "화자 1", "speaker_0" -> "화자 1", "0" -> "화자 1"
      let rawSpeaker = String(seg.speaker || seg.speaker_label || seg.speakerId || `화자 ${idx + 1}`).trim();
      let speakerDisplayName = rawSpeaker;

      if (/^[A-Z]$/.test(rawSpeaker)) {
        // 알파벳 화자 레이블 (A -> 화자 1, B -> 화자 2 등)
        const code = rawSpeaker.charCodeAt(0) - 64;
        speakerDisplayName = `화자 ${code}`;
      } else if (/^speaker[_-]?(\d+)$/i.test(rawSpeaker)) {
        const num = parseInt(rawSpeaker.replace(/^speaker[_-]?/i, ''), 10);
        speakerDisplayName = `화자 ${num + 1}`;
      } else if (/^\d+$/.test(rawSpeaker)) {
        speakerDisplayName = `화자 ${parseInt(rawSpeaker, 10) + 1}`;
      } else if (!speakerDisplayName.startsWith('화자')) {
        speakerDisplayName = `화자 ${speakerDisplayName}`;
      }

      // 화자 ID
      const speakerId = `speaker_${idx + 1}`;

      // 힌트가 있고 정확히 일치하는 경우에만 이름 매핑 (불명확 시 임의 부여 금지)
      let speakerName: string | undefined = undefined;
      if (attendeeNames.length === 1 && segmentsSource.length > 0) {
        // 단독 회의인 경우
        speakerName = attendeeNames[0];
      }

      speakers.push({
        speaker: speakerDisplayName,
        startTime: Math.round(startTime * 10) / 10,
        endTime: Math.round(endTime * 10) / 10,
        text: segText,
      });

      transcripts.push({
        id: `openai-seg-${Date.now()}-${idx + 1}`,
        startSeconds: Math.round(startTime),
        endSeconds: Math.round(endTime),
        speakerId,
        speakerName: speakerName || speakerDisplayName,
        text: segText,
        originalAiText: segText,
        needsReview: false,
        confidence: typeof seg.confidence === 'number' ? seg.confidence : 0.95,
      });
    });
  }

  // 만약 segments 정보가 비어있고 text만 존재하는 경우 문장 단위로 분할하여 기본 화자 배정
  if (speakers.length === 0 && fullTranscript.length > 0) {
    console.log('[OPENAI] No diarized segments found in response, creating fallback segments from text');
    const sentences = fullTranscript
      .split(/(?<=[.?!])\s+/)
      .map((s: string) => s.trim())
      .filter((s: string) => s.length > 0);

    let currentTime = 0;
    sentences.forEach((sentence: string, idx: number) => {
      const estimatedDuration = Math.max(2, Math.min(15, sentence.length * 0.15));
      const endTime = currentTime + estimatedDuration;
      const speakerDisplayName = '화자 1';

      speakers.push({
        speaker: speakerDisplayName,
        startTime: Math.round(currentTime * 10) / 10,
        endTime: Math.round(endTime * 10) / 10,
        text: sentence,
      });

      transcripts.push({
        id: `openai-fallback-seg-${Date.now()}-${idx + 1}`,
        startSeconds: Math.round(currentTime),
        endSeconds: Math.round(endTime),
        speakerId: 'speaker_1',
        speakerName: speakerDisplayName,
        text: sentence,
        originalAiText: sentence,
        needsReview: false,
        confidence: 0.9,
      });

      currentTime = endTime;
    });
  }

  return { speakers, fullTranscript, transcripts };
}

/**
 * OpenAI Transcription API(gpt-4o-transcribe-diarize)를 호출하여 오디오 음성 전사 및 화자 분리 수행
 * @param {Buffer} audioBuffer 오디오 파일 바이너리 버퍼
 * @param {string} mimeType 오디오 MIME 타입 (audio/webm, audio/mp3 등)
 * @param {object} context 회의 안건 및 참석자 힌트
 * @returns {Promise<OpenAITranscriptionResult>} 전사 및 화자 분리 결과 객체
 */
export async function transcribeAudioWithOpenAI(
  audioBuffer: Buffer,
  mimeType: string,
  context: {
    meetingTitle?: string;
    agenda?: string;
    attendeeNames?: string[];
  } = {}
): Promise<OpenAITranscriptionResult> {
  const modelName = SERVER_CONFIG.openaiTranscribeModel;
  console.log('[transcription] primary provider: openai');
  console.log('[transcription] model:', modelName);

  if (!audioBuffer || audioBuffer.length === 0) {
    const err: any = new Error('전사할 오디오 버퍼가 비어 있습니다.');
    err.statusCode = 400;
    err.code = 'EMPTY_AUDIO_BUFFER';
    err.isBadRequest = true;
    throw err;
  }

  const { extension, normalizedMime } = normalizeAudioFileInfo(mimeType);

  console.log('[transcription] file type:', normalizedMime);
  console.log('[transcription] file size:', audioBuffer.length);

  const client = getOpenAIClient();

  try {
    // 1. OpenAI SDK toFile 헬퍼를 통해 표준 File 객체 생성
    const fileName = `meeting_${Date.now()}.${extension}`;
    const file = await toFile(audioBuffer, fileName, { type: normalizedMime });

    // 2. OpenAI 오디오 전사 API 호출 (gpt-4o-transcribe-diarize 공식 규격 준수)
    // 주의: gpt-4o-transcribe-diarize 모델은 response_format: 'diarized_json'을 요구하며,
    // prompt, timestamp_granularities, temperature 등은 지원하지 않으므로 포함하지 않습니다.
    // 30초 초과 오디오 처리를 위해 chunking_strategy: 'auto'를 지정합니다.
    const requestPayload: any = {
      file,
      model: modelName,
      response_format: 'diarized_json',
      chunking_strategy: 'auto',
    };

    console.log('[transcription] OpenAI model:', modelName);
    console.log('[transcription] Calling client.audio.transcriptions.create with:', {
      model: modelName,
      fileName,
      mimeType: normalizedMime,
      fileSizeBytes: audioBuffer.length,
      response_format: requestPayload.response_format,
      chunking_strategy: requestPayload.chunking_strategy,
    });

    const rawResponse: any = await (client.audio.transcriptions as any).create(requestPayload);

    console.log('[transcription] OpenAI success');

    // 3. 응답 파싱 및 화자 분리 데이터 생성
    const { speakers, fullTranscript, transcripts } = parseOpenAIDiarizationResponse(
      rawResponse,
      context.attendeeNames || []
    );

    return {
      success: true,
      provider: 'openai',
      fallbackUsed: false,
      speakers,
      fullTranscript,
      summary: null,
      transcripts,
    };
  } catch (err: any) {
    const errorBody = err?.error || err?.response?.data?.error || {};
    const errorMessage = errorBody.message || err?.message || String(err);
    const errorCode = errorBody.code || err?.code || 'OPENAI_ERROR';
    const errorType = errorBody.type || err?.type || 'api_error';
    const status = err?.status || err?.statusCode || 500;

    console.error('[transcription] OpenAI failure:', {
      status,
      errorCode,
      errorType,
      errorMessage,
      model: modelName,
      fileSizeBytes: audioBuffer.length,
    });

    // 4. 에러 분류 (401/403: 설정 오류, 400: 요청 오류, 429/5xx: Fallback 대상 일시 장애)
    const openAiError: any = new Error(errorMessage);
    openAiError.statusCode = status;
    openAiError.errorCode = errorCode;
    openAiError.errorType = errorType;
    openAiError.detail = errorMessage;
    openAiError.originalError = err;

    if (status === 401 || status === 403) {
      openAiError.isConfigError = true;
      openAiError.userMessage = 'OpenAI API 설정을 확인해주세요.';
      openAiError.shouldFallback = false;
    } else if (status === 400) {
      openAiError.isBadRequest = true;
      openAiError.userMessage = `잘못된 오디오 전사 요청입니다: ${errorMessage}`;
      openAiError.shouldFallback = false;
    } else {
      // 429, 500, 502, 503, 504, network error, timeout 등은 Fallback 대상
      openAiError.shouldFallback = true;
      openAiError.userMessage = 'OpenAI 서비스 일시 장애로 예비 엔진으로 전환합니다.';
    }

    throw openAiError;
  }
}
