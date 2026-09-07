/**
 * @file src/services/manualEntryService.ts
 * @description 사람이 직접 키보드로 입력한 회의 발언, 자유 메모 및 직접 등록 Action Item을 관리하는 서비스.
 * 고유 ID 생성, 타임스탬프 포맷팅, 순서 재배열, 오프라인 임시 로컬스토리지 백업 및 복원 기능을 제공합니다.
 */

import { ManualEntry, ManualActionItem, EntrySource } from '../types/meeting';
import { logger } from '../utils/logger';

const LOCAL_STORAGE_PREFIX = 'ai_meeting_manual_backup_';

/**
 * 로컬 임시 백업 페이로드 인터페이스
 */
export interface ManualEntryBackupPayload {
  meetingId: string;
  manualEntries: ManualEntry[];
  freeformMemo: string;
  manualActionItems: ManualActionItem[];
  savedAt: string;
}

/**
 * 신규 직접 작성 발언 객체 생성
 * @param {Object} params 발언 생성 파라미터
 * @param {string} [params.speakerId] 참석자 ID 또는 'unassigned' | 'other'
 * @param {string} params.speakerName 발언자 성명/직함
 * @param {number} [params.timestampSeconds] 녹음 타임스탬프 (초 단위)
 * @param {string} params.text 발언 본문 텍스트
 * @param {boolean} [params.isOfficial] 공식 회의록 포함 여부 (기본 true)
 * @param {boolean} [params.isImportant] 중요(⭐) 표시 여부 (기본 false)
 * @param {number} params.order 발언 순서
 * @param {string} [params.userId] 작성자 식별자
 * @returns {ManualEntry} 생성된 ManualEntry 객체
 */
export function createNewManualEntry(params: {
  speakerId?: string;
  speakerName: string;
  timestampSeconds?: number;
  text: string;
  isOfficial?: boolean;
  isImportant?: boolean;
  order: number;
  userId?: string;
}): ManualEntry {
  logger.info('createNewManualEntry called', {
    speakerName: params.speakerName,
    hasTimestamp: typeof params.timestampSeconds === 'number',
    order: params.order,
  });

  const now = new Date().toISOString();
  const id = `entry_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;

  return {
    id,
    speakerId: params.speakerId || 'unassigned',
    speakerName: params.speakerName.trim() || '참석자 미지정',
    timestampSeconds: typeof params.timestampSeconds === 'number' ? params.timestampSeconds : undefined,
    text: params.text.trim(),
    source: 'manual',
    isOfficial: params.isOfficial !== undefined ? params.isOfficial : true,
    isImportant: Boolean(params.isImportant),
    order: params.order,
    createdAt: now,
    updatedAt: now,
    createdBy: params.userId || 'local_user',
    updatedBy: params.userId || 'local_user',
  };
}

/**
 * 신규 수동 등록 Action Item 생성
 * @param {Object} params 액션 아이템 파라미터
 * @param {string} params.task 할 일
 * @param {string} [params.assignee] 담당자 성명
 * @param {string} [params.dueDate] 완료 기한
 * @param {boolean} [params.isImportant] 중요 여부
 * @returns {ManualActionItem} 생성된 ManualActionItem 객체
 */
export function createNewManualActionItem(params: {
  task: string;
  assignee?: string;
  dueDate?: string;
  isImportant?: boolean;
}): ManualActionItem {
  logger.info('createNewManualActionItem called', { task: params.task });

  const now = new Date().toISOString();
  const id = `act_manual_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;

  return {
    id,
    task: params.task.trim(),
    assignee: params.assignee?.trim() || '미지정',
    dueDate: params.dueDate?.trim() || '미지정',
    status: 'pending',
    source: 'manual',
    isImportant: Boolean(params.isImportant),
    createdAt: now,
    updatedAt: now,
  };
}

/**
 * 발언 목록 순서 재정렬 (위/아래 이동)
 * @param {ManualEntry[]} entries 원본 발언 배열
 * @param {number} fromIndex 이동할 요소의 현재 인덱스
 * @param {number} toIndex 이동할 목표 인덱스
 * @returns {ManualEntry[]} 재정렬되고 order가 갱신된 발언 배열
 */
export function reorderManualEntries(
  entries: ManualEntry[],
  fromIndex: number,
  toIndex: number
): ManualEntry[] {
  logger.info('reorderManualEntries called', { fromIndex, toIndex, total: entries.length });

  if (fromIndex < 0 || fromIndex >= entries.length || toIndex < 0 || toIndex >= entries.length) {
    return entries;
  }

  const result = [...entries];
  const [movedItem] = result.splice(fromIndex, 1);
  result.splice(toIndex, 0, movedItem);

  // order 값 재정렬 (0부터 시작)
  return result.map((item, idx) => ({
    ...item,
    order: idx,
    updatedAt: new Date().toISOString(),
  }));
}

/**
 * 타임스탬프 기준으로 발언 오름차순 정렬
 * (타임스탬프가 없는 발언은 작성 순서 유지)
 * @param {ManualEntry[]} entries 정렬할 발언 배열
 * @returns {ManualEntry[]} 시간순 정렬된 발언 배열
 */
export function sortManualEntriesByTimestamp(entries: ManualEntry[]): ManualEntry[] {
  logger.info('sortManualEntriesByTimestamp called', { count: entries.length });

  const withTime = entries.filter((e) => typeof e.timestampSeconds === 'number');
  const withoutTime = entries.filter((e) => typeof e.timestampSeconds !== 'number');

  withTime.sort((a, b) => (a.timestampSeconds || 0) - (b.timestampSeconds || 0));

  const sorted = [...withTime, ...withoutTime];
  return sorted.map((item, idx) => ({
    ...item,
    order: idx,
  }));
}

/**
 * 브라우저 로컬 스토리지에 직접 입력 내용 임시 백업 (오프라인/새로고침 보호)
 * @param {string} meetingId 회의 ID
 * @param {ManualEntry[]} manualEntries 직접 입력 발언 배열
 * @param {string} freeformMemo 자유 메모 본문
 * @param {ManualActionItem[]} manualActionItems 직접 등록 액션 아이템
 */
export function saveManualEntryLocalBackup(
  meetingId: string,
  manualEntries: ManualEntry[],
  freeformMemo: string,
  manualActionItems: ManualActionItem[]
): void {
  try {
    const payload: ManualEntryBackupPayload = {
      meetingId,
      manualEntries,
      freeformMemo,
      manualActionItems,
      savedAt: new Date().toISOString(),
    };
    localStorage.setItem(`${LOCAL_STORAGE_PREFIX}${meetingId}`, JSON.stringify(payload));
    logger.debug('Manual entry local backup saved', { meetingId, entriesCount: manualEntries.length });
  } catch (err) {
    logger.warn('Failed to save manual entry local backup', { meetingId, error: String(err) });
  }
}

/**
 * 브라우저 로컬 스토리지에서 직접 입력 임시 백업 조회
 * @param {string} meetingId 회의 ID
 * @returns {ManualEntryBackupPayload | null} 백업 데이터 또는 null
 */
export function getManualEntryLocalBackup(meetingId: string): ManualEntryBackupPayload | null {
  try {
    const raw = localStorage.getItem(`${LOCAL_STORAGE_PREFIX}${meetingId}`);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as ManualEntryBackupPayload;
    logger.info('Manual entry local backup retrieved', { meetingId, savedAt: parsed.savedAt });
    return parsed;
  } catch (err) {
    logger.warn('Failed to read manual entry local backup', { meetingId, error: String(err) });
    return null;
  }
}

/**
 * 브라우저 로컬 스토리지 임시 백업 삭제
 * @param {string} meetingId 회의 ID
 */
export function clearManualEntryLocalBackup(meetingId: string): void {
  try {
    localStorage.removeItem(`${LOCAL_STORAGE_PREFIX}${meetingId}`);
    logger.info('Manual entry local backup cleared', { meetingId });
  } catch (err) {
    logger.warn('Failed to clear manual entry local backup', { meetingId, error: String(err) });
  }
}
