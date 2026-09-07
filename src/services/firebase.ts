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
import { getFirestore, Firestore } from 'firebase/firestore';
import { getStorage, FirebaseStorage } from 'firebase/storage';
import { getFirebaseConfig } from '../config/appConfig';
import { AppUser, FirebaseConnectionStatus } from '../types/auth';
import { logger } from '../utils/logger';

let appInstance: FirebaseApp | null = null;
let authInstance: Auth | null = null;
let firestoreInstance: Firestore | null = null;
let storageInstance: FirebaseStorage | null = null;

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
      firestoreConnected: false,
      storageConnected: false,
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
    storageInstance = getStorage(appInstance);

    return {
      isConfigured: true,
      projectId: config.projectId,
      authConnected: true,
      firestoreConnected: true,
      storageConnected: true,
    };
  } catch (error: any) {
    logger.error('Firebase initialization error', { message: error?.message });
    return {
      isConfigured: false,
      authConnected: false,
      firestoreConnected: false,
      storageConnected: false,
      errorMessage: error?.message || 'Firebase 초기화 실패',
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
    if (error.code === 'auth/popup-blocked') {
      throw new Error('팝업 창이 브라우저에 의해 차단되었습니다. 팝업 허용 후 다시 시도해주세요.');
    } else if (error.code === 'auth/popup-closed-by-user') {
      throw new Error('사용자가 로그인 창을 닫았습니다.');
    } else if (error.code === 'auth/unauthorized-domain') {
      throw new Error('Firebase 콘솔의 Authentication > Settings > 승인된 도메인에 현재 호스트 도메인을 등록해야 합니다.');
    }
    throw new Error(error.message || 'Google 로그인 중 오류가 발생했습니다.');
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

/**
 * 현재 Firebase 연결 상태 반환
 */
export function getFirebaseStatus(): FirebaseConnectionStatus {
  return initFirebase();
}

