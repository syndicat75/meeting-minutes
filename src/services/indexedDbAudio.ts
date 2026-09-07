/**
 * @file src/services/indexedDbAudio.ts
 * @description 브라우저 IndexedDB를 활용하여 실시간 녹음 청크 및 오디오 Blob을 안전하게 임시 보관하는 서비스.
 * 비정상 종료/새로고침 시 재접속 복구 시도를 지원하며, 서버 업로드 완료 확인 전에는 자동 삭제하지 않습니다.
 */

import { logger } from '../utils/logger';

const DB_NAME = 'AiMeetingAudioStorage';
const DB_VERSION = 2;
const STORE_CHUNKS = 'audio_chunks';
const STORE_METADATA = 'recording_sessions';
const STORE_5MIN_CHUNKS = 'audio_5min_chunks';

export interface Stored5MinChunk {
  meetingId: string;
  chunkId: string;
  index: number;
  blob: Blob;
  mimeType: string;
  startSeconds: number;
  endSeconds: number;
  createdAt: string;
  isUploaded: boolean;
}

export interface StoredAudioSession {
  meetingId: string;
  startedAt: string;
  durationSeconds: number;
  mimeType: string;
  chunksCount: number;
  isCompleted: boolean;
  isUploadedToServer: boolean;
}

/**
 * IndexedDB 데이터베이스 연결 객체 열기
 * @returns {Promise<IDBDatabase>} IDBDatabase 인스턴스
 */
export function openAudioDatabase(): Promise<IDBDatabase> {
  logger.debug('openAudioDatabase called');
  return new Promise((resolve, reject) => {
    if (typeof window === 'undefined' || !window.indexedDB) {
      const err = new Error('이 브라우저는 IndexedDB를 지원하지 않습니다.');
      logger.error('IndexedDB not supported', err);
      reject(err);
      return;
    }

    const request = window.indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = (event) => {
      const db = (event.target as IDBOpenDBRequest).result;
      logger.info('Upgrading IndexedDB schema', { oldVersion: event.oldVersion, newVersion: DB_VERSION });
      if (!db.objectStoreNames.contains(STORE_CHUNKS)) {
        db.createObjectStore(STORE_CHUNKS, { keyPath: ['meetingId', 'chunkIndex'] });
      }
      if (!db.objectStoreNames.contains(STORE_METADATA)) {
        db.createObjectStore(STORE_METADATA, { keyPath: 'meetingId' });
      }
      if (!db.objectStoreNames.contains(STORE_5MIN_CHUNKS)) {
        db.createObjectStore(STORE_5MIN_CHUNKS, { keyPath: ['meetingId', 'chunkId'] });
      }
    };

    request.onsuccess = () => {
      resolve(request.result);
    };

    request.onerror = () => {
      logger.error('Failed to open IndexedDB', request.error);
      reject(request.error);
    };
  });
}

/**
 * 녹음 세션 시작 및 메타데이터 기록
 * @param meetingId 회의 ID
 * @param mimeType 오디오 MIME 타입
 */
export async function initAudioSession(meetingId: string, mimeType: string): Promise<void> {
  logger.info('initAudioSession called', { meetingId, mimeType });
  const db = await openAudioDatabase();
  return new Promise((resolve, reject) => {
    const tx = db.transaction([STORE_METADATA], 'readwrite');
    const store = tx.objectStore(STORE_METADATA);
    const session: StoredAudioSession = {
      meetingId,
      startedAt: new Date().toISOString(),
      durationSeconds: 0,
      mimeType,
      chunksCount: 0,
      isCompleted: false,
      isUploadedToServer: false,
    };
    const req = store.put(session);
    req.onsuccess = () => resolve();
    req.onerror = () => {
      logger.error('initAudioSession failed to save metadata', req.error);
      reject(req.error);
    };
  });
}

/**
 * 녹음 중 생성된 오디오 청크 Blob을 IndexedDB에 순차 저장
 * @param meetingId 회의 ID
 * @param chunkIndex 청크 순번
 * @param chunkBlob 오디오 Blob 청크
 */
export async function appendAudioChunk(meetingId: string, chunkIndex: number, chunkBlob: Blob): Promise<void> {
  logger.debug('appendAudioChunk called', { meetingId, chunkIndex, byteLength: chunkBlob.size });
  const db = await openAudioDatabase();
  return new Promise((resolve, reject) => {
    const tx = db.transaction([STORE_CHUNKS, STORE_METADATA], 'readwrite');
    const chunksStore = tx.objectStore(STORE_CHUNKS);
    const metaStore = tx.objectStore(STORE_METADATA);

    // 청크 저장
    chunksStore.put({
      meetingId,
      chunkIndex,
      blob: chunkBlob,
      timestamp: Date.now(),
    });

    // 메타데이터 업데이트
    const metaReq = metaStore.get(meetingId);
    metaReq.onsuccess = () => {
      if (metaReq.result) {
        const meta = metaReq.result as StoredAudioSession;
        meta.chunksCount = Math.max(meta.chunksCount, chunkIndex + 1);
        metaStore.put(meta);
      }
    };

    tx.oncomplete = () => resolve();
    tx.onerror = () => {
      logger.error('appendAudioChunk transaction failed', tx.error);
      reject(tx.error);
    };
  });
}

/**
 * 저장된 모든 청크를 모아 완전한 단일 오디오 Blob으로 조합
 * @param meetingId 회의 ID
 * @returns {Promise<Blob | null>} 합쳐진 오디오 Blob 또는 없으면 null
 */
export async function getCombinedAudioBlob(meetingId: string): Promise<Blob | null> {
  logger.info('getCombinedAudioBlob called', { meetingId });
  const db = await openAudioDatabase();
  return new Promise((resolve, reject) => {
    const tx = db.transaction([STORE_CHUNKS, STORE_METADATA], 'readonly');
    const metaStore = tx.objectStore(STORE_METADATA);
    const chunksStore = tx.objectStore(STORE_CHUNKS);

    const metaReq = metaStore.get(meetingId);
    metaReq.onsuccess = () => {
      const meta = metaReq.result as StoredAudioSession | undefined;
      if (!meta) {
        logger.warn('No session metadata found in IndexedDB', { meetingId });
        resolve(null);
        return;
      }

      const chunksReq = chunksStore.getAll();
      chunksReq.onsuccess = () => {
        const allItems = (chunksReq.result || []) as Array<{
          meetingId: string;
          chunkIndex: number;
          blob: Blob;
        }>;
        const meetingChunks = allItems
          .filter((item) => item.meetingId === meetingId)
          .sort((a, b) => a.chunkIndex - b.chunkIndex)
          .map((item) => item.blob);

        if (meetingChunks.length === 0) {
          logger.warn('No chunks found for meetingId in IndexedDB', { meetingId });
          resolve(null);
          return;
        }

        const combinedBlob = new Blob(meetingChunks, { type: meta.mimeType || 'audio/webm' });
        logger.info('Successfully assembled audio blob from IndexedDB', {
          meetingId,
          chunksCount: meetingChunks.length,
          totalBytes: combinedBlob.size,
        });
        resolve(combinedBlob);
      };
      chunksReq.onerror = () => reject(chunksReq.error);
    };
    metaReq.onerror = () => reject(metaReq.error);
  });
}

/**
 * 복구 가능한 임시 녹음 세션 목록 조회
 * @returns {Promise<StoredAudioSession[]>} 아직 업로드되지 않은 임시 세션 목록
 */
export async function getRecoverableAudioSessions(): Promise<StoredAudioSession[]> {
  logger.info('getRecoverableAudioSessions called');
  try {
    const db = await openAudioDatabase();
    return new Promise((resolve, reject) => {
      const tx = db.transaction([STORE_METADATA], 'readonly');
      const store = tx.objectStore(STORE_METADATA);
      const req = store.getAll();
      req.onsuccess = () => {
        const list = (req.result || []) as StoredAudioSession[];
        const pending = list.filter((s) => !s.isUploadedToServer && s.chunksCount > 0);
        logger.info('Found recoverable sessions', { count: pending.length });
        resolve(pending);
      };
      req.onerror = () => reject(req.error);
    });
  } catch (err) {
    logger.warn('getRecoverableAudioSessions encountered error', { error: String(err) });
    return [];
  }
}

/**
 * 서버 업로드 확인 후 로컬 임시 오디오 데이터 삭제
 * @param meetingId 회의 ID
 */
export async function removeAudioSession(meetingId: string): Promise<void> {
  logger.info('removeAudioSession called', { meetingId });
  const db = await openAudioDatabase();
  return new Promise((resolve, reject) => {
    const tx = db.transaction([STORE_CHUNKS, STORE_METADATA], 'readwrite');
    const chunksStore = tx.objectStore(STORE_CHUNKS);
    const metaStore = tx.objectStore(STORE_METADATA);

    // 메타데이터 삭제
    metaStore.delete(meetingId);

    // 해당 meetingId에 속한 청크 키 조회 후 삭제
    const chunksReq = chunksStore.getAllKeys();
    chunksReq.onsuccess = () => {
      const keys = chunksReq.result as Array<[string, number]>;
      for (const key of keys) {
        if (Array.isArray(key) && key[0] === meetingId) {
          chunksStore.delete(key);
        }
      }
    };

    tx.oncomplete = () => {
      logger.info('Audio session removed from IndexedDB', { meetingId });
      resolve();
    };
    tx.onerror = () => {
      logger.error('Failed to remove audio session', tx.error);
      reject(tx.error);
    };
  });
}

/**
 * 5분 단위 오디오 청크 Blob을 IndexedDB에 안전하게 저장 (브라우저 크래시 복구용)
 * @param meetingId 회의 ID
 * @param chunkId 청크 ID (예: chunk_0001)
 * @param index 순번 (1부터 시작)
 * @param blob 청크 오디오 Blob
 * @param mimeType 오디오 MIME 타입
 * @param startSeconds 시작 초
 * @param endSeconds 종료 초
 */
export async function save5MinChunkBlob(
  meetingId: string,
  chunkId: string,
  index: number,
  blob: Blob,
  mimeType: string,
  startSeconds: number,
  endSeconds: number
): Promise<void> {
  logger.info('save5MinChunkBlob called', { meetingId, chunkId, index, sizeBytes: blob.size });
  const db = await openAudioDatabase();
  return new Promise((resolve, reject) => {
    const tx = db.transaction([STORE_5MIN_CHUNKS], 'readwrite');
    const store = tx.objectStore(STORE_5MIN_CHUNKS);
    const item: Stored5MinChunk = {
      meetingId,
      chunkId,
      index,
      blob,
      mimeType,
      startSeconds,
      endSeconds,
      createdAt: new Date().toISOString(),
      isUploaded: false,
    };
    const req = store.put(item);
    req.onsuccess = () => resolve();
    req.onerror = () => {
      logger.error('save5MinChunkBlob failed', req.error);
      reject(req.error);
    };
  });
}

/**
 * 특정 5분 오디오 청크 Blob 조회
 * @param meetingId 회의 ID
 * @param chunkId 청크 ID
 * @returns {Promise<Blob | null>}
 */
export async function get5MinChunkBlob(meetingId: string, chunkId: string): Promise<Blob | null> {
  logger.info('get5MinChunkBlob called', { meetingId, chunkId });
  const db = await openAudioDatabase();
  return new Promise((resolve, reject) => {
    const tx = db.transaction([STORE_5MIN_CHUNKS], 'readonly');
    const store = tx.objectStore(STORE_5MIN_CHUNKS);
    const req = store.get([meetingId, chunkId]);
    req.onsuccess = () => {
      const result = req.result as Stored5MinChunk | undefined;
      resolve(result?.blob || null);
    };
    req.onerror = () => {
      logger.error('get5MinChunkBlob failed', req.error);
      reject(req.error);
    };
  });
}

/**
 * 특정 회의의 모든 5분 청크 데이터 조회 (복구용)
 * @param meetingId 회의 ID
 * @returns {Promise<Stored5MinChunk[]>}
 */
export async function getAll5MinChunks(meetingId: string): Promise<Stored5MinChunk[]> {
  logger.info('getAll5MinChunks called', { meetingId });
  const db = await openAudioDatabase();
  return new Promise((resolve, reject) => {
    const tx = db.transaction([STORE_5MIN_CHUNKS], 'readonly');
    const store = tx.objectStore(STORE_5MIN_CHUNKS);
    const req = store.getAll();
    req.onsuccess = () => {
      const all = (req.result || []) as Stored5MinChunk[];
      const meetingChunks = all
        .filter((c) => c.meetingId === meetingId)
        .sort((a, b) => a.index - b.index);
      resolve(meetingChunks);
    };
    req.onerror = () => {
      logger.error('getAll5MinChunks failed', req.error);
      reject(req.error);
    };
  });
}

/**
 * 5분 청크 업로드 완료 상태 갱신
 * @param meetingId 회의 ID
 * @param chunkId 청크 ID
 */
export async function mark5MinChunkUploaded(meetingId: string, chunkId: string): Promise<void> {
  logger.debug('mark5MinChunkUploaded called', { meetingId, chunkId });
  const db = await openAudioDatabase();
  return new Promise((resolve, reject) => {
    const tx = db.transaction([STORE_5MIN_CHUNKS], 'readwrite');
    const store = tx.objectStore(STORE_5MIN_CHUNKS);
    const req = store.get([meetingId, chunkId]);
    req.onsuccess = () => {
      const item = req.result as Stored5MinChunk | undefined;
      if (item) {
        item.isUploaded = true;
        store.put(item);
      }
      resolve();
    };
    req.onerror = () => reject(req.error);
  });
}

/**
 * 회의 관련 5분 청크 데이터 일괄 삭제
 * @param meetingId 회의 ID
 */
export async function remove5MinChunks(meetingId: string): Promise<void> {
  logger.info('remove5MinChunks called', { meetingId });
  const db = await openAudioDatabase();
  return new Promise((resolve, reject) => {
    const tx = db.transaction([STORE_5MIN_CHUNKS], 'readwrite');
    const store = tx.objectStore(STORE_5MIN_CHUNKS);
    const req = store.getAllKeys();
    req.onsuccess = () => {
      const keys = req.result as Array<[string, string]>;
      for (const key of keys) {
        if (Array.isArray(key) && key[0] === meetingId) {
          store.delete(key);
        }
      }
    };
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

