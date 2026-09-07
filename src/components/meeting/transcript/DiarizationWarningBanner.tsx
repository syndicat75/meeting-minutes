/**
 * @file src/components/meeting/transcript/DiarizationWarningBanner.tsx
 * @description 비정상적인 화자 과다 분리 감지 시 표시되는 경고 배너 컴포넌트.
 * 짧은 녹음(예: 60초 이내)에서 3명 이상의 화자가 분리된 경우,
 * 원클릭 단일 화자 통합 또는 화자 관리 모달을 안내하여 사용자 혼란을 방지합니다.
 */

import React, { useState } from 'react';
import { AlertTriangle, Combine, Users, X } from 'lucide-react';
import { logger } from '../../../utils/logger';

interface DiarizationWarningBannerProps {
  durationSeconds: number;
  speakerCount: number;
  onMergeToSingle: () => void;
  onOpenSpeakerModal: () => void;
  isReadOnly?: boolean;
}

/**
 * 화자 과다 분리 경고 배너
 */
export const DiarizationWarningBanner: React.FC<DiarizationWarningBannerProps> = ({
  durationSeconds,
  speakerCount,
  onMergeToSingle,
  onOpenSpeakerModal,
  isReadOnly = false,
}) => {
  const [isDismissed, setIsDismissed] = useState(false);

  // 60초 이하 녹음에서 화자가 3명 이상인 경우 비정상 의심
  const isAbnormal = durationSeconds > 0 && durationSeconds <= 65 && speakerCount >= 3;

  if (!isAbnormal || isDismissed) {
    return null;
  }

  const handleDismiss = () => {
    logger.info('DiarizationWarningBanner dismissed');
    setIsDismissed(true);
  };

  const handleMerge = () => {
    logger.info('DiarizationWarningBanner onMergeToSingle clicked');
    onMergeToSingle();
    setIsDismissed(true);
  };

  return (
    <div className="mb-4 p-4 bg-amber-50 border border-amber-200 rounded-xl flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-amber-900 shadow-2xs animate-in fade-in">
      <div className="flex items-start space-x-3">
        <div className="p-1.5 bg-amber-100 rounded-lg text-amber-700 shrink-0 mt-0.5">
          <AlertTriangle className="w-4 h-4" />
        </div>
        <div>
          <div className="flex items-center space-x-2">
            <h4 className="text-xs font-bold text-amber-950">화자 과다 분리 감지</h4>
            <span className="px-1.5 py-0.5 bg-amber-200/80 text-amber-800 text-[10px] font-semibold rounded">
              약 {Math.round(durationSeconds)}초 &bull; {speakerCount}명 감지
            </span>
          </div>
          <p className="text-xs text-amber-800 mt-1 leading-relaxed">
            짧은 녹음 시간 대비 화자가 다수로 분리되었습니다. 1명이 연속해서 발언한 경우라면 원클릭으로 통합할 수 있습니다.
          </p>
        </div>
      </div>

      <div className="flex items-center space-x-2 shrink-0 self-end sm:self-center">
        {!isReadOnly && (
          <>
            <button
              type="button"
              onClick={handleMerge}
              className="inline-flex items-center space-x-1.5 px-3 py-1.5 bg-amber-600 hover:bg-amber-700 text-white text-xs font-semibold rounded-lg shadow-2xs transition-colors"
            >
              <Combine className="w-3.5 h-3.5" />
              <span>화자 1명으로 통합</span>
            </button>
            <button
              type="button"
              onClick={onOpenSpeakerModal}
              className="inline-flex items-center space-x-1 px-3 py-1.5 bg-white border border-amber-300 hover:bg-amber-100/50 text-amber-900 text-xs font-semibold rounded-lg transition-colors"
            >
              <Users className="w-3.5 h-3.5 text-amber-700" />
              <span>화자 관리</span>
            </button>
          </>
        )}
        <button
          type="button"
          onClick={handleDismiss}
          className="text-amber-500 hover:text-amber-800 p-1.5 rounded-lg hover:bg-amber-200/50 transition-colors"
          title="배너 닫기"
        >
          <X className="w-4 h-4" />
        </button>
      </div>
    </div>
  );
};
