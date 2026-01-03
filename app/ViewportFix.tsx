'use client';

import { useEffect } from 'react';

function setRootVar(name: string, value: string) {
  document.documentElement.style.setProperty(name, value);
}

export default function ViewportFix() {
  useEffect(() => {
    const vv = window.visualViewport;
    let rafId: number | null = null;

    const update = () => {
      const height = vv?.height ?? window.innerHeight;
      const offsetTop = vv?.offsetTop ?? 0;
      setRootVar('--app-height', `${Math.round(height)}px`);
      setRootVar('--app-offset-top', `${Math.round(offsetTop)}px`);
    };

    const schedule = () => {
      if (rafId != null) return;
      rafId = window.requestAnimationFrame(() => {
        rafId = null;
        update();
      });
    };

    const onFocusIn = (e: Event) => {
      const target = e.target as HTMLElement | null;
      if (!target) return;
      const tag = target.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') {
        document.body.classList.add('keyboard-scroll-lock');
      }
    };

    const onFocusOut = () => {
      document.body.classList.remove('keyboard-scroll-lock');
    };

    update();

    vv?.addEventListener('resize', schedule);
    vv?.addEventListener('scroll', schedule);
    window.addEventListener('resize', schedule);
    window.addEventListener('orientationchange', schedule);
    document.addEventListener('focusin', onFocusIn);
    document.addEventListener('focusout', onFocusOut);

    return () => {
      if (rafId != null) window.cancelAnimationFrame(rafId);
      vv?.removeEventListener('resize', schedule);
      vv?.removeEventListener('scroll', schedule);
      window.removeEventListener('resize', schedule);
      window.removeEventListener('orientationchange', schedule);
      document.removeEventListener('focusin', onFocusIn);
      document.removeEventListener('focusout', onFocusOut);
    };
  }, []);

  return null;
}
