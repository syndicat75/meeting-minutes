/**
 * @file src/services/transcriptionClientService.ts
 * @description 클라이언트 측 다중 청크 순차/병렬 전사 오케스트레이션 및 대화록 병합 서비스.
 * API Rate Limit 방지를 위해 동시 처리 수(최대 2개)를 제어하며,
 * 이미 성공한 구간은 재전사하지 않고 실패 구간만 부분 재시도할 수 있도록 보장합니다.
 */

import { AudioChunk, TranscriptSegment, MeetingSummary, StructuredActionItem, ManualEntry, ManualActionItem } from '../types/meeting';
import { updateChunkTranscriptionStatus } from './audioChunkService';
import { getFirebaseIdToken } from './firebase';
import { logger } from '../utils/logger';
import { APP_CONFIG } from '../config/appConfig';

/**
 * 요약 생성 시 통합할 추가 사용자 작성 컨텍스트 인터페이스
 */
export interface ComprehensiveSummaryExtraContext {
  manualEntries?: ManualEntry[];
  freeformMemo?: string;
  manualActionItems?: ManualActionItem[];
}

/**
 * 전사 진행 상황 콜백 인터페이스
 */
export interface TranscriptionProgressCallback {
  (
    completedChunks: number,
    totalChunks: number,
    progressPercent: number,
    currentChunkLabel: string
  ): void;
}

/**
 * 개별 청크 전사 API 호출
 * @param meetingId 회의 ID
 * @param chunk 대상 청크 객체
 * @param meetingContext 회의 안건 및 제목
 * @returns {Promise<TranscriptSegment[]>} 생성된 세그먼트 배열
 */
export async function transcribeSingleChunk(
  meetingId: string,
  chunk: AudioChunk,
  meetingContext: {
    meetingTitle?: string;
    agenda?: string;
    attendeeNames?: string[];
    expectedSpeakerCount?: number;
  } = {}
): Promise<{
  transcripts: TranscriptSegment[];
  provider: 'openai' | 'gemini';
  fallbackUsed: boolean;
}> {
  logger.info('transcribeSingleChunk called', {
    meetingId,
    chunkId: chunk.id,
    startSeconds: chunk.startSeconds,
    expectedSpeakerCount: meetingContext.expectedSpeakerCount,
  });

  const token = await getFirebaseIdToken();
  if (!token) {
    throw new Error('인증 토큰이 없습니다. 먼저 로그인해주세요.');
  }

  // Firestore 상태: processing으로 갱신
  await updateChunkTranscriptionStatus(meetingId, chunk.id, {
    transcriptionStatus: 'processing',
    transcriptionStartedAt: new Date().toISOString(),
    errorMessage: null,
  });

  const response = await fetch('/api/ai/transcribe-chunk', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({
      meetingId,
      chunkId: chunk.id,
      chunkIndex: chunk.index,
      startSeconds: chunk.startSeconds,
      endSeconds: chunk.endSeconds,
      audioStoragePath: chunk.storagePath,
      audioUrl: chunk.downloadUrl,
      meetingTitle: meetingContext.meetingTitle,
      agenda: meetingContext.agenda,
      attendeeNames: meetingContext.attendeeNames,
      expectedSpeakerCount: meetingContext.expectedSpeakerCount,
    }),
  });

  if (!response.ok) {
    let errorDetail = `전사 API 요청 실패 (HTTP ${response.status})`;
    try {
      const errJson = await response.json();
      if (errJson.error) {
        errorDetail = errJson.detail && errJson.detail !== errJson.error
          ? `${errJson.error} - ${errJson.detail}`
          : errJson.error;
      } else if (errJson.detail) {
        errorDetail = errJson.detail;
      }
    } catch {
      // 무시
    }

    console.error('[transcriptionClientService] Chunk transcription failed', {
      chunkId: chunk.id,
      status: response.status,
      errorDetail,
    });

    await updateChunkTranscriptionStatus(meetingId, chunk.id, {
      transcriptionStatus: 'failed',
      errorMessage: errorDetail,
      transcriptionAttempts: (chunk.transcriptionAttempts || 0) + 1,
    });

    throw new Error(`[${chunk.id}] ${errorDetail}`);
  }

  const data = await response.json();
  const rawSegments: any[] = data.transcripts || data.segments || [];

  // 시간 오프셋 보정 및 클라이언트 TranscriptSegment 규격 정규화
  const adjustedSegments: TranscriptSegment[] = rawSegments.map((seg, idx) => ({
    id: seg.id || `seg-${chunk.id}-${idx + 1}`,
    startSeconds: Math.round(Number(seg.startSeconds || 0)),
    endSeconds: Math.round(Number(seg.endSeconds || (seg.startSeconds || 0) + 3)),
    speakerId: seg.speakerId || `speaker_${chunk.index}_1`,
    speakerName: seg.speakerName || seg.speakerId || '화자',
    text: seg.text || '',
    originalAiText: seg.originalAiText || seg.text || '',
    needsReview: Boolean(seg.needsReview),
    confidence: typeof seg.confidence === 'number' ? seg.confidence : 0.95,
  }));

  // Firestore 상태: completed 및 transcripts 저장
  await updateChunkTranscriptionStatus(meetingId, chunk.id, {
    transcriptionStatus: 'completed',
    transcriptionCompletedAt: new Date().toISOString(),
    provider: data.provider || 'openai',
    transcripts: adjustedSegments,
    transcriptionAttempts: (chunk.transcriptionAttempts || 0) + 1,
    errorMessage: null,
  });

  return {
    transcripts: adjustedSegments,
    provider: data.provider || 'openai',
    fallbackUsed: Boolean(data.fallbackUsed),
  };
}

/**
 * 시간 포맷 헬퍼 (초 -> HH:MM:SS)
 */
function formatSecondsToTime(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  if (h > 0) {
    return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  }
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

/**
 * 전체 또는 실패한 청크들을 동시 2개 병렬 제한(Concurrency Control)으로 일괄 전사 수행
 * @param meetingId 회의 ID
 * @param chunks 청크 목록
 * @param meetingContext 회의 메타데이터
 * @param onProgress 진행률 콜백
 * @param retryOnlyFailed 실패한 청크만 재시도할지 여부
 */
export async function transcribeAllChunks(
  meetingId: string,
  chunks: AudioChunk[],
  meetingContext: {
    meetingTitle?: string;
    agenda?: string;
    attendeeNames?: string[];
    expectedSpeakerCount?: number;
  } = {},
  onProgress?: TranscriptionProgressCallback,
  retryOnlyFailed: boolean = false
): Promise<{
  allSegments: TranscriptSegment[];
  failedChunkIds: string[];
  completedCount: number;
  totalCount: number;
  primaryProvider: string;
  anyFallbackUsed: boolean;
}> {
  logger.info('transcribeAllChunks called', {
    meetingId,
    totalChunks: chunks.length,
    retryOnlyFailed,
  });

  // 대상 청크 필터링 (이미 성공한 청크는 불필요한 API 호출 방지)
  const targetChunks = chunks.filter((c) => {
    if (retryOnlyFailed) {
      return c.transcriptionStatus === 'failed';
    }
    return c.transcriptionStatus !== 'completed';
  });

  const totalCount = chunks.length;
  let completedCount = chunks.filter((c) => c.transcriptionStatus === 'completed').length;
  const failedChunkIds: string[] = [];
  let anyFallbackUsed = false;
  let primaryProvider = 'openai';

  const concurrency = APP_CONFIG.limits.maxConcurrentTranscriptions || 2;
  const queue = [...targetChunks];

  const updateProgress = (currentLabel: string) => {
    const percent = totalCount > 0 ? Math.round((completedCount / totalCount) * 100) : 0;
    if (onProgress) {
      onProgress(completedCount, totalCount, percent, currentLabel);
    }
  };

  updateProgress('전사 준비 중...');

  // 워커 풀을 통한 동시 제한 실행
  const executeWorker = async () => {
    while (queue.length > 0) {
      const chunk = queue.shift();
      if (!chunk) break;

      const timeLabel = `${formatSecondsToTime(chunk.startSeconds)} ~ ${formatSecondsToTime(chunk.endSeconds)}`;
      updateProgress(`[${chunk.index}구간] ${timeLabel} 전사 중...`);

      try {
        const res = await transcribeSingleChunk(meetingId, chunk, meetingContext);
        completedCount += 1;
        chunk.transcripts = res.transcripts;
        chunk.transcriptionStatus = 'completed';
        if (res.fallbackUsed) anyFallbackUsed = true;
        primaryProvider = res.provider;
        updateProgress(`[${chunk.index}구간] 전사 완료`);
      } catch (err: any) {
        logger.error(`Chunk ${chunk.id} failed during batch transcription`, err);
        failedChunkIds.push(chunk.id);
        chunk.transcriptionStatus = 'failed';
        updateProgress(`[${chunk.index}구간] 전사 실패`);
      }
    }
  };

  const workers = Array.from({ length: Math.min(concurrency, queue.length || 1) }, () =>
    executeWorker()
  );

  await Promise.all(workers);

  // 모든 세그먼트 시간순 병합 및 경계 중복 발언 안전 필터링
  const merged = mergeAndDeduplicateTranscripts(chunks);

  updateProgress(
    failedChunkIds.length > 0
      ? `${totalCount - failedChunkIds.length}/${totalCount} 구간 완료 (일부 실패)`
      : '전체 회의 전사 완료'
  );

  return {
    allSegments: merged,
    failedChunkIds,
    completedCount,
    totalCount,
    primaryProvider,
    anyFallbackUsed,
  };
}

/**
 * 여러 청크의 대화록 세그먼트를 시간순으로 정렬하고 청크 경계의 명백한 중복 발언을 안전하게 제거
 * @param chunks 청크 목록
 * @returns {TranscriptSegment[]} 병합된 대화록
 */
export function mergeAndDeduplicateTranscripts(chunks: AudioChunk[]): TranscriptSegment[] {
  logger.info('mergeAndDeduplicateTranscripts called', { chunkCount: chunks.length });

  // 순번에 따라 청크 정렬
  const sortedChunks = [...chunks].sort((a, b) => a.index - b.index);
  const allSegments: TranscriptSegment[] = [];

  for (const chunk of sortedChunks) {
    if (chunk.transcripts && Array.isArray(chunk.transcripts)) {
      allSegments.push(...chunk.transcripts);
    }
  }

  // 시작 시간 오름차순 정렬
  allSegments.sort((a, b) => a.startSeconds - b.startSeconds);

  // 경계 중복 발언 보수적 제거: 5초 이내에 동일한 화자가 정확히 동일한 텍스트를 발화한 경우에만 1개 제거
  const deduplicated: TranscriptSegment[] = [];

  for (let i = 0; i < allSegments.length; i++) {
    const current = allSegments[i];
    if (deduplicated.length > 0) {
      const prev = deduplicated[deduplicated.length - 1];
      const timeDiff = Math.abs(current.startSeconds - prev.startSeconds);
      const isSameText = current.text.trim().toLowerCase() === prev.text.trim().toLowerCase();

      if (timeDiff <= 5 && isSameText && current.text.trim().length > 3) {
        logger.debug('Filtering out boundary duplicate utterance', { text: current.text, timeDiff });
        continue;
      }
    }
    deduplicated.push(current);
  }

  return deduplicated;
}

/**
 * 병합된 전체 대화록을 바탕으로 백엔드 종합 회의 요약 API 호출
 * @param meetingId 회의 ID
 * @param meeting 회의 정보
 * @param transcripts 병합된 세그먼트 배열
 * @returns {Promise<MeetingSummary>} 프론트엔드 호환 회의 요약 객체
 */
export async function requestComprehensiveMeetingSummary(
  meetingId: string,
  meeting: {
    title: string;
    agenda?: string;
    department?: string;
    date?: string;
    attendees?: Array<{ name: string; role?: string; position?: string }>;
  },
  transcripts: TranscriptSegment[],
  extraContext?: ComprehensiveSummaryExtraContext
): Promise<MeetingSummary> {
  logger.info('requestComprehensiveMeetingSummary called', {
    meetingId,
    segmentCount: transcripts?.length || 0,
    manualEntriesCount: extraContext?.manualEntries?.length || 0,
    hasFreeformMemo: Boolean(extraContext?.freeformMemo),
    manualActionItemsCount: extraContext?.manualActionItems?.length || 0,
  });

  const token = await getFirebaseIdToken();
  if (!token) {
    throw new Error('인증 토큰이 없습니다.');
  }

  const transcriptLines: string[] = [];

  // 1. AI 전사 발언
  if (transcripts && transcripts.length > 0) {
    transcriptLines.push('--- [AI 음성 전사 대화록] ---');
    for (const s of transcripts) {
      transcriptLines.push(`[${formatSecondsToTime(s.startSeconds)}] ${s.speakerName || s.speakerId}: ${s.text}`);
    }
  }

  // 2. 사람이 직접 키보드로 작성한 발언 (공식 회의록 포함 대상만)
  if (extraContext?.manualEntries && extraContext.manualEntries.length > 0) {
    const officialEntries = extraContext.manualEntries.filter((e) => e.isOfficial);
    if (officialEntries.length > 0) {
      transcriptLines.push('\n--- [사람이 직접 입력한 회의 발언] ---');
      for (const e of officialEntries) {
        const timeStr = typeof e.timestampSeconds === 'number' ? `[${formatSecondsToTime(e.timestampSeconds)}] ` : '';
        const star = e.isImportant ? ' ⭐[중요]' : '';
        transcriptLines.push(`${timeStr}${e.speakerName}${star}: ${e.text}`);
      }
    }
  }

  // 3. 공식 회의 메모
  if (extraContext?.freeformMemo && extraContext.freeformMemo.trim()) {
    transcriptLines.push('\n--- [회의 중 직접 작성한 메모] ---');
    transcriptLines.push(extraContext.freeformMemo.trim());
  }

  // 4. 직접 등록한 Action Item
  if (extraContext?.manualActionItems && extraContext.manualActionItems.length > 0) {
    transcriptLines.push('\n--- [직접 지정한 후속 조치 과제(Action Items)] ---');
    for (const a of extraContext.manualActionItems) {
      transcriptLines.push(`- ${a.task} (담당: ${a.assignee || '미지정'}, 기한: ${a.dueDate || '미지정'})`);
    }
  }

  const fullTranscript = transcriptLines.join('\n').trim();
  if (!fullTranscript) {
    throw new Error('요약할 회의 내용이 없습니다. 대화록을 전사하거나 직접 발언/메모를 입력해주세요.');
  }

  const response = await fetch('/api/ai/summarize-meeting', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({
      meetingId,
      title: meeting.title,
      agenda: meeting.agenda,
      department: meeting.department,
      date: meeting.date,
      attendees: meeting.attendees,
      fullTranscript,
    }),
  });

  if (!response.ok) {
    let errMsg = '종합 회의 요약 요청 실패';
    try {
      const errJson = await response.json();
      errMsg = errJson.error || errJson.detail || errMsg;
    } catch {
      // 무시
    }
    throw new Error(errMsg);
  }

  const { summary } = await response.json();

  // 기존 MeetingSummary 타입과 완벽 호환되도록 매핑
  const actionItems: StructuredActionItem[] = (summary.actionItems || []).map((ai: any) => ({
    task: ai.task || '',
    assignee: ai.assignee || null,
    dueDate: ai.dueDate || null,
    confidence: ai.confidence || 'medium',
  }));

  const legacySummary: MeetingSummary = {
    executiveSummary: summary.overview || '회의 요약 내용이 없습니다.',
    overview: summary.overview || '',
    keyDiscussions: summary.keyDiscussions || [],
    agendaDiscussions: (summary.keyDiscussions || []).map((kd: string, idx: number) => ({
      agendaTitle: `안건 ${idx + 1}`,
      discussion: kd,
    })),
    decisions: (summary.decisions || []).map((d: string) => ({ text: d })),
    pendingItems: (summary.pendingIssues || []).map((p: string) => ({ text: p })),
    pendingIssues: summary.pendingIssues || [],
    nextSteps: summary.nextSteps || [],
    actionItems: actionItems.map((a, idx) => ({
      id: `act_${Date.now()}_${idx}`,
      task: a.task,
      assignee: a.assignee || '미지정',
      dueDate: a.dueDate || '미지정',
      status: 'pending',
    })),
    structuredActionItems: actionItems,
    suggestedContentRows: [],
    generatedAt: new Date().toISOString(),
    version: 1,
    isReviewedByUser: false,
  };

  return legacySummary;
}
