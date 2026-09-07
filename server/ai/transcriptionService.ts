/**
 * @file server/ai/transcriptionService.ts
 * @description 오디오 전사 통합 서비스 추상화 계층.
 * AI_PRIMARY_PROVIDER(기본값: openai)를 우선 호출하고, 429/5xx/타임아웃 등 일시 장애 발생 시
 * AI_FALLBACK_PROVIDER(기본값: gemini)로 자동 전환하여 높은 가용성을 보장합니다.
 * 401/403(인증/권한) 에러는 설정 확인 메시지로 즉시 차단하며, 긴 회의 오디오의 청크 순차 전사 및 화자 병합을 지원합니다.
 */

import { getServerEnv, SERVER_CONFIG } from '../config.js';
import {
  transcribeAudioWithOpenAI,
  SpeakerEntry,
  LegacyTranscriptSegment,
} from './openaiTranscription.js';
import { transcribeAudioWithGeminiFallback } from './geminiTranscription.js';

/**
 * 전사 통합 서비스 입력 페이로드 인터페이스
 */
export interface TranscribeAudioServiceOptions {
  meetingId: string;
  meetingTitle?: string;
  agenda?: string;
  attendeeNames?: string[];
  // 긴 회의 분할 청크 지원 (청크 시간 오프셋: 초 단위)
  timeOffsetSeconds?: number;
  chunkIndex?: number;
  totalChunks?: number;
}

/**
 * 최종 통합 전사 결과 반환 인터페이스
 */
export interface UnifiedTranscriptionResponse {
  success: boolean;
  provider: 'openai' | 'gemini';
  fallbackUsed: boolean;
  speakers: SpeakerEntry[];
  fullTranscript: string;
  summary: string | null;
  transcripts: LegacyTranscriptSegment[];
}

/**
 * 화자 번호 정규화 및 다중 청크 화자 충돌 방지 헬퍼
 * chunk 1의 화자 1과 chunk 2의 화자 1을 무조건 동일인으로 가정하지 않습니다.
 * @param {SpeakerEntry[]} speakers 원시 화자 발언 배열
 * @param {LegacyTranscriptSegment[]} transcripts 세그먼트 배열
 * @param {number} timeOffsetSeconds 시작 시간 오프셋 (초)
 * @param {number} chunkIndex 현재 청크 인덱스 (0부터 시작)
 * @param {string[]} attendeeNames 참석자 명단 (명확한 경우에만 매핑)
 */
export function normalizeChunkSpeakersAndTime(
  speakers: SpeakerEntry[],
  transcripts: LegacyTranscriptSegment[],
  timeOffsetSeconds: number = 0,
  chunkIndex?: number,
  attendeeNames: string[] = []
): { speakers: SpeakerEntry[]; transcripts: LegacyTranscriptSegment[] } {
  console.log('[TRANSCRIPTION_SERVICE] normalizeChunkSpeakersAndTime called', {
    timeOffsetSeconds,
    chunkIndex,
    speakerCount: speakers.length,
    segmentCount: transcripts.length,
  });

  const isMultiChunk = typeof chunkIndex === 'number' && chunkIndex >= 0;
  const chunkPrefix = isMultiChunk ? `[${chunkIndex + 1}구간] ` : '';

  // 타임스탬프 보정 및 화자 레이블 조정
  const adjustedSpeakers: SpeakerEntry[] = speakers.map((spk) => {
    let speakerLabel = spk.speaker;
    if (isMultiChunk && !speakerLabel.includes('구간')) {
      speakerLabel = `${chunkPrefix}${spk.speaker}`;
    }
    return {
      speaker: speakerLabel,
      startTime: Math.round((spk.startTime + timeOffsetSeconds) * 10) / 10,
      endTime: Math.round((spk.endTime + timeOffsetSeconds) * 10) / 10,
      text: spk.text,
    };
  });

  const adjustedTranscripts: LegacyTranscriptSegment[] = transcripts.map((t, idx) => {
    let spkDisplayName = t.speakerName || t.speakerId;
    if (isMultiChunk && !spkDisplayName.includes('구간')) {
      spkDisplayName = `${chunkPrefix}${spkDisplayName}`;
    }

    // 참석자가 1명이고 확실한 경우가 아니면 임의로 실제 참석자 이름을 부여하지 않음
    let speakerName = spkDisplayName;
    if (attendeeNames.length === 1) {
      speakerName = attendeeNames[0];
    }

    return {
      ...t,
      id: `${t.id}-${chunkIndex ?? 0}-${idx}`,
      startSeconds: Math.round(t.startSeconds + timeOffsetSeconds),
      endSeconds: Math.round(t.endSeconds + timeOffsetSeconds),
      speakerId: isMultiChunk ? `chunk_${chunkIndex}_${t.speakerId}` : t.speakerId,
      speakerName,
    };
  });

  return {
    speakers: adjustedSpeakers,
    transcripts: adjustedTranscripts,
  };
}

/**
 * 단일 오디오 버퍼에 대해 Primary(OpenAI) -> Fallback(Gemini) 전사 파이프라인 실행
 * @param {Buffer} audioBuffer 오디오 파일 바이너리 버퍼
 * @param {string} mimeType 오디오 MIME 타입
 * @param {TranscribeAudioServiceOptions} options 회의 메타데이터 및 청크 옵션
 * @returns {Promise<UnifiedTranscriptionResponse>} 통일된 전사 응답
 */
export async function executeTranscription(
  audioBuffer: Buffer,
  mimeType: string,
  options: TranscribeAudioServiceOptions
): Promise<UnifiedTranscriptionResponse> {
  console.log('[TRANSCRIPTION_SERVICE] executeTranscription called', {
    meetingId: options.meetingId,
    mimeType,
    bufferLength: audioBuffer.length,
  });

  const env = getServerEnv();
  const primary = (env.primaryProvider || SERVER_CONFIG.primaryProvider || 'openai').toLowerCase();
  const fallback = (env.fallbackProvider || SERVER_CONFIG.fallbackProvider || 'gemini').toLowerCase();

  const context = {
    meetingTitle: options.meetingTitle,
    agenda: options.agenda,
    attendeeNames: options.attendeeNames,
  };

  // 1. Primary가 OpenAI인 경우 (기본 구조)
  if (primary === 'openai') {
    let openAiError: any = null;

    try {
      // OpenAI 전사 호출
      const openAiResult = await transcribeAudioWithOpenAI(audioBuffer, mimeType, context);

      // 시간 오프셋 및 화자 보정 적용
      const { speakers, transcripts } = normalizeChunkSpeakersAndTime(
        openAiResult.speakers,
        openAiResult.transcripts,
        options.timeOffsetSeconds || 0,
        options.chunkIndex,
        options.attendeeNames || []
      );

      return {
        ...openAiResult,
        speakers,
        transcripts,
      };
    } catch (err: any) {
      openAiError = err;

      // 401, 403: 관리자 API Key / 권한 에러 -> Fallback하지 않고 즉시 사용자 안내
      if (err.isConfigError || err.statusCode === 401 || err.statusCode === 403) {
        console.error('[transcription] OpenAI configuration error, skipping fallback:', err.message);
        const configErr: any = new Error('OpenAI API 설정을 확인해주세요.');
        configErr.statusCode = err.statusCode || 401;
        configErr.code = 'OPENAI_AUTH_CONFIG_ERROR';
        configErr.detail = 'OpenAI API 키가 유효하지 않거나 권한이 없습니다. 서버 환경변수 OPENAI_API_KEY를 확인해주세요.';
        throw configErr;
      }

      // 400: 잘못된 요청 -> Fallback하지 않음
      if (err.isBadRequest || err.statusCode === 400) {
        console.error('[transcription] OpenAI bad request error, skipping fallback:', err.message);
        throw err;
      }

      // 그 외 429, 500, 502, 503, 504, timeout, network error 등은 Gemini Fallback 대상
      console.warn('[transcription] OpenAI temporary failure encountered. Triggering Gemini fallback...', {
        status: err.statusCode,
        message: err.message,
      });
    }

    // 2. Gemini Fallback 실행
    try {
      const geminiResult = await transcribeAudioWithGeminiFallback(audioBuffer, mimeType, context, true);

      const { speakers, transcripts } = normalizeChunkSpeakersAndTime(
        geminiResult.speakers,
        geminiResult.transcripts,
        options.timeOffsetSeconds || 0,
        options.chunkIndex,
        options.attendeeNames || []
      );

      return {
        ...geminiResult,
        speakers,
        transcripts,
      };
    } catch (geminiErr: any) {
      // 두 서비스 모두 실패 시 두 오류를 서버 로그에 상세 기록 (API Key는 로그 제외)
      console.error('[transcription] Both OpenAI and Gemini fallback failed!', {
        openAiError: {
          status: openAiError?.statusCode,
          message: openAiError?.message,
        },
        geminiError: {
          status: geminiErr?.statusCode,
          message: geminiErr?.message,
        },
      });

      const combinedError: any = new Error(
        `AI 음성 전사 서비스 장애: OpenAI(${openAiError?.message || '실패'}) 및 Gemini Fallback(${geminiErr?.message || '실패'}) 모두 처리에 실패했습니다.`
      );
      combinedError.statusCode = geminiErr?.statusCode || openAiError?.statusCode || 502;
      combinedError.code = 'ALL_AI_PROVIDERS_FAILED';
      combinedError.detail = `OpenAI: ${openAiError?.message} | Gemini: ${geminiErr?.message}`;
      throw combinedError;
    }
  }

  // Primary가 Gemini로 수동 설정된 경우
  try {
    const geminiResult = await transcribeAudioWithGeminiFallback(audioBuffer, mimeType, context, false);
    const { speakers, transcripts } = normalizeChunkSpeakersAndTime(
      geminiResult.speakers,
      geminiResult.transcripts,
      options.timeOffsetSeconds || 0,
      options.chunkIndex,
      options.attendeeNames || []
    );

    return {
      ...geminiResult,
      speakers,
      transcripts,
    };
  } catch (geminiErr: any) {
    console.error('[transcription] Primary Gemini failed:', geminiErr.message);
    throw geminiErr;
  }
}

/**
 * 긴 회의 분할 청크 순차 전사 헬퍼 (30분~3시간 긴 회의 대응)
 * 각 오디오 청크를 순차적으로 전사하고 시간순으로 병합합니다.
 * @param {Array<{ buffer: Buffer, mimeType: string, timeOffsetSeconds: number }>} chunks 분할 청크 배열
 * @param {TranscribeAudioServiceOptions} options 기본 회의 옵션
 * @returns {Promise<UnifiedTranscriptionResponse>} 병합된 전사 결과
 */
export async function transcribeAudioChunksSequentially(
  chunks: Array<{ buffer: Buffer; mimeType: string; timeOffsetSeconds: number }>,
  options: TranscribeAudioServiceOptions
): Promise<UnifiedTranscriptionResponse> {
  console.log('[TRANSCRIPTION_SERVICE] transcribeAudioChunksSequentially called', {
    chunkCount: chunks.length,
    meetingId: options.meetingId,
  });

  const mergedSpeakers: SpeakerEntry[] = [];
  const mergedTranscripts: LegacyTranscriptSegment[] = [];
  const transcriptTexts: string[] = [];
  let lastProvider: 'openai' | 'gemini' = 'openai';
  let anyFallbackUsed = false;

  for (let i = 0; i < chunks.length; i++) {
    const chunk = chunks[i];
    console.log(`[TRANSCRIPTION_SERVICE] Processing chunk ${i + 1}/${chunks.length}...`, {
      offset: chunk.timeOffsetSeconds,
      bytes: chunk.buffer.length,
    });

    const chunkResult = await executeTranscription(chunk.buffer, chunk.mimeType, {
      ...options,
      chunkIndex: i,
      totalChunks: chunks.length,
      timeOffsetSeconds: chunk.timeOffsetSeconds,
    });

    lastProvider = chunkResult.provider;
    if (chunkResult.fallbackUsed) anyFallbackUsed = true;

    mergedSpeakers.push(...chunkResult.speakers);
    mergedTranscripts.push(...chunkResult.transcripts);
    if (chunkResult.fullTranscript) {
      transcriptTexts.push(chunkResult.fullTranscript);
    }
  }

  // 타임스탬프 순 정렬
  mergedSpeakers.sort((a, b) => a.startTime - b.startTime);
  mergedTranscripts.sort((a, b) => a.startSeconds - b.startSeconds);

  return {
    success: true,
    provider: lastProvider,
    fallbackUsed: anyFallbackUsed,
    speakers: mergedSpeakers,
    fullTranscript: transcriptTexts.join('\n\n'),
    summary: null,
    transcripts: mergedTranscripts,
  };
}
