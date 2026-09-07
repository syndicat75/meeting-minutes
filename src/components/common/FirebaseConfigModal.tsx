/**
 * @file src/components/common/FirebaseConfigModal.tsx
 * @description Firebase 연결 상태 점검, 설정 가이드 및 웹 앱 API 키 직접 구성 모달.
 * 미연결 상태일 때 사용자에게 명확한 설정 절차를 안내합니다.
 */

import React, { useState } from 'react';
import { X, Database, ShieldAlert, CheckCircle, ExternalLink, RefreshCw, Save } from 'lucide-react';
import { FirebaseConnectionStatus } from '../../types/auth';
import { getFirebaseConfig, STORAGE_KEYS, FirebaseClientConfig } from '../../config/appConfig';
import { logger } from '../../utils/logger';

interface FirebaseConfigModalProps {
  isOpen: boolean;
  status: FirebaseConnectionStatus;
  onClose: () => void;
  onConfigUpdated: () => void;
}

/**
 * Firebase 설정 및 상태 진단 모달 컴포넌트
 */
export const FirebaseConfigModal: React.FC<FirebaseConfigModalProps> = ({
  isOpen,
  status,
  onClose,
  onConfigUpdated,
}) => {
  logger.debug('FirebaseConfigModal rendered', { isOpen, isConfigured: status.isConfigured });

  const existingConfig = getFirebaseConfig() || {
    apiKey: '',
    authDomain: '',
    projectId: '',
    storageBucket: '',
    messagingSenderId: '',
    appId: '',
    measurementId: '',
  };

  const [formConfig, setFormConfig] = useState<FirebaseClientConfig>({
    apiKey: existingConfig.apiKey || '',
    authDomain: existingConfig.authDomain || '',
    projectId: existingConfig.projectId || '',
    storageBucket: existingConfig.storageBucket || '',
    messagingSenderId: existingConfig.messagingSenderId || '',
    appId: existingConfig.appId || '',
    measurementId: existingConfig.measurementId || '',
  });

  const [activeTab, setActiveTab] = useState<'status' | 'input' | 'guide'>('status');
  const [saveMessage, setSaveMessage] = useState<string | null>(null);

  if (!isOpen) return null;

  const handleSave = () => {
    logger.info('Saving custom Firebase config to localStorage');
    try {
      localStorage.setItem(STORAGE_KEYS.FIREBASE_CONFIG_OVERRIDE, JSON.stringify(formConfig));
      setSaveMessage('Firebase 설정이 저장되었습니다. 페이지가 새로고침됩니다.');
      setTimeout(() => {
        window.location.reload();
      }, 800);
    } catch (e: any) {
      logger.error('Failed to save firebase config', e);
      setSaveMessage(`저장 실패: ${e?.message}`);
    }
  };

  const handleClear = () => {
    logger.info('Clearing custom Firebase config');
    localStorage.removeItem(STORAGE_KEYS.FIREBASE_CONFIG_OVERRIDE);
    setSaveMessage('설정이 초기화되었습니다. 새로고침합니다.');
    setTimeout(() => {
      window.location.reload();
    }, 800);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4 overflow-y-auto">
      <div className="bg-white rounded-xl shadow-2xl max-w-2xl w-full border border-slate-200 overflow-hidden my-8">
        {/* 모달 헤더 */}
        <div className="bg-slate-900 px-6 py-4 flex items-center justify-between text-white border-b border-slate-800">
          <div className="flex items-center space-x-2.5">
            <div className="p-2 bg-blue-600 rounded-lg">
              <Database className="w-5 h-5 text-white" />
            </div>
            <div>
              <h3 className="text-base font-bold">Firebase 연결 설정 및 진단</h3>
              <p className="text-xs text-slate-400">인증(Auth), 데이터베이스(Firestore), 파일 저장소(Storage)</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="text-slate-400 hover:text-white p-1 rounded-md transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* 탭 네비게이션 */}
        <div className="flex border-b border-slate-200 bg-slate-50 px-6 pt-2">
          <button
            onClick={() => setActiveTab('status')}
            className={`pb-2 px-3 text-xs font-semibold border-b-2 transition-colors ${
              activeTab === 'status'
                ? 'border-blue-600 text-blue-600'
                : 'border-transparent text-slate-600 hover:text-slate-900'
            }`}
          >
            연결 상태 진단
          </button>
          <button
            onClick={() => setActiveTab('input')}
            className={`pb-2 px-3 text-xs font-semibold border-b-2 transition-colors ${
              activeTab === 'input'
                ? 'border-blue-600 text-blue-600'
                : 'border-transparent text-slate-600 hover:text-slate-900'
            }`}
          >
            직접 설정 입력
          </button>
          <button
            onClick={() => setActiveTab('guide')}
            className={`pb-2 px-3 text-xs font-semibold border-b-2 transition-colors ${
              activeTab === 'guide'
                ? 'border-blue-600 text-blue-600'
                : 'border-transparent text-slate-600 hover:text-slate-900'
            }`}
          >
            설정 절차 가이드
          </button>
        </div>

        {/* 탭 본문 */}
        <div className="p-6 space-y-4 max-h-[70vh] overflow-y-auto">
          {/* 상태 진단 탭 */}
          {activeTab === 'status' && (
            <div className="space-y-4">
              <div
                className={`p-4 rounded-lg border ${
                  status.isConfigured
                    ? 'bg-emerald-50 border-emerald-200 text-emerald-900'
                    : 'bg-amber-50 border-amber-200 text-amber-900'
                }`}
              >
                <div className="flex items-start space-x-3">
                  {status.isConfigured ? (
                    <CheckCircle className="w-5 h-5 text-emerald-600 shrink-0 mt-0.5" />
                  ) : (
                    <ShieldAlert className="w-5 h-5 text-amber-600 shrink-0 mt-0.5" />
                  )}
                  <div>
                    <h4 className="text-sm font-bold">
                      {status.isConfigured
                        ? `Firebase 클라우드 연동 활성화 (프로젝트: ${status.projectId})`
                        : 'Firebase 클라우드 미연결 (로컬 안전 모드 동작 중)'}
                    </h4>
                    <p className="text-xs mt-1 text-slate-600">
                      {status.isConfigured
                        ? '모든 회의 데이터, 녹음 파일, 사진 및 전자서명이 Firebase 클라우드 인프라에 안전하게 동기화됩니다.'
                        : '클라우드 프로젝트 정보가 아직 등록되지 않았습니다. 현재는 브라우저 로컬 저장소(IndexedDB/localStorage) 기반으로 모든 기능을 정상 시연 및 테스트할 수 있습니다.'}
                    </p>
                  </div>
                </div>
              </div>

              {/* 세부 서비스 점검 카드 */}
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div className="p-3 border border-slate-200 rounded-lg bg-slate-50">
                  <span className="text-xs font-bold text-slate-700 block">Firebase Auth</span>
                  <span className="text-xs text-slate-500">Google 로그인</span>
                  <div className="mt-2 text-xs font-semibold">
                    {status.authConnected ? (
                      <span className="text-emerald-600">● 연결 완료</span>
                    ) : (
                      <span className="text-amber-600">○ 로컬 사용자</span>
                    )}
                  </div>
                </div>

                <div className="p-3 border border-slate-200 rounded-lg bg-slate-50">
                  <span className="text-xs font-bold text-slate-700 block">Cloud Firestore</span>
                  <span className="text-xs text-slate-500">회의/참석자/서명/버전</span>
                  <div className="mt-2 text-xs font-semibold">
                    {status.firestoreConnected ? (
                      <span className="text-emerald-600">● 클라우드 동기화</span>
                    ) : (
                      <span className="text-amber-600">○ 로컬 스토리지</span>
                    )}
                  </div>
                </div>

                <div className="p-3 border border-slate-200 rounded-lg bg-slate-50">
                  <span className="text-xs font-bold text-slate-700 block">Firebase Storage</span>
                  <span className="text-xs text-slate-500">녹음/사진/서명 PNG</span>
                  <div className="mt-2 text-xs font-semibold">
                    {status.storageConnected ? (
                      <span className="text-emerald-600">● 원격 버킷 저장</span>
                    ) : (
                      <span className="text-amber-600">○ IndexedDB 임시보관</span>
                    )}
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* 직접 입력 탭 */}
          {activeTab === 'input' && (
            <div className="space-y-3">
              <p className="text-xs text-slate-600">
                Firebase 콘솔의 [프로젝트 설정] &gt; [내 앱] &gt; [웹 앱]에서 복사한 구성을 아래에 입력하면 즉시 연결됩니다.
              </p>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">API Key (apiKey)</label>
                  <input
                    type="text"
                    value={formConfig.apiKey}
                    onChange={(e) => setFormConfig({ ...formConfig, apiKey: e.target.value })}
                    placeholder="AIzaSy..."
                    className="w-full text-xs p-2 border border-slate-300 rounded focus:ring-1 focus:ring-blue-500"
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">Project ID (projectId)</label>
                  <input
                    type="text"
                    value={formConfig.projectId}
                    onChange={(e) => setFormConfig({ ...formConfig, projectId: e.target.value })}
                    placeholder="my-safety-project"
                    className="w-full text-xs p-2 border border-slate-300 rounded focus:ring-1 focus:ring-blue-500"
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">Auth Domain (authDomain)</label>
                  <input
                    type="text"
                    value={formConfig.authDomain}
                    onChange={(e) => setFormConfig({ ...formConfig, authDomain: e.target.value })}
                    placeholder="my-safety-project.firebaseapp.com"
                    className="w-full text-xs p-2 border border-slate-300 rounded focus:ring-1 focus:ring-blue-500"
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">Storage Bucket</label>
                  <input
                    type="text"
                    value={formConfig.storageBucket}
                    onChange={(e) => setFormConfig({ ...formConfig, storageBucket: e.target.value })}
                    placeholder="my-safety-project.firebasestorage.app"
                    className="w-full text-xs p-2 border border-slate-300 rounded focus:ring-1 focus:ring-blue-500"
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">App ID (appId)</label>
                  <input
                    type="text"
                    value={formConfig.appId}
                    onChange={(e) => setFormConfig({ ...formConfig, appId: e.target.value })}
                    placeholder="1:123456789:web:abcdef"
                    className="w-full text-xs p-2 border border-slate-300 rounded focus:ring-1 focus:ring-blue-500"
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">Messaging Sender ID</label>
                  <input
                    type="text"
                    value={formConfig.messagingSenderId}
                    onChange={(e) => setFormConfig({ ...formConfig, messagingSenderId: e.target.value })}
                    placeholder="123456789"
                    className="w-full text-xs p-2 border border-slate-300 rounded focus:ring-1 focus:ring-blue-500"
                  />
                </div>
              </div>

              {saveMessage && (
                <div className="p-2 bg-blue-50 border border-blue-200 text-blue-800 text-xs rounded">
                  {saveMessage}
                </div>
              )}

              <div className="flex items-center justify-end space-x-2 pt-3 border-t border-slate-200">
                <button
                  type="button"
                  onClick={handleClear}
                  className="px-3 py-1.5 text-xs text-slate-600 hover:text-red-600 font-medium"
                >
                  설정 초기화
                </button>
                <button
                  type="button"
                  onClick={handleSave}
                  className="flex items-center space-x-1 px-4 py-1.5 bg-blue-600 hover:bg-blue-500 text-white text-xs font-bold rounded shadow-sm"
                >
                  <Save className="w-3.5 h-3.5" />
                  <span>설정 저장 및 적용</span>
                </button>
              </div>
            </div>
          )}

          {/* 설정 절차 가이드 탭 */}
          {activeTab === 'guide' && (
            <div className="space-y-3 text-xs text-slate-700 leading-relaxed">
              <div className="p-3 bg-slate-50 border border-slate-200 rounded-lg">
                <h5 className="font-bold text-slate-900 mb-1">1단계: Firebase 프로젝트 생성</h5>
                <p>
                  <a
                    href="https://console.firebase.google.com/"
                    target="_blank"
                    rel="noreferrer"
                    className="text-blue-600 underline inline-flex items-center space-x-1"
                  >
                    <span>Firebase 콘솔</span>
                    <ExternalLink className="w-3 h-3" />
                  </a>
                  에 접속하여 새 프로젝트를 생성합니다.
                </p>
              </div>

              <div className="p-3 bg-slate-50 border border-slate-200 rounded-lg">
                <h5 className="font-bold text-slate-900 mb-1">2단계: 인증 & Firestore & Storage 활성화</h5>
                <ul className="list-disc list-inside space-y-1 text-slate-600">
                  <li><strong>Authentication:</strong> Sign-in method에서 Google 로그인을 활성화합니다.</li>
                  <li><strong>Firestore Database:</strong> 프로덕션 모드로 데이터베이스를 만듭니다. (규칙은 제공된 firestore.rules 적용)</li>
                  <li><strong>Storage:</strong> 기본 버킷을 생성합니다. (규칙은 제공된 storage.rules 적용)</li>
                </ul>
              </div>

              <div className="p-3 bg-slate-50 border border-slate-200 rounded-lg">
                <h5 className="font-bold text-slate-900 mb-1">3단계: 웹 앱 등록 및 환경 변수 등록</h5>
                <p>
                  프로젝트 설정에서 웹 앱(&lt;/&gt;)을 추가한 뒤, 발급받은 구성 키를 위의 [직접 설정 입력] 탭 또는 배포 환경변수(Vercel / .env)에 등록합니다.
                </p>
              </div>
            </div>
          )}
        </div>

        {/* 모달 푸터 */}
        <div className="bg-slate-100 px-6 py-3 border-t border-slate-200 flex justify-end">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-200 rounded transition-colors"
          >
            닫기
          </button>
        </div>
      </div>
    </div>
  );
};
