/**
 * @file src/services/chunkAudioRecorder.ts
 * @description 장시간(최대 3시간) 회의를 위한 5분 단위 연속 청크 오디오 녹음 엔진.
 * 마이크 스트림(MediaStream)은 최초 1회 획득 후 회의 종료 시까지 중단 없이 유지되며,
 * 5분마다 독립적인 WebM/MP4 컨테이너 헤더를 가진 완성된 오디오 Blob을 생성하여 즉시 콜백으로 전달합니다.
 * Screen Wake Lock 및 3시간 도달 자동 안전 완료를 지원합니다.
 */

import { logger } from '../utils/logger';
import { APP_CONFIG } from '../config/appConfig';

/**
 * 5분 청크 생성 콜백 인터페이스
 */
export interface OnChunkReadyCallback {
  (
    chunkBlob: Blob,
    chunkIndex: number, // 1, 2, 3...
    startSeconds: number,
    endSeconds: number
  ): void | Promise<void>;
}

/**
 * 녹음기 상태 변화 콜백
 */
export interface RecorderCallbacks {
  onTick?: (durationSeconds: number, volumeLevel: number) => void;
  onChunkReady?: OnChunkReadyCallback;
  onMaxDurationReached?: () => void;
  onError?: (error: Error) => void;
}

/**
 * 브라우저 5분 연속 청크 녹음기 클래스
 */
export class ChunkAudioRecorder {
  private mediaStream: MediaStream | null = null;
  private currentRecorder: MediaRecorder | null = null;
  private currentRecordedSlices: Blob[] = [];
  private audioContext: AudioContext | null = null;
  private analyser: AnalyserNode | null = null;
  private wakeLockSentinel: any = null;

  private isRecording: boolean = false;
  private isPaused: boolean = false;
  private chunkIndex: number = 1;
  private durationSeconds: number = 0;
  private chunkStartSeconds: number = 0;

  private tickTimer: any = null;
  private chunkTimer: any = null;
  private volumeLevel: number = 0;
  private mimeType: string = 'audio/webm';

  private callbacks: RecorderCallbacks = {};

  // 5분 = 300,000ms (기본 설정)
  private readonly chunkDurationMs: number = APP_CONFIG.limits.chunkDurationMs || 5 * 60 * 1000;
  // 최대 녹음 시간 (3시간 = 10,800초)
  private readonly maxDurationSeconds: number = APP_CONFIG.limits.maxRecordingDurationSeconds || 180 * 60;

  constructor(callbacks: RecorderCallbacks = {}) {
    logger.info('ChunkAudioRecorder initialized', {
      chunkDurationMs: this.chunkDurationMs,
      maxDurationSeconds: this.maxDurationSeconds,
    });
    this.callbacks = callbacks;
  }

  /**
   * 브라우저 지원 오디오 MIME 타입 자동 감지
   */
  private getSupportedMimeType(): string {
    const candidateTypes = [
      'audio/webm;codecs=opus',
      'audio/webm',
      'audio/mp4;codecs=mp4a.40.2',
      'audio/mp4',
      'audio/ogg;codecs=opus',
    ];

    if (typeof MediaRecorder === 'undefined') {
      return 'audio/webm';
    }

    for (const type of candidateTypes) {
      if (MediaRecorder.isTypeSupported(type)) {
        logger.debug('Supported audio MIME type chosen', { mimeType: type });
        return type;
      }
    }

    return 'audio/webm';
  }

  /**
   * 모바일 및 데스크톱 브라우저 절전/화면 꺼짐 방지 (Screen Wake Lock API)
   */
  private async requestWakeLock(): Promise<void> {
    try {
      if ('wakeLock' in navigator && (navigator as any).wakeLock) {
        this.wakeLockSentinel = await (navigator as any).wakeLock.request('screen');
        logger.info('Screen wake lock acquired');
        this.wakeLockSentinel.addEventListener('release', () => {
          logger.info('Screen wake lock released');
        });
      }
    } catch (err) {
      logger.warn('Failed to acquire screen wake lock', { error: String(err) });
    }
  }

  /**
   * Screen Wake Lock 해제
   */
  private async releaseWakeLock(): Promise<void> {
    try {
      if (this.wakeLockSentinel) {
        await this.wakeLockSentinel.release();
        this.wakeLockSentinel = null;
      }
    } catch (err) {
      logger.warn('Failed to release screen wake lock', { error: String(err) });
    }
  }

  /**
   * 실시간 마이크 오디오 레벨 분석 노드 설정
   */
  private setupAudioAnalyser(stream: MediaStream): void {
    try {
      const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
      if (!AudioCtx) return;

      this.audioContext = new AudioCtx();
      const source = this.audioContext.createMediaStreamSource(stream);
      this.analyser = this.audioContext.createAnalyser();
      this.analyser.fftSize = 256;
      this.analyser.smoothingTimeConstant = 0.8;
      source.connect(this.analyser);
    } catch (err) {
      logger.warn('Failed to set up AudioContext analyser', { error: String(err) });
    }
  }

  /**
   * 실시간 볼륨(0 ~ 100) 계산
   */
  private calculateVolume(): number {
    if (!this.analyser || this.isPaused) return 0;
    const dataArray = new Uint8Array(this.analyser.frequencyBinCount);
    this.analyser.getByteFrequencyData(dataArray);

    let sum = 0;
    for (let i = 0; i < dataArray.length; i++) {
      sum += dataArray[i];
    }
    const average = sum / dataArray.length;
    return Math.min(100, Math.round((average / 128) * 100));
  }

  /**
   * 마이크 녹음 시작
   */
  public async start(): Promise<void> {
    logger.info('ChunkAudioRecorder.start called');

    if (this.isRecording) {
      logger.warn('ChunkAudioRecorder is already recording');
      return;
    }

    try {
      // 1. 사용자 마이크 권한 요청 (최초 1회만 호출)
      this.mediaStream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
        video: false,
      });

      this.mimeType = this.getSupportedMimeType();
      this.setupAudioAnalyser(this.mediaStream);
      await this.requestWakeLock();

      this.isRecording = true;
      this.isPaused = false;
      this.durationSeconds = 0;
      this.chunkIndex = 1;
      this.chunkStartSeconds = 0;

      // 2. 첫 번째 5분 청크 녹음 시작
      this.startNewChunkMediaRecorder();

      // 3. 1초 주기 타이머 및 볼륨 갱신 루프
      this.tickTimer = setInterval(() => {
        if (!this.isPaused && this.isRecording) {
          this.durationSeconds += 1;
          this.volumeLevel = this.calculateVolume();

          if (this.callbacks.onTick) {
            this.callbacks.onTick(this.durationSeconds, this.volumeLevel);
          }

          // 최대 권장 녹음시간(3시간 = 10,800초) 도달 확인
          if (this.durationSeconds >= this.maxDurationSeconds) {
            logger.warn('Max recording duration 3 hours reached');
            if (this.callbacks.onMaxDurationReached) {
              this.callbacks.onMaxDurationReached();
            }
            this.stop().catch((e) => logger.error('Auto-stop on max duration failed', e));
          }
        }
      }, 1000);

      // 4. 5분마다 다음 청크로 자동 교체 스케줄링
      this.scheduleNextChunkTransition();
    } catch (err: any) {
      logger.error('Failed to start audio recording', err);
      this.cleanup();
      if (this.callbacks.onError) {
        this.callbacks.onError(err);
      }
      throw err;
    }
  }

  /**
   * 단일 5분 청크를 녹음하는 MediaRecorder 인스턴스 생성 및 시작
   */
  private startNewChunkMediaRecorder(): void {
    if (!this.mediaStream || !this.isRecording) return;

    logger.info('startNewChunkMediaRecorder called', { chunkIndex: this.chunkIndex });

    this.currentRecordedSlices = [];

    const recorder = new MediaRecorder(this.mediaStream, {
      mimeType: this.mimeType,
      audioBitsPerSecond: 128000,
    });

    recorder.ondataavailable = (event: BlobEvent) => {
      if (event.data && event.data.size > 0) {
        this.currentRecordedSlices.push(event.data);
      }
    };

    recorder.start(1000); // 1초마다 데이터 슬라이스 수집
    this.currentRecorder = recorder;
  }

  /**
   * 5분 경과 시 현재 청크를 확정하고, 즉시 다음 청크로 연속 전환
   */
  private scheduleNextChunkTransition(): void {
    if (this.chunkTimer) {
      clearTimeout(this.chunkTimer);
      this.chunkTimer = null;
    }

    this.chunkTimer = setTimeout(async () => {
      if (!this.isRecording) return;

      logger.info('5-minute chunk duration elapsed, cycling to next chunk', {
        completedChunkIndex: this.chunkIndex,
      });

      await this.finalizeCurrentChunkAndRotate();
      // 다음 5분 교체 예약
      this.scheduleNextChunkTransition();
    }, this.chunkDurationMs);
  }

  /**
   * 현재 청크 MediaRecorder를 안전하게 마무리하고 다음 청크 생성
   */
  private async finalizeCurrentChunkAndRotate(): Promise<void> {
    if (!this.currentRecorder || !this.isRecording) return;

    const recorder = this.currentRecorder;
    const chunkIdx = this.chunkIndex;
    const startSec = this.chunkStartSeconds;
    const endSec = this.durationSeconds;

    // 즉시 다음 청크 인덱스 및 시작 시간 설정 후 새 녹음기 시작 (마이크 스트림은 끊김 없이 유지)
    this.chunkIndex += 1;
    this.chunkStartSeconds = this.durationSeconds;
    this.startNewChunkMediaRecorder();

    // 이전 청크 정지 및 완성된 Blob 생성
    await new Promise<void>((resolve) => {
      recorder.onstop = () => {
        try {
          const chunkBlob = new Blob(this.currentRecordedSlices, { type: this.mimeType });
          logger.info('Completed 5-minute chunk Blob ready', {
            chunkIndex: chunkIdx,
            sizeBytes: chunkBlob.size,
            startSec,
            endSec,
          });

          if (this.callbacks.onChunkReady) {
            this.callbacks.onChunkReady(chunkBlob, chunkIdx, startSec, endSec);
          }
        } catch (err) {
          logger.error('Error creating chunk Blob on stop', err);
        }
        resolve();
      };

      if (recorder.state !== 'inactive') {
        recorder.stop();
      } else {
        resolve();
      }
    });
  }

  /**
   * 일시 정지
   */
  public pause(): void {
    logger.info('ChunkAudioRecorder.pause called');
    if (!this.isRecording || this.isPaused) return;

    this.isPaused = true;
    if (this.currentRecorder && this.currentRecorder.state === 'recording') {
      this.currentRecorder.pause();
    }
  }

  /**
   * 다시 시작 (재개)
   */
  public resume(): void {
    logger.info('ChunkAudioRecorder.resume called');
    if (!this.isRecording || !this.isPaused) return;

    this.isPaused = false;
    if (this.currentRecorder && this.currentRecorder.state === 'paused') {
      this.currentRecorder.resume();
    }
  }

  /**
   * 녹음 완전히 종료 (마지막 미완성 청크 확정 및 마이크 리소스 정리)
   * @returns {Promise<{ totalDurationSeconds: number, totalChunks: number }>}
   */
  public async stop(): Promise<{ totalDurationSeconds: number; totalChunks: number }> {
    logger.info('ChunkAudioRecorder.stop called', {
      durationSeconds: this.durationSeconds,
      chunkIndex: this.chunkIndex,
    });

    if (!this.isRecording) {
      return { totalDurationSeconds: this.durationSeconds, totalChunks: this.chunkIndex };
    }

    this.isRecording = false;

    if (this.tickTimer) {
      clearInterval(this.tickTimer);
      this.tickTimer = null;
    }

    if (this.chunkTimer) {
      clearTimeout(this.chunkTimer);
      this.chunkTimer = null;
    }

    const lastChunkIdx = this.chunkIndex;
    const lastStartSec = this.chunkStartSeconds;
    const lastEndSec = this.durationSeconds;

    // 마지막 청크 정지 및 콜백 호출
    if (this.currentRecorder && this.currentRecorder.state !== 'inactive') {
      await new Promise<void>((resolve) => {
        if (!this.currentRecorder) return resolve();
        this.currentRecorder.onstop = async () => {
          try {
            if (this.currentRecordedSlices.length > 0) {
              const finalChunkBlob = new Blob(this.currentRecordedSlices, { type: this.mimeType });
              logger.info('Final chunk Blob ready', {
                chunkIndex: lastChunkIdx,
                sizeBytes: finalChunkBlob.size,
                startSec: lastStartSec,
                endSec: lastEndSec,
              });

              if (this.callbacks.onChunkReady) {
                await Promise.resolve(this.callbacks.onChunkReady(finalChunkBlob, lastChunkIdx, lastStartSec, lastEndSec));
              }
            }
          } catch (err) {
            logger.error('Error creating or handling final chunk Blob', err);
          }
          resolve();
        };

        this.currentRecorder.stop();
      });
    }

    // 마이크 하드웨어 및 Wake Lock 해제
    this.cleanup();

    return {
      totalDurationSeconds: this.durationSeconds,
      totalChunks: lastChunkIdx,
    };
  }

  /**
   * 마이크 스트림 및 내부 리소스 해제
   */
  private cleanup(): void {
    logger.info('ChunkAudioRecorder.cleanup called');

    if (this.mediaStream) {
      this.mediaStream.getTracks().forEach((track) => track.stop());
      this.mediaStream = null;
    }

    if (this.audioContext && this.audioContext.state !== 'closed') {
      this.audioContext.close().catch(() => {});
      this.audioContext = null;
    }

    this.releaseWakeLock();
    this.currentRecorder = null;
    this.analyser = null;
    this.isRecording = false;
  }

  public getDurationSeconds(): number {
    return this.durationSeconds;
  }

  public getIsRecording(): boolean {
    return this.isRecording;
  }

  public getIsPaused(): boolean {
    return this.isPaused;
  }

  public getCurrentChunkIndex(): number {
    return this.chunkIndex;
  }
}
