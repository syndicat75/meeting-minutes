/**
 * @file src/components/meeting/tabs/TranscriptTab.tsx
 * @description 화자별 대화록 관리 탭.
 * 화자 매핑(실제 참석자 연결), 일괄 반영, 화자 병합, 발언별 타임스탬프 오디오 이동 재생,
 * 발언 텍스트 수정 및 원본 보존, '확인 필요(needsReview)' 필터링, 대화록 TXT 다운로드 제공.
 */

import React, { useState, useMemo } from 'react';
import {
  Users,
  Search,
  Play,
  Edit2,
  Check,
  X,
  AlertTriangle,
  Download,
  Filter,
  Combine,
  Clock,
  Sparkles,
  RotateCcw,
} from 'lucide-react';
import { Meeting, TranscriptSegment, Attendee } from '../../../types/meeting';
import { formatDuration } from '../../../utils/formatters';
import { logger } from '../../../utils/logger';

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

  const [searchTerm, setSearchTerm] = useState('');
  const [speakerFilter, setSpeakerFilter] = useState<string>('all');
  const [onlyNeedsReview, setOnlyNeedsReview] = useState<boolean>(false);

  // 개별 발언 텍스트 인라인 수정 상태
  const [editingSegmentId, setEditingSegmentId] = useState<string | null>(null);
  const [editingText, setEditingText] = useState<string>('');

  // 화자 병합 모달 상태
  const [isMergeModalOpen, setIsMergeModalOpen] = useState(false);
  const [sourceSpeakerId, setSourceSpeakerId] = useState<string>('');
  const [targetSpeakerId, setTargetSpeakerId] = useState<string>('');

  // 고유 화자 ID 목록 추출
  const uniqueSpeakers = useMemo(() => {
    const set = new Set<string>();
    (meeting.transcripts || []).forEach((seg) => {
      if (seg.speakerId) set.add(seg.speakerId);
    });
    return Array.from(set).sort();
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
    // 기본 화자 번호 포맷 (예: speaker_1 -> 화자 1)
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
   * 발언 수정 시작
   */
  const handleStartEditing = (segment: TranscriptSegment) => {
    if (isReadOnly) return;
    logger.info('Start editing segment text', { segmentId: segment.id });
    setEditingSegmentId(segment.id);
    setEditingText(segment.text);
  };

  /**
   * 발언 수정 저장
   */
  const handleSaveEditing = (segmentId: string) => {
    logger.info('Saving edited segment text', { segmentId });
    const updatedTranscripts = (meeting.transcripts || []).map((seg) => {
      if (seg.id === segmentId) {
        return {
          ...seg,
          text: editingText,
          originalAiText: seg.originalAiText || seg.text,
          isUserEdited: true,
        };
      }
      return seg;
    });

    onUpdateMeeting({ transcripts: updatedTranscripts });
    setEditingSegmentId(null);
  };

  /**
   * 발언 원본 AI 텍스트로 되돌리기
   */
  const handleRevertEditing = (segmentId: string) => {
    logger.info('Reverting segment text to original AI text', { segmentId });
    const updatedTranscripts = (meeting.transcripts || []).map((seg) => {
      if (seg.id === segmentId && seg.originalAiText) {
        return {
          ...seg,
          text: seg.originalAiText,
          isUserEdited: false,
        };
      }
      return seg;
    });
    onUpdateMeeting({ transcripts: updatedTranscripts });
    setEditingSegmentId(null);
  };

  /**
   * 발언의 확인 필요(needsReview) 토글
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
   * 화자 병합 실행 (sourceSpeakerId 발언을 모두 targetSpeakerId로 통합)
   */
  const handleExecuteMerge = () => {
    if (!sourceSpeakerId || !targetSpeakerId || sourceSpeakerId === targetSpeakerId) return;
    logger.info('Merging speakers', { from: sourceSpeakerId, to: targetSpeakerId });

    const updatedTranscripts = (meeting.transcripts || []).map((seg) => {
      if (seg.speakerId === sourceSpeakerId) {
        return { ...seg, speakerId: targetSpeakerId };
      }
      return seg;
    });

    // 매핑 갱신
    const updatedMapping = { ...(meeting.speakerMapping || {}) };
    delete updatedMapping[sourceSpeakerId];

    onUpdateMeeting({
      transcripts: updatedTranscripts,
      speakerMapping: updatedMapping,
    });

    setIsMergeModalOpen(false);
    setSourceSpeakerId('');
    setTargetSpeakerId('');
  };

  /**
   * 대화록 TXT 파일 다운로드
   */
  const handleDownloadTxt = () => {
    logger.info('handleDownloadTxt called');
    const lines = (meeting.transcripts || []).map((seg) => {
      const speaker = getSpeakerDisplayName(seg.speakerId);
      const time = `[${formatDuration(seg.startSeconds)} ~ ${formatDuration(seg.endSeconds)}]`;
      return `${time} ${speaker}: ${seg.text}`;
    });

    const content = `[${meeting.title}] 대화록 전문\n일시: ${meeting.date} (${meeting.startTime}~${meeting.endTime})\n장소: ${meeting.location}\n\n` + lines.join('\n\n');
    const blob = new Blob([content], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `${meeting.title}_대화록.txt`;
    link.click();
    URL.revokeObjectURL(url);
  };

  // 필터링 적용
  const filteredTranscripts = useMemo(() => {
    return (meeting.transcripts || []).filter((seg) => {
      if (speakerFilter !== 'all' && seg.speakerId !== speakerFilter) {
        return false;
      }
      if (onlyNeedsReview && !seg.needsReview) {
        return false;
      }
      if (searchTerm.trim()) {
        const q = searchTerm.toLowerCase();
        const inText = seg.text.toLowerCase().includes(q);
        const inSpeaker = getSpeakerDisplayName(seg.speakerId).toLowerCase().includes(q);
        if (!inText && !inSpeaker) return false;
      }
      return true;
    });
  }, [meeting.transcripts, speakerFilter, onlyNeedsReview, searchTerm, meeting.speakerMapping]);

  return (
    <div className="space-y-6">
      {/* 화자 매핑 바: 화자 1, 화자 2 등을 실제 등록된 참석자와 연결 */}
      {uniqueSpeakers.length > 0 && (
        <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-5 space-y-3">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-slate-100 pb-3">
            <div>
              <div className="flex items-center space-x-2">
                <Users className="w-4 h-4 text-blue-600" />
                <h4 className="text-sm font-bold text-slate-900">화자 - 참석자 이름 연결 (매핑)</h4>
              </div>
              <p className="text-xs text-slate-500 mt-0.5">
                AI가 분류한 음성 화자를 회의 참석자 명단과 연결하면 전체 발언에 성명이 일괄 반영됩니다.
              </p>
            </div>

            {!isReadOnly && (
              <button
                type="button"
                onClick={() => setIsMergeModalOpen(true)}
                className="inline-flex items-center space-x-1.5 px-3 py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-semibold rounded-lg transition-colors shrink-0"
              >
                <Combine className="w-3.5 h-3.5" />
                <span>화자 병합</span>
              </button>
            )}
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3">
            {uniqueSpeakers.map((spkId) => {
              const currentAttId = meeting.speakerMapping?.[spkId] || '';
              return (
                <div key={spkId} className="p-3 bg-slate-50 border border-slate-200 rounded-lg space-y-1.5">
                  <div className="flex items-center justify-between text-xs">
                    <span className="font-bold text-slate-800 font-mono">{spkId}</span>
                    <span className="text-[11px] text-slate-500">
                      발언{' '}
                      {(meeting.transcripts || []).filter((s) => s.speakerId === spkId).length}회
                    </span>
                  </div>

                  <select
                    disabled={isReadOnly}
                    value={currentAttId}
                    onChange={(e) => handleMapSpeakerToAttendee(spkId, e.target.value)}
                    className="w-full text-xs p-1.5 bg-white border border-slate-300 rounded focus:ring-1 focus:ring-blue-500 disabled:bg-slate-100"
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

      {/* 검색 및 필터 툴바 */}
      <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-sm flex flex-col md:flex-row items-center gap-3">
        <div className="relative flex-1 w-full">
          <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
          <input
            type="text"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            placeholder="발언 내용 검색..."
            className="w-full pl-9 pr-4 py-2 text-xs bg-slate-50 border border-slate-200 rounded-lg focus:ring-1 focus:ring-blue-500"
          />
        </div>

        <div className="flex items-center space-x-2 w-full md:w-auto">
          {/* 화자별 필터 */}
          <select
            value={speakerFilter}
            onChange={(e) => setSpeakerFilter(e.target.value)}
            className="text-xs p-2 bg-slate-50 border border-slate-200 rounded-lg text-slate-700"
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
            className={`px-3 py-2 text-xs font-semibold rounded-lg border transition-colors flex items-center space-x-1 ${
              onlyNeedsReview
                ? 'bg-amber-100 text-amber-900 border-amber-300'
                : 'bg-slate-50 text-slate-600 border-slate-200 hover:bg-slate-100'
            }`}
          >
            <AlertTriangle className="w-3.5 h-3.5 text-amber-600" />
            <span>확인 필요만 보기</span>
          </button>

          {/* TXT 다운로드 */}
          <button
            type="button"
            onClick={handleDownloadTxt}
            className="px-3 py-2 bg-slate-800 hover:bg-slate-700 text-white text-xs font-semibold rounded-lg shadow-sm transition-colors flex items-center space-x-1 shrink-0"
            title="대화록 TXT 파일 다운로드"
          >
            <Download className="w-3.5 h-3.5" />
            <span className="hidden sm:inline">TXT 내보내기</span>
          </button>
        </div>
      </div>

      {/* 발언 타임라인 목록 */}
      {filteredTranscripts.length === 0 ? (
        <div className="bg-white rounded-xl border border-slate-200 p-12 text-center text-slate-500 text-xs">
          대화록 데이터가 없습니다. [녹음 및 오디오] 탭에서 녹음 후 AI 전사를 실행해주세요.
        </div>
      ) : (
        <div className="space-y-3">
          {filteredTranscripts.map((segment) => {
            const isEditing = editingSegmentId === segment.id;
            const speakerName = getSpeakerDisplayName(segment.speakerId);

            return (
              <div
                key={segment.id}
                id={`transcript-segment-${segment.id}`}
                className={`bg-white rounded-xl border p-4 shadow-sm transition-all ${
                  segment.needsReview ? 'border-amber-300 bg-amber-50/20' : 'border-slate-200'
                }`}
              >
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 mb-2">
                  {/* 화자 및 타임스탬프 */}
                  <div className="flex items-center space-x-2.5">
                    <span className="px-2.5 py-0.5 rounded-full bg-blue-100 text-blue-800 text-xs font-bold">
                      {speakerName}
                    </span>

                    {/* 오디오 타임스탬프 클릭 시 해당 시점으로 이동 */}
                    <button
                      type="button"
                      onClick={() => onJumpAudioTime && onJumpAudioTime(segment.startSeconds)}
                      className="flex items-center space-x-1 text-slate-500 hover:text-blue-600 text-xs font-mono transition-colors"
                      title="해당 발언 시점부터 오디오 재생"
                    >
                      <Play className="w-3 h-3" />
                      <span>{formatDuration(segment.startSeconds)}</span>
                      <span>~</span>
                      <span>{formatDuration(segment.endSeconds)}</span>
                    </button>

                    {/* 사용자 수정 여부 표시 */}
                    {segment.isUserEdited && (
                      <span className="text-[10px] px-1.5 py-0.5 rounded bg-slate-100 text-slate-500 font-medium">
                        수정됨
                      </span>
                    )}

                    {/* 확인 필요 배지 */}
                    {segment.needsReview && (
                      <span className="text-[10px] px-2 py-0.5 rounded-full bg-amber-100 text-amber-800 font-bold flex items-center space-x-1">
                        <AlertTriangle className="w-3 h-3 text-amber-600" />
                        <span>확인 필요</span>
                      </span>
                    )}
                  </div>

                  {/* 컨트롤 버튼 군 */}
                  {!isReadOnly && (
                    <div className="flex items-center space-x-1 text-xs">
                      {/* 확인 필요 토글 버튼 */}
                      <button
                        type="button"
                        onClick={() => handleToggleNeedsReview(segment.id)}
                        className={`px-2 py-1 rounded transition-colors text-[11px] ${
                          segment.needsReview
                            ? 'bg-amber-100 text-amber-800 hover:bg-amber-200'
                            : 'text-slate-400 hover:text-amber-600 hover:bg-slate-100'
                        }`}
                      >
                        {segment.needsReview ? '확인 해제' : '확인 필요 표시'}
                      </button>

                      {/* 수정 버튼 */}
                      {!isEditing && (
                        <button
                          type="button"
                          onClick={() => handleStartEditing(segment)}
                          className="p-1 text-slate-500 hover:text-blue-600 rounded hover:bg-slate-100"
                          title="발언 텍스트 수정"
                        >
                          <Edit2 className="w-3.5 h-3.5" />
                        </button>
                      )}
                    </div>
                  )}
                </div>

                {/* 발언 본문 영역 */}
                {isEditing ? (
                  <div className="space-y-2 mt-2">
                    <textarea
                      rows={3}
                      value={editingText}
                      onChange={(e) => setEditingText(e.target.value)}
                      className="w-full text-xs p-2.5 bg-slate-50 border border-blue-400 rounded-lg focus:outline-none focus:ring-1 focus:ring-blue-500"
                    />
                    <div className="flex items-center justify-between text-xs">
                      {segment.originalAiText && (
                        <button
                          type="button"
                          onClick={() => handleRevertEditing(segment.id)}
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
                          onClick={() => handleSaveEditing(segment.id)}
                          className="flex items-center space-x-1 px-3 py-1 bg-blue-600 hover:bg-blue-500 text-white font-semibold rounded shadow-sm"
                        >
                          <Check className="w-3 h-3" />
                          <span>저장</span>
                        </button>
                      </div>
                    </div>
                  </div>
                ) : (
                  <p className="text-xs text-slate-800 leading-relaxed whitespace-pre-wrap">
                    {segment.text}
                  </p>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* 화자 병합 모달 */}
      {isMergeModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
          <div className="bg-white rounded-xl shadow-xl max-w-md w-full border border-slate-200 overflow-hidden p-6 space-y-4">
            <h4 className="text-base font-bold text-slate-900">화자 병합 (동일 인물 통합)</h4>
            <p className="text-xs text-slate-600 leading-relaxed">
              긴 녹음 중 서로 다른 화자 번호로 인식된 발언을 하나의 화자로 통일합니다.
            </p>

            <div className="space-y-3 text-xs">
              <div>
                <label className="block font-bold text-slate-700 mb-1">합칠 원본 화자 (사라질 화자)</label>
                <select
                  value={sourceSpeakerId}
                  onChange={(e) => setSourceSpeakerId(e.target.value)}
                  className="w-full p-2 bg-slate-50 border border-slate-300 rounded"
                >
                  <option value="">화자 선택</option>
                  {uniqueSpeakers.map((s) => (
                    <option key={s} value={s}>
                      {getSpeakerDisplayName(s)} ({s})
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block font-bold text-slate-700 mb-1">통합 대상 화자 (남길 화자)</label>
                <select
                  value={targetSpeakerId}
                  onChange={(e) => setTargetSpeakerId(e.target.value)}
                  className="w-full p-2 bg-slate-50 border border-slate-300 rounded"
                >
                  <option value="">화자 선택</option>
                  {uniqueSpeakers.map((s) => (
                    <option key={s} value={s}>
                      {getSpeakerDisplayName(s)} ({s})
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <div className="flex justify-end space-x-2 pt-2 border-t border-slate-200">
              <button
                type="button"
                onClick={() => setIsMergeModalOpen(false)}
                className="px-3 py-1.5 text-xs text-slate-600 hover:bg-slate-100 rounded"
              >
                취소
              </button>
              <button
                type="button"
                onClick={handleExecuteMerge}
                disabled={!sourceSpeakerId || !targetSpeakerId || sourceSpeakerId === targetSpeakerId}
                className="px-4 py-1.5 bg-blue-600 hover:bg-blue-500 text-white text-xs font-bold rounded shadow-sm disabled:opacity-50"
              >
                병합 실행
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
