/**
 * @file src/services/storageService.ts
 * @description 회의 녹음 오디오, 회의 사진, 참석자 서명 이미지를 Firebase Storage에 안전하게 업로드 및 관리하는 서비스.
 * 이미지 업로드 전 EXIF 메타데이터 제거 및 캔버스 리사이즈(최대 1920px)를 수행합니다.
 */

import {
  ref,
  uploadBytesResumable,
  getDownloadURL,
  deleteObject,
  UploadTaskSnapshot,
} from 'firebase/storage';
import { getFirebaseStorageInstance, getFirebaseAuth } from './firebase';
import { logger } from '../utils/logger';

export interface UploadProgressCallback {
  (progressPercent: number, bytesTransferred: number, totalBytes: number): void;
}

/**
 * 캔버스를 활용하여 이미지의 EXIF를 제거하고 최대 규격(1920px)으로 압축 및 리사이즈
 * @param file 원본 이미지 파일
 * @param maxDimension 최대 가로/세로 픽셀 크기
 * @param quality JPEG 압축 품질 (0.1 ~ 1.0)
 * @returns 압축 및 정제된 Blob
 */
export async function sanitizeAndCompressImage(
  file: File,
  maxDimension: number = 1920,
  quality: number = 0.85
): Promise<Blob> {
  logger.info('sanitizeAndCompressImage called', { fileName: file.name, fileSize: file.size });

  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      const img = new Image();
      img.onload = () => {
        let width = img.width;
        let height = img.height;

        if (width > maxDimension || height > maxDimension) {
          if (width > height) {
            height = Math.round((height * maxDimension) / width);
            width = maxDimension;
          } else {
            width = Math.round((width * maxDimension) / height);
            height = maxDimension;
          }
        }

        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;

        const ctx = canvas.getContext('2d');
        if (!ctx) {
          reject(new Error('Canvas context 생성 실패'));
          return;
        }

        // 이미지 그리기 (EXIF 위치 정보 등은 캔버스 렌더링을 통해 자동 제거됨)
        ctx.drawImage(img, 0, 0, width, height);

        canvas.toBlob(
          (blob) => {
            if (blob) {
              logger.info('Image compressed and sanitized successfully', {
                originalSize: file.size,
                newSize: blob.size,
                width,
                height,
              });
              resolve(blob);
            } else {
              reject(new Error('Blob 변환 실패'));
            }
          },
          'image/jpeg',
          quality
        );
      };
      img.onerror = () => reject(new Error('이미지 로드 실패'));
      img.src = e.target?.result as string;
    };
    reader.onerror = () => reject(new Error('파일 읽기 실패'));
    reader.readAsDataURL(file);
  });
}

/**
 * 녹음 오디오 Blob을 Storage의 지정된 경로로 업로드
 * @param meetingId 회의 ID
 * @param audioBlob 녹음 오디오 Blob
 * @param mimeType 오디오 MIME 타입
 * @param onProgress 진행률 콜백
 * @returns {Promise<{ storagePath: string; downloadUrl: string }>} 업로드된 파일의 경로 및 URL
 */
export async function uploadRecordingAudio(
  meetingId: string,
  audioBlob: Blob,
  mimeType: string,
  onProgress?: UploadProgressCallback
): Promise<{ storagePath: string; downloadUrl: string }> {
  logger.info('uploadRecordingAudio called', { meetingId, size: audioBlob.size, mimeType });
  const auth = getFirebaseAuth();
  const currentUser = auth?.currentUser;
  const storage = getFirebaseStorageInstance();

  console.log('[storage-auth]', {
    uid: currentUser?.uid ?? null,
    hasUser: !!currentUser,
  });

  const extension = mimeType.includes('mp4') ? 'mp4' : mimeType.includes('wav') ? 'wav' : 'webm';
  const fileName = `audio_${Date.now()}.${extension}`;
  const storagePath = `meetings/${meetingId}/recordings/${fileName}`;

  console.log('[storage-upload-path]', { storagePath });

  if (!storage || !currentUser) {
    logger.warn('Firebase storage is not configured or user not authenticated, creating local object URL', {
      hasStorage: Boolean(storage),
      hasUser: Boolean(currentUser),
    });
    const localUrl = URL.createObjectURL(audioBlob);
    if (onProgress) onProgress(100, audioBlob.size, audioBlob.size);
    return {
      storagePath: `local/${storagePath}`,
      downloadUrl: localUrl,
    };
  }

  const fileRef = ref(storage, storagePath);

  const metadata = {
    contentType: mimeType,
    customMetadata: {
      meetingId,
      uploadedAt: new Date().toISOString(),
      uploadedByUid: currentUser.uid,
    },
  };

  const uploadTask = uploadBytesResumable(fileRef, audioBlob, metadata);

  return new Promise((resolve, reject) => {
    uploadTask.on(
      'state_changed',
      (snapshot: UploadTaskSnapshot) => {
        const percent = Math.round((snapshot.bytesTransferred / snapshot.totalBytes) * 100);
        logger.debug('Audio upload progress', { percent });
        if (onProgress) {
          onProgress(percent, snapshot.bytesTransferred, snapshot.totalBytes);
        }
      },
      (error) => {
        logger.error('Audio upload failed', error);
        reject(error);
      },
      async () => {
        const downloadUrl = await getDownloadURL(uploadTask.snapshot.ref);
        logger.info('Audio upload completed', { storagePath });
        resolve({ storagePath, downloadUrl });
      }
    );
  });
}

/**
 * 5분 단위 오디오 Chunk를 Firebase Storage에 직접 업로드 (지수 백오프 자동 재시도)
 * @param meetingId 회의 ID
 * @param chunkId 청크 식별자 (예: chunk_0001)
 * @param chunkBlob 오디오 청크 Blob
 * @param mimeType 오디오 MIME 타입
 * @param onProgress 진행률 콜백 (선택)
 * @returns {Promise<{ storagePath: string; downloadUrl: string }>}
 */
export async function uploadAudioChunkToStorage(
  meetingId: string,
  chunkId: string,
  chunkBlob: Blob,
  mimeType: string,
  onProgress?: UploadProgressCallback
): Promise<{ storagePath: string; downloadUrl: string; isLocalFallback?: boolean }> {
  logger.info('uploadAudioChunkToStorage called', { meetingId, chunkId, byteLength: chunkBlob?.size });

  // 1. meetingId 유효성 엄격 검증
  if (!meetingId || meetingId === 'undefined' || meetingId === 'null' || meetingId.trim() === '') {
    const meetingIdErr = new Error('올바르지 않은 회의 식별자(meetingId)입니다.');
    (meetingIdErr as any).code = 'storage/invalid-meeting-id';
    console.error('[audio-chunk-upload]', {
      code: 'storage/invalid-meeting-id',
      message: meetingIdErr.message,
      name: meetingIdErr.name,
      meetingId,
      chunkId,
    });
    throw meetingIdErr;
  }

  // 2. WebM Blob 유효성 검증 (크기 0 검사)
  if (!chunkBlob || chunkBlob.size === 0) {
    const zeroSizeErr = new Error('오디오 청크 데이터가 비어 있습니다 (0 bytes). 다시 녹음해주세요.');
    (zeroSizeErr as any).code = 'storage/empty-blob';
    console.error('[audio-chunk-upload]', {
      code: 'storage/empty-blob',
      message: zeroSizeErr.message,
      name: zeroSizeErr.name,
      meetingId,
      chunkId,
      blobSize: chunkBlob ? chunkBlob.size : 0,
    });
    throw zeroSizeErr;
  }

  // 3. Firebase Storage 및 인증 확인
  const auth = getFirebaseAuth();
  const currentUser = auth?.currentUser;
  const storage = getFirebaseStorageInstance();

  // 진단 로그: auth.currentUser 상태 (ID 토큰 등 민감값 제외)
  console.log('[storage-auth]', {
    uid: currentUser?.uid ?? null,
    hasUser: !!currentUser,
  });

  // 4. 정렬 가능한 4자리 파일명 강제 (예: chunk_0001.webm)
  const chunkNumberMatch = chunkId.match(/\d+/);
  const chunkIndex = chunkNumberMatch ? parseInt(chunkNumberMatch[0], 10) : 1;
  const normalizedChunkId = `chunk_${String(chunkIndex).padStart(4, '0')}`;

  const extension = mimeType.includes('mp4') ? 'mp4' : mimeType.includes('m4a') ? 'm4a' : 'webm';
  const fileName = `${normalizedChunkId}.${extension}`;
  const storagePath = `meetings/${meetingId}/audio/chunks/${fileName}`;

  // 진단 로그: 실제 Storage 업로드 경로 출력
  console.log('[storage-upload-path]', { storagePath });

  // auth.currentUser가 null이면 Firebase Storage 업로드를 시도하지 않음 (403 방지 및 로컬 안전 보존)
  if (!currentUser || !storage) {
    console.warn('[storage-auth] Upload aborted: auth.currentUser or storage instance is null', {
      hasUser: Boolean(currentUser),
      hasStorage: Boolean(storage),
    });
    const localUrl = URL.createObjectURL(chunkBlob);
    if (onProgress) {
      onProgress(100, chunkBlob.size, chunkBlob.size);
    }
    return {
      storagePath: `local/${storagePath}`,
      downloadUrl: localUrl,
      isLocalFallback: true,
    };
  }

  const fileRef = ref(storage, storagePath);

  // 5. MIME 타입 정규화 (audio/* 규칙 보장)
  const normalizedContentType = (mimeType && mimeType.startsWith('audio/'))
    ? mimeType.split(';')[0].trim()
    : 'audio/webm';

  const metadata = {
    contentType: normalizedContentType,
    customMetadata: {
      meetingId,
      chunkId: normalizedChunkId,
      uploadedAt: new Date().toISOString(),
      uploadedByUid: currentUser.uid,
    },
  };

  // 재시도 대상 에러 판별 헬퍼
  // 403, storage/unauthorized, storage/unauthenticated, storage/no-default-bucket은 시간 경과로 해결되지 않으므로 즉시 실패
  const isNonRetryableError = (error: any): boolean => {
    const code = String(error?.code || '');
    const message = String(error?.message || '');
    const serverResponse = String(error?.serverResponse || '');
    return (
      code === 'storage/unauthorized' ||
      code === 'storage/unauthenticated' ||
      code === 'storage/no-default-bucket' ||
      code.includes('unauthorized') ||
      code.includes('permission-denied') ||
      message.includes('403') ||
      serverResponse.includes('403')
    );
  };

  // 지수 백오프 재시도 (최대 3회: 2초, 5초, 10초) - 403 등 권한 오류 시에는 즉시 중단
  const retryDelays = [2000, 5000, 10000];

  const attemptUpload = async (): Promise<{ storagePath: string; downloadUrl: string }> => {
    return new Promise((resolve, reject) => {
      const uploadTask = uploadBytesResumable(fileRef, chunkBlob, metadata);

      uploadTask.on(
        'state_changed',
        (snapshot: UploadTaskSnapshot) => {
          const percent = Math.round((snapshot.bytesTransferred / snapshot.totalBytes) * 100);
          if (onProgress) {
            onProgress(percent, snapshot.bytesTransferred, snapshot.totalBytes);
          }
        },
        (error) => {
          const is403 = isNonRetryableError(error);
          console.error('[audio-chunk-upload]', {
            code: (error as any)?.code || (is403 ? 'storage/unauthorized' : 'storage/unknown'),
            message: (error as any)?.message,
            name: (error as any)?.name,
            meetingId,
            chunkId: normalizedChunkId,
            storagePath,
            blobSize: chunkBlob.size,
            mimeType: normalizedContentType,
            isNonRetryable: is403,
          });
          reject(error);
        },
        async () => {
          try {
            const downloadUrl = await getDownloadURL(uploadTask.snapshot.ref);
            logger.info('uploadAudioChunk attempt success', { chunkId: normalizedChunkId, storagePath });
            resolve({ storagePath, downloadUrl });
          } catch (urlErr) {
            console.error('[audio-chunk-upload]', {
              code: (urlErr as any)?.code,
              message: (urlErr as any)?.message,
              name: (urlErr as any)?.name,
              meetingId,
              chunkId: normalizedChunkId,
              storagePath,
            });
            reject(urlErr);
          }
        }
      );
    });
  };

  let lastError: any = null;
  for (let attempt = 0; attempt <= retryDelays.length; attempt++) {
    try {
      if (attempt > 0) {
        const delay = retryDelays[attempt - 1];
        logger.warn(`Retrying chunk upload (attempt ${attempt}/${retryDelays.length}) after ${delay}ms`, { chunkId });
        await new Promise((r) => setTimeout(r, delay));
      }
      return await attemptUpload();
    } catch (err: any) {
      lastError = err;
      logger.error(`Chunk upload attempt ${attempt + 1} failed`, err);

      // 403 / storage/unauthorized / storage/unauthenticated 발생 시 추가 재시도 즉시 중단
      if (isNonRetryableError(err)) {
        logger.warn('Non-retryable authorization error (HTTP 403) detected. Aborting automatic retry.', {
          code: err?.code,
          message: err?.message,
        });
        const friendlyError = new Error(
          '녹음 저장 권한이 없습니다. Firebase Storage 권한 설정을 확인해주세요.'
        );
        (friendlyError as any).code = err?.code || 'storage/unauthorized';
        (friendlyError as any).originalError = err;
        (friendlyError as any).storagePath = storagePath;
        (friendlyError as any).httpStatus = 403;
        throw friendlyError;
      }
    }
  }

  throw lastError;
}

/**
 * 회의 개최 사진 업로드
 * @param meetingId 회의 ID
 * @param photoFile 원본 사진 파일
 * @param onProgress 진행률 콜백
 * @returns {Promise<{ storagePath: string; downloadUrl: string }>}
 */
export async function uploadMeetingPhoto(
  meetingId: string,
  photoFile: File,
  onProgress?: UploadProgressCallback
): Promise<{ storagePath: string; downloadUrl: string }> {
  logger.info('uploadMeetingPhoto called', { meetingId, fileName: photoFile.name });

  // 1. EXIF 제거 및 압축
  const compressedBlob = await sanitizeAndCompressImage(photoFile);

  const storage = getFirebaseStorageInstance();
  if (!storage) {
    logger.warn('Firebase storage not configured, fallback to data URL');
    const reader = new FileReader();
    return new Promise((resolve) => {
      reader.onload = (e) => {
        if (onProgress) onProgress(100, compressedBlob.size, compressedBlob.size);
        resolve({
          storagePath: `local/meetings/${meetingId}/photos/${Date.now()}`,
          downloadUrl: e.target?.result as string,
        });
      };
      reader.readAsDataURL(compressedBlob);
    });
  }

  const fileName = `photo_${Date.now()}_${Math.random().toString(36).substring(2, 6)}.jpg`;
  const storagePath = `meetings/${meetingId}/photos/${fileName}`;
  const fileRef = ref(storage, storagePath);

  const metadata = {
    contentType: 'image/jpeg',
    customMetadata: {
      meetingId,
      uploadedAt: new Date().toISOString(),
    },
  };

  const uploadTask = uploadBytesResumable(fileRef, compressedBlob, metadata);

  return new Promise((resolve, reject) => {
    uploadTask.on(
      'state_changed',
      (snapshot) => {
        const percent = Math.round((snapshot.bytesTransferred / snapshot.totalBytes) * 100);
        if (onProgress) {
          onProgress(percent, snapshot.bytesTransferred, snapshot.totalBytes);
        }
      },
      (err) => {
        logger.error('Photo upload failed', err);
        reject(err);
      },
      async () => {
        const downloadUrl = await getDownloadURL(uploadTask.snapshot.ref);
        logger.info('Photo upload completed', { storagePath });
        resolve({ storagePath, downloadUrl });
      }
    );
  });
}

/**
 * 서명 PNG DataURL을 Storage에 업로드
 * @param meetingId 회의 ID
 * @param attendeeId 참석자 ID
 * @param signatureDataUrl base64 PNG data URL
 * @returns {Promise<{ storagePath: string; downloadUrl: string }>}
 */
export async function uploadSignatureImage(
  meetingId: string,
  attendeeId: string,
  signatureDataUrl: string
): Promise<{ storagePath: string; downloadUrl: string }> {
  logger.info('uploadSignatureImage called', { meetingId, attendeeId });

  // DataURL을 Blob으로 변환
  const res = await fetch(signatureDataUrl);
  const blob = await res.blob();

  const storage = getFirebaseStorageInstance();
  if (!storage) {
    logger.info('Using data URL directly as storage is offline');
    return {
      storagePath: `local/meetings/${meetingId}/signatures/${attendeeId}`,
      downloadUrl: signatureDataUrl,
    };
  }

  const fileName = `sig_${attendeeId}_${Date.now()}.png`;
  const storagePath = `meetings/${meetingId}/signatures/${fileName}`;
  const fileRef = ref(storage, storagePath);

  const uploadTask = uploadBytesResumable(fileRef, blob, { contentType: 'image/png' });

  return new Promise((resolve, reject) => {
    uploadTask.on(
      'state_changed',
      null,
      (err) => {
        logger.error('Signature upload failed', err);
        reject(err);
      },
      async () => {
        const downloadUrl = await getDownloadURL(uploadTask.snapshot.ref);
        logger.info('Signature upload completed', { storagePath });
        resolve({ storagePath, downloadUrl });
      }
    );
  });
}

/**
 * Storage 파일 삭제
 * @param storagePath 삭제할 파일 경로
 */
export async function deleteStorageFile(storagePath: string): Promise<void> {
  logger.info('deleteStorageFile called', { storagePath });
  if (storagePath.startsWith('local/')) {
    logger.info('Local storage file ignored for remote deletion');
    return;
  }
  const storage = getFirebaseStorageInstance();
  if (!storage) return;

  try {
    const fileRef = ref(storage, storagePath);
    await deleteObject(fileRef);
    logger.info('Storage file deleted', { storagePath });
  } catch (err: any) {
    logger.warn('Failed to delete storage file', { storagePath, error: err?.message });
  }
}
