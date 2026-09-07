/**
 * @file src/components/meeting/transcript/CustomTermsModal.tsx
 * @description 회의별 필수 보호 전문용어 사전 관리 모달 컴포넌트.
 * 고유명사, 부서명, 설비명, 산업안전 전문용어(위험성평가, TBM, LOTO 등)를 등록하여
 * AI 음성인식 및 문맥 교정 시 단어가 왜곡되거나 오인식되지 않도록 방지합니다.
 */

import React, { useState } from 'react';
import { BookOpen, Plus, X, RotateCcw, ShieldCheck, Check } from 'lucide-react';
import { logger } from '../../../utils/logger';

interface CustomTermsModalProps {
  isOpen: boolean;
  onClose: () => void;
  customTerms: string[];
  onSaveTerms: (newTerms: string[]) => void;
  isReadOnly?: boolean;
}

/**
 * 기본 권장 산업안전보건 및 회의 필수 전문용어 목록
 */
const DEFAULT_RECOMMENDED_TERMS = [
  '위험성평가',
  '아차사고',
  'TBM',
  'LOTO',
  '산업안전보건위원회',
  '위험성평가위원회',
  '남부권역',
  '밀폐공간',
  '방호울',
  '특별안전교육',
];

/**
 * 전문용어 사전 관리 모달
 */
export const CustomTermsModal: React.FC<CustomTermsModalProps> = ({
  isOpen,
  onClose,
  customTerms,
  onSaveTerms,
  isReadOnly = false,
}) => {
  const [terms, setTerms] = useState<string[]>(() => {
    return customTerms && customTerms.length > 0
      ? customTerms
      : [...DEFAULT_RECOMMENDED_TERMS];
  });
  const [newTermInput, setNewTermInput] = useState('');

  if (!isOpen) return null;

  /**
   * 새 용어 추가
   */
  const handleAddTerm = (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    const trimmed = newTermInput.trim();
    if (!trimmed) return;

    if (terms.includes(trimmed)) {
      setNewTermInput('');
      return;
    }

    logger.info('Adding custom term', { term: trimmed });
    const updated = [...terms, trimmed];
    setTerms(updated);
    setNewTermInput('');
  };

  /**
   * 용어 삭제
   */
  const handleRemoveTerm = (termToRemove: string) => {
    if (isReadOnly) return;
    logger.info('Removing custom term', { term: termToRemove });
    setTerms(terms.filter((t) => t !== termToRemove));
  };

  /**
   * 기본 권장 용어로 리셋/채우기
   */
  const handleRestoreDefaults = () => {
    if (isReadOnly) return;
    logger.info('Restoring default recommended terms');
    const merged = Array.from(new Set([...terms, ...DEFAULT_RECOMMENDED_TERMS]));
    setTerms(merged);
  };

  /**
   * 최종 저장
   */
  const handleSave = () => {
    logger.info('Saving custom terms to meeting', { count: terms.length });
    onSaveTerms(terms);
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 backdrop-blur-xs">
      <div className="bg-white rounded-xl shadow-xl max-w-lg w-full border border-slate-200 overflow-hidden flex flex-col max-h-[90vh]">
        {/* 모달 헤더 */}
        <div className="flex items-center justify-between p-5 border-b border-slate-100 bg-slate-50">
          <div className="flex items-center space-x-2.5">
            <div className="w-8 h-8 rounded-lg bg-blue-100 flex items-center justify-center text-blue-600">
              <BookOpen className="w-4 h-4" />
            </div>
            <div>
              <h3 className="text-base font-bold text-slate-900">전문용어 사전</h3>
              <p className="text-xs text-slate-500">
                AI가 음성 전사 및 문맥 교정 시 왜곡하지 않도록 보호할 필수 단어 목록
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
        <div className="p-5 space-y-4 overflow-y-auto flex-1 text-sm">
          {/* 용어 추가 입력폼 */}
          {!isReadOnly && (
            <form onSubmit={handleAddTerm} className="flex gap-2">
              <input
                type="text"
                placeholder="추가할 전문용어 입력 (예: 설비명, 부서명, 약어)"
                value={newTermInput}
                onChange={(e) => setNewTermInput(e.target.value)}
                className="flex-1 px-3 py-2 text-xs border border-slate-300 rounded-lg focus:outline-hidden focus:ring-2 focus:ring-blue-500"
              />
              <button
                type="submit"
                className="inline-flex items-center space-x-1 px-3 py-2 bg-blue-600 hover:bg-blue-700 text-white text-xs font-semibold rounded-lg transition-colors shrink-0"
              >
                <Plus className="w-3.5 h-3.5" />
                <span>추가</span>
              </button>
            </form>
          )}

          {/* 등록된 단어 태그 클라우드 */}
          <div className="space-y-2">
            <div className="flex items-center justify-between text-xs text-slate-600">
              <span className="font-semibold">등록된 단어 ({terms.length}개)</span>
              {!isReadOnly && (
                <button
                  type="button"
                  onClick={handleRestoreDefaults}
                  className="inline-flex items-center space-x-1 text-blue-600 hover:text-blue-800 text-[11px] font-medium"
                >
                  <RotateCcw className="w-3 h-3" />
                  <span>기본 안전용어 채우기</span>
                </button>
              )}
            </div>

            <div className="min-h-[140px] max-h-[260px] overflow-y-auto p-3 bg-slate-50 border border-slate-200 rounded-lg flex flex-wrap gap-2 items-start content-start">
              {terms.length === 0 ? (
                <div className="w-full text-center py-8 text-xs text-slate-400">
                  등록된 전문용어가 없습니다. 상단에서 단어를 추가해주세요.
                </div>
              ) : (
                terms.map((term) => (
                  <span
                    key={term}
                    className="inline-flex items-center space-x-1.5 px-2.5 py-1 bg-white border border-slate-200 text-slate-800 text-xs rounded-md shadow-2xs font-medium"
                  >
                    <span>{term}</span>
                    {!isReadOnly && (
                      <button
                        type="button"
                        onClick={() => handleRemoveTerm(term)}
                        className="text-slate-400 hover:text-red-500 transition-colors"
                      >
                        <X className="w-3 h-3" />
                      </button>
                    )}
                  </span>
                ))
              )}
            </div>
          </div>

          <div className="p-3 bg-blue-50/60 border border-blue-100 rounded-lg text-xs text-blue-800 flex items-start space-x-2">
            <ShieldCheck className="w-4 h-4 text-blue-600 shrink-0 mt-0.5" />
            <p className="leading-relaxed">
              사전에 등록된 단어는 AI 문맥 교정 시 발음 유사어(예: &apos;나무 권역&apos; &rarr; &apos;남부권역&apos;)가 발견되면
              우선적으로 올바른 용어로 자동 교정되며, 임의 변형이 방지됩니다.
            </p>
          </div>
        </div>

        {/* 모달 푸터 */}
        <div className="p-4 border-t border-slate-100 bg-slate-50 flex justify-end space-x-2">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 text-xs font-semibold text-slate-600 hover:bg-slate-200 rounded-lg transition-colors"
          >
            닫기
          </button>
          {!isReadOnly && (
            <button
              type="button"
              onClick={handleSave}
              className="inline-flex items-center space-x-1.5 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white text-xs font-semibold rounded-lg shadow-2xs transition-colors"
            >
              <Check className="w-3.5 h-3.5" />
              <span>적용 및 저장</span>
            </button>
          )}
        </div>
      </div>
    </div>
  );
};
