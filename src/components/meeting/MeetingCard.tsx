/**
 * @file src/components/meeting/MeetingCard.tsx
 * @description 회의 카드 단일 컴포넌트. 제목, 일시, 상태, 녹음 유무, 사진 수, 서명 완료 현황 표시 및 복사/삭제 동작 지원.
 */

import React from 'react';
import {
  Calendar,
  Clock,
  MapPin,
  Building,
  Mic,
  Image as ImageIcon,
  PenTool,
  Copy,
  Trash2,
  CheckCircle2,
  AlertCircle,
  FileEdit,
} from 'lucide-react';
import { Meeting, MeetingStatus } from '../../types/meeting';
import { formatKoreanDate } from '../../utils/formatters';
import { logger } from '../../utils/logger';

interface MeetingCardProps {
  meeting: Meeting;
  currentUserId: string;
  onSelect: (meeting: Meeting) => void;
  onDuplicate: (meeting: Meeting) => void;
  onDelete: (meeting: Meeting) => void;
}

/**
 * 상태별 배지 스타일 및 한국어 텍스트 매핑
 */
const STATUS_CONFIG: Record<MeetingStatus, { label: string; bg: string; text: string; border: string }> = {
  draft: { label: '작성 중', bg: 'bg-slate-100', text: 'text-slate-700', border: 'border-slate-300' },
  processing: { label: 'AI 처리 중', bg: 'bg-blue-50', text: 'text-blue-700', border: 'border-blue-300' },
  review: { label: '검토 중', bg: 'bg-amber-50', text: 'text-amber-700', border: 'border-amber-300' },
  finalized: { label: '확정 완료', bg: 'bg-emerald-50', text: 'text-emerald-700', border: 'border-emerald-300' },
  failed: { label: '처리 실패', bg: 'bg-red-50', text: 'text-red-700', border: 'border-red-300' },
};

/**
 * 회의 카드 컴포넌트
 */
export const MeetingCard: React.FC<MeetingCardProps> = ({
  meeting,
  currentUserId,
  onSelect,
  onDuplicate,
  onDelete,
}) => {
  logger.debug('MeetingCard rendered', { meetingId: meeting.id, title: meeting.title });

  const statusStyle = STATUS_CONFIG[meeting.status] || STATUS_CONFIG.draft;
  const isOwner = meeting.ownerId === currentUserId || currentUserId === 'local_user';

  // 서명 완료 인원 수 계산
  const signedCount = meeting.attendees.filter((att) => att.signatures && att.signatures.length > 0).length;
  const totalAttendees = meeting.attendees.length;

  return (
    <div
      id={`meeting-card-${meeting.id}`}
      className="bg-white rounded-xl border border-slate-200 shadow-sm hover:shadow-md hover:border-blue-400 transition-all flex flex-col justify-between overflow-hidden group"
    >
      <div className="p-5 cursor-pointer" onClick={() => onSelect(meeting)}>
        {/* 상단 메타: 상태 배지 및 날짜 */}
        <div className="flex items-center justify-between gap-2 mb-3">
          <span
            className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-semibold border ${statusStyle.bg} ${statusStyle.text} ${statusStyle.border}`}
          >
            {meeting.status === 'finalized' && <CheckCircle2 className="w-3 h-3 mr-1" />}
            {meeting.status === 'failed' && <AlertCircle className="w-3 h-3 mr-1" />}
            {statusStyle.label}
          </span>
          <span className="text-xs text-slate-500 flex items-center">
            <Calendar className="w-3.5 h-3.5 mr-1 text-slate-400" />
            {formatKoreanDate(meeting.date) || '일자 미정'}
          </span>
        </div>

        {/* 회의 제목 */}
        <h4 className="text-base font-bold text-slate-900 line-clamp-2 group-hover:text-blue-600 transition-colors mb-2">
          {meeting.title || '제목 없는 회의'}
        </h4>

        {/* 장소 및 사업장 */}
        <div className="space-y-1 text-xs text-slate-600 mb-4">
          <div className="flex items-center text-slate-500">
            <Building className="w-3.5 h-3.5 mr-1.5 shrink-0 text-slate-400" />
            <span className="truncate">{meeting.department || '사업장/부서 미정'}</span>
          </div>
          <div className="flex items-center text-slate-500">
            <Clock className="w-3.5 h-3.5 mr-1.5 shrink-0 text-slate-400" />
            <span>{meeting.startTime || '--:--'} ~ {meeting.endTime || '--:--'}</span>
          </div>
          <div className="flex items-center text-slate-500">
            <MapPin className="w-3.5 h-3.5 mr-1.5 shrink-0 text-slate-400" />
            <span className="truncate">{meeting.location || '장소 미정'}</span>
          </div>
        </div>

        {/* 회의 현황 지표 칩들 (녹음, 사진, 서명 수) */}
        <div className="flex flex-wrap items-center gap-1.5 pt-3 border-t border-slate-100 text-xs">
          {/* 녹음 유무 */}
          <span
            className={`inline-flex items-center px-2 py-0.5 rounded text-[11px] ${
              meeting.recording || (meeting.transcripts && meeting.transcripts.length > 0)
                ? 'bg-blue-50 text-blue-700 font-medium'
                : 'bg-slate-100 text-slate-400'
            }`}
          >
            <Mic className="w-3 h-3 mr-1" />
            {meeting.recording || (meeting.transcripts && meeting.transcripts.length > 0) ? '녹음/대화록' : '녹음 없음'}
          </span>

          {/* 사진 수 */}
          <span
            className={`inline-flex items-center px-2 py-0.5 rounded text-[11px] ${
              meeting.photos && meeting.photos.length > 0
                ? 'bg-purple-50 text-purple-700 font-medium'
                : 'bg-slate-100 text-slate-400'
            }`}
          >
            <ImageIcon className="w-3 h-3 mr-1" />
            사진 {meeting.photos?.length || 0}장
          </span>

          {/* 서명 완료 현황 */}
          <span
            className={`inline-flex items-center px-2 py-0.5 rounded text-[11px] ${
              signedCount > 0
                ? signedCount === totalAttendees
                  ? 'bg-emerald-50 text-emerald-700 font-bold'
                  : 'bg-amber-50 text-amber-700 font-medium'
                : 'bg-slate-100 text-slate-400'
            }`}
          >
            <PenTool className="w-3 h-3 mr-1" />
            서명 {signedCount}/{totalAttendees}명
          </span>
        </div>
      </div>

      {/* 카드 하단 액션 버튼 */}
      <div className="bg-slate-50 px-4 py-2.5 border-t border-slate-200 flex items-center justify-between text-xs">
        <span className="text-slate-500 truncate max-w-[120px]">
          작성: {meeting.author || '관리자'}
        </span>

        <div className="flex items-center space-x-1">
          {/* 양식 및 참석자 복사 버튼 */}
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onDuplicate(meeting);
            }}
            className="p-1.5 text-slate-600 hover:text-blue-600 hover:bg-slate-200 rounded transition-colors"
            title="양식 및 참석자만 복사하여 새 회의 생성"
          >
            <Copy className="w-3.5 h-3.5" />
          </button>

          {/* 소유자 삭제 버튼 */}
          {isOwner && (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                onDelete(meeting);
              }}
              className="p-1.5 text-slate-500 hover:text-red-600 hover:bg-red-50 rounded transition-colors"
              title="회의 삭제"
            >
              <Trash2 className="w-3.5 h-3.5" />
            </button>
          )}

          {/* 편집/상세 보기 버튼 */}
          <button
            type="button"
            onClick={() => onSelect(meeting)}
            className="ml-1 px-2.5 py-1 bg-blue-600 hover:bg-blue-500 text-white rounded font-medium transition-colors"
          >
            열기
          </button>
        </div>
      </div>
    </div>
  );
};
