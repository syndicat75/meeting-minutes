/**
 * @file src/services/firebase.ts
 * @description Firebase 클라이언트 SDK 초기화, Google 인증 제공자 및 Firestore/Storage 인스턴스 래퍼.
 * 설정 누락 시 명확한 상태를 반환하여 사용자가 설정 화면에서 프로젝트를 구성할 수 있도록 지원합니다.
 */

import { initializeApp, getApps, getApp, FirebaseApp } from 'firebase/app';
import {
  getAuth,
  GoogleAuthProvider,
  signInWithPopup,
  signOut as fbSignOut,
  onAuthStateChanged as fbOnAuthStateChanged,
  User as FbUser,
  Auth,
} from 'firebase/auth';
import { getFirestore, Firestore, doc, getDoc } from 'firebase/firestore';
import { getStorage, FirebaseStorage, ref, getDownloadURL } from 'firebase/storage';
import { getFirebaseConfig } from '../config/appConfig';
import { AppUser, FirebaseConnectionStatus, AuthErrorInfo } from '../types/auth';
import { logger } from '../utils/logger';

let appInstance: FirebaseApp | null = null;
let authInstance: Auth | null = null;
let firestoreInstance: Firestore | null = null;
let storageInstance: FirebaseStorage | null = null;

let isFirestoreVerified = false;
let verifiedTimestamp: string | undefined = undefined;

/**
 * Firebase 인증 오류를 사용자가 이해하기 쉬운 한국어 진단 정보로 변환
 * @param error 발생한 에러 객체
 * @returns {AuthErrorInfo} 구조화된 오류 안내 객체
 */
export function parseFirebaseAuthError(error: any): AuthErrorInfo {
  logger.info('parseFirebaseAuthError called', { code: error?.code, message: error?.message });

  const code = error?.code || 'unknown';
  const rawMessage = error?.message || '로그인 중 오류가 발생했습니다.';
  const hostname = typeof window !== 'undefined' ? window.location.hostname : '알 수 없음';
  const isIframe = typeof window !== 'undefined' && window.self !== window.top;

  switch (code) {
    case 'auth/unauthorized-domain':
      return {
        code,
        title: '승인되지 않은 도메인 (Unauthorized Domain)',
        message: `현재 접속 도메인('${hostname}')이 Firebase 인증 승인 목록에 등록되지 않았습니다.`,
        solution: `Firebase 콘솔 > [Authentication] > [설정(Settings)] > [승인된 도메인(Authorized domains)]으로 이동하여 '${hostname}'을 추가해주세요.`,
        hostname,
        isIframe,
      };

    case 'auth/operation-not-allowed':
      return {
        code,
        title: 'Google 로그인 제공업체 비활성화',
        message: 'Firebase 프로젝트에서 Google 로그인 기능이 활성화되어 있지 않습니다.',
        solution: 'Firebase 콘솔 > [Authentication] > [Sign-in method] 탭에서 "Google"을 선택하고 [사용 설정]을 저장해주세요.',
        hostname,
        isIframe,
      };

    case 'auth/configuration-not-found':
      return {
        code,
        title: 'Authentication 초기 설정 필요',
        message: 'Firebase 프로젝트에 Authentication 서비스가 아직 초기화되지 않았습니다.',
        solution: 'Firebase 콘솔에서 [Authentication] 메뉴로 이동하여 [시작하기] 버튼을 누른 후 Google 공급업체를 설정해주세요.',
        hostname,
        isIframe,
      };

    case 'auth/invalid-api-key':
      return {
        code,
        title: '잘못된 Firebase API 키',
        message: '등록된 Firebase apiKey가 유효하지 않습니다.',
        solution: 'Firebase 콘솔 [프로젝트 설정]의 웹 앱 구성에서 올바른 apiKey를 확인해 등록해주세요. (주의: Gemini API 키와 혼동하지 마세요)',
        hostname,
        isIframe,
      };

    case 'auth/popup-blocked':
      return {
        code,
        title: '로그인 팝업 창 차단됨',
        message: isIframe
          ? 'AI Studio 미리보기(iframe) 환경에서는 브라우저 보안 정책에 의해 Google 로그인 팝업이 차단될 수 있습니다.'
          : '브라우저 설정에 의해 로그인 팝업 창이 차단되었습니다.',
        solution: isIframe
          ? '상단 브라우저 주소창에서 팝업을 허용하거나, 상단의 [새 탭에서 열기] 아이콘을 눌러 새 창에서 실행해주세요.'
          : '주소창 우측의 팝업 차단 해제 아이콘을 눌러 팝업을 허용해주세요.',
        hostname,
        isIframe,
      };

    case 'auth/popup-closed-by-user':
      return {
        code,
        title: '로그인 창이 닫힘',
        message: '사용자가 로그인 팝업 창을 완료 전에 닫았습니다.',
        solution: '로그인을 계속하시려면 다시 [Google 로그인] 버튼을 눌러주세요.',
        hostname,
        isIframe,
      };

    case 'auth/network-request-failed':
      return {
        code,
        title: '네트워크 연결 실패',
        message: 'Firebase 서버와 통신할 수 없습니다.',
        solution: '인터넷 연결 상태, 사내 방화벽 또는 광고/트래커 차단 프로그램(AdBlock 등) 설정을 확인해주세요.',
        hostname,
        isIframe,
      };

    default:
      return {
        code,
        title: 'Google 로그인 오류',
        message: rawMessage,
        solution: 'Firebase 프로젝트 설정과 브라우저 콘솔 오류 로그를 확인해주세요.',
        hostname,
        isIframe,
      };
  }
}

/**
 * Firebase 클라이언트 인스턴스 초기화
 * @returns {FirebaseConnectionStatus} 연결 상태 객체
 */
export function initFirebase(): FirebaseConnectionStatus {
  logger.info('initFirebase called');
  const config = getFirebaseConfig();

  if (!config || !config.apiKey || !config.projectId) {
    logger.warn('Firebase configuration is missing or incomplete');
    return {
      isConfigured: false,
      authConnected: false,
      authReady: false,
      isAuthenticated: false,
      firestoreConnected: false,
      firestoreVerified: false,
      storageConnected: false,
      storageConfigured: false,
      verificationState: 'unconfigured',
      errorMessage: 'Firebase 환경변수 또는 설정이 등록되지 않았습니다.',
    };
  }

  try {
    if (!getApps().length) {
      appInstance = initializeApp(config);
      logger.info('Firebase app initialized successfully', { projectId: config.projectId });
    } else {
      appInstance = getApp();
    }

    authInstance = getAuth(appInstance);
    firestoreInstance = getFirestore(appInstance);
    // storageBucket 명시 바인딩 (gs:// 중복 접두사 방지 및 안전한 버킷 바인딩)
    const cleanBucket = config.storageBucket ? config.storageBucket.replace(/^gs:\/\//, '').trim() : '';
    storageInstance = cleanBucket ? getStorage(appInstance, `gs://${cleanBucket}`) : getStorage(appInstance);

    const isAuthed = Boolean(authInstance?.currentUser);

    return {
      isConfigured: true,
      projectId: config.projectId,
      authConnected: Boolean(authInstance),
      authReady: Boolean(authInstance),
      isAuthenticated: isAuthed,
      firestoreConnected: isFirestoreVerified,
      firestoreVerified: isFirestoreVerified,
      storageConnected: Boolean(config.storageBucket),
      storageConfigured: Boolean(config.storageBucket),
      verificationState: isFirestoreVerified ? 'verified' : 'configured_unverified',
      verifiedAt: verifiedTimestamp,
    };
  } catch (error: any) {
    logger.error('Firebase initialization error', { message: error?.message });
    return {
      isConfigured: false,
      authConnected: false,
      authReady: false,
      isAuthenticated: false,
      firestoreConnected: false,
      firestoreVerified: false,
      storageConnected: false,
      storageConfigured: false,
      verificationState: 'error',
      errorMessage: error?.message || 'Firebase 초기화 실패',
    };
  }
}

/**
 * 실제 Cloud Firestore 서버 접근성 검증 (Health Check)
 * SDK 객체 생성만으로 '연결됨'으로 오판하지 않도록 실제 테스트 조회를 수행합니다.
 */
export async function testFirestoreConnection(): Promise<{ success: boolean; message: string }> {
  logger.info('testFirestoreConnection called');
  const db = getFirebaseDb();
  if (!db) {
    return { success: false, message: 'Firebase 설정이 등록되지 않았습니다.' };
  }

  try {
    // 실제 서버 통신 테스트: 시스템 핑 문서 조회
    const pingDoc = doc(db, '_connection_test', 'ping');
    await getDoc(pingDoc);
    isFirestoreVerified = true;
    verifiedTimestamp = new Date().toISOString();
    logger.info('Firestore server access verified successfully');
    return { success: true, message: 'Cloud Firestore 서버 접근이 성공적으로 검증되었습니다.' };
  } catch (err: any) {
    logger.warn('Firestore test connection failed', { error: err?.message, code: err?.code });
    if (err?.code === 'permission-denied') {
      // 보안 규칙으로 거부된 것은 서버 자체에는 도달했음을 의미하므로 규칙 안내
      isFirestoreVerified = true;
      verifiedTimestamp = new Date().toISOString();
      return {
        success: true,
        message: 'Firestore 서버에 연결되었으나 현재 보안 규칙상 로그인이 필요합니다.',
      };
    }
    isFirestoreVerified = false;
    return {
      success: false,
      message: `서버 통신 실패 (${err?.code || '오류'}): ${err?.message || '네트워크 확인 필요'}`,
    };
  }
}

/**
 * 실제 Firebase Storage 접근성 검증 (Health Check)
 * 프로젝트에 Storage 버킷이 활성화되어 있는지 확인
 */
export async function testStorageConnection(): Promise<{ success: boolean; message: string }> {
  logger.info('testStorageConnection called');
  const storage = getFirebaseStorageInstance();
  if (!storage) {
    return { success: false, message: 'Firebase Storage 설정이 등록되지 않았습니다.' };
  }

  try {
    const testRef = ref(storage, '_connection_test/ping.txt');
    await getDownloadURL(testRef).catch((err: any) => {
      // 404 (object-not-found)는 버킷 자체는 정상 존재함을 의미
      if (err?.code === 'storage/object-not-found') {
        return 'exists';
      }
      // 403 (unauthorized)도 버킷은 존재하나 보안 규칙에 의해 거절됨을 의미
      if (err?.code === 'storage/unauthorized') {
        return 'unauthorized';
      }
      throw err;
    });

    logger.info('Storage connection verified');
    return { success: true, message: 'Firebase Storage 버킷이 정상 활성화되어 있습니다.' };
  } catch (err: any) {
    logger.warn('Storage test connection failed', { error: err?.message, code: err?.code });
    if (err?.code === 'storage/bucket-not-found' || err?.code === 'storage/project-not-found') {
      return {
        success: false,
        message: 'Firebase Storage 버킷을 찾을 수 없습니다. Firebase 콘솔에서 Storage 생성을 완료해주세요.',
      };
    }
    return {
      success: false,
      message: `Storage 연결 확인 실패 (${err?.code || '오류'}): ${err?.message || '버킷 설정 확인 필요'}`,
    };
  }
}

/**
 * 현재 활성화된 Auth 인스턴스 반환
 */
export function getFirebaseAuth(): Auth | null {
  if (!authInstance) initFirebase();
  return authInstance;
}

/**
 * 현재 활성화된 Firestore 인스턴스 반환
 */
export function getFirebaseDb(): Firestore | null {
  if (!firestoreInstance) initFirebase();
  return firestoreInstance;
}

/**
 * 현재 활성화된 Storage 인스턴스 반환
 */
export function getFirebaseStorageInstance(): FirebaseStorage | null {
  if (!storageInstance) initFirebase();
  return storageInstance;
}

/**
 * Google 팝업 로그인 실행
 * @returns {Promise<AppUser>} 로그인된 사용자 객체
 */
export async function signInWithGoogle(): Promise<AppUser> {
  logger.info('signInWithGoogle called');
  const auth = getFirebaseAuth();

  if (!auth) {
    const errorMsg = 'Firebase가 아직 설정되지 않았습니다. 상단 우측 [Firebase 설정] 버튼을 눌러 프로젝트 정보를 등록해주세요.';
    logger.error(errorMsg);
    throw new Error(errorMsg);
  }

  const provider = new GoogleAuthProvider();
  provider.setCustomParameters({ prompt: 'select_account' });

  try {
    const result = await signInWithPopup(auth, provider);
    const fbUser = result.user;
    logger.info('Google sign-in successful', { uid: fbUser.uid, email: fbUser.email });
    return {
      uid: fbUser.uid,
      email: fbUser.email,
      displayName: fbUser.displayName,
      photoURL: fbUser.photoURL,
    };
  } catch (error: any) {
    logger.error('signInWithGoogle failed', { errorCode: error.code, errorMessage: error.message });
    throw error;
  }
}

/**
 * 로그아웃 실행
 */
export async function logoutUser(): Promise<void> {
  logger.info('logoutUser called');
  const auth = getFirebaseAuth();
  if (auth) {
    await fbSignOut(auth);
    logger.info('User logged out');
  }
}

/**
 * 인증 상태 변경 리스너 등록
 * @param callback 사용자 상태 변경 콜백
 * @returns 리스너 해제 함수
 */
export function subscribeAuthState(callback: (user: AppUser | null) => void): () => void {
  logger.info('subscribeAuthState called');
  const auth = getFirebaseAuth();

  if (!auth) {
    logger.warn('Auth instance unavailable during subscribeAuthState');
    callback(null);
    return () => {};
  }

  return fbOnAuthStateChanged(auth, (fbUser: FbUser | null) => {
    if (fbUser) {
      logger.info('Auth state changed: Logged in', { uid: fbUser.uid, email: fbUser.email });
      callback({
        uid: fbUser.uid,
        email: fbUser.email,
        displayName: fbUser.displayName,
        photoURL: fbUser.photoURL,
      });
    } else {
      logger.info('Auth state changed: Logged out');
      callback(null);
    }
  });
}

export const subscribeAuthChanges = subscribeAuthState;
export const loginWithGoogle = signInWithGoogle;
export const getFirestoreInstance = getFirebaseDb;
export const getFirebaseIdToken = getCurrentUserIdToken;

/**
 * 현재 로그인된 사용자의 Firebase ID 토큰을 취득하는 헬퍼 함수
 * @param {boolean} [forceRefresh=false] 토큰 강제 갱신 여부
 * @returns {Promise<string | null>} 유효한 JWT ID 토큰 또는 미로그인 시 null
 */
export async function getCurrentUserIdToken(forceRefresh: boolean = false): Promise<string | null> {
  logger.info('getCurrentUserIdToken called', { forceRefresh });
  const auth = getFirebaseAuth();
  if (!auth || !auth.currentUser) {
    logger.warn('No active Firebase user logged in');
    return null;
  }

  try {
    const token = await auth.currentUser.getIdToken(forceRefresh);
    logger.info('Firebase ID token acquired successfully');
    return token;
  } catch (err: any) {
    logger.error('Failed to get Firebase ID token', err);
    return null;
  }
}

/**
 * 현재 Firebase 연결 상태 반환
 */
export function getFirebaseStatus(): FirebaseConnectionStatus {
  return initFirebase();
}


