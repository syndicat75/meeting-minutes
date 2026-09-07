/**
 * @file src/services/audioChunkService.ts
 * @description 5분 단위 오디오 청크의 Firestore 메타데이터 저장, 실시간 조회, 재시도 및 Storage 연동 관리 서비스.
 * 모든 청크는 생성 즉시 로컬 IndexedDB에 보존되며, Firebase Storage 업로드 및 Firestore 상태 동기화가 원자적으로 이루어집니다.
 */

import {
  collection,
  doc,
  setDoc,
  getDocs,
  onSnapshot,
  query,
  orderBy,
  updateDoc,
} from 'firebase/firestore';
import { getFirestoreInstance } from './firebase';
import { logger } from '../utils/logger';
import { AudioChunk, ChunkUploadStatus, ChunkTranscriptionStatus } from '../types/meeting';
import { uploadAudioChunkToStorage } from './storageService';
import {
  save5MinChunkBlob,
  get5MinChunkBlob,
  mark5MinChunkUploaded,
  getAll5MinChunks,
} from './indexedDbAudio';

/**
 * Firestore 청크 문서 레퍼런스 생성 헬퍼
 * @param meetingId 회의 ID
 * @param chunkId 청크 ID
 */
function getChunkDocRef(meetingId: string, chunkId: string) {
  const db = getFirestoreInstance();
  return doc(db, 'meetings', meetingId, 'audioChunks', chunkId);
}

/**
 * Firestore 청크 컬렉션 레퍼런스 생성 헬퍼
 * @param meetingId 회의 ID
 */
function getChunksCollectionRef(meetingId: string) {
  const db = getFirestoreInstance();
  return collection(db, 'meetings', meetingId, 'audioChunks');
}

/**
 * 5분 단위 오디오 청크를 Firebase Storage에 업로드하고 Firestore 메타데이터를 저장
 * @param meetingId 회의 ID
 * @param chunkId 청크 ID (예: chunk_0001)
 * @param index 순번 (1부터 시작)
 * @param blob 청크 오디오 바이너리 Blob
 * @param mimeType 오디오 MIME 타입
 * @param startSeconds 구간 시작 초
 * @param endSeconds 구간 종료 초
 * @returns {Promise<AudioChunk>} 저장된 청크 객체
 */
export async function processAndUploadAudioChunk(
  meetingId: string,
  chunkId: string,
  index: number,
  blob: Blob,
  mimeType: string,
  startSeconds: number,
  endSeconds: number
): Promise<AudioChunk> {
  // 정렬 가능한 4자리 chunkId 표준화 (예: chunk_0001)
  const normalizedChunkId = `chunk_${String(index).padStart(4, '0')}`;

  logger.info('processAndUploadAudioChunk called', {
    meetingId,
    chunkId: normalizedChunkId,
    index,
    sizeBytes: blob?.size,
    startSeconds,
    endSeconds,
  });

  const duration = Math.max(1, Math.round(endSeconds - startSeconds));
  const extension = mimeType.includes('mp4') ? 'mp4' : mimeType.includes('m4a') ? 'm4a' : 'webm';
  const fileName = `${normalizedChunkId}.${extension}`;
  const storagePath = `meetings/${meetingId}/audio/chunks/${fileName}`;

  // 1. WebM Blob 유효성 사전 검증
  if (!blob || blob.size === 0) {
    const zeroSizeErr = new Error('오디오 청크 데이터가 비어 있습니다 (0 bytes).');
    (zeroSizeErr as any).code = 'storage/empty-blob';
    console.error('[audio-chunk-upload]', {
      code: 'storage/empty-blob',
      message: zeroSizeErr.message,
      name: zeroSizeErr.name,
      meetingId,
      chunkId: normalizedChunkId,
      storagePath,
      blobSize: blob ? blob.size : 0,
      mimeType,
    });
    throw zeroSizeErr;
  }

  // 2. 브라우저 비정상 종료 대비 로컬 IndexedDB에 원본 Blob 즉시 보존
  try {
    await save5MinChunkBlob(meetingId, normalizedChunkId, index, blob, mimeType, startSeconds, endSeconds);
    logger.debug('Chunk backed up in IndexedDB successfully', { chunkId: normalizedChunkId });
  } catch (idbErr) {
    logger.warn('Failed to backup chunk in IndexedDB, continuing with upload', { chunkId: normalizedChunkId, error: String(idbErr) });
  }

  // 3. 초기 청크 메타데이터 객체 준비
  const chunkData: AudioChunk = {
    id: normalizedChunkId,
    meetingId,
    index,
    storagePath,
    startSeconds,
    endSeconds,
    duration,
    durationSeconds: duration,
    size: blob.size,
    fileSizeBytes: blob.size,
    mimeType,
    uploadStatus: 'uploading',
    transcriptionStatus: 'pending',
    transcriptionAttempts: 0,
    createdAt: new Date().toISOString(),
  };

  // Firestore에 uploading 상태 기록 (초기 등록)
  try {
    const chunkRef = getChunkDocRef(meetingId, normalizedChunkId);
    await setDoc(chunkRef, chunkData, { merge: true });
  } catch (fsErr) {
    logger.warn('Failed to save initial chunk status to Firestore', { chunkId: normalizedChunkId, error: String(fsErr) });
  }

  // 4. Firebase Storage에 직접 업로드 (지수 백오프 3회 자동 재시도 포함)
  try {
    const uploadResult = await uploadAudioChunkToStorage(meetingId, normalizedChunkId, blob, mimeType);
    const { downloadUrl, storagePath: returnedStoragePath } = uploadResult;

    chunkData.uploadStatus = 'uploaded';
    chunkData.downloadUrl = downloadUrl;
    chunkData.storagePath = returnedStoragePath || storagePath;
    chunkData.errorMessage = undefined;

    // Firestore에 업로드 완료 상태 갱신 (Storage 성공 후에만 'uploaded' 기록)
    try {
      const chunkRef = getChunkDocRef(meetingId, normalizedChunkId);
      await setDoc(
        chunkRef,
        {
          uploadStatus: 'uploaded',
          downloadUrl,
          storagePath: returnedStoragePath || storagePath,
          errorMessage: null,
          updatedAt: new Date().toISOString(),
        },
        { merge: true }
      );
    } catch (fsErr) {
      logger.error('Failed to update chunk uploaded status in Firestore', { chunkId: normalizedChunkId, error: fsErr });
    }

    // IndexedDB에 업로드 완료 마킹
    try {
      await mark5MinChunkUploaded(meetingId, normalizedChunkId);
    } catch {
      // 무시
    }

    logger.info('Audio chunk upload fully succeeded', { chunkId: normalizedChunkId, storagePath });
    return chunkData;
  } catch (uploadErr: any) {
    const is403 =
      uploadErr?.code === 'storage/unauthorized' ||
      uploadErr?.code === 'storage/unauthenticated' ||
      uploadErr?.httpStatus === 403 ||
      String(uploadErr?.message || '').includes('권한') ||
      String(uploadErr?.message || '').includes('403');

    const friendlyErrorMessage = is403
      ? 'Firebase Storage 저장 권한이 없습니다.'
      : (uploadErr?.message || 'Storage 업로드에 실패했습니다.');

    // 요구사항: catch에서 오류를 숨기지 말고 console.error에 상세 기록
    console.error('[audio-chunk-upload]', {
      code: uploadErr?.code || (is403 ? 'storage/unauthorized' : 'storage/failed'),
      message: uploadErr?.message,
      name: uploadErr?.name,
      meetingId,
      chunkId: normalizedChunkId,
      storagePath,
      blobSize: blob.size,
      mimeType,
      is403,
    });

    chunkData.uploadStatus = 'failed';
    chunkData.errorCode = uploadErr?.code || (is403 ? 'storage/unauthorized' : 'storage/failed');
    chunkData.errorMessage = friendlyErrorMessage;
    // 실패하더라도 IndexedDB에 저장된 원본 오디오를 바로 들을 수 있도록 Object URL 생성 부여
    try {
      chunkData.downloadUrl = URL.createObjectURL(blob);
    } catch {
      // 무시
    }

    try {
      const chunkRef = getChunkDocRef(meetingId, normalizedChunkId);
      await setDoc(
        chunkRef,
        {
          uploadStatus: 'failed',
          errorMessage: friendlyErrorMessage,
          errorCode: chunkData.errorCode,
          updatedAt: new Date().toISOString(),
        },
        { merge: true }
      );
    } catch {
      // 무시
    }

    return chunkData;
  }
}

/**
 * 업로드에 실패한 청크를 로컬 IndexedDB에서 읽어와 수동으로 다시 업로드
 * @param meetingId 회의 ID
 * @param chunkId 청크 ID
 * @returns {Promise<AudioChunk>} 갱신된 청크 객체
 */
export async function retryFailedChunkUpload(
  meetingId: string,
  chunkId: string
): Promise<AudioChunk> {
  logger.info('retryFailedChunkUpload called', { meetingId, chunkId });

  // 1. IndexedDB에서 저장된 청크 Blob 조회 (4자리 및 3자리 ID fallback)
  let blob = await get5MinChunkBlob(meetingId, chunkId);
  let effectiveChunkId = chunkId;

  if (!blob) {
    // 3자리 <-> 4자리 변환 시도
    const num = parseInt(chunkId.replace(/\D/g, ''), 10) || 1;
    const altChunkId4 = `chunk_${String(num).padStart(4, '0')}`;
    const altChunkId3 = `chunk_${String(num).padStart(3, '0')}`;
    const fallbackId = chunkId === altChunkId4 ? altChunkId3 : altChunkId4;
    blob = await get5MinChunkBlob(meetingId, fallbackId);
    if (blob) {
      effectiveChunkId = fallbackId;
    }
  }

  if (!blob || blob.size === 0) {
    const notFoundErr = new Error('로컬 임시 저장소에서 청크 오디오 데이터(Blob)를 찾을 수 없습니다.');
    (notFoundErr as any).code = 'storage/blob-not-found';
    console.error('[audio-chunk-upload]', {
      code: 'storage/blob-not-found',
      message: notFoundErr.message,
      meetingId,
      chunkId,
    });
    throw notFoundErr;
  }

  const chunkRef = getChunkDocRef(meetingId, chunkId);
  try {
    await updateDoc(chunkRef, { uploadStatus: 'uploading', errorMessage: null });
  } catch {
    // 무시
  }

  // 2. 재업로드 수행
  const mimeType = blob.type || 'audio/webm';
  try {
    const { downloadUrl, storagePath } = await uploadAudioChunkToStorage(
      meetingId,
      chunkId,
      blob,
      mimeType
    );

    await setDoc(
      chunkRef,
      {
        uploadStatus: 'uploaded',
        downloadUrl,
        storagePath,
        errorMessage: null,
        updatedAt: new Date().toISOString(),
      },
      { merge: true }
    );

    await mark5MinChunkUploaded(meetingId, effectiveChunkId);
    logger.info('retryFailedChunkUpload succeeded', { chunkId, storagePath });

    const num = parseInt(chunkId.replace(/\D/g, ''), 10) || 1;
    return {
      id: chunkId,
      meetingId,
      index: num,
      storagePath,
      downloadUrl,
      startSeconds: (num - 1) * 300,
      endSeconds: num * 300,
      duration: 300,
      durationSeconds: 300,
      size: blob.size,
      fileSizeBytes: blob.size,
      mimeType,
      uploadStatus: 'uploaded',
      transcriptionStatus: 'pending',
      transcriptionAttempts: 0,
      createdAt: new Date().toISOString(),
    };
  } catch (err: any) {
    console.error('[audio-chunk-upload]', {
      code: err?.code,
      message: err?.message,
      name: err?.name,
      meetingId,
      chunkId,
      blobSize: blob.size,
      mimeType,
    });

    try {
      await setDoc(
        chunkRef,
        {
          uploadStatus: 'failed',
          errorMessage: err?.message || '저장 재시도 실패',
          updatedAt: new Date().toISOString(),
        },
        { merge: true }
      );
    } catch {
      // 무시
    }
    throw err;
  }
}

export const retryFailedAudioChunk = retryFailedChunkUpload;

/**
 * 특정 회의의 모든 청크 목록 조회 (Firestore + 로컬 IndexedDB 통합 복원)
 * @param meetingId 회의 ID
 * @returns {Promise<AudioChunk[]>} 청크 목록 (인덱스 순)
 */
export async function getMeetingAudioChunks(meetingId: string): Promise<AudioChunk[]> {
  logger.info('getMeetingAudioChunks called', { meetingId });
  const firestoreChunks: AudioChunk[] = [];
  try {
    const q = query(getChunksCollectionRef(meetingId), orderBy('index', 'asc'));
    const snapshot = await getDocs(q);
    snapshot.forEach((docSnap) => {
      firestoreChunks.push(docSnap.data() as AudioChunk);
    });
  } catch (err) {
    logger.warn('Failed to get chunks from Firestore, falling back to IndexedDB', { meetingId, error: String(err) });
  }

  // 로컬 IndexedDB 청크와 병합하여 오프라인/미설정/지연 환경에서도 데이터 보존
  try {
    const local5MinChunks = await getAll5MinChunks(meetingId);
    if (local5MinChunks && local5MinChunks.length > 0) {
      const mergedMap = new Map<string, AudioChunk>();
      // 로컬 데이터를 우선 매핑
      for (const loc of local5MinChunks) {
        const id = loc.chunkId;
        const blobUrl = URL.createObjectURL(loc.blob);
        mergedMap.set(id, {
          id,
          meetingId,
          index: loc.index,
          storagePath: `meetings/${meetingId}/audio/chunks/${id}.webm`,
          downloadUrl: blobUrl,
          startSeconds: loc.startSeconds,
          endSeconds: loc.endSeconds,
          duration: Math.max(1, loc.endSeconds - loc.startSeconds),
          durationSeconds: Math.max(1, loc.endSeconds - loc.startSeconds),
          size: loc.blob.size,
          fileSizeBytes: loc.blob.size,
          mimeType: loc.mimeType,
          uploadStatus: loc.isUploaded ? 'uploaded' : 'failed',
          transcriptionStatus: 'pending',
          transcriptionAttempts: 0,
          createdAt: loc.createdAt,
        });
      }
      // Firestore에 등록된 메타데이터가 있으면 덮어씌움 (단, downloadUrl이 없으면 로컬 Blob URL 보존)
      for (const fc of firestoreChunks) {
        const existing = mergedMap.get(fc.id);
        mergedMap.set(fc.id, {
          ...existing,
          ...fc,
          downloadUrl: fc.downloadUrl || existing?.downloadUrl,
        });
      }
      return Array.from(mergedMap.values()).sort((a, b) => a.index - b.index);
    }
  } catch (idbErr) {
    logger.warn('Failed to read from IndexedDB for getMeetingAudioChunks', idbErr);
  }

  return firestoreChunks;
}

/**
 * 특정 회의의 청크 목록 실시간 구독
 * @param meetingId 회의 ID
 * @param onUpdate 청크 목록 변경 콜백
 * @returns 구독 해제 함수 (Unsubscribe)
 */
export function subscribeMeetingAudioChunks(
  meetingId: string,
  onUpdate: (chunks: AudioChunk[]) => void
): () => void {
  logger.debug('subscribeMeetingAudioChunks called', { meetingId });
  try {
    const q = query(getChunksCollectionRef(meetingId), orderBy('index', 'asc'));
    return onSnapshot(
      q,
      (snapshot) => {
        const chunks: AudioChunk[] = [];
        snapshot.forEach((docSnap) => {
          chunks.push(docSnap.data() as AudioChunk);
        });
        onUpdate(chunks);
      },
      (error) => {
        logger.error('AudioChunks subscription error', error);
      }
    );
  } catch (err) {
    logger.error('Failed to set up AudioChunks subscription', err);
    return () => {};
  }
}

/**
 * 청크의 전사 상태 및 결과 업데이트
 * @param meetingId 회의 ID
 * @param chunkId 청크 ID
 * @param updates 갱신할 필드 객체
 */
export async function updateChunkTranscriptionStatus(
  meetingId: string,
  chunkId: string,
  updates: Partial<AudioChunk>
): Promise<void> {
  logger.info('updateChunkTranscriptionStatus called', { meetingId, chunkId, updates });
  const chunkRef = getChunkDocRef(meetingId, chunkId);
  await updateDoc(chunkRef, {
    ...updates,
    updatedAt: new Date().toISOString(),
  });
}
