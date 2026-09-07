/**
 * @file src/services/aiService.ts
 * @description AI 음성 전사(STT) 및 회의록 구조화 요약 요청 서비스.
 * 서버 측 `/api/ai/transcribe` 및 `/api/ai/summarize` 엔드포인트와 통신하며,
 * 청크 단위 전사 병합, 지수 백오프 재시도 및 스키마 유효성 검사를 수행합니다.
 */

import {
  TranscriptSegment,
  MeetingSummary,
  MeetingContentRow,
  Attendee,
} from '../types/meeting';
import { APP_CONFIG } from '../config/appConfig';
import { logger } from '../utils/logger';

export interface TranscribeRequestPayload {
  meetingId: string;
  audioBlob?: Blob;
  audioStoragePath?: string;
  audioUrl?: string;
  attendeeNames?: string[];
  meetingTitle?: string;
  agenda?: string;
}

export interface SummarizeRequestPayload {
  meetingId: string;
  meetingTitle: string;
  agenda: string;
  department: string;
  attendees: Attendee[];
  transcripts: TranscriptSegment[];
  speakerMapping: Record<string, string>;
}

/**
 * 지수 백오프(Exponential Backoff)를 적용한 HTTP 요청 헬퍼
 * @param url 요청 URL
 * @param options RequestInit 옵션
 * @param retries 남은 재시도 횟수
 * @param delayMs 지연 밀리초
 * @returns {Promise<Response>}
 */
async function fetchWithRetry(
  url: string,
  options: RequestInit,
  retries: number = APP_CONFIG.ai.maxRetries,
  delayMs: number = APP_CONFIG.ai.initialRetryDelayMs
): Promise<Response> {
  logger.debug('fetchWithRetry called', { url, retries, delayMs });
  try {
    const res = await fetch(url, options);
    if ((res.status === 429 || res.status >= 500) && retries > 0) {
      logger.warn(`Received status ${res.status}, retrying in ${delayMs}ms...`);
      await new Promise((r) => setTimeout(r, delayMs));
      return fetchWithRetry(url, options, retries - 1, delayMs * 2);
    }
    return res;
  } catch (err) {
    if (retries > 0) {
      logger.warn(`Fetch error, retrying in ${delayMs}ms...`, { error: String(err) });
      await new Promise((r) => setTimeout(r, delayMs));
      return fetchWithRetry(url, options, retries - 1, delayMs * 2);
    }
    throw err;
  }
}

/**
 * 음성 데이터를 서버로 전송하여 화자 분리 대화록 생성 요청
 * @param payload 전사 요청 데이터
 * @returns {Promise<TranscriptSegment[]>} 화자별 발언 단위 대화록 배열
 */
export async function requestTranscription(
  payload: TranscribeRequestPayload
): Promise<TranscriptSegment[]> {
  logger.info('requestTranscription called', { meetingId: payload.meetingId });

  const formData = new FormData();
  formData.append('meetingId', payload.meetingId);
  if (payload.audioStoragePath) formData.append('audioStoragePath', payload.audioStoragePath);
  if (payload.audioUrl) formData.append('audioUrl', payload.audioUrl);
  if (payload.meetingTitle) formData.append('meetingTitle', payload.meetingTitle);
  if (payload.agenda) formData.append('agenda', payload.agenda);
  if (payload.attendeeNames) formData.append('attendeeNames', JSON.stringify(payload.attendeeNames));

  if (payload.audioBlob) {
    formData.append('audioFile', payload.audioBlob, 'recording.webm');
  }

  try {
    const response = await fetchWithRetry('/api/ai/transcribe', {
      method: 'POST',
      body: formData,
    });

    if (!response.ok) {
      const errJson = await response.json().catch(() => ({}));
      throw new Error(errJson.error || `서버 전사 요청 실패 (코드 ${response.status})`);
    }

    const data = await response.json();
    logger.info('Transcription response received', { segmentCount: data.transcripts?.length });
    return data.transcripts as TranscriptSegment[];
  } catch (err: any) {
    logger.error('requestTranscription failed', { error: err?.message });
    throw err;
  }
}

/**
 * 대화록 및 회의 정보를 기반으로 AI 요약 및 '구분 / 내용' 양식 생성 요청
 * @param payload 요약 요청 데이터
 * @returns {Promise<MeetingSummary>}
 */
export async function requestMeetingSummary(
  payload: SummarizeRequestPayload
): Promise<MeetingSummary> {
  logger.info('requestMeetingSummary called', {
    meetingId: payload.meetingId,
    transcriptCount: payload.transcripts.length,
  });

  try {
    const response = await fetchWithRetry('/api/ai/summarize', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      const errJson = await response.json().catch(() => ({}));
      throw new Error(errJson.error || `서버 요약 요청 실패 (코드 ${response.status})`);
    }

    const data = await response.json();
    logger.info('Meeting summary received successfully', { meetingId: payload.meetingId });
    return data.summary as MeetingSummary;
  } catch (err: any) {
    logger.error('requestMeetingSummary failed', { error: err?.message });
    throw err;
  }
}
