/**
 * @file server/routes.ts
 * @description API 라우터 정의 파일.
 * /health, /ai/transcribe, /ai/summarize 엔드포인트를 구현하며,
 * 인증 검증, 스토리지 파일 다운로드, Gemini AI 연동 및 엄격한 JSON 에러 응답을 제공합니다.
 */

import express, { Request, Response } from 'express';
import multer from 'multer';
import { getServerEnv, SERVER_CONFIG } from './config.js';
import {
  extractBearerToken,
  verifyFirebaseIdToken,
  verifyMeetingAccess,
  AuthenticatedRequest,
} from './auth.js';
import { downloadMeetingAudioFromStorage } from './storage.js';
import { summarizeMeetingWithGemini } from './gemini.js';
import { executeTranscription } from './ai/transcriptionService.js';
import { generateMeetingSummary } from './ai/meetingSummaryService.js';

export const apiRouter = express.Router();

// 직접 메모리 업로드용 Multer 설정 (50MB 이내 파일)
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: SERVER_CONFIG.directUploadLimitBytes },
});

/**
 * API 루트 엔드포인트: GET /api 또는 GET /
 * Vercel Function 및 API 서버 상태 확인
 */
apiRouter.get('/', (req: Request, res: Response) => {
  console.log('[ROUTES] GET / called');
  res.json({
    status: 'ok',
    service: 'ai-meeting-notes-api',
    message: 'AI 회의록 관리 API 서버가 정상 동작 중입니다.',
    endpoints: ['/api/health', '/api/ai/transcribe', '/api/ai/summarize'],
  });
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
    primaryProvider: env.primaryProvider,
    fallbackProvider: env.fallbackProvider,
    openaiConfigured: Boolean(env.openaiApiKey && env.openaiApiKey !== 'MY_OPENAI_API_KEY'),
    geminiConfigured: Boolean(env.geminiApiKey && env.geminiApiKey !== 'MY_GEMINI_API_KEY'),
    firebaseConfigured: Boolean(env.firebaseProjectId),
    storageBucketConfigured: Boolean(env.firebaseStorageBucket),
    openaiModel: env.openaiTranscribeModel,
    geminiModel: env.geminiModel,
    limits: {
      directUploadLimitMb: Math.round(SERVER_CONFIG.directUploadLimitBytes / 1024 / 1024),
      storageMaxLimitMb: Math.round(SERVER_CONFIG.storageMaxAudioSizeBytes / 1024 / 1024),
      vercelBodyLimitMb: Math.round((SERVER_CONFIG.vercelMaxBodySizeBytes / 1024 / 1024) * 10) / 10,
      serverlessTimeoutSec: SERVER_CONFIG.serverlessTimeoutSeconds,
    },
  });
});

/**
 * AI 음성 전사(STT) 엔드포인트: POST /api/ai/transcribe
 * 직접 전송된 오디오 파일(audioFile) 또는 Firebase Storage에 저장된 오디오(audioStoragePath)를 분석하여
 * 화자별 분리 대화록과 전체 회의 전사문, 핵심 요약을 생성합니다.
 * 성공 및 실패 시 반드시 JSON 응답을 반환합니다.
 */
apiRouter.post(
  '/ai/transcribe',
  upload.single('audioFile'),
  async (req: AuthenticatedRequest, res: Response) => {
    console.log('[ROUTES] POST /api/ai/transcribe called');

    try {
      // 1. 환경변수 API 키 확인 (OpenAI 우선, Gemini Fallback)
      const env = getServerEnv();
      const hasOpenAiKey = Boolean(env.openaiApiKey && env.openaiApiKey.trim() !== '' && env.openaiApiKey !== 'MY_OPENAI_API_KEY');
      const hasGeminiKey = Boolean(env.geminiApiKey && env.geminiApiKey.trim() !== '' && env.geminiApiKey !== 'MY_GEMINI_API_KEY');

      if (!hasOpenAiKey && !hasGeminiKey) {
        console.error('[transcription] Neither OPENAI_API_KEY nor GEMINI_API_KEY is configured on server');
        return res.status(503).json({
          success: false,
          error: 'AI 음성 전사 API Key가 서버에 설정되어 있지 않습니다.',
          detail: 'Vercel 프로젝트 Settings > Environment Variables 또는 .env에 OPENAI_API_KEY 또는 GEMINI_API_KEY를 등록해주세요.',
        });
      }

      // 2. 인증 토큰 확인 및 검증
      const authHeader = req.headers.authorization;
      const token = extractBearerToken(authHeader);

      if (token) {
        try {
          const user = await verifyFirebaseIdToken(token);
          req.user = user;
        } catch (authErr: any) {
          console.warn('[ROUTES] ID token verification failed:', authErr.message);
          return res.status(authErr.statusCode || 401).json({
            success: false,
            error: authErr.message || '인증에 실패했습니다. 다시 로그인해주세요.',
            detail: authErr.code || 'UNAUTHORIZED',
          });
        }
      } else {
        // 토큰 미전송 시 안내
        console.log('[ROUTES] No authorization token provided in request');
        return res.status(401).json({
          success: false,
          error: '로그인이 필요합니다. AI 음성 전사 기능을 사용하려면 먼저 Google 계정으로 로그인해주세요.',
          detail: 'UNAUTHORIZED',
        });
      }

      // 3. 요청 본문 파라미터 파싱
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
          attendeeNames =
            typeof req.body.attendeeNames === 'string'
              ? JSON.parse(req.body.attendeeNames)
              : req.body.attendeeNames;
        } catch (e) {
          console.warn('[ROUTES] Failed to parse attendeeNames', e);
        }
      }

      if (!meetingId) {
        return res.status(400).json({
          success: false,
          error: '회의 ID(meetingId)는 필수 항목입니다.',
          detail: 'MISSING_MEETING_ID',
        });
      }

      // 4. 회의 접근 권한 검증 (인증된 사용자인 경우)
      if (req.user && token) {
        const hasAccess = await verifyMeetingAccess(req.user.uid, meetingId, token);
        if (!hasAccess) {
          console.warn('[ROUTES] User forbidden from meeting', { uid: req.user.uid, meetingId });
          return res.status(403).json({
            success: false,
            error: '해당 회의록에 대한 편집/전사 권한이 없습니다.',
            detail: 'FORBIDDEN',
          });
        }
      }

      // 5. 오디오 바이너리 버퍼 확보
      // (1) 직접 업로드된 audioFile 버퍼가 있으면 최우선 사용 (Vercel 및 로컬 모두 가장 안정적)
      let audioBuffer: Buffer | null = null;
      let mimeType: string = 'audio/webm';

      if (req.file && req.file.buffer && req.file.buffer.length > 0) {
        console.log('[ROUTES] Using directly uploaded audio file buffer', {
          size: req.file.buffer.length,
          originalMime: req.file.mimetype,
        });
        audioBuffer = req.file.buffer;
        mimeType = req.file.mimetype || 'audio/webm';
      } else if (audioStoragePath) {
        // (2) audioStoragePath가 로컬 임시 경로(local/...)이거나 blob URL인 경우 확인
        if (audioStoragePath.startsWith('local/') || audioUrl.startsWith('blob:')) {
          console.warn('[ROUTES] Local audio path cannot be downloaded by server. Direct file upload required.');
          return res.status(400).json({
            success: false,
            error: '녹음 오디오 데이터가 서버로 전송되지 않았습니다. 녹음을 다시 시도하거나 직접 파일을 첨부해주세요.',
            detail: 'LOCAL_BLOB_NOT_UPLOADED',
          });
        }

        // Firebase Cloud Storage에서 오디오 파일 안전하게 다운로드
        console.log('[ROUTES] Fetching audio from storage path', { audioStoragePath });
        try {
          const downloaded = await downloadMeetingAudioFromStorage(
            meetingId,
            audioStoragePath,
            audioUrl,
            token
          );
          audioBuffer = downloaded.buffer;
          mimeType = downloaded.mimeType;
        } catch (storageErr: any) {
          console.error('[ROUTES] Failed to download audio from storage:', storageErr.message);
          return res.status(storageErr.statusCode || 500).json({
            success: false,
            error: storageErr.message || '스토리지에서 오디오 파일을 다운로드하지 못했습니다.',
            detail: storageErr.code || String(storageErr),
          });
        }
      } else {
        return res.status(400).json({
          success: false,
          error: '전사할 오디오 데이터가 없습니다. 오디오 파일을 첨부하거나 녹음을 완료해주세요.',
          detail: 'NO_AUDIO_DATA',
        });
      }

      if (!audioBuffer || audioBuffer.length === 0) {
        return res.status(400).json({
          success: false,
          error: '전사할 오디오 데이터가 비어 있습니다 (0 bytes).',
          detail: 'EMPTY_AUDIO_BUFFER',
        });
      }

      // 6. OpenAI 우선 + Gemini Fallback 전사 파이프라인 실행
      const result = await executeTranscription(audioBuffer, mimeType, {
        meetingId,
        meetingTitle,
        agenda,
        attendeeNames,
      });

      console.log('[ROUTES] Transcription response ready with speakers and segments', {
        provider: result.provider,
        fallbackUsed: result.fallbackUsed,
        speakerCount: result.speakers.length,
        segmentCount: result.transcripts.length,
      });

      // 7. 성공 응답: provider, fallbackUsed, speakers, transcript, fullTranscript, summary, transcripts 모두 반환
      return res.json({
        success: true,
        provider: result.provider,
        fallbackUsed: result.fallbackUsed,
        transcript: result.fullTranscript,
        speakers: result.speakers,
        fullTranscript: result.fullTranscript,
        summary: result.summary,
        transcripts: result.transcripts,
      });
    } catch (err: any) {
      console.error('[ROUTES] POST /api/ai/transcribe catch block triggered', err);
      const statusCode = err.statusCode || 500;
      return res.status(statusCode).json({
        success: false,
        error: err.message || 'AI 음성 전사 처리 중 서버 오류가 발생했습니다.',
        detail: err.detail || err.details || err.code || String(err),
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
      // 1. 환경변수 GEMINI_API_KEY 확인
      const { geminiApiKey } = getServerEnv();
      if (!geminiApiKey || geminiApiKey.trim() === '' || geminiApiKey === 'MY_GEMINI_API_KEY') {
        console.error('[summarize] GEMINI_API_KEY is not configured on server');
        return res.status(503).json({
          success: false,
          error: 'GEMINI_API_KEY가 서버에 설정되어 있지 않습니다.',
          detail: 'Vercel 프로젝트 Settings > Environment Variables 또는 .env에 GEMINI_API_KEY를 등록해주세요.',
        });
      }

      // 2. Firebase 인증 토큰 확인
      const authHeader = req.headers.authorization;
      const token = extractBearerToken(authHeader);

      if (!token) {
        console.warn('[ROUTES] Summarize rejected: Missing Bearer token');
        return res.status(401).json({
          success: false,
          error: '로그인이 필요합니다. AI 요약 기능을 사용하려면 먼저 Google 계정으로 로그인해주세요.',
          detail: 'UNAUTHORIZED',
        });
      }

      const user = await verifyFirebaseIdToken(token);
      req.user = user;

      // 3. 파라미터 파싱
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
          success: false,
          error: '회의 ID(meetingId)는 필수 항목입니다.',
          detail: 'MISSING_MEETING_ID',
        });
      }

      // 4. 회의 접근 권한 검증
      const hasAccess = await verifyMeetingAccess(user.uid, meetingId, token);
      if (!hasAccess) {
        return res.status(403).json({
          success: false,
          error: '해당 회의록에 대한 요약 권한이 없습니다.',
          detail: 'FORBIDDEN',
        });
      }

      // 5. 대화록 존재 여부 검증
      if (!transcripts || !Array.isArray(transcripts) || transcripts.length === 0) {
        return res.status(400).json({
          success: false,
          error: '요약할 대화록 데이터가 없습니다. 먼저 음성 전사를 완료해주세요.',
          detail: 'NO_TRANSCRIPTS',
        });
      }

      // 6. Gemini 2.5 Flash 모델 요약 실행
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
        success: false,
        error: err.message || '회의록 요약 처리 중 서버 오류가 발생했습니다.',
        detail: err.detail || err.details || err.code || String(err),
      });
    }
  }
);

/**
 * 5분 단위 개별 오디오 청크 AI 전사 엔드포인트: POST /api/ai/transcribe-chunk
 * 장시간 회의에서 생성된 5분 분할 Chunk를 개별 다운로드하여 OpenAI/Gemini 전사 수행.
 * 타임스탬프 오프셋(startSeconds) 및 화자 번호 충돌 방지를 보정하여 반환합니다.
 */
apiRouter.post(
  '/ai/transcribe-chunk',
  async (req: AuthenticatedRequest, res: Response) => {
    console.log('[ROUTES] POST /api/ai/transcribe-chunk called');

    try {
      // 1. 인증 토큰 확인
      const authHeader = req.headers.authorization;
      const token = extractBearerToken(authHeader);

      if (!token) {
        return res.status(401).json({
          success: false,
          error: '인증이 필요합니다. 먼저 로그인해주세요.',
          detail: 'UNAUTHORIZED',
        });
      }

      const user = await verifyFirebaseIdToken(token);
      req.user = user;

      // 2. 파라미터 파싱
      const meetingId = String(req.body.meetingId || '').trim();
      const chunkId = String(req.body.chunkId || '').trim();
      const chunkIndex = typeof req.body.chunkIndex === 'number' ? req.body.chunkIndex : 0;
      const startSeconds = typeof req.body.startSeconds === 'number' ? req.body.startSeconds : 0;
      const endSeconds = typeof req.body.endSeconds === 'number' ? req.body.endSeconds : startSeconds + 300;
      const meetingTitle = req.body.meetingTitle || '';
      const agenda = req.body.agenda || '';
      let attendeeNames: string[] = [];

      if (req.body.attendeeNames) {
        try {
          attendeeNames =
            typeof req.body.attendeeNames === 'string'
              ? JSON.parse(req.body.attendeeNames)
              : req.body.attendeeNames;
        } catch {
          // 무시
        }
      }

      if (!meetingId || !chunkId) {
        return res.status(400).json({
          success: false,
          error: 'meetingId와 chunkId는 필수 항목입니다.',
          detail: 'MISSING_PARAMETERS',
        });
      }

      // 3. 회의 접근 권한 검증
      const hasAccess = await verifyMeetingAccess(user.uid, meetingId, token);
      if (!hasAccess) {
        return res.status(403).json({
          success: false,
          error: '해당 회의록에 대한 권한이 없습니다.',
          detail: 'FORBIDDEN',
        });
      }

      // 4. 스토리지 경로 결정 및 검증
      let audioStoragePath = req.body.audioStoragePath ? String(req.body.audioStoragePath).trim() : '';
      if (!audioStoragePath) {
        audioStoragePath = `meetings/${meetingId}/audio/chunks/${chunkId}.webm`;
      }

      console.log('[ROUTES] Downloading chunk from storage', { meetingId, chunkId, audioStoragePath });

      // 5. Firebase Storage에서 오디오 다운로드
      const downloaded = await downloadMeetingAudioFromStorage(
        meetingId,
        audioStoragePath,
        req.body.audioUrl,
        token
      );

      // 6. 전사 파이프라인 호출 (OpenAI 우선 + Gemini Fallback)
      const result = await executeTranscription(downloaded.buffer, downloaded.mimeType, {
        meetingId,
        meetingTitle,
        agenda,
        attendeeNames,
        timeOffsetSeconds: startSeconds,
        chunkIndex,
      });

      console.log('[ROUTES] Chunk transcription succeeded', {
        chunkId,
        provider: result.provider,
        segmentCount: result.transcripts.length,
      });

      return res.json({
        success: true,
        chunkId,
        chunkIndex,
        provider: result.provider,
        fallbackUsed: result.fallbackUsed,
        speakers: result.speakers,
        fullTranscript: result.fullTranscript,
        transcripts: result.transcripts,
        startSeconds,
        endSeconds,
      });
    } catch (err: any) {
      console.error('[ROUTES] POST /api/ai/transcribe-chunk failed', err);
      const statusCode = err.statusCode || 500;
      return res.status(statusCode).json({
        success: false,
        chunkId: req.body?.chunkId,
        error: err.userMessage || err.message || '청크 음성 전사 중 오류가 발생했습니다.',
        detail: err.detail || err.details || err.code || String(err),
      });
    }
  }
);

/**
 * 전체 회의 대화록 기반 종합 회의 요약 엔드포인트: POST /api/ai/summarize-meeting
 * 병합된 회의 전사문과 메타데이터를 기반으로 종합 개요, 결정사항, Action Items를 JSON 생성.
 */
apiRouter.post(
  '/ai/summarize-meeting',
  async (req: AuthenticatedRequest, res: Response) => {
    console.log('[ROUTES] POST /api/ai/summarize-meeting called');

    try {
      // 1. 인증 확인
      const authHeader = req.headers.authorization;
      const token = extractBearerToken(authHeader);

      if (!token) {
        return res.status(401).json({
          success: false,
          error: '인증이 필요합니다. 먼저 로그인해주세요.',
          detail: 'UNAUTHORIZED',
        });
      }

      const user = await verifyFirebaseIdToken(token);
      req.user = user;

      const meetingId = String(req.body.meetingId || '').trim();
      const title = String(req.body.title || req.body.meetingTitle || '회의').trim();
      const agenda = String(req.body.agenda || '').trim();
      const department = String(req.body.department || '').trim();
      const date = String(req.body.date || '').trim();
      const attendees = Array.isArray(req.body.attendees) ? req.body.attendees : [];
      const fullTranscript = String(req.body.fullTranscript || '').trim();

      if (!meetingId) {
        return res.status(400).json({
          success: false,
          error: 'meetingId는 필수 항목입니다.',
          detail: 'MISSING_MEETING_ID',
        });
      }

      if (!fullTranscript) {
        return res.status(400).json({
          success: false,
          error: '요약할 회의 전사문(fullTranscript)이 비어 있습니다.',
          detail: 'EMPTY_TRANSCRIPT',
        });
      }

      // 2. 권한 확인
      const hasAccess = await verifyMeetingAccess(user.uid, meetingId, token);
      if (!hasAccess) {
        return res.status(403).json({
          success: false,
          error: '해당 회의에 대한 접근 권한이 없습니다.',
          detail: 'FORBIDDEN',
        });
      }

      // 3. 종합 요약 생성
      const summaryResult = await generateMeetingSummary({
        meetingId,
        title,
        agenda,
        department,
        date,
        attendees,
        fullTranscript,
      });

      return res.json({
        success: true,
        summary: summaryResult,
      });
    } catch (err: any) {
      console.error('[ROUTES] POST /api/ai/summarize-meeting failed', err);
      const statusCode = err.statusCode || 500;
      return res.status(statusCode).json({
        success: false,
        error: err.message || '종합 회의 요약 생성 중 오류가 발생했습니다.',
        detail: err.detail || err.details || err.code || String(err),
      });
    }
  }
);
