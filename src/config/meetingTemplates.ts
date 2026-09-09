/**
 * @file src/config/meetingTemplates.ts
 * @description 회의 유형별 추천 템플릿, 기본 구분 목록, 기본 컬럼 정의 및 사용자 정의 템플릿 관리 모듈.
 * 특정 위원회 양식에 종속되지 않고 범용 회의록으로 작동할 수 있도록 동적 템플릿 카탈로그를 제공합니다.
 */

import {
  MeetingTemplate,
  ColumnDefinition,
  MeetingRow,
  MeetingViewSettings,
} from '../types/meetingUniversal';
import { Meeting, MeetingContentRow } from '../types/meeting';
import { logger } from '../utils/logger';

/**
 * 기본 추천 구분 목록 (선택형 + 직접 입력 가능)
 */
export const DEFAULT_RECOMMENDED_CATEGORIES: string[] = [
  '개회',
  '개회선언',
  '개회인사',
  '회의 취지 설명',
  '전 회의 결과 확인',
  '전 분기 안건 이행사항',
  '안건 설명',
  '보고사항',
  '우수사례 발표',
  '사고사례 발표',
  '사고사례 분석',
  '벤치마킹',
  '논의',
  '질의',
  '답변',
  '의견',
  '위원 의견',
  '근로자위원 의견',
  '사용자위원 의견',
  '제안',
  '검토사항',
  '심의',
  '의결',
  '결정사항',
  '조치사항',
  '향후계획',
  '기타의견',
  '폐회',
  '폐회선언',
];

/**
 * 시스템 기본 핵심 3개 컬럼 (구분, 화자, 내용)
 */
export const SYSTEM_DEFAULT_COLUMNS: ColumnDefinition[] = [
  {
    id: 'col_category',
    key: 'category',
    label: '구분',
    type: 'text',
    visible: true,
    order: 0,
    width: '130px',
    isSystem: true,
    placeholder: '구분 선택 또는 직접 입력',
    description: '회의 진행 단계 및 발언의 성격 (예: 논의, 결정사항 등)',
  },
  {
    id: 'col_speaker',
    key: 'speakerName',
    label: '화자',
    type: 'attendee',
    visible: true,
    order: 1,
    width: '120px',
    isSystem: true,
    placeholder: '화자 선택 또는 직접 입력 (빈 화자 가능)',
    description: '발언자 (참석자 목록 또는 직접 입력)',
  },
  {
    id: 'col_content',
    key: 'content',
    label: '회의 내용',
    type: 'longtext',
    visible: true,
    order: 2,
    isSystem: true,
    placeholder: '회의 내용, 발언 요지, 심의 내용 등을 입력하세요. (줄바꿈, 글머리표 지원)',
    description: '상세 회의 내용 및 발언 요지',
  },
];

/**
 * 선택적으로 활성화할 수 있는 표준 확장 컬럼 카탈로그
 */
export const STANDARD_OPTIONAL_COLUMNS: ColumnDefinition[] = [
  {
    id: 'col_agenda',
    key: 'agendaTitle',
    label: '안건',
    type: 'text',
    visible: true,
    order: 3,
    width: '140px',
    placeholder: '상위 안건명',
    description: '해당 발언이 속한 상위 논의 안건',
  },
  {
    id: 'col_sub_agenda',
    key: 'subAgenda',
    label: '세부안건',
    type: 'text',
    visible: false,
    order: 4,
    width: '130px',
    placeholder: '세부 안건',
  },
  {
    id: 'col_time',
    key: 'timeDisplay',
    label: '시간',
    type: 'text',
    visible: false,
    order: 5,
    width: '80px',
    placeholder: '00:00',
  },
  {
    id: 'col_decision',
    key: 'decision',
    label: '결정사항',
    type: 'longtext',
    visible: true,
    order: 6,
    width: '160px',
    placeholder: '합의 또는 결정된 사항',
  },
  {
    id: 'col_action_task',
    key: 'actionItemTask',
    label: '조치사항',
    type: 'text',
    visible: true,
    order: 7,
    width: '160px',
    placeholder: '후속 조치 업무',
  },
  {
    id: 'col_assignee',
    key: 'assignee',
    label: '담당자',
    type: 'attendee',
    visible: true,
    order: 8,
    width: '100px',
    placeholder: '담당자명',
  },
  {
    id: 'col_due_date',
    key: 'dueDate',
    label: '기한',
    type: 'date',
    visible: true,
    order: 9,
    width: '110px',
    placeholder: 'YYYY-MM-DD',
  },
  {
    id: 'col_status',
    key: 'status',
    label: '진행상태',
    type: 'status',
    visible: false,
    order: 10,
    width: '90px',
    options: ['대기', '진행중', '검토중', '완료'],
  },
  {
    id: 'col_department',
    key: 'department',
    label: '관련부서',
    type: 'text',
    visible: false,
    order: 11,
    width: '110px',
    placeholder: '관련 부서명',
  },
  {
    id: 'col_reference',
    key: 'referenceMaterial',
    label: '관련자료',
    type: 'text',
    visible: false,
    order: 12,
    width: '110px',
    placeholder: '참고 문서/자료',
  },
  {
    id: 'col_importance',
    key: 'importance',
    label: '중요도',
    type: 'select',
    visible: false,
    order: 13,
    width: '80px',
    options: ['낮음', '보통', '높음', '긴급'],
  },
  {
    id: 'col_notes',
    key: 'notes',
    label: '비고',
    type: 'text',
    visible: false,
    order: 14,
    width: '110px',
    placeholder: '기타 참고사항',
  },
];

/**
 * 기본 뷰 및 인쇄 설정
 */
export const DEFAULT_VIEW_SETTINGS: MeetingViewSettings = {
  contentViewMode: 'table',
  printViewMode: 'standard',
  mergeCategoryCells: true,
  visibleColumnKeys: ['category', 'speakerName', 'content', 'decision', 'actionItemTask', 'assignee', 'dueDate'],
};

/**
 * 내장 회의 유형별 표준 템플릿 목록 (13종 + 사용자 정의)
 */
export const BUILT_IN_MEETING_TEMPLATES: MeetingTemplate[] = [
  {
    id: 'general_business',
    name: '일반 업무회의',
    description: '부서별 업무 보고, 현안 논의, 결정사항 및 Action Item 도출에 최적화된 표준 업무회의 양식',
    typeCategory: '일반',
    categories: ['보고사항', '진행사항', '문제점', '논의', '결정사항', 'Action Item', '기타의견', '폐회'],
    defaultColumns: [
      ...SYSTEM_DEFAULT_COLUMNS,
      { ...STANDARD_OPTIONAL_COLUMNS.find((c) => c.key === 'decision')!, visible: true },
      { ...STANDARD_OPTIONAL_COLUMNS.find((c) => c.key === 'actionItemTask')!, visible: true },
      { ...STANDARD_OPTIONAL_COLUMNS.find((c) => c.key === 'assignee')!, visible: true },
      { ...STANDARD_OPTIONAL_COLUMNS.find((c) => c.key === 'dueDate')!, visible: true },
    ],
    defaultAgendas: [
      { title: '주요 부서별 진행 현황 공유', order: 0 },
      { title: '현안 및 이슈 해결 방안 논의', order: 1 },
      { title: '결정사항 및 후속 과업 확정', order: 2 },
    ],
    defaultPrintViewMode: 'standard',
    mergeCategoryCells: true,
  },
  {
    id: 'risk_assessment',
    name: '위험성평가위원회',
    description: '사업장 우수사례 발표, 위험성평가 벤치마킹, 사고사례 분석 및 유해위험 개선대책 심의 회의',
    typeCategory: '안전보건',
    categories: ['개회인사', '사업장 우수사례 발표', '위험성평가 벤치마킹', '사고사례 분석', '심의안건', '종합의견', '조치사항', '폐회'],
    defaultColumns: [
      ...SYSTEM_DEFAULT_COLUMNS,
      { ...STANDARD_OPTIONAL_COLUMNS.find((c) => c.key === 'agendaTitle')!, visible: true },
      { ...STANDARD_OPTIONAL_COLUMNS.find((c) => c.key === 'decision')!, visible: true },
      { ...STANDARD_OPTIONAL_COLUMNS.find((c) => c.key === 'actionItemTask')!, visible: true },
      { ...STANDARD_OPTIONAL_COLUMNS.find((c) => c.key === 'assignee')!, visible: true },
      { ...STANDARD_OPTIONAL_COLUMNS.find((c) => c.key === 'dueDate')!, visible: true },
    ],
    defaultPrintViewMode: 'standard',
    mergeCategoryCells: true,
  },
  {
    id: 'safety_health_committee',
    name: '산업안전보건위원회',
    description: '법정 정기 산업안전보건위원회 회의. 전 분기 이행점검, 심의안건, 근로자위원 의견청취 및 의결',
    typeCategory: '안전보건',
    categories: ['개회', '전 분기 안건 이행사항', '심의안건', '근로자위원 의견청취', '사용자위원 의견', '의결', '기타의견', '폐회'],
    defaultColumns: [
      ...SYSTEM_DEFAULT_COLUMNS,
      { ...STANDARD_OPTIONAL_COLUMNS.find((c) => c.key === 'agendaTitle')!, visible: true },
      { ...STANDARD_OPTIONAL_COLUMNS.find((c) => c.key === 'decision')!, visible: true },
      { ...STANDARD_OPTIONAL_COLUMNS.find((c) => c.key === 'actionItemTask')!, visible: true },
      { ...STANDARD_OPTIONAL_COLUMNS.find((c) => c.key === 'assignee')!, visible: true },
      { ...STANDARD_OPTIONAL_COLUMNS.find((c) => c.key === 'dueDate')!, visible: true },
    ],
    defaultPrintViewMode: 'table',
    mergeCategoryCells: true,
  },
  {
    id: 'safety_consultative',
    name: '안전보건협의체',
    description: '도급인 및 수급인 간 작업 연락조정, 위험성평가 협의 및 안전보건 조치사항 협의 회의',
    typeCategory: '안전보건',
    categories: ['개회', '협의사항', '작업간 연락조정', '위험성평가 협의', '수급인 건의사항', '결정사항', '폐회'],
    defaultColumns: SYSTEM_DEFAULT_COLUMNS,
    defaultPrintViewMode: 'standard',
    mergeCategoryCells: true,
  },
  {
    id: 'labor_management',
    name: '노사협의회',
    description: '근로자와 사용자 간의 복지, 근로조건, 고충처리 및 상호 신뢰 증진을 위한 정기 협의회',
    typeCategory: '인사노무',
    categories: ['개회선언', '보고사항', '협의사항', '근로자위원 건의', '사용자위원 답변', '의결사항', '폐회'],
    defaultColumns: SYSTEM_DEFAULT_COLUMNS,
    defaultPrintViewMode: 'standard',
    mergeCategoryCells: true,
  },
  {
    id: 'incident_investigation',
    name: '사고조사회의',
    description: '사업장 안전사고 및 이상 징후 원인 규명, 재발방지대책 수립 및 시정조치 계획 회의',
    typeCategory: '사고조사',
    categories: ['개요보고', '발생원인 분석', '피해현황', '사고사례 분석', '재발방지대책', '부서별 조치계획', '의결', '폐회'],
    defaultColumns: SYSTEM_DEFAULT_COLUMNS,
    defaultPrintViewMode: 'table',
    mergeCategoryCells: true,
  },
  {
    id: 'countermeasure_meeting',
    name: '대책회의',
    description: '긴급 현안, 클레임, 돌발 리스크 발생 시 신속한 원인분석과 비상 대응 조치를 논의하는 회의',
    typeCategory: '경영관리',
    categories: ['현안보고', '원인분석', '긴급조치사항', '중장기대책', '역할분담', '기한', '폐회'],
    defaultColumns: SYSTEM_DEFAULT_COLUMNS,
    defaultPrintViewMode: 'standard',
    mergeCategoryCells: true,
  },
  {
    id: 'management_meeting',
    name: '경영회의',
    description: '경영진 및 주요 임원진 참석 주간/월간 경영 실적, 리스크 점검 및 핵심 지시사항 전달 회의',
    typeCategory: '경영관리',
    categories: ['경영실적 보고', '주요 현안 논의', '리스크 점검', '경영진 지시사항', '부서별 목표', '결정사항', '폐회'],
    defaultColumns: SYSTEM_DEFAULT_COLUMNS,
    defaultPrintViewMode: 'standard',
    mergeCategoryCells: true,
  },
  {
    id: 'performance_meeting',
    name: '실적회의',
    description: '월간/분기 실적 점검, 목표 대비 달성률 분석, 부진 원인 분석 및 만회 대책 수립 회의',
    typeCategory: '경영관리',
    categories: ['목표 대비 실적', '달성률 분석', '미달원인', '만회대책', '익월 계획', '결정사항', '폐회'],
    defaultColumns: SYSTEM_DEFAULT_COLUMNS,
    defaultPrintViewMode: 'table',
    mergeCategoryCells: true,
  },
  {
    id: 'project_meeting',
    name: '프로젝트회의',
    description: 'WBS 일정 진척률, 마일스톤 점검, 기술 이슈 해결, 변경 요청 및 차주 일정 계획 회의',
    typeCategory: '프로젝트',
    categories: ['WBS 진행현황', '마일스톤 점검', '이슈 및 위험', '변경요청', '차주 계획', 'Action Item', '폐회'],
    defaultColumns: SYSTEM_DEFAULT_COLUMNS,
    defaultPrintViewMode: 'standard',
    mergeCategoryCells: true,
  },
  {
    id: 'training_meeting',
    name: '교육회의',
    description: '사내 직무, 안전, 보안 등 필수 교육 진행 후 질의응답 및 피드백 기록을 위한 회의',
    typeCategory: '교육훈련',
    categories: ['교육목적 설명', '교육내용 전달', '질의', '답변', '이해도 확인', '피드백', '폐회'],
    defaultColumns: SYSTEM_DEFAULT_COLUMNS,
    defaultPrintViewMode: 'standard',
    mergeCategoryCells: true,
  },
  {
    id: 'tbm',
    name: 'TBM (작업 전 안전점검회의)',
    description: '현장 작업 시작 전 위험요인 전파, 개인보호구 점검, 작업절차 및 안전수칙을 공유하는 미팅',
    typeCategory: '안전보건',
    categories: ['작업개요', '위험요인 공유', '안전보호구 점검', '금일 안전지침', '건의사항', '구호제창'],
    defaultColumns: SYSTEM_DEFAULT_COLUMNS,
    defaultPrintViewMode: 'standard',
    mergeCategoryCells: false,
  },
  {
    id: 'etc',
    name: '기타 회의',
    description: '자유로운 주제로 진행되는 일반 회의 및 비정기 미팅',
    typeCategory: '일반',
    categories: ['개회', '안건 설명', '논의', '결정사항', '기타의견', '폐회'],
    defaultColumns: SYSTEM_DEFAULT_COLUMNS,
    defaultPrintViewMode: 'standard',
    mergeCategoryCells: true,
  },
];

const USER_CUSTOM_TEMPLATES_STORAGE_KEY = 'ai_meeting_user_custom_templates_v1';

/**
 * 전체 템플릿 목록 (빌트인 + 사용자 정의) 반환
 */
export function getAllTemplates(): MeetingTemplate[] {
  const customTemplates = getUserCustomTemplates();
  return [...BUILT_IN_MEETING_TEMPLATES, ...customTemplates];
}

export const saveCustomTemplate = saveUserCustomTemplate;
export const deleteCustomTemplate = deleteUserCustomTemplate;

/**
 * 템플릿 ID로 템플릿 정보 조회 (사용자 정의 포함)
 * @param templateId 템플릿 식별자
 */
export function getMeetingTemplateById(templateId: string): MeetingTemplate | undefined {
  const builtIn = BUILT_IN_MEETING_TEMPLATES.find((t) => t.id === templateId);
  if (builtIn) return builtIn;

  const userCustoms = getUserCustomTemplates();
  return userCustoms.find((t) => t.id === templateId);
}

/**
 * 사용자가 생성하여 저장한 '내 템플릿' 목록 조회
 */
export function getUserCustomTemplates(): MeetingTemplate[] {
  try {
    const raw = localStorage.getItem(USER_CUSTOM_TEMPLATES_STORAGE_KEY);
    if (!raw) return [];
    return JSON.parse(raw);
  } catch (err) {
    logger.error('Failed to load user custom templates from localStorage', err);
    return [];
  }
}

/**
 * 새 사용자 정의 템플릿 저장 ('내 템플릿')
 */
export function saveUserCustomTemplate(template: Omit<MeetingTemplate, 'id' | 'createdAt' | 'isCustom'>): MeetingTemplate {
  logger.info('saveUserCustomTemplate called', { name: template.name });
  const existing = getUserCustomTemplates();
  const newTemplate: MeetingTemplate = {
    ...template,
    id: 'custom_tmpl_' + Date.now(),
    isCustom: true,
    createdAt: new Date().toISOString(),
  };

  const updated = [newTemplate, ...existing];
  try {
    localStorage.setItem(USER_CUSTOM_TEMPLATES_STORAGE_KEY, JSON.stringify(updated));
  } catch (err) {
    logger.error('Failed to persist user custom template', err);
  }
  return newTemplate;
}

/**
 * 사용자 정의 템플릿 삭제
 */
export function deleteUserCustomTemplate(templateId: string): boolean {
  logger.info('deleteUserCustomTemplate called', { templateId });
  const existing = getUserCustomTemplates();
  const filtered = existing.filter((t) => t.id !== templateId);
  try {
    localStorage.setItem(USER_CUSTOM_TEMPLATES_STORAGE_KEY, JSON.stringify(filtered));
    return true;
  } catch (err) {
    logger.error('Failed to delete custom template from localStorage', err);
    return false;
  }
}

/**
 * 기존 회의(Legacy) 또는 신규 회의의 meetingRows, categories, columns, viewConfig를
 * 비파괴 방식으로 100% 안전하게 보장하는 정규화 함수.
 * 기존 contentRows 데이터가 유실되지 않도록 meetingRows로 자동 동기화합니다.
 */
export function ensureMeetingUniversalFields(meeting: Meeting): Meeting {
  if (!meeting) return meeting;

  // 1. 카테고리(구분) 목록 보장
  let meetingCategories = meeting.meetingCategories;
  if (!meetingCategories || meetingCategories.length === 0) {
    const defaultTemplate = getMeetingTemplateById(meeting.meetingTemplateId || 'general_business');
    meetingCategories = defaultTemplate ? [...defaultTemplate.categories] : [...DEFAULT_RECOMMENDED_CATEGORIES];
  }

  // 2. 컬럼 정의 보장
  let meetingColumns = meeting.meetingColumns;
  if (!meetingColumns || meetingColumns.length === 0) {
    meetingColumns = [
      ...SYSTEM_DEFAULT_COLUMNS,
      { ...STANDARD_OPTIONAL_COLUMNS.find((c) => c.key === 'agendaTitle')!, visible: true },
      { ...STANDARD_OPTIONAL_COLUMNS.find((c) => c.key === 'decision')!, visible: true },
      { ...STANDARD_OPTIONAL_COLUMNS.find((c) => c.key === 'actionItemTask')!, visible: true },
      { ...STANDARD_OPTIONAL_COLUMNS.find((c) => c.key === 'assignee')!, visible: true },
      { ...STANDARD_OPTIONAL_COLUMNS.find((c) => c.key === 'dueDate')!, visible: true },
    ];
  }

  // 3. 뷰 설정 보장
  const meetingViewConfig: MeetingViewSettings = {
    contentViewMode: meeting.meetingViewConfig?.contentViewMode || 'table',
    printViewMode: meeting.meetingViewConfig?.printViewMode || 'standard',
    mergeCategoryCells: meeting.meetingViewConfig?.mergeCategoryCells ?? true,
    visibleColumnKeys: meeting.meetingViewConfig?.visibleColumnKeys || [
      'category',
      'speakerName',
      'content',
      'decision',
      'actionItemTask',
      'assignee',
      'dueDate',
    ],
  };

  // 4. meetingRows 데이터 보장 (기존 contentRows 완벽 호환 변환)
  let meetingRows = meeting.meetingRows;
  if (!meetingRows || meetingRows.length === 0) {
    if (meeting.contentRows && meeting.contentRows.length > 0) {
      meetingRows = meeting.contentRows.map((cr, idx) => ({
        id: cr.id || `row_legacy_${idx}`,
        order: cr.order ?? idx,
        category: cr.category || '논의',
        speakerName: '',
        content: cr.content || '',
        source: 'manual',
        isUserEdited: true,
      }));
    } else {
      meetingRows = [];
    }
  }

  // 5. 역호환성을 위해 contentRows도 동기화 보장
  const contentRows: MeetingContentRow[] = meetingRows.map((r, idx) => ({
    id: r.id,
    category: r.category || '논의',
    content: r.content || '',
    order: r.order ?? idx,
  }));

  return {
    ...meeting,
    meetingRows,
    meetingCategories,
    meetingColumns,
    meetingViewConfig,
    contentRows: contentRows.length > 0 ? contentRows : meeting.contentRows || [],
  };
}
