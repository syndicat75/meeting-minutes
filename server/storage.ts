/**
 * @file server/storage.ts
 * @description Firebase Cloud Storage에 저장된 회의 녹음 오디오를 안전하게 조회 및 다운로드하는 모듈.
 * 임의 URL 호출(SSRF)을 엄격히 차단하고, 허가된 회의 스토리지 경로(meetings/{meetingId}/recordings/*)만 처리합니다.
 */

import { getServerEnv, SERVER_CONFIG } from './config.js';
import { isValidMeetingStoragePath } from './auth.js';

/**
 * 스토리지에서 다운로드된 오디오 데이터 객체
 */
export interface DownloadedAudioData {
  buffer: Buffer;
  mimeType: string;
  sizeBytes: number;
}

/**
 * 회의 녹음 오디오를 Firebase Cloud Storage에서 안전하게 다운로드
 * @param {string} meetingId 회의 고유 ID
 * @param {string} storagePath Firebase Storage 상대 경로
 * @param {string} [audioUrl] 클라이언트가 전달한 Firebase 다운로드 URL (선택)
 * @param {string} [idToken] 사용자 인증 토큰
 * @returns {Promise<DownloadedAudioData>} 다운로드된 오디오 버퍼 및 MIME 정보
 */
export async function downloadMeetingAudioFromStorage(
  meetingId: string,
  storagePath: string,
  audioUrl?: string,
  idToken?: string
): Promise<DownloadedAudioData> {
  console.log('[STORAGE] downloadMeetingAudioFromStorage called', { meetingId, storagePath });

  // 1. Storage 경로 화이트리스트 검증 (SSRF 및 경로 조작 원천 차단)
  if (!isValidMeetingStoragePath(meetingId, storagePath)) {
    const error: any = new Error(
      `허용되지 않은 스토리지 경로입니다: ${storagePath}. 회의(ID: ${meetingId})의 녹음 파일 경로만 접근할 수 있습니다.`
    );
    error.statusCode = 403;
    error.code = 'FORBIDDEN_STORAGE_PATH';
    throw error;
  }

  const { firebaseStorageBucket } = getServerEnv();

  // 2. 다운로드 대상 URL 결정
  let targetUrl: string | null = null;

  if (audioUrl) {
    // audioUrl 검증: 반드시 Firebase Storage 도메인이어야 함
    try {
      const parsedUrl = new URL(audioUrl);
      const allowedHosts = [
        'firebasestorage.googleapis.com',
        'storage.googleapis.com',
        'localhost',
      ];
      if (!allowedHosts.includes(parsedUrl.hostname)) {
        console.warn('[STORAGE] SSRF attempt rejected. Invalid host:', parsedUrl.hostname);
        const error: any = new Error('보안 정책상 Firebase Storage 이외의 외부 URL은 조회할 수 없습니다.');
        error.statusCode = 403;
        error.code = 'SSRF_BLOCKED';
        throw error;
      }
      targetUrl = audioUrl;
    } catch (urlErr) {
      console.warn('[STORAGE] Invalid audioUrl syntax, falling back to REST endpoint', urlErr);
    }
  }

  // audioUrl이 없거나 검증 실패 시 공식 Firebase Storage REST 엔드포인트 구성
  if (!targetUrl && firebaseStorageBucket) {
    targetUrl = `https://firebasestorage.googleapis.com/v0/b/${firebaseStorageBucket}/o/${encodeURIComponent(
      storagePath
    )}?alt=media`;
  }

  if (!targetUrl) {
    const error: any = new Error(
      'Firebase Storage 버킷 정보가 설정되지 않았으며 유효한 오디오 다운로드 경로를 생성할 수 없습니다.'
    );
    error.statusCode = 500;
    error.code = 'STORAGE_CONFIG_MISSING';
    throw error;
  }

  console.log('[STORAGE] Fetching audio from storage endpoint', { targetHost: new URL(targetUrl).hostname });

  const fetchHeaders: Record<string, string> = {};
  if (idToken) {
    fetchHeaders['Authorization'] = `Bearer ${idToken}`;
  }

  const response = await fetch(targetUrl, { headers: fetchHeaders });

  if (!response.ok) {
    console.error('[STORAGE] Audio download failed with status', response.status);
    const error: any = new Error(
      `스토리지에서 오디오 파일을 다운로드하지 못했습니다 (HTTP ${response.status}). 파일이 삭제되었거나 접근 권한이 없습니다.`
    );
    error.statusCode = response.status === 404 ? 404 : 502;
    error.code = response.status === 404 ? 'AUDIO_NOT_FOUND' : 'STORAGE_FETCH_FAILED';
    throw error;
  }

  // 응답 크기 검증
  const contentLength = Number(response.headers.get('content-length')) || 0;
  if (contentLength > SERVER_CONFIG.storageMaxAudioSizeBytes) {
    const error: any = new Error(
      `오디오 파일 크기(최대 200MB)가 초과되었습니다: ${Math.round(contentLength / 1024 / 1024)}MB`
    );
    error.statusCode = 413;
    error.code = 'AUDIO_TOO_LARGE';
    throw error;
  }

  const arrayBuffer = await response.arrayBuffer();
  const buffer = Buffer.from(arrayBuffer);

  let mimeType = response.headers.get('content-type') || '';
  if (!mimeType || mimeType === 'application/octet-stream') {
    // 확장자 기반 MIME 타입 판별
    if (storagePath.endsWith('.mp3')) mimeType = 'audio/mp3';
    else if (storagePath.endsWith('.wav')) mimeType = 'audio/wav';
    else if (storagePath.endsWith('.mp4') || storagePath.endsWith('.m4a')) mimeType = 'audio/mp4';
    else mimeType = 'audio/webm';
  }

  console.log('[STORAGE] Audio downloaded successfully', {
    sizeBytes: buffer.length,
    mimeType,
  });

  return {
    buffer,
    mimeType,
    sizeBytes: buffer.length,
  };
}
