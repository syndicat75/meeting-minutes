/**
 * @file src/components/meeting/content/AiStructureReviewModal.tsx
 * @description AI 회의록 자동 구조화 결과 검토 및 반영 모달.
 * AI가 전사문과 직접 입력 발언을 분석하여 생성한 '회의록 항목(Row)'들을 미리 확인하고,
 * 기존 사용자가 수정한 내용을 안전하게 보존하면서 적용 방식을 선택할 수 있습니다.
 */

import React, { useState } from 'react';
import {
  X,
  Sparkles,
  CheckCircle2,
  ShieldCheck,
  Plus,
  RefreshCw,
  AlertCircle,
  Tag,
  User,
} from 'lucide-react';
import { MeetingRow } from '../../../types/meetingUniversal';

interface AiStructureReviewModalProps {
  isOpen: boolean;
  onClose: () => void;
  proposedRows: MeetingRow[];
  existingRows: MeetingRow[];
  onApplyRows: (newRows: MeetingRow[], mode: 'append' | 'replace') => void;
  isLoading?: boolean;
}

export const AiStructureReviewModal: React.FC<AiStructureReviewModalProps> = ({
  isOpen,
  onClose,
  proposedRows,
  existingRows,
  onApplyRows,
  isLoading = false,
}) => {
  const [applyMode, setApplyMode] = useState<'append' | 'replace'>('append');

  if (!isOpen) return null;

  const userEditedCount = existingRows.filter((r) => r.isUserEdited).length;

  const handleConfirm = () => {
    if (applyMode === 'replace' && userEditedCount > 0) {
      if (
        !confirm(
          `기존에 사용자가 직접 수정한 항목이 ${userEditedCount}개 있습니다. 정말로 AI 결과로 전체 대체하시겠습니까?\n('기존 내용 유지하고 추가'를 선택하면 직접 작성한 내용이 안전하게 보존됩니다)`
        )
      ) {
        return;
      }
    }
    onApplyRows(proposedRows, applyMode);
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-xs">
      <div className="bg-white rounded-xl shadow-2xl max-w-3xl w-full max-h-[92vh] flex flex-col overflow-hidden animate-in fade-in zoom-in duration-150">
        {/* 헤더 */}
        <div className="px-6 py-4 border-b border-slate-200 flex items-center justify-between bg-blue-50">
          <div className="flex items-center space-x-2">
            <Sparkles className="w-5 h-5 text-blue-600" />
            <h3 className="text-base font-bold text-blue-950">AI 회의록 자동 구조화 결과 검토</h3>
          </div>
          <button
            onClick={onClose}
            className="text-slate-400 hover:text-slate-600 p-1.5 rounded-lg hover:bg-slate-200 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* 본문 */}
        <div className="p-6 space-y-5 overflow-y-auto flex-1 text-xs">
          {isLoading ? (
            <div className="py-16 text-center space-y-3">
              <div className="w-8 h-8 border-3 border-blue-600 border-t-transparent rounded-full animate-spin mx-auto" />
              <p className="text-sm font-semibold text-slate-800">
                AI가 회의 전사 내용과 메모를 분석하여 구조화하고 있습니다...
              </p>
              <p className="text-xs text-slate-500">
                발언 문맥에 맞는 [구분], [화자], [내용], [결정사항]을 자동 합성 중입니다.
              </p>
            </div>
          ) : (
            <>
              {/* 원칙 안내 배너 */}
              <div className="p-3 bg-emerald-50 border border-emerald-200 rounded-lg flex items-start gap-2 text-emerald-900">
                <ShieldCheck className="w-4 h-4 text-emerald-600 shrink-0 mt-0.5" />
                <div className="space-y-0.5">
                  <span className="font-bold text-xs">사용자 주권 원칙 준수</span>
                  <p className="text-[11px] text-emerald-800 leading-relaxed">
                    AI가 제안한 회의록 항목을 확인한 후 적용 방식을 선택할 수 있습니다. 이미 작성자가 직접
                    수정한 항목은 동의 없이 임의로 덮어쓰지 않습니다.
                  </p>
                </div>
              </div>

              {/* 적용 방식 선택 */}
              <div className="p-3.5 bg-slate-50 border border-slate-200 rounded-lg space-y-2">
                <span className="font-bold text-slate-800 block text-xs">적용 방식 선택</span>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <label
                    className={`p-3 rounded-lg border cursor-pointer transition-all flex items-start gap-2 ${
                      applyMode === 'append'
                        ? 'bg-blue-50 border-blue-400 text-blue-950 font-semibold'
                        : 'bg-white border-slate-200 text-slate-700'
                    }`}
                  >
                    <input
                      type="radio"
                      name="applyMode"
                      value="append"
                      checked={applyMode === 'append'}
                      onChange={() => setApplyMode('append')}
                      className="mt-0.5 text-blue-600"
                    />
                    <div>
                      <span className="block text-xs font-bold">기존 내용 유지하고 추가 (권장)</span>
                      <span className="text-[11px] text-slate-500 font-normal">
                        현재 회의록 행 {existingRows.length}개 뒤에 AI가 제안한 항목을 이어 붙입니다.
                      </span>
                    </div>
                  </label>

                  <label
                    className={`p-3 rounded-lg border cursor-pointer transition-all flex items-start gap-2 ${
                      applyMode === 'replace'
                        ? 'bg-amber-50 border-amber-400 text-amber-950 font-semibold'
                        : 'bg-white border-slate-200 text-slate-700'
                    }`}
                  >
                    <input
                      type="radio"
                      name="applyMode"
                      value="replace"
                      checked={applyMode === 'replace'}
                      onChange={() => setApplyMode('replace')}
                      className="mt-0.5 text-amber-600"
                    />
                    <div>
                      <span className="block text-xs font-bold">AI 제안 항목으로 전체 대체</span>
                      <span className="text-[11px] text-slate-500 font-normal">
                        기존 회의록 항목을 AI가 제안한 {proposedRows.length}개 항목으로 새로 교체합니다.
                      </span>
                    </div>
                  </label>
                </div>
              </div>

              {/* AI 제안 항목 미리보기 목록 */}
              <div className="space-y-2">
                <div className="flex items-center justify-between font-bold text-slate-800">
                  <span>AI 제안 회의록 항목 ({proposedRows.length}개)</span>
                  <span className="text-[11px] text-slate-500 font-normal">
                    적용 후 자유롭게 수정 및 삭제가 가능합니다.
                  </span>
                </div>

                <div className="border border-slate-200 rounded-lg divide-y divide-slate-200 max-h-72 overflow-y-auto bg-white">
                  {proposedRows.map((row, idx) => (
                    <div key={row.id || idx} className="p-3 hover:bg-slate-50 space-y-1.5">
                      <div className="flex items-center gap-2">
                        <span className="font-mono text-slate-400 text-[10px] w-4">{idx + 1}</span>
                        <span className="px-2 py-0.5 bg-blue-100 text-blue-800 font-bold rounded text-[11px]">
                          {row.category}
                        </span>
                        {row.speakerName && (
                          <span className="text-slate-600 font-semibold text-[11px] flex items-center gap-1">
                            <User className="w-3 h-3 text-slate-400" />
                            {row.speakerName}
                          </span>
                        )}
                        {row.agendaTitle && (
                          <span className="text-[10px] text-slate-500 bg-slate-100 px-1.5 py-0.5 rounded">
                            안건: {row.agendaTitle}
                          </span>
                        )}
                      </div>

                      <div className="text-slate-800 text-xs whitespace-pre-line pl-6 font-sans leading-relaxed">
                        {row.content}
                      </div>

                      {row.decision && (
                        <div className="pl-6 text-[11px] text-emerald-800 font-semibold flex items-center gap-1">
                          <CheckCircle2 className="w-3 h-3 text-emerald-600 shrink-0" />
                          결정: {row.decision}
                        </div>
                      )}

                      {row.actionItemTask && (
                        <div className="pl-6 text-[11px] text-blue-700 flex items-center gap-2">
                          <span>조치과제: {row.actionItemTask}</span>
                          {row.assignee && <span>(담당: {row.assignee})</span>}
                          {row.dueDate && <span>[기한: {row.dueDate}]</span>}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            </>
          )}
        </div>

        {/* 푸터 */}
        <div className="px-6 py-3 border-t border-slate-200 bg-slate-50 flex items-center justify-end space-x-2">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 text-xs font-semibold text-slate-600 hover:text-slate-800 rounded-lg hover:bg-slate-200"
          >
            취소
          </button>
          <button
            type="button"
            disabled={isLoading || proposedRows.length === 0}
            onClick={handleConfirm}
            className="px-5 py-2 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white text-xs font-semibold rounded-lg shadow-xs flex items-center gap-1.5"
          >
            <CheckCircle2 className="w-4 h-4" />
            회의록에 반영하기
          </button>
        </div>
      </div>
    </div>
  );
};
