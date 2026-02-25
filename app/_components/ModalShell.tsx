'use client';

import { useEffect, useRef, useState } from 'react';

type ModalShellProps = {
  open: boolean;
  overlayClassName: string;
  contentClassName: string;
  overlayId?: string;
  overlayRole?: React.AriaRole;
  overlayAriaHidden?: boolean;
  closeOnBackdrop?: boolean;
  preventClose?: boolean;
  shakeNonce?: number;
  onClose: () => void;
  contentProps?: React.HTMLAttributes<HTMLDivElement>;
  children?: React.ReactNode;
};

export default function ModalShell(props: ModalShellProps) {
  const closeOnBackdrop = props.closeOnBackdrop ?? true;
  const preventClose = props.preventClose ?? false;

  const [shaking, setShaking] = useState(false);
  const shakeTimerRef = useRef<number | null>(null);

  useEffect(() => {
    if (props.open) return;
    setShaking(false);
    if (shakeTimerRef.current != null) {
      try {
        window.clearTimeout(shakeTimerRef.current);
      } catch {
        // ignore
      }
      shakeTimerRef.current = null;
    }
  }, [props.open]);

  useEffect(() => {
    return () => {
      if (shakeTimerRef.current != null) {
        try {
          window.clearTimeout(shakeTimerRef.current);
        } catch {
          // ignore
        }
        shakeTimerRef.current = null;
      }
    };
  }, []);

  useEffect(() => {
    if (!props.open) return;
    if (props.shakeNonce == null) return;
    triggerShake();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.shakeNonce]);

  function triggerShake() {
    setShaking(false);
    if (shakeTimerRef.current != null) {
      try {
        window.clearTimeout(shakeTimerRef.current);
      } catch {
        // ignore
      }
      shakeTimerRef.current = null;
    }

    window.requestAnimationFrame(() => {
      setShaking(true);
      shakeTimerRef.current = window.setTimeout(() => {
        setShaking(false);
        shakeTimerRef.current = null;
      }, 260);
    });
  }

  const overlayCls = `${props.overlayClassName}${props.open ? ' show' : ''}`;

  if (!props.open) {
    return <div className={overlayCls} id={props.overlayId} aria-hidden={props.overlayAriaHidden ?? true} role={props.overlayRole} />;
  }

  return (
    <div
      className={overlayCls}
      id={props.overlayId}
      aria-hidden={props.overlayAriaHidden ?? !props.open}
      role={props.overlayRole}
      onMouseDown={(e) => {
        if (!closeOnBackdrop) return;
        if (e.target !== e.currentTarget) return;
        if (preventClose) {
          triggerShake();
          return;
        }
        props.onClose();
      }}
    >
      <div className={`modal-shake-wrap${shaking ? ' is-shaking' : ''}`}>
        <div
          className={props.contentClassName}
          onMouseDown={(e) => e.stopPropagation()}
          {...(props.contentProps || {})}
        >
          {props.children}
        </div>
      </div>
    </div>
  );
}
