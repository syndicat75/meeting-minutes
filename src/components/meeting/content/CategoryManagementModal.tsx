/**
 * @file src/components/meeting/content/CategoryManagementModal.tsx
 * @description 회의별 구분(Category) 관리 모달.
 * 사용자가 자유롭게 구분을 추가, 수정, 삭제, 순서 변경할 수 있으며
 * 표준 추천 구분이나 다른 템플릿의 구분 목록을 일괄 추가할 수 있습니다.
 */

import React, { useState } from 'react';
import {
  X,
  Plus,
  Trash2,
  ArrowUp,
  ArrowDown,
  Tag,
  Check,
  RotateCcw,
  Sparkles,
} from 'lucide-react';
import { DEFAULT_RECOMMENDED_CATEGORIES } from '../../../config/meetingTemplates';

interface CategoryManagementModalProps {
  isOpen: boolean;
  onClose: () => void;
  categories: string[];
  onSaveCategories: (newCategories: string[]) => void;
}

export const CategoryManagementModal: React.FC<CategoryManagementModalProps> = ({
  isOpen,
  onClose,
  categories,
  onSaveCategories,
}) => {
  const [list, setList] = useState<string[]>([...categories]);
  const [newCatInput, setNewCatInput] = useState('');
  const [editingIndex, setEditingIndex] = useState<number | null>(null);
  const [editingText, setEditingText] = useState('');

  if (!isOpen) return null;

  const handleAdd = () => {
    const trimmed = newCatInput.trim();
    if (!trimmed) return;
    if (list.includes(trimmed)) {
      alert('이미 존재하는 구분입니다.');
      return;
    }
    setList([...list, trimmed]);
    setNewCatInput('');
  };

  const handleDelete = (index: number) => {
    setList(list.filter((_, i) => i !== index));
  };

  const handleMove = (index: number, direction: 'up' | 'down') => {
    if (direction === 'up' && index === 0) return;
    if (direction === 'down' && index === list.length - 1) return;
    const targetIdx = direction === 'up' ? index - 1 : index + 1;
    const updated = [...list];
    const temp = updated[index];
    updated[index] = updated[targetIdx];
    updated[targetIdx] = temp;
    setList(updated);
  };

  const startEdit = (index: number) => {
    setEditingIndex(index);
    setEditingText(list[index]);
  };

  const saveEdit = (index: number) => {
    const trimmed = editingText.trim();
    if (!trimmed) return;
    const updated = [...list];
    updated[index] = trimmed;
    setList(updated);
    setEditingIndex(null);
  };

  const handleAddRecommended = (rec: string) => {
    if (!list.includes(rec)) {
      setList([...list, rec]);
    }
  };

  const handleResetToStandard = () => {
    if (confirm('기본 표준 추천 구분 목록으로 초기화하시겠습니까?')) {
      setList([...DEFAULT_RECOMMENDED_CATEGORIES.slice(0, 12)]);
    }
  };

  const handleSave = () => {
    if (list.length === 0) {
      alert('최소 1개 이상의 구분이 필요합니다.');
      return;
    }
    onSaveCategories(list);
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-xs">
      <div className="bg-white rounded-xl shadow-2xl max-w-lg w-full max-h-[90vh] flex flex-col overflow-hidden animate-in fade-in zoom-in duration-150">
        {/* 헤더 */}
        <div className="px-6 py-4 border-b border-slate-200 flex items-center justify-between bg-slate-50">
          <div className="flex items-center space-x-2">
            <Tag className="w-5 h-5 text-blue-600" />
            <h3 className="text-base font-bold text-slate-900">회의 구분(Category) 관리</h3>
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
          <p className="text-slate-600 leading-relaxed">
            회의록 항목을 분류할 '구분' 목록을 정의합니다. 항목 작성 시 선택 드롭다운으로 표시되며,
            필요에 따라 순서를 조정하거나 새로운 구분을 생성할 수 있습니다.
          </p>

          {/* 새 구분 직접 추가 */}
          <div className="flex gap-2">
            <input
              type="text"
              placeholder="새 구분명 입력 (예: 위원 의견, 벤치마킹, 긴급안건 등)"
              value={newCatInput}
              onChange={(e) => setNewCatInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  handleAdd();
                }
              }}
              className="flex-1 p-2.5 bg-white border border-slate-300 rounded-lg text-xs focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
            />
            <button
              type="button"
              onClick={handleAdd}
              className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white font-semibold rounded-lg flex items-center gap-1 shrink-0"
            >
              <Plus className="w-3.5 h-3.5" />
              추가
            </button>
          </div>

          {/* 현재 등록된 구분 목록 (순서 변경 및 삭제) */}
          <div className="space-y-2">
            <div className="flex items-center justify-between text-slate-700 font-bold">
              <span>현재 설정된 구분 ({list.length}개)</span>
              <button
                type="button"
                onClick={handleResetToStandard}
                className="text-[11px] text-slate-500 hover:text-blue-600 flex items-center gap-1"
              >
                <RotateCcw className="w-3 h-3" />
                표준 기본값 복원
              </button>
            </div>

            <div className="border border-slate-200 rounded-lg divide-y divide-slate-100 max-h-56 overflow-y-auto bg-slate-50">
              {list.map((cat, idx) => (
                <div key={idx} className="p-2 flex items-center justify-between bg-white hover:bg-slate-50">
                  <div className="flex items-center space-x-2 flex-1 mr-2">
                    <span className="w-5 text-center text-slate-400 font-mono text-[10px]">{idx + 1}</span>
                    {editingIndex === idx ? (
                      <div className="flex items-center gap-1 flex-1">
                        <input
                          type="text"
                          value={editingText}
                          onChange={(e) => setEditingText(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') saveEdit(idx);
                          }}
                          className="p-1 border border-blue-400 rounded text-xs flex-1"
                          autoFocus
                        />
                        <button
                          type="button"
                          onClick={() => saveEdit(idx)}
                          className="px-2 py-1 bg-blue-600 text-white rounded text-[10px]"
                        >
                          확인
                        </button>
                      </div>
                    ) : (
                      <span
                        onClick={() => startEdit(idx)}
                        className="font-semibold text-slate-800 cursor-pointer hover:text-blue-600"
                        title="클릭하여 이름 수정"
                      >
                        {cat}
                      </span>
                    )}
                  </div>

                  <div className="flex items-center space-x-1 shrink-0">
                    <button
                      type="button"
                      disabled={idx === 0}
                      onClick={() => handleMove(idx, 'up')}
                      className="p-1 text-slate-400 hover:text-slate-700 disabled:opacity-30 rounded hover:bg-slate-100"
                      title="위로 이동"
                    >
                      <ArrowUp className="w-3.5 h-3.5" />
                    </button>
                    <button
                      type="button"
                      disabled={idx === list.length - 1}
                      onClick={() => handleMove(idx, 'down')}
                      className="p-1 text-slate-400 hover:text-slate-700 disabled:opacity-30 rounded hover:bg-slate-100"
                      title="아래로 이동"
                    >
                      <ArrowDown className="w-3.5 h-3.5" />
                    </button>
                    <button
                      type="button"
                      onClick={() => handleDelete(idx)}
                      className="p-1 text-slate-400 hover:text-red-600 rounded hover:bg-slate-100"
                      title="구분 삭제"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* 추천 구분 빠른 추가 배지 */}
          <div className="space-y-2">
            <span className="font-bold text-slate-700 flex items-center gap-1">
              <Sparkles className="w-3.5 h-3.5 text-amber-500" />
              추천 구분 빠른 추가 (클릭 시 추가됨)
            </span>
            <div className="flex flex-wrap gap-1.5 max-h-32 overflow-y-auto p-2 bg-slate-50 border border-slate-200 rounded-lg">
              {DEFAULT_RECOMMENDED_CATEGORIES.map((rec) => {
                const isAdded = list.includes(rec);
                return (
                  <button
                    key={rec}
                    type="button"
                    disabled={isAdded}
                    onClick={() => handleAddRecommended(rec)}
                    className={`text-[11px] px-2.5 py-1 rounded-md transition-colors ${
                      isAdded
                        ? 'bg-slate-200 text-slate-400 cursor-default'
                        : 'bg-white border border-slate-300 text-slate-700 hover:border-blue-500 hover:text-blue-600'
                    }`}
                  >
                    + {rec}
                  </button>
                );
              })}
            </div>
          </div>
        </div>

        {/* 푸터 버튼 */}
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
            onClick={handleSave}
            className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white text-xs font-semibold rounded-lg shadow-xs"
          >
            설정 저장
          </button>
        </div>
      </div>
    </div>
  );
};
