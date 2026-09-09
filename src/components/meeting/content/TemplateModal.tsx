/**
 * @file src/components/meeting/content/TemplateModal.tsx
 * @description 회의 유형 템플릿 선택 및 사용자 정의 템플릿 저장/관리 모달.
 * 13종의 다양한 회의 양식(일반, 안전보건, 프로젝트, 스크럼, 경영회의 등)을 원클릭으로 적용하고,
 * 사용자가 맞춤 구성한 회의 구조를 '내 템플릿'으로 저장하여 재사용할 수 있습니다.
 */

import React, { useState } from 'react';
import {
  X,
  LayoutTemplate,
  Check,
  BookmarkPlus,
  Trash2,
  Sparkles,
  Tag,
  Columns3,
  ListTodo,
} from 'lucide-react';
import { MeetingTemplate } from '../../../types/meetingUniversal';
import {
  getAllTemplates,
  saveCustomTemplate,
  deleteCustomTemplate,
  BUILT_IN_MEETING_TEMPLATES,
} from '../../../config/meetingTemplates';
import { Meeting } from '../../../types/meeting';

interface TemplateModalProps {
  isOpen: boolean;
  onClose: () => void;
  currentMeeting: Meeting;
  onApplyTemplate: (template: MeetingTemplate) => void;
  onReloadTemplates?: () => void;
}

export const TemplateModal: React.FC<TemplateModalProps> = ({
  isOpen,
  onClose,
  currentMeeting,
  onApplyTemplate,
  onReloadTemplates,
}) => {
  const [templates, setTemplates] = useState<MeetingTemplate[]>(getAllTemplates());
  const [selectedId, setSelectedId] = useState<string>(
    currentMeeting.meetingTemplateId || 'general_business'
  );

  // 내 템플릿 저장 모달 모드
  const [isSavingCustom, setIsSavingCustom] = useState(false);
  const [customName, setCustomName] = useState('');
  const [customDescription, setCustomDescription] = useState('');
  const [customIcon, setCustomIcon] = useState('Briefcase');

  if (!isOpen) return null;

  const selectedTemplate =
    templates.find((t) => t.id === selectedId) || templates[0];

  const handleApply = () => {
    if (!selectedTemplate) return;
    if (
      confirm(
        `[${selectedTemplate.name}] 템플릿의 구분 및 컬럼 설정을 현재 회의에 적용하시겠습니까?\n(기존 작성된 회의록 내용은 안전하게 보존됩니다)`
      )
    ) {
      onApplyTemplate(selectedTemplate);
      onClose();
    }
  };

  const handleSaveAsMyTemplate = () => {
    const trimmed = customName.trim();
    if (!trimmed) {
      alert('템플릿 이름을 입력하세요.');
      return;
    }

    const newCustom: MeetingTemplate = {
      id: `custom_tpl_${Date.now()}`,
      name: trimmed,
      description: customDescription.trim() || '사용자 저장 회의 템플릿',
      typeCategory: '사용자 정의',
      icon: customIcon,
      categories: currentMeeting.meetingCategories && currentMeeting.meetingCategories.length > 0
        ? [...currentMeeting.meetingCategories]
        : ['보고사항', '논의', '결정사항', '조치사항'],
      defaultColumns: currentMeeting.meetingColumns && currentMeeting.meetingColumns.length > 0
        ? [...currentMeeting.meetingColumns]
        : selectedTemplate.defaultColumns,
      defaultAgendas: currentMeeting.meetingAgendas
        ? currentMeeting.meetingAgendas.map((a) => ({ title: a.title, order: a.order }))
        : undefined,
      defaultPrintViewMode: currentMeeting.meetingViewConfig?.printViewMode || 'standard',
      mergeCategoryCells: currentMeeting.meetingViewConfig?.mergeCategoryCells ?? true,
      isCustom: true,
    };

    saveCustomTemplate(newCustom);
    setTemplates(getAllTemplates());
    setSelectedId(newCustom.id);
    setIsSavingCustom(false);
    setCustomName('');
    setCustomDescription('');
    alert(`[${trimmed}] 템플릿이 '내 템플릿'으로 저장되었습니다.`);
    if (onReloadTemplates) onReloadTemplates();
  };

  const handleDeleteCustom = (tplId: string, name: string) => {
    if (confirm(`'${name}' 사용자 템플릿을 삭제하시겠습니까?`)) {
      deleteCustomTemplate(tplId);
      const updated = getAllTemplates();
      setTemplates(updated);
      if (selectedId === tplId) {
        setSelectedId('general_business');
      }
      if (onReloadTemplates) onReloadTemplates();
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-xs">
      <div className="bg-white rounded-xl shadow-2xl max-w-3xl w-full max-h-[92vh] flex flex-col overflow-hidden animate-in fade-in zoom-in duration-150">
        {/* 헤더 */}
        <div className="px-6 py-4 border-b border-slate-200 flex items-center justify-between bg-slate-50">
          <div className="flex items-center space-x-2">
            <LayoutTemplate className="w-5 h-5 text-blue-600" />
            <h3 className="text-base font-bold text-slate-900">회의 양식 템플릿 카탈로그</h3>
          </div>
          <button
            onClick={onClose}
            className="text-slate-400 hover:text-slate-600 p-1.5 rounded-lg hover:bg-slate-200 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* 본문 (2열 레이아웃: 좌측 템플릿 목록, 우측 템플릿 상세 미리보기) */}
        <div className="flex flex-col md:flex-row flex-1 overflow-hidden">
          {/* 좌측: 템플릿 목록 */}
          <div className="w-full md:w-72 border-r border-slate-200 bg-slate-50 p-4 flex flex-col overflow-y-auto">
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs font-bold text-slate-700">템플릿 선택</span>
              <button
                type="button"
                onClick={() => setIsSavingCustom(!isSavingCustom)}
                className="text-[11px] text-blue-600 hover:underline font-semibold flex items-center gap-1"
              >
                <BookmarkPlus className="w-3 h-3" />
                현재 양식 저장
              </button>
            </div>

            {/* 현재 회의 양식을 새 템플릿으로 저장하는 폼 */}
            {isSavingCustom && (
              <div className="mb-3 p-2.5 bg-blue-50 border border-blue-200 rounded-lg text-xs space-y-2">
                <span className="font-bold text-blue-900 block">내 템플릿으로 저장</span>
                <input
                  type="text"
                  placeholder="템플릿 이름 (예: 부서 주간회의)"
                  value={customName}
                  onChange={(e) => setCustomName(e.target.value)}
                  className="w-full p-1.5 bg-white border border-blue-300 rounded text-xs"
                />
                <input
                  type="text"
                  placeholder="설명 (선택)"
                  value={customDescription}
                  onChange={(e) => setCustomDescription(e.target.value)}
                  className="w-full p-1.5 bg-white border border-blue-300 rounded text-xs"
                />
                <div className="flex justify-end gap-1">
                  <button
                    type="button"
                    onClick={() => setIsSavingCustom(false)}
                    className="px-2 py-1 text-slate-600 hover:bg-slate-100 rounded text-[10px]"
                  >
                    취소
                  </button>
                  <button
                    type="button"
                    onClick={handleSaveAsMyTemplate}
                    className="px-2.5 py-1 bg-blue-600 text-white rounded font-semibold text-[10px]"
                  >
                    저장
                  </button>
                </div>
              </div>
            )}

            <div className="space-y-1.5 flex-1">
              {templates.map((tpl) => {
                const isSelected = tpl.id === selectedId;
                return (
                  <div
                    key={tpl.id}
                    onClick={() => setSelectedId(tpl.id)}
                    className={`p-2.5 rounded-lg cursor-pointer transition-all flex items-start justify-between ${
                      isSelected
                        ? 'bg-blue-600 text-white shadow-xs'
                        : 'bg-white hover:bg-slate-100 text-slate-800 border border-slate-200'
                    }`}
                  >
                    <div className="flex-1 pr-2">
                      <div className="flex items-center gap-1.5">
                        <span className="font-semibold text-xs">{tpl.name}</span>
                        {!tpl.isBuiltin && (
                          <span
                            className={`text-[9px] px-1.5 py-0.2 rounded ${
                              isSelected ? 'bg-blue-800 text-blue-100' : 'bg-amber-100 text-amber-800'
                            }`}
                          >
                            내 템플릿
                          </span>
                        )}
                      </div>
                      <p
                        className={`text-[10px] mt-0.5 line-clamp-1 ${
                          isSelected ? 'text-blue-100' : 'text-slate-500'
                        }`}
                      >
                        {tpl.description}
                      </p>
                    </div>

                    {!tpl.isBuiltin && (
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          handleDeleteCustom(tpl.id, tpl.name);
                        }}
                        className={`p-1 rounded hover:bg-red-500 hover:text-white transition-colors ${
                          isSelected ? 'text-blue-200' : 'text-slate-400'
                        }`}
                        title="템플릿 삭제"
                      >
                        <Trash2 className="w-3 h-3" />
                      </button>
                    )}
                  </div>
                );
              })}
            </div>
          </div>

          {/* 우측: 선택된 템플릿 미리보기 및 사양 */}
          <div className="flex-1 p-6 overflow-y-auto space-y-5 text-xs">
            {selectedTemplate && (
              <>
                <div className="border-b border-slate-200 pb-3">
                  <div className="flex items-center gap-2">
                    <h4 className="text-base font-bold text-slate-900">{selectedTemplate.name}</h4>
                    {selectedTemplate.isBuiltin ? (
                      <span className="text-[10px] px-2 py-0.5 bg-slate-100 text-slate-600 rounded font-semibold">
                        기본 내장 템플릿
                      </span>
                    ) : (
                      <span className="text-[10px] px-2 py-0.5 bg-amber-50 text-amber-700 border border-amber-200 rounded font-semibold">
                        사용자 정의 템플릿
                      </span>
                    )}
                  </div>
                  <p className="text-slate-600 text-xs mt-1">{selectedTemplate.description}</p>
                </div>

                {/* 권장 구분 (Categories) */}
                <div className="space-y-2">
                  <span className="font-bold text-slate-800 flex items-center gap-1.5">
                    <Tag className="w-3.5 h-3.5 text-blue-600" />
                    추천 회의 구분 ({selectedTemplate.categories.length}개)
                  </span>
                  <div className="flex flex-wrap gap-1.5 p-3 bg-slate-50 border border-slate-200 rounded-lg">
                    {selectedTemplate.categories.map((c) => (
                      <span
                        key={c}
                        className="px-2 py-1 bg-white border border-slate-300 rounded text-slate-700 text-[11px] font-medium"
                      >
                        {c}
                      </span>
                    ))}
                  </div>
                </div>

                {/* 기본 활성화 컬럼 */}
                <div className="space-y-2">
                  <span className="font-bold text-slate-800 flex items-center gap-1.5">
                    <Columns3 className="w-3.5 h-3.5 text-blue-600" />
                    기본 구성 컬럼 (
                    {selectedTemplate.defaultColumns.filter((c) => c.visible).length}개 표시)
                  </span>
                  <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                    {selectedTemplate.defaultColumns.map((col) => (
                      <div
                        key={col.id}
                        className={`p-2 rounded border text-[11px] flex items-center justify-between ${
                          col.visible
                            ? 'bg-blue-50 border-blue-200 text-blue-900 font-semibold'
                            : 'bg-slate-50 border-slate-200 text-slate-400'
                        }`}
                      >
                        <span>{col.label}</span>
                        <span className="text-[9px] font-mono text-slate-400">{col.type}</span>
                      </div>
                    ))}
                  </div>
                </div>

                {/* 기본 안건 (있을 경우) */}
                {selectedTemplate.defaultAgendas && selectedTemplate.defaultAgendas.length > 0 && (
                  <div className="space-y-2">
                    <span className="font-bold text-slate-800 flex items-center gap-1.5">
                      <ListTodo className="w-3.5 h-3.5 text-blue-600" />
                      기본 권장 안건
                    </span>
                    <ul className="list-disc list-inside space-y-1 p-3 bg-slate-50 border border-slate-200 rounded-lg text-slate-700 text-xs">
                      {selectedTemplate.defaultAgendas.map((a, i) => (
                        <li key={i}>{a.title}</li>
                      ))}
                    </ul>
                  </div>
                )}
              </>
            )}
          </div>
        </div>

        {/* 푸터 */}
        <div className="px-6 py-3 border-t border-slate-200 bg-slate-50 flex items-center justify-between">
          <span className="text-[11px] text-slate-500">
            템플릿을 적용해도 이미 작성된 회의록 내용은 삭제되지 않습니다.
          </span>
          <div className="flex items-center space-x-2">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-xs font-semibold text-slate-600 hover:text-slate-800 rounded-lg hover:bg-slate-200"
            >
              닫기
            </button>
            <button
              type="button"
              onClick={handleApply}
              className="px-5 py-2 bg-blue-600 hover:bg-blue-700 text-white text-xs font-semibold rounded-lg shadow-xs flex items-center gap-1"
            >
              <Check className="w-4 h-4" />이 템플릿 적용하기
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
