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
import { AppUser, FirebaseConnectionStatus } from './types/auth';
import {
  fetchMeetings,
  saveMeeting,
  deleteMeeting,
  createNewMeetingTemplate,
  duplicateMeetingTemplate,
} from './services/meetingService';
import {
  subscribeAuthChanges,
  loginWithGoogle,
  logoutUser,
  getFirebaseStatus,
} from './services/firebase';
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
    });

    return () => {
      unsubscribe();
    };
  }, []);

  // 2. 회의 데이터 로드
  const loadMeetings = useCallback(async () => {
    logger.info('Loading meetings');
    setIsLoading(true);
    try {
      const data = await fetchMeetings();
      setMeetings(data);
    } catch (err) {
      logger.error('Failed to load meetings', err);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    loadMeetings();
  }, [loadMeetings]);

  // 3. Google 로그인 핸들러
  const handleLogin = async () => {
    logger.info('handleLogin called');
    try {
      const user = await loginWithGoogle();
      setCurrentUser(user);
      setFirebaseStatus(getFirebaseStatus());
    } catch (err: any) {
      logger.error('Login failed', err);
      // Firebase 설정이 안되어 있을 경우 설정 모달 안내
      if (!firebaseStatus.isConfigured) {
        setIsFirebaseModalOpen(true);
      }
    }
  };

  // 4. 로그아웃 핸들러
  const handleLogout = async () => {
    logger.info('handleLogout called');
    try {
      await logoutUser();
      setCurrentUser(null);
    } catch (err) {
      logger.error('Logout failed', err);
    }
  };

  // 5. 신규 회의 작성
  const handleNewMeeting = async () => {
    logger.info('handleNewMeeting called');
    const authorName = currentUser?.displayName || '관리자';
    const newTemplate = createNewMeetingTemplate(currentUser?.uid || 'local_user', authorName);

    try {
      await saveMeeting(newTemplate);
      setMeetings((prev) => [newTemplate, ...prev]);
      setSelectedMeeting(newTemplate);
    } catch (err) {
      logger.error('Failed to create new meeting', err);
    }
  };

  // 6. 기존 회의에서 양식 및 참석자만 복사해 새 회의 생성
  const handleDuplicateMeeting = async (sourceMeeting: Meeting) => {
    logger.info('handleDuplicateMeeting called', { sourceId: sourceMeeting.id });
    const authorName = currentUser?.displayName || '관리자';
    try {
      const duplicated = await duplicateMeetingTemplate(
        sourceMeeting,
        currentUser?.uid || 'local_user',
        authorName
      );

      await saveMeeting(duplicated);
      setMeetings((prev) => [duplicated, ...prev]);
      setSelectedMeeting(duplicated);
    } catch (err) {
      logger.error('Failed to duplicate meeting', err);
    }
  };

  // 7. 회의 삭제 핸들러 (확인 모달 거침)
  const handleDeleteMeeting = (meeting: Meeting) => {
    logger.info('handleDeleteMeeting requested', { meetingId: meeting.id, title: meeting.title });
    setConfirmModal({
      isOpen: true,
      title: '회의록 영구 삭제',
      message: `'${meeting.title}' 회의록을 정말로 삭제하시겠습니까?\n삭제된 회의록과 관련된 서명, 사진 및 음성 기록은 복구할 수 없습니다.`,
      onConfirm: async () => {
        try {
          await deleteMeeting(meeting.id);
          setMeetings((prev) => prev.filter((m) => m.id !== meeting.id));
          if (selectedMeeting?.id === meeting.id) {
            setSelectedMeeting(null);
          }
        } catch (err) {
          logger.error('Failed to delete meeting', err);
        } finally {
          setConfirmModal((prev) => ({ ...prev, isOpen: false }));
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
    await saveMeeting(meetingToSave);
  };

  return (
    <div className="min-h-screen flex flex-col bg-slate-50 text-slate-900 selection:bg-blue-600 selection:text-white">
      {/* 상단 글로벌 네비게이션 헤더 */}
      <Header
        currentUser={currentUser}
        firebaseStatus={firebaseStatus}
        onOpenFirebaseModal={() => setIsFirebaseModalOpen(true)}
        onLogin={handleLogin}
        onLogout={handleLogout}
        onNewMeeting={handleNewMeeting}
        onGoHome={() => setSelectedMeeting(null)}
      />

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
        onConfirm={confirmModal.onConfirm}
        onCancel={() => setConfirmModal((prev) => ({ ...prev, isOpen: false }))}
      />
    </div>
  );
}
export default App;
