/**
 * @file src/components/meeting/content/MeetingRowEditModal.tsx
 * @description 회의록 항목 (MeetingRow) 생성 및 수정 모달.
 * 구분(Category), 화자(Speaker), 회의 내용(Content) 기본 3개 필드와
 * 선택적 확장 필드(안건, 결정사항, 조치사항, 담당자, 기한, 사용자 정의 컬럼)를 지원하며,
 * 내용 입력 시 줄바꿈, 글머리표(-), 번호목록, 굵게 서식을 원클릭으로 보조합니다.
 */

import React, { useState, useEffect } from 'react';
import {
  X,
  Plus,
  Tag,
  User,
  FileText,
  List,
  ListOrdered,
  Bold,
  CheckCircle2,
  Calendar,
  Layers,
  Sparkles,
} from 'lucide-react';
import { MeetingRow, ColumnDefinition, MeetingAgenda } from '../../../types/meetingUniversal';
import { Attendee } from '../../../types/meeting';

interface MeetingRowEditModalProps {
  isOpen: boolean;
  onClose: () => void;
  row?: MeetingRow | null; // null이면 신규 추가
  categories: string[];
  attendees: Attendee[];
  agendas: MeetingAgenda[];
  columns: ColumnDefinition[];
  onSaveRow: (row: MeetingRow, newCategoryAdded?: string) => void;
}

export const MeetingRowEditModal: React.FC<MeetingRowEditModalProps> = ({
  isOpen,
  onClose,
  row,
  categories,
  attendees,
  agendas,
  columns,
  onSaveRow,
}) => {
  const isEditing = Boolean(row);

  const [category, setCategory] = useState<string>(categories[0] || '논의');
  const [isDirectCategory, setIsDirectCategory] = useState(false);
  const [directCategoryInput, setDirectCategoryInput] = useState('');

  const [speakerMode, setSpeakerMode] = useState<'attendee' | 'direct' | 'none'>('attendee');
  const [speakerId, setSpeakerId] = useState<string>('');
  const [speakerName, setSpeakerName] = useState<string>('');

  const [content, setContent] = useState<string>('');
  const [agendaId, setAgendaId] = useState<string>('');
  const [agendaTitle, setAgendaTitle] = useState<string>('');
  const [decision, setDecision] = useState<string>('');
  const [actionItemTask, setActionItemTask] = useState<string>('');
  const [assignee, setAssignee] = useState<string>('');
  const [dueDate, setDueDate] = useState<string>('');
  const [importance, setImportance] = useState<'low' | 'medium' | 'high' | 'urgent'>('medium');
  const [notes, setNotes] = useState<string>('');
  const [customFields, setCustomFields] = useState<Record<string, any>>({});

  useEffect(() => {
    if (row) {
      if (categories.includes(row.category)) {
        setCategory(row.category);
        setIsDirectCategory(false);
      } else {
        setCategory('__direct__');
        setIsDirectCategory(true);
        setDirectCategoryInput(row.category);
      }

      if (!row.speakerName && !row.speakerId) {
        setSpeakerMode('none');
        setSpeakerName('');
        setSpeakerId('');
      } else if (row.speakerId && attendees.some((a) => a.id === row.speakerId)) {
        setSpeakerMode('attendee');
        setSpeakerId(row.speakerId);
        setSpeakerName(row.speakerName || '');
      } else {
        setSpeakerMode('direct');
        setSpeakerId('');
        setSpeakerName(row.speakerName || '');
      }

      setContent(row.content || '');
      setAgendaId(row.agendaId || '');
      setAgendaTitle(row.agendaTitle || '');
      setDecision(row.decision || '');
      setActionItemTask(row.actionItemTask || '');
      setAssignee(row.assignee || '');
      setDueDate(row.dueDate || '');
      setImportance(row.importance || 'medium');
      setNotes(row.notes || '');
      setCustomFields(row.customFields || {});
    } else {
      // 신규 추가 초기화
      setCategory(categories[0] || '논의');
      setIsDirectCategory(false);
      setDirectCategoryInput('');
      setSpeakerMode('attendee');
      setSpeakerId(attendees[0]?.id || '');
      setSpeakerName(attendees[0]?.name || '');
      setContent('');
      setAgendaId('');
      setAgendaTitle('');
      setDecision('');
      setActionItemTask('');
      setAssignee('');
      setDueDate('');
      setImportance('medium');
      setNotes('');
      setCustomFields({});
    }
  }, [row, categories, attendees, isOpen]);

  if (!isOpen) return null;

  // 글머리표 서식 헬퍼
  const handleInsertBullet = () => {
    if (content.endsWith('\n') || content.length === 0) {
      setContent(content + '- ');
    } else {
      setContent(content + '\n- ');
    }
  };

  const handleInsertNumbered = () => {
    const lines = content.split('\n');
    const nextNum = lines.length + 1;
    if (content.endsWith('\n') || content.length === 0) {
      setContent(content + `1. `);
    } else {
      setContent(content + `\n${nextNum}. `);
    }
  };

  const handleInsertBold = () => {
    setContent(content + '**강조**');
  };

  const handleSpeakerSelect = (attId: string) => {
    setSpeakerId(attId);
    const found = attendees.find((a) => a.id === attId);
    if (found) {
      setSpeakerName(found.name);
    }
  };

  const handleSave = () => {
    const finalCategory = isDirectCategory ? directCategoryInput.trim() : category;
    if (!finalCategory) {
      alert('구분을 선택하거나 직접 입력하세요.');
      return;
    }

    if (!content.trim()) {
      alert('회의 내용을 입력하세요.');
      return;
    }

    let finalSpeakerName = '';
    if (speakerMode === 'attendee') {
      finalSpeakerName = speakerName;
    } else if (speakerMode === 'direct') {
      finalSpeakerName = speakerName.trim();
    } else {
      finalSpeakerName = ''; // 빈 화자 허용
    }

    const updatedRow: MeetingRow = {
      id: row?.id || `row_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
      order: row?.order ?? 0,
      category: finalCategory,
      speakerId: speakerMode === 'attendee' ? speakerId : undefined,
      speakerName: finalSpeakerName,
      content: content.trim(),
      agendaId: agendaId || undefined,
      agendaTitle: agendaTitle.trim() || undefined,
      decision: decision.trim() || undefined,
      actionItemTask: actionItemTask.trim() || undefined,
      assignee: assignee.trim() || undefined,
      dueDate: dueDate.trim() || undefined,
      importance,
      notes: notes.trim() || undefined,
      customFields,
      source: row?.source || 'manual',
      isUserEdited: true,
      updatedAt: new Date().toISOString(),
      createdAt: row?.createdAt || new Date().toISOString(),
    };

    onSaveRow(updatedRow, isDirectCategory && directCategoryInput.trim() ? directCategoryInput.trim() : undefined);
    onClose();
  };

  const visibleCustomCols = columns.filter((c) => !c.isSystem && c.visible);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-xs">
      <div className="bg-white rounded-xl shadow-2xl max-w-2xl w-full max-h-[92vh] flex flex-col overflow-hidden animate-in fade-in zoom-in duration-150">
        {/* 모달 헤더 */}
        <div className="px-6 py-4 border-b border-slate-200 flex items-center justify-between bg-slate-50">
          <div className="flex items-center space-x-2">
            <FileText className="w-5 h-5 text-blue-600" />
            <h3 className="text-base font-bold text-slate-900">
              {isEditing ? '회의록 항목 수정' : '새 회의록 항목 추가'}
            </h3>
          </div>
          <button
            onClick={onClose}
            className="text-slate-400 hover:text-slate-600 p-1.5 rounded-lg hover:bg-slate-200 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* 모달 본문 */}
        <div className="p-6 space-y-4 overflow-y-auto flex-1 text-xs">
          {/* 1. 구분 및 화자 (기본 필수) */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {/* 구분 (Category) */}
            <div>
              <label className="block text-xs font-bold text-slate-800 mb-1 flex items-center gap-1">
                <Tag className="w-3.5 h-3.5 text-blue-600" />
                구분 (Category) <span className="text-red-500">*</span>
              </label>

              {!isDirectCategory ? (
                <div className="space-y-1">
                  <select
                    value={category}
                    onChange={(e) => {
                      if (e.target.value === '__direct__') {
                        setIsDirectCategory(true);
                      } else {
                        setCategory(e.target.value);
                      }
                    }}
                    className="w-full p-2.5 bg-white border border-slate-300 rounded-lg text-xs font-semibold text-slate-800 focus:ring-2 focus:ring-blue-500"
                  >
                    {categories.map((cat) => (
                      <option key={cat} value={cat}>
                        {cat}
                      </option>
                    ))}
                    <option value="__direct__">+ 새 구분 직접 입력...</option>
                  </select>
                </div>
              ) : (
                <div className="flex gap-1.5">
                  <input
                    type="text"
                    placeholder="새 구분명 입력 (예: 벤치마킹, 건의)"
                    value={directCategoryInput}
                    onChange={(e) => setDirectCategoryInput(e.target.value)}
                    className="flex-1 p-2 bg-white border border-blue-400 rounded-lg text-xs"
                    autoFocus
                  />
                  <button
                    type="button"
                    onClick={() => setIsDirectCategory(false)}
                    className="px-2.5 py-1 text-slate-600 hover:bg-slate-100 rounded text-[11px]"
                  >
                    목록 선택
                  </button>
                </div>
              )}
            </div>

            {/* 화자 (Speaker) */}
            <div>
              <label className="block text-xs font-bold text-slate-800 mb-1 flex items-center gap-1">
                <User className="w-3.5 h-3.5 text-blue-600" />
                화자 (Speaker) <span className="text-slate-400 font-normal">(빈 화자 가능)</span>
              </label>

              <div className="space-y-1.5">
                <div className="flex gap-2 text-[11px]">
                  <label className="flex items-center gap-1 cursor-pointer">
                    <input
                      type="radio"
                      name="speakerMode"
                      checked={speakerMode === 'attendee'}
                      onChange={() => setSpeakerMode('attendee')}
                      className="text-blue-600"
                    />
                    참석자 선택
                  </label>
                  <label className="flex items-center gap-1 cursor-pointer">
                    <input
                      type="radio"
                      name="speakerMode"
                      checked={speakerMode === 'direct'}
                      onChange={() => setSpeakerMode('direct')}
                      className="text-blue-600"
                    />
                    직접 입력
                  </label>
                  <label className="flex items-center gap-1 cursor-pointer">
                    <input
                      type="radio"
                      name="speakerMode"
                      checked={speakerMode === 'none'}
                      onChange={() => setSpeakerMode('none')}
                      className="text-blue-600"
                    />
                    화자 없음
                  </label>
                </div>

                {speakerMode === 'attendee' && (
                  <select
                    value={speakerId}
                    onChange={(e) => handleSpeakerSelect(e.target.value)}
                    className="w-full p-2 bg-white border border-slate-300 rounded-lg text-xs"
                  >
                    <option value="">참석자를 선택하세요</option>
                    {attendees.map((att) => (
                      <option key={att.id} value={att.id}>
                        {att.name} {att.role ? `(${att.role})` : ''}
                      </option>
                    ))}
                  </select>
                )}

                {speakerMode === 'direct' && (
                  <input
                    type="text"
                    placeholder="화자 성명 직접 입력 (예: 외부 전문가, 간사 등)"
                    value={speakerName}
                    onChange={(e) => setSpeakerName(e.target.value)}
                    className="w-full p-2 bg-white border border-slate-300 rounded-lg text-xs"
                  />
                )}

                {speakerMode === 'none' && (
                  <p className="text-[11px] text-slate-500 italic p-1">화자 없이 항목 내용만 기록됩니다.</p>
                )}
              </div>
            </div>
          </div>

          {/* 2. 회의 내용 (Content) */}
          <div>
            <div className="flex items-center justify-between mb-1">
              <label className="block text-xs font-bold text-slate-800">
                회의 내용 <span className="text-red-500">*</span>
              </label>

              {/* 빠른 서식 보조 버튼 */}
              <div className="flex items-center space-x-1">
                <button
                  type="button"
                  onClick={handleInsertBullet}
                  className="px-2 py-0.5 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded text-[11px] flex items-center gap-1 font-mono"
                  title="글머리표 (-) 추가"
                >
                  <List className="w-3 h-3" />
                  글머리표(-)
                </button>
                <button
                  type="button"
                  onClick={handleInsertNumbered}
                  className="px-2 py-0.5 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded text-[11px] flex items-center gap-1 font-mono"
                  title="번호 목록 (1.) 추가"
                >
                  <ListOrdered className="w-3 h-3" />
                  번호(1.)
                </button>
                <button
                  type="button"
                  onClick={handleInsertBold}
                  className="px-2 py-0.5 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded text-[11px] flex items-center gap-1 font-mono"
                  title="굵게 강조"
                >
                  <Bold className="w-3 h-3" />
                  굵게
                </button>
              </div>
            </div>

            <textarea
              rows={4}
              value={content}
              onChange={(e) => setContent(e.target.value)}
              placeholder="회의 발언 요지, 심의 결과, 협의 내용 등을 자유롭게 입력하세요. (줄바꿈 지원)"
              className="w-full p-3 bg-white border border-slate-300 rounded-lg text-xs text-slate-800 focus:ring-2 focus:ring-blue-500 leading-relaxed font-sans"
            />
          </div>

          {/* 3. 안건 및 결정사항 (선택) */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 pt-2 border-t border-slate-100">
            <div>
              <label className="block text-[11px] font-semibold text-slate-700 mb-1">
                상위 안건 (Agenda)
              </label>
              {agendas.length > 0 ? (
                <select
                  value={agendaId}
                  onChange={(e) => {
                    const id = e.target.value;
                    setAgendaId(id);
                    const found = agendas.find((a) => a.id === id);
                    if (found) setAgendaTitle(found.title);
                  }}
                  className="w-full p-2 bg-white border border-slate-300 rounded-lg text-xs"
                >
                  <option value="">안건 미지정</option>
                  {agendas.map((ag) => (
                    <option key={ag.id} value={ag.id}>
                      {ag.title}
                    </option>
                  ))}
                </select>
              ) : (
                <input
                  type="text"
                  placeholder="안건명 입력 (예: 안건 1. 설비 교체안)"
                  value={agendaTitle}
                  onChange={(e) => setAgendaTitle(e.target.value)}
                  className="w-full p-2 bg-white border border-slate-300 rounded-lg text-xs"
                />
              )}
            </div>

            <div>
              <label className="block text-[11px] font-semibold text-slate-700 mb-1 flex items-center gap-1">
                <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" />
                합의 및 결정사항 (Decision)
              </label>
              <input
                type="text"
                placeholder="해당 발언 또는 논의의 결정사항"
                value={decision}
                onChange={(e) => setDecision(e.target.value)}
                className="w-full p-2 bg-white border border-slate-300 rounded-lg text-xs"
              />
            </div>
          </div>

          {/* 4. 후속 조치사항 (Action Item 연동) */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 p-3 bg-slate-50 border border-slate-200 rounded-lg">
            <div className="sm:col-span-1">
              <label className="block text-[11px] font-semibold text-slate-700 mb-1">
                후속 조치 과제 (Action Item)
              </label>
              <input
                type="text"
                placeholder="실행할 조치 과제"
                value={actionItemTask}
                onChange={(e) => setActionItemTask(e.target.value)}
                className="w-full p-2 bg-white border border-slate-300 rounded text-xs"
              />
            </div>
            <div>
              <label className="block text-[11px] font-semibold text-slate-700 mb-1">
                조치 담당자
              </label>
              <input
                type="text"
                placeholder="담당자명 (예: 김철수)"
                value={assignee}
                onChange={(e) => setAssignee(e.target.value)}
                className="w-full p-2 bg-white border border-slate-300 rounded text-xs"
              />
            </div>
            <div>
              <label className="block text-[11px] font-semibold text-slate-700 mb-1">
                완료 기한
              </label>
              <input
                type="date"
                value={dueDate}
                onChange={(e) => setDueDate(e.target.value)}
                className="w-full p-2 bg-white border border-slate-300 rounded text-xs"
              />
            </div>
          </div>

          {/* 5. 사용자 정의 컬럼 필드 동적 렌더링 */}
          {visibleCustomCols.length > 0 && (
            <div className="space-y-3 pt-2 border-t border-slate-100">
              <span className="font-bold text-slate-800 block text-xs">
                사용자 정의 컬럼 값
              </span>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {visibleCustomCols.map((col) => {
                  const val = customFields[col.key] ?? '';

                  return (
                    <div key={col.id}>
                      <label className="block text-[11px] font-semibold text-slate-700 mb-1">
                        {col.label}
                      </label>

                      {col.type === 'checkbox' ? (
                        <div className="flex items-center gap-2 mt-1">
                          <input
                            type="checkbox"
                            id={`field_${col.key}`}
                            checked={Boolean(val)}
                            onChange={(e) =>
                              setCustomFields({ ...customFields, [col.key]: e.target.checked })
                            }
                            className="rounded border-slate-300 text-blue-600 focus:ring-blue-500"
                          />
                          <label htmlFor={`field_${col.key}`} className="text-xs text-slate-700">
                            {col.label} 적용
                          </label>
                        </div>
                      ) : col.type === 'select' && col.options ? (
                        <select
                          value={val}
                          onChange={(e) =>
                            setCustomFields({ ...customFields, [col.key]: e.target.value })
                          }
                          className="w-full p-2 bg-white border border-slate-300 rounded text-xs"
                        >
                          <option value="">선택하세요</option>
                          {col.options.map((opt) => (
                            <option key={opt} value={opt}>
                              {opt}
                            </option>
                          ))}
                        </select>
                      ) : col.type === 'date' ? (
                        <input
                          type="date"
                          value={val}
                          onChange={(e) =>
                            setCustomFields({ ...customFields, [col.key]: e.target.value })
                          }
                          className="w-full p-2 bg-white border border-slate-300 rounded text-xs"
                        />
                      ) : col.type === 'number' ? (
                        <input
                          type="number"
                          value={val}
                          onChange={(e) =>
                            setCustomFields({ ...customFields, [col.key]: e.target.value })
                          }
                          className="w-full p-2 bg-white border border-slate-300 rounded text-xs"
                        />
                      ) : col.type === 'longtext' ? (
                        <textarea
                          rows={2}
                          value={val}
                          onChange={(e) =>
                            setCustomFields({ ...customFields, [col.key]: e.target.value })
                          }
                          className="w-full p-2 bg-white border border-slate-300 rounded text-xs"
                        />
                      ) : (
                        <input
                          type="text"
                          value={val}
                          onChange={(e) =>
                            setCustomFields({ ...customFields, [col.key]: e.target.value })
                          }
                          className="w-full p-2 bg-white border border-slate-300 rounded text-xs"
                        />
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          )}
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
            className="px-5 py-2 bg-blue-600 hover:bg-blue-700 text-white text-xs font-semibold rounded-lg shadow-xs flex items-center gap-1"
          >
            <CheckCircle2 className="w-4 h-4" />
            {isEditing ? '변경사항 저장' : '항목 등록'}
          </button>
        </div>
      </div>
    </div>
  );
};
