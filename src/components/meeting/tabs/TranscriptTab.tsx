/**
 * @file src/components/meeting/tabs/TranscriptTab.tsx
 * @description 화자별 대화록 관리 탭 컴포넌트.
 * 주요 기능:
 * 1. 화자 과다 분리 감지 배너 (DiarizationWarningBanner)
 * 2. 예상 화자 수 설정 및 다중 화자 병합 관리 모달 (SpeakerManagementModal)
 * 3. AI 전체 문맥 검토 및 음성인식 오탈자 교정 (AiCorrectionReviewModal)
 * 4. 전문용어(고유명사, 부서명, 설비명) 보호 사전 관리 (CustomTermsModal)
 * 5. 발언별 사전-사후 Diff 비교 및 개별/전체 원문 복원(Undo)
 * 6. 동일 화자 연속 발언 묶어보기 및 TXT 다운로드 지원
 */

import React, { useState, useMemo } from 'react';
import {
  Users,
  Search,
  Play,
  Edit2,
  Check,
  AlertTriangle,
  Download,
  Combine,
  Clock,
  Sparkles,
  RotateCcw,
  Keyboard,
  Mic,
  BookOpen,
  Layers,
  Eye,
  EyeOff,
  Undo2,
  ArrowRight,
  ShieldCheck,
} from 'lucide-react';
import { Meeting, TranscriptSegment, Attendee } from '../../../types/meeting';
import { formatDuration } from '../../../utils/formatters';
import { logger } from '../../../utils/logger';
import { SpeakerManagementModal } from '../transcript/SpeakerManagementModal';
import { AiCorrectionReviewModal } from '../transcript/AiCorrectionReviewModal';
import { CustomTermsModal } from '../transcript/CustomTermsModal';
import { DiarizationWarningBanner } from '../transcript/DiarizationWarningBanner';
import { revertAllAiCorrections } from '../../../services/transcriptCorrectionClientService';

interface TranscriptTabProps {
  meeting: Meeting;
  isReadOnly: boolean;
  onUpdateMeeting: (partial: Partial<Meeting>) => void;
  onJumpAudioTime?: (seconds: number) => void;
}

/**
 * 화자별 대화록 관리 탭 컴포넌트
 */
export const TranscriptTab: React.FC<TranscriptTabProps> = ({
  meeting,
  isReadOnly,
  onUpdateMeeting,
  onJumpAudioTime,
}) => {
  logger.debug('TranscriptTab rendered', {
    segmentCount: meeting.transcripts?.length || 0,
    attendeeCount: meeting.attendees?.length || 0,
  });

  // 검색 및 필터 상태
  const [searchTerm, setSearchTerm] = useState('');
  const [speakerFilter, setSpeakerFilter] = useState<string>('all');
  const [sourceFilter, setSourceFilter] = useState<'all' | 'ai' | 'manual'>('all');
  const [onlyNeedsReview, setOnlyNeedsReview] = useState<boolean>(false);
  const [groupBySpeaker, setGroupBySpeaker] = useState<boolean>(false);

  // 모달 상태
  const [isSpeakerModalOpen, setIsSpeakerModalOpen] = useState(false);
  const [isAiCorrectionModalOpen, setIsAiCorrectionModalOpen] = useState(false);
  const [isCustomTermsModalOpen, setIsCustomTermsModalOpen] = useState(false);

  // 개별 발언 텍스트 인라인 수정 상태
  const [editingSegmentId, setEditingSegmentId] = useState<string | null>(null);
  const [editingText, setEditingText] = useState<string>('');

  // 개별 발언의 사전-사후 비교(Diff) 펼침 상태
  const [comparingSegmentIds, setComparingSegmentIds] = useState<Set<string>>(new Set());

  // 고유 화자 ID 목록 추출
  const uniqueSpeakers = useMemo(() => {
    const set = new Set<string>();
    (meeting.transcripts || []).forEach((seg) => {
      if (seg.speakerId) set.add(seg.speakerId);
    });
    return Array.from(set).sort();
  }, [meeting.transcripts]);

  // 녹음 총 시간(초) 추정
  const estimatedDurationSeconds = useMemo(() => {
    if (meeting.recordedDurationSeconds) return meeting.recordedDurationSeconds;
    if (meeting.recording?.durationSeconds) return meeting.recording.durationSeconds;
    if (meeting.transcripts && meeting.transcripts.length > 0) {
      return Math.max(...meeting.transcripts.map((t) => t.endSeconds || t.startSeconds || 0));
    }
    return 0;
  }, [meeting.recordedDurationSeconds, meeting.recording, meeting.transcripts]);

  // AI 교정 발언이 하나라도 존재하는지 확인
  const hasAiCorrectedSegments = useMemo(() => {
    return (meeting.transcripts || []).some(
      (s) => s.editedBy === 'ai_context' || s.correctionStatus === 'approved'
    );
  }, [meeting.transcripts]);

  // 화자 ID를 참석자 이름으로 변환하는 헬퍼
  const getSpeakerDisplayName = (speakerId: string): string => {
    const mappedAttendeeId = meeting.speakerMapping?.[speakerId];
    if (mappedAttendeeId) {
      const attendee = meeting.attendees.find((a) => a.id === mappedAttendeeId);
      if (attendee) {
        return `${attendee.name} (${attendee.role || attendee.position || '참석자'})`;
      }
    }
    const match = speakerId.match(/speaker_?(\d+)/i);
    if (match) {
      return `화자 ${match[1]}`;
    }
    return speakerId;
  };

  /**
   * 화자 매핑 변경 핸들러
   */
  const handleMapSpeakerToAttendee = (speakerId: string, attendeeId: string) => {
    logger.info('Mapping speaker to attendee', { speakerId, attendeeId });
    const updatedMapping = {
      ...(meeting.speakerMapping || {}),
      [speakerId]: attendeeId,
    };
    onUpdateMeeting({ speakerMapping: updatedMapping });
  };

  /**
   * 단일 화자 원클릭 일괄 통합 (화자 과다 분리 해소)
   */
  const handleMergeToSingleSpeaker = () => {
    logger.info('handleMergeToSingleSpeaker called');
    const targetSpkId = 'speaker_1';
    const singleAttendee = meeting.attendees.length === 1 ? meeting.attendees[0] : null;

    const updatedTranscripts: TranscriptSegment[] = (meeting.transcripts || []).map((seg) => ({
      ...seg,
      speakerId: targetSpkId,
      speakerName: singleAttendee ? singleAttendee.name : '화자 1',
    }));

    const updatedMapping: Record<string, string> = {};
    if (singleAttendee) {
      updatedMapping[targetSpkId] = singleAttendee.id;
    }

    onUpdateMeeting({
      transcripts: updatedTranscripts,
      speakerMapping: updatedMapping,
      expectedSpeakerCount: 1,
    });
  };

  /**
   * 발언 수정 시작
   */
  const handleStartEditing = (itemId: string, currentText: string) => {
    if (isReadOnly) return;
    logger.info('Start editing segment text', { itemId });
    setEditingSegmentId(itemId);
    setEditingText(currentText);
  };

  /**
   * 발언 수정 저장 (AI 전사 또는 직접 작성 발언)
   */
  const handleSaveEditing = (itemId: string) => {
    logger.info('Saving edited segment or entry text', { itemId });

    const isAiSegment = (meeting.transcripts || []).some((s) => s.id === itemId);
    if (isAiSegment) {
      const updatedTranscripts = (meeting.transcripts || []).map((seg) => {
        if (seg.id === itemId) {
          const originalAiText = seg.originalAiText || seg.originalText || seg.text;
          return {
            ...seg,
            text: editingText,
            editedText: editingText,
            originalAiText,
            originalText: seg.originalText || originalAiText,
            isUserEdited: true,
            editedBy: 'user' as const,
            editedAt: new Date().toISOString(),
          };
        }
        return seg;
      });
      onUpdateMeeting({ transcripts: updatedTranscripts });
    } else {
      const updatedEntries = (meeting.manualEntries || []).map((entry) => {
        if (entry.id === itemId) {
          return {
            ...entry,
            content: editingText,
            updatedAt: new Date().toISOString(),
          };
        }
        return entry;
      });
      onUpdateMeeting({ manualEntries: updatedEntries });
    }

    setEditingSegmentId(null);
  };

  /**
   * 개별 발언을 최초 AI 원문으로 복원
   */
  const handleRevertIndividualSegment = (segmentId: string) => {
    logger.info('Reverting segment to original AI text', { segmentId });
    const updatedTranscripts = (meeting.transcripts || []).map((seg) => {
      if (seg.id === segmentId) {
        const original = seg.originalAiText || seg.originalText || seg.text;
        return {
          ...seg,
          text: original,
          editedText: original,
          correctionStatus: 'none' as const,
          editedBy: 'none' as const,
          isUserEdited: false,
          correctionReason: undefined,
        };
      }
      return seg;
    });
    onUpdateMeeting({ transcripts: updatedTranscripts });
    setEditingSegmentId(null);
  };

  /**
   * AI 문맥 교정 전체 되돌리기
   */
  const handleRevertAllAiCorrections = () => {
    if (!window.confirm('AI 문맥 교정으로 제안·적용된 모든 문장을 원래 AI 전사 원본으로 복원하시겠습니까? (사용자가 직접 수정한 내용은 보존됩니다)')) {
      return;
    }
    logger.info('handleRevertAllAiCorrections confirmed');
    const reverted = revertAllAiCorrections(meeting.transcripts || []);
    onUpdateMeeting({ transcripts: reverted });
  };

  /**
   * 개별 발언 사전-사후 비교(Diff) 토글
   */
  const handleToggleDiffComparison = (segmentId: string) => {
    const next = new Set(comparingSegmentIds);
    if (next.has(segmentId)) {
      next.delete(segmentId);
    } else {
      next.add(segmentId);
    }
    setComparingSegmentIds(next);
  };

  /**
   * 확인 필요(needsReview) 토글
   */
  const handleToggleNeedsReview = (segmentId: string) => {
    if (isReadOnly) return;
    logger.info('Toggling needsReview on segment', { segmentId });
    const updatedTranscripts = (meeting.transcripts || []).map((seg) => {
      if (seg.id === segmentId) {
        return { ...seg, needsReview: !seg.needsReview };
      }
      return seg;
    });
    onUpdateMeeting({ transcripts: updatedTranscripts });
  };

  /**
   * 통합 대화록(AI 전사 + 직접 작성 발언) 목록 생성 (timestamp 기준 정렬)
   */
  const unifiedItems = useMemo(() => {
    const items: Array<{
      id: string;
      kind: 'ai' | 'manual';
      speakerId: string;
      speakerName: string;
      startSeconds: number;
      endSeconds: number;
      text: string;
      originalAiText?: string;
      originalText?: string;
      editedText?: string;
      correctionStatus?: string;
      editedBy?: 'user' | 'ai_context' | 'none';
      correctionReason?: string;
      isUserEdited?: boolean;
      needsReview?: boolean;
      createdAt?: string;
    }> = [];

    // AI 전사 세그먼트 추가
    (meeting.transcripts || []).forEach((seg) => {
      items.push({
        id: seg.id,
        kind: 'ai',
        speakerId: seg.speakerId,
        speakerName: getSpeakerDisplayName(seg.speakerId),
        startSeconds: seg.startSeconds || 0,
        endSeconds: seg.endSeconds || (seg.startSeconds || 0) + 5,
        text: seg.text,
        originalAiText: seg.originalAiText,
        originalText: seg.originalText,
        editedText: seg.editedText,
        correctionStatus: seg.correctionStatus,
        editedBy: seg.editedBy,
        correctionReason: seg.correctionReason,
        isUserEdited: seg.isUserEdited,
        needsReview: seg.needsReview,
      });
    });

    // 직접 작성 발언 항목 추가
    (meeting.manualEntries || []).forEach((entry) => {
      items.push({
        id: entry.id,
        kind: 'manual',
        speakerId: `manual_${entry.speakerName}`,
        speakerName: entry.speakerName,
        startSeconds: entry.timestampSeconds || 0,
        endSeconds: (entry.timestampSeconds || 0) + 10,
        text: entry.content,
        originalAiText: undefined,
        isUserEdited: false,
        needsReview: false,
        createdAt: entry.createdAt,
      });
    });

    // 시간순 정렬
    return items.sort((a, b) => {
      if (a.startSeconds !== b.startSeconds) {
        return a.startSeconds - b.startSeconds;
      }
      return (a.createdAt || '').localeCompare(b.createdAt || '');
    });
  }, [meeting.transcripts, meeting.manualEntries, meeting.speakerMapping]);

  /**
   * 대화록 TXT 파일 다운로드
   */
  const handleDownloadTxt = () => {
    logger.info('handleDownloadTxt called');
    const lines = unifiedItems.map((item) => {
      const tag = item.kind === 'manual' ? '[직접작성]' : '[AI전사]';
      const time = `[${formatDuration(item.startSeconds)} ~ ${formatDuration(item.endSeconds)}]`;
      return `${time} ${tag} ${item.speakerName}: ${item.text}`;
    });

    const content =
      `[${meeting.title}] 대화록 전문 (AI 전사 및 직접 작성 통합)\n` +
      `일시: ${meeting.date} (${meeting.startTime}~${meeting.endTime})\n` +
      `장소: ${meeting.location || '미정'}\n\n` +
      lines.join('\n\n');

    const blob = new Blob([content], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `${meeting.title}_통합대화록.txt`;
    link.click();
    URL.revokeObjectURL(url);
  };

  // 필터링 적용
  const filteredItems = useMemo(() => {
    return unifiedItems.filter((item) => {
      if (sourceFilter === 'ai' && item.kind !== 'ai') return false;
      if (sourceFilter === 'manual' && item.kind !== 'manual') return false;
      if (speakerFilter !== 'all' && item.speakerId !== speakerFilter) return false;
      if (onlyNeedsReview && !item.needsReview) return false;

      if (searchTerm.trim()) {
        const q = searchTerm.toLowerCase();
        const inText = item.text.toLowerCase().includes(q);
        const inSpeaker = item.speakerName.toLowerCase().includes(q);
        if (!inText && !inSpeaker) return false;
      }
      return true;
    });
  }, [unifiedItems, sourceFilter, speakerFilter, onlyNeedsReview, searchTerm]);

  return (
    <div className="space-y-5">
      {/* 1. 화자 과다 분리 비정상 감지 배너 */}
      <DiarizationWarningBanner
        durationSeconds={estimatedDurationSeconds}
        speakerCount={uniqueSpeakers.length}
        onMergeToSingle={handleMergeToSingleSpeaker}
        onOpenSpeakerModal={() => setIsSpeakerModalOpen(true)}
        isReadOnly={isReadOnly}
      />

      {/* 2. 대화록 주요 AI 제어 및 관리 툴바 */}
      <div className="bg-white rounded-xl border border-slate-200 shadow-2xs p-4 flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2">
          {/* 화자 관리 모달 열기 버튼 */}
          <button
            type="button"
            onClick={() => setIsSpeakerModalOpen(true)}
            className="inline-flex items-center space-x-1.5 px-3 py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-800 text-xs font-semibold rounded-lg transition-colors shadow-2xs"
          >
            <Users className="w-3.5 h-3.5 text-blue-600" />
            <span>화자 관리</span>
            <span className="px-1.5 py-0.2 bg-white text-slate-700 rounded text-[11px] font-mono border border-slate-200">
              {uniqueSpeakers.length}명
            </span>
            {meeting.expectedSpeakerCount && meeting.expectedSpeakerCount > 0 ? (
              <span className="text-[10px] text-blue-600 font-medium">
                (설정: {meeting.expectedSpeakerCount}명)
              </span>
            ) : null}
          </button>

          {/* AI 문맥 검토 및 오타 교정 모달 열기 버튼 */}
          <button
            type="button"
            disabled={isReadOnly || !meeting.transcripts || meeting.transcripts.length === 0}
            onClick={() => setIsAiCorrectionModalOpen(true)}
            className="inline-flex items-center space-x-1.5 px-3.5 py-1.5 bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-700 hover:to-indigo-700 disabled:opacity-50 text-white text-xs font-bold rounded-lg shadow-2xs transition-all"
          >
            <Sparkles className="w-3.5 h-3.5 text-amber-300" />
            <span>AI 문맥 교정</span>
          </button>

          {/* 전문용어 사전 모달 열기 버튼 */}
          <button
            type="button"
            onClick={() => setIsCustomTermsModalOpen(true)}
            className="inline-flex items-center space-x-1.5 px-3 py-1.5 bg-slate-50 hover:bg-slate-100 text-slate-700 text-xs font-semibold rounded-lg border border-slate-200 transition-colors"
          >
            <BookOpen className="w-3.5 h-3.5 text-slate-600" />
            <span>전문용어 사전</span>
            {meeting.customTerms && meeting.customTerms.length > 0 && (
              <span className="px-1.5 py-0.2 bg-blue-100 text-blue-800 rounded text-[10px] font-bold">
                {meeting.customTerms.length}
              </span>
            )}
          </button>

          {/* AI 교정 전체 되돌리기 버튼 */}
          {hasAiCorrectedSegments && !isReadOnly && (
            <button
              type="button"
              onClick={handleRevertAllAiCorrections}
              className="inline-flex items-center space-x-1 px-2.5 py-1.5 text-xs text-rose-700 bg-rose-50 hover:bg-rose-100 border border-rose-200 rounded-lg font-semibold transition-colors"
              title="모든 AI 교정 문장을 원래 AI 전사 원본으로 복원합니다."
            >
              <RotateCcw className="w-3 h-3" />
              <span>AI 교정 원문 복원</span>
            </button>
          )}
        </div>

        {/* 우측 보조 컨트롤: 동일 화자 묶어보기 및 TXT 다운로드 */}
        <div className="flex items-center space-x-2">
          <button
            type="button"
            onClick={() => setGroupBySpeaker(!groupBySpeaker)}
            className={`inline-flex items-center space-x-1 px-2.5 py-1.5 text-xs font-semibold rounded-lg border transition-colors ${
              groupBySpeaker
                ? 'bg-blue-50 text-blue-700 border-blue-200'
                : 'bg-slate-50 text-slate-600 border-slate-200 hover:bg-slate-100'
            }`}
            title="동일한 화자의 연속된 발언을 하나로 묶어 가독성을 높입니다."
          >
            <Layers className="w-3.5 h-3.5" />
            <span className="hidden sm:inline">화자별 묶어보기</span>
          </button>

          <button
            type="button"
            onClick={handleDownloadTxt}
            className="inline-flex items-center space-x-1.5 px-3 py-1.5 bg-slate-800 hover:bg-slate-900 text-white text-xs font-semibold rounded-lg shadow-2xs transition-colors shrink-0"
            title="대화록 전문 TXT 파일 다운로드"
          >
            <Download className="w-3.5 h-3.5" />
            <span className="hidden sm:inline">TXT 내보내기</span>
          </button>
        </div>
      </div>

      {/* 3. 화자 - 참석자 인라인 빠른 연결 바 */}
      {uniqueSpeakers.length > 0 && (
        <div className="bg-white rounded-xl border border-slate-200 shadow-2xs p-4 space-y-3">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-slate-100 pb-2.5">
            <div className="flex items-center space-x-2">
              <Users className="w-4 h-4 text-blue-600" />
              <h4 className="text-xs font-bold text-slate-900">화자 - 참석자 이름 연결 (매핑)</h4>
            </div>
            {!isReadOnly && (
              <button
                type="button"
                onClick={() => setIsSpeakerModalOpen(true)}
                className="text-xs text-blue-600 hover:text-blue-800 font-semibold"
              >
                화자 일괄 관리 및 병합 &rarr;
              </button>
            )}
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-2.5">
            {uniqueSpeakers.map((spkId) => {
              const currentAttId = meeting.speakerMapping?.[spkId] || '';
              return (
                <div key={spkId} className="p-2.5 bg-slate-50 border border-slate-200 rounded-lg space-y-1.5">
                  <div className="flex items-center justify-between text-xs">
                    <span className="font-bold text-slate-800 font-mono">{spkId}</span>
                    <span className="text-[11px] text-slate-500">
                      발언 {(meeting.transcripts || []).filter((s) => s.speakerId === spkId).length}회
                    </span>
                  </div>

                  <select
                    disabled={isReadOnly}
                    value={currentAttId}
                    onChange={(e) => handleMapSpeakerToAttendee(spkId, e.target.value)}
                    className="w-full text-xs p-1.5 bg-white border border-slate-300 rounded-md focus:ring-1 focus:ring-blue-500 disabled:bg-slate-100 font-medium"
                  >
                    <option value="">(실제 참석자 선택 연결)</option>
                    {meeting.attendees.map((att) => (
                      <option key={att.id} value={att.id}>
                        {att.name} ({att.role || att.position})
                      </option>
                    ))}
                  </select>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* 4. 검색 및 필터 바 */}
      <div className="bg-white p-3.5 rounded-xl border border-slate-200 shadow-2xs flex flex-col md:flex-row items-center gap-3">
        {/* 출처 탭 필터 (전체 / AI 전사 / 직접 작성) */}
        <div className="flex items-center p-1 bg-slate-100 rounded-lg shrink-0 w-full md:w-auto">
          <button
            type="button"
            onClick={() => setSourceFilter('all')}
            className={`px-3 py-1.5 rounded-md text-xs font-semibold transition-colors flex-1 md:flex-initial ${
              sourceFilter === 'all'
                ? 'bg-white text-slate-800 shadow-2xs'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            전체 ({unifiedItems.length})
          </button>
          <button
            type="button"
            onClick={() => setSourceFilter('ai')}
            className={`flex items-center justify-center space-x-1 px-3 py-1.5 rounded-md text-xs font-semibold transition-colors flex-1 md:flex-initial ${
              sourceFilter === 'ai'
                ? 'bg-white text-blue-700 shadow-2xs'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            <Mic className="w-3 h-3" />
            <span>AI 전사 ({(meeting.transcripts || []).length})</span>
          </button>
          <button
            type="button"
            onClick={() => setSourceFilter('manual')}
            className={`flex items-center justify-center space-x-1 px-3 py-1.5 rounded-md text-xs font-semibold transition-colors flex-1 md:flex-initial ${
              sourceFilter === 'manual'
                ? 'bg-white text-purple-700 shadow-2xs'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            <Keyboard className="w-3 h-3" />
            <span>직접 작성 ({(meeting.manualEntries || []).length})</span>
          </button>
        </div>

        {/* 텍스트 검색 입력창 */}
        <div className="relative flex-1 w-full">
          <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
          <input
            type="text"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            placeholder="발언 내용 또는 화자명 검색..."
            className="w-full pl-9 pr-4 py-1.5 text-xs bg-slate-50 border border-slate-200 rounded-lg focus:ring-1 focus:ring-blue-500 font-medium"
          />
        </div>

        <div className="flex items-center space-x-2 w-full md:w-auto">
          {/* 화자별 필터 */}
          <select
            value={speakerFilter}
            onChange={(e) => setSpeakerFilter(e.target.value)}
            className="text-xs p-1.5 bg-slate-50 border border-slate-200 rounded-lg text-slate-700 font-medium"
          >
            <option value="all">모든 화자</option>
            {uniqueSpeakers.map((spk) => (
              <option key={spk} value={spk}>
                {getSpeakerDisplayName(spk)}
              </option>
            ))}
          </select>

          {/* 확인 필요 필터 토글 */}
          <button
            type="button"
            onClick={() => setOnlyNeedsReview(!onlyNeedsReview)}
            className={`px-3 py-1.5 text-xs font-semibold rounded-lg border transition-colors flex items-center space-x-1 ${
              onlyNeedsReview
                ? 'bg-amber-100 text-amber-900 border-amber-300'
                : 'bg-slate-50 text-slate-600 border-slate-200 hover:bg-slate-100'
            }`}
          >
            <AlertTriangle className="w-3.5 h-3.5 text-amber-600" />
            <span>확인 필요만 보기</span>
          </button>
        </div>
      </div>

      {/* 5. 발언 타임라인 목록 */}
      {filteredItems.length === 0 ? (
        <div className="bg-white rounded-xl border border-slate-200 p-12 text-center text-slate-500 text-xs">
          대화록 데이터가 없습니다. [녹음 및 오디오] 탭에서 녹음 후 AI 전사를 실행하거나 [직접 작성] 탭에서 키보드로 회의내용을 입력해주세요.
        </div>
      ) : (
        <div className="space-y-3">
          {filteredItems.map((item) => {
            const isEditing = editingSegmentId === item.id;
            const isManual = item.kind === 'manual';
            const isAiCorrected = item.editedBy === 'ai_context' || item.correctionStatus === 'approved';
            const isShowingDiff = comparingSegmentIds.has(item.id);
            const originalSourceText = item.originalAiText || item.originalText;

            return (
              <div
                key={item.id}
                id={`transcript-segment-${item.id}`}
                className={`bg-white rounded-xl border p-4 shadow-2xs transition-all ${
                  item.needsReview
                    ? 'border-amber-300 bg-amber-50/20'
                    : isAiCorrected
                    ? 'border-emerald-200 bg-emerald-50/10'
                    : isManual
                    ? 'border-purple-200 bg-purple-50/15'
                    : 'border-slate-200'
                }`}
              >
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 mb-2">
                  {/* 화자 및 타임스탬프 */}
                  <div className="flex items-center space-x-2.5 flex-wrap gap-y-1">
                    {/* 출처 배지 */}
                    {isManual ? (
                      <span className="px-2 py-0.5 rounded-md bg-purple-100 text-purple-800 text-[10px] font-bold flex items-center space-x-1">
                        <Keyboard className="w-3 h-3" />
                        <span>직접 작성</span>
                      </span>
                    ) : (
                      <span className="px-2 py-0.5 rounded-md bg-blue-50 text-blue-700 text-[10px] font-bold flex items-center space-x-1">
                        <Mic className="w-3 h-3" />
                        <span>AI 전사</span>
                      </span>
                    )}

                    <span className="px-2.5 py-0.5 rounded-full bg-slate-100 text-slate-800 text-xs font-bold">
                      {item.speakerName}
                    </span>

                    {/* 오디오 타임스탬프 */}
                    {!isManual && onJumpAudioTime ? (
                      <button
                        type="button"
                        onClick={() => onJumpAudioTime(item.startSeconds)}
                        className="flex items-center space-x-1 text-slate-500 hover:text-blue-600 text-xs font-mono transition-colors"
                        title="해당 발언 시점부터 오디오 재생"
                      >
                        <Play className="w-3 h-3" />
                        <span>{formatDuration(item.startSeconds)}</span>
                        <span>~</span>
                        <span>{formatDuration(item.endSeconds)}</span>
                      </button>
                    ) : (
                      <span className="flex items-center space-x-1 text-slate-400 text-xs font-mono">
                        <Clock className="w-3 h-3" />
                        <span>{formatDuration(item.startSeconds)}</span>
                      </span>
                    )}

                    {/* AI 교정 배지 */}
                    {isAiCorrected && (
                      <span className="inline-flex items-center space-x-1 px-2 py-0.5 rounded-md bg-emerald-100 text-emerald-800 text-[10px] font-bold">
                        <Sparkles className="w-3 h-3 text-emerald-600" />
                        <span>AI 문맥 교정됨</span>
                      </span>
                    )}

                    {/* 사용자 직접 수정 배지 */}
                    {item.isUserEdited && !isAiCorrected && (
                      <span className="text-[10px] px-1.5 py-0.5 rounded bg-slate-100 text-slate-600 font-medium">
                        사용자 수정됨
                      </span>
                    )}

                    {/* 확인 필요 배지 */}
                    {item.needsReview && (
                      <span className="text-[10px] px-2 py-0.5 rounded-full bg-amber-100 text-amber-800 font-bold flex items-center space-x-1">
                        <AlertTriangle className="w-3 h-3 text-amber-600" />
                        <span>확인 필요</span>
                      </span>
                    )}
                  </div>

                  {/* 컨트롤 버튼 군 */}
                  {!isReadOnly && (
                    <div className="flex items-center space-x-1.5 text-xs">
                      {/* AI 교정된 경우: 원문 비교 토글 버튼 */}
                      {isAiCorrected && originalSourceText && originalSourceText !== item.text && (
                        <button
                          type="button"
                          onClick={() => handleToggleDiffComparison(item.id)}
                          className={`inline-flex items-center space-x-1 px-2 py-1 rounded text-[11px] font-medium transition-colors ${
                            isShowingDiff
                              ? 'bg-emerald-100 text-emerald-800'
                              : 'text-emerald-700 hover:bg-emerald-50'
                          }`}
                          title="교정 전 원문과 비교"
                        >
                          {isShowingDiff ? <EyeOff className="w-3 h-3" /> : <Eye className="w-3 h-3" />}
                          <span>{isShowingDiff ? '원문 접기' : '원문 비교'}</span>
                        </button>
                      )}

                      {/* AI 교정 또는 수정된 경우: 개별 원문 복원 버튼 */}
                      {(isAiCorrected || item.isUserEdited) && (
                        <button
                          type="button"
                          onClick={() => handleRevertIndividualSegment(item.id)}
                          className="inline-flex items-center space-x-1 px-2 py-1 text-slate-500 hover:text-slate-800 hover:bg-slate-100 rounded text-[11px] transition-colors"
                          title="최초 AI 전사 원본으로 복원"
                        >
                          <Undo2 className="w-3 h-3" />
                          <span>원문 복원</span>
                        </button>
                      )}

                      {/* 확인 필요 토글 버튼 (AI 전사 항목만) */}
                      {!isManual && (
                        <button
                          type="button"
                          onClick={() => handleToggleNeedsReview(item.id)}
                          className={`px-2 py-1 rounded transition-colors text-[11px] font-medium ${
                            item.needsReview
                              ? 'bg-amber-100 text-amber-800 hover:bg-amber-200'
                              : 'text-slate-400 hover:text-amber-600 hover:bg-slate-100'
                          }`}
                        >
                          {item.needsReview ? '확인 해제' : '확인 필요'}
                        </button>
                      )}

                      {/* 발언 텍스트 인라인 수정 버튼 */}
                      {!isEditing && (
                        <button
                          type="button"
                          onClick={() => handleStartEditing(item.id, item.text)}
                          className="p-1 text-slate-500 hover:text-blue-600 rounded hover:bg-slate-100"
                          title="발언 텍스트 직접 수정"
                        >
                          <Edit2 className="w-3.5 h-3.5" />
                        </button>
                      )}
                    </div>
                  )}
                </div>

                {/* 사전-사후 Diff 비교 뷰 (펼침 상태일 때) */}
                {isShowingDiff && originalSourceText && (
                  <div className="mb-3 p-3 bg-slate-50 border border-slate-200 rounded-lg grid grid-cols-1 sm:grid-cols-2 gap-2.5 text-xs">
                    <div className="p-2 bg-rose-50/60 border border-rose-100 rounded">
                      <div className="text-[10px] font-bold text-rose-700 mb-0.5">최초 전사 원문</div>
                      <p className="text-slate-600 line-through leading-relaxed">{originalSourceText}</p>
                    </div>
                    <div className="p-2 bg-emerald-50/70 border border-emerald-200 rounded">
                      <div className="text-[10px] font-bold text-emerald-800 mb-0.5 flex items-center justify-between">
                        <span>AI 교정 텍스트</span>
                        {item.correctionReason && (
                          <span className="text-[9px] font-normal text-emerald-700">
                            사유: {item.correctionReason}
                          </span>
                        )}
                      </div>
                      <p className="text-slate-900 font-medium leading-relaxed">{item.text}</p>
                    </div>
                  </div>
                )}

                {/* 발언 본문 영역 (수정 중 또는 읽기) */}
                {isEditing ? (
                  <div className="space-y-2 mt-2">
                    <textarea
                      rows={3}
                      value={editingText}
                      onChange={(e) => setEditingText(e.target.value)}
                      className="w-full text-xs p-2.5 bg-slate-50 border border-blue-400 rounded-lg focus:outline-none focus:ring-1 focus:ring-blue-500"
                    />
                    <div className="flex items-center justify-between text-xs">
                      {originalSourceText && (
                        <button
                          type="button"
                          onClick={() => handleRevertIndividualSegment(item.id)}
                          className="flex items-center space-x-1 text-slate-500 hover:text-slate-700"
                        >
                          <RotateCcw className="w-3 h-3" />
                          <span>AI 원본으로 되돌리기</span>
                        </button>
                      )}
                      <div className="flex items-center space-x-2 ml-auto">
                        <button
                          type="button"
                          onClick={() => setEditingSegmentId(null)}
                          className="px-2.5 py-1 text-slate-600 hover:bg-slate-100 rounded"
                        >
                          취소
                        </button>
                        <button
                          type="button"
                          onClick={() => handleSaveEditing(item.id)}
                          className="flex items-center space-x-1 px-3 py-1 bg-blue-600 hover:bg-blue-500 text-white font-semibold rounded shadow-2xs"
                        >
                          <Check className="w-3 h-3" />
                          <span>저장</span>
                        </button>
                      </div>
                    </div>
                  </div>
                ) : (
                  <p className="text-xs text-slate-800 leading-relaxed whitespace-pre-wrap">
                    {item.text}
                  </p>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* 모달 1: 화자 통합 관리 모달 */}
      <SpeakerManagementModal
        isOpen={isSpeakerModalOpen}
        onClose={() => setIsSpeakerModalOpen(false)}
        meeting={meeting}
        uniqueSpeakers={uniqueSpeakers}
        getSpeakerDisplayName={getSpeakerDisplayName}
        onUpdateMeeting={onUpdateMeeting}
        isReadOnly={isReadOnly}
      />

      {/* 모달 2: AI 문맥 검토 및 오타 교정 모달 */}
      <AiCorrectionReviewModal
        isOpen={isAiCorrectionModalOpen}
        onClose={() => setIsAiCorrectionModalOpen(false)}
        meeting={meeting}
        uniqueSpeakers={uniqueSpeakers}
        getSpeakerDisplayName={getSpeakerDisplayName}
        onUpdateMeeting={onUpdateMeeting}
        onOpenCustomTerms={() => {
          setIsAiCorrectionModalOpen(false);
          setIsCustomTermsModalOpen(true);
        }}
        isReadOnly={isReadOnly}
      />

      {/* 모달 3: 필수 보호 전문용어 사전 관리 모달 */}
      <CustomTermsModal
        isOpen={isCustomTermsModalOpen}
        onClose={() => setIsCustomTermsModalOpen(false)}
        customTerms={meeting.customTerms || []}
        onSaveTerms={(newTerms) => onUpdateMeeting({ customTerms: newTerms })}
        isReadOnly={isReadOnly}
      />
    </div>
  );
};
