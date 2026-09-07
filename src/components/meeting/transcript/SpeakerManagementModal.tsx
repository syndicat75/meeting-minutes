/**
 * @file src/components/meeting/transcript/SpeakerManagementModal.tsx
 * @description 회의 화자 통합 관리 모달 컴포넌트.
 * 주요 기능:
 * 1. 예상 화자 수 설정 (자동 감지, 1명, 2명, 3명, 4명, 5명 이상)
 * 2. 1명 회의 모드: 모든 발언을 단일 화자(화자 1)로 원클릭 일괄 통합
 * 3. 다중 체크박스 선택을 통한 화자 다중 병합
 * 4. 각 화자별 실제 회의 참석자(성명, 직책) 매핑 및 실시간 반영
 */

import React, { useState } from 'react';
import { Users, X, Combine, AlertCircle, Check, Sparkles, UserCheck } from 'lucide-react';
import { Meeting, Attendee, TranscriptSegment } from '../../../types/meeting';
import { logger } from '../../../utils/logger';

interface SpeakerManagementModalProps {
  isOpen: boolean;
  onClose: () => void;
  meeting: Meeting;
  uniqueSpeakers: string[];
  getSpeakerDisplayName: (speakerId: string) => string;
  onUpdateMeeting: (updates: Partial<Meeting>) => void;
  isReadOnly?: boolean;
}

/**
 * 화자 관리 및 병합 모달
 */
export const SpeakerManagementModal: React.FC<SpeakerManagementModalProps> = ({
  isOpen,
  onClose,
  meeting,
  uniqueSpeakers,
  getSpeakerDisplayName,
  onUpdateMeeting,
  isReadOnly = false,
}) => {
  const [expectedCount, setExpectedCount] = useState<number>(meeting.expectedSpeakerCount || 0);
  const [selectedSpeakers, setSelectedSpeakers] = useState<string[]>([]);
  const [targetSpeakerId, setTargetSpeakerId] = useState<string>(uniqueSpeakers[0] || '');

  if (!isOpen) return null;

  /**
   * 예상 화자 수 변경
   */
  const handleExpectedCountChange = (val: number) => {
    logger.info('handleExpectedCountChange called', { count: val });
    setExpectedCount(val);
    onUpdateMeeting({ expectedSpeakerCount: val });
  };

  /**
   * 1인 회의 모드 원클릭 적용: 모든 세그먼트를 speaker_1로 통합
   */
  const handleForceSingleSpeaker = () => {
    logger.info('handleForceSingleSpeaker called');
    const targetSpkId = 'speaker_1';
    const singleAttendee = meeting.attendees.length === 1 ? meeting.attendees[0] : null;

    const updatedTranscripts: TranscriptSegment[] = (meeting.transcripts || []).map((seg) => ({
      ...seg,
      speakerId: targetSpkId,
      speakerName: singleAttendee ? singleAttendee.name : '화자 1',
    }));

    // 단일 화자 매핑 설정
    const updatedMapping: Record<string, string> = {};
    if (singleAttendee) {
      updatedMapping[targetSpkId] = singleAttendee.id;
    }

    onUpdateMeeting({
      transcripts: updatedTranscripts,
      speakerMapping: updatedMapping,
      expectedSpeakerCount: 1,
    });

    setExpectedCount(1);
    setSelectedSpeakers([]);
  };

  /**
   * 체크박스 토글
   */
  const handleToggleSpeakerSelection = (spkId: string) => {
    if (selectedSpeakers.includes(spkId)) {
      setSelectedSpeakers(selectedSpeakers.filter((id) => id !== spkId));
    } else {
      setSelectedSpeakers([...selectedSpeakers, spkId]);
    }
  };

  /**
   * 전체 선택 / 해제
   */
  const handleSelectAllSpeakers = () => {
    if (selectedSpeakers.length === uniqueSpeakers.length) {
      setSelectedSpeakers([]);
    } else {
      setSelectedSpeakers([...uniqueSpeakers]);
    }
  };

  /**
   * 선택된 화자들을 targetSpeakerId로 다중 병합
   */
  const handleMergeSelectedSpeakers = () => {
    if (selectedSpeakers.length === 0 || !targetSpeakerId) return;
    const sourcesToMerge = selectedSpeakers.filter((id) => id !== targetSpeakerId);
    if (sourcesToMerge.length === 0) return;

    logger.info('Merging multiple speakers', { sources: sourcesToMerge, target: targetSpeakerId });

    const updatedTranscripts = (meeting.transcripts || []).map((seg) => {
      if (sourcesToMerge.includes(seg.speakerId)) {
        return {
          ...seg,
          speakerId: targetSpeakerId,
        };
      }
      return seg;
    });

    // 매핑 정리
    const updatedMapping = { ...(meeting.speakerMapping || {}) };
    sourcesToMerge.forEach((id) => {
      delete updatedMapping[id];
    });

    onUpdateMeeting({
      transcripts: updatedTranscripts,
      speakerMapping: updatedMapping,
    });

    setSelectedSpeakers([]);
  };

  /**
   * 개별 화자 - 참석자 매핑
   */
  const handleMapSpeakerToAttendee = (speakerId: string, attendeeId: string) => {
    if (isReadOnly) return;
    logger.info('Mapping speaker to attendee in modal', { speakerId, attendeeId });
    const currentMapping = { ...(meeting.speakerMapping || {}) };

    if (!attendeeId) {
      delete currentMapping[speakerId];
    } else {
      currentMapping[speakerId] = attendeeId;
    }

    onUpdateMeeting({ speakerMapping: currentMapping });
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 backdrop-blur-xs">
      <div className="bg-white rounded-xl shadow-xl max-w-2xl w-full border border-slate-200 overflow-hidden flex flex-col max-h-[90vh]">
        {/* 모달 헤더 */}
        <div className="flex items-center justify-between p-5 border-b border-slate-100 bg-slate-50">
          <div className="flex items-center space-x-2.5">
            <div className="w-8 h-8 rounded-lg bg-blue-100 flex items-center justify-center text-blue-600">
              <Users className="w-4 h-4" />
            </div>
            <div>
              <div className="flex items-center space-x-2">
                <h3 className="text-base font-bold text-slate-900">화자 관리</h3>
                <span className="px-2 py-0.5 bg-blue-100 text-blue-700 text-xs font-semibold rounded-full">
                  감지된 화자 {uniqueSpeakers.length}명
                </span>
              </div>
              <p className="text-xs text-slate-500 mt-0.5">
                과다 분리된 화자를 하나로 합치거나, 각 화자를 실제 회의 참석자 성명과 연결합니다.
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="text-slate-400 hover:text-slate-600 p-1.5 rounded-lg hover:bg-slate-200/60 transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* 모달 본문 */}
        <div className="p-5 space-y-6 overflow-y-auto flex-1 text-sm">
          {/* 섹션 1: 예상 화자 수 설정 및 단일 화자 통합 원클릭 바 */}
          <div className="p-4 bg-slate-50 border border-slate-200 rounded-xl space-y-3">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
              <div>
                <h4 className="text-xs font-bold text-slate-800 flex items-center space-x-1.5">
                  <Sparkles className="w-3.5 h-3.5 text-blue-600" />
                  <span>예상 참석 화자 수 설정</span>
                </h4>
                <p className="text-[11px] text-slate-500 mt-0.5">
                  실제 회의 발언 인원수를 지정하면 AI 음성 분리 정확도가 향상됩니다.
                </p>
              </div>

              {/* 예상 화자 수 셀렉터 */}
              <select
                disabled={isReadOnly}
                value={expectedCount}
                onChange={(e) => handleExpectedCountChange(parseInt(e.target.value, 10))}
                className="text-xs px-2.5 py-1.5 bg-white border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500 shrink-0 font-medium"
              >
                <option value={0}>자동 감지 (기본값)</option>
                <option value={1}>1명 (단독 회의 / 발표)</option>
                <option value={2}>2명 (1:1 회의 / 면담)</option>
                <option value={3}>3명</option>
                <option value={4}>4명</option>
                <option value={5}>5명 이상 (다자 회의)</option>
              </select>
            </div>

            {/* 1인 회의 빠른 통합 버튼 */}
            {uniqueSpeakers.length > 1 && !isReadOnly && (
              <div className="pt-2 border-t border-slate-200 flex items-center justify-between gap-3">
                <span className="text-xs text-slate-600">
                  혼자 말했는데 여러 화자로 나뉘었나요?
                </span>
                <button
                  type="button"
                  onClick={handleForceSingleSpeaker}
                  className="inline-flex items-center space-x-1 px-3 py-1.5 bg-blue-600 hover:bg-blue-700 text-white text-xs font-semibold rounded-lg shadow-2xs transition-colors shrink-0"
                >
                  <Combine className="w-3.5 h-3.5" />
                  <span>모든 발언을 화자 1명으로 통합</span>
                </button>
              </div>
            )}
          </div>

          {/* 섹션 2: 다중 화자 선택 및 병합 컨트롤 */}
          {!isReadOnly && uniqueSpeakers.length > 1 && (
            <div className="p-4 bg-white border border-slate-200 rounded-xl space-y-3">
              <div className="flex items-center justify-between">
                <h4 className="text-xs font-bold text-slate-800 flex items-center space-x-1.5">
                  <Combine className="w-3.5 h-3.5 text-slate-600" />
                  <span>선택 화자 일괄 병합</span>
                </h4>
                <button
                  type="button"
                  onClick={handleSelectAllSpeakers}
                  className="text-[11px] text-blue-600 hover:text-blue-800 font-medium"
                >
                  {selectedSpeakers.length === uniqueSpeakers.length ? '선택 해제' : '전체 선택'}
                </button>
              </div>

              <div className="flex flex-wrap items-center gap-2 pt-1">
                <span className="text-xs text-slate-600 font-medium">통합 대상:</span>
                <select
                  value={targetSpeakerId}
                  onChange={(e) => setTargetSpeakerId(e.target.value)}
                  className="text-xs px-2.5 py-1.5 bg-slate-50 border border-slate-300 rounded-lg focus:ring-1 focus:ring-blue-500 font-medium"
                >
                  {uniqueSpeakers.map((id) => (
                    <option key={id} value={id}>
                      {getSpeakerDisplayName(id)}
                    </option>
                  ))}
                </select>

                <button
                  type="button"
                  disabled={selectedSpeakers.length < 2 || !selectedSpeakers.includes(targetSpeakerId)}
                  onClick={handleMergeSelectedSpeakers}
                  className="inline-flex items-center space-x-1.5 px-3 py-1.5 bg-slate-800 hover:bg-slate-900 disabled:bg-slate-200 disabled:text-slate-400 text-white text-xs font-semibold rounded-lg transition-colors"
                >
                  <Combine className="w-3.5 h-3.5" />
                  <span>
                    선택한 화자 병합 ({selectedSpeakers.length}명 선택됨)
                  </span>
                </button>
              </div>

              {selectedSpeakers.length > 0 && !selectedSpeakers.includes(targetSpeakerId) && (
                <p className="text-[11px] text-amber-600 flex items-center space-x-1">
                  <AlertCircle className="w-3 h-3 shrink-0" />
                  <span>병합하려면 통합 대상 화자({getSpeakerDisplayName(targetSpeakerId)})도 함께 체크해주세요.</span>
                </p>
              )}
            </div>
          )}

          {/* 섹션 3: 감지된 화자 목록 및 참석자 이름 매핑 */}
          <div className="space-y-3">
            <h4 className="text-xs font-bold text-slate-800 flex items-center space-x-1.5">
              <UserCheck className="w-3.5 h-3.5 text-blue-600" />
              <span>화자별 참석자 연결 및 발언 목록</span>
            </h4>

            <div className="border border-slate-200 rounded-xl overflow-hidden divide-y divide-slate-100 bg-white">
              {uniqueSpeakers.map((spkId) => {
                const isChecked = selectedSpeakers.includes(spkId);
                const currentAttId = meeting.speakerMapping?.[spkId] || '';
                const speakerSegments = (meeting.transcripts || []).filter((s) => s.speakerId === spkId);
                const sampleText = speakerSegments[0]?.text || '';

                return (
                  <div key={spkId} className="p-3.5 flex flex-col sm:flex-row sm:items-center justify-between gap-3 hover:bg-slate-50 transition-colors">
                    {/* 체크박스 및 화자 정보 */}
                    <div className="flex items-start space-x-3 flex-1 min-w-0">
                      {!isReadOnly && (
                        <input
                          type="checkbox"
                          checked={isChecked}
                          onChange={() => handleToggleSpeakerSelection(spkId)}
                          className="mt-1 rounded text-blue-600 focus:ring-blue-500 w-4 h-4"
                        />
                      )}
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center space-x-2">
                          <span className="text-xs font-bold text-slate-900 font-mono">
                            {getSpeakerDisplayName(spkId)}
                          </span>
                          <span className="text-[11px] px-1.5 py-0.5 bg-slate-100 text-slate-600 rounded">
                            발언 {speakerSegments.length}회
                          </span>
                        </div>
                        {sampleText && (
                          <p className="text-xs text-slate-500 truncate mt-1">
                            &ldquo;{sampleText}&rdquo;
                          </p>
                        )}
                      </div>
                    </div>

                    {/* 참석자 연결 드롭다운 */}
                    <div className="sm:w-60 shrink-0">
                      <select
                        disabled={isReadOnly}
                        value={currentAttId}
                        onChange={(e) => handleMapSpeakerToAttendee(spkId, e.target.value)}
                        className="w-full text-xs p-1.5 bg-white border border-slate-300 rounded-lg focus:ring-1 focus:ring-blue-500 font-medium"
                      >
                        <option value="">(실제 참석자 선택 연결)</option>
                        {meeting.attendees.map((att: Attendee) => (
                          <option key={att.id} value={att.id}>
                            {att.name} ({att.role || att.position})
                          </option>
                        ))}
                      </select>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>

        {/* 모달 푸터 */}
        <div className="p-4 border-t border-slate-100 bg-slate-50 flex justify-end space-x-2">
          <button
            type="button"
            onClick={onClose}
            className="inline-flex items-center space-x-1.5 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white text-xs font-semibold rounded-lg shadow-2xs transition-colors"
          >
            <Check className="w-3.5 h-3.5" />
            <span>완료 및 닫기</span>
          </button>
        </div>
      </div>
    </div>
  );
};
