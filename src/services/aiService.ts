/**
 * @file src/services/aiService.ts
 * @description AI 음성 전사(STT) 및 회의록 구조화 요약 클라이언트 요청 서비스.
 * 서버 측 `/api/ai/transcribe` 및 `/api/ai/summarize` 엔드포인트와 통신하며,
 * Firebase ID 토큰 전송, Vercel 본문 용량(4.5MB) 안전 보호, 404 비반복 차단 및 상세 에러 구분을 제공합니다.
 */

import {
  TranscriptSegment,
  MeetingSummary,
  Attendee,
} from '../types/meeting';
import { APP_CONFIG } from '../config/appConfig';
import { logger } from '../utils/logger';
import { getCurrentUserIdToken } from './firebase';

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

export interface ApiHealthResponse {
  status: string;
  service: string;
  timestamp: string;
  environment: string;
  geminiConfigured: boolean;
  firebaseConfigured: boolean;
  storageBucketConfigured: boolean;
  model: string;
  limits: {
    directUploadLimitMb: number;
    storageMaxLimitMb: number;
    vercelBodyLimitMb: number;
    serverlessTimeoutSec: number;
  };
}

/**
 * 지수 백오프(Exponential Backoff)를 적용한 HTTP 요청 헬퍼
 * 주의: 404, 401, 403, 503(키 미설정) 등 클라이언트/설정 오류는 재시도하지 않고 즉시 반환합니다.
 * @param {string} url 요청 대상 URL
 * @param {RequestInit} options 요청 옵션
 * @param {number} [retries] 남은 재시도 횟수
 * @param {number} [delayMs] 재시도 지연 시간(밀리초)
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

    // 404, 400, 401, 403은 재시도 대상에서 즉시 제외
    if (res.status === 404 || res.status === 400 || res.status === 401 || res.status === 403) {
      logger.warn(`Received terminal status ${res.status}, no retry`, { url });
      return res;
    }

    // 429(Too Many Requests) 또는 500/502 서버 일시 오류에 한해서만 재시도
    if ((res.status === 429 || res.status === 500 || res.status === 502) && retries > 0) {
      logger.warn(`Received status ${res.status}, retrying in ${delayMs}ms...`);
      await new Promise((r) => setTimeout(r, delayMs));
      return fetchWithRetry(url, options, retries - 1, delayMs * 2);
    }

    return res;
  } catch (err) {
    if (retries > 0) {
      logger.warn(`Fetch network error, retrying in ${delayMs}ms...`, { error: String(err) });
      await new Promise((r) => setTimeout(r, delayMs));
      return fetchWithRetry(url, options, retries - 1, delayMs * 2);
    }
    throw err;
  }
}

/**
 * 서버 응답 검증 및 진단별 상세 에러 메시지 생성 헬퍼
 * response.text()로 원본을 수신한 후 안전하게 JSON 파싱을 수행하며,
 * 401/403(인증), 429(할당량), 400(형식), 413(용량), 503(키/장애), 500(서버 내부)을 명확히 구분합니다.
 * @param {Response} response fetch 응답 객체
 * @param {string} actionName 수행 중인 작업명
 * @returns {Promise<any>} 파싱된 JSON 데이터
 */
async function parseServerResponse(response: Response, actionName: string): Promise<any> {
  logger.info('parseServerResponse called', { actionName, status: response.status });

  // 1. 먼저 response.text()로 원시 응답을 취득
  const rawText = await response.text();

  // 2. 안전한 JSON 파싱 시도
  let body: any = null;
  try {
    body = JSON.parse(rawText);
  } catch (jsonErr) {
    // JSON이 아닌 응답인 경우 (예: HTML 또는 일반 텍스트) 개발자 콘솔에 status code와 rawText를 상세 출력
    console.error(`[API Error] Non-JSON response from server (Status ${response.status}):`, rawText);
    logger.error('Failed to parse server response as JSON', { status: response.status, rawSnippet: rawText.slice(0, 200) });
    throw new Error('AI 전사 서버 오류가 발생했습니다.');
  }

  // 3. HTTP 실패 또는 서버 명시 실패(success === false) 처리
  if (!response.ok || body?.success === false) {
    const errorMsg = body?.error || body?.message || '알 수 없는 오류가 발생했습니다.';
    const detailMsg = body?.detail || body?.details ? ` (${body?.detail || body?.details})` : '';

    console.error(`[API Error] ${actionName} failed with status ${response.status}:`, {
      error: errorMsg,
      detail: body?.detail || body?.details,
      status: response.status,
      fullBody: body,
    });

    const isModelNotFound =
      response.status === 404 ||
      body?.code === 'MODEL_NOT_FOUND' ||
      (typeof errorMsg === 'string' &&
        (errorMsg.includes('모델') ||
          errorMsg.includes('model') ||
          errorMsg.includes('NOT_FOUND') ||
          errorMsg.includes('no longer available'))) ||
      (typeof body?.detail === 'string' &&
        (body.detail.includes('model') ||
          body.detail.includes('NOT_FOUND') ||
          body.detail.includes('no longer available')));

    if (isModelNotFound) {
      throw new Error(
        '현재 설정된 AI 모델을 사용할 수 없습니다. 관리자에게 Gemini 모델 설정 확인을 요청해주세요.'
      );
    }

    if (response.status === 401 || response.status === 403) {
      throw new Error(`Gemini API 인증 오류: ${errorMsg}${detailMsg}`);
    }

    if (response.status === 429) {
      throw new Error(`Gemini API 사용량 또는 할당량 초과: ${errorMsg}${detailMsg}`);
    }

    if (response.status === 400) {
      throw new Error(`오디오 또는 Gemini 요청 형식 오류: ${errorMsg}${detailMsg}`);
    }

    if (response.status === 413) {
      throw new Error(`오디오 파일 크기 초과: ${errorMsg}${detailMsg}`);
    }

    if (response.status === 503) {
      throw new Error(`Gemini 서비스 일시 장애 또는 키 미설정: ${errorMsg}${detailMsg}`);
    }

    if (response.status === 500) {
      throw new Error(`서버 내부 오류: ${errorMsg}${detailMsg}`);
    }

    throw new Error(`${errorMsg}${detailMsg}`);
  }

  return body;
}

/**
 * 서버 헬스체크 및 설정 상태 조회
 * @returns {Promise<ApiHealthResponse>}
 */
export async function checkApiHealth(): Promise<ApiHealthResponse> {
  logger.info('checkApiHealth called');
  try {
    const response = await fetch('/api/health');
    return await parseServerResponse(response, '서버 상태 점검');
  } catch (err: any) {
    logger.error('checkApiHealth failed', err);
    throw err;
  }
}

/**
 * 음성 데이터를 서버로 전송하여 화자 분리 대화록 생성 요청
 * - 대용량 오디오의 경우 Vercel 요청 본문 한도(4.5MB) 초과를 방지하기 위해 audioStoragePath를 전달
 * - 사용자 Firebase ID 토큰을 Authorization 헤더에 안전하게 동봉
 * @param {TranscribeRequestPayload} payload 전사 요청 데이터
 * @returns {Promise<TranscriptSegment[]>} 화자별 발언 단위 대화록 배열
 */
export async function requestTranscription(
  payload: TranscribeRequestPayload
): Promise<TranscriptSegment[]> {
  logger.info('requestTranscription called', { meetingId: payload.meetingId });

  // 1. Firebase ID 토큰 취득
  const idToken = await getCurrentUserIdToken();
  if (!idToken) {
    logger.warn('User not authenticated for transcription request');
    throw new Error('[인증 필요 (401)] AI 음성 전사를 사용하려면 먼저 우측 상단에서 Google 계정으로 로그인해주세요.');
  }

  // 2. 요청 본문 및 헤더 구성
  const headers: Record<string, string> = {
    Authorization: `Bearer ${idToken}`,
  };

  const formData = new FormData();
  formData.append('meetingId', payload.meetingId);
  if (payload.audioStoragePath) formData.append('audioStoragePath', payload.audioStoragePath);
  if (payload.audioUrl) formData.append('audioUrl', payload.audioUrl);
  if (payload.meetingTitle) formData.append('meetingTitle', payload.meetingTitle);
  if (payload.agenda) formData.append('agenda', payload.agenda);
  if (payload.attendeeNames) formData.append('attendeeNames', JSON.stringify(payload.attendeeNames));

  // 오디오 Blob이 존재하는 경우 직접 업로드용 audioFile로 항상 첨부 (Vercel 및 로컬 서버에서 최우선으로 즉시 처리)
  if (payload.audioBlob && payload.audioBlob.size <= 45 * 1024 * 1024) {
    formData.append('audioFile', payload.audioBlob, 'recording.webm');
  } else if (!payload.audioStoragePath && payload.audioBlob && payload.audioBlob.size > 45 * 1024 * 1024) {
    throw new Error(
      '파일 크기(45MB 초과)가 너무 큽니다. 오디오 파일을 압축하거나 분할하여 업로드해주세요.'
    );
  }

  try {
    const response = await fetchWithRetry('/api/ai/transcribe', {
      method: 'POST',
      headers,
      body: formData,
    });

    const data = await parseServerResponse(response, 'AI 음성 전사');
    logger.info('Transcription response received', {
      segmentCount: data.transcripts?.length,
      speakerCount: data.speakers?.length,
    });
    return (data.transcripts || []) as TranscriptSegment[];
  } catch (err: any) {
    logger.error('requestTranscription failed', { error: err?.message });
    throw err;
  }
}

/**
 * 대화록 및 회의 정보를 기반으로 AI 요약 및 '구분 / 내용' 양식 생성 요청
 * @param {SummarizeRequestPayload} payload 요약 요청 데이터
 * @returns {Promise<MeetingSummary>} 구조화된 회의 요약
 */
export async function requestMeetingSummary(
  payload: SummarizeRequestPayload
): Promise<MeetingSummary> {
  logger.info('requestMeetingSummary called', {
    meetingId: payload.meetingId,
    transcriptCount: payload.transcripts.length,
  });

  // 1. Firebase ID 토큰 취득
  const idToken = await getCurrentUserIdToken();
  if (!idToken) {
    logger.warn('User not authenticated for summarization request');
    throw new Error('[인증 필요 (401)] AI 회의록 요약을 사용하려면 먼저 우측 상단에서 Google 계정으로 로그인해주세요.');
  }

  try {
    const response = await fetchWithRetry('/api/ai/summarize', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${idToken}`,
      },
      body: JSON.stringify(payload),
    });

    const data = await parseServerResponse(response, 'AI 회의록 요약');
    logger.info('Meeting summary received successfully', { meetingId: payload.meetingId });
    return data.summary as MeetingSummary;
  } catch (err: any) {
    logger.error('requestMeetingSummary failed', { error: err?.message });
    throw err;
  }
}
