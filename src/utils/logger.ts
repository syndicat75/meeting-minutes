/**
 * @file src/utils/logger.ts
 * @description 애플리케이션 공통 로깅 유틸리티.
 * 민감 정보(녹음 원문 오디오 데이터, 서명 Base64/바이너리, 인증 토큰, API 키)는 마스킹하거나 제거하여 안전하게 로깅합니다.
 */

export interface LogContext {
  [key: string]: unknown;
}

/**
 * 민감 정보를 안전하게 마스킹/필터링하는 함수
 * @param obj 검사할 로그 컨텍스트 객체
 * @returns 민감 정보가 정제된 객체
 */
function sanitizeLogPayload(obj: unknown): unknown {
  if (obj === null || obj === undefined) return obj;
  if (typeof obj !== 'object') return obj;

  if (Array.isArray(obj)) {
    return obj.map(item => sanitizeLogPayload(item));
  }

  const sanitized: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(obj as Record<string, unknown>)) {
    const lowerKey = key.toLowerCase();
    // 민감 정보 필드 마스킹
    if (
      lowerKey.includes('token') ||
      lowerKey.includes('apikey') ||
      lowerKey.includes('api_key') ||
      lowerKey.includes('secret') ||
      lowerKey.includes('password')
    ) {
      sanitized[key] = '***REDACTED_SECRET***';
    } else if (lowerKey.includes('signaturedataurl') || lowerKey.includes('dataurl') || lowerKey.includes('base64')) {
      sanitized[key] = typeof value === 'string' ? `[DATA_URL_LENGTH: ${value.length}]` : '[DATA_URL_REDACTED]';
    } else if (lowerKey.includes('rawaudio') || lowerKey.includes('audioblob') || lowerKey.includes('buffer')) {
      sanitized[key] = '[AUDIO_BLOB_REDACTED]';
    } else {
      sanitized[key] = sanitizeLogPayload(value);
    }
  }
  return sanitized;
}

/**
 * 애플리케이션 로거 객체
 */
export const logger = {
  /**
   * 정보 로그 기록
   * @param message 메시지
   * @param context 추가 컨텍스트
   */
  info(message: string, context?: LogContext): void {
    const timestamp = new Date().toISOString();
    if (context) {
      console.log(`[INFO] [${timestamp}] ${message}`, sanitizeLogPayload(context));
    } else {
      console.log(`[INFO] [${timestamp}] ${message}`);
    }
  },

  /**
   * 경고 로그 기록
   * @param message 메시지
   * @param context 추가 컨텍스트
   */
  warn(message: string, context?: LogContext): void {
    const timestamp = new Date().toISOString();
    if (context) {
      console.warn(`[WARN] [${timestamp}] ${message}`, sanitizeLogPayload(context));
    } else {
      console.warn(`[WARN] [${timestamp}] ${message}`);
    }
  },

  /**
   * 에러 로그 기록
   * @param message 메시지
   * @param error 에러 객체 또는 컨텍스트
   */
  error(message: string, error?: unknown): void {
    const timestamp = new Date().toISOString();
    if (error) {
      console.error(`[ERROR] [${timestamp}] ${message}`, sanitizeLogPayload(error));
    } else {
      console.error(`[ERROR] [${timestamp}] ${message}`);
    }
  },

  /**
   * 디버그 로그 기록
   * @param message 메시지
   * @param context 추가 컨텍스트
   */
  debug(message: string, context?: LogContext): void {
    const timestamp = new Date().toISOString();
    if (context) {
      console.debug(`[DEBUG] [${timestamp}] ${message}`, sanitizeLogPayload(context));
    } else {
      console.debug(`[DEBUG] [${timestamp}] ${message}`);
    }
  },
};
