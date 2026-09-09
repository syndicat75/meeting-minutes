/**
 * @file src/services/meetingStructureClientService.ts
 * @description 클라이언트 측 AI 회의록 구조화, 구분 자동분류, 안건 감지 API 호출 서비스.
 * 오프라인 및 API 오류 시에도 안전한 로컬 휴리스틱 폴백을 제공합니다.
 */

import { getFirebaseIdToken } from './firebase';
import {
  CategoryClassificationSuggestion,
  DetectedAgenda,
  MeetingRow,
} from '../types/meetingUniversal';
import { Meeting, TranscriptSegment, ManualEntry } from '../types/meeting';
import { logger } from '../utils/logger';

/**
 * 1. AI 구분 자동 분류 API 호출
 */
export async function requestAiCategoryClassification(
  meeting: Meeting,
  items: Array<{ id: string; speakerName?: string; text: string; timestampSeconds?: number }>
): Promise<CategoryClassificationSuggestion[]> {
  logger.info('requestAiCategoryClassification called', { itemCount: items.length });

  const token = await getFirebaseIdToken();
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };
  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }

  const availableCategories = meeting.meetingCategories && meeting.meetingCategories.length > 0
    ? meeting.meetingCategories
    : ['개회', '보고사항', '논의', '질의', '답변', '의견', '결정사항', '조치사항', '폐회'];

  try {
    const res = await fetch('/api/ai/classify-categories', {
      method: 'POST',
      headers,
      body: JSON.stringify({
        meetingTitle: meeting.title,
        agenda: meeting.agenda,
        availableCategories,
        items,
      }),
    });

    if (res.ok) {
      const data = await res.json();
      if (data.success && Array.isArray(data.suggestions)) {
        return data.suggestions.map((s: any) => ({
          targetId: s.id || s.targetId,
          suggestedCategory: s.suggestedCategory,
          confidence: s.confidence ?? 0.85,
          reason: s.reason,
        }));
      }
    }
  } catch (err) {
    logger.warn('AI Category Classification API call failed, using client heuristic', err);
  }

  // 클라이언트 측 로컬 휴리스틱 폴백
  return items.map((it) => {
    let cat = '논의';
    const t = it.text;
    if (t.includes('개회') || t.includes('시작') || t.includes('참석')) cat = '개회';
    else if (t.includes('보고') || t.includes('현황') || t.includes('진행사항')) cat = '보고사항';
    else if (t.includes('질문') || t.includes('궁금') || t.endsWith('?')) cat = '질의';
    else if (t.includes('답변') || t.includes('설명')) cat = '답변';
    else if (t.includes('결정') || t.includes('확정') || t.includes('합의')) cat = '결정사항';
    else if (t.includes('조치') || t.includes('추진') || t.includes('실행')) cat = '조치사항';
    else if (t.includes('폐회') || t.includes('마치')) cat = '폐회';

    return {
      targetId: it.id,
      suggestedCategory: cat,
      confidence: 0.7,
      reason: '키워드 분석',
    };
  });
}

/**
 * 2. AI 안건 감지 및 그룹화 API 호출
 */
export async function requestAiAgendaDetection(
  meeting: Meeting,
  segments: TranscriptSegment[]
): Promise<DetectedAgenda[]> {
  logger.info('requestAiAgendaDetection called', { segmentCount: segments.length });

  const token = await getFirebaseIdToken();
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };
  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }

  const items = segments.map((s) => ({
    id: s.id,
    speakerName: s.speakerName || s.speakerId,
    startSeconds: s.startSeconds,
    endSeconds: s.endSeconds,
    text: s.editedText || s.text,
  }));

  try {
    const res = await fetch('/api/ai/detect-agendas', {
      method: 'POST',
      headers,
      body: JSON.stringify({
        meetingTitle: meeting.title,
        agenda: meeting.agenda,
        items,
      }),
    });

    if (res.ok) {
      const data = await res.json();
      if (data.success && Array.isArray(data.agendas)) {
        return data.agendas.map((a: any, idx: number) => ({
          id: `agenda_det_${Date.now()}_${idx}`,
          title: a.title,
          timeRange: a.timeRange,
          startSeconds: a.startSeconds,
          endSeconds: a.endSeconds,
          segmentIds: a.segmentIds || [],
          summary: a.summary,
        }));
      }
    }
  } catch (err) {
    logger.warn('AI Agenda Detection API call failed, using heuristic fallback', err);
  }

  return [
    {
      id: `agenda_det_fallback_${Date.now()}`,
      title: meeting.agenda || meeting.title || '전체 회의 안건',
      timeRange: '전체',
      segmentIds: segments.map((s) => s.id),
      summary: '회의 전체 발언을 아우르는 안건입니다.',
    },
  ];
}

/**
 * 3. AI 회의록 자동 구조화 (MeetingRow[] 합성) API 호출
 */
export async function requestAiMeetingStructure(
  meeting: Meeting
): Promise<MeetingRow[]> {
  logger.info('requestAiMeetingStructure called', { meetingId: meeting.id });

  const token = await getFirebaseIdToken();
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };
  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }

  const fullTranscript = (meeting.transcripts || [])
    .map((t) => `${t.speakerName || t.speakerId}: ${t.editedText || t.text}`)
    .join('\n');

  const manualEntries = (meeting.manualEntries || []).map((m) => ({
    speakerName: m.speakerName,
    content: m.text,
  }));

  const existingRows = (meeting.meetingRows || []).map((r) => ({
    id: r.id,
    category: r.category,
    speakerName: r.speakerName,
    content: r.content,
    isUserEdited: r.isUserEdited,
  }));

  const availableCategories = meeting.meetingCategories && meeting.meetingCategories.length > 0
    ? meeting.meetingCategories
    : ['보고사항', '논의', '결정사항', '조치사항'];

  try {
    const res = await fetch('/api/ai/structure-meeting-rows', {
      method: 'POST',
      headers,
      body: JSON.stringify({
        meetingTitle: meeting.title,
        agenda: meeting.agenda,
        department: meeting.department,
        date: meeting.date,
        attendees: meeting.attendees.map((a) => ({
          name: a.name,
          role: a.role,
          position: a.position,
        })),
        availableCategories,
        fullTranscript,
        manualEntries,
        existingRows,
      }),
    });

    if (res.ok) {
      const data = await res.json();
      if (data.success && Array.isArray(data.rows)) {
        return data.rows.map((r: any, idx: number) => ({
          id: `row_ai_${Date.now()}_${idx}`,
          order: idx,
          category: r.category || '논의',
          speakerName: r.speakerName || '',
          agendaTitle: r.agendaTitle || '',
          content: r.content || '',
          decision: r.decision || '',
          actionItemTask: r.actionItemTask || '',
          assignee: r.assignee || '',
          dueDate: r.dueDate || '',
          source: 'ai_structured',
          evidenceSegmentIds: r.evidenceSegmentIds || [],
          isUserEdited: false,
          createdAt: new Date().toISOString(),
        }));
      }
    }
  } catch (err) {
    logger.error('requestAiMeetingStructure failed', err);
  }

  // 폴백: 수동 발언이나 전사 발언을 바탕으로 기본 행 생성
  const fallbackRows: MeetingRow[] = [];
  if (meeting.contentRows && meeting.contentRows.length > 0) {
    meeting.contentRows.forEach((cr, idx) => {
      fallbackRows.push({
        id: cr.id || `row_fb_${idx}`,
        order: idx,
        category: cr.category || '논의',
        speakerName: '',
        content: cr.content || '',
        source: 'manual',
        isUserEdited: true,
      });
    });
  } else {
    fallbackRows.push({
      id: `row_fb_${Date.now()}`,
      order: 0,
      category: '논의',
      speakerName: '',
      content: meeting.agenda ? `- ${meeting.agenda} 논의 진행` : '- 회의 주요 안건 논의',
      source: 'ai_structured',
    });
  }

  return fallbackRows;
}
