/**
 * @file src/components/meeting/transcript/AiCorrectionReviewModal.tsx
 * @description 대화록 AI 문맥 검토 및 오타 교정 모달 컴포넌트.
 * 회의 전체 문맥(안건, 제목, 부서, 참석자 명단, 전문용어 사전)을 기반으로
 * 음성인식 유사음 오류 및 오탈자를 분석하여 사전-사후 Diff 비교 뷰를 제공합니다.
 * 
 * 주요 기능:
 * 1. 3단계 교정 강도 선택 (최소 교정 / 문맥 교정 / 회의록 문체 정리)
 * 2. 사용자 수정 문장 보호 옵션
 * 3. 원문 vs 교정안 Side-by-Side Diff 뷰 및 수정 사유 안내
 * 4. 불확실 구간 [확인 필요] 경고 표시
 * 5. 선택 적용 / 전체 적용 / 개별 승인/반려 관리
 */

import React, { useState } from 'react';
import {
  Sparkles,
  X,
  Check,
  RotateCcw,
  AlertCircle,
  BookOpen,
  ArrowRight,
  ShieldCheck,
  CheckCheck,
} from 'lucide-react';
import { Meeting, TranscriptSegment } from '../../../types/meeting';
import {
  CorrectionLevel,
  SegmentCorrectionProposal,
  requestTranscriptContextCorrection,
  applyCorrectionsToTranscripts,
} from '../../../services/transcriptCorrectionClientService';
import { logger } from '../../../utils/logger';

interface AiCorrectionReviewModalProps {
  isOpen: boolean;
  onClose: () => void;
  meeting: Meeting;
  uniqueSpeakers: string[];
  getSpeakerDisplayName: (speakerId: string) => string;
  onUpdateMeeting: (updates: Partial<Meeting>) => void;
  onOpenCustomTerms: () => void;
  isReadOnly?: boolean;
}

/**
 * AI 문맥 교정 검토 모달
 */
export const AiCorrectionReviewModal: React.FC<AiCorrectionReviewModalProps> = ({
  isOpen,
  onClose,
  meeting,
  uniqueSpeakers,
  getSpeakerDisplayName,
  onUpdateMeeting,
  onOpenCustomTerms,
  isReadOnly = false,
}) => {
  // 설정 상태
  const [correctionLevel, setCorrectionLevel] = useState<CorrectionLevel>('context');
  const [targetSpeakerFilter, setTargetSpeakerFilter] = useState<string>('all');
  const [excludeUserEdited, setExcludeUserEdited] = useState<boolean>(true);

  // 실행 상태
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [proposals, setProposals] = useState<SegmentCorrectionProposal[] | null>(null);
  const [selectedProposalIds, setSelectedProposalIds] = useState<Set<string>>(new Set());
  const [summaryMessage, setSummaryMessage] = useState<string>('');
  const [executedModel, setExecutedModel] = useState<string>('');

  if (!isOpen) return null;

  /**
   * AI 문맥 교정 요청 실행
   */
  const handleExecuteCorrection = async () => {
    logger.info('handleExecuteCorrection clicked', {
      level: correctionLevel,
      filter: targetSpeakerFilter,
      excludeUserEdited,
    });

    setIsLoading(true);
    setErrorMessage(null);

    try {
      // 대상 세그먼트 필터링
      let candidateSegments = meeting.transcripts || [];
      if (targetSpeakerFilter !== 'all') {
        candidateSegments = candidateSegments.filter((s) => s.speakerId === targetSpeakerFilter);
      }

      if (candidateSegments.length === 0) {
        throw new Error('교정할 대상 발언이 없습니다.');
      }

      const response = await requestTranscriptContextCorrection({
        meetingId: meeting.id,
        meetingTitle: meeting.title,
        agenda: meeting.agenda,
        department: meeting.department,
        attendees: meeting.attendees,
        customTerms: meeting.customTerms,
        segments: candidateSegments,
        correctionLevel,
        excludeUserEdited,
      });

      // 변경 사항이 있는 제안만 필터링
      const changedProposals = response.proposals.filter((p) => p.hasChanges);
      setProposals(changedProposals);
      setSummaryMessage(response.summaryMessage);
      setExecutedModel(response.model);

      // 기본적으로 모든 변경 제안 선택
      const allIds = new Set(changedProposals.map((p) => p.segmentId));
      setSelectedProposalIds(allIds);
    } catch (err: any) {
      logger.error('handleExecuteCorrection failed', err);
      setErrorMessage(err.message || 'AI 문맥 교정 실행 중 오류가 발생했습니다.');
    } finally {
      setIsLoading(false);
    }
  };

  /**
   * 개별 제안 선택 토글
   */
  const handleToggleSelect = (segmentId: string) => {
    const next = new Set(selectedProposalIds);
    if (next.has(segmentId)) {
      next.delete(segmentId);
    } else {
      next.add(segmentId);
    }
    setSelectedProposalIds(next);
  };

  /**
   * 전체 제안 선택 / 해제
   */
  const handleToggleSelectAll = () => {
    if (!proposals) return;
    if (selectedProposalIds.size === proposals.length) {
      setSelectedProposalIds(new Set());
    } else {
      setSelectedProposalIds(new Set(proposals.map((p) => p.segmentId)));
    }
  };

  /**
   * 선택된 교정안들을 회의 대화록에 최종 적용
   */
  const handleApplySelected = () => {
    if (!proposals || selectedProposalIds.size === 0) return;

    logger.info('handleApplySelected clicked', { count: selectedProposalIds.size });

    const proposalMap = new Map<string, SegmentCorrectionProposal>();
    proposals.forEach((p) => proposalMap.set(p.segmentId, p));

    const updated = applyCorrectionsToTranscripts(
      meeting.transcripts || [],
      selectedProposalIds,
      proposalMap
    );

    onUpdateMeeting({ transcripts: updated });
    onClose();
  };

  /**
   * 모달 닫기 시 상태 초기화
   */
  const handleClose = () => {
    setProposals(null);
    setSelectedProposalIds(new Set());
    setErrorMessage(null);
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 backdrop-blur-xs">
      <div className="bg-white rounded-xl shadow-2xl max-w-3xl w-full border border-slate-200 overflow-hidden flex flex-col max-h-[92vh]">
        {/* 모달 헤더 */}
        <div className="flex items-center justify-between p-5 border-b border-slate-100 bg-slate-50">
          <div className="flex items-center space-x-2.5">
            <div className="w-8 h-8 rounded-lg bg-blue-100 flex items-center justify-center text-blue-600">
              <Sparkles className="w-4 h-4" />
            </div>
            <div>
              <div className="flex items-center space-x-2">
                <h3 className="text-base font-bold text-slate-900">AI 문맥 검토 및 오타 교정</h3>
                {executedModel && (
                  <span className="px-2 py-0.5 bg-blue-100 text-blue-800 text-[10px] font-mono rounded-full">
                    {executedModel}
                  </span>
                )}
              </div>
              <p className="text-xs text-slate-500 mt-0.5">
                회의 안건 및 전문용어를 기반으로 음성인식 오류를 분석하고 정밀 교정안을 제안합니다.
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={handleClose}
            className="text-slate-400 hover:text-slate-600 p-1.5 rounded-lg hover:bg-slate-200/60 transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* 모달 본문 */}
        <div className="p-5 space-y-5 overflow-y-auto flex-1 text-sm">
          {/* 오류 메시지 */}
          {errorMessage && (
            <div className="p-3 bg-red-50 border border-red-200 rounded-lg text-xs text-red-700 flex items-start space-x-2">
              <AlertCircle className="w-4 h-4 text-red-600 shrink-0 mt-0.5" />
              <span>{errorMessage}</span>
            </div>
          )}

          {/* 1. 분석 전 설정 영역 */}
          {!proposals && (
            <div className="space-y-4">
              {/* 교정 강도 선택 */}
              <div className="space-y-2">
                <label className="text-xs font-bold text-slate-700 block">교정 강도 수준</label>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
                  <button
                    type="button"
                    onClick={() => setCorrectionLevel('minimal')}
                    className={`p-3 text-left rounded-xl border transition-all ${
                      correctionLevel === 'minimal'
                        ? 'border-blue-500 bg-blue-50/50 ring-1 ring-blue-500'
                        : 'border-slate-200 hover:border-slate-300 bg-white'
                    }`}
                  >
                    <div className="text-xs font-bold text-slate-900">1단계: 최소 교정</div>
                    <p className="text-[11px] text-slate-500 mt-1">
                      맞춤법, 띄어쓰기, 문장 부호 오류만 최소한으로 정리합니다.
                    </p>
                  </button>

                  <button
                    type="button"
                    onClick={() => setCorrectionLevel('context')}
                    className={`p-3 text-left rounded-xl border transition-all ${
                      correctionLevel === 'context'
                        ? 'border-blue-500 bg-blue-50/50 ring-1 ring-blue-500'
                        : 'border-slate-200 hover:border-slate-300 bg-white'
                    }`}
                  >
                    <div className="text-xs font-bold text-blue-700 flex items-center justify-between">
                      <span>2단계: 문맥 교정</span>
                      <span className="text-[10px] px-1.5 py-0.5 bg-blue-600 text-white rounded font-medium">
                        추천
                      </span>
                    </div>
                    <p className="text-[11px] text-slate-500 mt-1">
                      음성인식 유사음 오류를 회의 문맥 및 전문용어에 맞춰 자연스럽게 교정합니다.
                    </p>
                  </button>

                  <button
                    type="button"
                    onClick={() => setCorrectionLevel('formal')}
                    className={`p-3 text-left rounded-xl border transition-all ${
                      correctionLevel === 'formal'
                        ? 'border-blue-500 bg-blue-50/50 ring-1 ring-blue-500'
                        : 'border-slate-200 hover:border-slate-300 bg-white'
                    }`}
                  >
                    <div className="text-xs font-bold text-slate-900">3단계: 회의록 문체</div>
                    <p className="text-[11px] text-slate-500 mt-1">
                      발언 의미를 보존하며 구어체와 말버릇을 정돈된 회의록 문장으로 다듬습니다.
                    </p>
                  </button>
                </div>
              </div>

              {/* 필터 및 옵션 */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 p-4 bg-slate-50 rounded-xl border border-slate-200">
                <div>
                  <label className="text-xs font-semibold text-slate-700 block mb-1">
                    교정 대상 화자
                  </label>
                  <select
                    value={targetSpeakerFilter}
                    onChange={(e) => setTargetSpeakerFilter(e.target.value)}
                    className="w-full text-xs p-2 bg-white border border-slate-300 rounded-lg focus:ring-1 focus:ring-blue-500 font-medium"
                  >
                    <option value="all">전체 화자 발언 ({meeting.transcripts?.length || 0}개)</option>
                    {uniqueSpeakers.map((id) => (
                      <option key={id} value={id}>
                        {getSpeakerDisplayName(id)}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="flex flex-col justify-end">
                  <label className="inline-flex items-center space-x-2 text-xs text-slate-700 font-medium cursor-pointer p-2 bg-white border border-slate-200 rounded-lg">
                    <input
                      type="checkbox"
                      checked={excludeUserEdited}
                      onChange={(e) => setExcludeUserEdited(e.target.checked)}
                      className="rounded text-blue-600 focus:ring-blue-500 w-4 h-4"
                    />
                    <span>사용자가 이미 수정한 문장 제외</span>
                  </label>
                </div>
              </div>

              {/* 전문용어 사전 안내 */}
              <div className="flex items-center justify-between p-3.5 bg-blue-50/60 border border-blue-100 rounded-xl">
                <div className="flex items-center space-x-2.5">
                  <ShieldCheck className="w-4 h-4 text-blue-600 shrink-0" />
                  <div className="text-xs text-blue-900">
                    <span className="font-semibold">보호 대상 전문용어: </span>
                    <span>
                      {meeting.customTerms && meeting.customTerms.length > 0
                        ? `${meeting.customTerms.slice(0, 3).join(', ')} 등 ${meeting.customTerms.length}개 등록됨`
                        : '기본 산업안전 전문용어 자동 보호 적용'}
                    </span>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={onOpenCustomTerms}
                  className="inline-flex items-center space-x-1 text-xs text-blue-700 hover:text-blue-900 font-semibold underline shrink-0 ml-2"
                >
                  <BookOpen className="w-3.5 h-3.5" />
                  <span>사전 관리</span>
                </button>
              </div>

              {/* 실행 버튼 */}
              <div className="pt-3 flex justify-center">
                <button
                  type="button"
                  disabled={isLoading || isReadOnly}
                  onClick={handleExecuteCorrection}
                  className="inline-flex items-center space-x-2 px-6 py-2.5 bg-blue-600 hover:bg-blue-700 disabled:bg-slate-300 text-white text-xs font-bold rounded-xl shadow-md hover:shadow-lg transition-all"
                >
                  {isLoading ? (
                    <>
                      <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                      <span>회의 문맥 분석 및 교정안 생성 중...</span>
                    </>
                  ) : (
                    <>
                      <Sparkles className="w-4 h-4" />
                      <span>AI 문맥 분석 및 교정 시작</span>
                    </>
                  )}
                </button>
              </div>
            </div>
          )}

          {/* 2. 교정 결과 검토 화면 (Diff View) */}
          {proposals && (
            <div className="space-y-4">
              {/* 상단 툴바: 통계 및 일괄 선택 */}
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 p-3 bg-slate-50 border border-slate-200 rounded-xl">
                <div className="flex items-center space-x-2">
                  <span className="text-xs font-bold text-slate-800">
                    교정 제안: 총 {proposals.length}건
                  </span>
                  <span className="text-[11px] text-slate-500">
                    ({selectedProposalIds.size}건 선택됨)
                  </span>
                </div>

                <div className="flex items-center space-x-2">
                  <button
                    type="button"
                    onClick={handleToggleSelectAll}
                    className="text-xs text-blue-600 hover:text-blue-800 font-medium"
                  >
                    {selectedProposalIds.size === proposals.length ? '선택 해제' : '전체 선택'}
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setProposals(null);
                      setSelectedProposalIds(new Set());
                    }}
                    className="inline-flex items-center space-x-1 text-xs text-slate-600 hover:text-slate-800 font-medium ml-2"
                  >
                    <RotateCcw className="w-3 h-3" />
                    <span>조건 재설정</span>
                  </button>
                </div>
              </div>

              {summaryMessage && (
                <p className="text-xs text-slate-600 px-1">{summaryMessage}</p>
              )}

              {/* 제안 목록 (Diff 카드들) */}
              {proposals.length === 0 ? (
                <div className="p-10 text-center text-slate-500 bg-slate-50 rounded-xl border border-slate-200">
                  <CheckCheck className="w-8 h-8 text-emerald-500 mx-auto mb-2" />
                  <p className="text-xs font-bold text-slate-800">수정이 필요한 오탈자가 발견되지 않았습니다.</p>
                  <p className="text-[11px] text-slate-500 mt-1">대화록이 이미 정확하거나 깨끗합니다.</p>
                </div>
              ) : (
                <div className="space-y-3 max-h-[460px] overflow-y-auto pr-1">
                  {proposals.map((prop) => {
                    const isChecked = selectedProposalIds.has(prop.segmentId);
                    const seg = meeting.transcripts?.find((s) => s.id === prop.segmentId);
                    const speakerLabel = seg ? getSpeakerDisplayName(seg.speakerId) : '화자';

                    return (
                      <div
                        key={prop.segmentId}
                        className={`p-4 rounded-xl border transition-all ${
                          isChecked
                            ? 'border-blue-300 bg-blue-50/20'
                            : 'border-slate-200 bg-white opacity-70'
                        }`}
                      >
                        {/* 카드 헤더: 체크박스 + 화자 + 태그 */}
                        <div className="flex items-center justify-between gap-2 mb-2.5">
                          <label className="flex items-center space-x-2 cursor-pointer">
                            <input
                              type="checkbox"
                              checked={isChecked}
                              onChange={() => handleToggleSelect(prop.segmentId)}
                              className="rounded text-blue-600 focus:ring-blue-500 w-4 h-4"
                            />
                            <span className="text-xs font-bold text-slate-900 font-mono">
                              {speakerLabel}
                            </span>
                          </label>

                          <div className="flex items-center space-x-1.5">
                            {prop.isUncertain && (
                              <span className="inline-flex items-center space-x-1 px-2 py-0.5 bg-amber-100 text-amber-800 text-[10px] font-bold rounded-full">
                                <AlertCircle className="w-3 h-3" />
                                <span>확인 필요</span>
                              </span>
                            )}
                            <span className="text-[11px] px-2 py-0.5 bg-slate-100 text-slate-700 rounded-md font-medium">
                              {prop.reason}
                            </span>
                          </div>
                        </div>

                        {/* 사전-사후 비교 (Diff) */}
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-1 text-xs">
                          {/* 원문 */}
                          <div className="p-2.5 bg-rose-50/50 border border-rose-100 rounded-lg">
                            <div className="text-[10px] font-semibold text-rose-700 mb-1">
                              AI 전사 원문
                            </div>
                            <p className="text-slate-700 line-through leading-relaxed">
                              {prop.originalText}
                            </p>
                          </div>

                          {/* 교정안 */}
                          <div className="p-2.5 bg-emerald-50/60 border border-emerald-200 rounded-lg">
                            <div className="text-[10px] font-semibold text-emerald-800 mb-1 flex items-center justify-between">
                              <span>추천 교정안</span>
                              <ArrowRight className="w-3 h-3 text-emerald-600 inline" />
                            </div>
                            <p className="text-slate-900 font-medium leading-relaxed">
                              {prop.correctedText}
                            </p>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}
        </div>

        {/* 모달 푸터 */}
        <div className="p-4 border-t border-slate-100 bg-slate-50 flex items-center justify-between">
          <button
            type="button"
            onClick={handleClose}
            className="px-4 py-2 text-xs font-semibold text-slate-600 hover:bg-slate-200 rounded-lg transition-colors"
          >
            취소 및 닫기
          </button>

          {proposals && proposals.length > 0 && !isReadOnly && (
            <div className="flex items-center space-x-2">
              <button
                type="button"
                disabled={selectedProposalIds.size === 0}
                onClick={handleApplySelected}
                className="inline-flex items-center space-x-1.5 px-4 py-2 bg-blue-600 hover:bg-blue-700 disabled:bg-slate-300 text-white text-xs font-bold rounded-lg shadow-2xs transition-colors"
              >
                <Check className="w-4 h-4" />
                <span>선택 교정안 적용 ({selectedProposalIds.size}건)</span>
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
