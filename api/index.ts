/**
 * @file api/index.ts
 * @description Vercel Serverless Function 엔트리포인트.
 * Vercel 배포 시 /api/* 요청을 server/app.ts의 Express 애플리케이션으로 라우팅합니다.
 * 이를 통해 Vite 정적 프런트엔드와 Node.js 백엔드 API가 단일 Vercel 프로젝트에서 완벽히 통합 구동됩니다.
 */

import app from '../server/app.js';

/**
 * Vercel Serverless Function 핸들러 (Express 인스턴스 기본 내보내기)
 */
export default app;
