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
 * Firebase 연결 상태 정보
 */
export interface FirebaseConnectionStatus {
  isConfigured: boolean;
  projectId?: string;
  authConnected: boolean;
  firestoreConnected: boolean;
  storageConnected: boolean;
  errorMessage?: string;
}
