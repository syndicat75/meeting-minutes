/**
 * @file src/components/meeting/tabs/PhotosTab.tsx
 * @description 회의 사진 첨부 탭.
 * 현장 촬영(모바일 카메라) 및 이미지 업로드, 브라우저 Canvas를 통한 EXIF 자동 제거 및 압축,
 * 90도 회전, 설명(캡션) 입력, 순서 변경, 인쇄/PDF 첨부 제어 제공.
 */

import React, { useState, useRef } from 'react';
import {
  Camera,
  Upload,
  RotateCw,
  Trash2,
  ArrowUp,
  ArrowDown,
  Image as ImageIcon,
  Check,
  AlertCircle,
  FileImage,
} from 'lucide-react';
import { Meeting, MeetingPhoto } from '../../../types/meeting';
import { uploadMeetingPhoto, deleteStorageFile } from '../../../services/storageService';
import { formatFileSize } from '../../../utils/formatters';
import { logger } from '../../../utils/logger';

interface PhotosTabProps {
  meeting: Meeting;
  isReadOnly: boolean;
  onUpdateMeeting: (partial: Partial<Meeting>) => void;
}

/**
 * 회의 사진 관리 탭 컴포넌트
 */
export const PhotosTab: React.FC<PhotosTabProps> = ({
  meeting,
  isReadOnly,
  onUpdateMeeting,
}) => {
  logger.debug('PhotosTab rendered', { photoCount: meeting.photos?.length || 0 });

  const [isUploading, setIsUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);

  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const cameraInputRef = useRef<HTMLInputElement | null>(null);

  /**
   * 사진 업로드 처리 (파일 선택 또는 카메라 촬영)
   */
  const handleProcessImageFiles = async (fileList: FileList | null) => {
    if (!fileList || fileList.length === 0) return;
    logger.info('Processing photo upload files', { count: fileList.length });

    setIsUploading(true);
    setUploadError(null);

    try {
      const newPhotos: MeetingPhoto[] = [];

      for (let i = 0; i < fileList.length; i++) {
        const file = fileList[i];
        const res = await uploadMeetingPhoto(meeting.id, file);

        const photoItem: MeetingPhoto = {
          id: 'photo_' + Date.now() + '_' + i,
          storagePath: res.storagePath,
          downloadUrl: res.downloadUrl,
          caption: `회의 현장 사진 #${(meeting.photos?.length || 0) + i + 1}`,
          order: (meeting.photos?.length || 0) + i,
          uploadedAt: new Date().toISOString(),
          fileSizeBytes: file.size,
          rotation: 0,
        };
        newPhotos.push(photoItem);
      }

      onUpdateMeeting({
        photos: [...(meeting.photos || []), newPhotos[0], ...newPhotos.slice(1)],
      });
    } catch (err: any) {
      logger.error('Photo upload failed', err);
      setUploadError(`사진 처리 실패: ${err?.message || '네트워크 오류'}`);
    } finally {
      setIsUploading(false);
    }
  };

  /**
   * 사진 90도 시계방향 회전
   */
  const handleRotatePhoto = (photoId: string) => {
    if (isReadOnly) return;
    logger.info('Rotating photo', { photoId });
    const updated = (meeting.photos || []).map((p) => {
      if (p.id === photoId) {
        const currentRot = p.rotation || 0;
        return { ...p, rotation: (currentRot + 90) % 360 };
      }
      return p;
    });
    onUpdateMeeting({ photos: updated });
  };

  /**
   * 사진 설명(캡션) 수정
   */
  const handleUpdateCaption = (photoId: string, caption: string) => {
    if (isReadOnly) return;
    const updated = (meeting.photos || []).map((p) =>
      p.id === photoId ? { ...p, caption } : p
    );
    onUpdateMeeting({ photos: updated });
  };

  /**
   * 사진 삭제
   */
  const handleDeletePhoto = async (photo: MeetingPhoto) => {
    if (isReadOnly) return;
    logger.info('Deleting photo', { photoId: photo.id });
    try {
      await deleteStorageFile(photo.storagePath);
    } catch (e) {
      logger.warn('Failed to delete file from remote storage, continuing local purge', e);
    }

    const updated = (meeting.photos || []).filter((p) => p.id !== photo.id);
    onUpdateMeeting({ photos: updated });
  };

  /**
   * 사진 순서 변경 (위/아래)
   */
  const handleMovePhotoOrder = (index: number, direction: 'up' | 'down') => {
    if (isReadOnly) return;
    const photos = [...(meeting.photos || [])];
    const targetIdx = direction === 'up' ? index - 1 : index + 1;
    if (targetIdx < 0 || targetIdx >= photos.length) return;

    logger.info('Moving photo order', { from: index, to: targetIdx });
    const temp = photos[index];
    photos[index] = photos[targetIdx];
    photos[targetIdx] = temp;

    // order 필드 재색인
    const reordered = photos.map((p, idx) => ({ ...p, order: idx }));
    onUpdateMeeting({ photos: reordered });
  };

  return (
    <div className="space-y-6">
      {/* 안내 및 업로드 컨트롤 바 */}
      <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-6 space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-slate-100 pb-3">
          <div>
            <div className="flex items-center space-x-2">
              <ImageIcon className="w-4 h-4 text-blue-600" />
              <h4 className="text-sm font-bold text-slate-900">회의 사진 및 증빙 자료</h4>
            </div>
            <p className="text-xs text-slate-500 mt-0.5">
              위험성평가 현장 점검, 시설물 상태, 회의 참석 모습 등의 사진을 첨부합니다. (EXIF 메타데이터 자동 제거 및 최적화 압축)
            </p>
          </div>

          {/* 업로드 버튼 군 */}
          {!isReadOnly && (
            <div className="flex items-center space-x-2 shrink-0">
              {/* 모바일 직접 촬영 버튼 */}
              <button
                type="button"
                onClick={() => cameraInputRef.current?.click()}
                disabled={isUploading}
                className="flex items-center space-x-1 px-3 py-2 bg-slate-800 hover:bg-slate-700 text-white text-xs font-semibold rounded-lg shadow-sm transition-colors"
              >
                <Camera className="w-3.5 h-3.5" />
                <span>현장 촬영</span>
              </button>
              <input
                ref={cameraInputRef}
                type="file"
                accept="image/*"
                capture="environment"
                onChange={(e) => handleProcessImageFiles(e.target.files)}
                className="hidden"
              />

              {/* 갤러리/파일 선택 버튼 */}
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                disabled={isUploading}
                className="flex items-center space-x-1 px-3 py-2 bg-blue-600 hover:bg-blue-500 text-white text-xs font-semibold rounded-lg shadow-sm transition-colors"
              >
                <Upload className="w-3.5 h-3.5" />
                <span>사진 파일 선택</span>
              </button>
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                multiple
                onChange={(e) => handleProcessImageFiles(e.target.files)}
                className="hidden"
              />
            </div>
          )}
        </div>

        {uploadError && (
          <div className="p-3 bg-red-50 border border-red-200 rounded-lg text-xs text-red-700">
            {uploadError}
          </div>
        )}

        {isUploading && (
          <div className="p-4 bg-blue-50 border border-blue-200 rounded-lg text-xs text-blue-800 font-semibold text-center">
            사진 최적화 및 업로드 처리 중...
          </div>
        )}
      </div>

      {/* 사진 그리드 목록 */}
      {(!meeting.photos || meeting.photos.length === 0) ? (
        <div className="bg-white rounded-xl border border-slate-200 p-12 text-center text-slate-500 text-xs">
          첨부된 회의 사진이 없습니다. 상단의 버튼을 통해 사진을 추가해주세요.
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
          {meeting.photos.map((photo, index) => (
            <div
              key={photo.id}
              className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden flex flex-col justify-between"
            >
              {/* 이미지 뷰포트 (회전 스타일 지원) */}
              <div className="relative aspect-video bg-slate-100 flex items-center justify-center overflow-hidden">
                <img
                  src={photo.downloadUrl}
                  alt={photo.caption || '회의 사진'}
                  referrerPolicy="no-referrer"
                  style={{ transform: `rotate(${photo.rotation || 0}deg)` }}
                  className="w-full h-full object-contain transition-transform duration-200"
                />
                <span className="absolute top-2 left-2 px-2 py-0.5 rounded bg-black/60 text-white text-[10px] font-bold">
                  #{index + 1}
                </span>
              </div>

              {/* 캡션 입력 및 정보 */}
              <div className="p-3 space-y-2 flex-1">
                <input
                  type="text"
                  disabled={isReadOnly}
                  value={photo.caption || ''}
                  onChange={(e) => handleUpdateCaption(photo.id, e.target.value)}
                  placeholder="사진 설명 (예: 1호기 방호울 점검)"
                  className="w-full text-xs p-1.5 bg-slate-50 border border-slate-200 rounded focus:ring-1 focus:ring-blue-500 disabled:bg-transparent disabled:border-none"
                />
              </div>

              {/* 하단 제어 버튼 군 (회전, 순서이동, 삭제) */}
              {!isReadOnly && (
                <div className="bg-slate-50 px-3 py-2 border-t border-slate-200 flex items-center justify-between text-xs text-slate-600">
                  <div className="flex items-center space-x-1">
                    {/* 회전 버튼 */}
                    <button
                      type="button"
                      onClick={() => handleRotatePhoto(photo.id)}
                      className="p-1 hover:bg-slate-200 rounded"
                      title="90도 시계방향 회전"
                    >
                      <RotateCw className="w-3.5 h-3.5" />
                    </button>

                    {/* 순서 위로 */}
                    <button
                      type="button"
                      disabled={index === 0}
                      onClick={() => handleMovePhotoOrder(index, 'up')}
                      className="p-1 hover:bg-slate-200 rounded disabled:opacity-30"
                      title="앞으로 이동"
                    >
                      <ArrowUp className="w-3.5 h-3.5" />
                    </button>

                    {/* 순서 아래로 */}
                    <button
                      type="button"
                      disabled={index === (meeting.photos?.length || 0) - 1}
                      onClick={() => handleMovePhotoOrder(index, 'down')}
                      className="p-1 hover:bg-slate-200 rounded disabled:opacity-30"
                      title="뒤로 이동"
                    >
                      <ArrowDown className="w-3.5 h-3.5" />
                    </button>
                  </div>

                  {/* 삭제 버튼 */}
                  <button
                    type="button"
                    onClick={() => handleDeletePhoto(photo)}
                    className="p-1 text-slate-400 hover:text-red-600 rounded hover:bg-red-50"
                    title="사진 삭제"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
};
