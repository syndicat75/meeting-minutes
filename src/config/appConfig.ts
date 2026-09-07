/**
 * @file src/config/appConfig.ts
 * @description 애플리케이션 전체 설정 집중 관리 파일 (Firebase 클라이언트 설정, AI 모델명, 파일 한도 등)
 */

import { logger } from '../utils/logger';

/**
 * Firebase 웹 클라이언트 환경설정 인터페이스
 */
export interface FirebaseClientConfig {
  apiKey: string;
  authDomain: string;
  projectId: string;
  storageBucket: string;
  messagingSenderId: string;
  appId: string;
  measurementId?: string;
}

/**
 * AI 모델 및 오디오 파라미터 설정 인터페이스
 */
export interface AiModelConfig {
  transcriptionModel: string;
  summaryModel: string;
  maxAudioMinutes: number;
  maxAudioSizeBytes: number;
  maxPhotoSizeBytes: number;
}

/**
 * 로컬스토리지 키 정의
 */
export const STORAGE_KEYS = {
  MEETINGS_FALLBACK: 'ai_meeting_notes_local_meetings',
  FIREBASE_CONFIG_OVERRIDE: 'ai_meeting_firebase_config_override',
  CURRENT_USER_PROFILE: 'ai_meeting_current_user',
  APP_THEME: 'ai_meeting_theme_pref',
};

/**
 * 환경 변수 또는 로컬 오버라이드에서 Firebase 설정을 로드하는 함수
 * @returns {FirebaseClientConfig | null} Firebase 설정 객체 또는 미설정 시 null
 */
export function getFirebaseConfig(): FirebaseClientConfig | null {
  logger.info('getFirebaseConfig called');

  // 1. 브라우저 localStorage 사용자 직접 입력 오버라이드 확인
  try {
    const override = localStorage.getItem(STORAGE_KEYS.FIREBASE_CONFIG_OVERRIDE);
    if (override) {
      const parsed = JSON.parse(override) as FirebaseClientConfig;
      if (parsed.apiKey && parsed.projectId) {
        logger.info('Firebase config loaded from localStorage override');
        return parsed;
      }
    }
  } catch (e) {
    logger.warn('Failed to parse localStorage firebase config override', { error: String(e) });
  }

  // 2. Vite 환경 변수 확인 (VITE_FIREBASE_*)
  const env = (import.meta as any).env || {};
  const apiKey = env.VITE_FIREBASE_API_KEY || '';
  const authDomain = env.VITE_FIREBASE_AUTH_DOMAIN || '';
  const projectId = env.VITE_FIREBASE_PROJECT_ID || '';
  const storageBucket = env.VITE_FIREBASE_STORAGE_BUCKET || '';
  const messagingSenderId = env.VITE_FIREBASE_MESSAGING_SENDER_ID || '';
  const appId = env.VITE_FIREBASE_APP_ID || '';
  const measurementId = env.VITE_FIREBASE_MEASUREMENT_ID || '';

  if (apiKey && projectId) {
    logger.info('Firebase config loaded from import.meta.env');
    return {
      apiKey,
      authDomain: authDomain || `${projectId}.firebaseapp.com`,
      projectId,
      storageBucket: storageBucket || `${projectId}.firebasestorage.app`,
      messagingSenderId,
      appId,
      measurementId,
    };
  }

  logger.info('No active Firebase config detected (Fallback mode available)');
  return null;
}

/**
 * 전사 및 요약에 사용할 AI 모델 및 한도 설정
 * 공식 확인된 안정 모델: gemini-2.5-flash
 */
export const APP_CONFIG = {
  appName: 'AI 회의록 관리',
  version: '1.0.0',
  defaultMeetingTitle: '남부권역 위험성평가 위원회',
  
  ai: {
    // 음성 전사 모델 (공식 안정 모델)
    transcriptionModel: 'gemini-2.5-flash',
    // 요약 및 양식 생성 모델
    summaryModel: 'gemini-2.5-flash',
    // 백오프 재시도 설정
    maxRetries: 3,
    initialRetryDelayMs: 2000,
  },

  limits: {
    // 회의당 최대 녹음 시간: 120분 (초 단위)
    maxRecordingDurationSeconds: 120 * 60,
    // 파일 업로드 용량 제한: 200MB (바이트 단위)
    maxRecordingFileSizeBytes: 200 * 1024 * 1024,
    // 회의 사진 최대 용량: 15MB (바이트 단위)
    maxPhotoFileSizeBytes: 15 * 1024 * 1024,
    // 지원 오디오 형식
    supportedAudioMimeTypes: [
      'audio/webm',
      'audio/webm;codecs=opus',
      'audio/mp4',
      'audio/m4a',
      'audio/wav',
      'audio/x-wav',
      'audio/mpeg',
      'audio/mp3',
      'audio/ogg',
    ],
  },
};
