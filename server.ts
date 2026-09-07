/**
 * @file server.ts
 * @description AI 회의록 관리 풀스택 Express 서버 엔트리포인트 (로컬 개발 및 Cloud Run 컨테이너 구동용).
 * server/app.ts에 정의된 공통 Express 앱에 Vite 개발 미들웨어 및 프로덕션 정적 서빙을 바인딩하고 포트 3000에서 수신 대기합니다.
 */

import express from 'express';
import path from 'path';
import dotenv from 'dotenv';
import { createServer as createViteServer } from 'vite';
import { app } from './server/app';
import { SERVER_CONFIG } from './server/config';

dotenv.config();

const PORT = SERVER_CONFIG.port || 3000;

/**
 * Vite 개발 미들웨어 또는 프로덕션 정적 파일 서빙을 Express에 마운트하고 서버 시작
 * @returns {Promise<void>}
 */
async function startServer(): Promise<void> {
  console.log('[SERVER] startServer called', { env: process.env.NODE_ENV, port: PORT });

  if (process.env.NODE_ENV !== 'production') {
    // 개발 모드: Vite HMR 및 개발 미들웨어 마운트
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
    console.log('[SERVER] Vite development middleware mounted');
  } else {
    // 프로덕션 모드: dist 디렉터리의 빌드 결과물 정적 서빙 및 SPA fallback
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
    console.log('[SERVER] Static production assets mounted from dist');
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`[SERVER] AI 회의록 관리 서버가 포트 ${PORT}에서 정상 실행 중입니다.`);
  });
}

startServer().catch((err) => {
  console.error('[SERVER] Failed to start server:', err);
  process.exit(1);
});

export default app;
