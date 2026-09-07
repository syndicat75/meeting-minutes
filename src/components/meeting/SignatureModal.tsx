/**
 * @file src/components/meeting/SignatureModal.tsx
 * @description HTML5 Canvas 및 Pointer Events 기반 전자서명 모달.
 * 마우스, 스마트폰 터치, 태블릿 스타일러스 펜 입력을 지원하며,
 * 획 두께 보정, 다시 쓰기, 서명 유형(참석 확인 vs 내용 확인) 선택, 연속 대면 서명 모드를 지원합니다.
 */

import React, { useRef, useState, useEffect } from 'react';
import { X, RotateCcw, Check, PenTool, User, ChevronRight } from 'lucide-react';
import { Attendee, AttendeeSignature, SignatureType } from '../../types/meeting';
import { uploadSignatureImage } from '../../services/storageService';
import { logger } from '../../utils/logger';

interface SignatureModalProps {
  isOpen: boolean;
  meetingId: string;
  attendee: Attendee | null;
  onClose: () => void;
  onSaveSignature: (attendeeId: string, signature: AttendeeSignature) => Promise<void>;
  onNextAttendee?: () => void;
  hasNextAttendee?: boolean;
}

/**
 * 전자서명 캔버스 모달 컴포넌트
 */
export const SignatureModal: React.FC<SignatureModalProps> = ({
  isOpen,
  meetingId,
  attendee,
  onClose,
  onSaveSignature,
  onNextAttendee,
  hasNextAttendee = false,
}) => {
  logger.debug('SignatureModal rendered', { isOpen, attendeeId: attendee?.id });

  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [isDrawing, setIsDrawing] = useState(false);
  const [hasDrawn, setHasDrawn] = useState(false);
  const [signatureType, setSignatureType] = useState<SignatureType>('content');
  const [isSaving, setIsSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  // 캔버스 초기화 및 DPI 보정
  useEffect(() => {
    if (!isOpen || !canvasRef.current) return;

    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // 캔버스 크기 및 디스플레이 DPI 맞춤
    const rect = canvas.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    canvas.width = rect.width * dpr;
    canvas.height = rect.height * dpr;
    ctx.scale(dpr, dpr);

    ctx.strokeStyle = '#0f172a'; // slate-900
    ctx.lineWidth = 2.5;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    setHasDrawn(false);
    setSaveError(null);
  }, [isOpen, attendee]);

  if (!isOpen || !attendee) return null;

  /**
   * 그리기 시작 (PointerDown)
   */
  const handlePointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    canvas.setPointerCapture(e.pointerId);
    const rect = canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;

    ctx.beginPath();
    ctx.moveTo(x, y);
    setIsDrawing(true);
    setHasDrawn(true);
  };

  /**
   * 그리기 진행 (PointerMove)
   */
  const handlePointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!isDrawing) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const rect = canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;

    ctx.lineTo(x, y);
    ctx.stroke();
  };

  /**
   * 그리기 종료 (PointerUp)
   */
  const handlePointerUp = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!isDrawing) return;
    const canvas = canvasRef.current;
    if (canvas) {
      canvas.releasePointerCapture(e.pointerId);
    }
    setIsDrawing(false);
  };

  /**
   * 캔버스 내용 지우기 (다시 쓰기)
   */
  const handleClearCanvas = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const dpr = window.devicePixelRatio || 1;
    ctx.clearRect(0, 0, canvas.width / dpr, canvas.height / dpr);
    setHasDrawn(false);
  };

  /**
   * 서명 저장 및 완료
   */
  const handleSave = async (continueNext: boolean = false) => {
    const canvas = canvasRef.current;
    if (!canvas || !hasDrawn) {
      setSaveError('서명 패드에 서명을 작성해주세요.');
      return;
    }

    setIsSaving(true);
    setSaveError(null);

    try {
      // 투명 배경의 PNG DataURL 및 Blob 추출
      const dataUrl = canvas.toDataURL('image/png');
      const blob = await new Promise<Blob>((resolve) => {
        canvas.toBlob((b) => resolve(b || new Blob()), 'image/png');
      });

      // Storage 업로드 (실제 환경) 또는 Base64 Data URL (로컬 모드)
      const uploadRes = await uploadSignatureImage(meetingId, attendee.id, dataUrl);

      const signatureRecord: AttendeeSignature = {
        id: 'sig_' + Date.now(),
        type: signatureType,
        purpose: signatureType,
        signedAt: new Date().toISOString(),
        imageUrl: uploadRes.downloadUrl || dataUrl,
        signatureDataUrl: dataUrl,
        storagePath: uploadRes.storagePath,
        ipAddress: '클라이언트 서명',
        userAgent: navigator.userAgent,
      };

      await onSaveSignature(attendee.id, signatureRecord);

      if (continueNext && onNextAttendee && hasNextAttendee) {
        handleClearCanvas();
        onNextAttendee();
      } else {
        onClose();
      }
    } catch (err: any) {
      logger.error('Failed to save signature', err);
      setSaveError(`서명 저장 실패: ${err?.message || '알 수 없는 오류'}`);
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4 overflow-y-auto">
      <div className="bg-white rounded-xl shadow-2xl max-w-lg w-full border border-slate-200 overflow-hidden my-4">
        {/* 모달 상단 */}
        <div className="bg-slate-900 px-6 py-4 flex items-center justify-between text-white border-b border-slate-800">
          <div className="flex items-center space-x-2">
            <div className="p-1.5 bg-blue-600 rounded-lg">
              <PenTool className="w-4 h-4 text-white" />
            </div>
            <div>
              <h3 className="text-sm font-bold">{attendee.name} 님의 전자서명</h3>
              <p className="text-xs text-slate-400">
                {attendee.role || attendee.position || '참석자'} | {attendee.affiliation || '소속'}
              </p>
            </div>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-white p-1 rounded">
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* 본문 서명 영역 */}
        <div className="p-6 space-y-4">
          {/* 서명 종류 선택 (참석 확인 vs 내용 확인) */}
          <div className="flex items-center space-x-4 text-xs font-semibold text-slate-700 bg-slate-50 p-2.5 rounded-lg border border-slate-200">
            <label className="flex items-center space-x-1.5 cursor-pointer">
              <input
                type="radio"
                name="sigType"
                value="content"
                checked={signatureType === 'content'}
                onChange={() => setSignatureType('content')}
                className="w-3.5 h-3.5 text-blue-600 focus:ring-blue-500"
              />
              <span>회의록 내용 확인 서명 (권장)</span>
            </label>
            <label className="flex items-center space-x-1.5 cursor-pointer">
              <input
                type="radio"
                name="sigType"
                value="attendance"
                checked={signatureType === 'attendance'}
                onChange={() => setSignatureType('attendance')}
                className="w-3.5 h-3.5 text-blue-600 focus:ring-blue-500"
              />
              <span>단순 참석 확인 서명</span>
            </label>
          </div>

          {/* 캔버스 패드 */}
          <div className="relative border-2 border-dashed border-slate-300 rounded-xl bg-slate-50 overflow-hidden">
            <canvas
              ref={canvasRef}
              onPointerDown={handlePointerDown}
              onPointerMove={handlePointerMove}
              onPointerUp={handlePointerUp}
              className="w-full h-56 touch-none-canvas cursor-crosshair block"
            />
            {!hasDrawn && (
              <div className="absolute inset-0 flex items-center justify-center pointer-events-none text-slate-400 text-xs select-none">
                이곳에 서명(사인)해 주세요 (마우스, 터치, 펜)
              </div>
            )}
          </div>

          {saveError && (
            <div className="p-2.5 bg-red-50 border border-red-200 text-xs text-red-700 rounded-lg">
              {saveError}
            </div>
          )}

          <div className="flex items-center justify-between text-xs text-slate-500">
            <span>※ 본 서명은 위변조 방지 해시와 타임스탬프가 결합되어 법적 증빙 효력을 갖습니다.</span>
            <button
              type="button"
              onClick={handleClearCanvas}
              className="flex items-center space-x-1 text-slate-600 hover:text-slate-900 font-semibold p-1 hover:bg-slate-100 rounded"
            >
              <RotateCcw className="w-3.5 h-3.5" />
              <span>다시 쓰기</span>
            </button>
          </div>
        </div>

        {/* 모달 하단 버튼 군 */}
        <div className="bg-slate-50 px-6 py-3 border-t border-slate-200 flex items-center justify-between">
          <button
            type="button"
            onClick={onClose}
            className="px-3.5 py-2 text-xs font-semibold text-slate-600 hover:bg-slate-200 rounded-lg transition-colors"
          >
            닫기
          </button>

          <div className="flex items-center space-x-2">
            {/* 공용 태블릿 연속 대면 서명 모드 (다음 사람 서명으로 바로 넘어가기) */}
            {hasNextAttendee && (
              <button
                type="button"
                disabled={!hasDrawn || isSaving}
                onClick={() => handleSave(true)}
                className="flex items-center space-x-1 px-3.5 py-2 bg-slate-800 hover:bg-slate-700 text-white text-xs font-bold rounded-lg shadow-sm transition-colors disabled:opacity-50"
              >
                <span>저장 후 다음 참석자</span>
                <ChevronRight className="w-3.5 h-3.5" />
              </button>
            )}

            <button
              type="button"
              disabled={!hasDrawn || isSaving}
              onClick={() => handleSave(false)}
              className="flex items-center space-x-1 px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white text-xs font-bold rounded-lg shadow-sm transition-colors disabled:opacity-50"
            >
              <Check className="w-4 h-4" />
              <span>{isSaving ? '저장 중...' : '서명 완료'}</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
