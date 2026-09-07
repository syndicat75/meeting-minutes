/**
 * @file src/services/audioRecorder.ts
 * @description 브라우저 마이크 녹음 관리 엔진.
 * MediaRecorder MIME 타입 감지(iOS Safari vs Android/Chrome), 실시간 음량 측정(Web Audio API),
 * 화면 꺼짐 방지(Screen Wake Lock API), IndexedDB 청크 실시간 백업 및 중단 대응을 제공합니다.
 */

import { logger } from '../utils/logger';
import { initAudioSession, appendAudioChunk, getCombinedAudioBlob } from './indexedDbAudio';

export type RecorderState = 'inactive' | 'recording' | 'paused' | 'stopped';

export interface RecorderCallbacks {
  onStateChange: (state: RecorderState) => void;
  onTimeUpdate: (seconds: number) => void;
  onVolumeUpdate: (volume0to100: number) => void;
  onError: (errorMsg: string) => void;
}

/**
 * 브라우저에서 지원하는 최적의 Audio MIME 타입 결정
 * @returns {string} 지원되는 오디오 MIME 타입 문자열
 */
export function getSupportedMimeType(): string {
  logger.debug('getSupportedMimeType called');
  if (typeof window === 'undefined' || !window.MediaRecorder) {
    return 'audio/webm';
  }

  const candidateTypes = [
    'audio/webm;codecs=opus',
    'audio/webm',
    'audio/mp4',
    'audio/aac',
    'audio/ogg;codecs=opus',
  ];

  for (const type of candidateTypes) {
    if (MediaRecorder.isTypeSupported(type)) {
      logger.info('Selected supported audio MIME type', { type });
      return type;
    }
  }

  logger.warn('No standard audio MIME type verified, defaulting to empty string');
  return '';
}

/**
 * 브라우저 오디오 녹음기 클래스
 */
export class BrowserAudioRecorder {
  private mediaStream: MediaStream | null = null;
  private mediaRecorder: MediaRecorder | null = null;
  private audioContext: AudioContext | null = null;
  private analyser: AnalyserNode | null = null;
  private animFrameId: number | null = null;
  private wakeLock: any = null;

  private state: RecorderState = 'inactive';
  private durationSeconds: number = 0;
  private timerInterval: any = null;
  private meetingId: string = '';
  private chunkIndex: number = 0;
  private mimeType: string = '';
  private callbacks: RecorderCallbacks;

  /**
   * 생성자
   * @param callbacks 녹음기 상태 및 볼륨 이벤트 콜백
   */
  constructor(callbacks: RecorderCallbacks) {
    this.callbacks = callbacks;
    logger.info('BrowserAudioRecorder instantiated');
    this.setupBeforeUnloadWarning();
  }

  /**
   * 녹음 중 페이지 새로고침/이탈 방지 핸들러 등록
   */
  private setupBeforeUnloadWarning(): void {
    if (typeof window !== 'undefined') {
      window.addEventListener('beforeunload', (e) => {
        if (this.state === 'recording' || this.state === 'paused') {
          e.preventDefault();
          e.returnValue = '회의 녹음이 진행 중입니다. 페이지를 벗어나면 녹음이 중단될 수 있습니다.';
          return e.returnValue;
        }
      });
    }
  }

  /**
   * Screen Wake Lock 요청 (지원 시 화면 꺼짐 방지)
   */
  private async requestWakeLock(): Promise<void> {
    logger.info('requestWakeLock called');
    try {
      if ('wakeLock' in navigator) {
        this.wakeLock = await (navigator as any).wakeLock.request('screen');
        logger.info('Screen wake lock acquired');
        this.wakeLock.addEventListener('release', () => {
          logger.info('Screen wake lock released');
          this.wakeLock = null;
        });
      }
    } catch (err) {
      logger.warn('Screen wake lock request failed or not supported', { error: String(err) });
      this.wakeLock = null;
    }
  }

  /**
   * Screen Wake Lock 해제
   */
  private releaseWakeLock(): void {
    logger.info('releaseWakeLock called');
    if (this.wakeLock) {
      try {
        this.wakeLock.release();
      } catch (err) {
        logger.warn('Failed to release wakeLock', { error: String(err) });
      }
      this.wakeLock = null;
    }
  }

  /**
   * 실시간 마이크 입력 볼륨 모니터링 시작
   */
  private startVolumeMeter(): void {
    logger.debug('startVolumeMeter called');
    if (!this.mediaStream) return;

    try {
      const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
      if (!AudioCtx) return;

      this.audioContext = new AudioCtx();
      const source = this.audioContext.createMediaStreamSource(this.mediaStream);
      this.analyser = this.audioContext.createAnalyser();
      this.analyser.fftSize = 256;
      source.connect(this.analyser);

      const bufferLength = this.analyser.frequencyBinCount;
      const dataArray = new Uint8Array(bufferLength);

      const updateMeter = () => {
        if (!this.analyser || this.state === 'inactive') {
          this.callbacks.onVolumeUpdate(0);
          return;
        }

        this.analyser.getByteFrequencyData(dataArray);
        let sum = 0;
        for (let i = 0; i < bufferLength; i++) {
          sum += dataArray[i];
        }
        const avg = sum / bufferLength;
        // 0 ~ 100 정규화
        const volumeLevel = Math.min(100, Math.round((avg / 128) * 100));
        this.callbacks.onVolumeUpdate(volumeLevel);

        this.animFrameId = requestAnimationFrame(updateMeter);
      };

      updateMeter();
    } catch (err) {
      logger.warn('AudioContext volume meter initialization failed', { error: String(err) });
    }
  }

  /**
   * 실시간 볼륨 모니터링 중지
   */
  private stopVolumeMeter(): void {
    logger.debug('stopVolumeMeter called');
    if (this.animFrameId) {
      cancelAnimationFrame(this.animFrameId);
      this.animFrameId = null;
    }
    if (this.audioContext) {
      try {
        this.audioContext.close();
      } catch (e) {
        logger.warn('Error closing audio context', { error: String(e) });
      }
      this.audioContext = null;
    }
    this.analyser = null;
    this.callbacks.onVolumeUpdate(0);
  }

  /**
   * 녹음 시작
   * @param meetingId 회의 ID
   */
  public async start(meetingId: string): Promise<void> {
    logger.info('start recording called', { meetingId });
    this.meetingId = meetingId;
    this.durationSeconds = 0;
    this.chunkIndex = 0;

    // 마이크 장치 및 권한 확인
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      const msg = '현재 브라우저 환경에서는 마이크 접근이 지원되지 않습니다.';
      logger.error(msg);
      this.callbacks.onError(msg);
      return;
    }

    try {
      this.mediaStream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      });
    } catch (err: any) {
      let errorMsg = '마이크 접근 권한이 거부되었거나 장치를 찾을 수 없습니다.';
      if (err.name === 'NotAllowedError' || err.name === 'PermissionDeniedError') {
        errorMsg = '마이크 사용 권한이 거부되었습니다. 브라우저 주소창 좌측 설정에서 마이크를 허용해주세요.';
      } else if (err.name === 'NotFoundError' || err.name === 'DevicesNotFoundError') {
        errorMsg = '연결된 마이크 입력 장치를 찾을 수 없습니다. 마이크 연결 상태를 확인해주세요.';
      }
      logger.error('getUserMedia failed', { errorName: err.name, errorMessage: err.message });
      this.callbacks.onError(errorMsg);
      return;
    }

    this.mimeType = getSupportedMimeType();

    try {
      const options = this.mimeType ? { mimeType: this.mimeType } : undefined;
      this.mediaRecorder = new MediaRecorder(this.mediaStream, options);
    } catch (createErr) {
      logger.warn('MediaRecorder with specified mimeType failed, falling back to default', { mimeType: this.mimeType });
      this.mediaRecorder = new MediaRecorder(this.mediaStream);
    }

    // IndexedDB 세션 초기화
    try {
      await initAudioSession(this.meetingId, this.mimeType);
    } catch (dbErr) {
      logger.warn('Failed to init IndexedDB session, continuing in memory', { error: String(dbErr) });
    }

    this.mediaRecorder.ondataavailable = async (event: BlobEvent) => {
      if (event.data && event.data.size > 0) {
        logger.debug('MediaRecorder ondataavailable chunk received', { size: event.data.size, index: this.chunkIndex });
        try {
          await appendAudioChunk(this.meetingId, this.chunkIndex, event.data);
          this.chunkIndex++;
        } catch (storageErr) {
          logger.warn('Failed to write chunk to IndexedDB', { error: String(storageErr) });
        }
      }
    };

    this.mediaRecorder.onerror = (event: any) => {
      logger.error('MediaRecorder error event', event.error);
      this.callbacks.onError(`녹음 중 오류가 발생했습니다: ${event.error?.message || '알 수 없는 오류'}`);
    };

    // 5초마다 청크 flush하여 브라우저 메모리 부하 방지 및 IndexedDB 순차 저장
    this.mediaRecorder.start(5000);
    this.state = 'recording';
    this.callbacks.onStateChange(this.state);

    // 타이머 및 볼륨 미터
    this.timerInterval = setInterval(() => {
      if (this.state === 'recording') {
        this.durationSeconds++;
        this.callbacks.onTimeUpdate(this.durationSeconds);
      }
    }, 1000);

    this.startVolumeMeter();
    await this.requestWakeLock();
  }

  /**
   * 녹음 일시정지
   */
  public pause(): void {
    logger.info('pause recording called');
    if (this.mediaRecorder && this.state === 'recording') {
      this.mediaRecorder.pause();
      this.state = 'paused';
      this.callbacks.onStateChange(this.state);
      this.releaseWakeLock();
    }
  }

  /**
   * 녹음 재개
   */
  public async resume(): Promise<void> {
    logger.info('resume recording called');
    if (this.mediaRecorder && this.state === 'paused') {
      this.mediaRecorder.resume();
      this.state = 'recording';
      this.callbacks.onStateChange(this.state);
      await this.requestWakeLock();
    }
  }

  /**
   * 녹음 종료 및 완성된 Audio Blob 반환
   * @returns {Promise<{ blob: Blob; durationSeconds: number; mimeType: string } | null>}
   */
  public async stop(): Promise<{ blob: Blob; durationSeconds: number; mimeType: string } | null> {
    logger.info('stop recording called');
    if (!this.mediaRecorder || this.state === 'inactive') {
      return null;
    }

    return new Promise((resolve) => {
      this.mediaRecorder!.onstop = async () => {
        logger.info('MediaRecorder onstop fired');
        this.stopVolumeMeter();
        this.releaseWakeLock();

        if (this.timerInterval) {
          clearInterval(this.timerInterval);
          this.timerInterval = null;
        }

        if (this.mediaStream) {
          this.mediaStream.getTracks().forEach((t) => t.stop());
          this.mediaStream = null;
        }

        this.state = 'inactive';
        this.callbacks.onStateChange(this.state);

        // IndexedDB에서 합쳐진 오디오 Blob 로드
        let finalBlob = await getCombinedAudioBlob(this.meetingId);
        if (!finalBlob) {
          logger.warn('Could not assemble blob from IndexedDB');
        }

        resolve(
          finalBlob
            ? {
                blob: finalBlob,
                durationSeconds: this.durationSeconds,
                mimeType: this.mimeType || finalBlob.type || 'audio/webm',
              }
            : null
        );
      };

      try {
        this.mediaRecorder!.stop();
      } catch (err) {
        logger.error('Error calling mediaRecorder.stop()', err);
        resolve(null);
      }
    });
  }

  /**
   * 현재 녹음기 상태 반환
   */
  public getState(): RecorderState {
    return this.state;
  }
}
