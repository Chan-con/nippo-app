'use client';

import { useEffect, useRef, useState } from 'react';
import type { GanttTask } from './types';

type GanttTone = 'info' | 'danger' | 'success' | 'warning' | 'default';

function normalizeGanttTone(v: unknown): GanttTone {
  return v === 'info' || v === 'danger' || v === 'success' || v === 'warning' || v === 'default' ? v : 'default';
}

export default function GanttDrawer(props: {
  open: boolean;
  task: GanttTask | null;
  onClose: () => void;
  onSave: (next: GanttTask) => void;
  onDelete: (taskId: string) => void;
  disabled?: boolean;
}) {
  const [draft, setDraft] = useState<GanttTask | null>(props.task ? { ...props.task, color: normalizeGanttTone((props.task as any)?.color) } : props.task);
  const titleRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    setDraft(props.task ? { ...props.task, color: normalizeGanttTone((props.task as any)?.color) } : props.task);
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
  const tone = normalizeGanttTone((task as any)?.color);

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
            <label>カラー</label>
            <div className="flex flex-wrap gap-2">
              {(
                [
                  { tone: 'info', label: 'Info', cls: 'bg-blue-950/50 border-blue-700/40' },
                  { tone: 'danger', label: 'Danger', cls: 'bg-rose-950/55 border-rose-700/40' },
                  { tone: 'success', label: 'Success', cls: 'bg-emerald-950/50 border-emerald-700/40' },
                  { tone: 'warning', label: 'Warning', cls: 'bg-amber-950/55 border-amber-700/40' },
                  { tone: 'default', label: 'Default', cls: 'bg-slate-900/60 border-slate-700/50' },
                ] as Array<{ tone: GanttTone; label: string; cls: string }>
              ).map((opt) => {
                const active = tone === opt.tone;
                return (
                  <button
                    key={opt.tone}
                    type="button"
                    className={`inline-flex items-center gap-2 rounded-lg border px-3 py-2 text-sm ${opt.cls} ${
                      active ? 'ring-2 ring-[rgba(137,180,250,0.25)]' : 'hover:bg-white/5'
                    }`}
                    aria-pressed={active}
                    onClick={() => setDraft({ ...task, color: opt.tone })}
                    disabled={props.disabled}
                  >
                    <span className="inline-block h-2.5 w-2.5 rounded-full bg-white/70" aria-hidden="true" />
                    <span className="text-[color:var(--text-primary)]">{opt.label}</span>
                  </button>
                );
              })}
            </div>
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
              props.onSave({ ...task, title: trimmedTitle, color: normalizeGanttTone((task as any)?.color) });
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
