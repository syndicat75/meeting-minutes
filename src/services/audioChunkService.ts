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
  logger.info('processAndUploadAudioChunk called', {
    meetingId,
    chunkId,
    index,
    sizeBytes: blob.size,
    startSeconds,
    endSeconds,
  });

  const duration = Math.max(1, Math.round(endSeconds - startSeconds));
  const extension = mimeType.includes('mp4') ? 'mp4' : mimeType.includes('m4a') ? 'm4a' : 'webm';
  const fileName = `${chunkId}.${extension}`;
  const storagePath = `meetings/${meetingId}/audio/chunks/${fileName}`;

  // 1. 브라우저 비정상 종료 대비 로컬 IndexedDB에 원본 Blob 즉시 보존
  try {
    await save5MinChunkBlob(meetingId, chunkId, index, blob, mimeType, startSeconds, endSeconds);
    logger.debug('Chunk backed up in IndexedDB successfully', { chunkId });
  } catch (idbErr) {
    logger.warn('Failed to backup chunk in IndexedDB, continuing with upload', { chunkId, error: String(idbErr) });
  }

  // 2. 초기 청크 메타데이터 객체 준비
  const chunkData: AudioChunk = {
    id: chunkId,
    meetingId,
    index,
    storagePath,
    startSeconds,
    endSeconds,
    duration,
    size: blob.size,
    mimeType,
    uploadStatus: 'uploading',
    transcriptionStatus: 'pending',
    transcriptionAttempts: 0,
    createdAt: new Date().toISOString(),
  };

  // Firestore에 uploading 상태 기록 (초기 등록)
  try {
    const chunkRef = getChunkDocRef(meetingId, chunkId);
    await setDoc(chunkRef, chunkData, { merge: true });
  } catch (fsErr) {
    logger.warn('Failed to save initial chunk status to Firestore', { chunkId, error: String(fsErr) });
  }

  // 3. Firebase Storage에 직접 업로드 (지수 백오프 3회 자동 재시도 포함)
  try {
    const { downloadUrl } = await uploadAudioChunkToStorage(meetingId, chunkId, blob, mimeType);

    chunkData.uploadStatus = 'uploaded';
    chunkData.downloadUrl = downloadUrl;

    // Firestore에 업로드 완료 상태 갱신
    try {
      const chunkRef = getChunkDocRef(meetingId, chunkId);
      await setDoc(
        chunkRef,
        {
          uploadStatus: 'uploaded',
          downloadUrl,
          updatedAt: new Date().toISOString(),
        },
        { merge: true }
      );
    } catch (fsErr) {
      logger.error('Failed to update chunk uploaded status in Firestore', { chunkId, error: fsErr });
    }

    // IndexedDB에 업로드 완료 마킹
    try {
      await mark5MinChunkUploaded(meetingId, chunkId);
    } catch {
      // 무시
    }

    logger.info('Audio chunk upload fully succeeded', { chunkId, storagePath });
    return chunkData;
  } catch (uploadErr: any) {
    const errorMessage = uploadErr?.message || 'Storage 업로드에 실패했습니다.';
    logger.error('Audio chunk upload permanently failed', { chunkId, errorMessage });

    chunkData.uploadStatus = 'failed';
    chunkData.errorMessage = errorMessage;

    try {
      const chunkRef = getChunkDocRef(meetingId, chunkId);
      await setDoc(
        chunkRef,
        {
          uploadStatus: 'failed',
          errorMessage,
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

  // 1. IndexedDB에서 저장된 청크 Blob 조회
  const blob = await get5MinChunkBlob(meetingId, chunkId);
  if (!blob) {
    throw new Error('로컬 임시 저장소에서 청크 오디오 데이터를 찾을 수 없습니다.');
  }

  const chunkRef = getChunkDocRef(meetingId, chunkId);
  await updateDoc(chunkRef, { uploadStatus: 'uploading', errorMessage: null });

  // 2. 재업로드 수행
  const mimeType = blob.type || 'audio/webm';
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

  await mark5MinChunkUploaded(meetingId, chunkId);

  return {
    id: chunkId,
    meetingId,
    index: parseInt(chunkId.replace(/^chunk_/i, ''), 10) || 1,
    storagePath,
    downloadUrl,
    startSeconds: 0,
    endSeconds: 300,
    duration: 300,
    size: blob.size,
    mimeType,
    uploadStatus: 'uploaded',
    transcriptionStatus: 'pending',
    transcriptionAttempts: 0,
    createdAt: new Date().toISOString(),
  };
}

export const retryFailedAudioChunk = retryFailedChunkUpload;

/**
 * 특정 회의의 모든 청크 목록 조회
 * @param meetingId 회의 ID
 * @returns {Promise<AudioChunk[]>} 청크 목록 (인덱스 순)
 */
export async function getMeetingAudioChunks(meetingId: string): Promise<AudioChunk[]> {
  logger.info('getMeetingAudioChunks called', { meetingId });
  try {
    const q = query(getChunksCollectionRef(meetingId), orderBy('index', 'asc'));
    const snapshot = await getDocs(q);
    const chunks: AudioChunk[] = [];
    snapshot.forEach((docSnap) => {
      chunks.push(docSnap.data() as AudioChunk);
    });
    return chunks;
  } catch (err) {
    logger.warn('Failed to get chunks from Firestore', { meetingId, error: String(err) });
    return [];
  }
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
