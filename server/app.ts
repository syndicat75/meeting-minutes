/**
 * @file server/app.ts
 * @description Express 애플리케이션 생성 및 미들웨어/라우터 구성 모듈.
 * Vercel Serverless Function(api/index.ts)과 로컬/컨테이너 독립 실행 서버(server.ts)에서 공통으로 사용됩니다.
 */

import express, { Request, Response, NextFunction } from 'express';
import { apiRouter } from './routes.js';

/**
 * Express 애플리케이션 생성 및 설정 함수
 * @returns {express.Application} 설정된 Express 인스턴스
 */
export function createApp(): express.Application {
  console.log('[APP] createApp called');
  const app = express();

  // JSON 및 URL-encoded 요청 본문 파서 설정
  app.use(express.json({ limit: '50mb' }));
  app.use(express.urlencoded({ extended: true, limit: '50mb' }));

  // CORS 및 캐시 제어 기본 헤더 설정
  app.use((req: Request, res: Response, next: NextFunction) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Requested-With');

    if (req.method === 'OPTIONS') {
      res.sendStatus(204);
      return;
    }
    next();
  });

  // Vercel Serverless Function 및 Express 환경 호환을 위해 /api 및 루트 양쪽으로 라우터 마운트
  // Vercel rewrite로 /api prefix가 유지되거나 제거되더라도 동일하게 라우팅 보장
  app.use('/api', apiRouter);
  app.use('/', apiRouter);

  // 미매칭 API 경로 404 핸들러
  app.use('/api/*', (req: Request, res: Response) => {
    console.warn('[APP] 404 Not Found for API path', { path: req.originalUrl });
    res.status(404).json({
      success: false,
      error: `요청하신 API 경로(${req.originalUrl})를 찾을 수 없습니다.`,
      detail: 'NOT_FOUND',
    });
  });

  // Express 전역 에러 핸들러 (절대로 HTML을 반환하지 않고 반드시 JSON만 반환)
  app.use((err: any, req: Request, res: Response, next: NextFunction) => {
    console.error('[APP] Global JSON error handler caught error:', err);
    const statusCode = err.status || err.statusCode || (err.code === 'LIMIT_FILE_SIZE' ? 413 : 500);
    const errorMessage =
      err.code === 'LIMIT_FILE_SIZE'
        ? '업로드 파일 크기가 서버 허용 한도(50MB)를 초과했습니다.'
        : err.message || '서버 내부 오류가 발생했습니다.';

    res.status(statusCode).json({
      success: false,
      error: errorMessage,
      detail: err.detail || err.code || String(err),
    });
  });

  return app;
}

export const app = createApp();
export default app;
