/**
 * @file src/components/meeting/tabs/BasicInfoTab.tsx
 * @description 회의 기본 정보 탭 (제목, 일자, 시작/종료 시각, 장소, 사업장/부서, 작성자, 안건, 공유 권한).
 */

import React, { useState } from 'react';
import { Calendar, Clock, MapPin, Building, User, FileText, Share2, Save, Check } from 'lucide-react';
import { Meeting } from '../../../types/meeting';
import { logger } from '../../../utils/logger';

interface BasicInfoTabProps {
  meeting: Meeting;
  isReadOnly: boolean;
  currentUserId: string;
  onUpdateMeeting: (partial: Partial<Meeting>) => void;
  onSave: () => void;
}

/**
 * 회의 기본 정보 편집 탭 컴포넌트
 */
export const BasicInfoTab: React.FC<BasicInfoTabProps> = ({
  meeting,
  isReadOnly,
  currentUserId,
  onUpdateMeeting,
  onSave,
}) => {
  logger.debug('BasicInfoTab rendered', { meetingId: meeting.id });

  const [shareEmail, setShareEmail] = useState('');
  const [shareRole, setShareRole] = useState<'editor' | 'viewer'>('editor');
  const [savedBadge, setSavedBadge] = useState(false);

  const isOwner = meeting.ownerId === currentUserId || currentUserId === 'local_user';

  const handleManualSave = () => {
    logger.info('Manual save triggered from BasicInfoTab');
    onSave();
    setSavedBadge(true);
    setTimeout(() => setSavedBadge(false), 2000);
  };

  /**
   * 공유 사용자 추가 핸들러
   */
  const handleAddSharedUser = () => {
    if (!shareEmail.trim()) return;
    logger.info('Adding shared user to meeting', { email: shareEmail, role: shareRole });

    // UID 대신 이메일 또는 가상 UID 키로 등록
    const cleanKey = shareEmail.trim().replace(/\./g, '_');
    const updatedPermissions = {
      ...(meeting.permissions || {}),
      [cleanKey]: shareRole,
    };

    onUpdateMeeting({ permissions: updatedPermissions });
    setShareEmail('');
  };

  /**
   * 공유 사용자 제거 핸들러
   */
  const handleRemoveSharedUser = (key: string) => {
    logger.info('Removing shared user from meeting', { key });
    const updatedPermissions = { ...(meeting.permissions || {}) };
    delete updatedPermissions[key];
    onUpdateMeeting({ permissions: updatedPermissions });
  };

  return (
    <div className="space-y-6">
      {/* 폼 카드 */}
      <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-6 space-y-5">
        <div className="flex items-center justify-between border-b border-slate-100 pb-4">
          <div>
            <h3 className="text-base font-bold text-slate-900">회의 기본 개요</h3>
            <p className="text-xs text-slate-500 mt-0.5">회의록 표준 양식의 표지 및 상단에 기재될 필수 메타데이터입니다.</p>
          </div>
          {!isReadOnly && (
            <button
              type="button"
              onClick={handleManualSave}
              className="flex items-center space-x-1.5 px-3.5 py-1.5 bg-blue-600 hover:bg-blue-500 text-white text-xs font-semibold rounded-lg shadow-sm transition-colors"
            >
              {savedBadge ? <Check className="w-3.5 h-3.5 text-emerald-300" /> : <Save className="w-3.5 h-3.5" />}
              <span>{savedBadge ? '저장됨' : '변경사항 저장'}</span>
            </button>
          )}
        </div>

        {/* 회의 제목 */}
        <div>
          <label className="block text-xs font-bold text-slate-700 mb-1.5">
            회의 제목 <span className="text-red-500">*</span>
          </label>
          <input
            type="text"
            disabled={isReadOnly}
            value={meeting.title}
            onChange={(e) => onUpdateMeeting({ title: e.target.value })}
            placeholder="남부권역 위험성평가 위원회"
            className="w-full text-sm font-semibold p-2.5 bg-slate-50 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:bg-white transition-all disabled:bg-slate-100 disabled:text-slate-500"
          />
        </div>

        {/* 일자 및 시각 */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <div>
            <label className="block text-xs font-bold text-slate-700 mb-1.5">
              <Calendar className="w-3.5 h-3.5 inline mr-1 text-slate-400" />
              회의 일자 <span className="text-red-500">*</span>
            </label>
            <input
              type="date"
              disabled={isReadOnly}
              value={meeting.date}
              onChange={(e) => onUpdateMeeting({ date: e.target.value })}
              className="w-full text-xs p-2.5 bg-slate-50 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:bg-white disabled:bg-slate-100"
            />
          </div>

          <div>
            <label className="block text-xs font-bold text-slate-700 mb-1.5">
              <Clock className="w-3.5 h-3.5 inline mr-1 text-slate-400" />
              시작 시각
            </label>
            <input
              type="time"
              disabled={isReadOnly}
              value={meeting.startTime}
              onChange={(e) => onUpdateMeeting({ startTime: e.target.value })}
              className="w-full text-xs p-2.5 bg-slate-50 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:bg-white disabled:bg-slate-100"
            />
          </div>

          <div>
            <label className="block text-xs font-bold text-slate-700 mb-1.5">
              <Clock className="w-3.5 h-3.5 inline mr-1 text-slate-400" />
              종료 시각
            </label>
            <input
              type="time"
              disabled={isReadOnly}
              value={meeting.endTime}
              onChange={(e) => onUpdateMeeting({ endTime: e.target.value })}
              className="w-full text-xs p-2.5 bg-slate-50 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:bg-white disabled:bg-slate-100"
            />
          </div>
        </div>

        {/* 장소, 사업장/부서, 작성자 */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <div>
            <label className="block text-xs font-bold text-slate-700 mb-1.5">
              <MapPin className="w-3.5 h-3.5 inline mr-1 text-slate-400" />
              회의 장소
            </label>
            <input
              type="text"
              disabled={isReadOnly}
              value={meeting.location}
              onChange={(e) => onUpdateMeeting({ location: e.target.value })}
              placeholder="본관 2층 대회의실"
              className="w-full text-xs p-2.5 bg-slate-50 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:bg-white disabled:bg-slate-100"
            />
          </div>

          <div>
            <label className="block text-xs font-bold text-slate-700 mb-1.5">
              <Building className="w-3.5 h-3.5 inline mr-1 text-slate-400" />
              사업장 또는 부서
            </label>
            <input
              type="text"
              disabled={isReadOnly}
              value={meeting.department}
              onChange={(e) => onUpdateMeeting({ department: e.target.value })}
              placeholder="남부권역 사업소 / 안전환경팀"
              className="w-full text-xs p-2.5 bg-slate-50 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:bg-white disabled:bg-slate-100"
            />
          </div>

          <div>
            <label className="block text-xs font-bold text-slate-700 mb-1.5">
              <User className="w-3.5 h-3.5 inline mr-1 text-slate-400" />
              작성자 (간사)
            </label>
            <input
              type="text"
              disabled={isReadOnly}
              value={meeting.author}
              onChange={(e) => onUpdateMeeting({ author: e.target.value })}
              placeholder="홍길동"
              className="w-full text-xs p-2.5 bg-slate-50 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:bg-white disabled:bg-slate-100"
            />
          </div>
        </div>

        {/* 회의 안건 */}
        <div>
          <label className="block text-xs font-bold text-slate-700 mb-1.5">
            <FileText className="w-3.5 h-3.5 inline mr-1 text-slate-400" />
            회의 안건
          </label>
          <textarea
            rows={3}
            disabled={isReadOnly}
            value={meeting.agenda}
            onChange={(e) => onUpdateMeeting({ agenda: e.target.value })}
            placeholder="1. 2026년도 상반기 유해위험요인 정기 점검 결과 심의&#10;2. 위험기계기구 방호장치 개선 및 예산 배정"
            className="w-full text-xs p-2.5 bg-slate-50 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:bg-white transition-all disabled:bg-slate-100 leading-relaxed"
          />
        </div>
      </div>

      {/* 권한 및 협업 관리 카드 (소유자 전용) */}
      <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-6">
        <div className="flex items-center space-x-2 border-b border-slate-100 pb-3 mb-4">
          <Share2 className="w-4 h-4 text-blue-600" />
          <h4 className="text-sm font-bold text-slate-900">회의 접근 및 협업 권한</h4>
        </div>

        <p className="text-xs text-slate-500 mb-4">
          소유자만 다른 로그인 사용자를 편집자 또는 조회자로 초대할 수 있습니다. (기본적으로 비공개이며 로그인하더라도 초대받지 않은 회의는 열람 불가)
        </p>

        {isOwner && !isReadOnly && (
          <div className="flex flex-col sm:flex-row items-center gap-2 mb-4">
            <input
              type="email"
              value={shareEmail}
              onChange={(e) => setShareEmail(e.target.value)}
              placeholder="초대할 동료의 이메일 주소..."
              className="flex-1 w-full text-xs p-2 bg-slate-50 border border-slate-200 rounded-lg focus:ring-1 focus:ring-blue-500"
            />
            <select
              value={shareRole}
              onChange={(e) => setShareRole(e.target.value as 'editor' | 'viewer')}
              className="text-xs p-2 bg-slate-50 border border-slate-200 rounded-lg text-slate-700"
            >
              <option value="editor">편집자 (수정 가능)</option>
              <option value="viewer">조회자 (읽기 전용)</option>
            </select>
            <button
              type="button"
              onClick={handleAddSharedUser}
              className="w-full sm:w-auto px-4 py-2 bg-slate-800 hover:bg-slate-700 text-white text-xs font-semibold rounded-lg transition-colors shrink-0"
            >
              권한 추가
            </button>
          </div>
        )}

        {/* 현재 권한 목록 */}
        <div className="divide-y divide-slate-100 border border-slate-200 rounded-lg overflow-hidden text-xs">
          <div className="p-3 bg-slate-50 flex items-center justify-between">
            <span className="font-semibold text-slate-700">소유자 (생성자)</span>
            <span className="px-2 py-0.5 rounded bg-blue-100 text-blue-700 font-bold">소유자 (Owner)</span>
          </div>

          {Object.entries(meeting.permissions || {}).map(([key, role]) => {
            if (role === 'owner') return null;
            return (
              <div key={key} className="p-3 flex items-center justify-between">
                <span className="text-slate-600 font-mono">{key.replace(/_/g, '.')}</span>
                <div className="flex items-center space-x-2">
                  <span className="px-2 py-0.5 rounded bg-slate-100 text-slate-700 font-medium">
                    {role === 'editor' ? '편집자' : '조회자'}
                  </span>
                  {isOwner && !isReadOnly && (
                    <button
                      type="button"
                      onClick={() => handleRemoveSharedUser(key)}
                      className="text-red-500 hover:text-red-700 text-xs font-semibold"
                    >
                      삭제
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
};
