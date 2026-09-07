/**
 * @file src/components/meeting/tabs/RecordingTab.tsx
 * @description 장시간(최대 3시간) 업무용 회의를 위한 5분 단위 자동 Chunk 녹음 및 AI 전사 관리 탭.
 * - 5분마다 무중단 자동 Chunk 분할 및 Firebase Storage 즉시 직업로드
 * - 실시간 "N / N 구간 저장 완료" 상태 표시 및 구간별 업로드/전사 현황
 * - 최대 3시간 도달 자동 안전 마무리 및 Screen Wake Lock 지원
 * - 동시 2개 제한 청크 전사 오케스트레이션 및 부분 실패 재시도 기능
 * - 외부 오디오 파일(MP3, M4A, WAV, WebM) 업로드 완벽 호환
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
  Clock,
  Layers,
  Check,
  RotateCcw,
} from 'lucide-react';
import { Meeting, AudioChunk, RecordingMetadata } from '../../../types/meeting';
import { ChunkAudioRecorder } from '../../../services/chunkAudioRecorder';
import {
  processAndUploadAudioChunk,
  getMeetingAudioChunks,
  retryFailedAudioChunk,
} from '../../../services/audioChunkService';
import {
  transcribeAllChunks,
  transcribeSingleChunk,
  mergeAndDeduplicateTranscripts,
  requestComprehensiveMeetingSummary,
} from '../../../services/transcriptionClientService';
import { uploadRecordingAudio } from '../../../services/storageService';
import { removeAudioSession } from '../../../services/indexedDbAudio';
import { getFirebaseAuth } from '../../../services/firebase';
import { formatDuration, formatFileSize } from '../../../utils/formatters';
import { APP_CONFIG } from '../../../config/appConfig';
import { logger } from '../../../utils/logger';

interface RecordingTabProps {
  meeting: Meeting;
  isReadOnly: boolean;
  onUpdateMeeting: (partial: Partial<Meeting>) => void;
  onSwitchToTranscriptTab: () => void;
  onRecordingStateChange?: (isRecording: boolean, durationSeconds: number) => void;
}

/**
 * 시간 포맷 헬퍼 (초 -> HH:MM:SS)
 */
function formatSeconds(sec: number): string {
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = Math.floor(sec % 60);
  if (h > 0) {
    return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  }
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

export const RecordingTab: React.FC<RecordingTabProps> = ({
  meeting,
  isReadOnly,
  onUpdateMeeting,
  onSwitchToTranscriptTab,
  onRecordingStateChange,
}) => {
  logger.debug('RecordingTab rendered', { meetingId: meeting.id });

  // 녹음기 상태
  const [isRecording, setIsRecording] = useState<boolean>(false);
  const [isPaused, setIsPaused] = useState<boolean>(false);
  const [recordDuration, setRecordDuration] = useState<number>(
    meeting.recordedDurationSeconds || meeting.recording?.durationSeconds || 0
  );

  // 상위 컴포넌트에 실시간 녹음 상태 알림
  useEffect(() => {
    onRecordingStateChange?.(isRecording, recordDuration);
  }, [isRecording, recordDuration, onRecordingStateChange]);
  // 녹음 완료 후 타이머가 00:00:00으로 리셋되지 않도록 지속 보존하는 상태
  const [lastRecordedDuration, setLastRecordedDuration] = useState<number>(
    meeting.recordedDurationSeconds || meeting.recording?.durationSeconds || 0
  );
  const [isFinalizing, setIsFinalizing] = useState<boolean>(false);
  const [retryingChunkId, setRetryingChunkId] = useState<string | null>(null);
  const [inputVolume, setInputVolume] = useState<number>(0);
  const [activeChunkIndex, setActiveChunkIndex] = useState<number>(1);

  // 청크 목록 상태 (로컬 상태 및 meeting.audioChunks 동기화)
  const [chunks, setChunks] = useState<AudioChunk[]>(meeting.audioChunks || []);

  // UI 알림 및 에러
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [maxDurationAlert, setMaxDurationAlert] = useState<boolean>(false);

  // 법적 고지 및 참석자 동의
  const [isConsentChecked, setIsConsentChecked] = useState<boolean>(
    meeting.recording?.isConsentGiven || false
  );

  // 업로드 진행 상태
  const [isUploading, setIsUploading] = useState<boolean>(false);
  const [uploadPercent, setUploadPercent] = useState<number>(0);

  // 전사 진행 상태
  const [isTranscribing, setIsTranscribing] = useState<boolean>(false);
  const [transcribeProgressLabel, setTranscribeProgressLabel] = useState<string>('');
  const [transcribeProgressPercent, setTranscribeProgressPercent] = useState<number>(0);
  const [transcribeError, setTranscribeError] = useState<string | null>(null);

  // 요약 생성 상태
  const [isSummarizing, setIsSummarizing] = useState<boolean>(false);

  // 참조 관리
  const recorderRef = useRef<ChunkAudioRecorder | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const activeMeetingIdRef = useRef<string>(meeting.id);

  // 회의 변경 시 ID 참조 동기화 및 Firestore 청크 목록 로드
  useEffect(() => {
    activeMeetingIdRef.current = meeting.id;
    if (meeting.audioChunks && meeting.audioChunks.length > 0) {
      setChunks(meeting.audioChunks);
    } else {
      getMeetingAudioChunks(meeting.id)
        .then((loaded) => {
          if (loaded && loaded.length > 0) {
            setChunks(loaded);
          }
        })
        .catch((e) => logger.warn('Failed to load chunks from Firestore', e));
    }
    if (meeting.recordedDurationSeconds || meeting.recording?.durationSeconds) {
      const savedDuration = meeting.recordedDurationSeconds || meeting.recording?.durationSeconds || 0;
      if (savedDuration > 0) {
        setLastRecordedDuration((prev) => Math.max(prev, savedDuration));
        if (!isRecording) {
          setRecordDuration((prev) => Math.max(prev, savedDuration));
        }
      }
    }
  }, [meeting.id, meeting.audioChunks, meeting.recordedDurationSeconds, meeting.recording?.durationSeconds, isRecording]);

  // 언마운트 시 활성 녹음 정리
  useEffect(() => {
    return () => {
      if (recorderRef.current && recorderRef.current.getIsRecording()) {
        recorderRef.current.stop().catch(() => {});
      }
    };
  }, []);

  /**
   * 5분 단위 Chunk 생성 콜백 핸들러
   */
  const handleChunkReady = async (
    blob: Blob,
    chunkIndex: number,
    startSeconds: number,
    endSeconds: number
  ) => {
    const currentMeetingId = activeMeetingIdRef.current;
    // 정렬 가능한 4자리 chunkId 표준화
    const chunkId = `chunk_${String(chunkIndex).padStart(4, '0')}`;

    logger.info('handleChunkReady triggered', {
      meetingId: currentMeetingId,
      chunkId,
      chunkIndex,
      startSeconds,
      endSeconds,
      blobSize: blob.size,
    });

    // 낙관적 UI 업데이트
    setChunks((prev) => {
      const existing = prev.find((c) => c.id === chunkId);
      if (existing) return prev;
      const newChunk: AudioChunk = {
        id: chunkId,
        meetingId: currentMeetingId,
        index: chunkIndex,
        startSeconds,
        endSeconds,
        duration: Math.max(1, endSeconds - startSeconds),
        durationSeconds: Math.max(1, endSeconds - startSeconds),
        size: blob.size,
        fileSizeBytes: blob.size,
        mimeType: blob.type || 'audio/webm',
        storagePath: `meetings/${currentMeetingId}/audio/chunks/${chunkId}.webm`,
        uploadStatus: 'uploading',
        transcriptionStatus: 'pending',
        transcriptionAttempts: 0,
        createdAt: new Date().toISOString(),
      };
      return [...prev, newChunk];
    });

    try {
      const savedChunk = await processAndUploadAudioChunk(
        currentMeetingId,
        chunkId,
        chunkIndex,
        blob,
        blob.type || 'audio/webm',
        startSeconds,
        endSeconds
      );

      // 성공한 청크로 로컬 상태 갱신
      setChunks((prev) => {
        const updated = prev.map((c) => (c.id === chunkId ? savedChunk : c));
        const upCount = updated.filter((c) => c.uploadStatus === 'uploaded').length;
        onUpdateMeeting({
          audioChunks: updated,
          uploadedChunksCount: upCount,
          totalChunksCount: updated.length,
        });
        return updated;
      });
    } catch (err: any) {
      logger.error('Failed to process and upload chunk', { chunkId, err });
      setChunks((prev) => {
        const updated = prev.map((c) =>
          c.id === chunkId
            ? { ...c, uploadStatus: 'failed' as const, errorMessage: err.message || '저장 실패' }
            : c
        );
        const upCount = updated.filter((c) => c.uploadStatus === 'uploaded').length;
        onUpdateMeeting({
          audioChunks: updated,
          uploadedChunksCount: upCount,
          totalChunksCount: updated.length,
        });
        return updated;
      });
    }
  };

  /**
   * 녹음 시작
   */
  const handleStartRecording = async () => {
    logger.info('handleStartRecording called');
    if (!isConsentChecked) {
      setErrorMessage('녹음 전 모든 참석자에게 녹음 및 AI 대화록 처리를 사전 고지하고 동의 확인을 체크해야 합니다.');
      return;
    }

    // 1. Storage 업로드 필수 전제 조건: Firebase 로그인 상태 확인
    const auth = getFirebaseAuth();
    if (!auth?.currentUser) {
      setErrorMessage('회의 음성 클라우드(Storage) 저장을 위해 먼저 상단 우측 [Google 로그인]을 완료해주세요.');
      return;
    }

    setErrorMessage(null);
    setMaxDurationAlert(false);

    // 새 녹음 시작 시 타이머 초기화
    setRecordDuration(0);
    setLastRecordedDuration(0);

    try {
      const recorder = new ChunkAudioRecorder({
        onTick: (duration, volume) => {
          setRecordDuration(duration);
          setInputVolume(volume);
        },
        onChunkReady: handleChunkReady,
        onMaxDurationReached: () => {
          setMaxDurationAlert(true);
          setIsRecording(false);
        },
        onError: (err) => {
          setErrorMessage(err.message || '마이크 접근에 실패했습니다.');
          setIsRecording(false);
        },
      });

      recorderRef.current = recorder;
      await recorder.start();

      setIsRecording(true);
      setIsPaused(false);
      setActiveChunkIndex(1);
      onUpdateMeeting({ recordingStatus: 'recording' });
    } catch (err: any) {
      logger.error('Failed to start recording', err);
      setErrorMessage(err.message || '마이크 사용 권한을 확인해주세요.');
    }
  };

  /**
   * 일시 정지
   */
  const handlePauseRecording = () => {
    logger.info('handlePauseRecording called');
    if (recorderRef.current) {
      recorderRef.current.pause();
      setIsPaused(true);
      onUpdateMeeting({ recordingStatus: 'paused' });
    }
  };

  /**
   * 녹음 재개
   */
  const handleResumeRecording = () => {
    logger.info('handleResumeRecording called');
    if (recorderRef.current) {
      recorderRef.current.resume();
      setIsPaused(false);
      onUpdateMeeting({ recordingStatus: 'recording' });
    }
  };

  /**
   * 녹음 완전히 종료 및 최종 청크 저장
   */
  const handleStopRecording = async () => {
    logger.info('handleStopRecording called');
    if (!recorderRef.current) return;

    setIsFinalizing(true);
    setErrorMessage(null);

    // 정지 직전까지 녹음된 시간(초) 확보
    const durationAtStop = Math.max(recordDuration, 1);

    try {
      const { totalDurationSeconds } = await recorderRef.current.stop();

      // 녹음 종료 후에도 메인 타이머 시간(초) 보존 (절대 0으로 초기화되지 않음)
      const finalDuration = Math.max(durationAtStop, totalDurationSeconds, 1);
      setRecordDuration(finalDuration);
      setLastRecordedDuration(finalDuration);
      setIsRecording(false);
      setIsPaused(false);

      const latestChunks = await getMeetingAudioChunks(meeting.id);
      // 로컬 청크 상태가 있을 경우 빈 배열로 덮어쓰지 않도록 안전 병합
      const resolvedChunks = (latestChunks && latestChunks.length > 0) ? latestChunks : chunks;
      setChunks(resolvedChunks);

      const totalBytes = resolvedChunks.reduce((acc, c) => acc + (c.size || c.fileSizeBytes || 0), 0);
      const upCount = resolvedChunks.filter((c) => c.uploadStatus === 'uploaded').length;
      const failCount = resolvedChunks.filter((c) => c.uploadStatus === 'failed').length;

      const firstUploaded = resolvedChunks.find((c) => c.uploadStatus === 'uploaded');

      const metadata: RecordingMetadata = {
        id: 'rec_' + Date.now(),
        storagePath: firstUploaded?.storagePath || resolvedChunks[0]?.storagePath || '',
        downloadUrl: firstUploaded?.downloadUrl || resolvedChunks[0]?.downloadUrl,
        durationSeconds: finalDuration,
        fileSizeBytes: totalBytes,
        mimeType: 'audio/webm',
        fileName: `회의녹음_${meeting.date || '회의'}.webm`,
        uploadedAt: new Date().toISOString(),
        isConsentGiven: true,
      };

      onUpdateMeeting({
        recording: metadata,
        recordedDurationSeconds: finalDuration,
        recordingStatus: 'completed',
        audioChunks: resolvedChunks,
        uploadedChunksCount: upCount,
        totalChunksCount: resolvedChunks.length,
      });

      if (failCount > 0) {
        setErrorMessage(
          `전체 ${resolvedChunks.length}개 구간 중 ${failCount}개 구간의 클라우드 저장에 실패했습니다. 아래 [저장 재시도] 버튼을 눌러 다시 저장하거나, 즉시 AI 전사를 진행하실 수 있습니다.`
        );
      } else {
        logger.info('Recording stopped and all chunks finalized successfully');
      }

      await removeAudioSession(meeting.id);
    } catch (err: any) {
      logger.error('Error stopping recording', err);
      setErrorMessage(`녹음 종료 중 오류: ${err.message}`);
    } finally {
      setIsFinalizing(false);
    }
  };

  /**
   * 실패한 단일 청크 수동 업로드 재시도 (로컬 IndexedDB -> Storage)
   */
  const handleRetryChunkUpload = async (chunk: AudioChunk) => {
    logger.info('handleRetryChunkUpload called', { chunkId: chunk.id });
    setRetryingChunkId(chunk.id);
    setErrorMessage(null);

    try {
      const updated = await retryFailedAudioChunk(meeting.id, chunk.id);
      if (updated) {
        setChunks((prev) => {
          const list = prev.map((c) => (c.id === chunk.id ? updated : c));
          const upCount = list.filter((c) => c.uploadStatus === 'uploaded').length;
          onUpdateMeeting({
            audioChunks: list,
            uploadedChunksCount: upCount,
            totalChunksCount: list.length,
          });
          return list;
        });
      }
    } catch (err: any) {
      logger.error('Retry chunk upload failed', { chunkId: chunk.id, error: err });
      setErrorMessage(`청크 ${chunk.id} 재저장 실패: ${err.message || 'Storage 연결을 확인해주세요.'}`);
    } finally {
      setRetryingChunkId(null);
    }
  };

  /**
   * 실패한 단일 청크 개별 전사 재시도
   */
  const handleRetrySingleChunkTranscribe = async (chunk: AudioChunk) => {
    logger.info('handleRetrySingleChunkTranscribe called', { chunkId: chunk.id });
    try {
      const res = await transcribeSingleChunk(meeting.id, chunk, {
        meetingTitle: meeting.title,
        agenda: meeting.agenda,
        attendeeNames: meeting.attendees.map((a) => a.name),
        expectedSpeakerCount: meeting.expectedSpeakerCount,
      });

      setChunks((prev) => {
        const updatedList = prev.map((c) =>
          c.id === chunk.id
            ? {
                ...c,
                transcriptionStatus: 'completed' as const,
                transcripts: res.transcripts,
                provider: res.provider,
              }
            : c
        );
        const merged = mergeAndDeduplicateTranscripts(updatedList);
        onUpdateMeeting({ audioChunks: updatedList, transcripts: merged });
        return updatedList;
      });
    } catch (err: any) {
      setErrorMessage(`구간 전사 재시도 실패: ${err.message}`);
    }
  };

  /**
   * 전체 구간 AI 전사 일괄 실행
   */
  const handleBatchTranscribe = async (retryOnlyFailed: boolean = false) => {
    logger.info('handleBatchTranscribe called', { retryOnlyFailed });
    if (chunks.length === 0) {
      setTranscribeError('전사할 오디오 구간이 없습니다.');
      return;
    }

    setIsTranscribing(true);
    setTranscribeError(null);
    setTranscribeProgressPercent(0);
    setTranscribeProgressLabel('전사 준비 중...');

    try {
      const result = await transcribeAllChunks(
        meeting.id,
        chunks,
        {
          meetingTitle: meeting.title,
          agenda: meeting.agenda,
          attendeeNames: meeting.attendees.map((a) => a.name),
          expectedSpeakerCount: meeting.expectedSpeakerCount,
        },
        (completed, total, percent, label) => {
          setTranscribeProgressPercent(percent);
          setTranscribeProgressLabel(label);
        },
        retryOnlyFailed
      );

      // 최신 청크 목록 다시 로드
      const freshChunks = await getMeetingAudioChunks(meeting.id);
      setChunks(freshChunks);

      onUpdateMeeting({
        transcripts: result.allSegments,
        audioChunks: freshChunks,
        status: meeting.status === 'draft' ? 'review' : meeting.status,
        recording: meeting.recording
          ? {
              ...meeting.recording,
              transcriptionProvider: result.primaryProvider as any,
              fallbackUsed: result.anyFallbackUsed,
            }
          : undefined,
      });

      if (result.failedChunkIds.length > 0) {
        setTranscribeError(
          `전체 ${result.totalCount}구간 중 ${result.failedChunkIds.length}개 구간 전사가 실패했습니다. 개별 재시도할 수 있습니다.`
        );
      } else {
        logger.info('All chunks transcribed successfully');
      }
    } catch (err: any) {
      logger.error('Batch transcription failed', err);
      setTranscribeError(err?.message || '일괄 전사 처리 중 오류가 발생했습니다.');
    } finally {
      setIsTranscribing(false);
    }
  };

  /**
   * 종합 AI 회의 요약 생성 트리거
   */
  const handleGenerateSummary = async () => {
    logger.info('handleGenerateSummary called');
    if (!meeting.transcripts || meeting.transcripts.length === 0) {
      setErrorMessage('먼저 AI 전사를 완료해주세요.');
      return;
    }

    setIsSummarizing(true);
    setErrorMessage(null);

    try {
      const summary = await requestComprehensiveMeetingSummary(
        meeting.id,
        {
          title: meeting.title,
          agenda: meeting.agenda,
          department: meeting.department,
          date: meeting.date,
          attendees: meeting.attendees,
        },
        meeting.transcripts
      );

      onUpdateMeeting({ summary });
      onSwitchToTranscriptTab();
    } catch (err: any) {
      logger.error('Generate summary failed', err);
      setErrorMessage(`회의 요약 생성 실패: ${err.message}`);
    } finally {
      setIsSummarizing(false);
    }
  };

  /**
   * 외부 오디오 파일 업로드 (기존 회의 음성 파일 대응)
   */
  const handleFileUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    if (file.size > APP_CONFIG.limits.maxRecordingFileSizeBytes) {
      setErrorMessage(`파일 크기가 200MB를 초과합니다. (현재: ${formatFileSize(file.size)})`);
      return;
    }

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

      onUpdateMeeting({ recording: metadata, recordingStatus: 'completed' });
      setIsUploading(false);
    } catch (err: any) {
      logger.error('File upload failed', err);
      setErrorMessage(`오디오 파일 업로드 실패: ${err.message}`);
      setIsUploading(false);
    }
  };

  // 통계 계산
  const totalChunksCount = chunks.length;
  const uploadedChunksCount = chunks.filter((c) => c.uploadStatus === 'uploaded').length;
  const failedUploadChunksCount = chunks.filter((c) => c.uploadStatus === 'failed').length;
  const uploadingChunksCount = chunks.filter((c) => c.uploadStatus === 'uploading').length;
  const transcribedChunksCount = chunks.filter((c) => c.transcriptionStatus === 'completed').length;
  const failedTranscribeCount = chunks.filter(
    (c) => c.uploadStatus === 'uploaded' && c.transcriptionStatus === 'failed'
  ).length;

  // 전체 청크 저장 성공 여부 (모든 청크가 업로드 완료되어야 함)
  const isAllChunksUploaded = totalChunksCount > 0 && uploadedChunksCount === totalChunksCount;
  // AI 전사 시작 가능 여부 (모든 청크 저장 완료 & 녹음 중/정리 중이 아님)
  const canStartBatchTranscribe =
    isAllChunksUploaded && !isTranscribing && !isRecording && !isFinalizing;

  // 표시할 타이머 시간(초) - 녹음 중지 후에도 00:00:00 리셋 방지
  const displayDurationSeconds = isRecording
    ? recordDuration
    : Math.max(
        lastRecordedDuration,
        recordDuration,
        meeting.recordedDurationSeconds || 0,
        meeting.recording?.durationSeconds || 0,
        chunks.reduce((acc, c) => acc + (c.durationSeconds || c.duration || 0), 0)
      );

  // 상단 상태 문구 결정 함수 (상단-하단 통일: "저장: X/Y 완료")
  const getStatusText = () => {
    if (isRecording && !isPaused) {
      return `실시간 녹음 중 (현재 제${activeChunkIndex}구간)`;
    }
    if (isPaused) {
      return '녹음 일시 정지됨';
    }
    if (isFinalizing) {
      return '녹음 완료 및 마지막 구간 클라우드 저장 중...';
    }
    if (failedUploadChunksCount > 0) {
      return `저장: ${uploadedChunksCount}/${totalChunksCount} 완료 (${failedUploadChunksCount}개 저장 실패)`;
    }
    if (uploadingChunksCount > 0) {
      return `저장: ${uploadedChunksCount}/${totalChunksCount} 진행 중...`;
    }
    if (totalChunksCount > 0) {
      return `저장: ${uploadedChunksCount}/${totalChunksCount} 완료`;
    }
    return '녹음 대기 중';
  };

  return (
    <div className="space-y-6">
      {/* 3시간 도달 알림 모달 */}
      {maxDurationAlert && (
        <div className="p-4 bg-amber-50 border border-amber-300 rounded-xl flex items-start space-x-3 text-amber-900 text-xs shadow-sm">
          <AlertTriangle className="w-5 h-5 text-amber-600 shrink-0 mt-0.5" />
          <div className="flex-1 space-y-1">
            <h4 className="font-bold text-sm">최대 권장 녹음시간(3시간)에 도달했습니다.</h4>
            <p className="leading-relaxed">
              데이터의 안정성과 브라우저 메모리 보호를 위해 녹음이 자동으로 안전하게 마무리되었습니다.
              모든 구간 파일이 클라우드 스토리지에 보존되었으며, 이제 AI 전사를 진행하실 수 있습니다.
            </p>
          </div>
          <button
            onClick={() => setMaxDurationAlert(false)}
            className="font-bold text-amber-700 hover:text-amber-900"
          >
            확인
          </button>
        </div>
      )}

      {/* 에러 메시지 배너 */}
      {errorMessage && (
        <div className="p-4 bg-red-50 border border-red-200 rounded-xl flex items-start space-x-3 text-red-800 text-xs">
          <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5 text-red-600" />
          <div className="flex-1 space-y-1">
            <div className="font-bold">안내 및 오류</div>
            <div className="leading-relaxed">{errorMessage}</div>
          </div>
          <button onClick={() => setErrorMessage(null)} className="font-bold text-red-600 hover:text-red-800">
            닫기
          </button>
        </div>
      )}

      {/* 규정 준수 및 참석자 동의 확인 박스 */}
      <div className="bg-slate-50 border border-slate-200 rounded-xl p-4 text-xs text-slate-600 space-y-2">
        <div className="flex items-center space-x-2 font-bold text-slate-800">
          <ShieldCheck className="w-4 h-4 text-blue-600" />
          <span>장시간(최대 3시간) 고안정성 녹음 및 규정 준수 안내</span>
        </div>
        <p className="leading-relaxed">
          • 5분마다 마이크 녹음이 끊김 없이 분할되어 안전한 클라우드 전용 스토리지에 실시간 자동 보관됩니다.
          <br />
          • 화면 꺼짐 방지(Screen Wake Lock)가 자동으로 활성화됩니다.
        </p>

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
            disabled={isReadOnly || isRecording || isFinalizing}
            className="w-4 h-4 text-blue-600 rounded border-slate-300 focus:ring-blue-500"
          />
          <span>[필수] 모든 참석자에게 회의 녹음 및 AI 대화록 처리를 사전 고지하고 동의를 확인하였습니다.</span>
        </label>
      </div>

      {/* 녹음 콘솔 메인 카드 */}
      <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-6 space-y-6">
        <div className="text-center space-y-2">
          {/* 타이머: 28초 등 녹음 완료 후 00:00:00 리셋 방지 */}
          <div className="text-4xl sm:text-5xl font-mono font-bold text-slate-900 tracking-wider">
            {formatSeconds(displayDurationSeconds)}
          </div>

          {/* 상태 배지 */}
          <div className="flex items-center justify-center space-x-2 text-xs">
            <span
              className={`w-2.5 h-2.5 rounded-full ${
                isRecording && !isPaused
                  ? 'bg-red-500 animate-ping'
                  : isPaused
                  ? 'bg-amber-500'
                  : isFinalizing || uploadingChunksCount > 0
                  ? 'bg-blue-500 animate-pulse'
                  : failedUploadChunksCount > 0
                  ? 'bg-red-500'
                  : totalChunksCount > 0 && isAllChunksUploaded
                  ? 'bg-green-500'
                  : 'bg-slate-300'
              }`}
            />
            <span
              className={`font-semibold ${
                failedUploadChunksCount > 0 ? 'text-red-700 font-bold' : 'text-slate-700'
              }`}
            >
              {getStatusText()}
            </span>
          </div>

          {/* 실시간 5분 청크 저장 현황 배지 */}
          {totalChunksCount > 0 && (
            <div
              className={`inline-flex items-center space-x-2 px-3 py-1 rounded-full text-xs font-semibold border mt-1 ${
                failedUploadChunksCount > 0
                  ? 'bg-red-50 text-red-800 border-red-200'
                  : isAllChunksUploaded
                  ? 'bg-green-50 text-green-800 border-green-200'
                  : 'bg-blue-50 text-blue-800 border-blue-200'
              }`}
            >
              <Layers className="w-3.5 h-3.5" />
              <span>
                저장: {uploadedChunksCount}/{totalChunksCount} 완료 (5분 자동 분할)
                {failedUploadChunksCount > 0 && ` • ${failedUploadChunksCount}구간 저장 실패`}
              </span>
            </div>
          )}

          {/* 마이크 입력 음량 게이지 바 */}
          {isRecording && (
            <div className="max-w-xs mx-auto pt-2">
              <div className="flex items-center justify-between text-[11px] text-slate-500 mb-1">
                <span className="flex items-center">
                  <Volume2 className="w-3 h-3 mr-1" />
                  마이크 음량
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
            {!isRecording && !isFinalizing ? (
              <button
                type="button"
                id="btn-start-chunk-recording"
                onClick={handleStartRecording}
                disabled={!isConsentChecked}
                className="flex items-center space-x-2 px-6 py-3 bg-red-600 hover:bg-red-500 active:bg-red-700 text-white font-bold text-sm rounded-xl shadow transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <Mic className="w-5 h-5" />
                <span>마이크 녹음 시작</span>
              </button>
            ) : isFinalizing ? (
              <button
                type="button"
                disabled
                className="flex items-center space-x-2 px-6 py-3 bg-slate-800 text-white font-bold text-sm rounded-xl opacity-90 cursor-wait shadow"
              >
                <RefreshCw className="w-5 h-5 animate-spin text-blue-400" />
                <span>마지막 구간 클라우드 저장 중...</span>
              </button>
            ) : (
              <>
                {!isPaused ? (
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
                  id="btn-stop-chunk-recording"
                  onClick={handleStopRecording}
                  disabled={isFinalizing}
                  className="flex items-center space-x-1.5 px-5 py-2.5 bg-slate-900 hover:bg-slate-800 text-white font-bold text-xs rounded-xl transition-colors disabled:opacity-60"
                >
                  <Square className="w-4 h-4 text-red-400" />
                  <span>녹음 완료 및 저장</span>
                </button>
              </>
            )}

            {/* 외부 오디오 파일 업로드 */}
            {!isRecording && !isFinalizing && (
              <>
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  className="flex items-center space-x-2 px-4 py-3 bg-slate-100 hover:bg-slate-200 text-slate-800 font-semibold text-xs rounded-xl transition-colors"
                >
                  <Upload className="w-4 h-4 text-slate-600" />
                  <span>기존 음성 파일 첨부</span>
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

        {/* 파일 업로드 진행 표시 바 */}
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

      {/* 5분 구간(Chunk) 목록 및 AI 전사 관리 카드 */}
      {totalChunksCount > 0 && (
        <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-6 space-y-4">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-slate-100 pb-3">
            <div>
              <h4 className="text-sm font-bold text-slate-900 flex items-center gap-2">
                <Layers className="w-4 h-4 text-blue-600" />
                <span>5분 단위 녹음 구간 목록 ({totalChunksCount}개 구간)</span>
              </h4>
              <p className="text-xs text-slate-500 mt-0.5">
                저장: {uploadedChunksCount}/{totalChunksCount} 완료 | AI 전사: {transcribedChunksCount}/
                {totalChunksCount} 완료
                {failedTranscribeCount > 0 && (
                  <span className="text-red-600 font-semibold ml-1">({failedTranscribeCount}구간 실패)</span>
                )}
              </p>
            </div>

            {/* 일괄 전사 및 요약 액션 버튼 군 */}
            {!isReadOnly && !isRecording && (
              <div className="flex items-center space-x-2 flex-wrap">
                {failedTranscribeCount > 0 && isAllChunksUploaded && (
                  <button
                    type="button"
                    onClick={() => handleBatchTranscribe(true)}
                    disabled={isTranscribing}
                    className="flex items-center space-x-1 px-3 py-1.5 bg-amber-500 hover:bg-amber-600 text-white text-xs font-bold rounded-lg transition-colors disabled:opacity-50"
                  >
                    <RotateCcw className="w-3.5 h-3.5" />
                    <span>실패 구간({failedTranscribeCount}) 재전사</span>
                  </button>
                )}

                {/* 예상 화자 수 설정 (1명/2명/다자 등) */}
                <div className="flex items-center space-x-1.5 bg-slate-50 border border-slate-200 px-2.5 py-1 rounded-lg">
                  <span className="text-[11px] font-semibold text-slate-600">예상 화자:</span>
                  <select
                    disabled={isTranscribing || isReadOnly}
                    value={meeting.expectedSpeakerCount || 0}
                    onChange={(e) => onUpdateMeeting({ expectedSpeakerCount: parseInt(e.target.value, 10) })}
                    className="text-xs bg-transparent border-0 font-medium text-slate-800 focus:ring-0 p-0 cursor-pointer"
                    title="실제 발언 예상 인원수를 지정하면 화자 과다 분리를 방지할 수 있습니다."
                  >
                    <option value={0}>자동 감지</option>
                    <option value={1}>1명 (단독 회의)</option>
                    <option value={2}>2명 (1:1 회의)</option>
                    <option value={3}>3명</option>
                    <option value={4}>4명</option>
                    <option value={5}>5명 이상</option>
                  </select>
                </div>

                <div className="relative group">
                  <button
                    type="button"
                    id="btn-batch-transcribe"
                    onClick={() => handleBatchTranscribe(false)}
                    disabled={!canStartBatchTranscribe}
                    title={
                      !isAllChunksUploaded
                        ? '모든 구간 파일이 클라우드에 안전하게 저장 완료된 후 AI 전사를 시작할 수 있습니다.'
                        : '전체 회의 구간 AI 화자 분리 전사 시작'
                    }
                    className="flex items-center space-x-1.5 px-4 py-2 bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-500 hover:to-indigo-500 text-white text-xs font-bold rounded-lg shadow-sm transition-all disabled:opacity-40 disabled:cursor-not-allowed"
                  >
                    {isTranscribing ? (
                      <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                    ) : (
                      <Sparkles className="w-3.5 h-3.5 text-amber-300" />
                    )}
                    <span>
                      {isTranscribing
                        ? 'AI 전사 진행 중...'
                        : transcribedChunksCount > 0
                        ? '전체 구간 재전사'
                        : '전체 구간 AI 화자 분리 전사'}
                    </span>
                  </button>
                </div>

                {transcribedChunksCount > 0 && (
                  <button
                    type="button"
                    onClick={handleGenerateSummary}
                    disabled={isSummarizing}
                    className="flex items-center space-x-1.5 px-3.5 py-2 bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold rounded-lg shadow-sm transition-all disabled:opacity-60"
                  >
                    {isSummarizing ? (
                      <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                    ) : (
                      <CheckCircle2 className="w-3.5 h-3.5" />
                    )}
                    <span>종합 회의록 요약 생성</span>
                  </button>
                )}
              </div>
            )}
          </div>

          {/* 저장 실패 경고 알림 */}
          {failedUploadChunksCount > 0 && !isRecording && (
            <div className="p-3.5 bg-red-50 border border-red-200 rounded-lg space-y-2 text-xs text-red-800">
              <div className="flex items-center justify-between">
                <span className="flex items-center font-bold">
                  <AlertTriangle className="w-4 h-4 text-red-600 mr-2 shrink-0" />
                  <span>
                    클라우드 저장에 실패한 구간({failedUploadChunksCount}개)이 있습니다.
                  </span>
                </span>
                {chunks.some((c) => c.errorCode === 'storage/unauthorized') && (
                  <span className="px-2 py-0.5 bg-red-100 text-red-700 font-mono rounded text-[11px] font-semibold">
                    HTTP 403 권한 오류
                  </span>
                )}
              </div>
              {chunks.some((c) => c.errorCode === 'storage/unauthorized') ? (
                <div className="text-[11px] text-red-700 leading-relaxed bg-white/70 p-2.5 rounded border border-red-100 space-y-1">
                  <p className="font-semibold text-red-900">
                    Firebase Storage 저장 권한이 없습니다 (HTTP 403 storage/unauthorized).
                  </p>
                  <p className="text-slate-600">
                    • Firebase Console &gt; Build &gt; Storage &gt; Rules 탭에 <code>storage.rules</code> 규칙이 게시(Publish)되었는지 확인해주세요.
                    <br />
                    • 브라우저 콘솔에서 <code>[firebase-diagnostics]</code> 로그(projectId, storageBucket, source) 및 <code>[storage-auth]</code>를 확인해주세요.
                  </p>
                </div>
              ) : (
                <p className="text-[11px] text-slate-600">
                  AI 전사를 진행하려면 각 구간의 <strong>[저장 재시도]</strong>를 먼저 완료해야 합니다.
                </p>
              )}
            </div>
          )}

          {/* 일괄 전사 진행 상태 표시줄 */}
          {isTranscribing && (
            <div className="p-4 bg-indigo-50 border border-indigo-200 rounded-xl space-y-2">
              <div className="flex items-center justify-between text-xs font-bold text-indigo-900">
                <span className="flex items-center space-x-1.5">
                  <RefreshCw className="w-3.5 h-3.5 animate-spin text-indigo-600" />
                  <span>{transcribeProgressLabel}</span>
                </span>
                <span>{transcribeProgressPercent}%</span>
              </div>
              <div className="w-full bg-indigo-200 h-2 rounded-full overflow-hidden">
                <div
                  className="bg-indigo-600 h-full transition-all duration-300"
                  style={{ width: `${transcribeProgressPercent}%` }}
                />
              </div>
              <p className="text-[11px] text-indigo-600">
                OpenAI 및 Gemini 엔진을 통해 동시 최대 2개 구간씩 순차/병렬 전사를 수행하고 있습니다.
              </p>
            </div>
          )}

          {/* 전사 에러 배너 */}
          {transcribeError && (
            <div className="p-4 bg-red-50 border border-red-200 rounded-xl flex items-start space-x-3 text-xs text-red-800">
              <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5 text-red-600" />
              <div className="flex-1 space-y-1">
                <p className="font-bold">AI 전사 안내</p>
                <p className="text-red-700">{transcribeError}</p>
              </div>
              <button
                type="button"
                onClick={() => setTranscribeError(null)}
                className="font-bold text-red-600 hover:text-red-800"
              >
                닫기
              </button>
            </div>
          )}

          {/* 각 5분 Chunk 세부 카드 목록 */}
          <div className="space-y-2 max-h-96 overflow-y-auto pr-1">
            {chunks.map((chunk) => {
              const timeLabel = `${formatSeconds(chunk.startSeconds)} ~ ${formatSeconds(chunk.endSeconds)}`;
              const isChunkUploading = chunk.uploadStatus === 'uploading';
              const isChunkUploadFailed = chunk.uploadStatus === 'failed';
              const isChunkTranscribing = chunk.transcriptionStatus === 'processing';
              const isChunkTranscribeCompleted = chunk.transcriptionStatus === 'completed';
              const isChunkTranscribeFailed = chunk.transcriptionStatus === 'failed';

              return (
                <div
                  key={chunk.id}
                  className="p-3 bg-slate-50 border border-slate-200 rounded-lg flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-xs hover:bg-slate-100/80 transition-colors"
                >
                  <div className="flex items-center space-x-3">
                    <div className="w-7 h-7 rounded-lg bg-blue-100 text-blue-800 font-bold flex items-center justify-center text-xs shrink-0">
                      {chunk.index}
                    </div>
                    <div>
                      <div className="flex items-center space-x-2">
                        <span className="font-bold text-slate-900">제{chunk.index}구간</span>
                        <span className="font-mono text-slate-500">({timeLabel})</span>
                        {chunk.fileSizeBytes && (
                          <span className="text-[11px] text-slate-400">
                            {formatFileSize(chunk.fileSizeBytes)}
                          </span>
                        )}
                      </div>

                      {/* 상태 태그 */}
                      <div className="flex items-center space-x-2 mt-1">
                        {/* 스토리지 업로드 상태 */}
                        {isChunkUploading ? (
                          <span className="inline-flex items-center text-blue-600">
                            <RefreshCw className="w-3 h-3 animate-spin mr-1" />
                            업로드 중...
                          </span>
                        ) : isChunkUploadFailed ? (
                          <span className="inline-flex items-center text-red-600 font-semibold">
                            <AlertTriangle className="w-3 h-3 mr-1" />
                            {chunk.errorCode === 'storage/unauthorized'
                              ? 'Firebase Storage 저장 권한이 없습니다.'
                              : chunk.errorMessage || '업로드 실패'}
                          </span>
                        ) : (
                          <span className="inline-flex items-center text-green-700">
                            <Check className="w-3 h-3 mr-1" />
                            저장 완료
                          </span>
                        )}

                        <span>•</span>

                        {/* AI 전사 상태 */}
                        {isChunkTranscribing ? (
                          <span className="inline-flex items-center text-indigo-600">
                            <RefreshCw className="w-3 h-3 animate-spin mr-1" />
                            AI 전사 중...
                          </span>
                        ) : isChunkTranscribeCompleted ? (
                          <span className="inline-flex items-center text-emerald-700 font-semibold">
                            <CheckCircle2 className="w-3 h-3 mr-1" />
                            전사 완료 ({chunk.transcripts?.length || 0}개 발언)
                          </span>
                        ) : isChunkTranscribeFailed ? (
                          <span className="inline-flex items-center text-red-600 font-semibold">
                            <AlertTriangle className="w-3 h-3 mr-1" />
                            전사 실패
                          </span>
                        ) : (
                          <span className="text-slate-400">전사 대기</span>
                        )}
                      </div>

                      {/* 관리자 진단 영역 (storage/unauthorized, HTTP 403, storagePath) */}
                      {isChunkUploadFailed && (
                        <div className="mt-1 flex items-center gap-1.5 text-[10px] font-mono text-slate-500 flex-wrap">
                          <span className="px-1.5 py-0.5 bg-red-100 text-red-800 rounded border border-red-200">
                            {chunk.errorCode || 'storage/unauthorized'}
                          </span>
                          {(chunk.errorCode === 'storage/unauthorized' || chunk.errorMessage?.includes('권한')) && (
                            <span className="px-1.5 py-0.5 bg-amber-100 text-amber-900 rounded border border-amber-200 font-bold">
                              HTTP 403
                            </span>
                          )}
                          {chunk.storagePath && (
                            <span className="text-slate-400 truncate max-w-[280px]" title={chunk.storagePath}>
                              {chunk.storagePath}
                            </span>
                          )}
                        </div>
                      )}
                    </div>
                  </div>

                  {/* 구간별 오디오 플레이어 & 액션 */}
                  <div className="flex items-center space-x-2 self-end sm:self-center">
                    {/* 오디오 플레이어 */}
                    {chunk.downloadUrl && (
                      <audio controls src={chunk.downloadUrl} className="h-8 w-48 sm:w-56" />
                    )}

                    {/* 다운로드 버튼 */}
                    {chunk.downloadUrl && (
                      <a
                        href={chunk.downloadUrl}
                        download={`회의구간_${chunk.index}.webm`}
                        title="해당 구간 다운로드"
                        className="p-1.5 text-slate-500 hover:text-slate-800 bg-white border border-slate-200 rounded-md"
                      >
                        <Download className="w-3.5 h-3.5" />
                      </a>
                    )}

                    {/* 업로드 실패 재시도 */}
                    {isChunkUploadFailed && !isReadOnly && (
                      <button
                        type="button"
                        onClick={() => handleRetryChunkUpload(chunk)}
                        disabled={retryingChunkId === chunk.id}
                        className="flex items-center space-x-1 px-2.5 py-1 bg-red-600 text-white rounded text-[11px] font-bold hover:bg-red-500 disabled:opacity-60 transition-colors"
                      >
                        {retryingChunkId === chunk.id ? (
                          <>
                            <RefreshCw className="w-3 h-3 animate-spin" />
                            <span>저장 중...</span>
                          </>
                        ) : (
                          <>
                            <RotateCcw className="w-3 h-3" />
                            <span>저장 재시도</span>
                          </>
                        )}
                      </button>
                    )}

                    {/* 개별 전사 재시도 */}
                    {(isChunkTranscribeFailed || (!isChunkTranscribeCompleted && !isTranscribing)) &&
                      !isReadOnly &&
                      !isChunkUploading &&
                      !isChunkUploadFailed && (
                        <button
                          type="button"
                          onClick={() => handleRetrySingleChunkTranscribe(chunk)}
                          disabled={isChunkTranscribing || isTranscribing}
                          className="px-2.5 py-1 bg-slate-200 hover:bg-slate-300 text-slate-800 rounded text-[11px] font-semibold transition-colors disabled:opacity-50"
                        >
                          {isChunkTranscribeFailed ? '재전사' : '구간 전사'}
                        </button>
                      )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
};
