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
 * 404(배포 경로/HTML), 401(인증), 403(권한), 503(키 미설정), 500/502(AI 실패)를 엄격히 구분
 * @param {Response} response fetch 응답 객체
 * @param {string} actionName 수행 중인 작업명
 * @returns {Promise<any>} 파싱된 JSON 데이터
 */
async function parseServerResponse(response: Response, actionName: string): Promise<any> {
  const contentType = response.headers.get('content-type') || '';
  const isHtml = contentType.includes('text/html');

  // 1. 404 Not Found 또는 HTML이 반환된 경우 (Vercel rewrite 누락 또는 SPA index.html 응답)
  if (response.status === 404 || isHtml) {
    logger.error('API endpoint returned 404 or HTML', { status: response.status, contentType });
    throw new Error(
      `[배포 경로 오류 (404)] 서버 API 엔드포인트(/api/ai/...)를 찾을 수 없거나 SPA HTML이 반환되었습니다. Vercel 배포 시 vercel.json rewrite 설정 및 api/index.ts 서버리스 함수가 정상 배포되었는지 확인하세요.`
    );
  }

  let body: any = null;
  try {
    body = await response.json();
  } catch (jsonErr) {
    logger.error('Failed to parse JSON response', jsonErr);
    throw new Error(
      `[응답 파싱 오류] 서버 응답이 올바른 JSON 형식이 아닙니다. (상태 코드: ${response.status})`
    );
  }

  // 2. HTTP 에러 상태별 명확한 분기 처리
  if (!response.ok) {
    const errorCode = body?.error || `HTTP_${response.status}`;
    const errorMsg = body?.message || body?.error || '알 수 없는 서버 오류가 발생했습니다.';

    if (response.status === 401 || errorCode === 'UNAUTHORIZED') {
      throw new Error(
        `[인증 실패 (401)] 로그인이 필요합니다. AI 음성 전사 및 요약 기능을 사용하려면 먼저 우측 상단에서 Google 계정으로 로그인해주세요.`
      );
    }

    if (response.status === 403 || errorCode === 'FORBIDDEN' || errorCode === 'FORBIDDEN_STORAGE_PATH') {
      throw new Error(
        `[권한 오류 (403)] ${errorMsg || '해당 회의록에 대한 편집 권한이 없거나 허용되지 않은 스토리지 경로입니다.'}`
      );
    }

    if (response.status === 503 || errorCode === 'GEMINI_API_KEY_NOT_CONFIGURED') {
      throw new Error(
        `[AI 키 미설정 (503)] 서버에 GEMINI_API_KEY 환경변수가 설정되지 않았습니다. Vercel 프로젝트 Settings > Environment Variables 또는 .env에 GEMINI_API_KEY를 등록해주세요.`
      );
    }

    if (response.status === 502 || errorCode === 'GEMINI_INFERENCE_ERROR') {
      throw new Error(
        `[AI 처리 실패 (502)] Gemini 모델 추론 중 오류: ${errorMsg}`
      );
    }

    throw new Error(`[${actionName} 실패 (코드 ${response.status})] ${errorMsg}`);
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

  // Storage 경로가 없고 직접 오디오 Blob만 존재하는 경우에만 첨부
  // Vercel Serverless 요청 본문 제한(4.5MB) 체크
  if (!payload.audioStoragePath && payload.audioBlob) {
    if (payload.audioBlob.size > 4.5 * 1024 * 1024) {
      throw new Error(
        '4.5MB를 초과하는 대용량 오디오는 Vercel 요청 본문 한도를 초과할 수 있습니다. 먼저 [녹음 완료 및 스토리지 저장]을 진행해주세요.'
      );
    }
    formData.append('audioFile', payload.audioBlob, 'recording.webm');
  }

  try {
    const response = await fetchWithRetry('/api/ai/transcribe', {
      method: 'POST',
      headers,
      body: formData,
    });

    const data = await parseServerResponse(response, 'AI 음성 전사');
    logger.info('Transcription response received', { segmentCount: data.transcripts?.length });
    return data.transcripts as TranscriptSegment[];
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
