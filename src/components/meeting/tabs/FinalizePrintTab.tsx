/**
 * @file src/components/meeting/tabs/FinalizePrintTab.tsx
 * @description 최종 확정 및 A4 표준 회의록 인쇄/PDF 출력 탭.
 * 확정 전 누락 체크리스트 검증, 소유자 확정 시 스냅샷 동결 보존,
 * A4 세로/가로 인쇄 양식 최적화 및 브라우저 인쇄/PDF 호출을 지원합니다.
 */

import React, { useState } from 'react';
import {
  Lock,
  Unlock,
  Printer,
  FileCheck,
  AlertTriangle,
  CheckCircle2,
  FileText,
  Calendar,
  Building,
  Users,
  Image as ImageIcon,
  Check,
} from 'lucide-react';
import { Meeting } from '../../../types/meeting';
import { formatKoreanDate, formatKoreanDateTime } from '../../../utils/formatters';
import { logger } from '../../../utils/logger';

interface FinalizePrintTabProps {
  meeting: Meeting;
  currentUserId: string;
  onUpdateMeeting: (partial: Partial<Meeting>) => void;
  onSave: () => void;
}

/**
 * 최종 확정 및 인쇄 탭 컴포넌트
 */
export const FinalizePrintTab: React.FC<FinalizePrintTabProps> = ({
  meeting,
  currentUserId,
  onUpdateMeeting,
  onSave,
}) => {
  logger.debug('FinalizePrintTab rendered', {
    status: meeting.status,
    isFinalized: meeting.status === 'finalized',
  });

  const [printOrientation, setPrintOrientation] = useState<'portrait' | 'landscape'>('portrait');
  const [includePhotosInPrint, setIncludePhotosInPrint] = useState<boolean>(true);

  const isOwner = meeting.ownerId === currentUserId || currentUserId === 'local_user';
  const isFinalized = meeting.status === 'finalized';

  // 서명 완료 현황 계산
  const totalAttendees = meeting.attendees.length;
  const signedAttendees = meeting.attendees.filter((a) => a.signatures && a.signatures.length > 0);
  const unsignedAttendees = meeting.attendees.filter((a) => !a.signatures || a.signatures.length === 0);

  // 내용 작성 여부 (범용 회의록 행, 본문 행 또는 직접 작성 발언/자유 메모)
  const hasMeetingContent = Boolean(
    (meeting.meetingRows && meeting.meetingRows.length > 0) ||
    (meeting.contentRows && meeting.contentRows.length > 0) ||
    (meeting.manualEntries && meeting.manualEntries.length > 0) ||
    (meeting.freeformMemo && meeting.freeformMemo.trim().length > 0)
  );

  const contentCountDesc = meeting.meetingRows && meeting.meetingRows.length > 0
    ? `회의록 항목: ${meeting.meetingRows.length}건`
    : meeting.contentRows && meeting.contentRows.length > 0
    ? `본문 표: ${meeting.contentRows.length}건`
    : meeting.manualEntries && meeting.manualEntries.length > 0
    ? `직접 작성 발언: ${meeting.manualEntries.length}건`
    : meeting.freeformMemo && meeting.freeformMemo.trim().length > 0
    ? '자유 메모 작성 완료'
    : '회의 내용 미작성';

  // 인쇄용 회의록 행 및 동적 컬럼 계산
  const printRows = (meeting.meetingRows && meeting.meetingRows.length > 0)
    ? meeting.meetingRows
    : (meeting.contentRows || []).map((cr, idx) => ({
        id: cr.id,
        order: idx,
        category: cr.category,
        speakerName: '',
        content: cr.content,
      }));

  const visiblePrintCols = (meeting.meetingColumns && meeting.meetingColumns.length > 0
    ? meeting.meetingColumns
    : [
        { id: 'c_cat', key: 'category', label: '구분', type: 'text' as const, visible: true, order: 0 },
        { id: 'c_spk', key: 'speakerName', label: '화자', type: 'text' as const, visible: true, order: 1 },
        { id: 'c_cnt', key: 'content', label: '회의 내용 및 심의 결과', type: 'longtext' as const, visible: true, order: 2 },
      ]
  ).filter((c) => c.visible);

  const mergeCategoryCells = meeting.meetingViewConfig?.mergeCategoryCells ?? true;
  const categoryRowSpans: Record<number, number> = {};
  if (mergeCategoryCells && printRows.length > 0) {
    let i = 0;
    while (i < printRows.length) {
      const currentCat = printRows[i].category;
      let count = 1;
      while (i + count < printRows.length && printRows[i + count].category === currentCat) {
        count++;
      }
      categoryRowSpans[i] = count;
      i += count;
    }
  }

  // 누락 검증 체크리스트 항목들
  const checklist = [
    {
      label: '회의 기본 정보 입력 (제목, 일자, 장소)',
      pass: Boolean(meeting.title && meeting.date && meeting.location),
      detail: meeting.title ? `${meeting.title} (${meeting.date})` : '제목 또는 일자 누락',
    },
    {
      label: '회의 내용(구분/내용 또는 직접 작성) 1건 이상 작성',
      pass: hasMeetingContent,
      detail: contentCountDesc,
    },
    {
      label: '참석자 명단 등록 (최소 1인 이상)',
      pass: totalAttendees > 0,
      detail: `등록된 참석자: ${totalAttendees}명`,
    },
    {
      label: '참석자 전원 전자서명 완료',
      pass: totalAttendees > 0 && signedAttendees.length === totalAttendees,
      detail: `서명 완료: ${signedAttendees.length}/${totalAttendees}명 ${
        unsignedAttendees.length > 0
          ? `(미서명: ${unsignedAttendees.map((u) => u.name).join(', ')})`
          : ''
      }`,
    },
    {
      label: '회의 현장 사진 첨부',
      pass: Boolean(meeting.photos && meeting.photos.length > 0),
      detail: `첨부된 사진: ${meeting.photos?.length || 0}장 (선택 권장사항)`,
    },
  ];

  const allMandatoryPassed = checklist.slice(0, 4).every((c) => c.pass);

  /**
   * 최종 확정 처리 (스냅샷 동결 저장)
   */
  const handleFinalizeMeeting = () => {
    if (!isOwner) return;
    logger.info('handleFinalizeMeeting called');

    const now = new Date().toISOString();
    // 현재 회의 데이터 전체 스냅샷 생성
    const snapshotJson = JSON.stringify(meeting);

    onUpdateMeeting({
      status: 'finalized',
      finalizedAt: now,
      finalizedBy: currentUserId,
      snapshotData: snapshotJson,
    });
    onSave();
  };

  /**
   * 확정 취소 및 재작성 모드 복원 (소유자 전용)
   */
  const handleUnfinalizeMeeting = () => {
    if (!isOwner) return;
    logger.info('handleUnfinalizeMeeting called');

    onUpdateMeeting({
      status: 'review',
      finalizedAt: undefined,
      finalizedBy: undefined,
    });
    onSave();
  };

  /**
   * 브라우저 기본 인쇄/PDF 저장 대화상자 호출
   */
  const handlePrint = () => {
    logger.info('handlePrint called', { orientation: printOrientation });
    window.print();
  };

  return (
    <div className="space-y-8">
      {/* 1. 확정 상태 및 누락 체크리스트 카드 (인쇄 시 숨김 no-print) */}
      <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-6 space-y-6 no-print">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-slate-100 pb-4">
          <div>
            <div className="flex items-center space-x-2">
              <FileCheck className="w-5 h-5 text-blue-600" />
              <h4 className="text-base font-bold text-slate-900">최종 회의록 확정 및 서명 검증</h4>
            </div>
            <p className="text-xs text-slate-500 mt-0.5">
              산업안전보건법 및 전자서명 요건에 따라 모든 참석자 서명과 내용을 확인한 후 동결합니다.
            </p>
          </div>

          <div className="flex items-center space-x-2">
            {isFinalized ? (
              <div className="flex items-center space-x-2">
                <span className="px-3 py-1.5 bg-emerald-50 text-emerald-700 border border-emerald-300 rounded-lg text-xs font-bold flex items-center">
                  <Lock className="w-3.5 h-3.5 mr-1" />
                  최종 확정 완료 ({formatKoreanDateTime(meeting.finalizedAt || '')})
                </span>
                {isOwner && (
                  <button
                    type="button"
                    onClick={handleUnfinalizeMeeting}
                    className="px-3 py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-semibold rounded-lg transition-colors flex items-center"
                    title="오타 수정 등을 위한 확정 잠금 해제"
                  >
                    <Unlock className="w-3.5 h-3.5 mr-1" />
                    <span>확정 해제</span>
                  </button>
                )}
              </div>
            ) : (
              isOwner && (
                <button
                  type="button"
                  onClick={handleFinalizeMeeting}
                  disabled={!allMandatoryPassed}
                  className="flex items-center space-x-1.5 px-4 py-2 bg-emerald-600 hover:bg-emerald-500 active:bg-emerald-700 text-white text-xs font-bold rounded-lg shadow-sm transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  <Lock className="w-3.5 h-3.5" />
                  <span>회의록 최종 확정</span>
                </button>
              )
            )}
          </div>
        </div>

        {/* 누락 검증 체크리스트 */}
        <div className="space-y-3">
          <h5 className="text-xs font-bold text-slate-800">회의록 작성 완료 사전 점검 항목</h5>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {checklist.map((item, idx) => (
              <div
                key={idx}
                className={`p-3 rounded-lg border text-xs flex items-start space-x-2.5 ${
                  item.pass
                    ? 'bg-emerald-50/60 border-emerald-200 text-emerald-950'
                    : 'bg-amber-50/60 border-amber-200 text-amber-950'
                }`}
              >
                {item.pass ? (
                  <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0 mt-0.5" />
                ) : (
                  <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
                )}
                <div>
                  <span className="font-bold">{item.label}</span>
                  <p className="text-[11px] text-slate-600 mt-0.5">{item.detail}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* 2. 인쇄 및 PDF 저장 제어 툴바 (no-print) */}
      <div className="bg-slate-900 text-white rounded-xl shadow-lg p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-4 no-print">
        <div>
          <h4 className="text-sm font-bold flex items-center">
            <Printer className="w-4 h-4 mr-2 text-blue-400" />
            A4 표준 규격 회의록 인쇄 및 PDF 저장
          </h4>
          <p className="text-xs text-slate-400 mt-0.5">
            아래 미리보기 양식은 브라우저 인쇄 규격(A4)에 맞추어 표 줄바꿈과 서명이 완벽하게 정렬됩니다.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          {/* 사진 인쇄 포함 토글 */}
          <label className="flex items-center space-x-1.5 text-xs text-slate-300 cursor-pointer select-none">
            <input
              type="checkbox"
              checked={includePhotosInPrint}
              onChange={(e) => setIncludePhotosInPrint(e.target.checked)}
              className="w-3.5 h-3.5 text-blue-600 rounded"
            />
            <span>첨부 사진 인쇄 포함</span>
          </label>

          {/* 세로 / 가로 전환 */}
          <div className="flex bg-slate-800 p-1 rounded-lg border border-slate-700 text-xs">
            <button
              type="button"
              onClick={() => setPrintOrientation('portrait')}
              className={`px-2.5 py-1 rounded font-semibold transition-colors ${
                printOrientation === 'portrait'
                  ? 'bg-blue-600 text-white'
                  : 'text-slate-400 hover:text-white'
              }`}
            >
              A4 세로
            </button>
            <button
              type="button"
              onClick={() => setPrintOrientation('landscape')}
              className={`px-2.5 py-1 rounded font-semibold transition-colors ${
                printOrientation === 'landscape'
                  ? 'bg-blue-600 text-white'
                  : 'text-slate-400 hover:text-white'
              }`}
            >
              A4 가로
            </button>
          </div>

          {/* 인쇄 호출 버튼 */}
          <button
            type="button"
            onClick={handlePrint}
            className="flex items-center space-x-2 px-5 py-2 bg-blue-600 hover:bg-blue-500 active:bg-blue-700 text-white text-xs font-bold rounded-lg shadow-md transition-colors"
          >
            <Printer className="w-4 h-4" />
            <span>회의록 인쇄 / PDF 저장</span>
          </button>
        </div>
      </div>

      {/* 3. A4 인쇄 전용 회의록 렌더링 영역 (화면에서는 종이처럼 미리보기로 보이고, 인쇄 시 본 양식이 출력됨) */}
      <div
        id="printable-meeting-document"
        className={`print-page-container mx-auto bg-white border border-slate-300 shadow-xl p-8 sm:p-12 text-slate-900 ${
          printOrientation === 'landscape' ? 'max-w-5xl' : 'max-w-4xl'
        }`}
      >
        {/* 양식 대제목 */}
        <div className="text-center border-b-2 border-slate-900 pb-4 mb-6">
          <h1 className="text-2xl sm:text-3xl font-bold tracking-tight text-slate-900">
            {meeting.title || '회 의 록'}
          </h1>
          <p className="text-xs text-slate-600 mt-1">
            {meeting.department ? `${meeting.department} 공식 회의록` : '공식 회의록'}
          </p>
        </div>

        {/* 1. 기본 개요 표 */}
        <table className="w-full border-collapse border border-slate-900 text-xs mb-6">
          <tbody>
            <tr>
              <th className="border border-slate-900 bg-slate-100 p-2 text-center w-28 font-bold">
                회의 일시
              </th>
              <td className="border border-slate-900 p-2">
                {formatKoreanDate(meeting.date)} {meeting.startTime && `(${meeting.startTime} ~ ${meeting.endTime})`}
              </td>
              <th className="border border-slate-900 bg-slate-100 p-2 text-center w-28 font-bold">
                회의 장소
              </th>
              <td className="border border-slate-900 p-2">{meeting.location || '-'}</td>
            </tr>
            <tr>
              <th className="border border-slate-900 bg-slate-100 p-2 text-center font-bold">
                사업장 / 부서
              </th>
              <td className="border border-slate-900 p-2">{meeting.department || '-'}</td>
              <th className="border border-slate-900 bg-slate-100 p-2 text-center font-bold">
                작성자 (간사)
              </th>
              <td className="border border-slate-900 p-2">{meeting.author || '-'}</td>
            </tr>
            {meeting.agenda && (
              <tr>
                <th className="border border-slate-900 bg-slate-100 p-2 text-center font-bold align-top">
                  회의 안건
                </th>
                <td colSpan={3} className="border border-slate-900 p-2 whitespace-pre-wrap leading-relaxed">
                  {meeting.agenda}
                </td>
              </tr>
            )}
          </tbody>
        </table>

        {/* 2. 참석자 명단 및 서명 확인 표 */}
        <div className="avoid-break mb-6">
          <h2 className="text-sm font-bold text-slate-900 mb-2 flex items-center">
            ■ 회의 참석자 및 서명 확인 (총 {meeting.attendees.length}인)
          </h2>
          <table className="w-full border-collapse border border-slate-900 text-xs text-center">
            <thead>
              <tr className="bg-slate-100 font-bold">
                <th className="border border-slate-900 p-2 w-12">순번</th>
                <th className="border border-slate-900 p-2 w-28">구분 (직책)</th>
                <th className="border border-slate-900 p-2 w-28">성명</th>
                <th className="border border-slate-900 p-2">소속 / 직위</th>
                <th className="border border-slate-900 p-2 w-32">전자서명</th>
              </tr>
            </thead>
            <tbody>
              {meeting.attendees.map((att, idx) => {
                const latestSig = att.signatures?.[att.signatures.length - 1];
                return (
                  <tr key={att.id}>
                    <td className="border border-slate-900 p-2">{idx + 1}</td>
                    <td className="border border-slate-900 p-2 font-semibold">{att.role || '-'}</td>
                    <td className="border border-slate-900 p-2 font-bold">{att.name}</td>
                    <td className="border border-slate-900 p-2 text-left px-3">
                      {att.affiliation} {att.position && `(${att.position})`}
                    </td>
                    <td className="border border-slate-900 p-1">
                      {latestSig ? (
                        <div className="flex flex-col items-center justify-center">
                          <img
                            src={latestSig.imageUrl}
                            alt={`${att.name} 서명`}
                            className="h-8 object-contain"
                          />
                          <span className="text-[9px] text-slate-400 font-mono">
                            {formatKoreanDateTime(latestSig.signedAt)}
                          </span>
                        </div>
                      ) : (
                        <span className="text-slate-400">(인)</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        {/* 3. 회의 내용 및 심의 결과 표 (범용 회의록 표) */}
        <div className="mb-6">
          <h2 className="text-sm font-bold text-slate-900 mb-2">
            ■ 회의 내용 및 심의·의결 결과
          </h2>
          <table className="w-full border-collapse border border-slate-900 text-xs">
            <thead>
              <tr className="bg-slate-100 font-bold text-center">
                {visiblePrintCols.map((col) => (
                  <th
                    key={col.id}
                    style={{ width: col.width || 'auto' }}
                    className="border border-slate-900 p-2"
                  >
                    {col.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {printRows.length > 0 ? (
                printRows.map((row, idx) => {
                  const shouldRenderCategory = !mergeCategoryCells || categoryRowSpans[idx] !== undefined;
                  const rowSpan = mergeCategoryCells ? categoryRowSpans[idx] : 1;

                  return (
                    <tr key={row.id}>
                      {visiblePrintCols.map((col) => {
                        // 구분(Category) 셀 병합 처리
                        if (col.key === 'category') {
                          if (!shouldRenderCategory) return null;
                          return (
                            <td
                              key={col.id}
                              rowSpan={rowSpan}
                              className="border border-slate-900 p-2.5 font-bold text-slate-800 align-top text-center"
                            >
                              {row.category}
                            </td>
                          );
                        }

                        // 화자(Speaker)
                        if (col.key === 'speakerName') {
                          return (
                            <td
                              key={col.id}
                              className="border border-slate-900 p-2.5 align-top font-semibold text-center whitespace-nowrap"
                            >
                              {row.speakerName || '-'}
                            </td>
                          );
                        }

                        // 회의 내용(Content)
                        if (col.key === 'content') {
                          return (
                            <td
                              key={col.id}
                              className="border border-slate-900 p-2.5 whitespace-pre-wrap leading-relaxed align-top"
                            >
                              {row.content}
                            </td>
                          );
                        }

                        // 상위 안건
                        if (col.key === 'agendaTitle') {
                          return (
                            <td
                              key={col.id}
                              className="border border-slate-900 p-2.5 align-top text-center"
                            >
                              {row.agendaTitle || '-'}
                            </td>
                          );
                        }

                        // 결정사항
                        if (col.key === 'decision') {
                          return (
                            <td
                              key={col.id}
                              className="border border-slate-900 p-2.5 align-top font-semibold"
                            >
                              {row.decision || '-'}
                            </td>
                          );
                        }

                        // 조치과제
                        if (col.key === 'actionItemTask') {
                          return (
                            <td
                              key={col.id}
                              className="border border-slate-900 p-2.5 align-top"
                            >
                              {row.actionItemTask || '-'}
                            </td>
                          );
                        }

                        // 담당자
                        if (col.key === 'assignee') {
                          return (
                            <td
                              key={col.id}
                              className="border border-slate-900 p-2.5 align-top text-center whitespace-nowrap"
                            >
                              {row.assignee || '-'}
                            </td>
                          );
                        }

                        // 기한
                        if (col.key === 'dueDate') {
                          return (
                            <td
                              key={col.id}
                              className="border border-slate-900 p-2.5 align-top text-center whitespace-nowrap font-mono"
                            >
                              {row.dueDate || '-'}
                            </td>
                          );
                        }

                        // 사용자 정의 컬럼
                        const customVal = row.customFields?.[col.key];
                        return (
                          <td
                            key={col.id}
                            className="border border-slate-900 p-2.5 align-top"
                          >
                            {customVal !== undefined && customVal !== null
                              ? typeof customVal === 'boolean'
                                ? customVal
                                  ? '✓'
                                  : '-'
                                : String(customVal)
                              : '-'}
                          </td>
                        );
                      })}
                    </tr>
                  );
                })
              ) : meeting.manualEntries && meeting.manualEntries.length > 0 ? (
                meeting.manualEntries.map((entry) => (
                  <tr key={entry.id}>
                    <td className="border border-slate-900 p-2.5 font-bold text-slate-800 align-top text-center">
                      {entry.speakerName}
                    </td>
                    <td
                      colSpan={visiblePrintCols.length > 1 ? visiblePrintCols.length - 1 : 1}
                      className="border border-slate-900 p-2.5 whitespace-pre-wrap leading-relaxed"
                    >
                      {entry.text}
                    </td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td
                    colSpan={visiblePrintCols.length || 2}
                    className="border border-slate-900 p-4 text-center text-slate-400"
                  >
                    기록된 회의 내용이 없습니다.
                  </td>
                </tr>
              )}
            </tbody>
          </table>

          {/* 직접 작성 자유 메모가 있는 경우 함께 출력 */}
          {meeting.freeformMemo && meeting.freeformMemo.trim().length > 0 && (
            <div className="mt-3 border border-slate-900 p-3 text-xs">
              <h3 className="font-bold text-slate-800 mb-1.5">[회의 메모 및 비고]</h3>
              <p className="whitespace-pre-wrap leading-relaxed text-slate-900">
                {meeting.freeformMemo}
              </p>
            </div>
          )}
        </div>

        {/* 4. 확정 결정 사항 및 후속 조치 요약 표 (AI Action Items + 직접 작성 Action Items 결합) */}
        {((meeting.summary && meeting.summary.actionItems && meeting.summary.actionItems.length > 0) ||
          (meeting.manualActionItems && meeting.manualActionItems.length > 0)) && (
          <div className="avoid-break mb-6">
            <h2 className="text-sm font-bold text-slate-900 mb-2">
              ■ 후속 조치 과제 (Action Items)
            </h2>
            <table className="w-full border-collapse border border-slate-900 text-xs">
              <thead>
                <tr className="bg-slate-100 font-bold text-center">
                  <th className="border border-slate-900 p-2">할 일 (과제)</th>
                  <th className="border border-slate-900 p-2 w-28">담당자</th>
                  <th className="border border-slate-900 p-2 w-28">완료 기한</th>
                  <th className="border border-slate-900 p-2 w-20">상태</th>
                </tr>
              </thead>
              <tbody>
                {/* 수동 등록 후속 과제 */}
                {(meeting.manualActionItems || []).map((mAct) => (
                  <tr key={mAct.id} className="bg-purple-50/20">
                    <td className="border border-slate-900 p-2">
                      <span className="font-semibold text-slate-900">{mAct.task}</span>
                    </td>
                    <td className="border border-slate-900 p-2 text-center">{mAct.assignee || '-'}</td>
                    <td className="border border-slate-900 p-2 text-center">{mAct.dueDate || '-'}</td>
                    <td className="border border-slate-900 p-2 text-center font-semibold">
                      {mAct.status === 'completed'
                        ? '완료'
                        : mAct.status === 'in_progress'
                        ? '진행중'
                        : '대기'}
                    </td>
                  </tr>
                ))}
                {/* AI 도출 후속 과제 */}
                {(meeting.summary?.actionItems || []).map((act) => (
                  <tr key={act.id}>
                    <td className="border border-slate-900 p-2">{act.task}</td>
                    <td className="border border-slate-900 p-2 text-center">{act.assignee || '-'}</td>
                    <td className="border border-slate-900 p-2 text-center">{act.dueDate || '-'}</td>
                    <td className="border border-slate-900 p-2 text-center font-semibold">
                      {act.status === 'completed'
                        ? '완료'
                        : act.status === 'in_progress'
                        ? '진행중'
                        : '대기'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {/* 5. 첨부 서류: 회의 사진 (인쇄 포함 체크된 경우 2열 그리드로 출력) */}
        {includePhotosInPrint && meeting.photos && meeting.photos.length > 0 && (
          <div className="page-break-before pt-6">
            <h2 className="text-sm font-bold text-slate-900 mb-3">
              [첨부] 회의 및 현장 점검 사진 (총 {meeting.photos.length}장)
            </h2>
            <div className="grid grid-cols-2 gap-4">
              {meeting.photos.map((photo, idx) => (
                <div
                  key={photo.id}
                  className="border border-slate-400 p-2 flex flex-col items-center avoid-break"
                >
                  <div className="h-44 w-full bg-slate-50 flex items-center justify-center overflow-hidden mb-2">
                    <img
                      src={photo.downloadUrl}
                      alt={photo.caption}
                      referrerPolicy="no-referrer"
                      style={{ transform: `rotate(${photo.rotation || 0}deg)` }}
                      className="max-h-full max-w-full object-contain"
                    />
                  </div>
                  <div className="text-xs font-semibold text-slate-800 text-center">
                    [사진 {idx + 1}] {photo.caption}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* 양식 하단 확정 서약문 */}
        <div className="mt-12 text-center avoid-break space-y-4">
          <p className="text-xs text-slate-700">
            위와 같이 회의를 개최하고 그 결과를 명확히 기록하여 참석자 전원의 확인 및 서명을 완료하였음을 증명합니다.
          </p>
          <div className="text-sm font-bold text-slate-900">
            {formatKoreanDate(meeting.date || new Date().toISOString())}
          </div>
          <div className="text-base font-bold text-slate-900">
            {meeting.department || '남부권역 위험성평가 위원회'}
          </div>
        </div>
      </div>
    </div>
  );
};
