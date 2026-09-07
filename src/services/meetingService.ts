/**
 * @file src/services/meetingService.ts
 * @description 회의 문서의 Firestore CRUD, 권한 검증, 서브컬렉션/스냅샷 버전 관리 및 오프라인 로컬 저장소 동기화 서비스.
 */

import {
  collection,
  doc,
  getDoc,
  getDocs,
  setDoc,
  updateDoc,
  deleteDoc,
  query,
  where,
  orderBy,
  serverTimestamp,
} from 'firebase/firestore';
import { getFirebaseDb } from './firebase';
import {
  Meeting,
  MeetingVersionSnapshot,
  MeetingStatus,
  createDefaultMeeting,
} from '../types/meeting';
import { STORAGE_KEYS } from '../config/appConfig';
import { logger } from '../utils/logger';

export const MEETINGS_COLLECTION = 'meetings';

/**
 * 새 회의 템플릿 생성 어댑터
 * App.tsx에서 전달하는 (ownerUid, authorName) 인수를 createDefaultMeeting(authorName, ownerUid)에 올바르게 매핑합니다.
 * @param ownerUid 소유자 UID (Firebase 로그인 사용자 UID 또는 'local_user')
 * @param authorName 작성자 성명 (표시 이름 또는 '관리자')
 * @returns {Meeting} 초기화된 회의 객체
 */
export function createNewMeetingTemplate(
  ownerUid: string = 'local_user',
  authorName: string = '관리자'
): Meeting {
  logger.info('createNewMeetingTemplate called', { ownerUid, authorName });
  return createDefaultMeeting(authorName, ownerUid);
}

/**
 * 회의가 로컬 전용 초안인지 판별
 * - ownerId가 'local_user'인 경우
 * - 이전 버전 버그로 인해 author='local_user', ownerId='관리자'로 잘못 반전 저장된 경우
 * @param meeting 검사할 회의 객체
 * @returns {boolean} 로컬 초안 여부
 */
export function isLocalDraftMeeting(meeting: Meeting): boolean {
  if (!meeting) return false;
  if (meeting.ownerId === 'local_user') return true;
  // 기존 버그로 author='local_user' 및 ownerId='관리자'로 교차 저장된 로컬 초안 식별
  if (meeting.ownerId === '관리자' && meeting.author === 'local_user') return true;
  if (meeting.ownerId === '관리자' && !meeting.ownerId.includes('_') && !meeting.id.startsWith('c_')) {
    return true;
  }
  return false;
}

/**
 * Firestore 저장을 위해 undefined 값을 안전하게 제거하는 재귀 정제 유틸리티
 * Firestore는 객체 필드에 undefined가 포함되어 있으면 저장을 거부하고 오류를 발생시킵니다.
 * @param data 정제할 데이터
 * @returns undefined가 제거된 복사본
 */
export function sanitizeForFirestore<T>(data: T): T {
  if (data === null || data === undefined) {
    return data;
  }
  if (Array.isArray(data)) {
    return data.map((item) => sanitizeForFirestore(item)) as unknown as T;
  }
  if (typeof data === 'object' && !(data instanceof Date)) {
    const cleaned: Record<string, any> = {};
    for (const [key, value] of Object.entries(data)) {
      if (value !== undefined) {
        cleaned[key] = sanitizeForFirestore(value);
      }
    }
    return cleaned as T;
  }
  return data;
}

/**
 * 로컬스토리지 폴백 데이터 로드
 * @returns {Meeting[]} 로컬에 저장된 회의 목록
 */
function getLocalMeetings(): Meeting[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEYS.MEETINGS_FALLBACK);
    if (!raw) return [];
    return JSON.parse(raw);
  } catch (err) {
    logger.warn('Failed to parse local meetings', { error: String(err) });
    return [];
  }
}

/**
 * 로컬스토리지 폴백 데이터 저장
 * @param meetings 저장할 회의 배열
 */
function saveLocalMeetings(meetings: Meeting[]): void {
  try {
    localStorage.setItem(STORAGE_KEYS.MEETINGS_FALLBACK, JSON.stringify(meetings));
  } catch (err) {
    logger.error('Failed to save meetings to localStorage', err);
  }
}

/**
 * 현재 사용자가 접근 가능한 회의 목록 조회
 * - 클라우드 조회 실패 시 다른 계정의 로컬 캐시를 보여주지 않습니다.
 * - 복합 인덱스(Composite Index) 오류를 방지하기 위해 메모리 내에서 정렬합니다.
 * - 기기에 남아 있는 로컬 초안을 보존하여 함께 표시합니다.
 * @param userUid 현재 로그인한 사용자의 UID (기본값: 'local_user')
 * @returns {Promise<Meeting[]>} 접근 가능한 회의 목록
 */
export async function fetchMeetings(userUid: string = 'local_user'): Promise<Meeting[]> {
  logger.info('fetchMeetings called', { userUid });
  const db = getFirebaseDb();
  const local = getLocalMeetings();

  // 1. 오프라인 또는 Firebase 미연결 시 로컬 캐시에서 본인 자료 및 로컬 초안만 안전하게 필터링
  if (!db || userUid === 'local_user') {
    logger.info('Using local storage filter for fetchMeetings', { userUid });
    return local.filter(
      (m) => !m.isDeleted && (isLocalDraftMeeting(m) || m.ownerId === userUid || (m.permissions && m.permissions[userUid]))
    );
  }

  try {
    const meetingsRef = collection(db, MEETINGS_COLLECTION);

    // 복합 인덱스 오류를 피하기 위해 Firestore 쿼리에서 orderBy를 제거하고 메모리 정렬 수행
    const q = query(meetingsRef, where('ownerId', '==', userUid));
    const snapshot = await getDocs(q);

    const cloudMeetings: Meeting[] = [];
    snapshot.forEach((docSnap) => {
      const data = docSnap.data() as Meeting;
      if (!data.isDeleted) {
        cloudMeetings.push({ ...data, id: docSnap.id });
      }
    });

    // 공유받은 회의 추가 조회 (permissions 필드에 현재 UID가 포함된 경우)
    try {
      const sharedQuery = query(meetingsRef, where(`permissions.${userUid}`, 'in', ['editor', 'viewer']));
      const sharedSnapshot = await getDocs(sharedQuery);
      sharedSnapshot.forEach((docSnap) => {
        if (!cloudMeetings.some((m) => m.id === docSnap.id)) {
          const data = docSnap.data() as Meeting;
          if (!data.isDeleted) {
            cloudMeetings.push({ ...data, id: docSnap.id });
          }
        }
      });
    } catch (sharedErr) {
      logger.warn('Failed to fetch shared meetings', sharedErr);
    }

    // 로컬에만 존재하는 초안도 결합 (사용자가 기기에서 작성하던 로컬 초안 보존)
    const localDrafts = local.filter((m) => !m.isDeleted && isLocalDraftMeeting(m));
    const mergedList: Meeting[] = [...cloudMeetings];
    for (const draft of localDrafts) {
      if (!mergedList.some((m) => m.id === draft.id)) {
        mergedList.push(draft);
      }
    }

    // 최신 수정일 기준 메모리 정렬
    mergedList.sort((a, b) => {
      const timeA = new Date(a.updatedAt || a.createdAt || 0).getTime();
      const timeB = new Date(b.updatedAt || b.createdAt || 0).getTime();
      return timeB - timeA;
    });

    logger.info('fetchMeetings completed successfully', { totalCount: mergedList.length, cloudCount: cloudMeetings.length });
    return mergedList;
  } catch (err: any) {
    logger.error('fetchMeetings from Firestore failed', { error: err?.message });
    // 다른 계정의 캐시를 노출하지 않고, 현재 계정 본인 소유 또는 로컬 초안만 반환
    return local.filter(
      (m) => !m.isDeleted && (m.ownerId === userUid || (m.permissions && m.permissions[userUid]) || isLocalDraftMeeting(m))
    );
  }
}

/**
 * 특정 ID의 회의 문서 단건 조회
 * @param meetingId 회의 ID
 * @param userUid 요청자 UID
 * @returns {Promise<Meeting | null>}
 */
export async function getMeetingById(meetingId: string, userUid: string): Promise<Meeting | null> {
  logger.info('getMeetingById called', { meetingId, userUid });
  const db = getFirebaseDb();

  if (!db) {
    const local = getLocalMeetings();
    const found = local.find((m) => m.id === meetingId && !m.isDeleted);
    return found || null;
  }

  try {
    const docRef = doc(db, MEETINGS_COLLECTION, meetingId);
    const docSnap = await getDoc(docRef);

    if (!docSnap.exists()) {
      logger.warn('Meeting document not found in Firestore', { meetingId });
      return null;
    }

    const meeting = docSnap.data() as Meeting;
    // 접근 권한 확인
    const isOwner = meeting.ownerId === userUid;
    const isShared = meeting.permissions && meeting.permissions[userUid];

    if (!isOwner && !isShared && userUid !== 'local_user') {
      logger.error('Access denied to meeting', { meetingId, userUid });
      throw new Error('이 회의에 접근할 수 있는 권한이 없습니다.');
    }

    return { ...meeting, id: docSnap.id };
  } catch (err: any) {
    logger.error('getMeetingById error', { meetingId, message: err?.message });
    // 로컬 백업 확인
    const local = getLocalMeetings();
    return local.find((m) => m.id === meetingId) || null;
  }
}

/**
 * 회의 신규 생성 또는 전체 저장
 * - undefined 필드를 정제하여 Firestore 직렬화 오류를 방지합니다.
 * - 클라우드 저장 실패 시 조용히 넘기지 않고 명확한 에러를 발생시킵니다.
 * @param meeting 저장할 회의 데이터
 * @param userUid 요청자 UID (기본값: 'local_user')
 */
export async function saveMeeting(meeting: Meeting, userUid: string = 'local_user'): Promise<void> {
  logger.info('saveMeeting called', { meetingId: meeting.id, userUid, status: meeting.status });
  meeting.updatedAt = new Date().toISOString();

  const db = getFirebaseDb();
  const isDraft = isLocalDraftMeeting(meeting) || userUid === 'local_user';

  // 로컬 전용 초안이거나 Firebase 미연결 시 로컬스토리지에만 저장
  if (!db || isDraft) {
    logger.info('Saving to local storage only (local draft or offline)', { meetingId: meeting.id, isDraft });
    const localList = getLocalMeetings();
    const existingIdx = localList.findIndex((m) => m.id === meeting.id);
    if (existingIdx >= 0) {
      localList[existingIdx] = meeting;
    } else {
      localList.unshift(meeting);
    }
    saveLocalMeetings(localList);
    return;
  }

  // 클라우드 문서 저장 (Firestore)
  try {
    const docRef = doc(db, MEETINGS_COLLECTION, meeting.id);
    const sanitizedData = sanitizeForFirestore({
      ...meeting,
      _serverTimestamp: serverTimestamp(),
    });

    await setDoc(docRef, sanitizedData, { merge: true });
    logger.info('Meeting saved to Firestore successfully', { meetingId: meeting.id });

    // 서버 저장 성공 후 로컬 캐시 갱신
    const localList = getLocalMeetings();
    const existingIdx = localList.findIndex((m) => m.id === meeting.id);
    if (existingIdx >= 0) {
      localList[existingIdx] = meeting;
    } else {
      localList.unshift(meeting);
    }
    saveLocalMeetings(localList);
  } catch (err: any) {
    logger.error('Failed to save meeting to Firestore', { error: err?.message, meetingId: meeting.id });
    throw new Error(`클라우드 저장 실패: ${err?.message || '네트워크 및 보안 규칙 확인 필요'}`);
  }
}

/**
 * 기존 회의의 양식 및 참석자만 복사하여 새로운 회의 생성
 * (기존 녹음, 사진, 서명, 확정 상태는 제외)
 * @param sourceMeeting 복사 대상 원본 회의
 * @param userUid 생성자 UID
 * @param authorName 생성자 성명
 * @returns {Promise<Meeting>} 신규 복사된 회의 객체
 */
export async function duplicateMeetingTemplate(
  sourceMeeting: Meeting,
  userUid: string,
  authorName: string
): Promise<Meeting> {
  logger.info('duplicateMeetingTemplate called', { sourceId: sourceMeeting.id, userUid });

  const now = new Date();
  const dateStr = now.toISOString().split('T')[0];
  const newId = 'm_' + Date.now() + '_' + Math.random().toString(36).substring(2, 8);

  // 참석자 복사하되 서명은 완전 초기화
  const clonedAttendees = sourceMeeting.attendees.map((att, idx) => ({
    ...att,
    id: `att_${idx + 1}_${Date.now()}`,
    signatures: [],
  }));

  // 본문 행 복사
  const clonedContentRows = sourceMeeting.contentRows.map((row, idx) => ({
    ...row,
    id: `row_${idx + 1}_${Date.now()}`,
  }));

  const newMeeting: Meeting = {
    id: newId,
    title: sourceMeeting.title,
    date: dateStr,
    startTime: sourceMeeting.startTime,
    endTime: sourceMeeting.endTime,
    location: sourceMeeting.location,
    department: sourceMeeting.department,
    author: authorName,
    agenda: sourceMeeting.agenda,
    status: 'draft',
    currentVersion: 1,
    ownerId: userUid,
    permissions: {
      [userUid]: 'owner',
    },
    contentRows: clonedContentRows,
    attendees: clonedAttendees,
    transcripts: [],
    speakerMapping: {},
    photos: [],
    versionHistory: [],
    createdAt: now.toISOString(),
    updatedAt: now.toISOString(),
  };

  await saveMeeting(newMeeting, userUid);
  return newMeeting;
}

/**
 * 회의 삭제
 * - 로컬 초안은 로컬 저장소에서만 즉시 안전하게 삭제합니다 (Firestore 호출 불필요).
 * - 클라우드 문서는 소유자 권한 확인 및 Firestore 삭제 성공 후 로컬 캐시를 삭제합니다.
 * - 서버 삭제 실패 시 로컬 캐시를 삭제하지 않고 오류를 발생시킵니다.
 * @param meetingId 회의 ID
 * @param userUid 요청자 UID (기본값: 'local_user')
 */
export async function deleteMeeting(meetingId: string, userUid: string = 'local_user'): Promise<void> {
  logger.info('deleteMeeting called', { meetingId, userUid });

  const local = getLocalMeetings();
  const target = local.find((m) => m.id === meetingId);
  const db = getFirebaseDb();

  // 1. 로컬 초안이거나 오프라인 모드인 경우 로컬에서만 삭제
  const isDraft = !target || isLocalDraftMeeting(target) || (!db && userUid === 'local_user');
  if (isDraft) {
    logger.info('Deleting local draft meeting from localStorage', { meetingId });
    const updatedLocal = local.filter((m) => m.id !== meetingId);
    saveLocalMeetings(updatedLocal);
    return;
  }

  // 2. 클라우드 문서인 경우 소유자 권한 사전 검증
  if (target && target.ownerId !== userUid && userUid !== 'local_user') {
    throw new Error('회의 소유자만 클라우드 회의록을 삭제할 수 있습니다.');
  }

  if (!db) {
    throw new Error('클라우드 문서를 삭제하려면 Firebase 네트워크 연결이 필요합니다.');
  }

  try {
    const docRef = doc(db, MEETINGS_COLLECTION, meetingId);
    const snap = await getDoc(docRef);

    if (snap.exists()) {
      const data = snap.data() as Meeting;
      if (data.ownerId !== userUid && userUid !== 'local_user') {
        throw new Error(`회의 소유자만 삭제할 수 있습니다. (등록된 소유자: ${data.author || data.ownerId})`);
      }
      // Firestore에서 먼저 삭제
      await deleteDoc(docRef);
      logger.info('Meeting deleted from Firestore successfully', { meetingId });
    }

    // 서버 삭제가 성공한 경우에만 로컬 캐시에서 제거
    const updatedLocal = local.filter((m) => m.id !== meetingId);
    saveLocalMeetings(updatedLocal);
  } catch (err: any) {
    logger.error('deleteMeeting error - preserved local record', { meetingId, error: err?.message });
    throw err;
  }
}

/**
 * 최종 확정 스냅샷 생성 및 회의 확정
 * @param meeting 확정할 회의
 * @param finalizedByUid 확정자 UID
 * @param finalizedByName 확정자 성명
 * @returns {Promise<Meeting>} 확정된 회의 객체
 */
export async function finalizeMeeting(
  meeting: Meeting,
  finalizedByUid: string,
  finalizedByName: string
): Promise<Meeting> {
  logger.info('finalizeMeeting called', { meetingId: meeting.id, finalizedByUid });

  if (meeting.ownerId !== finalizedByUid && finalizedByUid !== 'local_user') {
    throw new Error('회의 소유자만 최종 확정을 수행할 수 있습니다.');
  }

  const snapshot: MeetingVersionSnapshot = {
    version: meeting.currentVersion,
    finalizedAt: new Date().toISOString(),
    finalizedByUid,
    finalizedByName,
    title: meeting.title,
    date: meeting.date,
    startTime: meeting.startTime,
    endTime: meeting.endTime,
    location: meeting.location,
    department: meeting.department,
    author: meeting.author,
    agenda: meeting.agenda,
    contentRows: JSON.parse(JSON.stringify(meeting.contentRows)),
    attendees: JSON.parse(JSON.stringify(meeting.attendees)),
    photos: JSON.parse(JSON.stringify(meeting.photos)),
    summary: meeting.userEditedSummary || meeting.summary,
  };

  const updated: Meeting = {
    ...meeting,
    status: 'finalized',
    versionHistory: [...(meeting.versionHistory || []), snapshot],
    updatedAt: new Date().toISOString(),
  };

  await saveMeeting(updated, finalizedByUid);
  return updated;
}

/**
 * 최종 확정 취소 및 재작성 상태로 전환 (새 버전 생성 준비)
 * @param meeting 회의
 * @param userUid 요청자 UID
 * @returns {Promise<Meeting>}
 */
export async function unfinalizeMeeting(meeting: Meeting, userUid: string): Promise<Meeting> {
  logger.info('unfinalizeMeeting called', { meetingId: meeting.id, userUid });

  if (meeting.ownerId !== userUid && userUid !== 'local_user') {
    throw new Error('회의 소유자만 확정을 취소할 수 있습니다.');
  }

  const updated: Meeting = {
    ...meeting,
    status: 'review',
    currentVersion: meeting.currentVersion + 1,
    updatedAt: new Date().toISOString(),
  };

  await saveMeeting(updated, userUid);
  return updated;
}
