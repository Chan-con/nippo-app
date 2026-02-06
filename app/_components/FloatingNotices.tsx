import React from 'react';

export type FloatingNoticeTone = 'default' | 'info' | 'success' | 'warning' | 'danger';

export type FloatingNoticeItem = {
  id: string;
  text: React.ReactNode;
  tone?: FloatingNoticeTone;
  icon?: string;
};

export default function FloatingNotices(props: { items: FloatingNoticeItem[] }) {
  const items = Array.isArray(props.items) ? props.items : [];
  if (!items.length) return null;

  return (
    <div className="floating-notices" aria-live="polite" aria-atomic="true">
      {items.map((it) => {
        const tone: FloatingNoticeTone = it.tone || 'default';
        return (
          <div key={it.id} className={`floating-notice-item tone-${tone}`} role="status">
            {it.icon ? (
              <span className="material-icons floating-notice-icon" aria-hidden="true">
                {it.icon}
              </span>
            ) : null}
            <div className="floating-notice-text">{it.text}</div>
          </div>
        );
      })}
    </div>
  );
}
