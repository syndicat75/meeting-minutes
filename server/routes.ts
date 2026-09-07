/**
 * @file server/routes.ts
 * @description API 라우터 정의 파일.
 * /health, /ai/transcribe, /ai/summarize 엔드포인트를 구현하며,
 * 인증 검증, 스토리지 파일 다운로드, Gemini AI 연동 및 엄격한 에러 응답을 제공합니다.
 */

import express, { Request, Response } from 'express';
import multer from 'multer';
import { getServerEnv, SERVER_CONFIG } from './config';
import {
  extractBearerToken,
  verifyFirebaseIdToken,
  verifyMeetingAccess,
  requireAuthMiddleware,
  AuthenticatedRequest,
} from './auth';
import { downloadMeetingAudioFromStorage } from './storage';
import {
  transcribeAudioWithGemini,
  summarizeMeetingWithGemini,
} from './gemini';

export const apiRouter = express.Router();

// 직접 메모리 업로드용 Multer 설정 (4.5MB 이내 단기 파일 또는 개발 테스트용)
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: SERVER_CONFIG.directUploadLimitBytes },
});

/**
 * 서버 헬스체크 및 설정 상태 점검 엔드포인트
 * GET /api/health (비밀키 노출 없이 필수 환경변수 설정 여부만 반환)
 */
apiRouter.get('/health', (req: Request, res: Response) => {
  console.log('[ROUTES] GET /api/health called');
  const env = getServerEnv();

  res.json({
    status: 'ok',
    service: 'ai-meeting-notes-api',
    timestamp: new Date().toISOString(),
    environment: process.env.NODE_ENV || 'development',
    geminiConfigured: Boolean(env.geminiApiKey && env.geminiApiKey !== 'MY_GEMINI_API_KEY'),
    firebaseConfigured: Boolean(env.firebaseProjectId),
    storageBucketConfigured: Boolean(env.firebaseStorageBucket),
    model: SERVER_CONFIG.geminiModel,
    limits: {
      directUploadLimitMb: Math.round(SERVER_CONFIG.directUploadLimitBytes / 1024 / 1024),
      storageMaxLimitMb: Math.round(SERVER_CONFIG.storageMaxAudioSizeBytes / 1024 / 1024),
      vercelBodyLimitMb: Math.round(SERVER_CONFIG.vercelMaxBodySizeBytes / 1024 / 1024 * 10) / 10,
      serverlessTimeoutSec: SERVER_CONFIG.serverlessTimeoutSeconds,
    },
  });
});

/**
 * AI 음성 전사(STT) 엔드포인트: POST /api/ai/transcribe
 * Firebase Storage에 저장된 오디오(audioStoragePath) 또는 직접 전송된 오디오 파일(audioFile)을 분석하여
 * 화자별 대화록을 생성합니다.
 */
apiRouter.post(
  '/ai/transcribe',
  upload.single('audioFile'),
  async (req: AuthenticatedRequest, res: Response) => {
    console.log('[ROUTES] POST /api/ai/transcribe called');

    try {
      // 1. Firebase 인증 토큰 확인
      const authHeader = req.headers.authorization;
      const token = extractBearerToken(authHeader);

      if (!token) {
        console.warn('[ROUTES] Transcription rejected: Missing Bearer token');
        return res.status(401).json({
          error: 'UNAUTHORIZED',
          message: '로그인이 필요합니다. AI 음성 전사 기능을 사용하려면 먼저 Google 계정으로 로그인해주세요.',
          statusCode: 401,
        });
      }

      const user = await verifyFirebaseIdToken(token);
      req.user = user;

      // 2. 요청 파라미터 파싱
      const meetingId = String(req.body.meetingId || '').trim();
      const audioStoragePath = req.body.audioStoragePath
        ? String(req.body.audioStoragePath).trim()
        : '';
      const audioUrl = req.body.audioUrl ? String(req.body.audioUrl).trim() : '';
      const meetingTitle = req.body.meetingTitle || '산업안전보건 및 위험성평가 회의';
      const agenda = req.body.agenda || '';

      let attendeeNames: string[] = [];
      if (req.body.attendeeNames) {
        try {
          attendeeNames = typeof req.body.attendeeNames === 'string'
            ? JSON.parse(req.body.attendeeNames)
            : req.body.attendeeNames;
        } catch (e) {
          console.warn('[ROUTES] Failed to parse attendeeNames', e);
        }
      }

      if (!meetingId) {
        return res.status(400).json({
          error: 'MISSING_MEETING_ID',
          message: '회의 ID(meetingId)는 필수 항목입니다.',
          statusCode: 400,
        });
      }

      // 3. 회의 접근 및 편집 권한 검증
      const hasAccess = await verifyMeetingAccess(user.uid, meetingId, token);
      if (!hasAccess) {
        console.warn('[ROUTES] User forbidden from meeting', { uid: user.uid, meetingId });
        return res.status(403).json({
          error: 'FORBIDDEN',
          message: '해당 회의록에 대한 편집/전사 권한이 없습니다.',
          statusCode: 403,
        });
      }

      // 4. 오디오 버퍼 확보 (Storage 경로 우선, 없으면 메모리 업로드 파일 확인)
      let audioBuffer: Buffer | null = null;
      let mimeType: string = 'audio/webm';

      if (audioStoragePath) {
        // Firebase Cloud Storage에서 오디오 파일 안전하게 다운로드
        console.log('[ROUTES] Fetching audio from storage path', { audioStoragePath });
        const downloaded = await downloadMeetingAudioFromStorage(
          meetingId,
          audioStoragePath,
          audioUrl,
          token
        );
        audioBuffer = downloaded.buffer;
        mimeType = downloaded.mimeType;
      } else if (req.file && req.file.buffer && req.file.buffer.length > 0) {
        console.log('[ROUTES] Using directly uploaded audio file buffer', { size: req.file.buffer.length });
        audioBuffer = req.file.buffer;
        mimeType = req.file.mimetype || 'audio/webm';
      } else {
        return res.status(400).json({
          error: 'NO_AUDIO_DATA',
          message:
            '전사할 오디오 데이터가 없습니다. Firebase Storage 경로(audioStoragePath)를 전달하거나 오디오 파일을 첨부해주세요.',
          statusCode: 400,
        });
      }

      // 5. 실제 Gemini 2.5 Flash 모델 전사 실행 (가짜 fallback 일절 없음)
      const transcripts = await transcribeAudioWithGemini(audioBuffer, mimeType, {
        meetingTitle,
        agenda,
        attendeeNames,
      });

      console.log('[ROUTES] Transcription response ready with segments', { count: transcripts.length });
      return res.json({
        success: true,
        transcripts,
      });
    } catch (err: any) {
      console.error('[ROUTES] POST /api/ai/transcribe failed', err);
      const statusCode = err.statusCode || 500;
      return res.status(statusCode).json({
        error: err.code || 'TRANSCRIPTION_FAILED',
        message: err.message || '음성 전사 처리 중 서버 오류가 발생했습니다.',
        details: err.details,
        statusCode,
      });
    }
  }
);

/**
 * AI 회의록 요약 엔드포인트: POST /api/ai/summarize
 * 대화록(Transcript)과 회의 안건을 분석하여 표준 양식 요약을 생성합니다.
 */
apiRouter.post(
  '/ai/summarize',
  async (req: AuthenticatedRequest, res: Response) => {
    console.log('[ROUTES] POST /api/ai/summarize called');

    try {
      // 1. Firebase 인증 토큰 확인
      const authHeader = req.headers.authorization;
      const token = extractBearerToken(authHeader);

      if (!token) {
        console.warn('[ROUTES] Summarize rejected: Missing Bearer token');
        return res.status(401).json({
          error: 'UNAUTHORIZED',
          message: '로그인이 필요합니다. AI 요약 기능을 사용하려면 먼저 Google 계정으로 로그인해주세요.',
          statusCode: 401,
        });
      }

      const user = await verifyFirebaseIdToken(token);
      req.user = user;

      // 2. 파라미터 파싱
      const {
        meetingId,
        meetingTitle,
        agenda,
        department,
        attendees,
        transcripts,
        speakerMapping,
      } = req.body;

      if (!meetingId) {
        return res.status(400).json({
          error: 'MISSING_MEETING_ID',
          message: '회의 ID(meetingId)는 필수 항목입니다.',
          statusCode: 400,
        });
      }

      // 3. 회의 접근 권한 검증
      const hasAccess = await verifyMeetingAccess(user.uid, meetingId, token);
      if (!hasAccess) {
        return res.status(403).json({
          error: 'FORBIDDEN',
          message: '해당 회의록에 대한 요약 권한이 없습니다.',
          statusCode: 403,
        });
      }

      // 4. 대화록 존재 여부 검증
      if (!transcripts || !Array.isArray(transcripts) || transcripts.length === 0) {
        return res.status(400).json({
          error: 'NO_TRANSCRIPTS',
          message: '요약할 대화록 데이터가 없습니다. 먼저 음성 전사를 완료해주세요.',
          statusCode: 400,
        });
      }

      // 5. 실제 Gemini 2.5 Flash 모델 요약 실행 (가짜 fallback 일절 없음)
      const summary = await summarizeMeetingWithGemini({
        meetingTitle: meetingTitle || '위험성평가 위원회 회의',
        agenda: agenda || '',
        department: department || '',
        attendees: Array.isArray(attendees) ? attendees : [],
        transcripts,
        speakerMapping,
      });

      console.log('[ROUTES] Summarization response ready');
      return res.json({
        success: true,
        summary,
      });
    } catch (err: any) {
      console.error('[ROUTES] POST /api/ai/summarize failed', err);
      const statusCode = err.statusCode || 500;
      return res.status(statusCode).json({
        error: err.code || 'SUMMARIZATION_FAILED',
        message: err.message || '회의록 요약 처리 중 서버 오류가 발생했습니다.',
        details: err.details,
        statusCode,
      });
    }
  }
);
