/**
 * @file src/utils/formatters.ts
 * @description 날짜, 시각, 오디오 재생 시간(초), 파일 크기 변환 포맷터 함수 모음
 */

import { logger } from './logger';

/**
 * 초 단위를 "MM:SS" 또는 "HH:MM:SS" 형식으로 변환
 * @param seconds 초 단위 숫자
 * @returns 포맷된 시간 문자열
 */
export function formatDuration(seconds: number): string {
  if (isNaN(seconds) || seconds < 0) return '00:00';
  const totalSeconds = Math.floor(seconds);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const remainingSeconds = totalSeconds % 60;

  const pad = (n: number) => n.toString().padStart(2, '0');

  if (hours > 0) {
    return `${pad(hours)}:${pad(minutes)}:${pad(remainingSeconds)}`;
  }
  return `${pad(minutes)}:${pad(remainingSeconds)}`;
}

/**
 * 바이트 크기를 사람이 읽기 쉬운 단위(KB, MB, GB)로 변환
 * @param bytes 바이트 수
 * @returns 포맷된 파일 크기 문자열
 */
export function formatFileSize(bytes: number): string {
  if (isNaN(bytes) || bytes <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  let i = 0;
  let size = bytes;
  while (size >= 1024 && i < units.length - 1) {
    size /= 1024;
    i++;
  }
  return `${size.toFixed(1)} ${units[i]}`;
}

/**
 * ISO 날짜 문자열을 한국어 형식으로 변환 (예: 2026년 3월 15일 (일))
 * @param dateStr YYYY-MM-DD 또는 ISO 문자열
 * @returns 한국어 날짜 문자열
 */
export function formatKoreanDate(dateStr: string): string {
  if (!dateStr) return '';
  try {
    const d = new Date(dateStr);
    if (isNaN(d.getTime())) return dateStr;
    const days = ['일', '월', '화', '수', '목', '금', '토'];
    const year = d.getFullYear();
    const month = d.getMonth() + 1;
    const date = d.getDate();
    const dayName = days[d.getDay()];
    return `${year}년 ${month}월 ${date}일 (${dayName})`;
  } catch (err) {
    logger.warn('formatKoreanDate failed', { dateStr, error: String(err) });
    return dateStr;
  }
}

/**
 * 날짜 및 시작/종료 시각을 결합하여 표준 회의 일시 문자열 생성
 * @param date 날짜
 * @param startTime 시작 시각
 * @param endTime 종료 시각
 * @returns "2026.03.15 (14:00 ~ 16:00)" 형태
 */
export function formatMeetingDateTime(date: string, startTime: string, endTime: string): string {
  const dateFormatted = date ? date.replace(/-/g, '.') : '';
  if (startTime && endTime) {
    return `${dateFormatted} (${startTime} ~ ${endTime})`;
  }
  if (startTime) {
    return `${dateFormatted} (${startTime} ~)`;
  }
  return dateFormatted;
}

/**
 * ISO 날짜시간 문자열을 "YYYY.MM.DD HH:mm" 한국어 형식으로 변환
 * @param isoStr ISO 날짜시간 문자열
 * @returns 포맷된 일시 문자열
 */
export function formatKoreanDateTime(isoStr: string): string {
  if (!isoStr) return '';
  try {
    const d = new Date(isoStr);
    if (isNaN(d.getTime())) return isoStr;
    const year = d.getFullYear();
    const month = String(d.getMonth() + 1).padStart(2, '0');
    const date = String(d.getDate()).padStart(2, '0');
    const hours = String(d.getHours()).padStart(2, '0');
    const mins = String(d.getMinutes()).padStart(2, '0');
    return `${year}.${month}.${date} ${hours}:${mins}`;
  } catch (err) {
    logger.warn('formatKoreanDateTime failed', { isoStr, error: String(err) });
    return isoStr;
  }
}

