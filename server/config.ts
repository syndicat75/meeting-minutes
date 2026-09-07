/**
 * @file server/config.ts
 * @description AI 회의록 백엔드 서버 설정 파일.
 * 모델명, 타임아웃, 업로드 파일 용량 제한, 환경변수 접근 및 에러 코드를 집중 관리합니다.
 */

import dotenv from 'dotenv';
dotenv.config();

/**
 * 서버 전역 설정 상수 객체
 */
export const SERVER_CONFIG = {
  // AI 우선 및 Fallback 공급자 설정 ('openai' | 'gemini')
  primaryProvider: process.env.AI_PRIMARY_PROVIDER || 'openai',
  fallbackProvider: process.env.AI_FALLBACK_PROVIDER || 'gemini',

  // OpenAI 전사 모델 (공식 화자 분리 Diarization 지원 모델)
  openaiTranscribeModel: process.env.OPENAI_TRANSCRIBE_MODEL || 'gpt-4o-transcribe-diarize',

  // OpenAI 회의 요약 모델 (회의 요약, 결정사항, 액션아이템 추출용)
  openaiSummaryModel: process.env.OPENAI_SUMMARY_MODEL || 'gpt-4o-mini',

  // OpenAI 문맥 검토 및 오타 교정 모델 (별도 텍스트 모델 분리)
  openaiCorrectionModel: process.env.OPENAI_CORRECTION_MODEL || 'gpt-4o-mini',

  // Gemini AI 모델 (Gemini 3.6 Flash: 최신 안정 모델, GEMINI_MODEL 환경변수로 재지정 가능)
  geminiModel: process.env.GEMINI_MODEL || 'gemini-3.6-flash',

  // 지원 및 허용되는 최신 fallback 모델 목록 (구형 gemini-2.5-flash 배제)
  fallbackModels: [process.env.GEMINI_MODEL || 'gemini-3.6-flash'],

  // 포트 번호 (Cloud Run 및 로컬 개발 환경용)
  port: 3000,

  // Vercel Serverless 요청 본문 제한 (4.5MB)
  // 대용량 오디오는 본문으로 전송하지 않고 Firebase Storage에 선업로드 후 경로 전달
  vercelMaxBodySizeBytes: 4.5 * 1024 * 1024,

  // 오디오 메모리 업로드 허용 최대 한도 (단기 오디오 직접 업로드 테스트용)
  directUploadLimitBytes: 15 * 1024 * 1024, // 15MB

  // 회의 오디오 최대 허용 용량 (Storage 기준: 200MB)
  storageMaxAudioSizeBytes: 200 * 1024 * 1024,

  // 서버리스 함수 최대 실행 시간 (초)
  serverlessTimeoutSeconds: 60,

  // 허용되는 오디오 MIME 타입 목록
  allowedAudioMimeTypes: [
    'audio/webm',
    'audio/mp4',
    'audio/mpeg',
    'audio/mp3',
    'audio/wav',
    'audio/x-wav',
    'audio/ogg',
    'audio/m4a',
    'audio/x-m4a',
    'video/webm', // 일부 브라우저 MediaRecorder webm 컨테이너
  ],

  // 허용되는 오디오 파일 확장자 정규식
  allowedAudioExtensionsRegex: /\.(webm|mp4|m4a|wav|mp3|ogg)$/i,
};

/**
 * 서버 전용 환경 변수 취득 헬퍼
 * 클라이언트에 노출되지 않는 백엔드 전용 환경변수를 안전하게 조회합니다.
 * @returns {Record<string, string | undefined>}
 */
export function getServerEnv(): {
  openaiApiKey: string | undefined;
  openaiTranscribeModel: string;
  openaiSummaryModel: string;
  openaiCorrectionModel: string;
  primaryProvider: string;
  fallbackProvider: string;
  geminiApiKey: string | undefined;
  geminiModel: string;
  firebaseProjectId: string | undefined;
  firebaseStorageBucket: string | undefined;
  firebaseApiKey: string | undefined;
} {
  console.log('[CONFIG] getServerEnv called');
  return {
    openaiApiKey: process.env.OPENAI_API_KEY,
    openaiTranscribeModel: process.env.OPENAI_TRANSCRIBE_MODEL || SERVER_CONFIG.openaiTranscribeModel,
    openaiSummaryModel: process.env.OPENAI_SUMMARY_MODEL || SERVER_CONFIG.openaiSummaryModel,
    openaiCorrectionModel: process.env.OPENAI_CORRECTION_MODEL || SERVER_CONFIG.openaiCorrectionModel,
    primaryProvider: process.env.AI_PRIMARY_PROVIDER || SERVER_CONFIG.primaryProvider,
    fallbackProvider: process.env.AI_FALLBACK_PROVIDER || SERVER_CONFIG.fallbackProvider,
    geminiApiKey: process.env.GEMINI_API_KEY,
    geminiModel: process.env.GEMINI_MODEL || SERVER_CONFIG.geminiModel,
    firebaseProjectId: process.env.FIREBASE_PROJECT_ID || process.env.VITE_FIREBASE_PROJECT_ID,
    firebaseStorageBucket: process.env.FIREBASE_STORAGE_BUCKET || process.env.VITE_FIREBASE_STORAGE_BUCKET,
    firebaseApiKey: process.env.FIREBASE_API_KEY || process.env.VITE_FIREBASE_API_KEY,
  };
}

/**
 * API 공통 표준 에러 응답 인터페이스
 */
export interface ApiErrorResponse {
  error: string;
  message: string;
  details?: string;
  statusCode: number;
}
