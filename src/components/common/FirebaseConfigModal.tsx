/**
 * @file src/components/common/FirebaseConfigModal.tsx
 * @description Firebase 연결 상태 점검, 설정 가이드 및 웹 앱 API 키 직접 구성 모달.
 * 미연결 상태일 때 사용자에게 명확한 설정 절차를 안내합니다.
 */

import React, { useState } from 'react';
import { X, Database, ShieldAlert, CheckCircle, ExternalLink, RefreshCw, Save, Activity, Loader2, AlertTriangle } from 'lucide-react';
import { FirebaseConnectionStatus } from '../../types/auth';
import { getFirebaseConfigWithSource, STORAGE_KEYS, FirebaseClientConfig } from '../../config/appConfig';
import { testFirestoreConnection } from '../../services/firebase';
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

  const { config: existingConfigData, source: configSource } = getFirebaseConfigWithSource();
  const existingConfig = existingConfigData || {
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
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isTesting, setIsTesting] = useState<boolean>(false);
  const [testResult, setTestResult] = useState<{ success: boolean; message: string } | null>(null);

  if (!isOpen) return null;

  // 실제 Firestore 서버 연결 테스트
  const handleTestConnection = async () => {
    logger.info('handleTestConnection called');
    setIsTesting(true);
    setTestResult(null);
    try {
      const res = await testFirestoreConnection();
      setTestResult(res);
      onConfigUpdated();
    } catch (err: any) {
      setTestResult({ success: false, message: `테스트 실패: ${err?.message || '네트워크 오류'}` });
    } finally {
      setIsTesting(false);
    }
  };

  // 공백 제거 및 필수 항목 검증 후 저장
  const handleSave = () => {
    logger.info('Saving custom Firebase config to localStorage');
    setErrorMessage(null);
    setSaveMessage(null);

    const trimmedConfig: FirebaseClientConfig = {
      apiKey: formConfig.apiKey.trim(),
      authDomain: formConfig.authDomain.trim(),
      projectId: formConfig.projectId.trim(),
      storageBucket: formConfig.storageBucket.trim(),
      messagingSenderId: formConfig.messagingSenderId?.trim() || '',
      appId: formConfig.appId?.trim() || '',
      measurementId: formConfig.measurementId?.trim() || '',
    };

    if (!trimmedConfig.apiKey) {
      setErrorMessage('API Key(apiKey)는 필수 입력 항목입니다.');
      return;
    }
    if (!trimmedConfig.projectId) {
      setErrorMessage('Project ID(projectId)는 필수 입력 항목입니다.');
      return;
    }
    if (trimmedConfig.apiKey.includes(' ') || trimmedConfig.projectId.includes(' ')) {
      setErrorMessage('API Key 또는 Project ID에 공백이 포함될 수 없습니다.');
      return;
    }

    try {
      localStorage.setItem(STORAGE_KEYS.FIREBASE_CONFIG_OVERRIDE, JSON.stringify(trimmedConfig));
      setSaveMessage('Firebase 설정이 저장되었습니다. 설정을 적용하기 위해 페이지가 새로고침됩니다.');
      setTimeout(() => {
        window.location.reload();
      }, 900);
    } catch (e: any) {
      logger.error('Failed to save firebase config', e);
      setErrorMessage(`저장 실패: ${e?.message}`);
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
              {/* 설정 출처(Source) 진단 배너 */}
              {configSource === 'localStorage' && (
                <div className="p-3.5 bg-amber-50 border border-amber-300 rounded-lg flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-xs text-amber-900">
                  <div className="space-y-1">
                    <div className="font-bold flex items-center space-x-1.5">
                      <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0" />
                      <span>설정 출처: 브라우저 로컬 저장소 (localStorage override)</span>
                    </div>
                    <p className="text-[11px] text-amber-800 leading-relaxed">
                      이전에 브라우저에 직접 입력된 Firebase 설정이 우선 적용 중입니다. 만약 Storage 버킷이나 프로젝트가 일치하지 않아 HTTP 403 오류가 발생할 경우 설정을 초기화해주세요.
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={handleClear}
                    className="shrink-0 px-3 py-1.5 bg-amber-600 hover:bg-amber-700 text-white rounded font-bold text-xs transition-colors self-start sm:self-center"
                  >
                    기본 설정으로 초기화
                  </button>
                </div>
              )}

              {/* 프로젝트 일치 여부 진단 패널 (projectId, authDomain, storageBucket) */}
              <div className="p-3.5 bg-slate-50 border border-slate-200 rounded-lg space-y-2 text-xs">
                <span className="font-bold text-slate-800 block">Firebase 프로젝트 파라미터 일치 진단</span>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 text-[11px] font-mono">
                  <div className="p-2 bg-white rounded border border-slate-200">
                    <span className="text-slate-400 block text-[10px] font-sans">Project ID</span>
                    <span className="font-semibold text-slate-800 truncate block">
                      {existingConfig.projectId || '(미설정)'}
                    </span>
                  </div>
                  <div className="p-2 bg-white rounded border border-slate-200">
                    <span className="text-slate-400 block text-[10px] font-sans">Auth Domain</span>
                    <span className="font-semibold text-slate-800 truncate block">
                      {existingConfig.authDomain || '(미설정)'}
                    </span>
                  </div>
                  <div className="p-2 bg-white rounded border border-slate-200">
                    <span className="text-slate-400 block text-[10px] font-sans">Storage Bucket</span>
                    <span className="font-semibold text-slate-800 truncate block">
                      {existingConfig.storageBucket || '(미설정)'}
                    </span>
                  </div>
                </div>
                <p className="text-[10px] text-slate-500">
                  * Auth와 Storage는 동일한 Firebase Project ID를 참조해야 403 권한 거부가 발생하지 않습니다.
                </p>
              </div>

              <div
                className={`p-4 rounded-lg border ${
                  status.isConfigured
                    ? status.firestoreVerified
                      ? 'bg-emerald-50 border-emerald-200 text-emerald-900'
                      : 'bg-blue-50 border-blue-200 text-blue-900'
                    : 'bg-amber-50 border-amber-200 text-amber-900'
                }`}
              >
                <div className="flex items-start space-x-3">
                  {status.firestoreVerified ? (
                    <CheckCircle className="w-5 h-5 text-emerald-600 shrink-0 mt-0.5" />
                  ) : status.isConfigured ? (
                    <Activity className="w-5 h-5 text-blue-600 shrink-0 mt-0.5" />
                  ) : (
                    <ShieldAlert className="w-5 h-5 text-amber-600 shrink-0 mt-0.5" />
                  )}
                  <div>
                    <h4 className="text-sm font-bold">
                      {status.isConfigured
                        ? status.firestoreVerified
                          ? `Firebase 클라우드 연동 완료 (프로젝트: ${status.projectId})`
                          : `Firebase 설정 등록됨 (서버 검증 대기중: ${status.projectId})`
                        : 'Firebase 설정 미등록 (로컬 안전 모드로 동작 중)'}
                    </h4>
                    <p className="text-xs mt-1 text-slate-600">
                      {status.isConfigured
                        ? status.firestoreVerified
                          ? '서버 통신이 성공적으로 확인되었습니다. 회의록, 첨부 이미지 및 서명이 클라우드에 안전하게 동기화됩니다.'
                          : '설정값은 등록되었으나 실제 Firestore 서버 통신이 아직 확인되지 않았습니다. 아래 [서버 접근 테스트 실행] 버튼을 눌러 상태를 진단하세요.'
                        : '클라우드 프로젝트 정보가 등록되지 않았습니다. 브라우저 로컬 저장소(IndexedDB/localStorage) 기반으로 모든 기능을 정상 시연 및 테스트할 수 있습니다.'}
                    </p>
                  </div>
                </div>
              </div>

              {/* 세부 서비스 점검 3단계 카드 */}
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div className="p-3 border border-slate-200 rounded-lg bg-slate-50">
                  <span className="text-xs font-bold text-slate-700 block">1. 구성 등록 상태</span>
                  <span className="text-xs text-slate-500">API Key / Project ID</span>
                  <div className="mt-2 text-xs font-semibold">
                    {status.isConfigured ? (
                      <span className="text-emerald-600">● 설정값 등록됨</span>
                    ) : (
                      <span className="text-amber-600">○ 미설정 (로컬)</span>
                    )}
                  </div>
                </div>

                <div className="p-3 border border-slate-200 rounded-lg bg-slate-50">
                  <span className="text-xs font-bold text-slate-700 block">2. Google 계정 인증</span>
                  <span className="text-xs text-slate-500">Firebase Auth</span>
                  <div className="mt-2 text-xs font-semibold">
                    {status.isAuthenticated ? (
                      <span className="text-emerald-600">● 로그인됨</span>
                    ) : (
                      <span className="text-slate-500">○ 미로그인 (게스트)</span>
                    )}
                  </div>
                </div>

                <div className="p-3 border border-slate-200 rounded-lg bg-slate-50">
                  <span className="text-xs font-bold text-slate-700 block">3. Firestore 서버 검증</span>
                  <span className="text-xs text-slate-500">실제 읽기/쓰기 검증</span>
                  <div className="mt-2 text-xs font-semibold">
                    {status.firestoreVerified ? (
                      <span className="text-emerald-600">● 서버 검증 완료</span>
                    ) : (
                      <span className="text-blue-600">○ 미검증</span>
                    )}
                  </div>
                </div>
              </div>

              {/* 서버 연결 테스트 버튼 및 결과 */}
              {status.isConfigured && (
                <div className="p-3.5 bg-slate-50 border border-slate-200 rounded-lg space-y-2.5">
                  <div className="flex items-center justify-between">
                    <div>
                      <span className="text-xs font-bold text-slate-800 block">Firestore 서버 통신 검증</span>
                      <span className="text-[11px] text-slate-500">네트워크 연결 및 Security Rules 권한을 즉시 테스트합니다.</span>
                    </div>
                    <button
                      type="button"
                      onClick={handleTestConnection}
                      disabled={isTesting}
                      className="inline-flex items-center space-x-1.5 px-3 py-1.5 bg-blue-600 hover:bg-blue-500 text-white rounded text-xs font-semibold disabled:opacity-50 transition-colors"
                    >
                      {isTesting ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Activity className="w-3.5 h-3.5" />}
                      <span>{isTesting ? '테스트 중...' : '서버 접근 테스트 실행'}</span>
                    </button>
                  </div>
                  {testResult && (
                    <div
                      className={`text-xs p-2.5 rounded border ${
                        testResult.success
                          ? 'bg-emerald-50 border-emerald-200 text-emerald-800'
                          : 'bg-red-50 border-red-200 text-red-800'
                      }`}
                    >
                      {testResult.message}
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

          {/* 직접 입력 탭 */}
          {activeTab === 'input' && (
            <div className="space-y-3">
              <p className="text-xs text-slate-600 leading-relaxed">
                Firebase 콘솔의 [프로젝트 설정] &gt; [내 앱] &gt; [웹 앱]에서 복사한 구성을 아래에 입력하세요.
                저장 시 자동으로 공백이 제거되며 필수 항목(apiKey, projectId)이 검증됩니다.
              </p>

              {errorMessage && (
                <div className="p-2.5 bg-red-50 border border-red-200 text-red-700 text-xs rounded font-medium">
                  {errorMessage}
                </div>
              )}
              {saveMessage && (
                <div className="p-2.5 bg-emerald-50 border border-emerald-200 text-emerald-700 text-xs rounded font-medium">
                  {saveMessage}
                </div>
              )}

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    API Key (apiKey) <span className="text-red-500">*</span>
                  </label>
                  <input
                    type="text"
                    value={formConfig.apiKey}
                    onChange={(e) => setFormConfig({ ...formConfig, apiKey: e.target.value })}
                    placeholder="AIzaSy..."
                    className="w-full text-xs p-2 border border-slate-300 rounded focus:ring-1 focus:ring-blue-500 font-mono"
                  />
                  <span className="text-[10px] text-slate-400">주의: Gemini API 키가 아닌 Firebase 웹 앱 apiKey</span>
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    Project ID (projectId) <span className="text-red-500">*</span>
                  </label>
                  <input
                    type="text"
                    value={formConfig.projectId}
                    onChange={(e) => setFormConfig({ ...formConfig, projectId: e.target.value })}
                    placeholder="my-safety-project"
                    className="w-full text-xs p-2 border border-slate-300 rounded focus:ring-1 focus:ring-blue-500 font-mono"
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">Auth Domain (authDomain)</label>
                  <input
                    type="text"
                    value={formConfig.authDomain}
                    onChange={(e) => setFormConfig({ ...formConfig, authDomain: e.target.value })}
                    placeholder="my-safety-project.firebaseapp.com"
                    className="w-full text-xs p-2 border border-slate-300 rounded focus:ring-1 focus:ring-blue-500 font-mono"
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">Storage Bucket</label>
                  <input
                    type="text"
                    value={formConfig.storageBucket}
                    onChange={(e) => setFormConfig({ ...formConfig, storageBucket: e.target.value })}
                    placeholder="my-safety-project.firebasestorage.app"
                    className="w-full text-xs p-2 border border-slate-300 rounded focus:ring-1 focus:ring-blue-500 font-mono"
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">App ID (appId)</label>
                  <input
                    type="text"
                    value={formConfig.appId}
                    onChange={(e) => setFormConfig({ ...formConfig, appId: e.target.value })}
                    placeholder="1:123456789:web:abcdef"
                    className="w-full text-xs p-2 border border-slate-300 rounded focus:ring-1 focus:ring-blue-500 font-mono"
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">Messaging Sender ID</label>
                  <input
                    type="text"
                    value={formConfig.messagingSenderId}
                    onChange={(e) => setFormConfig({ ...formConfig, messagingSenderId: e.target.value })}
                    placeholder="123456789"
                    className="w-full text-xs p-2 border border-slate-300 rounded focus:ring-1 focus:ring-blue-500 font-mono"
                  />
                </div>
              </div>

              <div className="flex items-center justify-end space-x-2 pt-3 border-t border-slate-200">
                <button
                  type="button"
                  onClick={handleClear}
                  className="px-3 py-1.5 text-xs text-slate-600 hover:text-red-600 font-medium transition-colors"
                >
                  설정 초기화
                </button>
                <button
                  type="button"
                  onClick={handleSave}
                  className="flex items-center space-x-1 px-4 py-1.5 bg-blue-600 hover:bg-blue-500 text-white text-xs font-bold rounded shadow-sm transition-colors"
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
