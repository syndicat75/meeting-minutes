/**
 * @file src/types/meetingUniversal.ts
 * @description 자유도 높은 범용 회의록 작성 시스템을 위한 핵심 데이터 모델 및 타입 정의.
 * 특정 위원회 양식에 종속되지 않고 사용자가 원하는 구분, 화자, 내용, 안건, 선택적 필드 및 사용자 정의 컬럼을
 * 유연하게 확장/구성할 수 있도록 지원합니다.
 */

import { EntrySource } from './meeting';

/**
 * 회의록 본문의 기본 단위: 회의록 항목 (Row)
 */
export interface MeetingRow {
  id: string;
  order: number;
  
  // 상위 안건 연동 (선택사항)
  agendaId?: string;
  agendaTitle?: string;
  subAgenda?: string;

  // 기본 핵심 3개 필드
  category: string; // 구분 (예: 개회선언, 우수사례 발표, 논의, 결정사항 등 - 사용자 자유 추가 가능)
  speakerId?: string; // 참석자 ID 또는 'unassigned' | 'other'
  speakerName?: string; // 화자 성명 (참석자 목록 선택 또는 직접 입력, 빈 값 허용)
  content: string; // 회의 내용 (줄바꿈, bullet, 번호목록 지원)

  // 선택적 확장 필드
  timestampSeconds?: number;
  timeDisplay?: string;
  decision?: string; // 결정사항
  actionItemId?: string; // 연동된 Action Item ID
  actionItemTask?: string; // 연동된 후속조치 업무 내용
  assignee?: string; // 담당자
  dueDate?: string; // 기한 (YYYY-MM-DD 등)
  status?: string; // 진행상태 (예: 완료, 진행중, 검토중 등)
  department?: string; // 관련부서
  referenceMaterial?: string; // 관련 자료
  importance?: 'low' | 'medium' | 'high' | 'urgent'; // 중요도
  notes?: string; // 비고

  // 원본 근거 및 출처
  source?: 'ai_transcription' | 'manual' | 'ai_structured' | 'user_edited' | 'ai_correction';
  evidenceSegmentIds?: string[]; // 근거가 된 전사 세그먼트 ID 목록
  isUserEdited?: boolean; // 사용자가 직접 수정한 행 여부 (AI 재작성 시 보호)

  // 사용자 정의 임의 컬럼 값 매핑 (키: ColumnDefinition.key)
  customFields?: Record<string, any>;

  createdAt?: string;
  updatedAt?: string;
}

/**
 * 상위 안건 모델
 */
export interface MeetingAgenda {
  id: string;
  title: string;
  description?: string;
  order: number;
  decision?: string;
  timeRange?: string; // 예: "00:15 ~ 07:20"
  segmentIds?: string[];
}

/**
 * 컬럼 데이터 타입
 */
export type ColumnType =
  | 'text' // 일반 단문 텍스트
  | 'longtext' // 장문 텍스트
  | 'number' // 숫자
  | 'date' // 날짜
  | 'select' // 단일 선택 드롭다운
  | 'checkbox' // 체크박스 (참/거짓)
  | 'attendee' // 참석자 선택
  | 'status'; // 상태 배지

/**
 * 회의록 컬럼 정의 (사용자 정의 컬럼 및 순서 관리)
 */
export interface ColumnDefinition {
  id: string;
  key: string;
  label: string;
  type: ColumnType;
  visible: boolean;
  order: number;
  width?: string;
  isSystem?: boolean; // 구분(category), 화자(speaker), 내용(content)은 기본 필수
  options?: string[]; // select 타입용 선택지 목록
  placeholder?: string;
  description?: string;
}

/**
 * 회의 내용 화면 보기 방식
 */
export type MeetingContentViewMode = 'table' | 'card' | 'agenda_group' | 'timeline';
export type ContentViewMode = MeetingContentViewMode;

/**
 * 회의 최종 인쇄 / 출력 양식
 */
export type MeetingPrintViewMode = 'standard' | 'table' | 'agenda' | 'speaker' | 'custom';

/**
 * 회의 뷰 및 인쇄 설정
 */
export interface MeetingViewSettings {
  contentViewMode: MeetingContentViewMode;
  printViewMode: MeetingPrintViewMode;
  mergeCategoryCells: boolean; // 표형 출력 시 동일 구분 셀 병합 여부
  visibleColumnKeys: string[]; // 화면 및 인쇄에 노출할 컬럼 키 목록
}

/**
 * 회의 유형별 템플릿 모델
 */
export interface MeetingTemplate {
  id: string;
  name: string;
  description: string;
  typeCategory: string;
  categories: string[]; // 추천 구분 목록
  defaultColumns: ColumnDefinition[];
  defaultAgendas?: Array<{ title: string; order: number }>;
  defaultPrintViewMode?: MeetingPrintViewMode;
  mergeCategoryCells?: boolean;
  isCustom?: boolean; // 사용자가 저장한 '내 템플릿'
  createdAt?: string;
  icon?: string;
}

/**
 * AI 구분 분류 제안 단위
 */
export interface CategoryClassificationSuggestion {
  targetId: string; // segmentId 또는 manualEntryId
  suggestedCategory: string;
  confidence: number;
  reason?: string;
}

/**
 * AI 감지 안건 단위
 */
export interface DetectedAgenda {
  id: string;
  title: string;
  timeRange?: string;
  startSeconds?: number;
  endSeconds?: number;
  segmentIds: string[];
  summary?: string;
}
