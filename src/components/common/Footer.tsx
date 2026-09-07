/**
 * @file src/components/common/Footer.tsx
 * @description 하단 푸터 컴포넌트. 규정 준수 안내 및 상단 이동(Scroll to Top) 버튼 제공.
 */

import React, { useState, useEffect } from 'react';
import { ArrowUp, ShieldCheck } from 'lucide-react';
import { logger } from '../../utils/logger';

/**
 * 하단 푸터 컴포넌트
 */
export const Footer: React.FC = () => {
  const [showTopButton, setShowTopButton] = useState(false);

  useEffect(() => {
    logger.debug('Footer mounted');
    const handleScroll = () => {
      if (window.scrollY > 300) {
        setShowTopButton(true);
      } else {
        setShowTopButton(false);
      }
    };

    window.addEventListener('scroll', handleScroll, { passive: true });
    return () => window.removeEventListener('scroll', handleScroll);
  }, []);

  /**
   * 화면 최상단으로 부드럽게 스크롤
   */
  const scrollToTop = () => {
    logger.info('scrollToTop called');
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  return (
    <footer className="bg-slate-900 border-t border-slate-800 text-slate-400 text-xs py-8 mt-16 no-print">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 flex flex-col sm:flex-row items-center justify-between gap-4">
        <div className="flex items-center space-x-2">
          <ShieldCheck className="w-4 h-4 text-blue-400" />
          <span>산업안전보건법 및 위험성평가 지침 준수 표준 전자회의록 관리 시스템</span>
        </div>
        <div className="text-slate-500">
          본 시스템의 서명 데이터 및 회의 스냅샷은 위변조 방지 무결성 규칙에 따라 보호됩니다.
        </div>
      </div>

      {/* 상단 이동 플로팅 버튼 */}
      {showTopButton && (
        <button
          id="btn-scroll-top"
          type="button"
          onClick={scrollToTop}
          className="fixed bottom-6 right-6 p-3 bg-blue-600 hover:bg-blue-500 text-white rounded-full shadow-lg transition-transform hover:scale-110 focus:outline-none z-30"
          title="페이지 최상단으로 이동"
        >
          <ArrowUp className="w-5 h-5" />
        </button>
      )}
    </footer>
  );
};
