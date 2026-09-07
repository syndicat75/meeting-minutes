/**
 * @file src/components/common/Header.tsx
 * @description 상단 네비게이션 헤더. 로고, Firebase 연결 상태 배지, Google 로그인/사용자 프로필, 신규 회의 작성 버튼을 제공합니다.
 */

import React from 'react';
import { FileText, Plus, Database, LogIn, LogOut, CheckCircle, AlertTriangle } from 'lucide-react';
import { AppUser, FirebaseConnectionStatus } from '../../types/auth';
import { logger } from '../../utils/logger';

interface HeaderProps {
  currentUser: AppUser | null;
  firebaseStatus: FirebaseConnectionStatus;
  onOpenFirebaseModal: () => void;
  onLogin: () => void;
  onLogout: () => void;
  onNewMeeting: () => void;
  onGoHome: () => void;
}

/**
 * 상단 글로벌 네비게이션 헤더 컴포넌트
 */
export const Header: React.FC<HeaderProps> = ({
  currentUser,
  firebaseStatus,
  onOpenFirebaseModal,
  onLogin,
  onLogout,
  onNewMeeting,
  onGoHome,
}) => {
  logger.debug('Header rendered', { hasUser: Boolean(currentUser), isConfigured: firebaseStatus.isConfigured });

  return (
    <header className="sticky top-0 z-40 bg-slate-900 border-b border-slate-800 text-white shadow-md">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between">
        {/* 로고 & 타이틀 */}
        <div
          id="app-logo-container"
          onClick={onGoHome}
          className="flex items-center space-x-3 cursor-pointer hover:opacity-90 transition-opacity"
        >
          <div className="w-10 h-10 rounded-lg bg-blue-600 flex items-center justify-center shadow-sm">
            <FileText className="w-5 h-5 text-white" />
          </div>
          <div>
            <div className="flex items-center space-x-2">
              <span className="text-lg font-bold tracking-tight text-white">AI 회의록 관리</span>
              <span className="text-xs px-2 py-0.5 rounded bg-blue-900/80 text-blue-200 border border-blue-700/50 font-mono">
                v1.0
              </span>
            </div>
            <p className="text-xs text-slate-400 hidden sm:block">
              위험성평가 위원회 및 업무 회의록 전자서명 시스템
            </p>
          </div>
        </div>

        {/* 우측 컨트롤 영역 */}
        <div className="flex items-center space-x-2 sm:space-x-3">
          {/* Firebase 연결 상태 배지 버튼 */}
          <button
            id="btn-firebase-status"
            type="button"
            onClick={onOpenFirebaseModal}
            className={`flex items-center space-x-1.5 px-2.5 py-1 rounded-full text-xs font-medium border transition-colors ${
              firebaseStatus.isConfigured
                ? 'bg-emerald-950/60 text-emerald-300 border-emerald-700/60 hover:bg-emerald-900/60'
                : 'bg-amber-950/60 text-amber-300 border-amber-700/60 hover:bg-amber-900/60'
            }`}
            title="Firebase 연결 설정 및 상태 확인"
          >
            <Database className="w-3.5 h-3.5" />
            <span className="hidden md:inline">
              {firebaseStatus.isConfigured ? 'Firebase 연결됨' : 'Firebase 설정 필요'}
            </span>
            {firebaseStatus.isConfigured ? (
              <CheckCircle className="w-3.5 h-3.5 text-emerald-400" />
            ) : (
              <AlertTriangle className="w-3.5 h-3.5 text-amber-400" />
            )}
          </button>

          {/* 신규 회의 작성 버튼 */}
          <button
            id="btn-new-meeting"
            type="button"
            onClick={onNewMeeting}
            className="flex items-center space-x-1.5 bg-blue-600 hover:bg-blue-500 active:bg-blue-700 text-white text-xs sm:text-sm font-semibold px-3 py-1.5 rounded-lg shadow-sm transition-colors"
          >
            <Plus className="w-4 h-4" />
            <span>새 회의</span>
          </button>

          {/* 인증 상태 및 로그인/로그아웃 */}
          {currentUser ? (
            <div className="flex items-center space-x-2 pl-2 border-l border-slate-700">
              {currentUser.photoURL ? (
                <img
                  src={currentUser.photoURL}
                  alt={currentUser.displayName || '사용자'}
                  referrerPolicy="no-referrer"
                  className="w-8 h-8 rounded-full border border-slate-600"
                />
              ) : (
                <div className="w-8 h-8 rounded-full bg-slate-700 text-slate-200 flex items-center justify-center font-bold text-xs">
                  {currentUser.displayName?.[0] || currentUser.email?.[0] || 'U'}
                </div>
              )}
              <div className="hidden lg:block text-left">
                <div className="text-xs font-semibold text-slate-200 truncate max-w-[120px]">
                  {currentUser.displayName || '로그인 사용자'}
                </div>
                <div className="text-[10px] text-slate-400 truncate max-w-[120px]">
                  {currentUser.email || currentUser.uid.substring(0, 8)}
                </div>
              </div>
              <button
                id="btn-header-logout"
                type="button"
                onClick={onLogout}
                className="p-1.5 text-slate-400 hover:text-red-400 hover:bg-slate-800 rounded transition-colors"
                title="로그아웃"
              >
                <LogOut className="w-4 h-4" />
              </button>
            </div>
          ) : (
            <button
              id="btn-header-login"
              type="button"
              onClick={onLogin}
              className="flex items-center space-x-1.5 bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 text-xs sm:text-sm font-medium px-2.5 py-1.5 rounded-lg transition-colors"
            >
              <LogIn className="w-4 h-4" />
              <span className="hidden sm:inline">Google 로그인</span>
            </button>
          )}
        </div>
      </div>
    </header>
  );
};
