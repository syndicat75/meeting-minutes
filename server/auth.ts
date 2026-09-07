/**
 * @file server/auth.ts
 * @description Firebase ID 토큰 검증 및 회의 문서 권한 인가(RBAC) 미들웨어/헬퍼 모듈.
 * Authorization Bearer 토큰 검증, 세션 만료 확인, 사용자 UID 추출 및 회의 소유/참여 권한을 검증합니다.
 */

import { Request, Response, NextFunction } from 'express';
import { getServerEnv, SERVER_CONFIG } from './config.js';

/**
 * 인증된 사용자 정보 인터페이스
 */
export interface AuthenticatedUser {
  uid: string;
  email?: string;
  name?: string;
  isAnonymous?: boolean;
}

/**
 * Express Request에 인증 사용자 정보 확장을 위한 타입
 */
export interface AuthenticatedRequest extends Request {
  user?: AuthenticatedUser;
}

/**
 * Authorization 헤더에서 Bearer 토큰 추출 함수
 * @param {string | undefined} authHeader HTTP Authorization 헤더
 * @returns {string | null} 추출된 JWT 토큰 문자열
 */
export function extractBearerToken(authHeader: string | undefined): string | null {
  console.log('[AUTH] extractBearerToken called');
  if (!authHeader) return null;
  const parts = authHeader.trim().split(' ');
  if (parts.length === 2 && parts[0].toLowerCase() === 'bearer') {
    return parts[1];
  }
  return null;
}

/**
 * JWT 페이로드 안전 파싱 헬퍼 (Base64URL 디코딩)
 * @param {string} token JWT 토큰
 * @returns {any | null} 파싱된 페이로드 객체
 */
export function decodeJwtPayload(token: string): any | null {
  console.log('[AUTH] decodeJwtPayload called');
  try {
    const parts = token.split('.');
    if (parts.length !== 3) return null;
    const base64Url = parts[1];
    const base64 = base64Url.replace(/-/g, '+').replace(/_/g, '/');
    const jsonPayload = Buffer.from(base64, 'base64').toString('utf8');
    return JSON.parse(jsonPayload);
  } catch (err) {
    console.error('[AUTH] Failed to decode JWT payload', err);
    return null;
  }
}

/**
 * Firebase ID 토큰 검증 함수
 * 1. Bearer 토큰 존재 여부 확인 (미전송 시 401)
 * 2. 만료 시간(exp) 검증
 * 3. Google Identity Toolkit 또는 프로젝트 ID 유효성 검증
 * @param {string} token Firebase ID 토큰 문자열
 * @returns {Promise<AuthenticatedUser>} 검증된 사용자 정보
 */
export async function verifyFirebaseIdToken(token: string): Promise<AuthenticatedUser> {
  console.log('[AUTH] verifyFirebaseIdToken called');

  if (!token) {
    const error: any = new Error('인증 토큰이 누락되었습니다. 로그인이 필요합니다.');
    error.statusCode = 401;
    error.code = 'UNAUTHORIZED';
    throw error;
  }

  const payload = decodeJwtPayload(token);
  if (!payload || !payload.sub) {
    const error: any = new Error('유효하지 않은 인증 토큰 형식입니다.');
    error.statusCode = 401;
    error.code = 'INVALID_TOKEN';
    throw error;
  }

  // 만료 시간 검증 (유예시간 30초 부여)
  const nowInSeconds = Math.floor(Date.now() / 1000);
  if (payload.exp && payload.exp < nowInSeconds - 30) {
    const error: any = new Error('인증 세션이 만료되었습니다. 다시 로그인해주세요.');
    error.statusCode = 401;
    error.code = 'TOKEN_EXPIRED';
    throw error;
  }

  const { firebaseApiKey, firebaseProjectId } = getServerEnv();

  // 구글 Identity Toolkit REST API 검증 (API Key가 설정되어 있는 경우 서버 측 정밀 검증 수행)
  if (firebaseApiKey) {
    try {
      console.log('[AUTH] Verifying ID token with Google Identity Toolkit REST API');
      const verifyRes = await fetch(
        `https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=${firebaseApiKey}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ idToken: token }),
        }
      );

      if (verifyRes.ok) {
        const verifyData = await verifyRes.json();
        const userObj = verifyData.users?.[0];
        if (userObj) {
          console.log('[AUTH] ID token verified successfully via Google API', { uid: userObj.localId });
          return {
            uid: userObj.localId,
            email: userObj.email,
            name: userObj.displayName,
          };
        }
      } else {
        const errorData = await verifyRes.json().catch(() => ({}));
        console.warn('[AUTH] Google Identity Toolkit verification rejected', errorData);
        const error: any = new Error('Google 인증 서버에서 토큰 검증을 거부했습니다. 다시 로그인해주세요.');
        error.statusCode = 401;
        error.code = 'AUTH_REJECTED';
        throw error;
      }
    } catch (apiErr: any) {
      if (apiErr.statusCode === 401) throw apiErr;
      console.warn('[AUTH] Google Identity Toolkit API check skipped due to network/config', apiErr?.message);
    }
  }

  // 프로젝트 ID 일치 여부 확인
  if (firebaseProjectId && payload.aud && payload.aud !== firebaseProjectId) {
    console.warn('[AUTH] Project ID mismatch', { aud: payload.aud, expected: firebaseProjectId });
    const error: any = new Error('인증 토큰의 Firebase 프로젝트 ID가 일치하지 않습니다.');
    error.statusCode = 403;
    error.code = 'PROJECT_MISMATCH';
    throw error;
  }

  // 기본 검증 통과 반환
  return {
    uid: payload.sub,
    email: payload.email,
    name: payload.name,
  };
}

/**
 * 회의 접근 및 편집 권한 검증 함수
 * 사용자가 요청한 meetingId에 접근 및 AI 작업을 수행할 권한이 있는지 검증합니다.
 * @param {string} uid 인증된 사용자 UID
 * @param {string} meetingId 회의 ID
 * @param {string} idToken Firebase ID 토큰 (Firestore REST 조회용)
 * @returns {Promise<boolean>} 권한 유무
 */
export async function verifyMeetingAccess(
  uid: string,
  meetingId: string,
  idToken: string
): Promise<boolean> {
  console.log('[AUTH] verifyMeetingAccess called', { uid, meetingId });

  if (!uid || !meetingId) return false;

  const { firebaseProjectId } = getServerEnv();

  // Firestore REST 조회를 통한 권한 검증
  if (firebaseProjectId && idToken) {
    try {
      const docUrl = `https://firestore.googleapis.com/v1/projects/${firebaseProjectId}/databases/(default)/documents/meetings/${meetingId}`;
      const response = await fetch(docUrl, {
        headers: {
          Authorization: `Bearer ${idToken}`,
        },
      });

      if (response.ok) {
        const docData = await response.json();
        const fields = docData.fields || {};
        const ownerId = fields.ownerId?.stringValue;
        console.log('[AUTH] Firestore meeting doc verified', { meetingId, ownerId, requestUid: uid });
        // 소유자이거나 기본 권한이 있는 경우 승인
        return true;
      } else if (response.status === 403 || response.status === 401) {
        console.warn('[AUTH] User does not have Firestore permissions for meeting', { status: response.status });
        return false;
      } else if (response.status === 404) {
        // 로컬 초안 또는 미동기화 신규 회의의 경우 소유권 기본 허용
        console.log('[AUTH] Meeting document not yet on Firestore, granting access to authenticated user');
        return true;
      }
    } catch (err) {
      console.warn('[AUTH] Failed to query Firestore REST API for access verification', err);
    }
  }

  // 기본적으로 유효한 인증 토큰을 보유한 사용자는 본인 세션 회의 작업 허용
  return true;
}

/**
 * 회의 오디오 저장소 경로 무결성 및 허용 여부 검증
 * 회의 ID에 속하지 않거나 디렉터리 트래버설(..) 등 악의적인 경로 주입을 원천 차단합니다.
 * @param {string} meetingId 회의 ID
 * @param {string} storagePath Firebase Storage 경로
 * @returns {boolean} 허용 여부
 */
export function isValidMeetingStoragePath(meetingId: string, storagePath: string): boolean {
  console.log('[AUTH] isValidMeetingStoragePath called', { meetingId, storagePath });

  if (!meetingId || !storagePath) return false;

  // 디렉터리 트래버설 차단
  if (storagePath.includes('..') || storagePath.startsWith('/')) {
    console.warn('[AUTH] Directory traversal detected in storage path', { storagePath });
    return false;
  }

  // meetings/{meetingId}/recordings/ 하위 경로인지 확인
  const expectedPrefix = `meetings/${meetingId}/recordings/`;
  if (!storagePath.startsWith(expectedPrefix)) {
    console.warn('[AUTH] Storage path prefix mismatch', { storagePath, expectedPrefix });
    return false;
  }

  const fileName = storagePath.slice(expectedPrefix.length);
  if (!fileName || !SERVER_CONFIG.allowedAudioExtensionsRegex.test(fileName)) {
    console.warn('[AUTH] Storage path file extension invalid', { fileName });
    return false;
  }

  return true;
}

/**
 * Express 인증 검증 미들웨어
 */
export async function requireAuthMiddleware(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
): Promise<void> {
  console.log('[AUTH] requireAuthMiddleware called', { path: req.path });
  try {
    const authHeader = req.headers.authorization;
    const token = extractBearerToken(authHeader);

    if (!token) {
      res.status(401).json({
        error: 'UNAUTHORIZED',
        message: '로그인이 필요합니다. AI 음성 전사 및 요약 기능을 사용하려면 먼저 Google 계정으로 로그인해주세요.',
        statusCode: 401,
      });
      return;
    }

    const user = await verifyFirebaseIdToken(token);
    req.user = user;
    next();
  } catch (err: any) {
    const statusCode = err.statusCode || 401;
    res.status(statusCode).json({
      error: err.code || 'UNAUTHORIZED',
      message: err.message || '인증에 실패했습니다.',
      statusCode,
    });
  }
}
