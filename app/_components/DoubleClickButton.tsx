'use client';

import { useEffect, useRef } from 'react';
import type { ButtonHTMLAttributes, MouseEvent } from 'react';

type DoubleClickButtonProps = Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'onClick'> & {
  onDoubleActivate: (event: MouseEvent<HTMLButtonElement>) => void;
  intervalMs?: number;
};

export default function DoubleClickButton(props: DoubleClickButtonProps) {
  const { onDoubleActivate, intervalMs = 400, ...buttonProps } = props;
  const lastClickAtRef = useRef(0);
  const resetTimerRef = useRef<number | null>(null);

  useEffect(() => {
    return () => {
      if (resetTimerRef.current != null) {
        window.clearTimeout(resetTimerRef.current);
      }
    };
  }, []);

  return (
    <button
      {...buttonProps}
      onClick={(event) => {
        if (buttonProps.disabled) return;

        const now = Date.now();
        const isSecondClick = now - lastClickAtRef.current <= intervalMs;

        if (resetTimerRef.current != null) {
          window.clearTimeout(resetTimerRef.current);
          resetTimerRef.current = null;
        }

        if (isSecondClick) {
          lastClickAtRef.current = 0;
          onDoubleActivate(event);
          return;
        }

        lastClickAtRef.current = now;
        resetTimerRef.current = window.setTimeout(() => {
          lastClickAtRef.current = 0;
          resetTimerRef.current = null;
        }, intervalMs);
      }}
    />
  );
}