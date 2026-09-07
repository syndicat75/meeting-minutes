/**
 * @file src/components/common/ConfirmModal.tsx
 * @description 작업 확인 및 경고 대화상자 컴포넌트. 회의 삭제, 최종 확정, 변경사항 덮어쓰기 전 안전하게 확인합니다.
 */

import React from 'react';
import { AlertCircle, Loader2 } from 'lucide-react';
import { logger } from '../../utils/logger';

interface ConfirmModalProps {
  isOpen: boolean;
  title: string;
  message: string;
  confirmText?: string;
  cancelText?: string;
  isDestructive?: boolean;
  isLoading?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

/**
 * 범용 작업 확인 모달 컴포넌트
 */
export const ConfirmModal: React.FC<ConfirmModalProps> = ({
  isOpen,
  title,
  message,
  confirmText = '확인',
  cancelText = '취소',
  isDestructive = false,
  isLoading = false,
  onConfirm,
  onCancel,
}) => {
  logger.debug('ConfirmModal rendered', { isOpen, title, isDestructive, isLoading });
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
      <div className="bg-white rounded-xl shadow-xl max-w-md w-full border border-slate-200 overflow-hidden animate-in fade-in zoom-in-95">
        <div className="p-6">
          <div className="flex items-center space-x-3 text-slate-900 mb-3">
            <div
              className={`p-2 rounded-lg ${
                isDestructive ? 'bg-red-100 text-red-600' : 'bg-blue-100 text-blue-600'
              }`}
            >
              <AlertCircle className="w-5 h-5" />
            </div>
            <h4 className="text-base font-bold">{title}</h4>
          </div>
          <p className="text-sm text-slate-600 leading-relaxed whitespace-pre-line">{message}</p>
        </div>

        <div className="bg-slate-50 px-6 py-3 border-t border-slate-200 flex justify-end space-x-2">
          <button
            type="button"
            onClick={onCancel}
            disabled={isLoading}
            className="px-3.5 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-200 disabled:opacity-50 rounded transition-colors"
          >
            {cancelText}
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={isLoading}
            className={`inline-flex items-center space-x-1.5 px-4 py-1.5 text-xs font-semibold text-white rounded shadow-sm transition-colors disabled:opacity-50 ${
              isDestructive
                ? 'bg-red-600 hover:bg-red-500 active:bg-red-700'
                : 'bg-blue-600 hover:bg-blue-500 active:bg-blue-700'
            }`}
          >
            {isLoading && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
            <span>{isLoading ? '처리 중...' : confirmText}</span>
          </button>
        </div>
      </div>
    </div>
  );
};
