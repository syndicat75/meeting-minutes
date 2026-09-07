/**
 * @file src/components/meeting/tabs/RecordingTab.tsx
 * @description 회의 실시간 음성 녹음 및 기존 오디오 파일(MP3, M4A, WAV, WebM) 업로드 탭.
 * 입력 음량 게이지, 녹음 동의 체크, Wake Lock 알림, 원본 오디오 플레이어 및 AI 전사 요청 지원.
 */

import React, { useState, useRef, useEffect } from 'react';
import {
  Mic,
  Square,
  Pause,
  Play,
  Upload,
  Download,
  AlertTriangle,
  CheckCircle2,
  Sparkles,
  Volume2,
  FileAudio,
  ShieldCheck,
  RefreshCw,
} from 'lucide-react';
import { Meeting, RecordingMetadata } from '../../../types/meeting';
import { BrowserAudioRecorder, RecorderState } from '../../../services/audioRecorder';
import { uploadRecordingAudio } from '../../../services/storageService';
import { removeAudioSession } from '../../../services/indexedDbAudio';
import { requestTranscriptionDetails } from '../../../services/aiService';
import { formatDuration, formatFileSize } from '../../../utils/formatters';
import { APP_CONFIG } from '../../../config/appConfig';
import { logger } from '../../../utils/logger';

interface RecordingTabProps {
  meeting: Meeting;
  isReadOnly: boolean;
  onUpdateMeeting: (partial: Partial<Meeting>) => void;
  onSwitchToTranscriptTab: () => void;
}

/**
 * 녹음 및 오디오 관리 탭 컴포넌트
 */
export const RecordingTab: React.FC<RecordingTabProps> = ({
  meeting,
  isReadOnly,
  onUpdateMeeting,
  onSwitchToTranscriptTab,
}) => {
  logger.debug('RecordingTab rendered', { meetingId: meeting.id, hasRecording: Boolean(meeting.recording) });

  const [recorderState, setRecorderState] = useState<RecorderState>('inactive');
  const [recordDuration, setRecordDuration] = useState<number>(0);
  const [inputVolume, setInputVolume] = useState<number>(0);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // 법적 고지 및 참석자 동의 확인 체크박스
  const [isConsentChecked, setIsConsentChecked] = useState<boolean>(
    meeting.recording?.isConsentGiven || false
  );

  // 업로드 진행 상태
  const [uploadPercent, setUploadPercent] = useState<number>(0);
  const [isUploading, setIsUploading] = useState<boolean>(false);

  // AI 전사 처리 상태
  const [isTranscribing, setIsTranscribing] = useState<boolean>(false);
  const [transcribeError, setTranscribeError] = useState<string | null>(null);
  // 전사 직접 전송을 위한 현재 세션 오디오 Blob 보관
  const [currentAudioBlob, setCurrentAudioBlob] = useState<Blob | null>(null);

  // 녹음 인스턴스 참조
  const recorderRef = useRef<BrowserAudioRecorder | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const audioPlayerRef = useRef<HTMLAudioElement | null>(null);

  // 컴포넌트 마운트 시 리코더 초기화
  useEffect(() => {
    recorderRef.current = new BrowserAudioRecorder({
      onStateChange: (state) => setRecorderState(state),
      onTimeUpdate: (seconds) => setRecordDuration(seconds),
      onVolumeUpdate: (vol) => setInputVolume(vol),
      onError: (err) => {
        logger.error('Recorder callback error', { err });
        setErrorMessage(err);
      },
    });

    return () => {
      if (recorderRef.current && recorderRef.current.getState() !== 'inactive') {
        recorderRef.current.stop();
      }
    };
  }, []);

  /**
   * 녹음 시작
   */
  const handleStartRecording = async () => {
    logger.info('handleStartRecording called');
    if (!isConsentChecked) {
      setErrorMessage('녹음 전 모든 참석자에게 녹음 및 AI 대화록 처리를 사전 고지하고 동의 확인을 체크해야 합니다.');
      return;
    }

    setErrorMessage(null);
    if (recorderRef.current) {
      await recorderRef.current.start(meeting.id);
    }
  };

  /**
   * 녹음 일시정지
   */
  const handlePauseRecording = () => {
    logger.info('handlePauseRecording called');
    if (recorderRef.current) {
      recorderRef.current.pause();
    }
  };

  /**
   * 녹음 재개
   */
  const handleResumeRecording = async () => {
    logger.info('handleResumeRecording called');
    if (recorderRef.current) {
      await recorderRef.current.resume();
    }
  };

  /**
   * 녹음 완료 및 업로드 처리
   */
  const handleStopRecording = async () => {
    logger.info('handleStopRecording called');
    if (!recorderRef.current) return;

    const result = await recorderRef.current.stop();
    if (!result || !result.blob) {
      setErrorMessage('녹음 데이터가 비어있거나 저장에 실패했습니다.');
      return;
    }

    setIsUploading(true);
    setUploadPercent(0);

    try {
      // 녹음 직후 생성된 오디오 Blob을 세션 상태에 즉시 보관
      setCurrentAudioBlob(result.blob);

      // 1. Storage 업로드 (또는 오프라인 로컬 URL 생성)
      const uploadRes = await uploadRecordingAudio(
        meeting.id,
        result.blob,
        result.mimeType,
        (percent) => setUploadPercent(percent)
      );

      const metadata: RecordingMetadata = {
        id: 'rec_' + Date.now(),
        storagePath: uploadRes.storagePath,
        downloadUrl: uploadRes.downloadUrl,
        durationSeconds: result.durationSeconds,
        fileSizeBytes: result.blob.size,
        mimeType: result.mimeType,
        fileName: `녹음_${meeting.date || '회의'}.webm`,
        uploadedAt: new Date().toISOString(),
        isConsentGiven: true,
      };

      onUpdateMeeting({ recording: metadata });
      logger.info('Recording metadata saved successfully');

      // 2. 서버 저장이 확인된 후 IndexedDB 임시 청크 삭제
      await removeAudioSession(meeting.id);
    } catch (err: any) {
      logger.error('Failed to upload recording', err);
      setErrorMessage(`녹음 업로드 실패: ${err?.message || '네트워크 오류'}. 다시 시도해주세요.`);
    } finally {
      setIsUploading(false);
    }
  };

  /**
   * 외부 오디오 파일 업로드 핸들러
   */
  const handleFileUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    logger.info('Audio file chosen for upload', { fileName: file.name, size: file.size, type: file.type });

    // 용량 제한 검증 (최대 200MB)
    if (file.size > APP_CONFIG.limits.maxRecordingFileSizeBytes) {
      setErrorMessage(`파일 크기가 200MB를 초과합니다. (현재 크기: ${formatFileSize(file.size)})`);
      return;
    }

    setCurrentAudioBlob(file);
    setIsUploading(true);
    setUploadPercent(0);
    setErrorMessage(null);

    try {
      const uploadRes = await uploadRecordingAudio(
        meeting.id,
        file,
        file.type || 'audio/webm',
        (pct) => setUploadPercent(pct)
      );

      // 오디오 길이 추정 (브라우저 Audio 태그 활용)
      const tempAudio = new Audio(URL.createObjectURL(file));
      tempAudio.onloadedmetadata = () => {
        const dur = Math.round(tempAudio.duration) || 0;
        const metadata: RecordingMetadata = {
          id: 'rec_' + Date.now(),
          storagePath: uploadRes.storagePath,
          downloadUrl: uploadRes.downloadUrl,
          durationSeconds: dur,
          fileSizeBytes: file.size,
          mimeType: file.type || 'audio/webm',
          fileName: file.name,
          uploadedAt: new Date().toISOString(),
          isConsentGiven: true,
        };
        onUpdateMeeting({ recording: metadata });
        setIsUploading(false);
      };
      tempAudio.onerror = () => {
        const metadata: RecordingMetadata = {
          id: 'rec_' + Date.now(),
          storagePath: uploadRes.storagePath,
          downloadUrl: uploadRes.downloadUrl,
          durationSeconds: 0,
          fileSizeBytes: file.size,
          mimeType: file.type || 'audio/webm',
          fileName: file.name,
          uploadedAt: new Date().toISOString(),
          isConsentGiven: true,
        };
        onUpdateMeeting({ recording: metadata });
        setIsUploading(false);
      };
    } catch (err: any) {
      logger.error('Audio file upload failed', err);
      setErrorMessage(`오디오 파일 업로드 실패: ${err?.message}`);
      setIsUploading(false);
    }
  };

  /**
   * AI 화자별 음성 전사 요청
   */
  const handleTriggerTranscription = async () => {
    logger.info('handleTriggerTranscription called');
    if (!meeting.recording) {
      setTranscribeError('전사할 녹음 파일이 존재하지 않습니다.');
      return;
    }

    setIsTranscribing(true);
    setTranscribeError(null);

    try {
      const attendeeNames = meeting.attendees.map((a) => a.name);

      // 직접 전송을 위한 audioBlob 취득: 메모리 state 확인 후 없으면 downloadUrl에서 fetch
      let audioBlobToSend = currentAudioBlob;
      if (!audioBlobToSend && meeting.recording.downloadUrl) {
        try {
          logger.info('Attempting to fetch audio blob from downloadUrl', { url: meeting.recording.downloadUrl });
          const res = await fetch(meeting.recording.downloadUrl);
          if (res.ok) {
            audioBlobToSend = await res.blob();
            setCurrentAudioBlob(audioBlobToSend);
            logger.info('Audio blob obtained successfully from downloadUrl', {
              size: audioBlobToSend.size,
              type: audioBlobToSend.type,
            });
          }
        } catch (blobFetchErr) {
          logger.warn('Could not fetch audio blob from downloadUrl, proceeding with storage path fallback', blobFetchErr);
        }
      }

      const result = await requestTranscriptionDetails({
        meetingId: meeting.id,
        audioBlob: audioBlobToSend || undefined,
        audioStoragePath: meeting.recording.storagePath,
        audioUrl: meeting.recording.downloadUrl,
        meetingTitle: meeting.title,
        agenda: meeting.agenda,
        attendeeNames,
      });

      logger.info('Transcription completed, updating meeting', {
        count: result.transcripts.length,
        provider: result.provider,
        fallbackUsed: result.fallbackUsed,
      });

      onUpdateMeeting({
        transcripts: result.transcripts,
        status: meeting.status === 'draft' ? 'review' : meeting.status,
        recording: {
          ...meeting.recording,
          transcriptionProvider: result.provider,
          fallbackUsed: result.fallbackUsed,
        },
      });

      // 대화록 탭으로 자동 전환 안내
      onSwitchToTranscriptTab();
    } catch (err: any) {
      logger.error('Transcription failed', err);
      setTranscribeError(err?.message || 'AI 음성 전사 처리 중 알 수 없는 오류가 발생했습니다.');
    } finally {
      setIsTranscribing(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* 에러 및 주의사항 배너 */}
      {errorMessage && (
        <div className="p-4 bg-red-50 border border-red-200 rounded-xl flex items-start space-x-3 text-red-800 text-xs">
          <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5 text-red-600" />
          <div className="flex-1">{errorMessage}</div>
          <button onClick={() => setErrorMessage(null)} className="font-bold text-red-600 hover:text-red-800">
            닫기
          </button>
        </div>
      )}

      {/* 안내 박스: 백그라운드 중단 주의 및 개인정보 고지 */}
      <div className="bg-slate-50 border border-slate-200 rounded-xl p-4 text-xs text-slate-600 space-y-2">
        <div className="flex items-center space-x-2 font-bold text-slate-800">
          <ShieldCheck className="w-4 h-4 text-blue-600" />
          <span>녹음 및 음성인식 규정 준수 안내</span>
        </div>
        <p className="leading-relaxed">
          • 모바일(Android/iOS) 환경에서는 화면 잠금 또는 브라우저 백그라운드 전환 시 녹음이 일시 중단될 수 있습니다. 중요한 회의 녹음 시 화면을 켜두시기 바랍니다. (Screen Wake Lock 자동 시도)
          <br />
          • 녹음된 오디오는 산업안전보건법 및 개인정보보호법에 따라 암호화된 전용 스토리지에 안전하게 보관됩니다.
        </p>

        {/* 참석자 동의 확인 체크박스 */}
        <label className="flex items-center space-x-2 pt-2 text-slate-900 font-semibold cursor-pointer select-none">
          <input
            type="checkbox"
            checked={isConsentChecked}
            onChange={(e) => {
              setIsConsentChecked(e.target.checked);
              if (meeting.recording) {
                onUpdateMeeting({ recording: { ...meeting.recording, isConsentGiven: e.target.checked } });
              }
            }}
            disabled={isReadOnly}
            className="w-4 h-4 text-blue-600 rounded border-slate-300 focus:ring-blue-500"
          />
          <span>[필수] 모든 참석자에게 회의 녹음 및 AI 대화록 처리를 사전 고지하고 동의를 확인하였습니다.</span>
        </label>
      </div>

      {/* 녹음 콘솔 메인 카드 */}
      <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-6 space-y-6">
        <div className="text-center space-y-2">
          <div className="text-3xl sm:text-4xl font-mono font-bold text-slate-900 tracking-wider">
            {recorderState === 'inactive'
              ? meeting.recording
                ? formatDuration(meeting.recording.durationSeconds)
                : '00:00:00'
              : formatDuration(recordDuration)}
          </div>
          <div className="flex items-center justify-center space-x-2 text-xs">
            <span
              className={`w-2.5 h-2.5 rounded-full ${
                recorderState === 'recording'
                  ? 'bg-red-500 animate-ping'
                  : recorderState === 'paused'
                  ? 'bg-amber-500'
                  : 'bg-slate-300'
              }`}
            />
            <span className="font-semibold text-slate-600">
              {recorderState === 'recording'
                ? '실시간 녹음 중...'
                : recorderState === 'paused'
                ? '일시 정지됨'
                : meeting.recording
                ? '녹음 파일 등록 완료'
                : '대기 중'}
            </span>
          </div>

          {/* 마이크 입력 음량 게이지 바 */}
          {recorderState !== 'inactive' && (
            <div className="max-w-xs mx-auto pt-2">
              <div className="flex items-center justify-between text-[11px] text-slate-500 mb-1">
                <span className="flex items-center">
                  <Volume2 className="w-3 h-3 mr-1" />
                  입력 음량
                </span>
                <span>{inputVolume}%</span>
              </div>
              <div className="w-full bg-slate-200 h-2 rounded-full overflow-hidden">
                <div
                  className="bg-blue-600 h-full transition-all duration-75"
                  style={{ width: `${inputVolume}%` }}
                />
              </div>
            </div>
          )}
        </div>

        {/* 녹음 제어 버튼 군 */}
        {!isReadOnly && (
          <div className="flex flex-wrap items-center justify-center gap-3 pt-2">
            {recorderState === 'inactive' ? (
              <button
                type="button"
                onClick={handleStartRecording}
                disabled={!isConsentChecked}
                className="flex items-center space-x-2 px-6 py-3 bg-red-600 hover:bg-red-500 active:bg-red-700 text-white font-bold text-sm rounded-xl shadow transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <Mic className="w-5 h-5" />
                <span>마이크 녹음 시작</span>
              </button>
            ) : (
              <>
                {recorderState === 'recording' ? (
                  <button
                    type="button"
                    onClick={handlePauseRecording}
                    className="flex items-center space-x-1.5 px-4 py-2.5 bg-amber-500 hover:bg-amber-600 text-white font-bold text-xs rounded-xl transition-colors"
                  >
                    <Pause className="w-4 h-4" />
                    <span>일시정지</span>
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={handleResumeRecording}
                    className="flex items-center space-x-1.5 px-4 py-2.5 bg-blue-600 hover:bg-blue-500 text-white font-bold text-xs rounded-xl transition-colors"
                  >
                    <Play className="w-4 h-4" />
                    <span>녹음 재개</span>
                  </button>
                )}

                <button
                  type="button"
                  onClick={handleStopRecording}
                  className="flex items-center space-x-1.5 px-5 py-2.5 bg-slate-900 hover:bg-slate-800 text-white font-bold text-xs rounded-xl transition-colors"
                >
                  <Square className="w-4 h-4 text-red-400" />
                  <span>녹음 완료 및 저장</span>
                </button>
              </>
            )}

            {/* 기존 녹음 파일 업로드 버튼 */}
            {recorderState === 'inactive' && (
              <>
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  className="flex items-center space-x-2 px-4 py-3 bg-slate-100 hover:bg-slate-200 text-slate-800 font-semibold text-xs rounded-xl transition-colors"
                >
                  <Upload className="w-4 h-4 text-slate-600" />
                  <span>오디오 파일 업로드</span>
                </button>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="audio/*,.mp3,.m4a,.wav,.webm,.ogg"
                  onChange={handleFileUpload}
                  className="hidden"
                />
              </>
            )}
          </div>
        )}

        {/* 업로드 진행 상태 표시 바 */}
        {isUploading && (
          <div className="p-4 bg-blue-50 border border-blue-200 rounded-xl space-y-2">
            <div className="flex items-center justify-between text-xs font-semibold text-blue-900">
              <span>오디오 파일 안전 저장 중...</span>
              <span>{uploadPercent}%</span>
            </div>
            <div className="w-full bg-blue-200 h-2 rounded-full overflow-hidden">
              <div
                className="bg-blue-600 h-full transition-all duration-150"
                style={{ width: `${uploadPercent}%` }}
              />
            </div>
          </div>
        )}
      </div>

      {/* 등록된 녹음 재생 및 AI 전사 제어 카드 */}
      {meeting.recording && (
        <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-6 space-y-4">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-slate-100 pb-3">
            <div className="flex items-center space-x-3">
              <div className="p-2.5 bg-blue-50 text-blue-600 rounded-lg">
                <FileAudio className="w-5 h-5" />
              </div>
              <div>
                <h4 className="text-sm font-bold text-slate-900">{meeting.recording.fileName}</h4>
                <p className="text-xs text-slate-500 flex items-center gap-1.5 flex-wrap">
                  <span>길이: {formatDuration(meeting.recording.durationSeconds)}</span>
                  <span>|</span>
                  <span>크기: {formatFileSize(meeting.recording.fileSizeBytes)}</span>
                  <span>|</span>
                  <span>형식: {meeting.recording.mimeType}</span>
                  {meeting.recording.transcriptionProvider && (
                    <>
                      <span>|</span>
                      <span className="inline-flex items-center px-2 py-0.5 rounded text-[11px] font-medium bg-slate-100 text-slate-600 border border-slate-200/80">
                        AI 전사 엔진: {meeting.recording.transcriptionProvider === 'openai' ? 'OpenAI' : 'Gemini (Fallback)'}
                      </span>
                    </>
                  )}
                </p>
              </div>
            </div>

            <div className="flex items-center space-x-2">
              {/* 원본 오디오 다운로드 */}
              {meeting.recording.downloadUrl && (
                <a
                  href={meeting.recording.downloadUrl}
                  download={meeting.recording.fileName}
                  className="inline-flex items-center space-x-1 px-3 py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-semibold rounded-lg transition-colors"
                >
                  <Download className="w-3.5 h-3.5" />
                  <span>다운로드</span>
                </a>
              )}

              {/* AI 전사 실행 버튼 */}
              {!isReadOnly && (
                <button
                  type="button"
                  id="btn-ai-transcribe"
                  onClick={handleTriggerTranscription}
                  disabled={isTranscribing}
                  className="flex items-center space-x-2 px-4 py-2 bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-500 hover:to-indigo-500 text-white text-xs font-bold rounded-lg shadow-sm transition-all disabled:opacity-60 disabled:cursor-not-allowed"
                >
                  {isTranscribing ? (
                    <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                  ) : (
                    <Sparkles className="w-3.5 h-3.5 text-amber-300" />
                  )}
                  <span>
                    {isTranscribing
                      ? 'AI가 회의 음성을 분석하고 있습니다...'
                      : transcribeError
                      ? 'AI 화자 분리 전사 재시도'
                      : 'AI 화자 분리 전사'}
                  </span>
                </button>
              )}
            </div>
          </div>

          {/* AI 전사 분석 진행 중 로딩 배너 */}
          {isTranscribing && (
            <div className="p-4 bg-indigo-50 border border-indigo-200 rounded-xl flex items-center space-x-3 text-indigo-900 text-xs animate-pulse">
              <RefreshCw className="w-5 h-5 animate-spin text-indigo-600 shrink-0" />
              <div>
                <p className="font-bold text-sm">AI가 회의 음성을 분석하고 있습니다...</p>
                <p className="text-indigo-600 text-xs mt-0.5">
                  화자 분리(Diarization) 및 회의 대화록을 생성하고 있습니다. 오디오 길이에 따라 약 5~20초 소요됩니다.
                </p>
              </div>
            </div>
          )}

          {/* 오디오 플레이어 (전사 실패 시에도 완벽 유지) */}
          {meeting.recording.downloadUrl && (
            <div className="pt-2">
              <audio
                ref={audioPlayerRef}
                controls
                src={meeting.recording.downloadUrl}
                className="w-full h-10 rounded-lg"
              />
            </div>
          )}

          {/* AI 전사 에러 배너 (전사 실패 시 표시되며 재시도 가능) */}
          {transcribeError && (
            <div className="p-4 bg-red-50 border border-red-200 rounded-xl flex items-start space-x-3 text-xs text-red-800">
              <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5 text-red-600" />
              <div className="flex-1 space-y-1">
                <p className="font-bold">AI 화자 분리 전사 실패</p>
                <p className="text-red-700 leading-relaxed">{transcribeError}</p>
                <p className="text-[11px] text-red-500 pt-1">
                  기존 녹음 파일과 재생 기능은 안전하게 유지됩니다. 설정 또는 네트워크 상태를 확인한 후 상단의 [AI 화자 분리 전사 재시도] 버튼을 클릭해주세요.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setTranscribeError(null)}
                className="font-bold text-red-600 hover:text-red-800 px-2 py-1 text-xs"
              >
                닫기
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
};
