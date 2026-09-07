/**
 * @file src/components/meeting/tabs/AttendeesTab.tsx
 * @description 참석자 및 전자서명 관리 탭.
 * 10인 이상 행 추가/삭제/순서변경, 표준 직책(위원장, 사용자위원, 근로자위원, 간사 등),
 * 서명 상태 확인, 개별 서명 모달 및 공용 태블릿 연속 대면 서명 모드 지원.
 */

import React, { useState } from 'react';
import {
  Users,
  UserPlus,
  Trash2,
  ArrowUp,
  ArrowDown,
  PenTool,
  Tablet,
  CheckCircle2,
  AlertTriangle,
  RotateCcw,
} from 'lucide-react';
import { Meeting, Attendee, AttendeeSignature, CommitteeRole } from '../../../types/meeting';
import { SignatureModal } from '../SignatureModal';
import { formatKoreanDateTime } from '../../../utils/formatters';
import { logger } from '../../../utils/logger';

interface AttendeesTabProps {
  meeting: Meeting;
  isReadOnly: boolean;
  onUpdateMeeting: (partial: Partial<Meeting>) => void;
}

const COMMITTEE_ROLES: { value: CommitteeRole; label: string }[] = [
  { value: '위원장', label: '위원장' },
  { value: '사용자위원', label: '사용자위원' },
  { value: '근로자위원', label: '근로자위원' },
  { value: '간사', label: '간사' },
  { value: '외부전문가', label: '외부전문가' },
  { value: '배석자', label: '배석자' },
  { value: '기타', label: '기타' },
];

/**
 * 참석자 및 서명 관리 탭 컴포넌트
 */
export const AttendeesTab: React.FC<AttendeesTabProps> = ({
  meeting,
  isReadOnly,
  onUpdateMeeting,
}) => {
  logger.debug('AttendeesTab rendered', { count: meeting.attendees.length });

  // 서명 모달 상태
  const [selectedAttendeeForSign, setSelectedAttendeeForSign] = useState<Attendee | null>(null);
  const [isTabletMode, setIsTabletMode] = useState<boolean>(false);

  // 신규 참석자 추가 인라인 상태
  const [newName, setNewName] = useState('');
  const [newAffiliation, setNewAffiliation] = useState(meeting.department || '');
  const [newRole, setNewRole] = useState<CommitteeRole>('근로자위원');
  const [newPosition, setNewPosition] = useState('');

  /**
   * 신규 참석자 행 추가
   */
  const handleAddAttendee = () => {
    if (!newName.trim()) return;
    logger.info('Adding attendee', { name: newName, role: newRole });

    const newAttendee: Attendee = {
      id: 'att_' + Date.now(),
      name: newName.trim(),
      affiliation: newAffiliation.trim(),
      role: newRole,
      position: newPosition.trim(),
      order: meeting.attendees.length,
      signatures: [],
    };

    onUpdateMeeting({ attendees: [...meeting.attendees, newAttendee] });
    setNewName('');
    setNewPosition('');
  };

  /**
   * 참석자 삭제
   */
  const handleDeleteAttendee = (attendeeId: string) => {
    if (isReadOnly) return;
    logger.info('Deleting attendee', { attendeeId });
    const updated = meeting.attendees.filter((a) => a.id !== attendeeId);
    onUpdateMeeting({ attendees: updated });
  };

  /**
   * 참석자 행 순서 변경 (위/아래)
   */
  const handleMoveOrder = (index: number, direction: 'up' | 'down') => {
    if (isReadOnly) return;
    const list = [...meeting.attendees];
    const targetIdx = direction === 'up' ? index - 1 : index + 1;
    if (targetIdx < 0 || targetIdx >= list.length) return;

    logger.info('Moving attendee order', { from: index, to: targetIdx });
    const temp = list[index];
    list[index] = list[targetIdx];
    list[targetIdx] = temp;

    const reordered = list.map((item, idx) => ({ ...item, order: idx }));
    onUpdateMeeting({ attendees: reordered });
  };

  /**
   * 참석자 정보 수정
   */
  const handleUpdateAttendeeField = (
    attendeeId: string,
    field: keyof Attendee,
    value: any
  ) => {
    if (isReadOnly) return;
    const updated = meeting.attendees.map((a) =>
      a.id === attendeeId ? { ...a, [field]: value } : a
    );
    onUpdateMeeting({ attendees: updated });
  };

  /**
   * 서명 저장 완료 콜백
   */
  const handleSaveSignature = async (attendeeId: string, signature: AttendeeSignature) => {
    logger.info('handleSaveSignature called', { attendeeId, sigId: signature.id });
    const updatedAttendees = meeting.attendees.map((att) => {
      if (att.id === attendeeId) {
        return {
          ...att,
          signatures: [...(att.signatures || []), signature],
          requiresResign: false,
        };
      }
      return att;
    });

    onUpdateMeeting({ attendees: updatedAttendees });
  };

  /**
   * 서명 삭제 (초기화)
   */
  const handleClearSignature = (attendeeId: string) => {
    if (isReadOnly) return;
    logger.info('Clearing signature for attendee', { attendeeId });
    const updatedAttendees = meeting.attendees.map((att) => {
      if (att.id === attendeeId) {
        return { ...att, signatures: [] };
      }
      return att;
    });
    onUpdateMeeting({ attendees: updatedAttendees });
  };

  /**
   * 공용 태블릿 연속 대면 서명 모드 시작
   */
  const handleStartTabletMode = () => {
    logger.info('Starting tablet consecutive signature mode');
    // 서명하지 않은 첫 참석자 또는 0번째 참석자 선택
    const firstUnsigned =
      meeting.attendees.find((a) => !a.signatures || a.signatures.length === 0) ||
      meeting.attendees[0];

    if (firstUnsigned) {
      setIsTabletMode(true);
      setSelectedAttendeeForSign(firstUnsigned);
    }
  };

  /**
   * 다음 참석자로 이동 (태블릿 모드용)
   */
  const handleNextAttendeeInTabletMode = () => {
    if (!selectedAttendeeForSign) return;
    const currentIndex = meeting.attendees.findIndex((a) => a.id === selectedAttendeeForSign.id);
    if (currentIndex >= 0 && currentIndex < meeting.attendees.length - 1) {
      setSelectedAttendeeForSign(meeting.attendees[currentIndex + 1]);
    } else {
      setSelectedAttendeeForSign(null);
      setIsTabletMode(false);
    }
  };

  const hasNextAttendee =
    selectedAttendeeForSign !== null &&
    meeting.attendees.findIndex((a) => a.id === selectedAttendeeForSign.id) <
      meeting.attendees.length - 1;

  // 전체 통계
  const signedCount = meeting.attendees.filter((a) => a.signatures && a.signatures.length > 0).length;

  return (
    <div className="space-y-6">
      {/* 상단 액션 및 통계 바 */}
      <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <div className="flex items-center space-x-2">
            <Users className="w-4 h-4 text-blue-600" />
            <h4 className="text-sm font-bold text-slate-900">참석자 명단 및 전자서명</h4>
          </div>
          <p className="text-xs text-slate-500 mt-0.5">
            총 {meeting.attendees.length}명 중 {signedCount}명 서명 완료 ({Math.round(
              (signedCount / (meeting.attendees.length || 1)) * 100
            )}%)
          </p>
        </div>

        {/* 공용 태블릿 연속 서명 버튼 */}
        {!isReadOnly && meeting.attendees.length > 0 && (
          <button
            type="button"
            onClick={handleStartTabletMode}
            className="flex items-center space-x-1.5 px-4 py-2 bg-slate-900 hover:bg-slate-800 text-white text-xs font-bold rounded-lg shadow-sm transition-colors shrink-0"
          >
            <Tablet className="w-4 h-4 text-blue-400" />
            <span>공용 태블릿 연속 서명 모드</span>
          </button>
        )}
      </div>

      {/* 참석자 테이블 */}
      <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="bg-slate-100 border-b border-slate-200 text-slate-700 font-bold">
              <tr>
                <th className="py-3 px-3 w-12 text-center">순번</th>
                <th className="py-3 px-3 w-32">구분 (직책)</th>
                <th className="py-3 px-3 w-28">성명</th>
                <th className="py-3 px-3">소속 / 직위</th>
                <th className="py-3 px-3 w-44 text-center">전자서명</th>
                {!isReadOnly && <th className="py-3 px-3 w-24 text-center">관리</th>}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {meeting.attendees.map((attendee, index) => {
                const latestSignature = attendee.signatures?.[attendee.signatures.length - 1];
                const isSigned = Boolean(latestSignature);

                return (
                  <tr key={attendee.id} className="hover:bg-slate-50/80">
                    {/* 순번 */}
                    <td className="py-3 px-3 text-center text-slate-400 font-mono font-bold">
                      {index + 1}
                    </td>

                    {/* 구분 (직책) */}
                    <td className="py-3 px-3">
                      <select
                        disabled={isReadOnly}
                        value={attendee.role || '근로자위원'}
                        onChange={(e) =>
                          handleUpdateAttendeeField(attendee.id, 'role', e.target.value)
                        }
                        className="w-full p-1 bg-white border border-slate-200 rounded text-xs font-semibold text-slate-800 disabled:bg-transparent disabled:border-none"
                      >
                        {COMMITTEE_ROLES.map((r) => (
                          <option key={r.value} value={r.value}>
                            {r.label}
                          </option>
                        ))}
                      </select>
                    </td>

                    {/* 성명 */}
                    <td className="py-3 px-3">
                      <input
                        type="text"
                        disabled={isReadOnly}
                        value={attendee.name}
                        onChange={(e) =>
                          handleUpdateAttendeeField(attendee.id, 'name', e.target.value)
                        }
                        className="w-full p-1 font-bold text-slate-900 bg-white border border-slate-200 rounded disabled:bg-transparent disabled:border-none"
                      />
                    </td>

                    {/* 소속 / 직위 */}
                    <td className="py-3 px-3">
                      <div className="flex space-x-2">
                        <input
                          type="text"
                          disabled={isReadOnly}
                          value={attendee.affiliation || ''}
                          placeholder="소속 (부서)"
                          onChange={(e) =>
                            handleUpdateAttendeeField(attendee.id, 'affiliation', e.target.value)
                          }
                          className="flex-1 p-1 text-slate-600 bg-white border border-slate-200 rounded disabled:bg-transparent disabled:border-none"
                        />
                        <input
                          type="text"
                          disabled={isReadOnly}
                          value={attendee.position || ''}
                          placeholder="직위 (예: 대리)"
                          onChange={(e) =>
                            handleUpdateAttendeeField(attendee.id, 'position', e.target.value)
                          }
                          className="w-24 p-1 text-slate-600 bg-white border border-slate-200 rounded disabled:bg-transparent disabled:border-none"
                        />
                      </div>
                    </td>

                    {/* 전자서명 상태 및 액션 */}
                    <td className="py-3 px-3 text-center">
                      {isSigned ? (
                        <div className="flex flex-col items-center space-y-1">
                          <div className="h-10 w-24 bg-slate-50 border border-slate-200 rounded flex items-center justify-center p-0.5">
                            <img
                              src={latestSignature.imageUrl}
                              alt="서명"
                              className="max-h-full max-w-full object-contain"
                            />
                          </div>
                          <span className="text-[10px] text-slate-400 font-mono">
                            {formatKoreanDateTime(latestSignature.signedAt)}
                          </span>

                          {attendee.requiresResign && (
                            <span className="inline-flex items-center text-[10px] text-amber-600 font-bold">
                              <AlertTriangle className="w-2.5 h-2.5 mr-0.5" />
                              내용변경(재서명필요)
                            </span>
                          )}

                          {!isReadOnly && (
                            <div className="flex items-center space-x-2 text-[11px] pt-0.5">
                              <button
                                type="button"
                                onClick={() => setSelectedAttendeeForSign(attendee)}
                                className="text-blue-600 hover:underline"
                              >
                                재서명
                              </button>
                              <span className="text-slate-300">|</span>
                              <button
                                type="button"
                                onClick={() => handleClearSignature(attendee.id)}
                                className="text-red-500 hover:underline"
                              >
                                취소
                              </button>
                            </div>
                          )}
                        </div>
                      ) : (
                        <div>
                          {!isReadOnly ? (
                            <button
                              type="button"
                              onClick={() => setSelectedAttendeeForSign(attendee)}
                              className="inline-flex items-center space-x-1 px-3 py-1.5 bg-blue-50 hover:bg-blue-100 text-blue-700 border border-blue-200 rounded font-semibold text-xs transition-colors"
                            >
                              <PenTool className="w-3.5 h-3.5" />
                              <span>서명하기</span>
                            </button>
                          ) : (
                            <span className="text-slate-400 text-xs">미서명</span>
                          )}
                        </div>
                      )}
                    </td>

                    {/* 순서 및 삭제 제어 */}
                    {!isReadOnly && (
                      <td className="py-3 px-3 text-center">
                        <div className="flex items-center justify-center space-x-1">
                          <button
                            type="button"
                            disabled={index === 0}
                            onClick={() => handleMoveOrder(index, 'up')}
                            className="p-1 hover:bg-slate-200 rounded disabled:opacity-20"
                            title="위로 이동"
                          >
                            <ArrowUp className="w-3.5 h-3.5" />
                          </button>
                          <button
                            type="button"
                            disabled={index === meeting.attendees.length - 1}
                            onClick={() => handleMoveOrder(index, 'down')}
                            className="p-1 hover:bg-slate-200 rounded disabled:opacity-20"
                            title="아래로 이동"
                          >
                            <ArrowDown className="w-3.5 h-3.5" />
                          </button>
                          <button
                            type="button"
                            onClick={() => handleDeleteAttendee(attendee.id)}
                            className="p-1 text-slate-400 hover:text-red-600 rounded hover:bg-red-50"
                            title="삭제"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </td>
                    )}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        {/* 신규 참석자 인라인 추가 바 */}
        {!isReadOnly && (
          <div className="bg-slate-50 p-4 border-t border-slate-200 space-y-2">
            <span className="text-xs font-bold text-slate-800 flex items-center">
              <UserPlus className="w-3.5 h-3.5 mr-1 text-blue-600" />
              신규 참석자 추가 (10인 이상 행 추가 지원)
            </span>
            <div className="grid grid-cols-1 sm:grid-cols-5 gap-2 text-xs">
              <select
                value={newRole}
                onChange={(e) => setNewRole(e.target.value as CommitteeRole)}
                className="p-2 bg-white border border-slate-200 rounded"
              >
                {COMMITTEE_ROLES.map((r) => (
                  <option key={r.value} value={r.value}>
                    {r.label}
                  </option>
                ))}
              </select>
              <input
                type="text"
                placeholder="성명 (예: 김철수)"
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                className="p-2 bg-white border border-slate-200 rounded font-bold"
              />
              <input
                type="text"
                placeholder="소속 부서"
                value={newAffiliation}
                onChange={(e) => setNewAffiliation(e.target.value)}
                className="p-2 bg-white border border-slate-200 rounded"
              />
              <input
                type="text"
                placeholder="직위 (예: 과장)"
                value={newPosition}
                onChange={(e) => setNewPosition(e.target.value)}
                className="p-2 bg-white border border-slate-200 rounded"
              />
              <button
                type="button"
                onClick={handleAddAttendee}
                className="px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white font-bold rounded shadow-sm transition-colors"
              >
                참석자 등록
              </button>
            </div>
          </div>
        )}
      </div>

      {/* 전자서명 모달 (개별 또는 공용 태블릿 연속 모드) */}
      {selectedAttendeeForSign && (
        <SignatureModal
          isOpen={Boolean(selectedAttendeeForSign)}
          meetingId={meeting.id}
          attendee={selectedAttendeeForSign}
          onClose={() => {
            setSelectedAttendeeForSign(null);
            setIsTabletMode(false);
          }}
          onSaveSignature={handleSaveSignature}
          onNextAttendee={handleNextAttendeeInTabletMode}
          hasNextAttendee={hasNextAttendee}
        />
      )}
    </div>
  );
};
