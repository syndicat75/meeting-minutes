/**
 * @file src/services/transcriptCorrectionClientService.ts
 * @description 대화록 AI 문맥 검토 및 오타 교정 클라이언트 서비스.
 * 전체 회의 문맥, 안건, 참석자 명단, 사전 등록된 전문용어를 기반으로
 * 서버의 전용 텍스트 모델(/api/ai/correct-transcript)을 호출하고,
 * 교정 제안 검토, 선택/일괄 적용, 원문 복원(Undo)을 관리합니다.
 */

import { TranscriptSegment, Attendee } from '../types/meeting';
import { getFirebaseIdToken } from './firebase';
import { logger } from '../utils/logger';

/**
 * 교정 강도 수준
 */
export type CorrectionLevel = 'minimal' | 'context' | 'formal';

/**
 * 개별 발언 교정 제안 인터페이스
 */
export interface SegmentCorrectionProposal {
  segmentId: string;
  originalText: string;
  correctedText: string;
  hasChanges: boolean;
  reason: string;
  isUncertain: boolean;
  confidence: number;
}

/**
 * AI 문맥 교정 응답 인터페이스
 */
export interface ContextCorrectionResponse {
  success: boolean;
  provider: 'openai' | 'gemini';
  model: string;
  proposals: SegmentCorrectionProposal[];
  summaryMessage: string;
  changedCount: number;
  totalCount: number;
}

/**
 * 서버에 AI 문맥 검토 및 오타 교정 요청
 * @param meetingId 회의 ID
 * @param meetingTitle 회의 제목
 * @param agenda 주요 안건
 * @param department 주관 부서
 * @param attendees 참석자 명단
 * @param customTerms 전문용어 사전
 * @param segments 교정 대상 대화록 세그먼트
 * @param correctionLevel 교정 강도 ('minimal' | 'context' | 'formal')
 * @param excludeUserEdited 사용자가 수정한 발언 제외 여부 (기본값: true)
 * @returns {Promise<ContextCorrectionResponse>} AI 교정 제안 결과
 */
export async function requestTranscriptContextCorrection(params: {
  meetingId: string;
  meetingTitle?: string;
  agenda?: string;
  department?: string;
  attendees?: Attendee[];
  customTerms?: string[];
  segments: TranscriptSegment[];
  correctionLevel?: CorrectionLevel;
  excludeUserEdited?: boolean;
}): Promise<ContextCorrectionResponse> {
  logger.info('requestTranscriptContextCorrection called', {
    meetingId: params.meetingId,
    level: params.correctionLevel,
    segmentCount: params.segments.length,
    excludeUserEdited: params.excludeUserEdited,
    customTermsCount: params.customTerms?.length,
  });

  const token = await getFirebaseIdToken();
  if (!token) {
    throw new Error('인증 토큰이 없습니다. 먼저 로그인해주세요.');
  }

  const response = await fetch('/api/ai/correct-transcript', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({
      meetingId: params.meetingId,
      meetingTitle: params.meetingTitle,
      agenda: params.agenda,
      department: params.department,
      attendees: (params.attendees || []).map((a) => ({
        name: a.name,
        role: a.role,
        position: a.position,
      })),
      customTerms: params.customTerms || [],
      segments: params.segments.map((s) => ({
        id: s.id,
        speakerId: s.speakerId,
        speakerName: s.speakerName,
        startSeconds: s.startSeconds,
        endSeconds: s.endSeconds,
        text: s.text,
        isUserEdited: s.isUserEdited,
      })),
      correctionLevel: params.correctionLevel || 'context',
      excludeUserEdited: params.excludeUserEdited ?? true,
    }),
  });

  if (!response.ok) {
    let errorDetail = `AI 문맥 교정 요청 실패 (HTTP ${response.status})`;
    try {
      const errJson = await response.json();
      if (errJson.error) {
        errorDetail = errJson.detail && errJson.detail !== errJson.error
          ? `${errJson.error} - ${errJson.detail}`
          : errJson.error;
      }
    } catch {
      // 무시
    }
    logger.error('requestTranscriptContextCorrection failed', { status: response.status, errorDetail });
    throw new Error(errorDetail);
  }

  const data: ContextCorrectionResponse = await response.json();
  logger.info('requestTranscriptContextCorrection succeeded', {
    provider: data.provider,
    model: data.model,
    changedCount: data.changedCount,
    totalCount: data.totalCount,
  });

  return data;
}

/**
 * 승인된 AI 교정 제안을 대화록 배열에 일괄 적용
 * @param currentTranscripts 현재 전체 세그먼트 배열
 * @param approvedSegmentIds 승인된 세그먼트 ID Set
 * @param proposalsMap 세그먼트 ID별 교정 제안 Map
 * @returns {TranscriptSegment[]} 갱신된 대화록 세그먼트 배열
 */
export function applyCorrectionsToTranscripts(
  currentTranscripts: TranscriptSegment[],
  approvedSegmentIds: Set<string>,
  proposalsMap: Map<string, SegmentCorrectionProposal>
): TranscriptSegment[] {
  logger.info('applyCorrectionsToTranscripts called', {
    totalTranscripts: currentTranscripts.length,
    approvedCount: approvedSegmentIds.size,
  });

  const nowIso = new Date().toISOString();

  return currentTranscripts.map((seg) => {
    if (!approvedSegmentIds.has(seg.id)) {
      return seg;
    }

    const proposal = proposalsMap.get(seg.id);
    if (!proposal || !proposal.hasChanges) {
      return seg;
    }

    // 원문 보존: 최초 원문이 없으면 현재 텍스트를 원문으로 저장
    const originalAiText = seg.originalAiText || seg.originalText || seg.text;
    const originalText = seg.originalText || originalAiText;

    return {
      ...seg,
      originalAiText,
      originalText,
      editedText: proposal.correctedText,
      text: proposal.correctedText,
      correctionStatus: 'approved',
      editedBy: 'ai_context',
      editedAt: nowIso,
      correctionReason: proposal.reason,
      needsReview: proposal.isUncertain ? true : seg.needsReview,
      // 사용자 수동 직접 수정 플래그는 유지하되, AI 교정이 적용되었음을 구분
    };
  });
}

/**
 * AI 교정 전체 되돌리기 (모든 AI 교정 발언을 원래 AI 최초 전사 원문으로 복원)
 * @param transcripts 현재 대화록 세그먼트 배열
 * @returns {TranscriptSegment[]} 복원된 대화록 세그먼트 배열
 */
export function revertAllAiCorrections(
  transcripts: TranscriptSegment[]
): TranscriptSegment[] {
  logger.info('revertAllAiCorrections called', { totalTranscripts: transcripts.length });

  return transcripts.map((seg) => {
    // AI 문맥 교정으로 변경된 발언만 복원 (사용자가 직접 수정한 발언은 보존)
    if (seg.editedBy === 'ai_context') {
      const originalText = seg.originalAiText || seg.originalText || seg.text;
      return {
        ...seg,
        text: originalText,
        editedText: originalText,
        correctionStatus: 'none',
        editedBy: 'none',
        correctionReason: undefined,
      };
    }
    return seg;
  });
}
