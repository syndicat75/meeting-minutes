/**
 * @file src/types/auth.ts
 * @description 사용자 인증 정보, 계정 상태 및 권한 타입 정의
 */

/**
 * 로그인한 사용자 프로필 인터페이스
 */
export interface AppUser {
  uid: string;
  email: string | null;
  displayName: string | null;
  photoURL: string | null;
  isAnonymous?: boolean;
}

/**
 * Firebase 서비스 검증 상태
 */
export type FirebaseVerificationState = 'unconfigured' | 'configured_unverified' | 'verified' | 'error';

/**
 * Google 로그인 상세 오류 안내 인터페이스
 */
export interface AuthErrorInfo {
  code: string;
  title: string;
  message: string;
  solution: string;
  hostname?: string;
  isIframe: boolean;
}

/**
 * Firebase 연결 상태 정보 (설정 등록, 로그인 여부, 실제 서버 접근 검증 구분)
 */
export interface FirebaseConnectionStatus {
  isConfigured: boolean; // apiKey 및 projectId 설정 여부
  projectId?: string;
  authConnected: boolean; // 호환용: authReady
  authReady: boolean; // Auth SDK 초기화 완료
  isAuthenticated: boolean; // 현재 로그인 여부
  firestoreConnected: boolean; // 호환용: firestoreVerified
  firestoreVerified: boolean; // 실제 서버 읽기/쓰기 검증 완료
  storageConnected: boolean; // 호환용: storageConfigured
  storageConfigured: boolean; // 버킷 설정 등록 여부
  verificationState: FirebaseVerificationState;
  verifiedAt?: string;
  errorMessage?: string;
}

