# AI 회의록 관리 시스템 (AI Meeting Minutes Management System)

## 1. 개요 및 설계 철학
본 시스템은 산업안전보건법 및 위험성평가 위원회, 노사협의회 등 기업 및 공공기관의 공식 회의 운영 지침을 준수하는 엔터프라이즈급 **AI 회의록 관리 및 전자서명 웹 애플리케이션**입니다.

단순한 화면 시연에 그치지 않고, **Firebase 클라우드 인프라(Auth, Firestore, Storage)**와 **Gemini 2.5 Flash API**를 결합하여 실제 현장에서 녹음, 전사, 요약, 사진 첨부, 전자서명 및 최종 확정본의 A4 규격 출력/PDF 저장이 가능하도록 구현되었습니다.

---

## 2. 시스템 아키텍처 (System Architecture)

```
[ 클라이언트 (React + Vite + Tailwind CSS) ]
  ├── 1. 기본정보 탭 (BasicInfoTab): 회의 개요 및 메타데이터, 접근 권한 관리
  ├── 2. 녹음/오디오 탭 (RecordingTab): 실시간 마이크 녹음, 볼륨 미터, IndexedDB 청크 백업, 음성 업로드
  ├── 3. 대화록 탭 (TranscriptTab): 화자 매핑, 타임스탬프 이동 재생, 발언 편집, 화자 병합, 확인 필요 토글
  ├── 4. 요약/본문표 탭 (SummaryTab): 핵심요약, 결정사항, 후속조치, '구분/내용' 표 편집, AI 재생성 비교
  ├── 5. 사진 첨부 탭 (PhotosTab): 현장 촬영, HTML5 Canvas EXIF 제거 및 최적화 압축, 90도 회전
  ├── 6. 참석자/서명 탭 (AttendeesTab): 10인 이상 명단, Pointer Events 캔버스 서명, 공용 태블릿 대면 서명 모드
  └── 7. 최종확정/인쇄 탭 (FinalizePrintTab): 사전 누락 체크리스트, 스냅샷 동결, A4 세로/가로 인쇄 양식
          │
          ├── [ Firebase 클라이언트 SDK ] ──> Google 로그인, Firestore 실시간 동기화, Storage 안전 업로드
          │
          └── [ Express API 서버 (/api/ai/*) ] ──> Gemini 2.5 Flash (서버측 API Key 격리)
```

---

## 3. 디렉터리 및 파일 분리 구조

```
/
├── server.ts                       # Express 백엔드 서버 (Vite 미들웨어 및 프로덕션 진입점)
├── server/
│   ├── app.ts                      # Express 앱 초기화 및 라우트 마운트
│   ├── config.ts                   # 모델명, API 키 환경변수, 제한치 중앙 설정
│   ├── routes.ts                   # /api/health, /api/ai/transcribe, /api/ai/summarize
│   ├── auth.ts                     # Firebase ID 토큰 및 회의 권한 검증
│   ├── storage.ts                  # Firebase Cloud Storage 오디오 다운로드
│   ├── gemini.ts                   # Gemini 3.6 Flash 요약 및 레거시 전사
│   └── ai/
│       ├── openaiTranscription.ts  # OpenAI gpt-4o-transcribe-diarize 공식 전사 엔진
│       ├── geminiTranscription.ts  # Gemini 3.6 Flash Fallback 전사 모듈
│       └── transcriptionService.ts # Provider 추상화, 자동 Fallback, 긴 회의 청크 병합
├── firestore.rules                 # Firestore 보안 규칙 (소유자/참석자 인가 및 확정본 위변조 방지)
├── storage.rules                   # Storage 보안 규칙 (오디오, 사진, 서명 경로 및 용량 검증)
├── firebase.json                   # Firebase 호스팅 및 에뮬레이터 설정
├── Design.md                       # 본 앱 구조 및 아키텍처 설계 문서
├── src/
│   ├── config/
│   │   └── appConfig.ts            # 모델명, API 키, 스토리지 키 중앙 집중 설정
│   ├── types/
│   │   ├── meeting.ts              # 회의, 참석자, 대화록, 요약, 서명, 사진 TypeScript 인터페이스
│   │   └── auth.ts                 # 사용자 인증 및 Firebase 연결 상태 인터페이스
│   ├── utils/
│   │   ├── logger.ts               # 민감 정보(토큰, 서명, 녹음) 필터링 보안 로거
│   │   └── formatters.ts           # 일자, 시각, 파일크기, 오디오 재생시간 한국어 포맷터
│   ├── services/
│   │   ├── firebase.ts             # Firebase 앱, Auth, Firestore, Storage 클라이언트 초기화
│   │   ├── meetingService.ts       # 회의 CRUD 및 Firestore/로컬 폴백 동기화 엔진
│   │   ├── audioRecorder.ts        # 브라우저 Web Audio API 및 MediaRecorder 녹음 엔진
│   │   ├── indexedDbAudio.ts       # 녹음 중 새로고침/이탈 대비 IndexedDB 청크 임시 보존
│   │   ├── storageService.ts       # 오디오/사진(Canvas EXIF 제거)/서명 PNG 업로드
│   │   └── aiService.ts            # 백엔드 AI 전사(OpenAI+Gemini Fallback) 및 요약 REST 클라이언트
│   ├── components/
│   │   ├── common/
│   │   │   ├── Header.tsx          # 상단 헤더, 로고, Firebase 상태 배지, Google 로그인
│   │   │   ├── Footer.tsx          # 하단 푸터, 법적 규정 고지, 상단 이동 플로팅 버튼
│   │   │   ├── FirebaseConfigModal.tsx # Firebase 연결 상태 진단 및 직접 설정 입력 가이드 모달
│   │   │   └── ConfirmModal.tsx    # 삭제 및 최종 확정 안전 확인 대화상자
│   │   └── meeting/
│   │       ├── MeetingCard.tsx     # 회의 목록 단일 카드 (상태, 녹음/사진/서명 현황 표시)
│   │       ├── MeetingListView.tsx # 회의 목록 뷰 (카드/테이블 전환, 검색, 상태/사업장 필터)
│   │       ├── MeetingDetailView.tsx # 회의 상세 뷰 컨테이너 (6대 탭 전환 및 상단 네비게이션)
│   │       ├── SignatureModal.tsx  # 전자서명 모달 (터치/마우스/펜, 공용 태블릿 연속 서명 지원)
│   │       └── tabs/
│   │           ├── BasicInfoTab.tsx    # 1. 기본 정보 탭 (일자, 장소, 안건, 권한 공유)
│   │           ├── RecordingTab.tsx    # 2. 녹음 및 오디오 탭 (볼륨 미터, 동의 확인, 파일 업로드, AI 엔진 표시)
│   │           ├── TranscriptTab.tsx   # 3. 화자별 대화록 탭 (화자 매핑, 타임스탬프 재생, TXT 다운)
│   │           ├── SummaryTab.tsx      # 4. 요약 및 회의내용 탭 (구분/내용 표, 후속조치, 재생성 비교)
│   │           ├── PhotosTab.tsx       # 5. 회의 사진 탭 (현장 촬영, 회전, 순서 변경, 캡션)
│   │           ├── AttendeesTab.tsx    # 6. 참석자 및 서명 탭 (10인 이상, 직책별 관리, 전자서명)
│   │           └── FinalizePrintTab.tsx # 7. 최종 확정 및 인쇄 탭 (체크리스트, 스냅샷, A4 인쇄)
│   ├── App.tsx                     # 메인 애플리케이션 상태 및 화면 라우팅
│   ├── main.tsx                    # React DOM 진입점
│   └── index.css                   # 글로벌 Tailwind 스타일 및 A4 @media print 양식 규칙
```

---

## 4. 데이터 흐름 및 상태 머신 (Data Flow)

1. **회의 생성 및 템플릿 복사**:
   - `draft` (작성 중) 상태로 초기화. 기본 10인 표준 참석자 명단 자동 세팅.
   - 기존 회의 복사 시 이전 녹음, 사진, 서명을 제외한 양식과 참석자만 안전하게 복제.
2. **녹음 및 동의 고지**:
   - 참석자 사전 동의 체크 후 브라우저 마이크 녹음 시작.
   - 1초 단위로 음성 청크를 `IndexedDB`에 안전하게 버퍼링하여 네트워크 단절이나 브라우저 새로고침 시 복구 지원.
3. **AI 화자 분리 전사 (STT)**:
   - 서버 측에서 Gemini 2.5 Flash를 통해 오디오 파일을 분석하여 `TranscriptSegment` 배열 도출.
   - 클라이언트에서 화자(예: 화자 1, 화자 2)를 실제 등록된 참석자 이름과 1:1 매핑.
4. **AI 요약 및 '구분 / 내용' 본문 표 도출**:
   - 대화록을 근거로 표준 회의록 본문 문안, 핵심 요약, 결정 사항, 미결 사항, 후속 조치(Action Items) 도출.
   - 사용자가 이미 수정한 내용이 존재할 경우 임의로 덮어쓰지 않고 비교 모달을 통해 선택 반영.
5. **현장 사진 및 증빙 자료 등록**:
   - 카메라 직접 촬영 및 파일 선택 지원.
   - HTML5 Canvas를 이용해 위치/기기 정보가 담긴 EXIF를 자동 제거하고 1600px 리사이즈 및 용량 최적화.
6. **참석자 전자서명**:
   - Pointer Events 기반 캔버스에서 마우스/스마트폰 터치/스타일러스 펜 지원.
   - 회의 현장에서 1대의 태블릿으로 참석자 전원이 순차 서명할 수 있는 '공용 태블릿 연속 대면 서명 모드' 제공.
7. **최종 확정 및 인쇄/PDF 저장**:
   - 필수 메타데이터, 내용 작성 여부, 전원 서명 여부를 사전 체크리스트로 검증.
   - 소유자가 최종 확정(`finalized`) 시 회의 전체 상태를 `snapshotData`로 동결하여 이후 수정 불가(Read-Only) 처리.
   - 브라우저 인쇄 대화상자를 호출하여 A4 세로 또는 가로 규격으로 완벽한 표준 양식 출력.

---

## 5. 보안 및 컴플라이언스 (Security & Compliance)

- **API 키 은닉**: Gemini API Key 및 백엔드 시크릿은 브라우저로 노출되지 않고 `server.ts`의 Express 엔드포인트를 통해서만 호출.
- **로깅 보안 준수**: `logger.ts`에서 음성 바이너리, 서명 이미지 데이터 URL, 사용자 비밀번호 및 토큰을 자동으로 마스킹하여 콘솔에 PII(개인식별정보)가 남지 않도록 설계.
- **Firestore 접근 제어**:
  - 생성자(`ownerId`) 및 명시적으로 권한을 부여받은 사용자(`permissions`)만 문서 읽기/쓰기 허용.
  - `status == 'finalized'` 상태인 경우 문서 임의 변조 방지.
- **Storage 저장소 규칙**:
  - 회의 참여자만 해당 회의 경로(`meetings/{meetingId}/*`)에 파일을 업로드할 수 있도록 제한.
  - 업로드 파일의 MIME 타입(`image/*`, `audio/*`) 및 최대 용량 한도(사진 10MB, 오디오 200MB) 서버 측 검증.

---

## 6. Firebase 외부 계정 설정 가이드

본 앱은 Firebase가 설정되지 않은 로컬 환경에서도 `IndexedDB` 및 `localStorage` 기반 로컬 안전 모드로 모든 기능(녹음, 재생, 대화록, 사진, 서명, 인쇄)을 완전하게 테스트할 수 있습니다. 실제 프로덕션 클라우드 동기화를 위한 절차는 다음과 같습니다:

1. **Firebase 콘솔 (https://console.firebase.google.com) 접속 및 프로젝트 생성**
2. **Authentication 활성화**: Sign-in method에서 'Google' 제공업체 사용 설정.
3. **Cloud Firestore 활성화**: 프로덕션 모드로 데이터베이스 생성 후 제공된 `firestore.rules` 배포.
4. **Firebase Storage 활성화**: 기본 버킷 생성 후 제공된 `storage.rules` 배포.
5. **웹 앱 등록 및 구성값 적용**:
   - Firebase 콘솔의 웹 앱 설정에서 발급받은 구성값(`apiKey`, `projectId`, `storageBucket` 등)을 앱 우측 상단의 [Firebase 설정] 모달의 '직접 설정 입력' 탭에 저장하거나 환경 변수에 등록합니다.

---

## 7. 회의 데이터 무결성 및 로컬/클라우드 안전 정책 (Data Integrity & Safety Policy)

1. **로컬 초안(Draft)과 클라우드 문서의 명확한 분리**:
   - `isLocalDraftMeeting(meeting)`을 통해 Firebase 미설정 상태에서 작성된 로컬 초안과 Firestore에 동기화된 클라우드 문서를 명확히 구별합니다.
   - UI 카드에 **[로컬 초안]** (호박색) 및 **[클라우드]** (에메랄드색) 배지를 명시하여 사용자가 데이터 저장 위치를 직관적으로 파악할 수 있습니다.
2. **안전한 회의록 삭제(Delete) 정책**:
   - **로컬 초안**: 소유자 로그인 여부와 무관하게 사용자가 확인 후 로컬 기기 저장소에서 즉각 삭제합니다.
   - **클라우드 문서**: 소유자(`ownerId`)의 계정 일치 여부를 검증한 후 Firestore `deleteDoc`을 먼저 실행하며, 서버 삭제 성공 시에만 로컬 상태를 갱신합니다.
   - **감사 기록 보존**: 회의록 본문 삭제 시에도 첨부된 녹음 및 전자서명 파일은 규정 및 백업 요구사항에 따라 영구 삭제되지 않고 별도 보존될 수 있음을 사용자에게 사전 고지합니다.
3. **Firestore 직렬화 무결성 보장**:
   - Firestore는 `undefined` 필드 저장을 거부하므로, 모든 저장/업데이트 요청 전 `sanitizeForFirestore`를 통해 중첩 객체 및 배열 내 `undefined` 값을 안전하게 정리합니다.
4. **복합 인덱스 오류 방지**:
   - Firestore 다중 필드 쿼리(`where` + `orderBy`) 시 발생할 수 있는 인덱스 미생성 오류를 원천 차단하기 위해, 조건 조회 후 메모리 내에서 최신순 정렬을 수행합니다.
5. **Google 인증 오류 상세 진단**:
   - `parseFirebaseAuthError`를 통해 `auth/popup-blocked`, `auth/unauthorized-domain`, `auth/network-request-failed` 등의 에러 코드를 한국어 상세 안내 및 해결 방법(팝업 차단 해제, 승인된 도메인 등록 등)으로 즉각 변환하여 사용자에게 제공합니다.

---

## 8. Vercel 서버리스 배포 및 AI API 아키텍처 (Vercel Serverless & AI Engine)

### 8.1. Vercel 프로젝트 설정 (Project Settings)
- **Framework Preset**: `Vite`
- **Root Directory**: `./` (프로젝트 루트)
- **Build Command**: `vite build`
- **Output Directory**: `dist`
- **Node.js Version**: `20.x` 또는 `22.x`

### 8.2. 서버리스 함수 분리 및 라우팅 구조 (`vercel.json`)
Vercel에서 Vite SPA 화면과 Express 백엔드 API를 동시에 배포할 때, `/api/*` 요청이 SPA의 `index.html`로 rewrite되어 404 또는 HTML 파싱 오류가 발생하는 문제를 원천 방지하기 위해 다음과 같이 구성합니다:

```json
{
  "$schema": "https://openapi.vercel.sh/vercel.json",
  "version": 2,
  "framework": "vite",
  "buildCommand": "vite build",
  "outputDirectory": "dist",
  "functions": {
    "api/index.ts": {
      "maxDuration": 60,
      "memory": 1024
    }
  },
  "rewrites": [
    {
      "source": "/api/(.*)",
      "destination": "/api"
    },
    {
      "source": "/(.*)",
      "destination": "/index.html"
    }
  ]
}
```

- **엔트리포인트 매핑**:
  - `api/index.ts`: Vercel Serverless Function 진입점으로 `server/app.ts`의 Express 앱을 직접 export합니다.
  - `server.ts`: Cloud Run 컨테이너 및 로컬 개발용 엔트리포인트로 동일한 `server/app.ts`를 가져와 포트 3000에서 Vite 개발 미들웨어 또는 정적 서빙과 함께 구동됩니다.
- **경로 정규화**:
  - Express 라우터는 `app.use('/api', apiRouter)`와 `app.use('/', apiRouter)`에 동시 마운트되어, Vercel의 URL rewrite 방식에 구애받지 않고 `/api/health`, `/health`, `/api/ai/transcribe`, `/ai/transcribe`를 일관되게 처리합니다.

### 8.3. Gemini API 키 보안 원칙
1. **서버 전용 격리**: `GEMINI_API_KEY`는 반드시 서버 백엔드(`process.env.GEMINI_API_KEY`)에서만 참조하며, 브라우저 번들이나 `VITE_` 접두사 환경변수에 절대 포함시키지 않습니다.
2. **키 누락 시 명확한 에러 반환**: `GEMINI_API_KEY`가 설정되지 않은 경우 가짜(mock) 성공 응답을 반환하지 않고, HTTP 503 (`GEMINI_API_KEY_NOT_CONFIGURED`) 상태와 함께 Vercel 환경변수 등록 안내 메시지를 즉시 응답합니다.

### 8.4. 가짜 성공(Mock Fallback) 제거 및 데이터 진실성 원칙
- 실제 오디오 파일이 제공되지 않았거나 Gemini 모델 분석을 수행하지 않은 경우, 예시 대화록이나 샘플 요약을 임의로 반환하지 않습니다.
- 오디오가 없으면 HTTP 400 (`NO_AUDIO_DATA`), 추론 실패 시 HTTP 502 (`GEMINI_INFERENCE_ERROR`)로 실패 처리하여 데이터의 신뢰성과 법적 증빙 효력을 유지합니다.

### 8.5. 대용량 오디오 전달 및 플랫폼 한도 준수 전략
1. **Vercel 본문 한도(4.5MB) 보호**:
   - Vercel Serverless Function은 최대 4.5MB의 HTTP 요청 본문 한도를 가집니다.
   - 따라서 클라이언트(`RecordingTab.tsx`, `storageService.ts`)는 녹음 완료 시 Firebase Storage로 선업로드(`meetings/{meetingId}/recordings/*`)한 후, 서버에는 파일 경로(`audioStoragePath`)와 메타데이터만 전송합니다.
2. **서버 측 스토리지 다운로드 및 SSRF 방지**:
   - 서버는 전달받은 `audioStoragePath`가 `meetings/${meetingId}/recordings/[a-zA-Z0-9_.-]+.(webm|mp4|wav|mp3|m4a)` 패턴과 정확히 일치하는지 검증합니다.
   - 디렉터리 트래버설(`..`)이나 타 회의 경로, 외부 도메인 URL 조회를 엄격히 차단합니다.
3. **실행 시간 및 파일 크기 한도**:
   - Vercel Serverless Function 최대 실행 시간: 60초 (`maxDuration: 60`).
   - 일반 회의 녹음(10~30분)은 Gemini 2.5 Flash에서 약 5~15초 내에 신속히 전사됩니다.
   - 1시간을 초과하는 대용량/장시간 녹음은 클라우드 작업 큐(Cloud Tasks 또는 QStash) 및 비동기 Webhook 아키텍처를 도입하여 클라이언트가 폴링하는 구조로 확장 배포할 수 있습니다.

### 8.6. 진단 및 상태 점검 (`/api/health`)
- `GET /api/health` 호출 시 비밀키 노출 없이 서버 동작 여부, Gemini 키 설정 유무(`geminiConfigured`), Firebase 설정 유무(`firebaseConfigured`), 모델명, 용량 한도를 JSON으로 제공합니다.
- 프런트엔드는 404(배포 경로 오류/HTML 응답), 401(미로그인 인증 필요), 403(권한 오류), 503(키 미설정), 500/502(AI 처리 실패)를 시각적으로 명확히 분기하여 사용자에게 표시하며, 404 오류 시 무한 반복 재시도를 수행하지 않습니다.

### 8.7. 엄격한 JSON 응답 보장 및 프론트엔드 내결함성 (Fault Tolerance)
1. **서버 응답 표준화 (`{ success, transcript, speakers, fullTranscript, summary, error, detail }`)**:
   - 성공 시: `{ success: true, transcript, speakers, fullTranscript, summary, transcripts }`
   - 실패 시: `{ success: false, error: "사용자 친화적 메시지", detail: "상세 원인" }`
   - Express 전역 에러 핸들러 및 라우터에서 어떤 예외가 발생하더라도 HTML이 아닌 유효한 JSON으로만 응답합니다.
2. **사전 검증 (Fail Fast)**:
   - 서버 진입 시 `GEMINI_API_KEY` 설정 여부를 먼저 확인하여, 누락 시 모델을 호출하지 않고 HTTP 503 JSON 응답을 즉시 반환합니다.
3. **오디오 버퍼 처리 우선순위**:
   - 직접 전송된 `audioFile` 버퍼가 존재하면 스토리지 원격 조회 없이 메모리에서 즉시 Gemini로 분석하여 안정성과 속도를 극대화합니다.
   - `audio/webm;codecs=opus` 등 확장 MIME 타입을 표준 `audio/webm`으로 정규화하여 Gemini API에 전달합니다.
4. **프론트엔드 상태 보존 및 복구**:
   - `response.text()` 수신 후 JSON 파싱을 시도하며, 파싱 실패 시 개발자 콘솔에 status code와 rawText를 기록하고 사용자에게 정돈된 안내를 표시합니다.
   - 500 등 오류 발생 시에도 기존 녹음 데이터, 재생 기능, 다운로드 버튼이 전혀 훼손되지 않고 그대로 유지됩니다.
   - 전사 버튼은 로딩 상태 해제 후 즉시 활성화되어 재시도가 가능합니다.
   - 전사 진행 중에는 스피너와 함께 "AI가 회의 음성을 분석하고 있습니다..." 배너 및 버튼 disabled 처리를 적용하여 중복 요청을 방지합니다.

### 8.8. Vercel Serverless Function ES Module Import 구조 및 번들링 최적화
1. **ESM 상대 경로 확장자 명시**:
   - `package.json`의 `"type": "module"` 환경에 맞춰, Node.js 런타임이 상대 경로를 로드할 때 `ERR_MODULE_NOT_FOUND`가 발생하지 않도록 모든 서버 모듈 import에 명시적인 `.js` 확장자를 사용합니다 (TypeScript ESM 표준 규격).
   - `api/index.ts`: `import app from '../server/app.js'; export default app;`
   - `server/app.ts`: `import { apiRouter } from './routes.js';`
   - `server/routes.ts`, `server/auth.ts`, `server/storage.ts`, `server/gemini.ts`, `server.ts`: 모든 로컬 모듈 import에 `.js` 확장자 명시
2. **Vercel Functions 번들링 및 파일 포함 (`vercel.json`)**:
   - `functions["api/index.ts"]`에 `"includeFiles": "server/**"`를 구성하여 서버 모듈이 Vercel 빌드 아티팩트 `/var/task/`에 누락 없이 안전하게 포함되도록 보장합니다.
3. **API 진입점 라우팅 일관성**:
   - `vercel.json`의 rewrites (`/api/(.*)` -> `/api`)를 통해 모든 API 요청이 단일 Express 진입점인 `api/index.ts`로 수렴됩니다.
   - `GET /api` 및 `GET /`에 대한 루트 안내 엔드포인트를 제공하여 모듈 로딩 및 헬스 상태를 즉각 진단할 수 있습니다.

### 8.9. Gemini 3.6 Flash 모델 중앙화 및 404 Model Not Found 에러 제어
1. **단일 중앙 모델 설정 (`GEMINI_MODEL`)**:
   - `server/config.ts` 및 `server/gemini.ts`에서 `process.env.GEMINI_MODEL || 'gemini-3.6-flash'`로 통합 관리.
   - Vercel 환경변수(`GEMINI_MODEL=gemini-3.6-flash`)를 통해 코드 수정 없이 모델 동적 교체 가능.
   - API 키는 서버 전용 환경변수로 격리하여 브라우저에 일절 노출되지 않음.
2. **구형 모델(gemini-2.5-flash) 제거 및 Fallback 체인 정비**:
   - 신규 사용자 접근이 중단된 `gemini-2.5-flash` 모델을 전사 및 요약 등 전체 AI 기능에서 완전히 배제.
   - fallback 목록에서도 지원 중단 모델을 제거하여 불필요한 실패 요청 방지.
3. **상세 로깅 및 진단**:
   - 전사 요청 시: `console.log("[transcription] Gemini model:", GEMINI_MODEL);`
   - 메타데이터 로깅: `console.log("[transcription] request", { model: GEMINI_MODEL, mimeType: normalizedMimeType, fileSize: audioBuffer.length });`
   - API 키는 어떠한 로그에도 기록되지 않도록 엄격히 차단.
4. **Gemini 404 모델 에러 사용자 친화적 메시지 처리**:
   - Gemini API에서 404/NOT_FOUND 또는 'no longer available' 발생 시 단순 "서버 내부 오류"가 아닌 "현재 설정된 AI 모델을 사용할 수 없습니다. 관리자에게 Gemini 모델 설정 확인을 요청해주세요." 안내 표출.
   - 개발자 로그에는 실제 오류 전체를 상세 기록하여 즉각적인 원인 파악 지원.

### 8.10. OpenAI 우선 + Gemini Fallback 전사 파이프라인 및 긴 회의 대응 설계
1. **듀얼 AI Provider 추상화 아키텍처**:
   - Primary: OpenAI 공식 Transcription API (`gpt-4o-transcribe-diarize`)
   - Fallback: Google Gemini API (`gemini-3.6-flash`)
   - 분리된 모듈 구조:
     - `server/ai/openaiTranscription.ts`: OpenAI toFile 스트림 생성 및 화자 분리(Diarization) 전사
     - `server/ai/geminiTranscription.ts`: Gemini 화자 분리 구조화 전사 모듈
     - `server/ai/transcriptionService.ts`: 공급자 오케스트레이션, 에러 분류 및 자동 전환
2. **정밀 에러 분류 및 Fallback 조건**:
   - **자동 Fallback 대상**: 429(Rate Limit), 500/502/503/504(Server Error), 요청 타임아웃, 네트워크 오류, 임시 모델 사용 불가.
   - **Fallback 차단 대상**:
     - 401(Invalid API Key), 403(Permission Denied): "OpenAI API 설정을 확인해주세요." 관리자 안내 메시지 즉시 반환.
     - 400(Invalid Request): 잘못된 요청에 대해 불필요한 Gemini 요청을 차단하고 상세 사유 반환.
   - 두 엔진 모두 실패 시 서버 로그에 두 오류를 모두 기록(`[transcription] Both OpenAI and Gemini fallback failed!`)하고 502 에러 반환.
3. **통일된 응답 데이터 규격**:
   ```json
   {
     "success": true,
     "provider": "openai",
     "fallbackUsed": false,
     "speakers": [
       { "speaker": "화자 1", "startTime": 0, "endTime": 5.3, "text": "회의를 시작하겠습니다." }
     ],
     "fullTranscript": "...",
     "summary": null,
     "transcripts": [ ... ]
   }
   ```
4. **UI 표시 정책**:
   - 일반 사용자의 시각적 복잡도를 낮추기 위해 메인 뷰에서는 provider를 강조하지 않음.
   - 녹음 상세 메타데이터 영역에 `AI 전사 엔진: OpenAI` 또는 `AI 전사 엔진: Gemini (Fallback)` 상태 뱃지 제공.
5. **긴 회의(30분~3시간) 청크 분할 및 화자 병합 정책**:
   - 브라우저 녹음 파일은 IndexedDB 및 Firebase Cloud Storage에 분할/스트리밍 업로드하여 메모리 초과를 원천 차단.
   - 청크별 순차 전사(`transcribeAudioChunksSequentially`) 지원: 각 구간별 타임스탬프를 보정(Time Offset 가산).
   - 화자 식별자 충돌 방지: 서로 다른 청크의 '화자 1'을 무조건 동일인으로 합치지 않고, 청크 식별자(`[1구간] 화자 1`, `[2구간] 화자 1`)를 보존하며 참석자가 1명으로 확정된 경우에만 정규화 매핑 수행.
6. **보안 및 규격 준수 로깅**:
   - 표준 로그 출력:
     - `[transcription] primary provider: openai`
     - `[transcription] model: gpt-4o-transcribe-diarize`
     - `[transcription] file type: audio/webm`
     - `[transcription] file size: 123456`
     - `[transcription] OpenAI success` (또는 `OpenAI failure`)
     - `[transcription] Gemini fallback started`
     - `[transcription] Gemini fallback success` (또는 `failure`)
   - API Key는 어떠한 로그에도 절대 출력하지 않음.

---

## 9. 장시간(최대 3시간) 업무용 회의 5분 단위 Chunk 아키텍처 (Long-Meeting Chunk Architecture)

### 9.1. 핵심 아키텍처 및 처리 흐름
장시간(최대 3시간 = 180분) 회의 시 수백 MB의 대용량 단일 오디오 Blob을 Vercel 서버리스 API로 일괄 전송할 경우 발생하는 **서버 타임아웃(Vercel 60초 제한) 및 페이로드 크기 한도(4.5MB) 초과 문제를 원천적으로 해결**하기 위해, 5분 단위 무중단 자동 Chunk 분할 및 클라우드 직업로드 파이프라인을 구축하였습니다.

```
브라우저 마이크 녹음 (최초 1회 MediaStream 획득 후 회의 종료 시까지 계속 활성 유지)
        ↓
5분 경과 시 자동 무중단 교체 (이전 MediaRecorder stop -> 즉시 새 MediaRecorder start)
        ↓
브라우저 로컬 백업 (IndexedDB 'audio_5min_chunks' 스토어에 오디오 Blob 즉시 보존)
        ↓
Firebase Cloud Storage 직접 업로드 (지수 백오프 2s/5s/10s 재시도)
        ↓
Firestore 청크 메타데이터 저장 (meetings/{meetingId}/audioChunks/chunk_XXX)
        ↓
다음 5분 녹음 계속 (회의 종료 시까지 반복)
        ↓
회의 종료 및 저장 완료 (UI에 "N / N 구간 저장 완료" 실시간 표시)
        ↓
AI 일괄 전사 요청 (동시 2개 청크 제한 워커 풀로 순차/병렬 전사: POST /api/ai/transcribe-chunk)
        ↓
타임스탬프 오프셋 보정 및 대화록 병합 (경계 중복 발언 안전 필터링)
        ↓
종합 AI 회의록 요약 생성 (POST /api/ai/summarize-meeting)
```

### 9.2. 주요 구성 요소
1. **ChunkAudioRecorder (`src/services/chunkAudioRecorder.ts`)**:
   - 5분(300,000ms)마다 온전한 WebM 바이너리 Blob을 생성하고, 마이크 스트림을 유지한 채 즉시 다음 청크 녹음을 이어가 녹음 단절을 원천 방지합니다.
   - Screen Wake Lock API를 적용하여 모바일 및 데스크톱 환경의 화면 꺼짐 및 절전 모드 진입을 방지합니다.
   - 최대 권장 녹음시간 3시간(10,800초) 도달 시 사용자 안내와 함께 마지막 구간을 안전하게 저장하고 녹음을 자동 종료합니다.
2. **IndexedDB 오디오 백업 (`src/services/indexedDbAudio.ts`)**:
   - `audio_5min_chunks` 스토어를 통해 네트워크 단절이나 브라우저 비정상 종료 시에도 로컬에 저장된 5분 청크 Blob을 안전하게 복구할 수 있도록 보장합니다.
3. **클라우드 스토리지 직업로드 (`src/services/storageService.ts` & `audioChunkService.ts`)**:
   - 오디오는 `meetings/{meetingId}/audio/chunks/chunk_XXX.webm` 경로로 Firebase Cloud Storage에 직접 업로드되며, 2초/5초/10초 지수 백오프 재시도를 지원합니다.
4. **전사 오케스트레이션 (`src/services/transcriptionClientService.ts`)**:
   - API Rate Limit을 방지하기 위해 동시 최대 2개 청크씩 순차/병렬 전사를 수행합니다.
   - 이미 성공한 구간은 중복 호출하지 않으며, 실패한 구간만 타겟팅하여 부분 재시도할 수 있습니다.
   - 각 청크의 시작 시간(`startSeconds`)을 세그먼트 타임스탬프에 정확히 가산하여 전체 회의 타임라인을 일관되게 복원합니다.
5. **종합 회의록 요약 (`server/ai/meetingSummaryService.ts`)**:
   - 병합된 전체 대화록을 바탕으로 핵심 개요(overview), 주요 논의사항(keyDiscussions), 결정사항(decisions), Action Items(담당자/기한/신뢰도), 미결사항(pendingIssues), 후속 조치(nextSteps)를 구조화된 JSON으로 생성합니다.

### 9.3. 장애 격리 및 데이터 무결성 보장
- **부분 실패 격리**: 특정 청크의 전사가 일시적으로 실패하더라도 전체 회의가 실패하지 않으며, 성공한 구간은 그대로 보존됩니다.
- **재시도 멱등성**: 재시도 시 이미 완료된 청크의 API 비용을 낭비하지 않고 실패한 청크만 재요청합니다.
- **단일 파일 호환성**: 사용자가 외부에서 녹음된 단일 오디오 파일(MP3, M4A, WAV 등)을 직접 업로드하는 경우에도 기존 단일 파일 전사 파이프라인과 완벽하게 상호 호환됩니다.

### 9.4. 청크 업로드 안정화 및 UI 상태 불일치 해결 내역
1. **Firebase Storage Bucket 명시적 바인딩 및 정규화**:
   - `firebase.ts` 초기화 시 `storageBucket` URL에 `gs://` 접두사나 슬래시(`/`)가 포함되어도 안전하도록 `normalizeStorageBucket` 헬퍼 함수를 적용하고, `getStorage(app, bucketUrl)`을 명시적으로 바인딩하여 기본 버킷 누락 오류를 방지했습니다.
2. **Storage Rules MIME 타입 확장**:
   - 브라우저 인코더(MediaRecorder)에 따라 WebM 컨테이너 헤더가 `application/octet-stream`으로 판별되는 환경에 대비하여 `storage.rules`의 청크 경로 검사 규칙을 `(request.resource.contentType.matches('audio/.*') || request.resource.contentType == 'application/octet-stream')`으로 확장했습니다.
3. **`ChunkAudioRecorder.stop()` 비동기 Race Condition 해소**:
   - 사용자가 '녹음 완료 및 저장' 버튼을 눌렀을 때, 이전에는 `stop()` 함수가 백그라운드의 마지막 청크 업로드(`onChunkReady`) 완료를 기다리지 않고 즉시 반환되어 마지막 청크가 업로드 누락되거나 Firestore 메타데이터가 미반영되는 문제가 있었습니다.
   - `ChunkAudioRecorder.stop()` 내부에서 마지막 회전 청크의 `onChunkReady` 프로미스를 `await`하도록 구조를 변경하여 모든 청크가 완전히 저장된 후에만 녹음 종료 처리가 완료되도록 보장했습니다.
4. **청크 식별자 4자리 패딩 표준화**:
   - `chunk_0001.webm`, `chunk_0002.webm`과 같이 4자리(`padStart(4, '0')`) 표준을 적용하여 최대 3시간(36개 구간) 이상의 대규모 회의에서도 사전순 정렬 순서가 100% 보장되도록 개선했습니다.
5. **UI 상태 불일치 (상단 "1개 구간 저장 완료" vs 하단 "0/1 구간 저장 완료") 해소**:
   - 기존에는 `chunks.length > 0` 조건만으로 상단에 무조건 저장 완료로 표기하던 오류를 수정하고, 실제 Storage 업로드 상태(`uploadStatus === 'uploaded'`)를 기준으로 상단과 하단 문구를 동기화했습니다.
   - 업로드 실패 청크가 있을 경우 상단 상태에 즉시 `녹음 저장 실패 (N/M 구간 저장 완료, X개 실패)`로 일치된 정보를 표시합니다.
6. **녹음 종료 후 메인 타이머 00:00:00 초기화 방지**:
   - 녹음 종료 후 `recordDuration`이 리셋되더라도 실제 녹음된 전체 시간(`totalDurationSeconds`)을 `lastRecordedDuration` 및 `meeting.recordedDurationSeconds`에 저장/보존하여, 28초 녹음 완료 후 타이머가 사라지지 않고 온전히 유지되도록 개선했습니다.
7. **미저장 구간 존재 시 AI 전사 버튼 비활성화**:
   - 클라우드 Storage에 업로드되지 않은 청크가 하나라도 있을 경우 AI 전사 버튼(`btn-batch-transcribe`)을 비활성화하고, 명확한 안내 툴팁과 [저장 재시도] 안내 배너를 제공합니다.
8. **클라우드 스토리지 쓰기 권한 사전 확인 및 로컬 폴백**:
   - Google 로그인이 되어 있지 않거나 Storage 미설정 상태인 경우에도, 로컬 IndexedDB에 안전하게 청크를 보존하고 `URL.createObjectURL`을 통한 로컬 오디오 재생 및 분석을 지원합니다.
9. **Firestore + 로컬 IndexedDB 통합 복원 (`getMeetingAudioChunks`)**:
   - Firestore 조회가 실패하거나 오프라인/지연 상태인 경우 로컬 IndexedDB의 5분 청크 Blob을 자동 복원 병합하여, 녹음 직후 청크 목록이 비어 보이거나 상태가 누락되는 현상을 완벽히 방지했습니다.

---

## 10. 직접 작성 회의록 아키텍처 (Manual Entry Architecture)

### 10.1. 기본 목적 및 설계 원칙
사용자는 회의 내용을 다음 3가지 방식으로 유연하게 기록할 수 있으며, 상호 배타적이지 않고 자유롭게 조합할 수 있습니다:
1. **마이크 녹음 → AI 화자분리 전사**
2. **기존 음성파일 업로드 → AI 화자분리 전사**
3. **사람이 직접 키보드로 회의내용 입력 (Manual Entry)**

> **핵심 원칙**: 음성 녹음이나 파일이 전혀 없더라도 사람이 직접 입력한 회의내용만으로 회의록 작성, AI 요약, 결정사항 정리, Action Item 작성, 전자서명, 최종 확정, 인쇄/PDF까지 모든 법적·실무적 회의록 절차를 100% 완료할 수 있습니다.

### 10.2. 데이터 모델 (`src/types/meeting.ts`)
- `ManualEntry`: 개별 직접 작성 항목 (작성시각, 작성자, 발언자, 발언내용, 태그/구분)
- `ManualActionItem`: 직접 등록한 후속 조치 과제 (업무명, 담당자, 마감일, 우선순위, 완료 여부)
- `Meeting.manualMinutes`: 직접 작성 회의록 전용 구조체
  - `entries`: ManualEntry[]
  - `decisions`: string[] (직접 작성한 결정사항)
  - `actionItems`: ManualActionItem[] (직접 작성한 Action Item)
  - `generalNotes`: string (자유 메모)
  - `source`: `'manual'`
  - `lastEditedAt`: 수정 일시

### 10.3. AI 전사와의 상호작용 및 데이터 보호 원칙
1. **사용자 직접 작성 내용 절대 보호 (Immutable Manual Data)**:
   - AI 전사나 AI 요약을 재실행하더라도 사용자가 직접 타이핑한 `manualMinutes`는 절대로 덮어써지거나 삭제되지 않습니다.
   - 출처 태그(`source: 'manual' | 'ai_transcription'`)를 엄격히 분리 관리합니다.
2. **통합 타임라인 제공 (`TranscriptTab.tsx`)**:
   - 사용자는 대화록 화면에서 [전체 보기], [녹음 AI 전사만], [직접 작성 메모만] 필터를 통해 발언을 선택적으로 조회할 수 있습니다.
   - 타임스탬프 순서대로 자연스럽게 녹음 발언과 사용자 직접 메모가 어우러져 표시됩니다.
3. **직접 작성 내용 기반 AI 지능형 요약 (`server/ai/meetingSummaryService.ts`)**:
   - 음성 녹음이 없더라도 직접 작성된 메모, 결정사항, Action Items를 종합하여 Gemini AI가 표준 양식의 구조화된 요약본을 도출합니다.
   - 음성과 직접 작성이 모두 존재하는 경우, 두 가지 맥락을 모두 수렴하여 더욱 완전한 회의록 요약을 완성합니다.
4. **최종 확정 및 인쇄 연동 (`FinalizePrintTab.tsx`)**:
   - A4 출력 및 PDF 인쇄 시에도 [직접 작성 회의내용] 섹션과 [직접 지정 Action Item]이 표준 공문서 규격에 맞게 유려하게 렌더링됩니다.

---

## 11. Firebase Storage 403 오류 진단 및 보안 규칙 아키텍처 (Storage 403 Diagnostics & Security Rules)

### 11.1. HTTP 403 (storage/unauthorized) 발생 메커니즘 및 원인 분석
브라우저 환경에서 장시간 녹음 오디오 청크 업로드 시 발생하는 `HTTP 403 Forbidden` (`storage/unauthorized`) 오류는 다음 4가지 원인에 의해 발생합니다:
1. **Firebase 설정 소스 불일치 (localStorage override Mismatch)**:
   - 사용자가 이전에 `FirebaseConfigModal` 등을 통해 브라우저 `localStorage`(`ai_meeting_firebase_config_override`)에 입력했던 과거 프로젝트 정보(`projectId`, `storageBucket`, `authDomain`)가 환경 변수와 충돌하거나, 현재 로그인 세션의 Auth Project ID와 Storage Bucket Project ID가 서로 다를 때 토큰 검증 실패로 403 발생.
2. **Firebase Storage 보안 규칙(Security Rules) 미게시 또는 미배포**:
   - Firebase Storage 생성 시 기본 규칙은 `allow read, write: if false;`로 설정되어 있어, Firebase Console에 `storage.rules`가 배포(Publish)되지 않았을 경우 모든 쓰기 요청이 거절됨.
3. **비인증 상태(`auth.currentUser === null`)에서 업로드 시도**:
   - 규칙상 `request.auth != null`을 요구하지만 사용자 로그인 세션이 준비되지 않은 상태에서 업로드를 시도한 경우.
4. **경로 매칭 불일치 또는 MIME Content-Type 제약**:
   - 실제 업로드 경로(`meetings/{meetingId}/audio/chunks/{fileName}`)와 Security Rules의 패턴이 일치하지 않거나, 브라우저 WebM codec(`audio/webm;codecs=opus`) 등의 Content-Type 매칭 실패.

### 11.2. 진단 및 보안 하드닝 구현 내역
1. **런타임 Firebase 파라미터 진단 로깅 (`src/config/appConfig.ts`)**:
   - `getFirebaseConfigWithSource()`를 통해 현재 활성화된 설정의 소스(`'localStorage'` 또는 `'environment'`)를 실시간 식별.
   - API 키 전체 값은 절대 노출하지 않고 다음 안전한 진단 로그를 브라우저 콘솔에 자동 출력:
     ```ts
     console.log('[firebase-diagnostics]', { projectId, authDomain, storageBucket, source });
     ```
2. **업로드 전 인증 상태 사전 검증 (`src/services/storageService.ts`)**:
   - 업로드 시도 직전 다음 진단 로그 출력:
     ```ts
     console.log('[storage-auth]', { uid: auth.currentUser?.uid ?? null, hasUser: !!auth.currentUser });
     console.log('[storage-upload-path]', { storagePath });
     ```
   - `auth.currentUser`가 `null`인 경우 Storage 업로드를 원천 차단하여 불필요한 403 에러 발생을 방지하고, 로컬 임시 Object URL 및 IndexedDB로 안전하게 폴백.
3. **403 오류 자동 재시도 원천 차단 (Fast Fail Policy)**:
   - 네트워크 장애나 타임아웃, 5xx 서버 에러는 지수 백오프(2초, 5초, 10초)로 재시도하지만, 403 (`storage/unauthorized`, `storage/unauthenticated`, `storage/no-default-bucket`)은 시간 경과로 해결되지 않으므로 즉시 재시도를 중단(`break`).
4. **스토리지 보안 규칙 (`storage.rules`) 명시적 청크 경로 반영**:
   - `meetings/{meetingId}/audio/chunks/{fileName}` 명시적 경로 규칙과 `audio/{allPaths=**}` 규칙을 완비하여 인증된 사용자(`request.auth != null`)의 오디오 청크 저장을 보장.
5. **UI 진단 및 사용자 에러 가이드 (`RecordingTab.tsx` & `FirebaseConfigModal.tsx`)**:
   - 403 오류 발생 시 일반적인 "업로드 실패" 대신 "Firebase Storage 저장 권한이 없습니다. (HTTP 403)"로 명확히 고지.
   - 관리자 진단 영역에 `storage/unauthorized`, `HTTP 403`, `storagePath`를 모노스페이스 폰트로 정밀하게 표시.
   - `localStorage override`가 활성화된 경우 원클릭 [기본 설정으로 초기화] 버튼을 제공하여 프로젝트 불일치를 신속히 해소.







