'use client';

import { useEffect, useRef, useState } from 'react';
import type { GanttLane, GanttTask } from './types';

export default function GanttDrawer(props: {
  open: boolean;
  task: GanttTask | null;
  lanes: GanttLane[];
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

  if (!props.open) return null;

  const task = draft;
  if (!task) return null;

  const trimmedTitle = String(task.title || '').trim();
  const canSave = trimmedTitle.length > 0 && String(task.startDate || '').length === 10 && String(task.endDate || '').length === 10;

  return (
    <div className="gantt-drawer-backdrop" role="presentation" onMouseDown={props.onClose}>
      <div
        className="gantt-drawer"
        role="dialog"
        aria-modal="true"
        aria-label="ガントタスクの編集"
        onMouseDown={(e) => {
          e.stopPropagation();
        }}
      >
        <div className="gantt-drawer-header">
          <div className="gantt-drawer-title">タスク編集</div>
          <button type="button" className="gantt-drawer-close" onClick={props.onClose} disabled={props.disabled}>
            <span className="material-icons" aria-hidden="true">
              close
            </span>
          </button>
        </div>

        <div className="gantt-drawer-body">
          <label className="gantt-field">
            <div className="gantt-field-label">タイトル</div>
            <input
              ref={titleRef}
              className="gantt-input"
              value={task.title}
              onChange={(e) => setDraft({ ...task, title: e.target.value })}
              disabled={props.disabled}
              placeholder="例: 仕様策定"
            />
          </label>

          <label className="gantt-field">
            <div className="gantt-field-label">詳細メモ</div>
            <textarea
              className="gantt-textarea"
              value={task.memo || ''}
              onChange={(e) => setDraft({ ...task, memo: e.target.value })}
              disabled={props.disabled}
              placeholder="背景、補足、リンクなど"
              rows={8}
            />
          </label>
        </div>

        <div className="gantt-drawer-footer">
          <button
            type="button"
            className="btn-secondary"
            onClick={() => {
              const ok = window.confirm('このタスクを削除しますか？');
              if (!ok) return;
              props.onDelete(task.id);
            }}
            disabled={props.disabled}
          >
            <span className="material-icons">delete</span>
            削除
          </button>
          <div style={{ flex: 1 }} />
          <button
            type="button"
            className="btn-primary"
            onClick={() => {
              if (!canSave) return;
              props.onSave({ ...task, title: trimmedTitle });
            }}
            disabled={props.disabled || !canSave}
          >
            <span className="material-icons">save</span>
            保存
          </button>
        </div>
      </div>
    </div>
  );
}
