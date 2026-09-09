/**
 * @file src/components/meeting/content/ColumnConfigModal.tsx
 * @description 회의록 컬럼 구성 및 사용자 정의 컬럼(Custom Column) 관리 모달.
 * 표준 확장 컬럼의 표시 여부 토글과 새로운 사용자 정의 컬럼(텍스트, 숫자, 날짜, 선택목록, 체크박스 등)의
 * 추가, 삭제 및 순서 변경을 완벽하게 지원합니다.
 */

import React, { useState } from 'react';
import {
  X,
  Plus,
  Trash2,
  ArrowUp,
  ArrowDown,
  Columns3,
  Sliders,
  Check,
  RotateCcw,
} from 'lucide-react';
import { ColumnDefinition, ColumnType } from '../../../types/meetingUniversal';
import {
  SYSTEM_DEFAULT_COLUMNS,
  STANDARD_OPTIONAL_COLUMNS,
} from '../../../config/meetingTemplates';

interface ColumnConfigModalProps {
  isOpen: boolean;
  onClose: () => void;
  columns: ColumnDefinition[];
  onSaveColumns: (newColumns: ColumnDefinition[]) => void;
}

export const ColumnConfigModal: React.FC<ColumnConfigModalProps> = ({
  isOpen,
  onClose,
  columns,
  onSaveColumns,
}) => {
  const [columnList, setColumnList] = useState<ColumnDefinition[]>([...columns]);

  // 새 사용자 정의 컬럼 폼 상태
  const [newLabel, setNewLabel] = useState('');
  const [newKey, setNewKey] = useState('');
  const [newType, setNewType] = useState<ColumnType>('text');
  const [newWidth, setNewWidth] = useState('120px');
  const [newOptionsStr, setNewOptionsStr] = useState('');
  const [isAddingCustom, setIsAddingCustom] = useState(false);

  if (!isOpen) return null;

  const handleToggleVisible = (id: string) => {
    setColumnList(
      columnList.map((col) => {
        if (col.id === id) {
          if (col.isSystem) return col; // 시스템 기본 필드는 숨김 불가
          return { ...col, visible: !col.visible };
        }
        return col;
      })
    );
  };

  const handleMove = (index: number, direction: 'up' | 'down') => {
    if (direction === 'up' && index === 0) return;
    if (direction === 'down' && index === columnList.length - 1) return;
    const targetIdx = direction === 'up' ? index - 1 : index + 1;
    const updated = [...columnList];
    const temp = updated[index];
    updated[index] = updated[targetIdx];
    updated[targetIdx] = temp;
    // 순서 번호 재계산
    setColumnList(updated.map((c, i) => ({ ...c, order: i })));
  };

  const handleDeleteCustom = (id: string) => {
    setColumnList(columnList.filter((col) => col.id !== id));
  };

  const handleAddCustomColumn = () => {
    const trimmedLabel = newLabel.trim();
    if (!trimmedLabel) {
      alert('컬럼명을 입력하세요.');
      return;
    }

    const key = newKey.trim() || `custom_${Date.now()}`;
    if (columnList.some((c) => c.key === key)) {
      alert('이미 사용 중인 컬럼 키입니다. 다른 키를 입력하세요.');
      return;
    }

    let parsedOptions: string[] | undefined = undefined;
    if (newType === 'select') {
      parsedOptions = newOptionsStr
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean);
      if (!parsedOptions || parsedOptions.length === 0) {
        alert('선택목록(Select) 컬럼은 쉼표로 구분된 선택지 옵션을 1개 이상 입력해야 합니다.');
        return;
      }
    }

    const newCol: ColumnDefinition = {
      id: `col_custom_${Date.now()}`,
      key,
      label: trimmedLabel,
      type: newType,
      visible: true,
      order: columnList.length,
      width: newWidth || '120px',
      options: parsedOptions,
      isSystem: false,
    };

    setColumnList([...columnList, newCol]);
    setNewLabel('');
    setNewKey('');
    setNewOptionsStr('');
    setIsAddingCustom(false);
  };

  const handleAddStandardPreset = (std: ColumnDefinition) => {
    if (!columnList.some((c) => c.key === std.key)) {
      setColumnList([
        ...columnList,
        {
          ...std,
          order: columnList.length,
          visible: true,
        },
      ]);
    } else {
      // 이미 있으면 visible을 true로
      setColumnList(
        columnList.map((c) => (c.key === std.key ? { ...c, visible: true } : c))
      );
    }
  };

  const handleResetToDefault = () => {
    if (confirm('기본 표준 컬럼 구성으로 초기화하시겠습니까?')) {
      setColumnList([
        ...SYSTEM_DEFAULT_COLUMNS,
        { ...STANDARD_OPTIONAL_COLUMNS.find((c) => c.key === 'agendaTitle')!, visible: true },
        { ...STANDARD_OPTIONAL_COLUMNS.find((c) => c.key === 'decision')!, visible: true },
        { ...STANDARD_OPTIONAL_COLUMNS.find((c) => c.key === 'actionItemTask')!, visible: true },
        { ...STANDARD_OPTIONAL_COLUMNS.find((c) => c.key === 'assignee')!, visible: true },
        { ...STANDARD_OPTIONAL_COLUMNS.find((c) => c.key === 'dueDate')!, visible: true },
      ]);
    }
  };

  const handleSave = () => {
    onSaveColumns(columnList);
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-xs">
      <div className="bg-white rounded-xl shadow-2xl max-w-xl w-full max-h-[90vh] flex flex-col overflow-hidden animate-in fade-in zoom-in duration-150">
        {/* 헤더 */}
        <div className="px-6 py-4 border-b border-slate-200 flex items-center justify-between bg-slate-50">
          <div className="flex items-center space-x-2">
            <Columns3 className="w-5 h-5 text-blue-600" />
            <h3 className="text-base font-bold text-slate-900">회의록 컬럼 설정</h3>
          </div>
          <button
            onClick={onClose}
            className="text-slate-400 hover:text-slate-600 p-1.5 rounded-lg hover:bg-slate-200 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* 본문 */}
        <div className="p-6 space-y-6 overflow-y-auto flex-1 text-xs">
          <p className="text-slate-600 leading-relaxed">
            회의록 본문 표에서 사용할 컬럼을 구성합니다. 체크박스를 켜거나 끄면 화면과 출력 표에 즉시 반영되며,
            위/아래 버튼으로 컬럼 순서를 자유롭게 조정할 수 있습니다.
          </p>

          {/* 컬럼 목록 테이블 */}
          <div className="border border-slate-200 rounded-lg overflow-hidden bg-slate-50">
            <div className="px-3 py-2 bg-slate-100 border-b border-slate-200 flex items-center justify-between font-bold text-slate-700">
              <span>컬럼 구성 ({columnList.filter((c) => c.visible).length}/{columnList.length}개 표시)</span>
              <button
                type="button"
                onClick={handleResetToDefault}
                className="text-[11px] text-slate-500 hover:text-blue-600 flex items-center gap-1 font-normal"
              >
                <RotateCcw className="w-3 h-3" />
                기본값 복원
              </button>
            </div>

            <div className="divide-y divide-slate-100 max-h-60 overflow-y-auto bg-white">
              {columnList.map((col, idx) => (
                <div key={col.id} className="px-3 py-2 flex items-center justify-between hover:bg-slate-50">
                  <div className="flex items-center space-x-2 flex-1">
                    <input
                      type="checkbox"
                      id={`col_check_${col.id}`}
                      checked={col.visible}
                      disabled={col.isSystem}
                      onChange={() => handleToggleVisible(col.id)}
                      className="rounded border-slate-300 text-blue-600 focus:ring-blue-500 disabled:opacity-50 cursor-pointer"
                    />
                    <label
                      htmlFor={`col_check_${col.id}`}
                      className={`font-semibold cursor-pointer ${col.visible ? 'text-slate-900' : 'text-slate-400'}`}
                    >
                      {col.label}
                    </label>
                    <span className="text-[10px] text-slate-400 bg-slate-100 px-1.5 py-0.5 rounded font-mono">
                      {col.type}
                    </span>
                    {col.isSystem && (
                      <span className="text-[10px] text-blue-600 bg-blue-50 border border-blue-200 px-1.5 py-0.5 rounded font-semibold">
                        기본필수
                      </span>
                    )}
                  </div>

                  <div className="flex items-center space-x-1 shrink-0">
                    <button
                      type="button"
                      disabled={idx === 0}
                      onClick={() => handleMove(idx, 'up')}
                      className="p-1 text-slate-400 hover:text-slate-700 disabled:opacity-30 rounded hover:bg-slate-100"
                      title="왼쪽(위)으로 이동"
                    >
                      <ArrowUp className="w-3.5 h-3.5" />
                    </button>
                    <button
                      type="button"
                      disabled={idx === columnList.length - 1}
                      onClick={() => handleMove(idx, 'down')}
                      className="p-1 text-slate-400 hover:text-slate-700 disabled:opacity-30 rounded hover:bg-slate-100"
                      title="오른쪽(아래)으로 이동"
                    >
                      <ArrowDown className="w-3.5 h-3.5" />
                    </button>
                    {!col.isSystem && (
                      <button
                        type="button"
                        onClick={() => handleDeleteCustom(col.id)}
                        className="p-1 text-slate-400 hover:text-red-600 rounded hover:bg-slate-100 ml-1"
                        title="컬럼 완전히 제거"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* 표준 선택 필드 빠른 활성화 */}
          <div className="space-y-2">
            <span className="font-bold text-slate-700">표준 확장 컬럼 빠른 추가</span>
            <div className="flex flex-wrap gap-1.5">
              {STANDARD_OPTIONAL_COLUMNS.map((std) => {
                const existing = columnList.find((c) => c.key === std.key);
                const isShown = existing && existing.visible;
                return (
                  <button
                    key={std.key}
                    type="button"
                    onClick={() => handleAddStandardPreset(std)}
                    className={`text-[11px] px-2.5 py-1 rounded-md border transition-colors ${
                      isShown
                        ? 'bg-blue-50 border-blue-300 text-blue-700 font-semibold'
                        : 'bg-white border-slate-300 text-slate-600 hover:border-blue-400 hover:text-blue-600'
                    }`}
                  >
                    {isShown ? '✓ ' : '+ '}
                    {std.label}
                  </button>
                );
              })}
            </div>
          </div>

          {/* 사용자 정의 컬럼 직접 추가 아코디언 */}
          <div className="border border-slate-200 rounded-lg p-3 bg-slate-50 space-y-3">
            <div className="flex items-center justify-between">
              <span className="font-bold text-slate-800 flex items-center gap-1">
                <Sliders className="w-3.5 h-3.5 text-blue-600" />
                사용자 정의 컬럼 직접 추가
              </span>
              <button
                type="button"
                onClick={() => setIsAddingCustom(!isAddingCustom)}
                className="text-xs text-blue-600 hover:underline font-semibold"
              >
                {isAddingCustom ? '접기' : '+ 새 컬럼 생성'}
              </button>
            </div>

            {isAddingCustom && (
              <div className="space-y-3 pt-2 border-t border-slate-200 text-xs">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label className="block text-[11px] font-semibold text-slate-700 mb-1">
                      컬럼 표시 이름 (필수)
                    </label>
                    <input
                      type="text"
                      placeholder="예: 안건번호, 심의결과, 관련사업장"
                      value={newLabel}
                      onChange={(e) => setNewLabel(e.target.value)}
                      className="w-full p-2 bg-white border border-slate-300 rounded text-xs"
                    />
                  </div>
                  <div>
                    <label className="block text-[11px] font-semibold text-slate-700 mb-1">
                      데이터 타입
                    </label>
                    <select
                      value={newType}
                      onChange={(e) => setNewType(e.target.value as ColumnType)}
                      className="w-full p-2 bg-white border border-slate-300 rounded text-xs"
                    >
                      <option value="text">일반 텍스트 (단문)</option>
                      <option value="longtext">긴 텍스트 (여러 줄)</option>
                      <option value="number">숫자</option>
                      <option value="date">날짜 (YYYY-MM-DD)</option>
                      <option value="select">선택 목록 (드롭다운)</option>
                      <option value="checkbox">체크박스 (참/거짓)</option>
                      <option value="attendee">참석자 선택</option>
                      <option value="status">진행 상태 배지</option>
                    </select>
                  </div>
                </div>

                {newType === 'select' && (
                  <div>
                    <label className="block text-[11px] font-semibold text-slate-700 mb-1">
                      선택 옵션 목록 (쉼표로 구분)
                    </label>
                    <input
                      type="text"
                      placeholder="예: 찬성, 반대, 기권 또는 정상, 미흡, 불량"
                      value={newOptionsStr}
                      onChange={(e) => setNewOptionsStr(e.target.value)}
                      className="w-full p-2 bg-white border border-slate-300 rounded text-xs"
                    />
                  </div>
                )}

                <div className="flex justify-end pt-1">
                  <button
                    type="button"
                    onClick={handleAddCustomColumn}
                    className="px-4 py-1.5 bg-blue-600 hover:bg-blue-700 text-white font-semibold rounded text-xs flex items-center gap-1"
                  >
                    <Plus className="w-3.5 h-3.5" />
                    새 컬럼 추가
                  </button>
                </div>
              </div>
            )}
          </div>
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
