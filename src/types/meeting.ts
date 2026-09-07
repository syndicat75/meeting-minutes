/**
 * @file src/types/meeting.ts
 * @description 회의록, 참석자, 대화록, 요약, 서명, 사진 및 버전 관리에 대한 전체 TypeScript 타입 정의
 */

import { logger } from '../utils/logger';

/**
 * 회의 진행 상태
 */
export type MeetingStatus = 'draft' | 'processing' | 'review' | 'finalized' | 'failed';

/**
 * 참석자 역할/구분
 */
export type AttendeeRole = '위원장' | '사용자위원' | '근로자위원' | '간사' | '기타' | string;
export type CommitteeRole = AttendeeRole;

/**
 * 서명 목적
 * A. attendance: 회의 참석 사실 확인 (작성 중에도 가능)
 * B. content: 검토한 최종 회의록 내용 확인 (특정 버전에 연결)
 */
export type SignaturePurpose = 'attendance' | 'content';
export type SignatureType = SignaturePurpose;

/**
 * 서명 데이터
 */
export interface AttendeeSignature {
  id: string;
  attendeeId?: string;
  purpose?: SignaturePurpose;
  type?: SignaturePurpose;
  signatureDataUrl?: string; // PNG base64 or Storage URL
  imageUrl?: string;
  storagePath?: string;
  targetVersion?: number;
  signedAt: string; // ISO String
  signedByAuthUid?: string; // 대면 서명 등록자 계정
  signedByName?: string; // 서명자 성명
  ipAddress?: string;
  userAgent?: string;
}

/**
 * 참석자 정보
 */
export interface Attendee {
  id: string;
  role: AttendeeRole;
  position: string; // 직위
  name: string; // 성명
  order: number;
  email?: string;
  department?: string;
  affiliation?: string;
  requiresResign?: boolean;
  signatures: AttendeeSignature[];
}

/**
 * 회의록 본문 표 행 데이터 ('구분 / 내용')
 */
export interface MeetingContentRow {
  id: string;
  category: string; // 구분 (예: 개회, 경과보고, 안건 심의, 자유 토의 등)
  content: string; // 내용
  order: number;
}

/**
 * 화자별 대화록 발언 단위
 */
export interface TranscriptSegment {
  id: string;
  startSeconds: number;
  endSeconds: number;
  speakerId: string; // 예: "speaker_1", "speaker_2"
  speakerName?: string; // 매핑된 참석자 이름 (없으면 화자 1 등)
  text: string;
  originalAiText?: string; // AI 원본
  isUserEdited?: boolean; // 사용자 수정 여부
  needsReview: boolean; // 동시 발화, 불명확 구간, 들리지 않는 말 등
  confidence?: number;
}

/**
 * 후속 조치 과제
 */
export interface ActionItem {
  id: string;
  task: string; // 할 일
  assignee: string; // 담당자 (없으면 '미지정')
  dueDate: string; // 기한 (없으면 '미지정')
  status: 'pending' | 'in_progress' | 'completed';
  evidenceSegmentIds?: string[]; // 근거 발언 ID
}

/**
 * 안건별 논의 내용
 */
export interface AgendaDiscussion {
  agendaTitle: string;
  discussion: string;
  evidenceSegmentIds?: string[];
}

/**
 * AI 요약 및 구조화 결과
 */
export interface MeetingSummary {
  executiveSummary: string; // 핵심 요약
  agendaDiscussions: AgendaDiscussion[];
  decisions: Array<{ text: string; evidenceSegmentIds?: string[] }>; // 결정 사항
  pendingItems: Array<{ text: string; evidenceSegmentIds?: string[] }>; // 미결 사항
  actionItems: ActionItem[]; // 후속 조치
  suggestedContentRows: MeetingContentRow[]; // 첨부 양식의 '구분 / 내용' 표 추천안
  riskAssessments?: Array<{ // 위험성평가 특화 항목
    riskFactor: string;
    countermeasure: string;
    assignee: string;
    dueDate: string;
  }>;
  generatedAt: string;
  version: number;
  isReviewedByUser: boolean;
}

/**
 * 회의 사진
 */
export interface MeetingPhoto {
  id: string;
  storagePath?: string;
  downloadUrl: string;
  caption: string;
  order: number;
  uploadedAt: string;
  fileSizeBytes?: number;
  rotation?: number; // 0, 90, 180, 270
}

/**
 * 녹음 파일 메타데이터
 */
export interface RecordingMetadata {
  id: string;
  storagePath?: string;
  downloadUrl?: string;
  durationSeconds: number;
  fileSizeBytes: number;
  mimeType: string;
  fileName: string;
  uploadedAt: string;
  isConsentGiven: boolean; // 참석자 녹음 및 AI 처리 사전 안내 확인 여부
  tempIndexedDbKey?: string; // 오프라인/임시 복구 키
  transcriptionProvider?: 'openai' | 'gemini'; // 사용된 전사 엔진
  fallbackUsed?: boolean; // Gemini fallback 전환 여부
}

/**
 * AI 전사 응답 전체 데이터
 */
export interface TranscribeResponseData {
  success: boolean;
  provider: 'openai' | 'gemini';
  fallbackUsed: boolean;
  speakers: Array<{
    speaker: string;
    startTime: number;
    endTime: number;
    text: string;
  }>;
  fullTranscript: string;
  summary: string | null;
  transcripts: TranscriptSegment[];
}

/**
 * AI 백그라운드 분석 작업 상태
 */
export interface ProcessingJob {
  jobId: string;
  meetingId: string;
  status: 'pending' | 'processing' | 'completed' | 'failed' | 'cancelled';
  progressPercent: number;
  currentStep: string;
  errorMessage?: string;
  retryCount: number;
  startedAt: string;
  completedAt?: string;
  chunkCount?: number;
  completedChunks?: number;
}

/**
 * 사용자 권한 수준
 */
export type UserRole = 'owner' | 'editor' | 'viewer';

/**
 * 회의 권한 맵 (UID -> 역할)
 */
export interface MeetingPermissions {
  [uid: string]: UserRole;
}

/**
 * 최종 확정 버전 스냅샷
 */
export interface MeetingVersionSnapshot {
  version: number;
  finalizedAt: string;
  finalizedByUid: string;
  finalizedByName: string;
  title: string;
  date: string;
  startTime: string;
  endTime: string;
  location: string;
  department: string;
  author: string;
  agenda: string;
  contentRows: MeetingContentRow[];
  attendees: Attendee[];
  photos: MeetingPhoto[];
  summary?: MeetingSummary;
  notes?: string;
}

/**
 * 회의 메인 문서 인터페이스
 */
export interface Meeting {
  id: string;
  title: string; // 기본 제목: 남부권역 위험성평가 위원회 (수정 가능)
  date: string; // YYYY-MM-DD
  startTime: string; // HH:mm
  endTime: string; // HH:mm
  location: string; // 장소
  department: string; // 사업장 또는 부서
  author: string; // 작성자
  agenda: string; // 회의 안건
  status: MeetingStatus;
  currentVersion: number;
  
  // 접근 제어
  ownerId: string;
  ownerEmail?: string;
  permissions: MeetingPermissions;
  
  // 회의 내용 표
  contentRows: MeetingContentRow[];
  
  // 참석자 목록
  attendees: Attendee[];
  
  // 녹음 및 대화록
  recording?: RecordingMetadata;
  transcripts: TranscriptSegment[];
  speakerMapping: Record<string, string>; // speakerId -> attendeeId
  
  // 요약
  summary?: MeetingSummary;
  userEditedSummary?: MeetingSummary;
  
  // 사진
  photos: MeetingPhoto[];
  
  // 활성 분석 작업
  activeJob?: ProcessingJob;
  
  // 버전 이력 및 확정 상태
  versionHistory: MeetingVersionSnapshot[];
  finalizedAt?: string;
  finalizedBy?: string;
  snapshotData?: string;
  
  // 메타데이터
  createdAt: string;
  updatedAt: string;
  isDeleted?: boolean;
}

/**
 * 새로운 기본 회의 데이터 생성 함수
 * @param authorName 작성자 성명
 * @param ownerUid 소유자 UID
 * @returns 기본 양식이 채워진 Meeting 객체
 */
export function createDefaultMeeting(authorName: string = '관리자', ownerUid: string = 'local_user'): Meeting {
  logger.info('createDefaultMeeting called', { authorName, ownerUid });
  const now = new Date();
  const dateStr = now.toISOString().split('T')[0];
  const startTime = '14:00';
  const endTime = '16:00';
  const newId = 'm_' + Date.now() + '_' + Math.random().toString(36).substring(2, 8);

  const defaultAttendees: Attendee[] = [
    { id: 'att_1', role: '위원장', position: '공장장', name: '김철수', order: 0, signatures: [] },
    { id: 'att_2', role: '사용자위원', position: '안전보건팀장', name: '이영희', order: 1, signatures: [] },
    { id: 'att_3', role: '사용자위원', position: '생산관리팀장', name: '박민수', order: 2, signatures: [] },
    { id: 'att_4', role: '근로자위원', position: '근로자대표', name: '정대현', order: 3, signatures: [] },
    { id: 'att_5', role: '근로자위원', position: '정비반장', name: '최준호', order: 4, signatures: [] },
    { id: 'att_6', role: '근로자위원', position: '현장안전원', name: '강동원', order: 5, signatures: [] },
    { id: 'att_7', role: '간사', position: '안전관리자', name: authorName || '홍길동', order: 6, signatures: [] },
  ];

  const defaultContentRows: MeetingContentRow[] = [
    {
      id: 'row_1',
      category: '개회 및 경과보고',
      content: '2026년도 상반기 남부권역 사업장 위험성평가 정기추진 결과 및 부서별 사전점검 실적 보고',
      order: 0,
    },
    {
      id: 'row_2',
      category: '안건 심의',
      content: '1. 프레스 및 혼합기 구역 방호울 센서 개선안\n2. 물류 이동 동선 지게차-보행자 분리 방안 심의\n3. 하절기 밀폐공간 유해가스 측정 및 비상대응훈련 계획',
      order: 1,
    },
    {
      id: 'row_3',
      category: '결정 및 조치사항',
      content: '- 프레스 센서 인터록 교체(안전팀/3월말한)\n- 통로 안전펜스 및 바닥 유도선 재도색(총무팀/즉시)\n- 밀폐공간 송기마스크 추가 구비(구매팀)',
      order: 2,
    },
  ];

  return {
    id: newId,
    title: '남부권역 위험성평가 위원회',
    date: dateStr,
    startTime,
    endTime,
    location: '남부사업소 대회의실 (본관 2층)',
    department: '남부권역 제조본부 / 안전보건관리팀',
    author: authorName,
    agenda: '2026년도 상반기 정기 위험성평가 실시결과 심의 및 유해위험요인 개선대책 확정',
    status: 'draft',
    currentVersion: 1,
    ownerId: ownerUid,
    permissions: {
      [ownerUid]: 'owner',
    },
    contentRows: defaultContentRows,
    attendees: defaultAttendees,
    transcripts: [],
    speakerMapping: {},
    photos: [],
    versionHistory: [],
    createdAt: now.toISOString(),
    updatedAt: now.toISOString(),
  };
}
