/**
 * @file src/components/meeting/tabs/SummaryTab.tsx
 * @description 회의록 요약 및 '구분 / 내용' 본문 표 편집 탭.
 * 핵심 요약, 안건별 논의, 결정/미결 사항, 후속 조치(Action Items), 첨부 양식 본문 표 편집,
 * AI 요약 재생성 및 변경사항 비교/선택(비파괴 덮어쓰기 방지)을 지원합니다.
 */

import React, { useState } from 'react';
import {
  Sparkles,
  CheckCircle2,
  Clock,
  User,
  Calendar,
  AlertCircle,
  Plus,
  Trash2,
  RefreshCw,
  Edit3,
  Check,
  RotateCcw,
  ArrowUpDown,
  Shield,
} from 'lucide-react';
import {
  Meeting,
  MeetingSummary,
  MeetingContentRow,
  ActionItem,
} from '../../../types/meeting';
import { requestComprehensiveMeetingSummary } from '../../../services/transcriptionClientService';
import { logger } from '../../../utils/logger';

interface SummaryTabProps {
  meeting: Meeting;
  isReadOnly: boolean;
  onUpdateMeeting: (partial: Partial<Meeting>) => void;
}

/**
 * AI 요약 및 '구분 / 내용' 본문 표 관리 탭 컴포넌트
 */
export const SummaryTab: React.FC<SummaryTabProps> = ({
  meeting,
  isReadOnly,
  onUpdateMeeting,
}) => {
  logger.debug('SummaryTab rendered', {
    hasSummary: Boolean(meeting.summary),
    contentRowsCount: meeting.contentRows?.length || 0,
  });

  const [isGenerating, setIsGenerating] = useState(false);
  const [generateError, setGenerateError] = useState<string | null>(null);

  // 새로 생성된 요약 임시 보관 (덮어쓰기 비교 모달용)
  const [incomingSummary, setIncomingSummary] = useState<MeetingSummary | null>(null);
  const [isComparisonModalOpen, setIsComparisonModalOpen] = useState(false);

  // 본문 행 추가 상태
  const [newCategory, setNewCategory] = useState('');
  const [newContent, setNewContent] = useState('');

  /**
   * AI 요약 생성/재생성 트리거 (대화록 또는 직접 작성 회의록 컨텍스트 종합 활용)
   */
  const handleGenerateSummary = async () => {
    logger.info('handleGenerateSummary called');

    const hasTranscripts = Boolean(meeting.transcripts && meeting.transcripts.length > 0);
    const hasManualEntries = Boolean(meeting.manualEntries && meeting.manualEntries.length > 0);
    const hasFreeformMemo = Boolean(meeting.freeformMemo && meeting.freeformMemo.trim().length > 0);
    const hasAnyContent = hasTranscripts || hasManualEntries || hasFreeformMemo;

    if (!hasAnyContent) {
      setGenerateError(
        '요약을 생성하려면 대화록 또는 [직접 작성] 탭에서 입력한 회의 내용(발언 또는 메모)이 필요합니다.'
      );
      return;
    }

    setIsGenerating(true);
    setGenerateError(null);

    try {
      const summary = await requestComprehensiveMeetingSummary(
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
          manualEntries: meeting.manualEntries,
          freeformMemo: meeting.freeformMemo,
          manualActionItems: meeting.manualActionItems,
        }
      );

      // 기존 사용자 수정본이 이미 존재하는 경우 조용히 덮어쓰지 않고 비교 모달 제공
      if (meeting.summary || (meeting.contentRows && meeting.contentRows.length > 0)) {
        logger.info('Existing summary/content found. Prompting comparison modal.');
        setIncomingSummary(summary);
        setIsComparisonModalOpen(true);
      } else {
        // 최초 생성 시 즉시 반영
        onUpdateMeeting({
          summary,
          contentRows: summary.suggestedContentRows || meeting.contentRows,
        });
      }
    } catch (err: any) {
      logger.error('Failed to generate summary', err);
      setGenerateError(err?.message || '회의록 요약 생성 중 알 수 없는 오류가 발생했습니다.');
    } finally {
      setIsGenerating(false);
    }
  };

  /**
   * 비교 후 새 AI 요약 전체 적용
   */
  const handleApplyIncomingSummary = () => {
    if (!incomingSummary) return;
    logger.info('Applying new AI summary over existing');
    onUpdateMeeting({
      summary: incomingSummary,
      contentRows: incomingSummary.suggestedContentRows || meeting.contentRows,
    });
    setIncomingSummary(null);
    setIsComparisonModalOpen(false);
  };

  /**
   * 본문 행 추가
   */
  const handleAddContentRow = () => {
    if (!newCategory.trim() && !newContent.trim()) return;
    logger.info('Adding new content row');
    const newRow: MeetingContentRow = {
      id: 'row_' + Date.now(),
      category: newCategory.trim() || '일반 안건',
      content: newContent.trim(),
      order: (meeting.contentRows || []).length,
    };
    onUpdateMeeting({ contentRows: [...(meeting.contentRows || []), newRow] });
    setNewCategory('');
    setNewContent('');
  };

  /**
   * 본문 행 삭제
   */
  const handleDeleteContentRow = (id: string) => {
    logger.info('Deleting content row', { id });
    const updated = (meeting.contentRows || []).filter((r) => r.id !== id);
    onUpdateMeeting({ contentRows: updated });
  };

  /**
   * 본문 행 인라인 내용 업데이트
   */
  const handleUpdateContentRow = (id: string, category: string, content: string) => {
    logger.debug('Updating content row', { id });
    const updated = (meeting.contentRows || []).map((r) =>
      r.id === id ? { ...r, category, content } : r
    );
    onUpdateMeeting({ contentRows: updated });
  };

  /**
   * 후속 조치 상태 토글
   */
  const handleToggleActionItemStatus = (itemId: string) => {
    if (!meeting.summary) return;
    logger.info('Toggling action item status', { itemId });
    const updatedActions = meeting.summary.actionItems.map((act) => {
      if (act.id === itemId) {
        const nextStatus =
          act.status === 'pending'
            ? 'in_progress'
            : act.status === 'in_progress'
            ? 'completed'
            : 'pending';
        return { ...act, status: nextStatus as any };
      }
      return act;
    });

    onUpdateMeeting({
      summary: {
        ...meeting.summary,
        actionItems: updatedActions,
      },
    });
  };

  return (
    <div className="space-y-6">
      {/* 상단 제어 바: AI 요약 생성 버튼 및 상태 */}
      <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <div className="flex items-center space-x-2">
            <Sparkles className="w-4 h-4 text-blue-600" />
            <h4 className="text-sm font-bold text-slate-900">AI 회의록 분석 및 요약</h4>
          </div>
          <p className="text-xs text-slate-500 mt-0.5">
            화자별 대화록을 분석하여 표준 회의록 본문 문안, 핵심 요약, 후속 조치를 자동 도출합니다.
          </p>
        </div>

        {!isReadOnly && (
          <button
            type="button"
            onClick={handleGenerateSummary}
            disabled={isGenerating}
            className="flex items-center space-x-1.5 px-4 py-2 bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-500 hover:to-indigo-500 text-white text-xs font-bold rounded-lg shadow-sm transition-all disabled:opacity-50 shrink-0"
          >
            {isGenerating ? (
              <RefreshCw className="w-3.5 h-3.5 animate-spin" />
            ) : (
              <Sparkles className="w-3.5 h-3.5 text-amber-300" />
            )}
            <span>{isGenerating ? 'AI 심층 요약 중...' : meeting.summary ? 'AI 요약 재생성' : 'AI 요약 생성'}</span>
          </button>
        )}
      </div>

      {generateError && (
        <div className="p-3 bg-red-50 border border-red-200 rounded-lg text-xs text-red-700">
          {generateError}
        </div>
      )}

      {/* 1. 회의록 양식의 핵심: '구분 / 내용' 본문 표 (인쇄 시 들어갈 메인 표) */}
      <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-6 space-y-4">
        <div className="flex items-center justify-between border-b border-slate-100 pb-3">
          <div>
            <h4 className="text-sm font-bold text-slate-900">회의 내용 (구분 / 내용 표)</h4>
            <p className="text-xs text-slate-500">
              최종 인쇄 회의록의 '회의 내용' 표에 출력되는 표준 항목입니다.
            </p>
          </div>
          <span className="text-xs font-semibold px-2.5 py-0.5 rounded bg-blue-50 text-blue-700 border border-blue-200">
            총 {(meeting.contentRows || []).length}개 항목
          </span>
        </div>

        {/* 표 목록 */}
        <div className="border border-slate-200 rounded-lg overflow-hidden">
          <table className="w-full text-left text-xs">
            <thead className="bg-slate-100 border-b border-slate-200 text-slate-700 font-bold">
              <tr>
                <th className="py-2.5 px-3 w-40">구분</th>
                <th className="py-2.5 px-3">회의 내용 및 심의 결과</th>
                {!isReadOnly && <th className="py-2.5 px-3 w-16 text-center">삭제</th>}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {(meeting.contentRows || []).map((row) => (
                <tr key={row.id} className="hover:bg-slate-50">
                  <td className="p-2.5 align-top">
                    <input
                      type="text"
                      disabled={isReadOnly}
                      value={row.category}
                      onChange={(e) => handleUpdateContentRow(row.id, e.target.value, row.content)}
                      className="w-full p-1.5 font-semibold text-slate-900 bg-white border border-slate-200 rounded focus:ring-1 focus:ring-blue-500 disabled:bg-transparent disabled:border-none"
                    />
                  </td>
                  <td className="p-2.5">
                    <textarea
                      rows={3}
                      disabled={isReadOnly}
                      value={row.content}
                      onChange={(e) => handleUpdateContentRow(row.id, row.category, e.target.value)}
                      className="w-full p-1.5 text-slate-800 bg-white border border-slate-200 rounded focus:ring-1 focus:ring-blue-500 disabled:bg-transparent disabled:border-none leading-relaxed"
                    />
                  </td>
                  {!isReadOnly && (
                    <td className="p-2.5 text-center align-top">
                      <button
                        type="button"
                        onClick={() => handleDeleteContentRow(row.id)}
                        className="p-1.5 text-slate-400 hover:text-red-600 rounded hover:bg-slate-100"
                        title="행 삭제"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* 새 행 추가 폼 */}
        {!isReadOnly && (
          <div className="p-4 bg-slate-50 border border-slate-200 rounded-lg space-y-3">
            <span className="text-xs font-bold text-slate-800 flex items-center">
              <Plus className="w-3.5 h-3.5 mr-1 text-blue-600" />새 항목 추가
            </span>
            <div className="grid grid-cols-1 sm:grid-cols-4 gap-3">
              <input
                type="text"
                placeholder="구분 (예: 안건 심의)"
                value={newCategory}
                onChange={(e) => setNewCategory(e.target.value)}
                className="text-xs p-2 bg-white border border-slate-200 rounded"
              />
              <input
                type="text"
                placeholder="내용 입력..."
                value={newContent}
                onChange={(e) => setNewContent(e.target.value)}
                className="text-xs p-2 bg-white border border-slate-200 rounded sm:col-span-2"
              />
              <button
                type="button"
                onClick={handleAddContentRow}
                className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-white text-xs font-semibold rounded"
              >
                행 추가
              </button>
            </div>
          </div>
        )}
      </div>

      {/* 2. AI 구조화 요약 카드들 (핵심 요약, 결정사항, 미결사항, 후속조치) */}
      {meeting.summary && (
        <div className="space-y-6">
          {/* 핵심 요약 */}
          <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-6 space-y-2">
            <h4 className="text-sm font-bold text-slate-900 flex items-center">
              <CheckCircle2 className="w-4 h-4 mr-1.5 text-emerald-600" />
              핵심 요약 (Executive Summary)
            </h4>
            <p className="text-xs text-slate-700 leading-relaxed bg-slate-50 p-3.5 rounded-lg border border-slate-100">
              {meeting.summary.executiveSummary}
            </p>
          </div>

          {/* 안건별 논의 및 결정 사항 그리드 */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {/* 결정 사항 */}
            <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-6 space-y-3">
              <h4 className="text-sm font-bold text-slate-900 text-emerald-800 flex items-center">
                <Check className="w-4 h-4 mr-1.5 text-emerald-600" />
                확정 결정 사항
              </h4>
              <ul className="space-y-2 text-xs">
                {(meeting.summary.decisions || []).map((dec, idx) => (
                  <li
                    key={idx}
                    className="p-2.5 bg-emerald-50/50 border border-emerald-100 rounded-lg text-emerald-950 flex items-start space-x-2"
                  >
                    <span className="w-1.5 h-1.5 rounded-full bg-emerald-600 mt-1.5 shrink-0" />
                    <span>{dec.text}</span>
                  </li>
                ))}
              </ul>
            </div>

            {/* 미결 사항 */}
            <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-6 space-y-3">
              <h4 className="text-sm font-bold text-slate-900 text-amber-800 flex items-center">
                <Clock className="w-4 h-4 mr-1.5 text-amber-600" />
                미결 및 추가 검토 사항
              </h4>
              <ul className="space-y-2 text-xs">
                {(meeting.summary.pendingItems || []).map((pen, idx) => (
                  <li
                    key={idx}
                    className="p-2.5 bg-amber-50/50 border border-amber-100 rounded-lg text-amber-950 flex items-start space-x-2"
                  >
                    <span className="w-1.5 h-1.5 rounded-full bg-amber-600 mt-1.5 shrink-0" />
                    <span>{pen.text}</span>
                  </li>
                ))}
              </ul>
            </div>
          </div>

          {/* 후속 조치 (Action Items) */}
          <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-6 space-y-4">
            <h4 className="text-sm font-bold text-slate-900 flex items-center">
              <Calendar className="w-4 h-4 mr-1.5 text-blue-600" />
              후속 조치 과제 (Action Items)
            </h4>
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead className="bg-slate-50 border-b border-slate-200 text-slate-600 font-semibold">
                  <tr>
                    <th className="py-2.5 px-3">상태</th>
                    <th className="py-2.5 px-3">할 일 (과제)</th>
                    <th className="py-2.5 px-3">담당자</th>
                    <th className="py-2.5 px-3">기한</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {(meeting.summary.actionItems || []).map((act) => (
                    <tr key={act.id} className="hover:bg-slate-50">
                      <td className="py-2.5 px-3">
                        <button
                          type="button"
                          disabled={isReadOnly}
                          onClick={() => handleToggleActionItemStatus(act.id)}
                          className={`px-2 py-0.5 rounded text-[11px] font-bold ${
                            act.status === 'completed'
                              ? 'bg-emerald-100 text-emerald-800'
                              : act.status === 'in_progress'
                              ? 'bg-blue-100 text-blue-800'
                              : 'bg-slate-100 text-slate-700'
                          }`}
                        >
                          {act.status === 'completed'
                            ? '완료'
                            : act.status === 'in_progress'
                            ? '진행 중'
                            : '대기'}
                        </button>
                      </td>
                      <td className="py-2.5 px-3 font-medium text-slate-900">{act.task}</td>
                      <td className="py-2.5 px-3 text-slate-600">{act.assignee || '미지정'}</td>
                      <td className="py-2.5 px-3 text-slate-600">{act.dueDate || '미지정'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* 위험성평가 특화 테이블 (논의된 경우에만 표시) */}
          {meeting.summary.riskAssessments && meeting.summary.riskAssessments.length > 0 && (
            <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-6 space-y-3">
              <h4 className="text-sm font-bold text-slate-900 flex items-center text-red-900">
                <Shield className="w-4 h-4 mr-1.5 text-red-600" />
                위험성평가 유해위험요인 및 개선대책
              </h4>
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead className="bg-red-50/50 border-b border-red-100 text-red-900 font-bold">
                    <tr>
                      <th className="py-2.5 px-3">유해위험요인</th>
                      <th className="py-2.5 px-3">개선대책</th>
                      <th className="py-2.5 px-3 w-28">담당자</th>
                      <th className="py-2.5 px-3 w-28">조치기한</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-red-50">
                    {meeting.summary.riskAssessments.map((risk, idx) => (
                      <tr key={idx}>
                        <td className="p-2.5 font-semibold text-slate-900">{risk.riskFactor}</td>
                        <td className="p-2.5 text-slate-700">{risk.countermeasure}</td>
                        <td className="p-2.5 text-slate-600">{risk.assignee || '미지정'}</td>
                        <td className="p-2.5 text-slate-600">{risk.dueDate || '미지정'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      )}

      {/* 요약 덮어쓰기 방지 비교 모달 */}
      {isComparisonModalOpen && incomingSummary && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
          <div className="bg-white rounded-xl shadow-2xl max-w-2xl w-full border border-slate-200 overflow-hidden p-6 space-y-4">
            <h4 className="text-base font-bold text-slate-900">AI 요약 재생성 결과 비교</h4>
            <p className="text-xs text-slate-600">
              이미 작성된 회의 내용 또는 기존 요약이 존재합니다. 새로 생성된 AI 결과로 덮어쓸지 선택하십시오.
            </p>

            <div className="p-3 bg-slate-50 border border-slate-200 rounded-lg max-h-60 overflow-y-auto text-xs space-y-2">
              <span className="font-bold text-slate-800">[새로 도출된 핵심 요약]</span>
              <p className="text-slate-700">{incomingSummary.executiveSummary}</p>
              <div className="pt-2">
                <span className="font-bold text-slate-800">[추천된 본문 항목 수]</span>{' '}
                {incomingSummary.suggestedContentRows?.length || 0}개
              </div>
            </div>

            <div className="flex justify-end space-x-2 pt-2 border-t border-slate-200">
              <button
                type="button"
                onClick={() => setIsComparisonModalOpen(false)}
                className="px-3.5 py-1.5 text-xs text-slate-600 hover:bg-slate-100 rounded"
              >
                기존 내용 유지 (취소)
              </button>
              <button
                type="button"
                onClick={handleApplyIncomingSummary}
                className="px-4 py-1.5 bg-blue-600 hover:bg-blue-500 text-white text-xs font-bold rounded shadow-sm"
              >
                새 AI 결과로 덮어쓰기
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
