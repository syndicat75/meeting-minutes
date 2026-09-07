/**
 * @file server/app.ts
 * @description Express 애플리케이션 생성 및 미들웨어/라우터 구성 모듈.
 * Vercel Serverless Function(api/index.ts)과 로컬/컨테이너 독립 실행 서버(server.ts)에서 공통으로 사용됩니다.
 */

import express, { Request, Response, NextFunction } from 'express';
import { apiRouter } from './routes';

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
      error: 'NOT_FOUND',
      message: `요청하신 API 경로(${req.originalUrl})를 찾을 수 없습니다. 엔드포인트 철자 및 Vercel 라우팅 설정을 확인하세요.`,
      statusCode: 404,
    });
  });

  return app;
}

export const app = createApp();
export default app;
