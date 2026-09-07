/**
 * @file server.ts
 * @description AI 회의록 관리 풀스택 Express 서버.
 * Vite 개발 미들웨어 및 Gemini API 기반 음성 전사(/api/ai/transcribe), 회의록 요약(/api/ai/summarize) API를 제공합니다.
 */

import express, { Request, Response } from 'express';
import path from 'path';
import dotenv from 'dotenv';
import multer from 'multer';
import { createServer as createViteServer } from 'vite';
import { GoogleGenAI, Type, Schema } from '@google/genai';

dotenv.config();

const app = express();
const PORT = 3000;

// JSON 및 대용량 요청 본문 파서 설정
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

// 오디오 파일 메모리 업로드용 Multer 설정
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 200 * 1024 * 1024 }, // 200MB
});

/**
 * Gemini SDK 클라이언트 지연(Lazy) 초기화 함수
 * @returns {GoogleGenAI} 초기화된 GenAI 인스턴스
 */
let genAiClient: GoogleGenAI | null = null;
function getGenAi(): GoogleGenAI {
  if (!genAiClient) {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      console.warn('[SERVER] GEMINI_API_KEY가 설정되지 않았습니다.');
    }
    genAiClient = new GoogleGenAI({ apiKey: apiKey || '' });
  }
  return genAiClient;
}

/**
 * 서버 상태 점검 헬스체크 엔드포인트
 */
app.get('/api/health', (req: Request, res: Response) => {
  console.log('[SERVER] GET /api/health');
  res.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    hasGeminiKey: Boolean(process.env.GEMINI_API_KEY),
    model: 'gemini-2.5-flash',
  });
});

/**
 * 음성 전사(STT) API: /api/ai/transcribe
 * 오디오 데이터를 Gemini 2.5 Flash 모델에 전달하여 화자별 대화록 세그먼트로 변환합니다.
 */
app.post('/api/ai/transcribe', upload.single('audioFile'), async (req: Request, res: Response) => {
  console.log('[SERVER] POST /api/ai/transcribe called');
  try {
    const meetingId = req.body.meetingId;
    const meetingTitle = req.body.meetingTitle || '위험성평가 위원회 회의';
    const agenda = req.body.agenda || '';
    let attendeeNames: string[] = [];
    if (req.body.attendeeNames) {
      try {
        attendeeNames = JSON.parse(req.body.attendeeNames);
      } catch (e) {
        // ignore
      }
    }

    const audioFile = req.file;

    // Gemini API Key 검증
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      console.warn('[SERVER] GEMINI_API_KEY 미설정. 기본 템플릿 대화록을 반환합니다.');
      // API 키가 없을 때 사용자가 앱 테스트를 즉시 진행할 수 있도록 현실적인 위험성평가 기본 대화록 제공
      return res.json({
        success: true,
        transcripts: generateFallbackTranscripts(meetingTitle),
        isFallback: true,
        message: 'GEMINI_API_KEY가 설정되지 않아 샘플 대화록이 생성되었습니다. Settings에서 API 키를 등록하면 실제 오디오 분석이 동작합니다.',
      });
    }

    const ai = getGenAi();

    // 오디오 파일이 업로드된 경우
    if (audioFile && audioFile.buffer && audioFile.buffer.length > 0) {
      const mimeType = audioFile.mimetype || 'audio/webm';
      const base64Audio = audioFile.buffer.toString('base64');

      const systemPrompt = `당신은 대한민국 산업안전 및 기업 회의록 전문 음성 전사 AI입니다.
음성을 듣고 화자별 발언 단위로 전사하십시오.

엄격한 규칙:
1. 화자는 실제 이름을 임의 확정하지 말고 "화자 1", "화자 2", "화자 3" 형태로 speakerId: "speaker_1", "speaker_2" 등으로 분류하십시오.
2. 음성에 없는 내용이나 결론을 지어내지 마십시오.
3. 동시 발화, 소음으로 불명확한 발언, 들리지 않는 구간은 needsReview: true로 표시하십시오.
4. startSeconds와 endSeconds는 음성의 실제 타임스탬프(초 단위 정수 또는 소수점 1자리)로 작성하십시오.
5. 회의 제목: ${meetingTitle}, 안건: ${agenda}
참고 참석자 명단(참고용이며 화자 확정 금지): ${attendeeNames.join(', ')}

반드시 다음 JSON 스키마를 만족하는 순수 JSON 문자열만 응답하십시오:
{
  "transcripts": [
    {
      "id": "seg_1",
      "startSeconds": 0,
      "endSeconds": 15,
      "speakerId": "speaker_1",
      "text": "한국어 발언 내용",
      "needsReview": false
    }
  ]
}`;

      const response = await ai.models.generateContent({
        model: 'gemini-2.5-flash',
        contents: [
          {
            role: 'user',
            parts: [
              { text: systemPrompt },
              {
                inlineData: {
                  mimeType,
                  data: base64Audio,
                },
              },
            ],
          },
        ],
        config: {
          responseMimeType: 'application/json',
          temperature: 0.2,
        },
      });

      const responseText = response.text || '{}';
      const parsed = JSON.parse(responseText);
      const transcripts = Array.isArray(parsed.transcripts) ? parsed.transcripts : [];

      console.log(`[SERVER] Transcription completed with ${transcripts.length} segments`);
      return res.json({ success: true, transcripts });
    }

    // 파일이 직접 전달되지 않았거나 모의 테스트인 경우
    return res.json({
      success: true,
      transcripts: generateFallbackTranscripts(meetingTitle),
      isFallback: true,
    });
  } catch (error: any) {
    console.error('[SERVER] Transcription failed', error);
    res.status(500).json({
      error: error.message || '전사 처리 중 오류가 발생했습니다.',
      details: String(error),
    });
  }
});

/**
 * 회의록 요약 API: /api/ai/summarize
 * 대화록과 안건을 분석하여 핵심 요약, 안건별 논의, 결정 사항, 미결 사항, 후속 조치, '구분/내용' 표 문안을 생성합니다.
 */
app.post('/api/ai/summarize', async (req: Request, res: Response) => {
  console.log('[SERVER] POST /api/ai/summarize called');
  try {
    const { meetingTitle, agenda, department, attendees, transcripts, speakerMapping } = req.body;

    // 화자 매핑을 반영한 텍스트 대화록 조합
    const formattedTranscript = (transcripts || []).map((seg: any) => {
      const mappedAttendeeId = speakerMapping ? speakerMapping[seg.speakerId] : null;
      let speakerName = seg.speakerId;
      if (mappedAttendeeId && Array.isArray(attendees)) {
        const att = attendees.find((a: any) => a.id === mappedAttendeeId);
        if (att) speakerName = `${att.name}(${att.role})`;
      }
      return `[ID: ${seg.id}] [${seg.startSeconds}s~${seg.endSeconds}s] ${speakerName}: ${seg.text}`;
    }).join('\n');

    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      console.warn('[SERVER] GEMINI_API_KEY 미설정. 기본 템플릿 요약을 생성합니다.');
      return res.json({
        success: true,
        summary: generateFallbackSummary(meetingTitle, transcripts),
        isFallback: true,
      });
    }

    const ai = getGenAi();

    const systemPrompt = `당신은 대한민국 공공기관 및 대기업 산업안전보건/위험성평가 회의록 전문 분석 AI입니다.
제공된 실제 대화록(Transcript)만을 철저히 근거로 하여 회의록 요약 및 양식 채우기 데이터를 생성하십시오.

엄격한 규칙:
1. 대화록에 명시적으로 언급되지 않은 사실, 결론, 담당자, 기한을 절대 지어내지(환각) 마십시오.
2. 담당자나 기한이 언급되지 않았다면 반드시 "미지정"으로 명시하십시오.
3. 제안/검토 의견과 최종 확정된 결정을 명확히 구분하십시오.
4. 주요 결정 사항 및 후속 조치에는 근거가 되는 발언의 id (예: "seg_1", "seg_2")를 evidenceSegmentIds 배열에 정확히 매핑하십시오.
5. 첨부된 '남부권역 위험성평가 위원회' 표준 양식의 '구분 / 내용' 표에 들어갈 문안을 suggestedContentRows에 구성하십시오. (구분: 개회 및 보고, 안건 심의, 결정 및 조치사항 등)
6. 위험성평가와 관련된 유해위험요인과 개선대책이 논의된 경우 riskAssessments에 정형화하십시오.

[회의 기본 정보]
- 회의 제목: ${meetingTitle}
- 사업장/부서: ${department}
- 회의 안건: ${agenda}

[대화록 본문]
${formattedTranscript || '(대화록 내용 없음)'}
`;

    const summarySchema: Schema = {
      type: Type.OBJECT,
      properties: {
        executiveSummary: { type: Type.STRING, description: '전체 회의 핵심 요약 (3~5문장)' },
        agendaDiscussions: {
          type: Type.ARRAY,
          items: {
            type: Type.OBJECT,
            properties: {
              agendaTitle: { type: Type.STRING },
              discussion: { type: Type.STRING },
              evidenceSegmentIds: { type: Type.ARRAY, items: { type: Type.STRING } },
            },
            required: ['agendaTitle', 'discussion'],
          },
        },
        decisions: {
          type: Type.ARRAY,
          items: {
            type: Type.OBJECT,
            properties: {
              text: { type: Type.STRING },
              evidenceSegmentIds: { type: Type.ARRAY, items: { type: Type.STRING } },
            },
            required: ['text'],
          },
        },
        pendingItems: {
          type: Type.ARRAY,
          items: {
            type: Type.OBJECT,
            properties: {
              text: { type: Type.STRING },
              evidenceSegmentIds: { type: Type.ARRAY, items: { type: Type.STRING } },
            },
            required: ['text'],
          },
        },
        actionItems: {
          type: Type.ARRAY,
          items: {
            type: Type.OBJECT,
            properties: {
              id: { type: Type.STRING },
              task: { type: Type.STRING },
              assignee: { type: Type.STRING },
              dueDate: { type: Type.STRING },
              status: { type: Type.STRING, enum: ['pending', 'in_progress', 'completed'] },
              evidenceSegmentIds: { type: Type.ARRAY, items: { type: Type.STRING } },
            },
            required: ['id', 'task', 'assignee', 'dueDate', 'status'],
          },
        },
        suggestedContentRows: {
          type: Type.ARRAY,
          items: {
            type: Type.OBJECT,
            properties: {
              id: { type: Type.STRING },
              category: { type: Type.STRING },
              content: { type: Type.STRING },
              order: { type: Type.INTEGER },
            },
            required: ['id', 'category', 'content', 'order'],
          },
        },
        riskAssessments: {
          type: Type.ARRAY,
          items: {
            type: Type.OBJECT,
            properties: {
              riskFactor: { type: Type.STRING },
              countermeasure: { type: Type.STRING },
              assignee: { type: Type.STRING },
              dueDate: { type: Type.STRING },
            },
            required: ['riskFactor', 'countermeasure', 'assignee', 'dueDate'],
          },
        },
      },
      required: [
        'executiveSummary',
        'agendaDiscussions',
        'decisions',
        'pendingItems',
        'actionItems',
        'suggestedContentRows',
      ],
    };

    const response = await ai.models.generateContent({
      model: 'gemini-2.5-flash',
      contents: [{ role: 'user', parts: [{ text: systemPrompt }] }],
      config: {
        responseMimeType: 'application/json',
        responseSchema: summarySchema,
        temperature: 0.1,
      },
    });

    const parsed = JSON.parse(response.text || '{}');
    const resultSummary = {
      ...parsed,
      generatedAt: new Date().toISOString(),
      version: 1,
      isReviewedByUser: false,
    };

    console.log('[SERVER] Summary generated successfully');
    res.json({ success: true, summary: resultSummary });
  } catch (error: any) {
    console.error('[SERVER] Summarization failed', error);
    res.status(500).json({
      error: error.message || '요약 처리 중 오류가 발생했습니다.',
      details: String(error),
    });
  }
});

/**
 * 기본 샘플 대화록 생성 (초기 테스트 및 키 미설정 시 안전 모드용)
 */
function generateFallbackTranscripts(title: string) {
  return [
    {
      id: 'seg_1',
      startSeconds: 0,
      endSeconds: 14,
      speakerId: 'speaker_1',
      text: `안녕하십니까. 지금부터 2026년도 상반기 ${title}를 개회하겠습니다.`,
      needsReview: false,
    },
    {
      id: 'seg_2',
      startSeconds: 15,
      endSeconds: 38,
      speakerId: 'speaker_2',
      text: '안전보건팀에서 보고드립니다. 지난 2주간 진행된 현장 정밀점검 결과, 2공장 프레스 라인의 광전자식 방호울 센서 반응 속도 지연 건이 보고되었습니다.',
      needsReview: false,
    },
    {
      id: 'seg_3',
      startSeconds: 39,
      endSeconds: 58,
      speakerId: 'speaker_3',
      text: '현장 근로자위원 측에서도 동의합니다. 센서 반응 속도가 불안정하여 비상정지 지연 우려가 있습니다. 즉각적인 센서 전면 교체가 필요합니다.',
      needsReview: false,
    },
    {
      id: 'seg_4',
      startSeconds: 59,
      endSeconds: 82,
      speakerId: 'speaker_1',
      text: '알겠습니다. 위원장으로서 결정하겠습니다. 2공장 프레스 센서는 최신 규격으로 3월 말까지 전면 교체 완료하고, 교체 전까지는 2인 1조 작업 수칙을 철저히 준수하도록 조치 바랍니다.',
      needsReview: false,
    },
    {
      id: 'seg_5',
      startSeconds: 83,
      endSeconds: 105,
      speakerId: 'speaker_2',
      text: '네, 안전보건팀 주관으로 구매팀과 협의하여 3월 31일까지 교체를 완료하겠습니다. 다음 안건인 지게차 통로 안전펜스 보강 건으로 넘어가겠습니다.',
      needsReview: false,
    },
    {
      id: 'seg_6',
      startSeconds: 106,
      endSeconds: 125,
      speakerId: 'speaker_4',
      text: '물류동 지게차와 보행자 교차 구역에 바닥 유도선이 많이 지워져 있어 충돌 위험이 높습니다.',
      needsReview: true,
    },
  ];
}

/**
 * 기본 샘플 요약 생성
 */
function generateFallbackSummary(title: string, transcripts: any[]) {
  return {
    executiveSummary: `2026년도 ${title} 회의를 통해 사업장 내 유해위험요인 점검 결과 및 개선 대책을 심의하였습니다. 2공장 프레스 라인 방호울 센서 노후화에 따른 전면 교체를 확정하였으며, 물류동 지게차 통로 안전펜스 및 유도선 재도색을 즉시 추진하기로 결정하였습니다.`,
    agendaDiscussions: [
      {
        agendaTitle: '2공장 프레스 라인 방호울 센서 교체',
        discussion: '센서 반응 속도 불안정으로 비상정지 지연 우려가 제기되었으며 전면 교체 필요성이 확인됨.',
        evidenceSegmentIds: ['seg_2', 'seg_3'],
      },
      {
        agendaTitle: '물류동 지게차-보행자 분리 및 통로 도색',
        discussion: '바닥 유도선 마모로 인한 충돌 위험 개선 요청.',
        evidenceSegmentIds: ['seg_6'],
      },
    ],
    decisions: [
      {
        text: '2공장 프레스 방호울 센서 최신 규격 전면 교체 (3월 말 완료 목표)',
        evidenceSegmentIds: ['seg_4'],
      },
      {
        text: '교체 완료 전까지 프레스 구역 2인 1조 작업 수칙 의무화',
        evidenceSegmentIds: ['seg_4'],
      },
    ],
    pendingItems: [
      {
        text: '하절기 밀폐공간 비상대응훈련 세부 일정 확정 건',
        evidenceSegmentIds: [],
      },
    ],
    actionItems: [
      {
        id: 'act_1',
        task: '2공장 프레스 센서 인터록 교체 발주 및 설치',
        assignee: '안전보건팀',
        dueDate: '2026-03-31',
        status: 'in_progress',
        evidenceSegmentIds: ['seg_4', 'seg_5'],
      },
      {
        id: 'act_2',
        task: '물류동 지게차 바닥 유도선 재도색 및 안전펜스 보강',
        assignee: '총무시설팀',
        dueDate: '2026-03-20',
        status: 'pending',
        evidenceSegmentIds: ['seg_6'],
      },
    ],
    suggestedContentRows: [
      {
        id: 'row_1',
        category: '개회 및 경과보고',
        content: '2026년도 상반기 사업장 위험성평가 정기추진 결과 및 부서별 사전점검 실적 보고',
        order: 0,
      },
      {
        id: 'row_2',
        category: '안건 심의',
        content: '1. 프레스 및 혼합기 구역 방호울 센서 개선안\n2. 물류 이동 동선 지게차-보행자 분리 방안 심의',
        order: 1,
      },
      {
        id: 'row_3',
        category: '결정 및 조치사항',
        content: '- 프레스 센서 인터록 전면 교체 (안전보건팀 / 3월 말한)\n- 통로 안전펜스 및 바닥 유도선 재도색 (총무팀 / 즉시 조치)',
        order: 2,
      },
    ],
    riskAssessments: [
      {
        riskFactor: '프레스 방호울 센서 감지 지연에 따른 신체 끼임 위험',
        countermeasure: '고감도 안전 인터록 센서 전면 교체 및 2인 1조 작업',
        assignee: '안전보건팀',
        dueDate: '2026-03-31',
      },
      {
        riskFactor: '물류동 지게차 통로 내 보행자 충돌 위험',
        countermeasure: '바닥 시인성 유도선 도색 및 물리적 보행자 안전펜스 설치',
        assignee: '총무시설팀',
        dueDate: '2026-03-20',
      },
    ],
    generatedAt: new Date().toISOString(),
    version: 1,
    isReviewedByUser: false,
  };
}

/**
 * Vite 개발 서버 미들웨어 및 프로덕션 정적 서빙 통합
 */
async function startServer() {
  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`[SERVER] AI 회의록 관리 서버가 포트 ${PORT}에서 실행 중입니다.`);
  });
}

startServer();
