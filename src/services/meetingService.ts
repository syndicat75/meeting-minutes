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

export const createNewMeetingTemplate = createDefaultMeeting;

const MEETINGS_COLLECTION = 'meetings';

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
 * @param userUid 현재 로그인한 사용자의 UID (기본값: 'local_user')
 * @returns {Promise<Meeting[]>} 접근 가능한 회의 목록
 */
export async function fetchMeetings(userUid: string = 'local_user'): Promise<Meeting[]> {
  logger.info('fetchMeetings called', { userUid });
  const db = getFirebaseDb();

  if (!db) {
    logger.info('Using local fallback storage for fetchMeetings');
    const local = getLocalMeetings();
    // 로그인 사용자 UID 기준 필터링 또는 로컬 전체 (로컬 모드일 때)
    return local.filter(
      (m) => !m.isDeleted && (m.ownerId === userUid || m.permissions[userUid] || userUid === 'local_user')
    );
  }

  try {
    // Firestore 쿼리: ownerId == userUid
    const meetingsRef = collection(db, MEETINGS_COLLECTION);
    const q = query(meetingsRef, where('ownerId', '==', userUid), orderBy('updatedAt', 'desc'));
    const snapshot = await getDocs(q);

    const meetings: Meeting[] = [];
    snapshot.forEach((docSnap) => {
      const data = docSnap.data() as Meeting;
      if (!data.isDeleted) {
        meetings.push({ ...data, id: docSnap.id });
      }
    });

    // 공유받은 회의도 추가 조회 (permissions 필드에 현재 UID가 포함된 경우)
    const sharedQuery = query(meetingsRef, where(`permissions.${userUid}`, 'in', ['editor', 'viewer']));
    const sharedSnapshot = await getDocs(sharedQuery);
    sharedSnapshot.forEach((docSnap) => {
      if (!meetings.some((m) => m.id === docSnap.id)) {
        const data = docSnap.data() as Meeting;
        if (!data.isDeleted) {
          meetings.push({ ...data, id: docSnap.id });
        }
      }
    });

    logger.info('fetchMeetings completed successfully', { count: meetings.length });
    return meetings;
  } catch (err: any) {
    logger.error('fetchMeetings from Firestore failed, falling back to local', { error: err?.message });
    const local = getLocalMeetings();
    return local.filter((m) => !m.isDeleted);
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
 * @param meeting 저장할 회의 데이터
 * @param userUid 요청자 UID (기본값: 'local_user')
 */
export async function saveMeeting(meeting: Meeting, userUid: string = 'local_user'): Promise<void> {
  logger.info('saveMeeting called', { meetingId: meeting.id, userUid, status: meeting.status });
  meeting.updatedAt = new Date().toISOString();

  // 1. 항상 로컬 캐시/폴백에도 동기화
  const localList = getLocalMeetings();
  const existingIdx = localList.findIndex((m) => m.id === meeting.id);
  if (existingIdx >= 0) {
    localList[existingIdx] = meeting;
  } else {
    localList.unshift(meeting);
  }
  saveLocalMeetings(localList);

  const db = getFirebaseDb();
  if (!db) {
    logger.info('Firebase not connected, saved to localStorage only');
    return;
  }

  try {
    const docRef = doc(db, MEETINGS_COLLECTION, meeting.id);
    await setDoc(docRef, {
      ...meeting,
      _serverTimestamp: serverTimestamp(),
    }, { merge: true });
    logger.info('Meeting saved to Firestore successfully', { meetingId: meeting.id });
  } catch (err: any) {
    logger.error('Failed to save meeting to Firestore', { error: err?.message });
    throw new Error(`클라우드 저장 실패: ${err?.message || '네트워크 오류'}`);
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
 * 회의 삭제 (소유자만 가능)
 * @param meetingId 회의 ID
 * @param userUid 요청자 UID (기본값: 'local_user')
 */
export async function deleteMeeting(meetingId: string, userUid: string = 'local_user'): Promise<void> {
  logger.info('deleteMeeting called', { meetingId, userUid });

  // 로컬 삭제
  const local = getLocalMeetings();
  const updatedLocal = local.filter((m) => m.id !== meetingId);
  saveLocalMeetings(updatedLocal);

  const db = getFirebaseDb();
  if (!db) return;

  try {
    const docRef = doc(db, MEETINGS_COLLECTION, meetingId);
    const snap = await getDoc(docRef);
    if (snap.exists()) {
      const data = snap.data() as Meeting;
      if (data.ownerId !== userUid && userUid !== 'local_user') {
        throw new Error('회의 소유자만 회의를 삭제할 수 있습니다.');
      }
      await deleteDoc(docRef);
      logger.info('Meeting deleted from Firestore', { meetingId });
    }
  } catch (err: any) {
    logger.error('deleteMeeting error', { meetingId, error: err?.message });
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
