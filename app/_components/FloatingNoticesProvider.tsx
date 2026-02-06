'use client';

import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import type { FloatingNoticeItem, FloatingNoticeTone } from './FloatingNotices';

export type PushFloatingNoticeArgs = {
  text: React.ReactNode;
  tone?: FloatingNoticeTone;
  icon?: string;
  ttlMs?: number;
};

type FloatingNoticesContextValue = {
  push: (args: PushFloatingNoticeArgs) => void;
  toasts: FloatingNoticeItem[];
};

const FloatingNoticesContext = createContext<FloatingNoticesContextValue | null>(null);

export function useFloatingNotices() {
  const ctx = useContext(FloatingNoticesContext);
  return ctx;
}

export default function FloatingNoticesProvider(props: { children: React.ReactNode }) {
  const toastSeqRef = useRef(0);
  const timerIdsRef = useRef<number[]>([]);
  const [toasts, setToasts] = useState<FloatingNoticeItem[]>([]);

  const push = useCallback((args: PushFloatingNoticeArgs) => {
    const id = `toast:${Date.now()}:${toastSeqRef.current++}`;
    const item: FloatingNoticeItem = { id, text: args.text, tone: args.tone || 'default', icon: args.icon };
    setToasts((prev) => [...(Array.isArray(prev) ? prev : []), item]);

    const ttlMs = Number.isFinite(args.ttlMs) ? Number(args.ttlMs) : 2600;
    const timerId = window.setTimeout(() => {
      setToasts((prev) => (Array.isArray(prev) ? prev.filter((x) => x.id !== id) : prev));
    }, Math.max(500, ttlMs));
    timerIdsRef.current.push(timerId);
  }, []);

  useEffect(() => {
    return () => {
      for (const id of timerIdsRef.current) {
        try {
          window.clearTimeout(id);
        } catch {
          // ignore
        }
      }
      timerIdsRef.current = [];
    };
  }, []);

  return (
    <FloatingNoticesContext.Provider value={{ push, toasts: Array.isArray(toasts) ? toasts : [] }}>
      {props.children}
    </FloatingNoticesContext.Provider>
  );
}
