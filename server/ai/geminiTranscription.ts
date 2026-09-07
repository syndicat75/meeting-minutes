/**
 * @file server/ai/geminiTranscription.ts
 * @description Google Gemini (3.6 Flash) 기반 오디오 화자 분리(Diarization) 전사 모듈.
 * OpenAI 장애 또는 지정 시 Fallback AI 엔진으로 사용되며,
 * 엄격한 구조화 JSON 스키마를 통해 화자별 대화록을 안정적으로 생성합니다.
 */

import { transcribeAudioWithGemini } from '../gemini.js';
import { SpeakerEntry, LegacyTranscriptSegment } from './openaiTranscription.js';

/**
 * Gemini 전사 반환 인터페이스
 */
export interface GeminiTranscriptionResult {
  success: boolean;
  provider: 'gemini';
  fallbackUsed: boolean;
  speakers: SpeakerEntry[];
  fullTranscript: string;
  summary: string | null;
  transcripts: LegacyTranscriptSegment[];
}

/**
 * Gemini 음성 전사 실행 헬퍼
 * @param {Buffer} audioBuffer 오디오 파일 바이너리 데이터
 * @param {string} mimeType 오디오 MIME 타입
 * @param {object} context 회의 정보 및 참석자 목록
 * @param {boolean} isFallback Fallback 트리거 여부
 * @returns {Promise<GeminiTranscriptionResult>} 통일된 전사 결과 객체
 */
export async function transcribeAudioWithGeminiFallback(
  audioBuffer: Buffer,
  mimeType: string,
  context: {
    meetingTitle?: string;
    agenda?: string;
    attendeeNames?: string[];
  } = {},
  isFallback: boolean = true
): Promise<GeminiTranscriptionResult> {
  if (isFallback) {
    console.log('[transcription] Gemini fallback started');
  } else {
    console.log('[transcription] primary provider: gemini');
  }

  try {
    const rawResult = await transcribeAudioWithGemini(audioBuffer, mimeType, {
      meetingTitle: context.meetingTitle || '산업안전보건 및 위험성평가 회의',
      agenda: context.agenda,
      attendeeNames: context.attendeeNames,
    });

    if (isFallback) {
      console.log('[transcription] Gemini fallback success');
    }

    // 통일된 SpeakerEntry 형식으로 변환
    const speakers: SpeakerEntry[] = (rawResult.speakers || []).map((s: any, idx: number) => {
      const startTime = typeof s.startTime === 'number' ? s.startTime : idx * 5;
      const endTime = typeof s.endTime === 'number' ? s.endTime : startTime + 4.5;
      return {
        speaker: s.speaker || `화자 ${idx + 1}`,
        startTime: Math.round(startTime * 10) / 10,
        endTime: Math.round(endTime * 10) / 10,
        text: s.text || '',
      };
    });

    return {
      success: true,
      provider: 'gemini',
      fallbackUsed: isFallback,
      speakers,
      fullTranscript: rawResult.fullTranscript || '',
      summary: rawResult.summary || null,
      transcripts: rawResult.transcripts || [],
    };
  } catch (err: any) {
    if (isFallback) {
      console.error('[transcription] Gemini fallback failure:', err?.message || String(err));
    }
    throw err;
  }
}
