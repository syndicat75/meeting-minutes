/**
 * @file src/components/meeting/tabs/ManualEntryTab.tsx
 * @description 회의내용 직접 입력(사람이 직접 키보드로 작성) 전용 탭 컴포넌트.
 * 녹음 기반 AI 전사와 독립적이거나 병행하여 사용할 수 있으며,
 * 자유 메모, 화자별 구조화 발언 입력, 타임스탬프 연동, Action Item 직접 관리,
 * 실시간 자동 저장 및 AI 회의록 정리(요약 생성) 기능을 지원합니다.
 */

import React, { useState, useEffect, useRef, useMemo } from 'react';
import {
  Keyboard,
  Mic,
  Clock,
  User,
  Plus,
  Trash2,
  Edit2,
  Check,
  X,
  Star,
  ArrowUp,
  ArrowDown,
  Sparkles,
  Save,
  Search,
  Filter,
  CheckSquare,
  Square,
  FileText,
  AlertCircle,
  Calendar,
  ListOrdered,
  Bold,
  List,
  RotateCcw,
  Layers,
  ChevronRight,
} from 'lucide-react';
import {
  Meeting,
  ManualEntry,
  ManualActionItem,
  Attendee,
  TranscriptSegment,
} from '../../../types/meeting';
import {
  createNewManualEntry,
  createNewManualActionItem,
  reorderManualEntries,
  sortManualEntriesByTimestamp,
  saveManualEntryLocalBackup,
  getManualEntryLocalBackup,
} from '../../../services/manualEntryService';
import { requestComprehensiveMeetingSummary } from '../../../services/transcriptionClientService';
import { formatDuration, formatSecondsToTime } from '../../../utils/formatters';
import { logger } from '../../../utils/logger';

interface ManualEntryTabProps {
  meeting: Meeting;
  isReadOnly: boolean;
  onUpdateMeeting: (partial: Partial<Meeting>) => void;
  onSave: () => Promise<void>;
  isRecording?: boolean;
  currentRecordDurationSeconds?: number;
  onNavigateTab?: (tabKey: string) => void;
}

type SubViewMode = 'speaker_entries' | 'freeform_memo' | 'action_items' | 'merged_timeline';

/**
 * 직접 작성 회의록 탭 컴포넌트
 */
export const ManualEntryTab: React.FC<ManualEntryTabProps> = ({
  meeting,
  isReadOnly,
  onUpdateMeeting,
  onSave,
  isRecording = false,
  currentRecordDurationSeconds = 0,
  onNavigateTab,
}) => {
  logger.debug('ManualEntryTab rendered', {
    meetingId: meeting.id,
    entriesCount: meeting.manualEntries?.length || 0,
    isRecording,
    durationSec: currentRecordDurationSeconds,
  });

  // 서브 뷰 모드
  const [activeSubMode, setActiveSubMode] = useState<SubViewMode>('speaker_entries');

  // 자동 저장 상태
  const [saveStatus, setSaveStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('saved');
  const [lastSavedTime, setLastSavedTime] = useState<string>(
    new Date().toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit', second: '2-digit' })
  );

  // 화자별 발언 입력 폼 상태
  const [selectedSpeakerId, setSelectedSpeakerId] = useState<string>('unassigned');
  const [customSpeakerName, setCustomSpeakerName] = useState<string>('');
  const [timestampInput, setTimestampInput] = useState<string>('');
  const [speechText, setSpeechText] = useState<string>('');
  const [isOfficialSpeech, setIsOfficialSpeech] = useState<boolean>(true);
  const [isImportantSpeech, setIsImportantSpeech] = useState<boolean>(false);
  const [editingEntryId, setEditingEntryId] = useState<string | null>(null);

  // 자유 메모 상태
  const [memoText, setMemoText] = useState<string>(meeting.freeformMemo || '');
  const [memoTemplateApplied, setMemoTemplateApplied] = useState<boolean>(false);

  // Action Item 입력 폼 상태
  const [actionTask, setActionTask] = useState<string>('');
  const [actionAssignee, setActionAssignee] = useState<string>('');
  const [actionDueDate, setActionDueDate] = useState<string>('');
  const [actionIsImportant, setActionIsImportant] = useState<boolean>(false);

  // 발언 목록 검색 및 필터 상태
  const [searchTerm, setSearchTerm] = useState<string>('');
  const [speakerFilter, setSpeakerFilter] = useState<string>('all');
  const [filterOnlyImportant, setFilterOnlyImportant] = useState<boolean>(false);
  const [filterOfficialOnly, setFilterOfficialOnly] = useState<boolean>(false);

  // AI 회의록 정리(요약 생성) 진행 상태
  const [isAiSummarizing, setIsAiSummarizing] = useState<boolean>(false);
  const [aiSummaryError, setAiSummaryError] = useState<string | null>(null);
  const [showAiSuccessModal, setShowAiSuccessModal] = useState<boolean>(false);

  // 디바운스 자동 저장을 위한 ref
  const debounceTimerRef = useRef<NodeJS.Timeout | null>(null);
  const speechInputRef = useRef<HTMLTextAreaElement | null>(null);

  // 컴포넌트 마운트 시 로컬스토리지 백업 점검
  useEffect(() => {
    logger.info('Checking local backup on mount', { meetingId: meeting.id });
    const backup = getManualEntryLocalBackup(meeting.id);
    if (backup) {
      const serverEntries = meeting.manualEntries || [];
      // 백업이 더 최신이고 서버 데이터가 비어있는 경우 복원 유도 가능
      if (serverEntries.length === 0 && backup.manualEntries.length > 0) {
        logger.info('Restoring manual entries from local backup');
        onUpdateMeeting({
          manualEntries: backup.manualEntries,
          freeformMemo: backup.freeformMemo || meeting.freeformMemo,
          manualActionItems: backup.manualActionItems || meeting.manualActionItems,
        });
      }
    }
  }, [meeting.id]);

  // 외부 회의 변경 시 memoText 동기화 (사용자가 타이핑 중이 아닐 때)
  useEffect(() => {
    if (meeting.freeformMemo !== undefined && meeting.freeformMemo !== memoText) {
      setMemoText(meeting.freeformMemo);
    }
  }, [meeting.freeformMemo]);

  /**
   * 자동 저장 및 Firestore 동기화 헬퍼 (디바운스 1.2초)
   */
  const triggerAutoSave = (updatedMeeting: Partial<Meeting>) => {
    logger.info('triggerAutoSave called');
    setSaveStatus('saving');

    // 1. 상태 즉시 상위로 업데이트
    onUpdateMeeting(updatedMeeting);

    // 2. 로컬 브라우저 스토리지 즉시 백업
    const finalEntries = updatedMeeting.manualEntries !== undefined ? updatedMeeting.manualEntries : (meeting.manualEntries || []);
    const finalMemo = updatedMeeting.freeformMemo !== undefined ? updatedMeeting.freeformMemo : (meeting.freeformMemo || '');
    const finalActionItems = updatedMeeting.manualActionItems !== undefined ? updatedMeeting.manualActionItems : (meeting.manualActionItems || []);
    saveManualEntryLocalBackup(meeting.id, finalEntries, finalMemo, finalActionItems);

    // 3. 서버 Firestore 저장 디바운스
    if (debounceTimerRef.current) {
      clearTimeout(debounceTimerRef.current);
    }

    debounceTimerRef.current = setTimeout(async () => {
      try {
        await onSave();
        setSaveStatus('saved');
        setLastSavedTime(
          new Date().toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit', second: '2-digit' })
        );
        logger.info('Auto-save successfully persisted to server');
      } catch (err) {
        logger.error('Auto-save failed', { error: String(err) });
        setSaveStatus('error');
      }
    }, 1200);
  };

  /**
   * [⏱ 현재시간] 버튼 클릭 핸들러
   * 녹음 중일 때 현재 녹음 경과시간(MM:SS)을 자동 입력합니다.
   */
  const handleInsertCurrentTime = () => {
    logger.info('handleInsertCurrentTime called', { isRecording, currentRecordDurationSeconds });
    if (isRecording && currentRecordDurationSeconds >= 0) {
      const formatted = formatDuration(currentRecordDurationSeconds);
      setTimestampInput(formatted);
    } else {
      // 녹음 미진행 시 현재 시각 기준 (HH:MM:SS) 또는 00:00
      const now = new Date();
      const timeStr = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}:${String(now.getSeconds()).padStart(2, '0')}`;
      setTimestampInput(timeStr);
    }
  };

  /**
   * 타임스탬프 문자열을 초(seconds) 단위 숫자로 변환
   */
  const parseTimeToSeconds = (input: string): number | undefined => {
    if (!input || !input.trim()) return undefined;
    const parts = input.trim().split(':').map((p) => parseInt(p, 10));
    if (parts.some((p) => isNaN(p))) return undefined;

    if (parts.length === 3) {
      // HH:MM:SS
      return parts[0] * 3600 + parts[1] * 60 + parts[2];
    } else if (parts.length === 2) {
      // MM:SS
      return parts[0] * 60 + parts[1];
    } else if (parts.length === 1) {
      // SS
      return parts[0];
    }
    return undefined;
  };

  /**
   * 발언자 표시 이름 계산
   */
  const resolveSpeakerName = (): string => {
    if (selectedSpeakerId === 'other') {
      return customSpeakerName.trim() || '기타 발언자';
    }
    if (selectedSpeakerId === 'unassigned') {
      return '참석자 미지정';
    }
    const attendee = meeting.attendees.find((a) => a.id === selectedSpeakerId);
    if (attendee) {
      return attendee.name + (attendee.role ? ` (${attendee.role})` : '');
    }
    return '참석자';
  };

  /**
   * 템플릿 태그 텍스트에어리어에 삽입
   */
  const handleInsertTemplate = (templateTag: string) => {
    logger.info('handleInsertTemplate called', { templateTag });
    setSpeechText((prev) => {
      const separator = prev.length > 0 && !prev.endsWith('\n') ? '\n' : '';
      return `${prev}${separator}${templateTag} `;
    });
    if (speechInputRef.current) {
      speechInputRef.current.focus();
    }
  };

  /**
   * 텍스트 서식 툴바 삽입
   */
  const handleInsertFormatting = (formatType: 'bold' | 'bullet' | 'number') => {
    logger.info('handleInsertFormatting called', { formatType });
    if (!speechInputRef.current) return;
    const textarea = speechInputRef.current;
    const start = textarea.selectionStart;
    const end = textarea.selectionEnd;
    const selected = speechText.substring(start, end);

    let replacement = '';
    if (formatType === 'bold') {
      replacement = `**${selected || '강조 텍스트'}**`;
    } else if (formatType === 'bullet') {
      replacement = `\n- ${selected || '항목 내용'}`;
    } else if (formatType === 'number') {
      replacement = `\n1. ${selected || '항목 내용'}`;
    }

    const newText = speechText.substring(0, start) + replacement + speechText.substring(end);
    setSpeechText(newText);
  };

  /**
   * 화자별 발언 추가 또는 수정 저장
   */
  const handleSaveSpeechEntry = (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    logger.info('handleSaveSpeechEntry called', { editingEntryId });

    if (!speechText.trim()) {
      alert('발언 내용을 입력해주세요.');
      return;
    }

    const speakerName = resolveSpeakerName();
    const timestampSeconds = parseTimeToSeconds(timestampInput);
    const currentEntries = [...(meeting.manualEntries || [])];

    if (editingEntryId) {
      // 수정 모드
      const updated = currentEntries.map((item) => {
        if (item.id === editingEntryId) {
          return {
            ...item,
            speakerId: selectedSpeakerId,
            speakerName,
            timestampSeconds,
            text: speechText.trim(),
            isOfficial: isOfficialSpeech,
            isImportant: isImportantSpeech,
            updatedAt: new Date().toISOString(),
          };
        }
        return item;
      });

      triggerAutoSave({ manualEntries: updated });
      setEditingEntryId(null);
    } else {
      // 신규 추가 모드
      const newEntry = createNewManualEntry({
        speakerId: selectedSpeakerId,
        speakerName,
        timestampSeconds,
        text: speechText.trim(),
        isOfficial: isOfficialSpeech,
        isImportant: isImportantSpeech,
        order: currentEntries.length,
      });

      const updated = [...currentEntries, newEntry];
      triggerAutoSave({ manualEntries: updated });
    }

    // 입력 폼 리셋 (화자 선택은 반복 입력을 위해 유지, 내용과 타임스탬프만 리셋)
    setSpeechText('');
    setTimestampInput('');
    setIsImportantSpeech(false);
    if (selectedSpeakerId === 'other') {
      setCustomSpeakerName('');
    }
    if (speechInputRef.current) {
      speechInputRef.current.focus();
    }
  };

  /**
   * 발언 수정 모드 진입
   */
  const handleStartEditEntry = (entry: ManualEntry) => {
    logger.info('handleStartEditEntry called', { entryId: entry.id });
    setEditingEntryId(entry.id);
    setSelectedSpeakerId(entry.speakerId || 'unassigned');
    setSpeechText(entry.text);
    setIsOfficialSpeech(entry.isOfficial);
    setIsImportantSpeech(Boolean(entry.isImportant));
    setTimestampInput(
      typeof entry.timestampSeconds === 'number' ? formatDuration(entry.timestampSeconds) : ''
    );
    if (speechInputRef.current) {
      speechInputRef.current.scrollIntoView({ behavior: 'smooth' });
      speechInputRef.current.focus();
    }
  };

  /**
   * 발언 수정 취소
   */
  const handleCancelEdit = () => {
    logger.info('handleCancelEdit called');
    setEditingEntryId(null);
    setSpeechText('');
    setTimestampInput('');
    setIsImportantSpeech(false);
  };

  /**
   * 발언 삭제
   */
  const handleDeleteEntry = (entryId: string) => {
    logger.info('handleDeleteEntry called', { entryId });
    const target = (meeting.manualEntries || []).find((e) => e.id === entryId);
    if (!target) return;

    const confirmMsg = target.isImportant
      ? '⭐ 중요 표시된 발언입니다. 정말로 삭제하시겠습니까?'
      : '이 발언을 삭제하시겠습니까?';

    if (!window.confirm(confirmMsg)) return;

    const updated = (meeting.manualEntries || []).filter((e) => e.id !== entryId);
    // order 재배열
    const reordered = updated.map((item, idx) => ({ ...item, order: idx }));
    triggerAutoSave({ manualEntries: reordered });

    if (editingEntryId === entryId) {
      handleCancelEdit();
    }
  };

  /**
   * 발언 위로 이동
   */
  const handleMoveUp = (index: number) => {
    logger.info('handleMoveUp called', { index });
    if (index <= 0) return;
    const updated = reorderManualEntries(meeting.manualEntries || [], index, index - 1);
    triggerAutoSave({ manualEntries: updated });
  };

  /**
   * 발언 아래로 이동
   */
  const handleMoveDown = (index: number) => {
    logger.info('handleMoveDown called', { index });
    const list = meeting.manualEntries || [];
    if (index >= list.length - 1) return;
    const updated = reorderManualEntries(list, index, index + 1);
    triggerAutoSave({ manualEntries: updated });
  };

  /**
   * 중요(⭐) 토글
   */
  const handleToggleImportant = (entryId: string) => {
    logger.info('handleToggleImportant called', { entryId });
    const updated = (meeting.manualEntries || []).map((e) => {
      if (e.id === entryId) {
        return { ...e, isImportant: !e.isImportant, updatedAt: new Date().toISOString() };
      }
      return e;
    });
    triggerAutoSave({ manualEntries: updated });
  };

  /**
   * 공식/개인 토글
   */
  const handleToggleOfficial = (entryId: string) => {
    logger.info('handleToggleOfficial called', { entryId });
    const updated = (meeting.manualEntries || []).map((e) => {
      if (e.id === entryId) {
        return { ...e, isOfficial: !e.isOfficial, updatedAt: new Date().toISOString() };
      }
      return e;
    });
    triggerAutoSave({ manualEntries: updated });
  };

  /**
   * 타임스탬프 순 일괄 정렬
   */
  const handleSortByTimestamp = () => {
    logger.info('handleSortByTimestamp called');
    const sorted = sortManualEntriesByTimestamp(meeting.manualEntries || []);
    triggerAutoSave({ manualEntries: sorted });
  };

  /**
   * 자유 메모 변경 핸들러 (실시간 반영)
   */
  const handleMemoChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const text = e.target.value;
    setMemoText(text);
    triggerAutoSave({ freeformMemo: text });
  };

  /**
   * 자유 메모 빠른 서식 템플릿 적용
   */
  const handleApplyMemoTemplate = () => {
    logger.info('handleApplyMemoTemplate called');
    const template = `[1. 회의 배경 및 경과보고]
- 

[2. 주요 안건 심의]
- 안건 1: 
- 안건 2: 

[3. 합의 및 결정사항]
- 결정 1: 
- 결정 2: 

[4. 후속 조치 과제(Action Items)]
- 과제: / 담당: / 기한: 

[5. 미결 및 차기 회의 안건]
- `;
    const updated = memoText.trim() ? `${memoText}\n\n${template}` : template;
    setMemoText(updated);
    triggerAutoSave({ freeformMemo: updated });
    setMemoTemplateApplied(true);
  };

  /**
   * Action Item 직접 추가
   */
  const handleAddActionItem = (e: React.FormEvent) => {
    e.preventDefault();
    logger.info('handleAddActionItem called', { task: actionTask, assignee: actionAssignee });
    if (!actionTask.trim()) {
      alert('할 일(업무 내용)을 입력해주세요.');
      return;
    }

    const newItem = createNewManualActionItem({
      task: actionTask.trim(),
      assignee: actionAssignee.trim() || '미지정',
      dueDate: actionDueDate.trim() || '미지정',
      isImportant: actionIsImportant,
    });

    const currentList = meeting.manualActionItems || [];
    const updated = [...currentList, newItem];
    triggerAutoSave({ manualActionItems: updated });

    setActionTask('');
    setActionAssignee('');
    setActionDueDate('');
    setActionIsImportant(false);
  };

  /**
   * Action Item 상태 토글
   */
  const handleToggleActionStatus = (itemId: string) => {
    logger.info('handleToggleActionStatus called', { itemId });
    const currentList = meeting.manualActionItems || [];
    const updated = currentList.map((item) => {
      if (item.id === itemId) {
        const nextStatus = item.status === 'completed' ? 'pending' : 'completed';
        return { ...item, status: nextStatus, updatedAt: new Date().toISOString() };
      }
      return item;
    });
    triggerAutoSave({ manualActionItems: updated });
  };

  /**
   * Action Item 삭제
   */
  const handleDeleteActionItem = (itemId: string) => {
    logger.info('handleDeleteActionItem called', { itemId });
    if (!window.confirm('이 과제 항목을 삭제하시겠습니까?')) return;
    const currentList = meeting.manualActionItems || [];
    const updated = currentList.filter((item) => item.id !== itemId);
    triggerAutoSave({ manualActionItems: updated });
  };

  /**
   * [AI로 회의록 정리] 핸들러
   * 사용자가 직접 작성한 발언/메모/Action Item을 종합하여 구조화된 회의록 요약을 자동 생성합니다.
   */
  const handleAiSummarizeManualNotes = async () => {
    logger.info('handleAiSummarizeManualNotes called', { meetingId: meeting.id });

    const hasEntries = (meeting.manualEntries || []).length > 0;
    const hasMemo = Boolean(memoText && memoText.trim());
    const hasActionItems = (meeting.manualActionItems || []).length > 0;
    const hasTranscripts = (meeting.transcripts || []).length > 0;

    if (!hasEntries && !hasMemo && !hasActionItems && !hasTranscripts) {
      alert('AI 요약을 생성할 내용이 없습니다. 발언이나 메모를 먼저 작성해주세요.');
      return;
    }

    setIsAiSummarizing(true);
    setAiSummaryError(null);

    try {
      const summaryResult = await requestComprehensiveMeetingSummary(
        meeting.id,
        {
          title: meeting.title,
          agenda: meeting.agenda,
          department: meeting.department,
          date: meeting.date,
          attendees: meeting.attendees,
        },
        meeting.transcripts || [],
        {
          manualEntries: meeting.manualEntries || [],
          freeformMemo: memoText,
          manualActionItems: meeting.manualActionItems || [],
        }
      );

      logger.info('Comprehensive meeting summary generated successfully');

      // 회의 요약 상태 업데이트
      triggerAutoSave({
        summary: summaryResult,
        userEditedSummary: summaryResult,
      });

      setShowAiSuccessModal(true);
    } catch (err: any) {
      logger.error('handleAiSummarizeManualNotes failed', { error: String(err) });
      setAiSummaryError(err.message || 'AI 회의록 정리 중 오류가 발생했습니다.');
    } finally {
      setIsAiSummarizing(false);
    }
  };

  // 필터링된 발언 목록 계산
  const filteredEntries = useMemo(() => {
    return (meeting.manualEntries || []).filter((item) => {
      // 1. 검색어 필터
      if (searchTerm.trim()) {
        const term = searchTerm.toLowerCase();
        const matchText = item.text.toLowerCase().includes(term);
        const matchSpeaker = item.speakerName.toLowerCase().includes(term);
        if (!matchText && !matchSpeaker) return false;
      }
      // 2. 화자 필터
      if (speakerFilter !== 'all') {
        if (item.speakerId !== speakerFilter && item.speakerName !== speakerFilter) {
          return false;
        }
      }
      // 3. 중요도 필터
      if (filterOnlyImportant && !item.isImportant) {
        return false;
      }
      // 4. 공식 회의록 필터
      if (filterOfficialOnly && !item.isOfficial) {
        return false;
      }
      return true;
    });
  }, [meeting.manualEntries, searchTerm, speakerFilter, filterOnlyImportant, filterOfficialOnly]);

  // 통합 타임라인 목록 계산 (AI 전사 + 직접 발언 병합)
  const mergedTimelineList = useMemo(() => {
    interface MergedItem {
      id: string;
      sourceType: 'ai' | 'manual';
      startSeconds: number;
      timeLabel: string;
      speakerName: string;
      text: string;
      isImportant?: boolean;
      isOfficial?: boolean;
    }

    const list: MergedItem[] = [];

    // AI 전사 항목
    (meeting.transcripts || []).forEach((t) => {
      list.push({
        id: `ai_${t.id}`,
        sourceType: 'ai',
        startSeconds: t.startSeconds,
        timeLabel: `[${formatDuration(t.startSeconds)} ~ ${formatDuration(t.endSeconds)}]`,
        speakerName: t.speakerName || t.speakerId,
        text: t.text,
        isOfficial: true,
      });
    });

    // 직접 작성 항목
    (meeting.manualEntries || []).forEach((m) => {
      const timeSec = typeof m.timestampSeconds === 'number' ? m.timestampSeconds : 999999;
      list.push({
        id: `man_${m.id}`,
        sourceType: 'manual',
        startSeconds: timeSec,
        timeLabel: typeof m.timestampSeconds === 'number' ? `[${formatDuration(m.timestampSeconds)}]` : '[시간 미지정]',
        speakerName: m.speakerName,
        text: m.text,
        isImportant: m.isImportant,
        isOfficial: m.isOfficial,
      });
    });

    list.sort((a, b) => a.startSeconds - b.startSeconds);
    return list;
  }, [meeting.transcripts, meeting.manualEntries]);

  return (
    <div className="space-y-6">
      {/* 1. 상단 안내 및 실시간 연동 배너 */}
      <div className="bg-white rounded-xl border border-slate-200 p-5 shadow-sm">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div>
            <div className="flex items-center gap-2 mb-1">
              <span className="p-1.5 bg-blue-50 text-blue-700 rounded-lg">
                <Keyboard className="w-5 h-5" />
              </span>
              <h2 className="text-lg font-bold text-slate-900">회의내용 직접 입력 (직접 작성)</h2>
              <span className="text-xs bg-emerald-50 text-emerald-700 border border-emerald-200 px-2 py-0.5 rounded-full font-medium">
                녹음 독립 모드 지원
              </span>
            </div>
            <p className="text-xs text-slate-500">
              회의 중 사람이 직접 키보드로 입력하거나, AI 음성 전사 결과와 함께 사용할 수 있습니다.
              녹음이 없어도 직접 작성한 내용만으로 요약, 전자서명, 인쇄 등 모든 회의록 절차를 완결할 수 있습니다.
            </p>
          </div>

          <div className="flex items-center gap-3 self-start md:self-auto">
            {/* 실시간 녹음 연동 배지 */}
            {isRecording ? (
              <div className="flex items-center gap-2 bg-red-50 border border-red-200 text-red-700 px-3 py-1.5 rounded-lg text-xs font-semibold animate-pulse">
                <span className="w-2 h-2 rounded-full bg-red-600 animate-ping" />
                <span>녹음 진행 중 ({formatDuration(currentRecordDurationSeconds)})</span>
                {onNavigateTab && (
                  <button
                    type="button"
                    onClick={() => onNavigateTab('recording')}
                    className="ml-1 underline hover:text-red-900 text-[11px]"
                  >
                    녹음 화면
                  </button>
                )}
              </div>
            ) : (
              <div className="flex items-center gap-1.5 bg-slate-100 text-slate-600 px-3 py-1.5 rounded-lg text-xs font-medium">
                <Mic className="w-3.5 h-3.5 text-slate-400" />
                <span>녹음 미진행 (녹음 없이 단독 작성 가능)</span>
              </div>
            )}

            {/* 자동 저장 상태 인디케이터 */}
            <div className="flex items-center gap-1.5 text-xs">
              {saveStatus === 'saving' && (
                <span className="flex items-center gap-1 text-blue-600 font-medium">
                  <RotateCcw className="w-3.5 h-3.5 animate-spin" /> 저장 중...
                </span>
              )}
              {saveStatus === 'saved' && (
                <span className="flex items-center gap-1 text-emerald-600 font-medium">
                  <Check className="w-3.5 h-3.5" /> 저장됨 ({lastSavedTime})
                </span>
              )}
              {saveStatus === 'error' && (
                <span className="flex items-center gap-1 text-rose-600 font-medium">
                  <AlertCircle className="w-3.5 h-3.5" /> 저장 오류
                </span>
              )}
            </div>
          </div>
        </div>

        {/* 서브 모드 전환 탭 */}
        <div className="flex flex-wrap items-center justify-between border-t border-slate-100 pt-4 mt-4 gap-2">
          <div className="flex items-center gap-1.5 bg-slate-100 p-1 rounded-lg">
            <button
              type="button"
              onClick={() => setActiveSubMode('speaker_entries')}
              className={`px-3 py-1.5 rounded-md text-xs font-semibold transition-all flex items-center gap-1.5 ${
                activeSubMode === 'speaker_entries'
                  ? 'bg-white text-blue-700 shadow-sm'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              <User className="w-3.5 h-3.5" />
              <span>화자별 발언 입력</span>
              <span className="ml-1 px-1.5 py-0.2 bg-blue-100 text-blue-800 rounded-full text-[10px]">
                {meeting.manualEntries?.length || 0}
              </span>
            </button>

            <button
              type="button"
              onClick={() => setActiveSubMode('freeform_memo')}
              className={`px-3 py-1.5 rounded-md text-xs font-semibold transition-all flex items-center gap-1.5 ${
                activeSubMode === 'freeform_memo'
                  ? 'bg-white text-blue-700 shadow-sm'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              <FileText className="w-3.5 h-3.5" />
              <span>자유 메모</span>
              {memoText.trim() && (
                <span className="w-1.5 h-1.5 rounded-full bg-blue-600" />
              )}
            </button>

            <button
              type="button"
              onClick={() => setActiveSubMode('action_items')}
              className={`px-3 py-1.5 rounded-md text-xs font-semibold transition-all flex items-center gap-1.5 ${
                activeSubMode === 'action_items'
                  ? 'bg-white text-blue-700 shadow-sm'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              <CheckSquare className="w-3.5 h-3.5" />
              <span>Action Item 등록</span>
              <span className="ml-1 px-1.5 py-0.2 bg-slate-200 text-slate-800 rounded-full text-[10px]">
                {meeting.manualActionItems?.length || 0}
              </span>
            </button>

            <button
              type="button"
              onClick={() => setActiveSubMode('merged_timeline')}
              className={`px-3 py-1.5 rounded-md text-xs font-semibold transition-all flex items-center gap-1.5 ${
                activeSubMode === 'merged_timeline'
                  ? 'bg-white text-blue-700 shadow-sm'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              <Layers className="w-3.5 h-3.5" />
              <span>통합 타임라인 보기</span>
            </button>
          </div>

          {/* AI로 회의록 정리(요약 생성) 버튼 */}
          <button
            type="button"
            onClick={handleAiSummarizeManualNotes}
            disabled={isAiSummarizing || isReadOnly}
            className="flex items-center gap-1.5 px-3.5 py-1.5 bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-700 hover:to-indigo-700 text-white rounded-lg text-xs font-semibold shadow-sm transition-all disabled:opacity-50"
          >
            <Sparkles className={`w-3.5 h-3.5 ${isAiSummarizing ? 'animate-spin' : ''}`} />
            <span>{isAiSummarizing ? 'AI 회의록 정리 중...' : 'AI로 회의록 정리'}</span>
          </button>
        </div>

        {aiSummaryError && (
          <div className="mt-3 p-3 bg-red-50 border border-red-200 rounded-lg text-xs text-red-700 flex items-center gap-2">
            <AlertCircle className="w-4 h-4 flex-shrink-0" />
            <span>{aiSummaryError}</span>
          </div>
        )}
      </div>

      {/* 2-A. 화자별 발언 입력 모드 */}
      {activeSubMode === 'speaker_entries' && (
        <div className="space-y-6">
          {/* 발언 입력 폼 카드 */}
          <div className="bg-white rounded-xl border border-slate-200 p-5 shadow-sm">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-sm font-bold text-slate-900 flex items-center gap-1.5">
                <Edit2 className="w-4 h-4 text-blue-600" />
                <span>{editingEntryId ? '발언 내용 수정' : '새 발언 추가'}</span>
              </h3>
              {editingEntryId && (
                <button
                  type="button"
                  onClick={handleCancelEdit}
                  className="text-xs text-slate-500 hover:text-slate-800 flex items-center gap-1"
                >
                  <X className="w-3.5 h-3.5" /> 수정 취소
                </button>
              )}
            </div>

            <form onSubmit={handleSaveSpeechEntry} className="space-y-4">
              {/* 1행: 화자 선택 + 발언 시간 입력 + [⏱ 현재시간] */}
              <div className="grid grid-cols-1 sm:grid-cols-12 gap-3">
                {/* 화자 선택 드롭다운 */}
                <div className="sm:col-span-6">
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    발언자 (화자) 선택
                  </label>
                  <div className="flex gap-2">
                    <select
                      value={selectedSpeakerId}
                      onChange={(e) => setSelectedSpeakerId(e.target.value)}
                      disabled={isReadOnly}
                      className="w-full bg-slate-50 border border-slate-200 rounded-lg px-3 py-2 text-xs text-slate-800 focus:bg-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                    >
                      <option value="unassigned">참석자 미지정</option>
                      {meeting.attendees.map((att) => (
                        <option key={att.id} value={att.id}>
                          {att.name} ({att.role || att.position || '참석자'})
                        </option>
                      ))}
                      <option value="other">직접 입력 (기타)...</option>
                    </select>

                    {selectedSpeakerId === 'other' && (
                      <input
                        type="text"
                        placeholder="화자 성명/직함"
                        value={customSpeakerName}
                        onChange={(e) => setCustomSpeakerName(e.target.value)}
                        className="w-1/2 bg-white border border-slate-200 rounded-lg px-3 py-2 text-xs text-slate-800 focus:outline-none focus:ring-2 focus:ring-blue-500"
                      />
                    )}
                  </div>
                </div>

                {/* 발언 시간 (타임스탬프) */}
                <div className="sm:col-span-6">
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    발언 시간 (선택사항)
                  </label>
                  <div className="flex gap-2">
                    <div className="relative flex-1">
                      <input
                        type="text"
                        placeholder="예: 00:05:20 또는 05:20"
                        value={timestampInput}
                        onChange={(e) => setTimestampInput(e.target.value)}
                        disabled={isReadOnly}
                        className="w-full bg-slate-50 border border-slate-200 rounded-lg pl-8 pr-3 py-2 text-xs text-slate-800 focus:bg-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                      />
                      <Clock className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-2.5" />
                    </div>

                    <button
                      type="button"
                      onClick={handleInsertCurrentTime}
                      disabled={isReadOnly}
                      className="px-3 py-2 bg-blue-50 hover:bg-blue-100 text-blue-700 rounded-lg text-xs font-semibold flex items-center gap-1 transition-colors whitespace-nowrap"
                      title="녹음 중이면 녹음 경과시간 자동 입력"
                    >
                      <Clock className="w-3.5 h-3.5" />
                      <span>⏱ 현재시간</span>
                    </button>
                  </div>
                </div>
              </div>

              {/* 빠른 템플릿 문구 삽입 및 서식 툴바 */}
              <div className="flex flex-wrap items-center justify-between bg-slate-50 border border-slate-200/80 px-3 py-1.5 rounded-lg gap-2 text-xs">
                {/* 템플릿 태그 버튼들 */}
                <div className="flex flex-wrap items-center gap-1.5">
                  <span className="text-slate-400 text-[11px] mr-1">템플릿:</span>
                  {[
                    '[결정사항]',
                    '[조치사항]',
                    '[담당자]',
                    '[기한]',
                    '[추후 검토]',
                    '[합의]',
                    '[이견/반대]',
                  ].map((tag) => (
                    <button
                      key={tag}
                      type="button"
                      onClick={() => handleInsertTemplate(tag)}
                      disabled={isReadOnly}
                      className="px-2 py-0.5 bg-white hover:bg-slate-100 border border-slate-200 text-slate-700 rounded text-[11px] font-medium transition-colors"
                    >
                      {tag}
                    </button>
                  ))}
                </div>

                {/* 서식 도구 */}
                <div className="flex items-center gap-1 text-slate-600">
                  <button
                    type="button"
                    onClick={() => handleInsertFormatting('bold')}
                    title="굵게 (**텍스트**)"
                    className="p-1 hover:bg-slate-200 rounded"
                  >
                    <Bold className="w-3.5 h-3.5" />
                  </button>
                  <button
                    type="button"
                    onClick={() => handleInsertFormatting('bullet')}
                    title="글머리표 (- )"
                    className="p-1 hover:bg-slate-200 rounded"
                  >
                    <List className="w-3.5 h-3.5" />
                  </button>
                  <button
                    type="button"
                    onClick={() => handleInsertFormatting('number')}
                    title="번호목록 (1. )"
                    className="p-1 hover:bg-slate-200 rounded"
                  >
                    <ListOrdered className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>

              {/* 발언 본문 텍스트에어리어 */}
              <div>
                <textarea
                  ref={speechInputRef}
                  rows={4}
                  placeholder="발언 내용을 입력하세요. (Ctrl + Enter로 빠르게 추가 가능)"
                  value={speechText}
                  onChange={(e) => setSpeechText(e.target.value)}
                  onKeyDown={(e) => {
                    if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
                      e.preventDefault();
                      handleSaveSpeechEntry();
                    }
                  }}
                  disabled={isReadOnly}
                  className="w-full bg-slate-50 border border-slate-200 rounded-lg p-3 text-xs text-slate-800 focus:bg-white focus:outline-none focus:ring-2 focus:ring-blue-500 leading-relaxed"
                />
              </div>

              {/* 옵션 체크박스 및 저장 버튼 */}
              <div className="flex flex-wrap items-center justify-between gap-3 pt-1">
                <div className="flex items-center gap-4 text-xs">
                  <label className="flex items-center gap-1.5 cursor-pointer text-slate-700 select-none">
                    <input
                      type="checkbox"
                      checked={isOfficialSpeech}
                      onChange={(e) => setIsOfficialSpeech(e.target.checked)}
                      disabled={isReadOnly}
                      className="rounded text-blue-600 focus:ring-blue-500"
                    />
                    <span className="font-semibold">공식 회의록 포함</span>
                    <span className="text-slate-400 text-[11px]">(해제 시 개인 메모로 인쇄 제외)</span>
                  </label>

                  <label className="flex items-center gap-1.5 cursor-pointer text-slate-700 select-none">
                    <input
                      type="checkbox"
                      checked={isImportantSpeech}
                      onChange={(e) => setIsImportantSpeech(e.target.checked)}
                      disabled={isReadOnly}
                      className="rounded text-amber-500 focus:ring-amber-400"
                    />
                    <span className="font-semibold text-amber-700 flex items-center gap-1">
                      <Star className="w-3.5 h-3.5 fill-amber-400 text-amber-500" />
                      <span>중요 발언</span>
                    </span>
                  </label>
                </div>

                <div className="flex items-center gap-2">
                  <button
                    type="submit"
                    disabled={isReadOnly || !speechText.trim()}
                    className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-xs font-semibold flex items-center gap-1.5 shadow-sm transition-all disabled:opacity-50"
                  >
                    {editingEntryId ? (
                      <>
                        <Check className="w-3.5 h-3.5" />
                        <span>수정 완료</span>
                      </>
                    ) : (
                      <>
                        <Plus className="w-3.5 h-3.5" />
                        <span>발언 추가 (Ctrl+Enter)</span>
                      </>
                    )}
                  </button>
                </div>
              </div>
            </form>
          </div>

          {/* 발언 목록 카드 */}
          <div className="bg-white rounded-xl border border-slate-200 p-5 shadow-sm">
            {/* 필터 및 검색 바 */}
            <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3 mb-4 pb-4 border-b border-slate-100">
              <div className="flex items-center gap-2">
                <h3 className="text-sm font-bold text-slate-900">
                  직접 작성 발언 목록 ({filteredEntries.length}건)
                </h3>
                <button
                  type="button"
                  onClick={handleSortByTimestamp}
                  disabled={isReadOnly || (meeting.manualEntries || []).length === 0}
                  className="px-2 py-1 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded text-xs font-medium flex items-center gap-1"
                  title="타임스탬프 오름차순으로 일괄 정렬"
                >
                  <Clock className="w-3 h-3" />
                  <span>시간순 정렬</span>
                </button>
              </div>

              {/* 검색 및 필터 */}
              <div className="flex flex-wrap items-center gap-2">
                <div className="relative">
                  <input
                    type="text"
                    placeholder="발언 또는 화자 검색..."
                    value={searchTerm}
                    onChange={(e) => setSearchTerm(e.target.value)}
                    className="bg-slate-50 border border-slate-200 rounded-lg pl-7 pr-2.5 py-1 text-xs text-slate-700 focus:bg-white focus:outline-none focus:ring-1 focus:ring-blue-500 w-40 sm:w-48"
                  />
                  <Search className="w-3.5 h-3.5 text-slate-400 absolute left-2 top-2" />
                </div>

                <button
                  type="button"
                  onClick={() => setFilterOnlyImportant((prev) => !prev)}
                  className={`px-2 py-1 rounded text-xs font-semibold flex items-center gap-1 border transition-colors ${
                    filterOnlyImportant
                      ? 'bg-amber-50 border-amber-200 text-amber-800'
                      : 'bg-white border-slate-200 text-slate-600 hover:bg-slate-50'
                  }`}
                >
                  <Star className={`w-3 h-3 ${filterOnlyImportant ? 'fill-amber-400' : ''}`} />
                  <span>중요만</span>
                </button>

                <button
                  type="button"
                  onClick={() => setFilterOfficialOnly((prev) => !prev)}
                  className={`px-2 py-1 rounded text-xs font-semibold flex items-center gap-1 border transition-colors ${
                    filterOfficialOnly
                      ? 'bg-blue-50 border-blue-200 text-blue-800'
                      : 'bg-white border-slate-200 text-slate-600 hover:bg-slate-50'
                  }`}
                >
                  <span>공식만</span>
                </button>
              </div>
            </div>

            {/* 발언 리스트 */}
            {filteredEntries.length === 0 ? (
              <div className="text-center py-12 text-slate-400 text-xs">
                <Keyboard className="w-8 h-8 mx-auto mb-2 text-slate-300" />
                <p>기록된 직접 작성 발언이 없습니다.</p>
                <p className="text-[11px] text-slate-400 mt-0.5">
                  상단 입력창에서 회의 중 논의된 발언을 직접 키보드로 입력해보세요.
                </p>
              </div>
            ) : (
              <div className="space-y-3">
                {filteredEntries.map((entry, index) => (
                  <div
                    key={entry.id}
                    className={`border rounded-lg p-4 transition-all ${
                      editingEntryId === entry.id
                        ? 'border-blue-400 bg-blue-50/40 ring-2 ring-blue-100'
                        : entry.isImportant
                        ? 'border-amber-200 bg-amber-50/20 hover:border-amber-300'
                        : !entry.isOfficial
                        ? 'border-dashed border-slate-300 bg-slate-50/40'
                        : 'border-slate-200 bg-white hover:border-slate-300'
                    }`}
                  >
                    {/* 카드 헤더 */}
                    <div className="flex flex-wrap items-center justify-between gap-2 mb-2">
                      <div className="flex items-center gap-2">
                        {/* 순번 */}
                        <span className="text-xs font-mono font-bold text-slate-400">
                          #{index + 1}
                        </span>

                        {/* 타임스탬프 */}
                        {typeof entry.timestampSeconds === 'number' && (
                          <span className="px-2 py-0.5 bg-slate-100 text-slate-700 rounded text-[11px] font-mono flex items-center gap-1">
                            <Clock className="w-3 h-3 text-slate-400" />
                            <span>{formatDuration(entry.timestampSeconds)}</span>
                          </span>
                        )}

                        {/* 화자 배지 */}
                        <span className="px-2.5 py-0.5 bg-blue-50 border border-blue-100 text-blue-800 rounded-full text-xs font-semibold">
                          {entry.speakerName}
                        </span>

                        {/* 중요 배지 */}
                        {entry.isImportant && (
                          <span className="px-2 py-0.5 bg-amber-100 text-amber-800 rounded-full text-[10px] font-bold flex items-center gap-0.5">
                            <Star className="w-3 h-3 fill-amber-500 text-amber-600" />
                            <span>중요</span>
                          </span>
                        )}

                        {/* 공식/개인 구분 배지 */}
                        {!entry.isOfficial && (
                          <span className="px-2 py-0.5 bg-slate-200 text-slate-600 rounded text-[10px] font-medium">
                            개인 메모 (인쇄 제외)
                          </span>
                        )}
                      </div>

                      {/* 액션 버튼 그룹 */}
                      {!isReadOnly && (
                        <div className="flex items-center gap-1">
                          {/* 순서 변경 버튼 */}
                          <button
                            type="button"
                            onClick={() => handleMoveUp(index)}
                            disabled={index === 0}
                            title="위로 이동"
                            className="p-1 text-slate-400 hover:text-slate-700 disabled:opacity-30 rounded"
                          >
                            <ArrowUp className="w-3.5 h-3.5" />
                          </button>
                          <button
                            type="button"
                            onClick={() => handleMoveDown(index)}
                            disabled={index === filteredEntries.length - 1}
                            title="아래로 이동"
                            className="p-1 text-slate-400 hover:text-slate-700 disabled:opacity-30 rounded"
                          >
                            <ArrowDown className="w-3.5 h-3.5" />
                          </button>

                          {/* 중요 토글 */}
                          <button
                            type="button"
                            onClick={() => handleToggleImportant(entry.id)}
                            title="중요 표시 토글"
                            className="p-1 text-slate-400 hover:text-amber-500 rounded"
                          >
                            <Star className={`w-3.5 h-3.5 ${entry.isImportant ? 'fill-amber-400 text-amber-500' : ''}`} />
                          </button>

                          {/* 공식/개인 토글 */}
                          <button
                            type="button"
                            onClick={() => handleToggleOfficial(entry.id)}
                            title={entry.isOfficial ? '개인 메모로 전환' : '공식 회의록으로 전환'}
                            className="px-1.5 py-0.5 text-[10px] bg-slate-100 hover:bg-slate-200 text-slate-700 rounded font-medium"
                          >
                            {entry.isOfficial ? '공식' : '개인'}
                          </button>

                          {/* 수정 버튼 */}
                          <button
                            type="button"
                            onClick={() => handleStartEditEntry(entry)}
                            title="발언 수정"
                            className="p-1 text-slate-500 hover:text-blue-600 rounded"
                          >
                            <Edit2 className="w-3.5 h-3.5" />
                          </button>

                          {/* 삭제 버튼 */}
                          <button
                            type="button"
                            onClick={() => handleDeleteEntry(entry.id)}
                            title="발언 삭제"
                            className="p-1 text-slate-400 hover:text-red-600 rounded"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      )}
                    </div>

                    {/* 발언 본문 */}
                    <div className="text-xs text-slate-800 leading-relaxed whitespace-pre-wrap pl-6">
                      {entry.text}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* 2-B. 자유 메모 모드 */}
      {activeSubMode === 'freeform_memo' && (
        <div className="bg-white rounded-xl border border-slate-200 p-5 shadow-sm space-y-4">
          <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-2 pb-3 border-b border-slate-100">
            <div>
              <h3 className="text-sm font-bold text-slate-900 flex items-center gap-1.5">
                <FileText className="w-4 h-4 text-blue-600" />
                <span>자유 형식 회의 메모</span>
              </h3>
              <p className="text-xs text-slate-500">
                격식 없이 자유롭게 회의 내용을 기록하세요. 입력한 내용은 1.2초 후 자동으로 저장됩니다.
              </p>
            </div>

            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={handleApplyMemoTemplate}
                disabled={isReadOnly}
                className="px-2.5 py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-lg text-xs font-medium transition-colors"
              >
                + 회의록 양식 템플릿 삽입
              </button>
            </div>
          </div>

          <div>
            <textarea
              rows={16}
              value={memoText}
              onChange={handleMemoChange}
              disabled={isReadOnly}
              placeholder="회의 안건, 주요 논의사항, 결정된 사항, 담당자별 실행 과제를 자유롭게 적어보세요...&#10;&#10;상단의 [AI로 회의록 정리] 버튼을 누르면 이 메모를 기반으로 공인 회의록 요약과 실행 과제가 자동 생성됩니다."
              className="w-full bg-slate-50 border border-slate-200 rounded-lg p-4 text-xs font-mono text-slate-800 focus:bg-white focus:outline-none focus:ring-2 focus:ring-blue-500 leading-relaxed"
            />
          </div>

          <div className="flex items-center justify-between text-xs text-slate-500">
            <span>글자 수: {memoText.length.toLocaleString()}자</span>
            <div className="flex items-center gap-2">
              <span className="text-slate-400">Ctrl + S 또는 자동 저장</span>
              <button
                type="button"
                onClick={onSave}
                disabled={isReadOnly}
                className="px-3 py-1 bg-slate-200 hover:bg-slate-300 text-slate-800 rounded font-semibold transition-colors"
              >
                즉시 저장
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 2-C. 직접 Action Item 관리 모드 */}
      {activeSubMode === 'action_items' && (
        <div className="space-y-6">
          {/* Action Item 추가 폼 */}
          <div className="bg-white rounded-xl border border-slate-200 p-5 shadow-sm">
            <h3 className="text-sm font-bold text-slate-900 mb-3 flex items-center gap-1.5">
              <CheckSquare className="w-4 h-4 text-blue-600" />
              <span>직접 Action Item (후속 조치 과제) 등록</span>
            </h3>

            <form onSubmit={handleAddActionItem} className="grid grid-cols-1 sm:grid-cols-12 gap-3 items-end">
              <div className="sm:col-span-5">
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  할 일 (과제 내용) <span className="text-red-500">*</span>
                </label>
                <input
                  type="text"
                  placeholder="예: 프레스 구역 방호울 센서 개선안 제출"
                  value={actionTask}
                  onChange={(e) => setActionTask(e.target.value)}
                  disabled={isReadOnly}
                  className="w-full bg-slate-50 border border-slate-200 rounded-lg px-3 py-2 text-xs text-slate-800 focus:bg-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>

              <div className="sm:col-span-3">
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  담당자
                </label>
                <input
                  type="text"
                  placeholder="예: 안전관리팀 홍길동"
                  value={actionAssignee}
                  onChange={(e) => setActionAssignee(e.target.value)}
                  disabled={isReadOnly}
                  className="w-full bg-slate-50 border border-slate-200 rounded-lg px-3 py-2 text-xs text-slate-800 focus:bg-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>

              <div className="sm:col-span-2">
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  완료 기한
                </label>
                <input
                  type="date"
                  value={actionDueDate}
                  onChange={(e) => setActionDueDate(e.target.value)}
                  disabled={isReadOnly}
                  className="w-full bg-slate-50 border border-slate-200 rounded-lg px-2.5 py-2 text-xs text-slate-800 focus:bg-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>

              <div className="sm:col-span-2 flex items-center justify-end gap-2">
                <button
                  type="submit"
                  disabled={isReadOnly || !actionTask.trim()}
                  className="w-full py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-xs font-semibold flex items-center justify-center gap-1 shadow-sm transition-all disabled:opacity-50"
                >
                  <Plus className="w-3.5 h-3.5" />
                  <span>과제 추가</span>
                </button>
              </div>
            </form>
          </div>

          {/* Action Item 목록 */}
          <div className="bg-white rounded-xl border border-slate-200 p-5 shadow-sm">
            <h3 className="text-sm font-bold text-slate-900 mb-3">
              등록된 Action Items ({(meeting.manualActionItems || []).length}건)
            </h3>

            {(meeting.manualActionItems || []).length === 0 ? (
              <div className="text-center py-10 text-slate-400 text-xs">
                <CheckSquare className="w-8 h-8 mx-auto mb-2 text-slate-300" />
                <p>직접 등록된 Action Item이 없습니다.</p>
              </div>
            ) : (
              <div className="divide-y divide-slate-100">
                {(meeting.manualActionItems || []).map((item) => (
                  <div key={item.id} className="py-3 flex items-center justify-between gap-3">
                    <div className="flex items-center gap-3 flex-1 min-w-0">
                      <button
                        type="button"
                        onClick={() => handleToggleActionStatus(item.id)}
                        disabled={isReadOnly}
                        className="text-slate-400 hover:text-blue-600 transition-colors"
                      >
                        {item.status === 'completed' ? (
                          <CheckSquare className="w-4 h-4 text-emerald-600" />
                        ) : (
                          <Square className="w-4 h-4 text-slate-400" />
                        )}
                      </button>

                      <div className="min-w-0 flex-1">
                        <p
                          className={`text-xs font-medium text-slate-800 truncate ${
                            item.status === 'completed' ? 'line-through text-slate-400' : ''
                          }`}
                        >
                          {item.task}
                        </p>
                        <div className="flex items-center gap-3 text-[11px] text-slate-400 mt-0.5">
                          <span>담당: <strong className="text-slate-600">{item.assignee}</strong></span>
                          <span>기한: <strong className="text-slate-600">{item.dueDate}</strong></span>
                          <span
                            className={`px-1.5 py-0.2 rounded text-[10px] font-semibold ${
                              item.status === 'completed'
                                ? 'bg-emerald-50 text-emerald-700'
                                : 'bg-slate-100 text-slate-600'
                            }`}
                          >
                            {item.status === 'completed' ? '완료' : '진행 대기'}
                          </span>
                        </div>
                      </div>
                    </div>

                    {!isReadOnly && (
                      <button
                        type="button"
                        onClick={() => handleDeleteActionItem(item.id)}
                        className="p-1 text-slate-400 hover:text-red-600 rounded transition-colors"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* 2-D. 통합 타임라인 보기 모드 */}
      {activeSubMode === 'merged_timeline' && (
        <div className="bg-white rounded-xl border border-slate-200 p-5 shadow-sm space-y-4">
          <div>
            <h3 className="text-sm font-bold text-slate-900 flex items-center gap-1.5">
              <Layers className="w-4 h-4 text-blue-600" />
              <span>통합 회의 타임라인 (AI 전사 + 직접 작성 발언 병합)</span>
            </h3>
            <p className="text-xs text-slate-500">
              녹음 AI 전사 결과와 사람이 직접 키보드로 입력한 발언을 시간순으로 정렬하여 종합적으로 확인할 수 있습니다.
            </p>
          </div>

          {mergedTimelineList.length === 0 ? (
            <div className="text-center py-12 text-slate-400 text-xs">
              <Layers className="w-8 h-8 mx-auto mb-2 text-slate-300" />
              <p>타임라인에 표시할 대화록이나 발언이 없습니다.</p>
            </div>
          ) : (
            <div className="space-y-3">
              {mergedTimelineList.map((item) => (
                <div
                  key={item.id}
                  className={`border rounded-lg p-3 text-xs leading-relaxed ${
                    item.sourceType === 'manual'
                      ? 'border-indigo-200 bg-indigo-50/20'
                      : 'border-slate-200 bg-white'
                  }`}
                >
                  <div className="flex items-center justify-between mb-1.5">
                    <div className="flex items-center gap-2">
                      <span className="font-mono text-[11px] text-slate-500 font-semibold">
                        {item.timeLabel}
                      </span>
                      <span className="font-bold text-slate-900">
                        {item.speakerName}
                      </span>
                      <span
                        className={`px-1.5 py-0.2 rounded text-[10px] font-bold ${
                          item.sourceType === 'manual'
                            ? 'bg-indigo-100 text-indigo-800'
                            : 'bg-blue-100 text-blue-800'
                        }`}
                      >
                        {item.sourceType === 'manual' ? '직접 작성' : 'AI 전사'}
                      </span>
                      {item.isImportant && (
                        <span className="text-amber-500 flex items-center text-[11px] font-bold">
                          <Star className="w-3 h-3 fill-amber-400" /> 중요
                        </span>
                      )}
                    </div>
                  </div>
                  <p className="text-slate-800 whitespace-pre-wrap">{item.text}</p>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* AI 회의록 정리 완료 모달 */}
      {showAiSuccessModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-xl max-w-md w-full p-6 shadow-xl text-center space-y-4">
            <div className="w-12 h-12 bg-emerald-100 text-emerald-600 rounded-full flex items-center justify-center mx-auto">
              <Check className="w-6 h-6" />
            </div>
            <div>
              <h3 className="text-base font-bold text-slate-900">
                AI 회의록 정리 완료
              </h3>
              <p className="text-xs text-slate-600 mt-1.5 leading-relaxed">
                직접 작성한 회의 내용과 메모를 기반으로 종합 회의록 요약 및 후속 조치 과제(Action Items)가 성공적으로 생성되었습니다.
              </p>
            </div>

            <div className="flex items-center justify-center gap-3 pt-2">
              <button
                type="button"
                onClick={() => setShowAiSuccessModal(false)}
                className="px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-lg text-xs font-medium"
              >
                닫기
              </button>
              {onNavigateTab && (
                <button
                  type="button"
                  onClick={() => {
                    setShowAiSuccessModal(false);
                    onNavigateTab('summary');
                  }}
                  className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-xs font-semibold flex items-center gap-1"
                >
                  <span>요약 탭으로 이동</span>
                  <ChevronRight className="w-3.5 h-3.5" />
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
