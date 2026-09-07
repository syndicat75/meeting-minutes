/**
 * @file src/components/meeting/MeetingListView.tsx
 * @description 회의 목록 화면. 카드 뷰 / 테이블 목록 뷰 전환, 검색 및 상태 필터링, 신규 회의 생성, 기존 회의 복사 지원.
 */

import React, { useState, useMemo } from 'react';
import {
  LayoutGrid,
  List,
  Search,
  Plus,
  Filter,
  Calendar,
  Building,
  CheckCircle2,
  AlertCircle,
  Copy,
  Trash2,
  FileText,
} from 'lucide-react';
import { Meeting, MeetingStatus } from '../../types/meeting';
import { MeetingCard } from './MeetingCard';
import { formatKoreanDate } from '../../utils/formatters';
import { logger } from '../../utils/logger';

interface MeetingListViewProps {
  meetings: Meeting[];
  currentUserId: string;
  onSelectMeeting: (meeting: Meeting) => void;
  onNewMeeting: () => void;
  onDuplicateMeeting: (meeting: Meeting) => void;
  onDeleteMeeting: (meeting: Meeting) => void;
}

/**
 * 회의 목록 메인 뷰 컴포넌트
 */
export const MeetingListView: React.FC<MeetingListViewProps> = ({
  meetings,
  currentUserId,
  onSelectMeeting,
  onNewMeeting,
  onDuplicateMeeting,
  onDeleteMeeting,
}) => {
  logger.debug('MeetingListView rendered', { count: meetings.length });

  const [viewMode, setViewMode] = useState<'card' | 'table'>('card');
  const [searchTerm, setSearchTerm] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [departmentFilter, setDepartmentFilter] = useState<string>('all');

  // 고유 사업장/부서 목록 추출
  const departments = useMemo(() => {
    const set = new Set<string>();
    meetings.forEach((m) => {
      if (m.department) set.add(m.department);
    });
    return Array.from(set);
  }, [meetings]);

  // 필터링 및 검색 적용
  const filteredMeetings = useMemo(() => {
    return meetings.filter((m) => {
      // 1. 상태 필터
      if (statusFilter !== 'all' && m.status !== statusFilter) {
        return false;
      }
      // 2. 사업장 필터
      if (departmentFilter !== 'all' && m.department !== departmentFilter) {
        return false;
      }
      // 3. 검색어 필터 (제목, 안건, 작성자, 사업장)
      if (searchTerm.trim()) {
        const query = searchTerm.toLowerCase();
        const inTitle = m.title.toLowerCase().includes(query);
        const inAgenda = m.agenda?.toLowerCase().includes(query);
        const inDept = m.department?.toLowerCase().includes(query);
        const inAuthor = m.author?.toLowerCase().includes(query);
        if (!inTitle && !inAgenda && !inDept && !inAuthor) return false;
      }
      return true;
    });
  }, [meetings, statusFilter, departmentFilter, searchTerm]);

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 space-y-6">
      {/* 상단 헤더 & 빠른 통계 */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-2xl font-bold text-slate-900 tracking-tight">회의록 목록</h2>
          <p className="text-sm text-slate-500 mt-1">
            등록된 전체 회의 {meetings.length}건 중 {filteredMeetings.length}건 표시 중
          </p>
        </div>

        <div className="flex items-center space-x-2">
          {/* 카드 / 목록 보기 토글 */}
          <div className="flex bg-slate-100 p-1 rounded-lg border border-slate-200">
            <button
              type="button"
              onClick={() => setViewMode('card')}
              className={`p-1.5 rounded text-xs font-semibold flex items-center space-x-1 transition-colors ${
                viewMode === 'card' ? 'bg-white shadow text-blue-600' : 'text-slate-600 hover:text-slate-900'
              }`}
              title="카드 뷰"
            >
              <LayoutGrid className="w-4 h-4" />
              <span className="hidden md:inline">카드</span>
            </button>
            <button
              type="button"
              onClick={() => setViewMode('table')}
              className={`p-1.5 rounded text-xs font-semibold flex items-center space-x-1 transition-colors ${
                viewMode === 'table' ? 'bg-white shadow text-blue-600' : 'text-slate-600 hover:text-slate-900'
              }`}
              title="목록 뷰"
            >
              <List className="w-4 h-4" />
              <span className="hidden md:inline">표</span>
            </button>
          </div>

          {/* 신규 회의 작성 버튼 */}
          <button
            type="button"
            onClick={onNewMeeting}
            className="flex items-center space-x-1.5 bg-blue-600 hover:bg-blue-500 text-white font-semibold text-sm px-4 py-2 rounded-lg shadow-sm transition-colors"
          >
            <Plus className="w-4 h-4" />
            <span>새 회의 생성</span>
          </button>
        </div>
      </div>

      {/* 검색창 및 필터 바 */}
      <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-sm flex flex-col md:flex-row items-center gap-3">
        {/* 검색 입력 */}
        <div className="relative flex-1 w-full">
          <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
          <input
            type="text"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            placeholder="회의 제목, 안건, 작성자, 사업장 검색..."
            className="w-full pl-9 pr-4 py-2 text-sm bg-slate-50 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:bg-white transition-all"
          />
        </div>

        {/* 상태 필터 드롭다운 */}
        <div className="flex items-center space-x-2 w-full md:w-auto">
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            className="text-xs p-2.5 bg-slate-50 border border-slate-200 rounded-lg text-slate-700 font-medium focus:outline-none focus:ring-1 focus:ring-blue-500"
          >
            <option value="all">전체 상태</option>
            <option value="draft">작성 중</option>
            <option value="processing">AI 처리 중</option>
            <option value="review">검토 중</option>
            <option value="finalized">확정 완료</option>
            <option value="failed">처리 실패</option>
          </select>

          {/* 사업장 필터 드롭다운 */}
          {departments.length > 0 && (
            <select
              value={departmentFilter}
              onChange={(e) => setDepartmentFilter(e.target.value)}
              className="text-xs p-2.5 bg-slate-50 border border-slate-200 rounded-lg text-slate-700 font-medium focus:outline-none focus:ring-1 focus:ring-blue-500"
            >
              <option value="all">전체 사업장/부서</option>
              {departments.map((dept) => (
                <option key={dept} value={dept}>
                  {dept}
                </option>
              ))}
            </select>
          )}
        </div>
      </div>

      {/* 목록 본문 */}
      {filteredMeetings.length === 0 ? (
        <div className="bg-white rounded-xl border border-slate-200 p-12 text-center shadow-sm">
          <div className="w-12 h-12 bg-slate-100 rounded-full flex items-center justify-center mx-auto text-slate-400 mb-4">
            <FileText className="w-6 h-6" />
          </div>
          <h3 className="text-base font-bold text-slate-800 mb-1">표시할 회의록이 없습니다</h3>
          <p className="text-xs text-slate-500 max-w-sm mx-auto mb-6">
            새로운 회의록을 생성하거나 검색 및 필터 조건을 재조정해보세요.
          </p>
          <button
            type="button"
            onClick={onNewMeeting}
            className="inline-flex items-center space-x-1.5 px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white text-xs font-semibold rounded-lg shadow-sm transition-colors"
          >
            <Plus className="w-4 h-4" />
            <span>첫 회의록 생성하기</span>
          </button>
        </div>
      ) : viewMode === 'card' ? (
        /* 카드형 뷰 그리드 */
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {filteredMeetings.map((meeting) => (
            <MeetingCard
              key={meeting.id}
              meeting={meeting}
              currentUserId={currentUserId}
              onSelect={onSelectMeeting}
              onDuplicate={onDuplicateMeeting}
              onDelete={onDeleteMeeting}
            />
          ))}
        </div>
      ) : (
        /* 테이블 목록형 뷰 */
        <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="bg-slate-50 border-b border-slate-200 text-slate-600 font-semibold">
                <tr>
                  <th className="py-3 px-4">상태</th>
                  <th className="py-3 px-4">회의 제목</th>
                  <th className="py-3 px-4">일시</th>
                  <th className="py-3 px-4">사업장/부서</th>
                  <th className="py-3 px-4">작성자</th>
                  <th className="py-3 px-4">참석자 서명</th>
                  <th className="py-3 px-4 text-right">관리</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {filteredMeetings.map((m) => {
                  const signedCount = m.attendees.filter((a) => a.signatures && a.signatures.length > 0).length;
                  const totalCount = m.attendees.length;
                  const isOwner = m.ownerId === currentUserId || currentUserId === 'local_user';

                  return (
                    <tr
                      key={m.id}
                      onClick={() => onSelectMeeting(m)}
                      className="hover:bg-blue-50/50 cursor-pointer transition-colors"
                    >
                      <td className="py-3 px-4">
                        <span
                          className={`inline-block px-2 py-0.5 rounded text-[11px] font-semibold ${
                            m.status === 'finalized'
                              ? 'bg-emerald-50 text-emerald-700'
                              : m.status === 'review'
                              ? 'bg-amber-50 text-amber-700'
                              : m.status === 'processing'
                              ? 'bg-blue-50 text-blue-700'
                              : 'bg-slate-100 text-slate-700'
                          }`}
                        >
                          {m.status === 'finalized'
                            ? '확정'
                            : m.status === 'review'
                            ? '검토'
                            : m.status === 'processing'
                            ? 'AI처리'
                            : '작성중'}
                        </span>
                      </td>
                      <td className="py-3 px-4 font-bold text-slate-900 max-w-[240px] truncate">
                        {m.title}
                      </td>
                      <td className="py-3 px-4 text-slate-600 whitespace-nowrap">
                        {m.date} ({m.startTime}~{m.endTime})
                      </td>
                      <td className="py-3 px-4 text-slate-600 max-w-[160px] truncate">
                        {m.department || '-'}
                      </td>
                      <td className="py-3 px-4 text-slate-600">{m.author || '-'}</td>
                      <td className="py-3 px-4">
                        <span className="font-semibold text-slate-700">
                          {signedCount}/{totalCount}명
                        </span>
                      </td>
                      <td className="py-3 px-4 text-right whitespace-nowrap" onClick={(e) => e.stopPropagation()}>
                        <div className="flex items-center justify-end space-x-1">
                          <button
                            type="button"
                            onClick={() => onDuplicateMeeting(m)}
                            className="p-1.5 text-slate-500 hover:text-blue-600 rounded hover:bg-slate-100"
                            title="양식 복사"
                          >
                            <Copy className="w-3.5 h-3.5" />
                          </button>
                          {isOwner && (
                            <button
                              type="button"
                              onClick={() => onDeleteMeeting(m)}
                              className="p-1.5 text-slate-500 hover:text-red-600 rounded hover:bg-red-50"
                              title="삭제"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
};
