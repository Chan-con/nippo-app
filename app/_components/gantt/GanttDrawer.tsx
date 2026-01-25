'use client';

import { useEffect, useRef, useState } from 'react';
import type { GanttTask } from './types';

export default function GanttDrawer(props: {
  open: boolean;
  task: GanttTask | null;
  onClose: () => void;
  onSave: (next: GanttTask) => void;
  onDelete: (taskId: string) => void;
  disabled?: boolean;
}) {
  const [draft, setDraft] = useState<GanttTask | null>(props.task);
  const titleRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    setDraft(props.task);
  }, [props.task]);

  useEffect(() => {
    if (!props.open) return;
    const t = window.setTimeout(() => {
      titleRef.current?.focus();
      titleRef.current?.select();
    }, 0);
    return () => window.clearTimeout(t);
  }, [props.open]);

  useEffect(() => {
    if (!props.open) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') props.onClose();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [props.open, props.onClose]);

  if (!props.open) return null;

  const task = draft;
  if (!task) return null;

  const trimmedTitle = String(task.title || '').trim();
  const canSave = trimmedTitle.length > 0 && String(task.startDate || '').length === 10 && String(task.endDate || '').length === 10;

  return (
    <div
      className={`edit-dialog ${props.open ? 'show' : ''}`}
      aria-hidden={!props.open}
      role="presentation"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) props.onClose();
      }}
    >
      <div className="edit-content" role="dialog" aria-modal="true" aria-label="ガントタスクの編集" onMouseDown={(e) => e.stopPropagation()}>
        <div className="edit-body">
          <div className="edit-field">
            <label>タイトル</label>
            <input
              ref={titleRef}
              className="edit-input"
              value={task.title}
              onChange={(e) => setDraft({ ...task, title: e.target.value })}
              disabled={props.disabled}
              placeholder="例: 仕様策定"
            />
          </div>

          <div className="edit-field">
            <label>詳細メモ</label>
            <textarea
              className="edit-input"
              value={task.memo || ''}
              onChange={(e) => setDraft({ ...task, memo: e.target.value })}
              disabled={props.disabled}
              placeholder="背景、補足、リンクなど"
              rows={8}
              style={{ resize: 'vertical', minHeight: 160, lineHeight: 1.5 }}
            />
          </div>
        </div>

        <div className="edit-footer">
          <button className="btn-cancel" type="button" title="キャンセル" aria-label="キャンセル" onClick={props.onClose} disabled={props.disabled}>
            <span className="material-icons">close</span>
          </button>
          <button
            className="btn-primary"
            type="button"
            title="保存"
            aria-label="保存"
            onClick={() => {
              if (!canSave) return;
              props.onSave({ ...task, title: trimmedTitle });
            }}
            disabled={props.disabled || !canSave}
          >
            <span className="material-icons">done</span>
          </button>
          <button
            className="btn-danger"
            type="button"
            title="削除"
            aria-label="削除"
            onClick={() => {
              const ok = window.confirm('このタスクを削除しますか？');
              if (!ok) return;
              props.onDelete(task.id);
            }}
            disabled={props.disabled}
          >
            <span className="material-icons">delete</span>
          </button>
        </div>
      </div>
    </div>
  );
}
