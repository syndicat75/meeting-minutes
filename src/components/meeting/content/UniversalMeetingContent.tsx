/**
 * @file src/components/meeting/content/UniversalMeetingContent.tsx
 * @description 자유도 높은 범용 회의록 본문 작성 및 다중 뷰(표형, 카드형, 안건그룹형, 시간순) 통합 컴포넌트.
 * - 기본 필드: 구분(Category), 화자(Speaker), 내용(Content)
 * - 동적 컬럼 구성 및 사용자 정의 컬럼 지원
 * - 동일 구분 셀 병합(mergeCategoryCells) 기능
 * - 표형 / 카드형 / 안건 그룹형 / 대화 타임라인형 다중 뷰 지원
 * - 회의록 항목에서 후속 조치사항(Action Item)으로 원클릭 등록 지원
 * - AI 자동 구조화 및 근거 발언 추적 기능 연동
 */

import React, { useState } from 'react';
import {
  Plus,
  Table as TableIcon,
  LayoutGrid,
  ListOrdered,
  Clock,
  Settings,
  Tag,
  Columns3,
  LayoutTemplate,
  Sparkles,
  ArrowUp,
  ArrowDown,
  Edit2,
  Trash2,
  CheckCircle2,
  ArrowRightCircle,
  HelpCircle,
  FileCheck,
  Check,
  User,
  ListTodo,
} from 'lucide-react';
import {
  MeetingRow,
  ColumnDefinition,
  MeetingAgenda,
  ContentViewMode,
  MeetingTemplate,
} from '../../../types/meetingUniversal';
import { Meeting, ManualActionItem } from '../../../types/meeting';
import { CategoryManagementModal } from './CategoryManagementModal';
import { ColumnConfigModal } from './ColumnConfigModal';
import { MeetingRowEditModal } from './MeetingRowEditModal';
import { TemplateModal } from './TemplateModal';
import { AiStructureReviewModal } from './AiStructureReviewModal';
import { requestAiMeetingStructure } from '../../../services/meetingStructureClientService';

interface UniversalMeetingContentProps {
  meeting: Meeting;
  onUpdateMeeting: (updatedFields: Partial<Meeting>) => void;
}

export const UniversalMeetingContent: React.FC<UniversalMeetingContentProps> = ({
  meeting,
  onUpdateMeeting,
}) => {
  // 모달 상태 관리
  const [isCategoryModalOpen, setIsCategoryModalOpen] = useState(false);
  const [isColumnModalOpen, setIsColumnModalOpen] = useState(false);
  const [isRowModalOpen, setIsRowModalOpen] = useState(false);
  const [isTemplateModalOpen, setIsTemplateModalOpen] = useState(false);
  const [isAiReviewModalOpen, setIsAiReviewModalOpen] = useState(false);

  const [editingRow, setEditingRow] = useState<MeetingRow | null>(null);
  const [aiProposedRows, setAiProposedRows] = useState<MeetingRow[]>([]);
  const [isAiLoading, setIsAiLoading] = useState(false);

  // 안건 추가 인라인 폼
  const [isAddingAgenda, setIsAddingAgenda] = useState(false);
  const [newAgendaTitle, setNewAgendaTitle] = useState('');

  // 현재 뷰 모드 및 설정
  const viewMode: ContentViewMode = meeting.meetingViewConfig?.contentViewMode || 'table';
  const mergeCategoryCells: boolean = meeting.meetingViewConfig?.mergeCategoryCells ?? true;

  const rows: MeetingRow[] = meeting.meetingRows || [];
  const columns: ColumnDefinition[] = meeting.meetingColumns || [];
  const categories: string[] = meeting.meetingCategories || [];
  const agendas: MeetingAgenda[] = meeting.meetingAgendas || [];

  // 뷰 모드 변경
  const handleSetViewMode = (mode: ContentViewMode) => {
    onUpdateMeeting({
      meetingViewConfig: {
        ...(meeting.meetingViewConfig || {
          contentViewMode: 'table',
          printViewMode: 'standard_table',
          mergeCategoryCells: true,
          visibleColumnKeys: [],
        }),
        contentViewMode: mode,
      },
    });
  };

  // 동일 구분 셀 병합 토글
  const handleToggleMergeCells = () => {
    onUpdateMeeting({
      meetingViewConfig: {
        ...(meeting.meetingViewConfig || {
          contentViewMode: 'table',
          printViewMode: 'standard_table',
          mergeCategoryCells: true,
          visibleColumnKeys: [],
        }),
        mergeCategoryCells: !mergeCategoryCells,
      },
    });
  };

  // 행 추가 모달 열기
  const handleOpenAddRow = () => {
    setEditingRow(null);
    setIsRowModalOpen(true);
  };

  // 행 수정 모달 열기
  const handleOpenEditRow = (row: MeetingRow) => {
    setEditingRow(row);
    setIsRowModalOpen(true);
  };

  // 행 저장 (추가 또는 수정)
  const handleSaveRow = (savedRow: MeetingRow, newCategoryAdded?: string) => {
    let updatedCategories = categories;
    if (newCategoryAdded && !categories.includes(newCategoryAdded)) {
      updatedCategories = [...categories, newCategoryAdded];
    }

    let updatedRows: MeetingRow[];
    const exists = rows.some((r) => r.id === savedRow.id);
    if (exists) {
      updatedRows = rows.map((r) => (r.id === savedRow.id ? savedRow : r));
    } else {
      updatedRows = [...rows, { ...savedRow, order: rows.length }];
    }

    // 레거시 contentRows 동기화
    const legacyContentRows = updatedRows.map((r, i) => ({
      id: r.id,
      category: r.category,
      content: r.speakerName ? `[${r.speakerName}] ${r.content}` : r.content,
      order: i,
    }));

    onUpdateMeeting({
      meetingRows: updatedRows,
      contentRows: legacyContentRows,
      meetingCategories: updatedCategories,
    });
  };

  // 행 삭제
  const handleDeleteRow = (id: string) => {
    if (confirm('해당 회의록 항목을 삭제하시겠습니까?')) {
      const updatedRows = rows.filter((r) => r.id !== id).map((r, i) => ({ ...r, order: i }));
      const legacyContentRows = updatedRows.map((r, i) => ({
        id: r.id,
        category: r.category,
        content: r.speakerName ? `[${r.speakerName}] ${r.content}` : r.content,
        order: i,
      }));
      onUpdateMeeting({
        meetingRows: updatedRows,
        contentRows: legacyContentRows,
      });
    }
  };

  // 행 순서 변경
  const handleMoveRow = (index: number, direction: 'up' | 'down') => {
    if (direction === 'up' && index === 0) return;
    if (direction === 'down' && index === rows.length - 1) return;
    const targetIdx = direction === 'up' ? index - 1 : index + 1;
    const updated = [...rows];
    const temp = updated[index];
    updated[index] = updated[targetIdx];
    updated[targetIdx] = temp;
    const reordered = updated.map((r, i) => ({ ...r, order: i }));

    const legacyContentRows = reordered.map((r, i) => ({
      id: r.id,
      category: r.category,
      content: r.speakerName ? `[${r.speakerName}] ${r.content}` : r.content,
      order: i,
    }));

    onUpdateMeeting({
      meetingRows: reordered,
      contentRows: legacyContentRows,
    });
  };

  // 회의록 항목을 조치사항(Action Item)으로 등록
  const handleRegisterAsActionItem = (row: MeetingRow) => {
    const task = row.actionItemTask || row.content;
    const newActionItem: ManualActionItem = {
      id: `ai_${Date.now()}`,
      task,
      assignee: row.assignee || row.speakerName || '미지정',
      dueDate: row.dueDate || '미지정',
      status: 'pending',
      source: 'manual',
      createdAt: new Date().toISOString(),
    };

    const currentItems = meeting.manualActionItems || [];
    onUpdateMeeting({
      manualActionItems: [...currentItems, newActionItem],
    });
    alert(`[조치과제] "${task.slice(0, 30)}..."이(가) 회의 조치사항 목록에 등록되었습니다.`);
  };

  // 안건 추가
  const handleAddAgenda = () => {
    const trimmed = newAgendaTitle.trim();
    if (!trimmed) return;
    const newAg: MeetingAgenda = {
      id: `agenda_${Date.now()}`,
      title: trimmed,
      order: agendas.length,
    };
    onUpdateMeeting({
      meetingAgendas: [...agendas, newAg],
    });
    setNewAgendaTitle('');
    setIsAddingAgenda(false);
  };

  // 안건 삭제
  const handleDeleteAgenda = (agId: string) => {
    if (confirm('해당 안건을 삭제하시겠습니까? (연결된 회의록 항목은 삭제되지 않습니다)')) {
      onUpdateMeeting({
        meetingAgendas: agendas.filter((a) => a.id !== agId),
      });
    }
  };

  // AI 회의록 구조화 요청
  const handleTriggerAiStructure = async () => {
    const hasTranscript = meeting.transcripts && meeting.transcripts.length > 0;
    const hasManual = meeting.manualEntries && meeting.manualEntries.length > 0;

    if (!hasTranscript && !hasManual && rows.length === 0) {
      alert('AI가 분석할 녹음 전사본 또는 직접 작성 메모가 없습니다.\n[음성 녹음 및 전사] 탭이나 [직접 작성] 탭에서 내용을 먼저 입력해 주세요.');
      return;
    }

    setIsAiLoading(true);
    setIsAiReviewModalOpen(true);
    try {
      const result = await requestAiMeetingStructure(meeting);
      setAiProposedRows(result);
    } catch (err) {
      alert('AI 회의록 자동 구조화 중 오류가 발생했습니다.');
    } finally {
      setIsAiLoading(false);
    }
  };

  // AI 구조화 결과 반영
  const handleApplyAiRows = (newRows: MeetingRow[], mode: 'append' | 'replace') => {
    let finalRows: MeetingRow[];
    if (mode === 'replace') {
      finalRows = newRows.map((r, i) => ({ ...r, order: i }));
    } else {
      const startOrder = rows.length;
      finalRows = [...rows, ...newRows.map((r, i) => ({ ...r, order: startOrder + i }))];
    }

    const legacyContentRows = finalRows.map((r, i) => ({
      id: r.id,
      category: r.category,
      content: r.speakerName ? `[${r.speakerName}] ${r.content}` : r.content,
      order: i,
    }));

    onUpdateMeeting({
      meetingRows: finalRows,
      contentRows: legacyContentRows,
    });
  };

  // 템플릿 적용
  const handleApplyTemplate = (tpl: MeetingTemplate) => {
    onUpdateMeeting({
      meetingTemplateId: tpl.id,
      meetingCategories: [...tpl.categories],
      meetingColumns: [...tpl.defaultColumns],
      meetingViewConfig: {
        ...(meeting.meetingViewConfig || {
          contentViewMode: 'table',
          printViewMode: 'standard_table',
          mergeCategoryCells: true,
          visibleColumnKeys: [],
        }),
        printViewMode: tpl.defaultPrintViewMode || 'standard_table',
        mergeCategoryCells: tpl.mergeCategoryCells ?? true,
      },
    });
  };

  // 표형 뷰에서 동일 구분 병합(rowSpan) 계산
  const visibleCols = columns.filter((c) => c.visible);

  // 셀 병합용 rowSpan 맵 계산: { [rowIndex]: spanCount }
  const categoryRowSpans: Record<number, number> = {};
  if (mergeCategoryCells) {
    let i = 0;
    while (i < rows.length) {
      const currentCat = rows[i].category;
      let count = 1;
      while (i + count < rows.length && rows[i + count].category === currentCat) {
        count++;
      }
      categoryRowSpans[i] = count;
      i += count;
    }
  }

  return (
    <div className="space-y-4">
      {/* 1. 최상단 도구 모음 (툴바) */}
      <div className="bg-white rounded-xl border border-slate-200 p-3 shadow-xs flex flex-wrap items-center justify-between gap-3">
        {/* 좌측: 뷰 모드 전환 탭 */}
        <div className="flex items-center bg-slate-100 p-1 rounded-lg">
          <button
            type="button"
            onClick={() => handleSetViewMode('table')}
            className={`px-3 py-1.5 rounded-md text-xs font-semibold flex items-center gap-1.5 transition-colors ${
              viewMode === 'table'
                ? 'bg-white text-blue-600 shadow-xs'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            <TableIcon className="w-3.5 h-3.5" />
            표형
          </button>
          <button
            type="button"
            onClick={() => handleSetViewMode('card')}
            className={`px-3 py-1.5 rounded-md text-xs font-semibold flex items-center gap-1.5 transition-colors ${
              viewMode === 'card'
                ? 'bg-white text-blue-600 shadow-xs'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            <LayoutGrid className="w-3.5 h-3.5" />
            카드형
          </button>
          <button
            type="button"
            onClick={() => handleSetViewMode('agenda_group')}
            className={`px-3 py-1.5 rounded-md text-xs font-semibold flex items-center gap-1.5 transition-colors ${
              viewMode === 'agenda_group'
                ? 'bg-white text-blue-600 shadow-xs'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            <ListOrdered className="w-3.5 h-3.5" />
            안건 그룹형
          </button>
          <button
            type="button"
            onClick={() => handleSetViewMode('timeline')}
            className={`px-3 py-1.5 rounded-md text-xs font-semibold flex items-center gap-1.5 transition-colors ${
              viewMode === 'timeline'
                ? 'bg-white text-blue-600 shadow-xs'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            <Clock className="w-3.5 h-3.5" />
            대화 타임라인
          </button>
        </div>

        {/* 우측: 핵심 기능 버튼 모음 */}
        <div className="flex flex-wrap items-center gap-2">
          {/* 셀 병합 토글 (표형일 때) */}
          {viewMode === 'table' && (
            <label className="flex items-center gap-1.5 text-xs text-slate-600 cursor-pointer bg-slate-50 px-2.5 py-1.5 rounded-lg border border-slate-200 hover:bg-slate-100">
              <input
                type="checkbox"
                checked={mergeCategoryCells}
                onChange={handleToggleMergeCells}
                className="rounded border-slate-300 text-blue-600 focus:ring-blue-500"
              />
              동일 구분 셀 병합
            </label>
          )}

          {/* 구분 관리 */}
          <button
            type="button"
            onClick={() => setIsCategoryModalOpen(true)}
            className="px-2.5 py-1.5 bg-white border border-slate-300 hover:bg-slate-50 text-slate-700 text-xs font-semibold rounded-lg flex items-center gap-1"
          >
            <Tag className="w-3.5 h-3.5 text-slate-500" />
            구분 관리
          </button>

          {/* 컬럼 설정 */}
          <button
            type="button"
            onClick={() => setIsColumnModalOpen(true)}
            className="px-2.5 py-1.5 bg-white border border-slate-300 hover:bg-slate-50 text-slate-700 text-xs font-semibold rounded-lg flex items-center gap-1"
          >
            <Columns3 className="w-3.5 h-3.5 text-slate-500" />
            컬럼 설정
          </button>

          {/* 템플릿 */}
          <button
            type="button"
            onClick={() => setIsTemplateModalOpen(true)}
            className="px-2.5 py-1.5 bg-white border border-slate-300 hover:bg-slate-50 text-slate-700 text-xs font-semibold rounded-lg flex items-center gap-1"
          >
            <LayoutTemplate className="w-3.5 h-3.5 text-slate-500" />
            템플릿
          </button>

          {/* AI 회의록 구조화 */}
          <button
            type="button"
            onClick={handleTriggerAiStructure}
            className="px-3 py-1.5 bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-700 hover:to-indigo-700 text-white text-xs font-semibold rounded-lg shadow-xs flex items-center gap-1.5 transition-all"
          >
            <Sparkles className="w-3.5 h-3.5" />
            AI 회의록 구조화
          </button>

          {/* + 항목 추가 */}
          <button
            type="button"
            onClick={handleOpenAddRow}
            className="px-3.5 py-1.5 bg-blue-600 hover:bg-blue-700 text-white text-xs font-semibold rounded-lg shadow-xs flex items-center gap-1"
          >
            <Plus className="w-4 h-4" />새 항목 추가
          </button>
        </div>
      </div>

      {/* 2. 상위 안건(Agenda) 바 (선택적 표시) */}
      <div className="bg-slate-50 rounded-xl border border-slate-200 p-3 text-xs flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2 flex-wrap flex-1">
          <span className="font-bold text-slate-700 flex items-center gap-1">
            <ListTodo className="w-3.5 h-3.5 text-blue-600" />
            상위 안건 목록 ({agendas.length}개):
          </span>
          {agendas.length === 0 ? (
            <span className="text-slate-400 italic">등록된 안건이 없습니다.</span>
          ) : (
            agendas.map((ag, i) => (
              <span
                key={ag.id}
                className="bg-white border border-slate-300 text-slate-800 px-2 py-0.5 rounded-md flex items-center gap-1 font-medium"
              >
                <span className="font-bold text-blue-600">{i + 1}.</span> {ag.title}
                <button
                  type="button"
                  onClick={() => handleDeleteAgenda(ag.id)}
                  className="text-slate-400 hover:text-red-500 ml-1"
                  title="안건 삭제"
                >
                  ×
                </button>
              </span>
            ))
          )}
        </div>

        {isAddingAgenda ? (
          <div className="flex items-center gap-1">
            <input
              type="text"
              placeholder="새 안건명 (예: 안건 1. 설비 교체안)"
              value={newAgendaTitle}
              onChange={(e) => setNewAgendaTitle(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') handleAddAgenda();
              }}
              className="p-1.5 border border-blue-400 rounded text-xs bg-white w-48"
              autoFocus
            />
            <button
              type="button"
              onClick={handleAddAgenda}
              className="px-2.5 py-1.5 bg-blue-600 text-white rounded text-xs font-semibold"
            >
              추가
            </button>
            <button
              type="button"
              onClick={() => setIsAddingAgenda(false)}
              className="px-2 py-1.5 text-slate-500 hover:bg-slate-200 rounded text-xs"
            >
              취소
            </button>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => setIsAddingAgenda(true)}
            className="text-blue-600 hover:underline font-semibold flex items-center gap-1 text-xs"
          >
            <Plus className="w-3.5 h-3.5" />
            안건 추가
          </button>
        )}
      </div>

      {/* 3. 본문 뷰 렌더링 */}
      {rows.length === 0 ? (
        <div className="bg-white rounded-xl border border-dashed border-slate-300 p-12 text-center space-y-3">
          <div className="w-12 h-12 bg-blue-50 text-blue-600 rounded-full flex items-center justify-center mx-auto">
            <TableIcon className="w-6 h-6" />
          </div>
          <h4 className="text-base font-bold text-slate-800">회의록 본문 항목이 비어 있습니다</h4>
          <p className="text-xs text-slate-500 max-w-md mx-auto leading-relaxed">
            '새 항목 추가' 버튼으로 구분, 화자, 내용을 직접 입력하거나,
            상단의 '✨ AI 회의록 구조화'를 클릭하여 전사본으로부터 회의록 항목을 자동 생성하세요.
          </p>
          <div className="flex justify-center gap-2 pt-2">
            <button
              type="button"
              onClick={handleOpenAddRow}
              className="px-4 py-2 bg-blue-600 text-white text-xs font-semibold rounded-lg shadow-xs hover:bg-blue-700"
            >
              + 첫 번째 항목 직접 작성
            </button>
            <button
              type="button"
              onClick={handleTriggerAiStructure}
              className="px-4 py-2 bg-slate-100 text-slate-700 text-xs font-semibold rounded-lg hover:bg-slate-200 flex items-center gap-1"
            >
              <Sparkles className="w-3.5 h-3.5 text-blue-600" />
              AI로 자동 생성
            </button>
          </div>
        </div>
      ) : viewMode === 'table' ? (
        /* A. 표형 (Table View) */
        <div className="bg-white rounded-xl border border-slate-200 shadow-xs overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs border-collapse">
              <thead>
                <tr className="bg-slate-100 border-b border-slate-200 text-slate-700 font-bold text-[11px] divide-x divide-slate-200">
                  <th className="py-2.5 px-3 w-12 text-center">번호</th>
                  {visibleCols.map((col) => (
                    <th
                      key={col.id}
                      style={{ width: col.width || 'auto' }}
                      className="py-2.5 px-3"
                    >
                      {col.label}
                    </th>
                  ))}
                  <th className="py-2.5 px-3 w-28 text-center">관리</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200 text-slate-800 font-sans">
                {rows.map((row, idx) => {
                  const shouldRenderCategory = !mergeCategoryCells || categoryRowSpans[idx] !== undefined;
                  const rowSpan = mergeCategoryCells ? categoryRowSpans[idx] : 1;

                  return (
                    <tr key={row.id} className="hover:bg-slate-50/80 transition-colors divide-x divide-slate-100">
                      {/* 순서 번호 */}
                      <td className="py-3 px-2 text-center text-slate-400 font-mono text-[11px] bg-slate-50/50">
                        {idx + 1}
                      </td>

                      {/* 동적 컬럼 렌더링 */}
                      {visibleCols.map((col) => {
                        // 구분(category) 컬럼의 셀 병합 처리
                        if (col.key === 'category') {
                          if (!shouldRenderCategory) return null;
                          return (
                            <td
                              key={col.id}
                              rowSpan={rowSpan}
                              className="py-3 px-3 align-top font-bold text-slate-900 bg-slate-50/40 border-r border-slate-200"
                            >
                              <span className="inline-block px-2.5 py-1 bg-blue-100 text-blue-900 rounded font-bold text-xs">
                                {row.category}
                              </span>
                            </td>
                          );
                        }

                        // 화자(speakerName)
                        if (col.key === 'speakerName') {
                          return (
                            <td key={col.id} className="py-3 px-3 align-top font-semibold text-slate-700 whitespace-nowrap">
                              {row.speakerName ? (
                                <span className="flex items-center gap-1">
                                  <User className="w-3 h-3 text-slate-400" />
                                  {row.speakerName}
                                </span>
                              ) : (
                                <span className="text-slate-300 font-normal italic">-</span>
                              )}
                            </td>
                          );
                        }

                        // 회의 내용(content)
                        if (col.key === 'content') {
                          return (
                            <td key={col.id} className="py-3 px-3 align-top text-slate-800 leading-relaxed whitespace-pre-line">
                              {row.content}
                            </td>
                          );
                        }

                        // 상위 안건
                        if (col.key === 'agendaTitle') {
                          return (
                            <td key={col.id} className="py-3 px-3 align-top text-slate-600">
                              {row.agendaTitle || '-'}
                            </td>
                          );
                        }

                        // 결정사항
                        if (col.key === 'decision') {
                          return (
                            <td key={col.id} className="py-3 px-3 align-top text-emerald-800 font-semibold">
                              {row.decision ? (
                                <div className="flex items-start gap-1">
                                  <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600 shrink-0 mt-0.5" />
                                  <span>{row.decision}</span>
                                </div>
                              ) : (
                                '-'
                              )}
                            </td>
                          );
                        }

                        // 조치과제
                        if (col.key === 'actionItemTask') {
                          return (
                            <td key={col.id} className="py-3 px-3 align-top text-blue-800">
                              {row.actionItemTask || '-'}
                            </td>
                          );
                        }

                        // 담당자
                        if (col.key === 'assignee') {
                          return (
                            <td key={col.id} className="py-3 px-3 align-top text-slate-700 whitespace-nowrap">
                              {row.assignee || '-'}
                            </td>
                          );
                        }

                        // 기한
                        if (col.key === 'dueDate') {
                          return (
                            <td key={col.id} className="py-3 px-3 align-top text-slate-600 whitespace-nowrap font-mono text-[11px]">
                              {row.dueDate || '-'}
                            </td>
                          );
                        }

                        // 사용자 정의 컬럼 필드
                        const customVal = row.customFields?.[col.key];
                        return (
                          <td key={col.id} className="py-3 px-3 align-top text-slate-700">
                            {customVal !== undefined && customVal !== null
                              ? typeof customVal === 'boolean'
                                ? customVal
                                  ? '✓ 예'
                                  : '아니오'
                                : String(customVal)
                              : '-'}
                          </td>
                        );
                      })}

                      {/* 관리 버튼 (순서, 수정, 삭제, 조치등록) */}
                      <td className="py-3 px-2 align-top text-center whitespace-nowrap">
                        <div className="flex items-center justify-center space-x-1">
                          <button
                            type="button"
                            disabled={idx === 0}
                            onClick={() => handleMoveRow(idx, 'up')}
                            className="p-1 text-slate-400 hover:text-slate-700 disabled:opacity-20 rounded hover:bg-slate-200"
                            title="위로 이동"
                          >
                            <ArrowUp className="w-3.5 h-3.5" />
                          </button>
                          <button
                            type="button"
                            disabled={idx === rows.length - 1}
                            onClick={() => handleMoveRow(idx, 'down')}
                            className="p-1 text-slate-400 hover:text-slate-700 disabled:opacity-20 rounded hover:bg-slate-200"
                            title="아래로 이동"
                          >
                            <ArrowDown className="w-3.5 h-3.5" />
                          </button>
                          <button
                            type="button"
                            onClick={() => handleOpenEditRow(row)}
                            className="p-1 text-blue-600 hover:text-blue-800 rounded hover:bg-blue-50"
                            title="수정"
                          >
                            <Edit2 className="w-3.5 h-3.5" />
                          </button>
                          <button
                            type="button"
                            onClick={() => handleRegisterAsActionItem(row)}
                            className="p-1 text-emerald-600 hover:text-emerald-800 rounded hover:bg-emerald-50"
                            title="조치과제로 등록"
                          >
                            <ArrowRightCircle className="w-3.5 h-3.5" />
                          </button>
                          <button
                            type="button"
                            onClick={() => handleDeleteRow(row.id)}
                            className="p-1 text-red-500 hover:text-red-700 rounded hover:bg-red-50"
                            title="삭제"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      ) : viewMode === 'card' ? (
        /* B. 카드형 (Card View) */
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {rows.map((row, idx) => (
            <div
              key={row.id}
              className="bg-white rounded-xl border border-slate-200 p-4 shadow-xs hover:border-blue-300 transition-all space-y-3"
            >
              <div className="flex items-center justify-between border-b border-slate-100 pb-2">
                <div className="flex items-center gap-2">
                  <span className="font-mono text-[11px] text-slate-400 font-bold">#{idx + 1}</span>
                  <span className="px-2.5 py-0.5 bg-blue-100 text-blue-900 rounded font-bold text-xs">
                    {row.category}
                  </span>
                  {row.speakerName && (
                    <span className="font-semibold text-slate-700 text-xs flex items-center gap-1">
                      <User className="w-3.5 h-3.5 text-slate-400" />
                      {row.speakerName}
                    </span>
                  )}
                </div>

                <div className="flex items-center space-x-1">
                  <button
                    type="button"
                    onClick={() => handleOpenEditRow(row)}
                    className="p-1 text-blue-600 hover:bg-blue-50 rounded"
                    title="수정"
                  >
                    <Edit2 className="w-3.5 h-3.5" />
                  </button>
                  <button
                    type="button"
                    onClick={() => handleDeleteRow(row.id)}
                    className="p-1 text-red-500 hover:bg-red-50 rounded"
                    title="삭제"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>

              {row.agendaTitle && (
                <div className="text-[11px] text-slate-500 bg-slate-50 px-2 py-1 rounded">
                  안건: {row.agendaTitle}
                </div>
              )}

              <div className="text-xs text-slate-800 leading-relaxed whitespace-pre-line font-sans">
                {row.content}
              </div>

              {row.decision && (
                <div className="p-2 bg-emerald-50 border border-emerald-200 rounded text-emerald-900 text-xs font-semibold flex items-center gap-1.5">
                  <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600 shrink-0" />
                  결정: {row.decision}
                </div>
              )}

              {row.actionItemTask && (
                <div className="p-2 bg-blue-50 border border-blue-200 rounded text-blue-900 text-[11px] flex items-center justify-between">
                  <span>과제: {row.actionItemTask} {row.assignee ? `(담당: ${row.assignee})` : ''}</span>
                  <button
                    type="button"
                    onClick={() => handleRegisterAsActionItem(row)}
                    className="text-blue-700 font-bold hover:underline"
                  >
                    + 조치등록
                  </button>
                </div>
              )}
            </div>
          ))}
        </div>
      ) : viewMode === 'agenda_group' ? (
        /* C. 안건 그룹형 (Agenda Group View) */
        <div className="space-y-4">
          {agendas.length === 0 ? (
            <div className="p-6 bg-slate-50 border border-slate-200 rounded-xl text-center text-xs text-slate-500">
              상단 안건 목록에 안건을 먼저 등록해 주세요.
            </div>
          ) : (
            agendas.map((ag) => {
              const agRows = rows.filter((r) => r.agendaId === ag.id || r.agendaTitle === ag.title);
              return (
                <div key={ag.id} className="bg-white rounded-xl border border-slate-200 overflow-hidden shadow-xs">
                  <div className="px-4 py-3 bg-slate-100 border-b border-slate-200 flex items-center justify-between font-bold text-slate-900 text-sm">
                    <div className="flex items-center gap-2">
                      <ListTodo className="w-4 h-4 text-blue-600" />
                      <span>{ag.title}</span>
                      <span className="text-xs font-normal text-slate-500">({agRows.length}개 항목)</span>
                    </div>
                  </div>

                  <div className="divide-y divide-slate-100 p-2">
                    {agRows.length === 0 ? (
                      <p className="text-xs text-slate-400 italic p-3 text-center">
                        이 안건에 연결된 회의록 항목이 아직 없습니다.
                      </p>
                    ) : (
                      agRows.map((r) => (
                        <div key={r.id} className="p-3 hover:bg-slate-50 flex items-start justify-between text-xs">
                          <div className="space-y-1 pr-4">
                            <div className="flex items-center gap-2">
                              <span className="px-2 py-0.5 bg-blue-100 text-blue-800 rounded font-bold text-[10px]">
                                {r.category}
                              </span>
                              {r.speakerName && (
                                <span className="font-semibold text-slate-700">{r.speakerName}</span>
                              )}
                            </div>
                            <div className="text-slate-800 whitespace-pre-line leading-relaxed">
                              {r.content}
                            </div>
                            {r.decision && (
                              <div className="text-emerald-700 font-semibold text-[11px]">
                                ✓ 결정: {r.decision}
                              </div>
                            )}
                          </div>
                          <button
                            type="button"
                            onClick={() => handleOpenEditRow(r)}
                            className="p-1 text-blue-600 hover:bg-blue-50 rounded"
                          >
                            <Edit2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      ))
                    )}
                  </div>
                </div>
              );
            })
          )}
        </div>
      ) : (
        /* D. 대화 타임라인형 (Timeline View) */
        <div className="relative pl-6 space-y-4 before:absolute before:left-2.5 before:top-2 before:bottom-2 before:w-0.5 before:bg-slate-200">
          {rows.map((row, idx) => (
            <div key={row.id} className="relative flex items-start gap-3">
              <div className="absolute -left-6 top-1 w-5 h-5 rounded-full bg-blue-600 text-white flex items-center justify-center text-[10px] font-bold">
                {idx + 1}
              </div>
              <div className="bg-white rounded-xl border border-slate-200 p-3.5 flex-1 shadow-xs space-y-2 text-xs">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span className="px-2 py-0.5 bg-blue-100 text-blue-800 font-bold rounded text-[11px]">
                      {row.category}
                    </span>
                    <span className="font-bold text-slate-800">{row.speakerName || '화자 미지정'}</span>
                  </div>
                  <button
                    type="button"
                    onClick={() => handleOpenEditRow(row)}
                    className="p-1 text-blue-600 hover:bg-blue-50 rounded"
                  >
                    <Edit2 className="w-3.5 h-3.5" />
                  </button>
                </div>
                <div className="text-slate-700 whitespace-pre-line leading-relaxed">{row.content}</div>
                {row.decision && (
                  <div className="text-emerald-800 font-semibold text-[11px] bg-emerald-50 p-1.5 rounded">
                    결정: {row.decision}
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* 모달 렌더링 */}
      <CategoryManagementModal
        isOpen={isCategoryModalOpen}
        onClose={() => setIsCategoryModalOpen(false)}
        categories={categories}
        onSaveCategories={(newCats) => onUpdateMeeting({ meetingCategories: newCats })}
      />

      <ColumnConfigModal
        isOpen={isColumnModalOpen}
        onClose={() => setIsColumnModalOpen(false)}
        columns={columns}
        onSaveColumns={(newCols) => onUpdateMeeting({ meetingColumns: newCols })}
      />

      <MeetingRowEditModal
        isOpen={isRowModalOpen}
        onClose={() => setIsRowModalOpen(false)}
        row={editingRow}
        categories={categories}
        attendees={meeting.attendees}
        agendas={agendas}
        columns={columns}
        onSaveRow={handleSaveRow}
      />

      <TemplateModal
        isOpen={isTemplateModalOpen}
        onClose={() => setIsTemplateModalOpen(false)}
        currentMeeting={meeting}
        onApplyTemplate={handleApplyTemplate}
      />

      <AiStructureReviewModal
        isOpen={isAiReviewModalOpen}
        onClose={() => setIsAiReviewModalOpen(false)}
        proposedRows={aiProposedRows}
        existingRows={rows}
        onApplyRows={handleApplyAiRows}
        isLoading={isAiLoading}
      />
    </div>
  );
};
