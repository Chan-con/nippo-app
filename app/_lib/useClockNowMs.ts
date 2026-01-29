'use client';

import { useEffect, useState } from 'react';

export function useClockNowMs(stepMs: number = 1000): number {
  const step = Math.max(250, Math.trunc(stepMs || 1000));
  const [nowMs, setNowMs] = useState(() => Date.now());

  useEffect(() => {
    const update = () => setNowMs(Date.now());
    update();

    const cur = Date.now();
    const delay = step - (cur % step);
    let intervalId: number | null = null;

    const timeoutId = window.setTimeout(() => {
      update();
      intervalId = window.setInterval(update, step);
    }, delay);

    return () => {
      window.clearTimeout(timeoutId);
      if (intervalId != null) window.clearInterval(intervalId);
    };
  }, [step]);

  return nowMs;
}
