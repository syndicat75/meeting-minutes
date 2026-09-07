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
├── server.ts                       # Express 백엔드 서버 (Gemini API 프록시 및 Vite 미들웨어)
├── firestore.rules                 # Firestore 보안 규칙 (소유자/참석자 인가 및 확정본 위변조 방지)
├── storage.rules                   # Storage 보안 규칙 (오디오, 사진, 서명 경로 및 용량 검증)
├── firebase.json                   # Firebase 호스팅 및 에뮬레이터 설정
├── Design.md                       # 본 앱 구조 및 아키텍처 설계 문서
├── src/
│   ├── config/
│   │   └── appConfig.ts            # 모델명(gemini-2.5-flash), API 키, 스토리지 키 중앙 집중 설정
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
│   │   └── aiService.ts            # 백엔드 Gemini 전사 및 요약 REST API 클라이언트
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
│   │           ├── RecordingTab.tsx    # 2. 녹음 및 오디오 탭 (볼륨 미터, 동의 확인, 파일 업로드)
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


