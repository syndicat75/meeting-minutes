/**
 * @file src/components/meeting/MeetingDetailView.tsx
 * @description 회의 상세 화면 컨테이너 컴포넌트.
 * 상단 뒤로가기, 제목 및 상태 배지, 6대 탭(기본정보, 녹음/대화록, 요약/본문표, 회의사진, 참석자/서명, 최종확정/인쇄)
 * 네비게이션 및 실시간 저장 관리를 지원합니다.
 */

import React, { useState } from 'react';
import {
  ArrowLeft,
  Info,
  Mic,
  Keyboard,
  MessageSquareText,
  FileText,
  Image as ImageIcon,
  Users,
  Printer,
  Save,
  Check,
  Lock,
} from 'lucide-react';
import { Meeting } from '../../types/meeting';
import { BasicInfoTab } from './tabs/BasicInfoTab';
import { RecordingTab } from './tabs/RecordingTab';
import { ManualEntryTab } from './tabs/ManualEntryTab';
import { TranscriptTab } from './tabs/TranscriptTab';
import { SummaryTab } from './tabs/SummaryTab';
import { PhotosTab } from './tabs/PhotosTab';
import { AttendeesTab } from './tabs/AttendeesTab';
import { FinalizePrintTab } from './tabs/FinalizePrintTab';
import { logger } from '../../utils/logger';

interface MeetingDetailViewProps {
  meeting: Meeting;
  currentUserId: string;
  onBackToList: () => void;
  onUpdateMeeting: (updated: Meeting) => void;
  onSaveMeeting: (meeting: Meeting) => Promise<void>;
}

type TabKey = 'basic' | 'recording' | 'manual' | 'transcript' | 'summary' | 'photos' | 'attendees' | 'finalize';

/**
 * 회의 상세 뷰 메인 컴포넌트
 */
export const MeetingDetailView: React.FC<MeetingDetailViewProps> = ({
  meeting,
  currentUserId,
  onBackToList,
  onUpdateMeeting,
  onSaveMeeting,
}) => {
  logger.debug('MeetingDetailView rendered', { meetingId: meeting.id, title: meeting.title });

  const [activeTab, setActiveTab] = useState<TabKey>('basic');
  const [isSaving, setIsSaving] = useState<boolean>(false);
  const [showSavedToast, setShowSavedToast] = useState<boolean>(false);
  const [isLiveRecording, setIsLiveRecording] = useState<boolean>(false);
  const [liveRecordDuration, setLiveRecordDuration] = useState<number>(0);

  const isFinalized = meeting.status === 'finalized';
  const isReadOnly = isFinalized;

  /**
   * 회의 부분 업데이트
   */
  const handlePartialUpdate = (partial: Partial<Meeting>) => {
    logger.debug('handlePartialUpdate called', { fields: Object.keys(partial) });

    // 내용이 변경된 경우 서명 재확인 플래그 점검
    let updatedAttendees = meeting.attendees;
    if (partial.contentRows || partial.agenda || partial.summary) {
      updatedAttendees = meeting.attendees.map((att) => {
        if (att.signatures && att.signatures.length > 0) {
          return { ...att, requiresResign: true };
        }
        return att;
      });
    }

    const updated: Meeting = {
      ...meeting,
      ...partial,
      attendees: partial.attendees || updatedAttendees,
      updatedAt: new Date().toISOString(),
    };

    onUpdateMeeting(updated);
  };

  /**
   * 수동/자동 저장 트리거
   */
  const handleSave = async () => {
    logger.info('handleSave called in MeetingDetailView');
    setIsSaving(true);
    try {
      await onSaveMeeting(meeting);
      setShowSavedToast(true);
      setTimeout(() => setShowSavedToast(false), 2000);
    } catch (err) {
      logger.error('Failed to save meeting', err);
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6 space-y-6">
      {/* 상단 액션 바 (뒤로가기, 제목, 저장 버튼) - 인쇄 시 숨김 */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 no-print border-b border-slate-200 pb-4">
        <div className="flex items-center space-x-3">
          <button
            type="button"
            onClick={onBackToList}
            className="p-2 bg-white hover:bg-slate-100 text-slate-700 rounded-lg border border-slate-200 shadow-sm transition-colors"
            title="회의 목록으로 돌아가기"
          >
            <ArrowLeft className="w-4 h-4" />
          </button>
          <div>
            <div className="flex items-center space-x-2">
              <h2 className="text-xl font-bold text-slate-900 tracking-tight">
                {meeting.title || '새 회의'}
              </h2>
              {isFinalized && (
                <span className="px-2 py-0.5 rounded bg-emerald-100 text-emerald-800 text-xs font-bold flex items-center">
                  <Lock className="w-3 h-3 mr-1" />
                  확정 완료
                </span>
              )}
            </div>
            <p className="text-xs text-slate-500 mt-0.5">
              {meeting.date} | {meeting.department || '사업장 미지정'} | 작성자:{' '}
              {meeting.author || '관리자'}
            </p>
          </div>
        </div>

        {/* 우측 저장 및 피드백 */}
        <div className="flex items-center space-x-2">
          {showSavedToast && (
            <span className="text-xs text-emerald-600 font-semibold flex items-center bg-emerald-50 px-2.5 py-1 rounded border border-emerald-200">
              <Check className="w-3.5 h-3.5 mr-1" />
              저장 완료
            </span>
          )}

          {!isReadOnly && (
            <button
              type="button"
              onClick={handleSave}
              disabled={isSaving}
              className="flex items-center space-x-1.5 px-4 py-2 bg-blue-600 hover:bg-blue-500 active:bg-blue-700 text-white text-xs font-bold rounded-lg shadow-sm transition-colors disabled:opacity-50"
            >
              <Save className="w-3.5 h-3.5" />
              <span>{isSaving ? '저장 중...' : '저장'}</span>
            </button>
          )}
        </div>
      </div>

      {/* 확정 완료 알림 배너 */}
      {isFinalized && (
        <div className="p-3 bg-emerald-50 border border-emerald-200 rounded-xl text-xs text-emerald-800 flex items-center space-x-2 no-print">
          <Lock className="w-4 h-4 text-emerald-600 shrink-0" />
          <span>
            이 회의록은 최종 확정되어 무결성이 보호되는 읽기 전용 상태입니다. 수정을 원하시면 [최종 확정 및 인쇄] 탭에서 확정 해제를 진행하십시오.
          </span>
        </div>
      )}

      {/* 탭 네비게이션 바 (no-print) */}
      <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-1.5 flex flex-wrap gap-1 no-print">
        <button
          type="button"
          onClick={() => setActiveTab('basic')}
          className={`flex items-center space-x-1.5 px-3 py-2 rounded-lg text-xs font-semibold transition-colors ${
            activeTab === 'basic'
              ? 'bg-blue-600 text-white shadow-sm'
              : 'text-slate-600 hover:bg-slate-100'
          }`}
        >
          <Info className="w-3.5 h-3.5" />
          <span>기본 정보</span>
        </button>

        <button
          type="button"
          onClick={() => setActiveTab('recording')}
          className={`flex items-center space-x-1.5 px-3 py-2 rounded-lg text-xs font-semibold transition-colors ${
            activeTab === 'recording'
              ? 'bg-blue-600 text-white shadow-sm'
              : 'text-slate-600 hover:bg-slate-100'
          }`}
        >
          <Mic className="w-3.5 h-3.5" />
          <span>녹음 및 오디오</span>
          {isLiveRecording && (
            <span className="w-2 h-2 rounded-full bg-red-500 animate-ping ml-0.5" />
          )}
        </button>

        <button
          type="button"
          onClick={() => setActiveTab('manual')}
          className={`flex items-center space-x-1.5 px-3 py-2 rounded-lg text-xs font-semibold transition-colors ${
            activeTab === 'manual'
              ? 'bg-blue-600 text-white shadow-sm'
              : 'text-slate-600 hover:bg-slate-100'
          }`}
        >
          <Keyboard className="w-3.5 h-3.5" />
          <span>직접 작성</span>
          {meeting.manualEntries && meeting.manualEntries.length > 0 && (
            <span
              className={`text-[10px] px-1.5 py-0.2 rounded-full ${
                activeTab === 'manual'
                  ? 'bg-blue-700 text-white'
                  : 'bg-blue-100 text-blue-800'
              }`}
            >
              {meeting.manualEntries.length}
            </span>
          )}
        </button>

        <button
          type="button"
          onClick={() => setActiveTab('transcript')}
          className={`flex items-center space-x-1.5 px-3 py-2 rounded-lg text-xs font-semibold transition-colors ${
            activeTab === 'transcript'
              ? 'bg-blue-600 text-white shadow-sm'
              : 'text-slate-600 hover:bg-slate-100'
          }`}
        >
          <MessageSquareText className="w-3.5 h-3.5" />
          <span>화자별 대화록</span>
          {meeting.transcripts && meeting.transcripts.length > 0 && (
            <span
              className={`text-[10px] px-1.5 py-0.2 rounded-full ${
                activeTab === 'transcript'
                  ? 'bg-blue-700 text-white'
                  : 'bg-slate-200 text-slate-700'
              }`}
            >
              {meeting.transcripts.length}
            </span>
          )}
        </button>

        <button
          type="button"
          onClick={() => setActiveTab('summary')}
          className={`flex items-center space-x-1.5 px-3 py-2 rounded-lg text-xs font-semibold transition-colors ${
            activeTab === 'summary'
              ? 'bg-blue-600 text-white shadow-sm'
              : 'text-slate-600 hover:bg-slate-100'
          }`}
        >
          <FileText className="w-3.5 h-3.5" />
          <span>요약 및 회의내용</span>
        </button>

        <button
          type="button"
          onClick={() => setActiveTab('photos')}
          className={`flex items-center space-x-1.5 px-3 py-2 rounded-lg text-xs font-semibold transition-colors ${
            activeTab === 'photos'
              ? 'bg-blue-600 text-white shadow-sm'
              : 'text-slate-600 hover:bg-slate-100'
          }`}
        >
          <ImageIcon className="w-3.5 h-3.5" />
          <span>회의 사진</span>
          {meeting.photos && meeting.photos.length > 0 && (
            <span
              className={`text-[10px] px-1.5 py-0.2 rounded-full ${
                activeTab === 'photos'
                  ? 'bg-blue-700 text-white'
                  : 'bg-slate-200 text-slate-700'
              }`}
            >
              {meeting.photos.length}
            </span>
          )}
        </button>

        <button
          type="button"
          onClick={() => setActiveTab('attendees')}
          className={`flex items-center space-x-1.5 px-3 py-2 rounded-lg text-xs font-semibold transition-colors ${
            activeTab === 'attendees'
              ? 'bg-blue-600 text-white shadow-sm'
              : 'text-slate-600 hover:bg-slate-100'
          }`}
        >
          <Users className="w-3.5 h-3.5" />
          <span>참석자 및 서명</span>
          <span
            className={`text-[10px] px-1.5 py-0.2 rounded-full ${
              activeTab === 'attendees'
                ? 'bg-blue-700 text-white'
                : 'bg-slate-200 text-slate-700'
            }`}
          >
            {meeting.attendees.filter((a) => a.signatures && a.signatures.length > 0).length}/
            {meeting.attendees.length}
          </span>
        </button>

        <button
          type="button"
          onClick={() => setActiveTab('finalize')}
          className={`flex items-center space-x-1.5 px-3 py-2 rounded-lg text-xs font-semibold transition-colors ml-auto ${
            activeTab === 'finalize'
              ? 'bg-slate-900 text-white shadow-sm'
              : 'text-slate-800 bg-slate-100 hover:bg-slate-200'
          }`}
        >
          <Printer className="w-3.5 h-3.5 text-blue-400" />
          <span>최종 확정 및 인쇄</span>
        </button>
      </div>

      {/* 탭 본문 영역 */}
      <div>
        {activeTab === 'basic' && (
          <BasicInfoTab
            meeting={meeting}
            isReadOnly={isReadOnly}
            currentUserId={currentUserId}
            onUpdateMeeting={handlePartialUpdate}
            onSave={handleSave}
          />
        )}

        {/* 녹음 탭: 탭 이동 시에도 MediaRecorder가 언마운트되지 않도록 hidden 방식으로 보존 */}
        <div className={activeTab === 'recording' ? 'block' : 'hidden'}>
          <RecordingTab
            meeting={meeting}
            isReadOnly={isReadOnly}
            onUpdateMeeting={handlePartialUpdate}
            onSwitchToTranscriptTab={() => setActiveTab('transcript')}
            onRecordingStateChange={(rec, dur) => {
              setIsLiveRecording(rec);
              setLiveRecordDuration(dur);
            }}
          />
        </div>

        {/* 직접 작성 탭: 입력 중 텍스트 보존을 위해 hidden 방식으로 보존 */}
        <div className={activeTab === 'manual' ? 'block' : 'hidden'}>
          <ManualEntryTab
            meeting={meeting}
            isReadOnly={isReadOnly}
            onUpdateMeeting={handlePartialUpdate}
            onSave={handleSave}
            isRecording={isLiveRecording}
            currentRecordDurationSeconds={liveRecordDuration}
            onNavigateTab={(tabKey) => setActiveTab(tabKey as TabKey)}
          />
        </div>

        {activeTab === 'transcript' && (
          <TranscriptTab
            meeting={meeting}
            isReadOnly={isReadOnly}
            onUpdateMeeting={handlePartialUpdate}
          />
        )}

        {activeTab === 'summary' && (
          <SummaryTab
            meeting={meeting}
            isReadOnly={isReadOnly}
            onUpdateMeeting={handlePartialUpdate}
          />
        )}

        {activeTab === 'photos' && (
          <PhotosTab
            meeting={meeting}
            isReadOnly={isReadOnly}
            onUpdateMeeting={handlePartialUpdate}
          />
        )}

        {activeTab === 'attendees' && (
          <AttendeesTab
            meeting={meeting}
            isReadOnly={isReadOnly}
            onUpdateMeeting={handlePartialUpdate}
          />
        )}

        {activeTab === 'finalize' && (
          <FinalizePrintTab
            meeting={meeting}
            currentUserId={currentUserId}
            onUpdateMeeting={handlePartialUpdate}
            onSave={handleSave}
          />
        )}
      </div>
    </div>
  );
};
