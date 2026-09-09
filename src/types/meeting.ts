/**
 * @file src/types/meeting.ts
 * @description 회의록, 참석자, 대화록, 요약, 서명, 사진 및 버전 관리에 대한 전체 TypeScript 타입 정의
 */

import { logger } from '../utils/logger';
export * from './meetingUniversal';
import {
  MeetingRow,
  MeetingAgenda,
  ColumnDefinition,
  MeetingViewSettings,
} from './meetingUniversal';

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
  originalAiText?: string; // AI 최초 전사 원본 (보존)
  originalText?: string; // AI 전사 원문
  editedText?: string; // AI 교정 또는 사용자 수정 텍스트
  correctionStatus?: 'none' | 'pending' | 'approved' | 'rejected'; // 교정 승인 상태
  editedBy?: 'user' | 'ai_context' | 'none'; // 최종 수정자
  editedAt?: string; // 수정 시각
  correctionReason?: string; // AI 교정 사유
  rawSpeakerLabel?: string; // OpenAI 원본 화자 라벨 (A, B 등)
  isUserEdited?: boolean; // 사용자 직접 수정 여부
  needsReview: boolean; // 동시 발화, 불명확 구간, 들리지 않는 말 등
  confidence?: number;
  source?: 'manual' | 'ai_transcription' | 'openai' | 'gemini' | 'imported';
  category?: string; // 발언 구분 (예: 개회, 논의, 질의, 답변, 결정사항 등)
  suggestedCategory?: string; // AI가 제안한 발언 구분
  categoryReason?: string; // AI 구분 제안 사유
  agendaId?: string; // 연동된 상위 안건 ID
}

/**
 * 발언 및 데이터 출처 구분
 */
export type EntrySource = 'manual' | 'ai_transcription' | 'openai' | 'gemini' | 'imported';

/**
 * 사람이 직접 키보드로 입력한 회의 발언 데이터 모델
 */
export interface ManualEntry {
  id: string;
  speakerId?: string; // 참석자 ID (선택) 또는 'unassigned' | 'other'
  speakerName: string; // "김부장", "이과장", "참석자 미지정", "기타" 등
  timestampSeconds?: number; // 회의 녹음 타임스탬프 (초) - 선택사항
  text: string;
  source: EntrySource;
  isOfficial: boolean; // true: 공식 회의록 포함, false: 개인 메모 (최종 인쇄 제외)
  isImportant?: boolean; // ⭐ 중요 표시 여부 (최종 요약 시 우선순위)
  order: number; // 수동 발언 순서 (드래그앤드롭 및 위/아래 이동용)
  createdAt: string; // ISO String
  updatedAt: string; // ISO String
  createdBy?: string;
  updatedBy?: string;
}

/**
 * 사람이 직접 등록한 Action Item 데이터 모델
 */
export interface ManualActionItem {
  id: string;
  task: string; // 구체적 실행 업무
  assignee: string; // 담당자 (참석자 이름 또는 '미지정')
  dueDate: string; // 완료 기한 (YYYY-MM-DD 또는 '미지정')
  status: 'pending' | 'in_progress' | 'completed';
  source: 'manual' | 'ai';
  isImportant?: boolean;
  createdAt: string;
  updatedAt?: string;
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
  overview?: string; // 전체 회의 개요
  keyDiscussions?: string[]; // 주요 논의사항
  agendaDiscussions: AgendaDiscussion[];
  decisions: Array<{ text: string; evidenceSegmentIds?: string[] }>; // 결정 사항
  pendingItems: Array<{ text: string; evidenceSegmentIds?: string[] }>; // 미결 사항
  pendingIssues?: string[]; // 미결 사항 문자열 목록
  nextSteps?: string[]; // 차기 회의 또는 후속 조치 사항
  actionItems: ActionItem[]; // 후속 조치
  structuredActionItems?: StructuredActionItem[];
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
 * 5분 단위 오디오 청크 업로드 상태
 */
export type ChunkUploadStatus = 'recording' | 'uploading' | 'uploaded' | 'failed';

/**
 * 5분 단위 오디오 청크 전사 상태
 */
export type ChunkTranscriptionStatus = 'pending' | 'processing' | 'completed' | 'failed';

/**
 * 5분 단위 오디오 청크 데이터 모델 (meetings/{meetingId}/audioChunks/{chunkId})
 */
export interface AudioChunk {
  id: string; // 예: chunk_0001
  meetingId: string;
  index: number; // 1부터 시작 (1, 2, 3...)
  storagePath: string; // meetings/{meetingId}/audio/chunks/chunk_0001.webm
  downloadUrl?: string;
  startSeconds: number; // 구간 시작 초 (예: 0, 300, 600...)
  endSeconds: number; // 구간 종료 초 (예: 300, 600, 900...)
  duration: number; // 구간 길이 (초)
  durationSeconds?: number; // duration 별칭
  size: number; // 파일 크기 (바이트)
  fileSizeBytes?: number; // size 별칭
  mimeType: string; // audio/webm, audio/mp4 등
  uploadStatus: ChunkUploadStatus;
  transcriptionStatus: ChunkTranscriptionStatus;
  transcriptionAttempts: number;
  transcriptionStartedAt?: string;
  transcriptionCompletedAt?: string;
  provider?: 'openai' | 'gemini' | null;
  model?: string | null;
  errorCode?: string | null;
  errorMessage?: string | null;
  createdAt: string;
  transcripts?: TranscriptSegment[];
}

/**
 * 회의 전체 녹음 상태 모델
 */
export type MeetingRecordingStatus = 'idle' | 'recording' | 'finalizing' | 'recorded' | 'failed';

/**
 * 회의 전체 전사 상태 모델
 */
export type MeetingTranscriptionStatus = 'not_started' | 'queued' | 'processing' | 'partial' | 'completed' | 'failed';

/**
 * 회의 요약 생성 상태 모델
 */
export type MeetingSummaryStatus = 'not_started' | 'processing' | 'completed' | 'failed';

/**
 * 구조화된 Action Item 인터페이스
 */
export interface StructuredActionItem {
  task: string;
  assignee: string | null;
  dueDate: string | null;
  sourceTimestamp?: number;
  confidence?: 'high' | 'medium' | 'low';
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
  manualEntries?: ManualEntry[];
  freeformMemo?: string;
  manualActionItems?: ManualActionItem[];
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
  
  // 회의 내용 표 (기존 레거시 호환 및 신규 범용 시스템 병행)
  contentRows: MeetingContentRow[];
  meetingRows?: MeetingRow[]; // 범용 회의록 행 목록 (구분-화자-내용 및 확장 필드)
  meetingAgendas?: MeetingAgenda[]; // 상위 안건 목록
  meetingCategories?: string[]; // 해당 회의 전용 구분(Category) 목록
  meetingColumns?: ColumnDefinition[]; // 회의록 컬럼 구성 (사용자 정의 컬럼 포함)
  meetingTemplateId?: string; // 적용된 템플릿 ID (예: 'general_business', 'risk_assessment' 등)
  meetingViewConfig?: MeetingViewSettings; // 화면 및 인쇄 뷰 설정
  
  // 참석자 목록
  attendees: Attendee[];

  // 직접 작성 회의록 및 메모 (녹음 없이도 단독 사용 가능)
  manualEntries?: ManualEntry[]; // 화자별 직접 입력 발언
  freeformMemo?: string; // 회의 중 빠른 자유 메모
  manualActionItems?: ManualActionItem[]; // 직접 등록한 후속 조치 과제
  
  // 녹음 및 대화록
  recording?: RecordingMetadata;
  recordedDurationSeconds?: number; // 총 녹음 지속 시간(초) 영구 보존
  recordingStatus?: MeetingRecordingStatus;
  transcriptionStatus?: MeetingTranscriptionStatus;
  summaryStatus?: MeetingSummaryStatus;
  audioChunks?: AudioChunk[];
  totalChunksCount?: number;
  uploadedChunksCount?: number;
  transcribedChunksCount?: number;
  transcripts: TranscriptSegment[];
  speakerMapping: Record<string, string>; // speakerId -> attendeeId
  expectedSpeakerCount?: number; // 예상 참석 화자 수 (자동=0 또는 미지정, 1, 2, 3, 4, 5)
  customTerms?: string[]; // 회의별 필수 보호 전문용어 사전
  
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
export function createDefaultMeeting(
  authorName: string = '관리자',
  ownerUid: string = 'local_user',
  templateId: string = 'general_business',
  customTitle?: string
): Meeting {
  logger.info('createDefaultMeeting called', { authorName, ownerUid, templateId });
  const now = new Date();
  const dateStr = now.toISOString().split('T')[0];
  const startTime = '14:00';
  const endTime = '16:00';
  const newId = 'm_' + Date.now() + '_' + Math.random().toString(36).substring(2, 8);

  const defaultAttendees: Attendee[] = [
    { id: 'att_1', role: '주관자', position: '팀장', name: authorName || '홍길동', order: 0, signatures: [] },
  ];

  const defaultContentRows: MeetingContentRow[] = [
    {
      id: 'row_1',
      category: '보고사항',
      content: '전회 회의 결정사항 이행 점검 및 주요 진행 현황 보고',
      order: 0,
    },
    {
      id: 'row_2',
      category: '논의',
      content: '1. 신규 분기 업무 계획 및 현안 이슈 검토\n2. 부서 간 협조 사항 및 프로세스 개선 방안 논의',
      order: 1,
    },
    {
      id: 'row_3',
      category: '결정사항',
      content: '- 안건별 개선 추진안 확정\n- 부서별 세부 실행 계획 수립 및 차기 회의 보고',
      order: 2,
    },
  ];

  const defaultMeetingRows: MeetingRow[] = defaultContentRows.map((cr, idx) => ({
    id: cr.id,
    order: idx,
    category: cr.category,
    speakerName: authorName,
    content: cr.content,
    source: 'manual',
    isUserEdited: true,
  }));

  return {
    id: newId,
    title: customTitle || '정기 업무 회의',
    date: dateStr,
    startTime,
    endTime,
    location: '본사 대회의실',
    department: '경영지원본부',
    author: authorName,
    agenda: '부서별 주요 현안 공유 및 분기 실행 계획 심의',
    status: 'draft',
    currentVersion: 1,
    ownerId: ownerUid,
    permissions: {
      [ownerUid]: 'owner',
    },
    contentRows: defaultContentRows,
    meetingRows: defaultMeetingRows,
    meetingTemplateId: templateId,
    meetingCategories: [
      '보고사항',
      '진행사항',
      '문제점',
      '논의',
      '질의',
      '답변',
      '의견',
      '결정사항',
      '조치사항',
      '기타의견',
      '폐회',
    ],
    attendees: defaultAttendees,
    manualEntries: [],
    freeformMemo: '',
    manualActionItems: [],
    transcripts: [],
    speakerMapping: {},
    photos: [],
    versionHistory: [],
    createdAt: now.toISOString(),
    updatedAt: now.toISOString(),
  };
}
