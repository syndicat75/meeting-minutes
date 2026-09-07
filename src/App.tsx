/**
 * @file src/App.tsx
 * @description AI 회의록 관리 웹 애플리케이션의 최상위 메인 컴포넌트.
 * 인증 상태 구독, 회의 목록/상세 전환 라우팅, Firebase 설정 모달 및 삭제 확인 모달을 관리합니다.
 */

import React, { useState, useEffect, useCallback } from 'react';
import { Header } from './components/common/Header';
import { Footer } from './components/common/Footer';
import { FirebaseConfigModal } from './components/common/FirebaseConfigModal';
import { ConfirmModal } from './components/common/ConfirmModal';
import { MeetingListView } from './components/meeting/MeetingListView';
import { MeetingDetailView } from './components/meeting/MeetingDetailView';
import { Meeting } from './types/meeting';
import { AppUser, FirebaseConnectionStatus, AuthErrorInfo } from './types/auth';
import {
  fetchMeetings,
  saveMeeting,
  deleteMeeting,
  createNewMeetingTemplate,
  duplicateMeetingTemplate,
  isLocalDraftMeeting,
} from './services/meetingService';
import {
  subscribeAuthChanges,
  loginWithGoogle,
  logoutUser,
  getFirebaseStatus,
  parseFirebaseAuthError,
} from './services/firebase';
import { AlertCircle, X, ExternalLink } from 'lucide-react';
import { logger } from './utils/logger';

/**
 * 앱 최상위 엔트리포인트 컴포넌트
 */
export function App() {
  logger.debug('App component rendered');

  // 상태 관리
  const [meetings, setMeetings] = useState<Meeting[]>([]);
  const [selectedMeeting, setSelectedMeeting] = useState<Meeting | null>(null);
  const [currentUser, setCurrentUser] = useState<AppUser | null>(null);
  const [firebaseStatus, setFirebaseStatus] = useState<FirebaseConnectionStatus>(getFirebaseStatus());
  const [isFirebaseModalOpen, setIsFirebaseModalOpen] = useState<boolean>(false);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [isLoggingIn, setIsLoggingIn] = useState<boolean>(false);
  const [isDeleting, setIsDeleting] = useState<boolean>(false);
  const [authError, setAuthError] = useState<AuthErrorInfo | null>(null);
  const [actionNotice, setActionNotice] = useState<{ type: 'error' | 'success'; message: string } | null>(null);

  // 확인 대화상자 상태
  const [confirmModal, setConfirmModal] = useState<{
    isOpen: boolean;
    title: string;
    message: string;
    onConfirm: () => void;
  }>({
    isOpen: false,
    title: '',
    message: '',
    onConfirm: () => {},
  });

  // 1. Firebase 인증 상태 구독
  useEffect(() => {
    logger.info('Initializing Firebase auth listener');
    const unsubscribe = subscribeAuthChanges((user) => {
      logger.info('Auth state changed', { user: user?.email || user?.uid });
      setCurrentUser(user);
      setFirebaseStatus(getFirebaseStatus());
    });

    return () => {
      unsubscribe();
    };
  }, []);

  // 2. 현재 로그인 사용자 UID에 맞춘 회의 데이터 로드
  const loadMeetings = useCallback(async () => {
    const currentUid = currentUser?.uid || 'local_user';
    logger.info('Loading meetings for user', { currentUid });
    setIsLoading(true);
    try {
      const data = await fetchMeetings(currentUid);
      setMeetings(data);
    } catch (err: any) {
      logger.error('Failed to load meetings', err);
      setActionNotice({
        type: 'error',
        message: `회의 목록을 불러오지 못했습니다: ${err?.message || '네트워크 오류'}`,
      });
    } finally {
      setIsLoading(false);
    }
  }, [currentUser]);

  // 로그인, 로그아웃 또는 사용자 전환 시 회의 목록 재조회
  useEffect(() => {
    loadMeetings();
  }, [loadMeetings]);

  // 3. Google 로그인 핸들러 (상세 에러 파싱 및 사용자 안내)
  const handleLogin = async () => {
    logger.info('handleLogin called');
    setIsLoggingIn(true);
    setAuthError(null);
    try {
      const user = await loginWithGoogle();
      setCurrentUser(user);
      setFirebaseStatus(getFirebaseStatus());
      setActionNotice({
        type: 'success',
        message: `${user.displayName || user.email}님으로 Google 로그인이 완료되었습니다.`,
      });
    } catch (err: any) {
      logger.error('Login failed', err);
      const errorInfo = parseFirebaseAuthError(err);
      setAuthError(errorInfo);
    } finally {
      setIsLoggingIn(false);
    }
  };

  // 4. 로그아웃 핸들러
  const handleLogout = async () => {
    logger.info('handleLogout called');
    try {
      await logoutUser();
      setCurrentUser(null);
      setFirebaseStatus(getFirebaseStatus());
      setActionNotice({
        type: 'success',
        message: '성공적으로 로그아웃되었습니다. 로컬 오프라인 모드로 전환됩니다.',
      });
    } catch (err: any) {
      logger.error('Logout failed', err);
      setActionNotice({
        type: 'error',
        message: `로그아웃 중 오류가 발생했습니다: ${err?.message}`,
      });
    }
  };

  // 5. 신규 회의 작성 (ownerUid와 authorName 올바르게 전달)
  const handleNewMeeting = async () => {
    logger.info('handleNewMeeting called');
    const ownerUid = currentUser?.uid || 'local_user';
    const authorName = currentUser?.displayName || '관리자';
    const newTemplate = createNewMeetingTemplate(ownerUid, authorName);

    try {
      await saveMeeting(newTemplate, ownerUid);
      setMeetings((prev) => [newTemplate, ...prev]);
      setSelectedMeeting(newTemplate);
    } catch (err: any) {
      logger.error('Failed to create new meeting', err);
      setActionNotice({
        type: 'error',
        message: `새 회의를 생성하지 못했습니다: ${err?.message}`,
      });
    }
  };

  // 6. 기존 회의에서 양식 및 참석자만 복사해 새 회의 생성
  const handleDuplicateMeeting = async (sourceMeeting: Meeting) => {
    logger.info('handleDuplicateMeeting called', { sourceId: sourceMeeting.id });
    const ownerUid = currentUser?.uid || 'local_user';
    const authorName = currentUser?.displayName || '관리자';
    try {
      const duplicated = await duplicateMeetingTemplate(sourceMeeting, ownerUid, authorName);
      setMeetings((prev) => [duplicated, ...prev]);
      setSelectedMeeting(duplicated);
      setActionNotice({
        type: 'success',
        message: `'${sourceMeeting.title}' 회의 양식 및 참석자를 복사하여 새 회의를 생성했습니다.`,
      });
    } catch (err: any) {
      logger.error('Failed to duplicate meeting', err);
      setActionNotice({
        type: 'error',
        message: `회의 양식 복사 실패: ${err?.message}`,
      });
    }
  };

  // 7. 회의 삭제 핸들러 (로컬 초안 vs 클라우드 분리 및 안전한 확인 모달)
  const handleDeleteMeeting = (meeting: Meeting) => {
    logger.info('handleDeleteMeeting requested', { meetingId: meeting.id, title: meeting.title });
    const currentUid = currentUser?.uid || 'local_user';
    const isDraft = isLocalDraftMeeting(meeting);

    const title = isDraft ? '로컬 초안 회의록 삭제' : '클라우드 회의록 영구 삭제';
    const message = isDraft
      ? `'${meeting.title}' 초안을 로컬 저장소에서 삭제하시겠습니까?\n삭제 후에는 복원할 수 없습니다.`
      : `'${meeting.title}' 회의록을 클라우드(Firestore)에서 영구 삭제하시겠습니까?\n\n※ 작성자(소유자) 본인 계정만 삭제할 수 있습니다.\n※ 문서 삭제 후에도 첨부된 스토리지 파일(녹음/사진/서명)은 감사 및 백업 규정에 따라 별도 보관될 수 있습니다.`;

    setConfirmModal({
      isOpen: true,
      title,
      message,
      onConfirm: async () => {
        setIsDeleting(true);
        try {
          await deleteMeeting(meeting.id, currentUid);
          setMeetings((prev) => prev.filter((m) => m.id !== meeting.id));
          if (selectedMeeting?.id === meeting.id) {
            setSelectedMeeting(null);
          }
          setActionNotice({
            type: 'success',
            message: `'${meeting.title}' 회의록이 정상적으로 삭제되었습니다.`,
          });
          setConfirmModal((prev) => ({ ...prev, isOpen: false }));
        } catch (err: any) {
          logger.error('Failed to delete meeting', err);
          setActionNotice({
            type: 'error',
            message: `회의록 삭제 실패: ${err?.message || '권한이 없거나 네트워크 오류가 발생했습니다.'}`,
          });
          // 에러 발생 시 데이터 보존을 위해 모달만 닫고 회의는 유지
          setConfirmModal((prev) => ({ ...prev, isOpen: false }));
        } finally {
          setIsDeleting(false);
        }
      },
    });
  };

  // 8. 회의 상세 업데이트 및 저장
  const handleUpdateMeeting = (updated: Meeting) => {
    logger.debug('handleUpdateMeeting called', { id: updated.id });
    setSelectedMeeting(updated);
    setMeetings((prev) => prev.map((m) => (m.id === updated.id ? updated : m)));
  };

  const handleSaveMeeting = async (meetingToSave: Meeting) => {
    logger.info('handleSaveMeeting called', { id: meetingToSave.id });
    const currentUid = currentUser?.uid || 'local_user';
    try {
      await saveMeeting(meetingToSave, currentUid);
    } catch (err: any) {
      logger.error('handleSaveMeeting error', err);
      setActionNotice({
        type: 'error',
        message: `저장 실패: ${err?.message}`,
      });
      throw err;
    }
  };

  return (
    <div className="min-h-screen flex flex-col bg-slate-50 text-slate-900 selection:bg-blue-600 selection:text-white">
      {/* 상단 글로벌 네비게이션 헤더 */}
      <Header
        currentUser={currentUser}
        firebaseStatus={firebaseStatus}
        isLoggingIn={isLoggingIn}
        onOpenFirebaseModal={() => setIsFirebaseModalOpen(true)}
        onLogin={handleLogin}
        onLogout={handleLogout}
        onNewMeeting={handleNewMeeting}
        onGoHome={() => setSelectedMeeting(null)}
      />

      {/* 작업 알림 배너 (성공/실패 토스트) */}
      {actionNotice && (
        <div
          className={`px-4 py-2.5 text-xs flex items-center justify-between border-b ${
            actionNotice.type === 'error'
              ? 'bg-red-50 border-red-200 text-red-800'
              : 'bg-emerald-50 border-emerald-200 text-emerald-800'
          }`}
        >
          <div className="flex items-center space-x-2 max-w-5xl mx-auto w-full">
            <AlertCircle className="w-4 h-4 shrink-0" />
            <span>{actionNotice.message}</span>
            <button
              onClick={() => setActionNotice(null)}
              className="ml-auto text-slate-400 hover:text-slate-700 p-0.5"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
      )}

      {/* Google 로그인 오류 안내 모달 / 카드 */}
      {authError && (
        <div className="bg-amber-50 border-b border-amber-200 px-4 py-3 text-xs text-amber-900">
          <div className="max-w-5xl mx-auto flex flex-col sm:flex-row sm:items-center justify-between gap-2">
            <div className="space-y-1">
              <div className="font-bold flex items-center space-x-1.5">
                <AlertCircle className="w-4 h-4 text-amber-600" />
                <span>로그인 오류: {authError.message}</span>
              </div>
              <p className="text-amber-800">{authError.solution}</p>
            </div>
            <div className="flex items-center space-x-2 shrink-0">
              <button
                type="button"
                onClick={() => {
                  setAuthError(null);
                  setIsFirebaseModalOpen(true);
                }}
                className="px-2.5 py-1 bg-amber-200 hover:bg-amber-300 text-amber-900 font-semibold rounded transition-colors"
              >
                Firebase 설정 열기
              </button>
              <button
                type="button"
                onClick={() => setAuthError(null)}
                className="p-1 text-amber-700 hover:text-amber-900"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 메인 콘텐츠 영역 (목록 뷰 또는 상세 탭 뷰) */}
      <main className="flex-1">
        {selectedMeeting ? (
          <MeetingDetailView
            meeting={selectedMeeting}
            currentUserId={currentUser?.uid || 'local_user'}
            onBackToList={() => setSelectedMeeting(null)}
            onUpdateMeeting={handleUpdateMeeting}
            onSaveMeeting={handleSaveMeeting}
          />
        ) : (
          <MeetingListView
            meetings={meetings}
            currentUserId={currentUser?.uid || 'local_user'}
            onSelectMeeting={(m) => setSelectedMeeting(m)}
            onNewMeeting={handleNewMeeting}
            onDuplicateMeeting={handleDuplicateMeeting}
            onDeleteMeeting={handleDeleteMeeting}
          />
        )}
      </main>

      {/* 하단 푸터 */}
      <Footer />

      {/* Firebase 연결 설정 및 상태 모달 */}
      <FirebaseConfigModal
        isOpen={isFirebaseModalOpen}
        status={firebaseStatus}
        onClose={() => setIsFirebaseModalOpen(false)}
        onConfigUpdated={() => {
          setFirebaseStatus(getFirebaseStatus());
          loadMeetings();
        }}
      />

      {/* 삭제 확인 모달 */}
      <ConfirmModal
        isOpen={confirmModal.isOpen}
        title={confirmModal.title}
        message={confirmModal.message}
        confirmText="삭제하기"
        cancelText="취소"
        isDestructive={true}
        isLoading={isDeleting}
        onConfirm={confirmModal.onConfirm}
        onCancel={() => setConfirmModal((prev) => ({ ...prev, isOpen: false }))}
      />
    </div>
  );
}
export default App;
