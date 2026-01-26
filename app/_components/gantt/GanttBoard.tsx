'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import type { CSSProperties } from 'react';
import type { GanttTask } from './types';
import { addDaysYmd, utcDayNumberToYmd, ymdToUtcDayNumber } from './date';

type DragMode = 'move' | 'resize-left' | 'resize-right';

type DragState = {
  taskId: string;
  pointerId: number;
  mode: DragMode;
  startClientX: number;
  startClientY: number;
  baseStartDay: number;
  baseEndDay: number;
  baseY: number;
  didDrag: boolean;
  didPromoteZ: boolean;
};

type GanttTone = 'info' | 'danger' | 'success' | 'warning' | 'default';

function normalizeGanttTone(v: unknown): GanttTone {
  return v === 'info' || v === 'danger' || v === 'success' || v === 'warning' || v === 'default' ? v : 'default';
}

function clampInt(n: number, min: number, max: number) {
  const v = Math.trunc(n);
  return Math.max(min, Math.min(max, v));
}

function dayNumberLabel(ymd: string) {
  const m = String(ymd || '').match(/^\d{4}-\d{2}-(\d{2})$/);
  if (!m) return '';
  return String(Number(m[1]));
}

export default function GanttBoard(props: {
  tasks: GanttTask[];
  rangeStart: string; // YYYY-MM-DD
  rangeDays: number;
  dayWidth: number;
  selectedTaskId: string | null;
  onSelectTaskId: (id: string | null) => void;
  onOpenTaskId?: (id: string) => void;
  onCommitTasks: (nextTasks: GanttTask[]) => void;
  onCreateTaskAt?: (args: { laneId: string | null; startDate: string; endDate: string; y?: number }) => void;
  onHeaderDayContextMenu?: (ymd: string) => void;
  onInteractionChange?: (active: boolean) => void;
  disabled?: boolean;
}) {
  const initialRangeSetRef = useRef(false);
  const [viewStart, setViewStart] = useState(props.rangeStart);
  const [viewDays, setViewDays] = useState(() => Math.max(180, Math.trunc(props.rangeDays || 1)));
  const [dayWidth, setDayWidth] = useState(() => Math.max(6, Math.trunc(props.dayWidth || 24)));
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLDivElement | null>(null);
  const pendingScrollAdjustPxRef = useRef(0);
  const pendingCenterDayRef = useRef<number | null>(null);
  const [scrollLeftPx, setScrollLeftPx] = useState(0);
  const [viewportWidthPx, setViewportWidthPx] = useState(0);

  useEffect(() => {
    if (initialRangeSetRef.current) return;
    initialRangeSetRef.current = true;
    setViewStart(props.rangeStart);
    setViewDays(Math.max(180, Math.trunc(props.rangeDays || 1)));
    const t = window.setTimeout(() => {
      const el = scrollRef.current;
      if (!el) return;
      const w = Math.max(6, Math.trunc(props.dayWidth || 24));
      // rangeStart が「今日-7日」なので、初期表示はだいたい今日付近へ
      el.scrollLeft = Math.max(0, 7 * w - 180);
    }, 0);
    return () => window.clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    setDayWidth(Math.max(6, Math.trunc(props.dayWidth || 24)));
  }, [props.dayWidth]);

  function zoomAtClientX(clientX: number, deltaY: number) {
    const el = scrollRef.current;
    if (!el) return;
    const oldW = Math.max(6, Math.trunc(dayWidth || 24));
    const factor = Math.pow(1.0015, -deltaY);
    const nextW = clampInt(Math.round(oldW * factor), 6, 80);
    if (nextW === oldW) return;

    const rect = el.getBoundingClientRect();
    const offsetX = clientX - rect.left;
    const x = offsetX + el.scrollLeft;
    const ratio = nextW / oldW;

    setDayWidth(nextW);
    window.requestAnimationFrame(() => {
      // keep the day under the cursor as stable as possible
      el.scrollLeft = Math.max(0, x * ratio - offsetX);
    });
  }

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;

    const shift = pendingScrollAdjustPxRef.current;
    if (shift) {
      pendingScrollAdjustPxRef.current = 0;
      el.scrollLeft += shift;
    }

    const centerDay = pendingCenterDayRef.current;
    if (centerDay == null) return;
    pendingCenterDayRef.current = null;

    const startDay = ymdToUtcDayNumber(viewStart) ?? 0;
    const w = Math.max(6, Math.trunc(dayWidth || 24));
    const dayIndex = centerDay - startDay;
    const target = dayIndex * w + w / 2 - el.clientWidth / 2;
    el.scrollLeft = Math.max(0, target);
  }, [viewStart, viewDays, dayWidth]);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const update = () => {
      setScrollLeftPx(Math.max(0, Math.trunc(el.scrollLeft || 0)));
      setViewportWidthPx(Math.max(0, Math.trunc(el.clientWidth || 0)));
    };
    update();
    window.addEventListener('resize', update);
    return () => window.removeEventListener('resize', update);
  }, []);

  const [draftTasks, setDraftTasks] = useState<GanttTask[]>(Array.isArray(props.tasks) ? props.tasks : []);
  const draggingRef = useRef<DragState | null>(null);
  const rootRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (draggingRef.current) return;
    setDraftTasks(Array.isArray(props.tasks) ? props.tasks : []);
  }, [props.tasks]);

  const todayDay = Math.floor(Date.now() / 86400000);
  const todayYmd = utcDayNumberToYmd(todayDay);
  const rangeStartDay = ymdToUtcDayNumber(viewStart) ?? ymdToUtcDayNumber(todayYmd) ?? 0;
  const rangeEndDay = rangeStartDay + Math.max(1, Math.trunc(viewDays || 1)) - 1;
  const todayIndex = todayDay - rangeStartDay;
  const isTodayInView = todayIndex >= 0 && todayIndex < Math.max(1, Math.trunc(viewDays || 1));

  function centerToday() {
    const el = scrollRef.current;
    if (!el) return;

    const n = Math.max(1, Math.trunc(viewDays || 1));
    const half = Math.max(0, Math.floor(n / 2));
    pendingCenterDayRef.current = todayDay;

    setViewStart(addDaysYmd(todayYmd, -half));
    if (n < 180) setViewDays(180);
  }

  const visibleDays = useMemo(() => {
    const days: string[] = [];
    const n = Math.max(1, Math.trunc(viewDays || 1));
    for (let i = 0; i < n; i += 1) days.push(addDaysYmd(viewStart, i));
    return days;
  }, [viewStart, viewDays]);

  const timelineWidth = Math.max(1, Math.trunc(viewDays || 1)) * Math.max(6, Math.trunc(dayWidth || 24));

  const tasksForRender = useMemo(() => {
    const list = Array.isArray(draftTasks) ? draftTasks : [];
    return list
      .filter((t) => !!t?.id)
      .slice()
      .sort((a, b) => {
        const az = typeof (a as any)?.z === 'number' ? (a as any).z : 0;
        const bz = typeof (b as any)?.z === 'number' ? (b as any).z : 0;
        if (az !== bz) return az - bz;
        return String(a.id).localeCompare(String(b.id));
      });
  }, [draftTasks]);

  const titleMaxPxById = useMemo(() => {
    const byId = new Map<string, number>();
    const list = Array.isArray(tasksForRender) ? tasksForRender : [];
    const w = Math.max(6, Math.trunc(dayWidth || 24));
    const HANDLE_W = 6;
    const BODY_PAD_X = 6;
    const INNER_GAP = 4;

    const rowMap = new Map<number, Array<{ id: string; x: number }>>();
    for (const t of list) {
      const s = ymdToUtcDayNumber(t.startDate);
      const e = ymdToUtcDayNumber(t.endDate);
      if (s == null || e == null) continue;
      const start = clampInt(s, rangeStartDay, rangeEndDay);
      const end = clampInt(e, rangeStartDay, rangeEndDay);
      if (end < rangeStartDay || start > rangeEndDay) continue;
      const safeEnd = Math.max(start, end);
      const x = (start - rangeStartDay) * w;
      const yRaw = (t as any)?.y;
      const y = typeof yRaw === 'number' && Number.isFinite(yRaw) ? Math.trunc(yRaw) : 8;
      const row = y;

      const arr = rowMap.get(row) ?? [];
      arr.push({ id: t.id, x });
      rowMap.set(row, arr);

      // default: allow up to end of timeline, capped
      const availableToEnd = timelineWidth - x - (HANDLE_W * 2 + BODY_PAD_X * 2 + INNER_GAP);
      byId.set(t.id, Math.max(0, Math.trunc(availableToEnd)));
    }

    for (const [, arr] of rowMap.entries()) {
      arr.sort((a, b) => a.x - b.x || String(a.id).localeCompare(String(b.id)));
      for (let i = 0; i < arr.length; i += 1) {
        const cur = arr[i];
        const next = arr[i + 1];
        if (!next) continue;
        const available = next.x - cur.x - (HANDLE_W * 2 + BODY_PAD_X * 2 + INNER_GAP);
        byId.set(cur.id, Math.max(0, Math.trunc(available)));
      }
    }

    return byId;
  }, [tasksForRender, dayWidth, rangeStartDay, rangeEndDay, timelineWidth]);

  const pinnedLabelStyleById = useMemo(() => {
    const byId = new Map<string, { left: number; top: number; maxWidth: number }>();
    const list = Array.isArray(tasksForRender) ? tasksForRender : [];
    const w = Math.max(6, Math.trunc(dayWidth || 24));

    const visibleLeft = scrollLeftPx;
    const visibleRight = scrollLeftPx + Math.max(0, viewportWidthPx);

    for (const t of list) {
      const s = ymdToUtcDayNumber(t.startDate);
      const e = ymdToUtcDayNumber(t.endDate);
      if (s == null || e == null) continue;

      const start = clampInt(s, rangeStartDay, rangeEndDay);
      const end = clampInt(e, rangeStartDay, rangeEndDay);
      if (end < rangeStartDay || start > rangeEndDay) continue;

      const safeEnd = Math.max(start, end);
      const x = (start - rangeStartDay) * w;
      const barW = (safeEnd - start + 1) * w;

      const barVisible = x + barW > visibleLeft && x < visibleRight;
      const leftClipped = x < visibleLeft - 2;
      if (!barVisible || !leftClipped) continue;

      const yRaw = (t as any)?.y;
      const y = typeof yRaw === 'number' && Number.isFinite(yRaw) ? Math.trunc(yRaw) : 8;

      const pinLeft = Math.max(0, visibleLeft + 8);
      const maxW = Math.max(0, visibleRight - pinLeft - 12);
      byId.set(t.id, { left: pinLeft, top: y + 2, maxWidth: maxW });
    }

    return byId;
  }, [tasksForRender, dayWidth, rangeStartDay, rangeEndDay, scrollLeftPx, viewportWidthPx]);

  const canvasHeight = useMemo(() => {
    const list = Array.isArray(draftTasks) ? draftTasks : [];
    const maxY = Math.max(
      0,
      ...list.map((t) => {
        const y = typeof (t as any)?.y === 'number' && Number.isFinite((t as any).y) ? Math.trunc((t as any).y) : 0;
        return y;
      })
    );
    return Math.max(220, maxY + 80);
  }, [draftTasks]);

  function getXInTimelineFromClientX(clientX: number) {
    const scroller = scrollRef.current;
    if (!scroller) return null;
    const rect = scroller.getBoundingClientRect();
    return clientX - rect.left + scroller.scrollLeft;
  }

  function getYInCanvasFromClientY(clientY: number) {
    const canvas = canvasRef.current;
    if (!canvas) return null;
    const rect = canvas.getBoundingClientRect();
    return clientY - rect.top;
  }

  function snapY(y: number) {
    const snapped = Math.round((y - 8) / 28) * 28 + 8;
    return Math.max(0, snapped);
  }

  function applyDragPreview(next: { taskId: string; startDay: number; endDay: number; y: number }) {
    setDraftTasks((prev) => {
      const list = Array.isArray(prev) ? prev : [];
      const idx = list.findIndex((t) => t.id === next.taskId);
      if (idx < 0) return list;
      const current = list[idx];
      const startDate = utcDayNumberToYmd(next.startDay);
      const endDate = utcDayNumberToYmd(next.endDay);
      const updated: GanttTask = {
        ...current,
        startDate,
        endDate,
        y: Math.max(0, Math.trunc(next.y)),
      };
      const out = list.slice();
      out[idx] = updated;
      return out;
    });
  }

  function onTaskPointerDown(ev: React.PointerEvent, task: GanttTask, mode: DragMode) {
    if (props.disabled) return;
    if (!task?.id) return;

    const startDay = ymdToUtcDayNumber(task.startDate);
    const endDay = ymdToUtcDayNumber(task.endDate);
    if (startDay == null || endDay == null) return;

    const baseYRaw = (task as any)?.y;
    const baseY = typeof baseYRaw === 'number' && Number.isFinite(baseYRaw) ? Math.trunc(baseYRaw) : 8;

    const root = rootRef.current;
    if (!root) return;

    draggingRef.current = {
      taskId: task.id,
      pointerId: ev.pointerId,
      mode,
      startClientX: ev.clientX,
      startClientY: ev.clientY,
      baseStartDay: startDay,
      baseEndDay: endDay,
      baseY,
      didDrag: false,
      didPromoteZ: false,
    };

    try {
      props.onInteractionChange?.(true);
    } catch {
      // ignore
    }

    try {
      (ev.currentTarget as HTMLElement).setPointerCapture(ev.pointerId);
    } catch {
      // ignore
    }

    ev.preventDefault();
    ev.stopPropagation();
  }

  function onRootPointerMove(ev: React.PointerEvent) {
    const st = draggingRef.current;
    if (!st) return;
    if (st.pointerId !== ev.pointerId) return;

    const dx = ev.clientX - st.startClientX;
    const dy = ev.clientY - st.startClientY;
    if (!st.didDrag && (Math.abs(dx) > 3 || Math.abs(dy) > 3)) st.didDrag = true;

    const deltaDays = Math.round(dx / Math.max(6, props.dayWidth || 24));
    const deltaY = dy;

    const duration = Math.max(0, st.baseEndDay - st.baseStartDay);

    let nextStart = st.baseStartDay;
    let nextEnd = st.baseEndDay;
    let nextY = st.baseY;

    if (st.mode === 'move') {
      nextStart = st.baseStartDay + deltaDays;
      nextEnd = st.baseEndDay + deltaDays;
      nextY = st.baseY + deltaY;
    } else if (st.mode === 'resize-left') {
      nextStart = Math.min(st.baseEndDay, st.baseStartDay + deltaDays);
      nextEnd = st.baseEndDay;
      if (nextEnd < nextStart) nextEnd = nextStart;
      nextY = st.baseY;
    } else {
      nextStart = st.baseStartDay;
      nextEnd = Math.max(st.baseStartDay, st.baseEndDay + deltaDays);
      nextY = st.baseY;
    }

    // Keep at least 1 day (inclusive range) => end >= start
    if (nextEnd < nextStart) nextEnd = nextStart;

    // If user drags far, keep within a sane range (avoid huge dates by mistake)
    const softMin = rangeStartDay - 3650;
    const softMax = rangeEndDay + 3650;
    nextStart = clampInt(nextStart, softMin, softMax);
    nextEnd = clampInt(nextEnd, softMin, softMax);

    // preserve duration for move after clamping
    if (st.mode === 'move') {
      const nextDur = Math.max(0, nextEnd - nextStart);
      if (nextDur !== duration) {
        nextEnd = nextStart + duration;
      }
    }

    if (st.mode === 'move' && st.didDrag && !st.didPromoteZ) {
      st.didPromoteZ = true;
      setDraftTasks((prev) => {
        const list = Array.isArray(prev) ? prev : [];
        const idx = list.findIndex((t) => t.id === st.taskId);
        if (idx < 0) return list;
        const maxZ = Math.max(-1, ...list.map((t) => (typeof (t as any)?.z === 'number' ? (t as any).z : -1)));
        const cur = list[idx];
        const curZ = typeof (cur as any)?.z === 'number' ? (cur as any).z : 0;
        if (curZ >= maxZ) return list;
        const out = list.slice();
        out[idx] = { ...cur, z: maxZ + 1 };
        return out;
      });
    }

    applyDragPreview({ taskId: st.taskId, startDay: nextStart, endDay: nextEnd, y: snapY(nextY) });
  }

  function onRootPointerUp(ev: React.PointerEvent) {
    const st = draggingRef.current;
    if (!st) return;
    if (st.pointerId !== ev.pointerId) return;

    draggingRef.current = null;

    try {
      props.onInteractionChange?.(false);
    } catch {
      // ignore
    }

    let nextTasks = Array.isArray(draftTasks) ? draftTasks : [];

    // If user moved a task, and dropped on top of another task, bring it to front.
    if (st.didDrag && st.mode === 'move') {
      const x = getXInTimelineFromClientX(ev.clientX);
      const y = getYInCanvasFromClientY(ev.clientY);
      if (x != null && y != null) {
        const wDay = Math.max(6, Math.trunc(props.dayWidth || 24));
        const me = nextTasks.find((t) => t.id === st.taskId) as any;
        if (me) {
          const myZ = typeof me?.z === 'number' ? me.z : 0;
          const hits = nextTasks
            .filter((t) => t.id !== st.taskId)
            .map((t) => {
              const s = ymdToUtcDayNumber((t as any)?.startDate);
              const e = ymdToUtcDayNumber((t as any)?.endDate);
              if (s == null || e == null) return null;
              const start = clampInt(s, rangeStartDay, rangeEndDay);
              const end = clampInt(e, rangeStartDay, rangeEndDay);
              if (end < rangeStartDay || start > rangeEndDay) return null;
              const safeEnd = Math.max(start, end);
              const left = (start - rangeStartDay) * wDay;
              const width = (safeEnd - start + 1) * wDay;
              const top = typeof (t as any)?.y === 'number' && Number.isFinite((t as any).y) ? (t as any).y : 8;
              const height = 22;
              const inside = x >= left && x <= left + width && y >= top && y <= top + height;
              if (!inside) return null;
              const z = typeof (t as any)?.z === 'number' ? (t as any).z : 0;
              return { id: t.id, z };
            })
            .filter(Boolean) as Array<{ id: string; z: number }>;

          if (hits.length) {
            const maxZ = Math.max(...hits.map((h) => h.z));
            if (myZ <= maxZ) {
              nextTasks = nextTasks.map((t) => (t.id === st.taskId ? ({ ...(t as any), z: maxZ + 1 } as any) : t));
            }
          }
        }
      }
    }

    setDraftTasks(nextTasks);
    props.onCommitTasks(nextTasks);

    // If it was a click (no drag), just select
    if (!st.didDrag) {
      props.onSelectTaskId(st.taskId);
    }
  }

  function onRootPointerCancel(ev: React.PointerEvent) {
    const st = draggingRef.current;
    if (!st) return;
    if (st.pointerId !== ev.pointerId) return;
    draggingRef.current = null;
    try {
      props.onInteractionChange?.(false);
    } catch {
      // ignore
    }
    setDraftTasks(Array.isArray(props.tasks) ? props.tasks : []);
  }

  function onScroll() {
    const el = scrollRef.current;
    if (!el) return;
    setScrollLeftPx(Math.max(0, Math.trunc(el.scrollLeft || 0)));
    setViewportWidthPx(Math.max(0, Math.trunc(el.clientWidth || 0)));
    const w = Math.max(6, Math.trunc(dayWidth || 24));
    const threshold = 12 * w;
    const chunkDays = 60;

    if (el.scrollLeft < threshold) {
      pendingScrollAdjustPxRef.current += chunkDays * w;
      setViewStart((prev) => addDaysYmd(prev, -chunkDays));
      setViewDays((prev) => Math.max(1, Math.trunc(prev || 1)) + chunkDays);
      return;
    }

    if (el.scrollLeft + el.clientWidth > el.scrollWidth - threshold) {
      setViewDays((prev) => Math.max(1, Math.trunc(prev || 1)) + chunkDays);
    }
  }

  return (
    <div
      ref={rootRef}
      className={`gantt-root${props.disabled ? ' is-disabled' : ''}`}
      onPointerMove={onRootPointerMove}
      onPointerUp={onRootPointerUp}
      onPointerCancel={onRootPointerCancel}
    >
      <div className="gantt-frame">
        <div className="gantt-scroll-x" ref={scrollRef} onScroll={onScroll}>
          <div
            className="gantt-days"
            style={{ width: timelineWidth }}
            onWheel={(ev) => {
              if (props.disabled) return;
              if (!ev.deltaY) return;
              // Zoom date spacing by vertical wheel on the header
              ev.preventDefault();
              zoomAtClientX(ev.clientX, ev.deltaY);
            }}
          >
            {visibleDays.map((ymd) => {
              const m = String(ymd).match(/^(\d{4})-(\d{2})-(\d{2})$/);
              const label = m ? `${Number(m[2])}/${Number(m[3])}` : ymd;
              return (
                <div
                  key={ymd}
                  className={`gantt-day${ymd === todayYmd ? ' is-today' : ''}`}
                  style={{ width: Math.max(6, dayWidth) }}
                  onContextMenu={(ev) => {
                    if (props.disabled) return;
                    ev.preventDefault();
                    ev.stopPropagation();
                    props.onHeaderDayContextMenu?.(ymd);
                  }}
                >
                  {label}
                </div>
              );
            })}
          </div>

          <div
            ref={canvasRef}
            className="gantt-canvas"
            style={{ width: timelineWidth, height: canvasHeight }}
            onWheel={(ev) => {
              // Allow zoom anywhere when holding Ctrl/Alt (keeps normal vertical scroll otherwise)
              if (props.disabled) return;
              if (!ev.deltaY) return;
              if (!ev.ctrlKey && !ev.altKey && !ev.metaKey) return;
              ev.preventDefault();
              zoomAtClientX(ev.clientX, ev.deltaY);
            }}
            onMouseDown={(ev) => {
              if (props.disabled) return;
              if (draggingRef.current) return;
              if (ev.button !== 1) return;
              ev.preventDefault();
              ev.stopPropagation();
              centerToday();
            }}
            onDoubleClick={(ev) => {
              if (props.disabled) return;
              if (draggingRef.current) return;
              ev.preventDefault();
              ev.stopPropagation();

              const x = getXInTimelineFromClientX(ev.clientX);
              const y = getYInCanvasFromClientY(ev.clientY);
              if (x == null || y == null) return;

              const w = Math.max(6, dayWidth || 24);
              const dayIndex = Math.max(0, Math.floor(x / w));
              const startDate = addDaysYmd(viewStart, dayIndex);
              const endDate = addDaysYmd(startDate, 1);

              props.onCreateTaskAt?.({ laneId: 'default', startDate, endDate, y: snapY(y) });
            }}
            title={props.disabled ? '' : 'ダブルクリックでここにタスク追加'}
          >
            <div className="gantt-canvas-grid" style={{ width: timelineWidth, backgroundSize: `${Math.max(6, dayWidth)}px 1px` }} />
            {isTodayInView ? (
              <div
                className="gantt-today-column"
                style={{ left: todayIndex * Math.max(6, dayWidth), width: Math.max(6, dayWidth) }}
                aria-hidden="true"
              />
            ) : null}

            {tasksForRender.length === 0 ? <div className="gantt-empty-placeholder-text">ダブルクリックでタスクを追加</div> : null}

            {/* If a long bar's left edge is out of view, show a pinned label so the title stays readable. */}
            {tasksForRender.map((t) => {
              const style = pinnedLabelStyleById.get(t.id);
              if (!style) return null;
              return (
                <div key={`pin-${t.id}`} className="gantt-task-label" style={style} aria-hidden="true">
                  {String(t.title || '（無題）')}
                </div>
              );
            })}

            {tasksForRender.map((t) => {
              const s = ymdToUtcDayNumber(t.startDate);
              const e = ymdToUtcDayNumber(t.endDate);
              if (s == null || e == null) return null;

              const start = clampInt(s, rangeStartDay, rangeEndDay);
              const end = clampInt(e, rangeStartDay, rangeEndDay);
              if (end < rangeStartDay || start > rangeEndDay) return null;

              const safeEnd = Math.max(start, end);
              const x = (start - rangeStartDay) * Math.max(6, dayWidth);
              const w = (safeEnd - start + 1) * Math.max(6, dayWidth);
              const yRaw = (t as any)?.y;
              const y = typeof yRaw === 'number' && Number.isFinite(yRaw) ? Math.trunc(yRaw) : 8;
              const zRaw = (t as any)?.z;
              const z = typeof zRaw === 'number' && Number.isFinite(zRaw) ? Math.trunc(zRaw) : 0;

              const isSelected = props.selectedTaskId === t.id;
              const tone = normalizeGanttTone((t as any)?.color);
              const isShort = w < 120;
              const titleMaxPx = titleMaxPxById.get(t.id);
              const hasPinnedLabel = pinnedLabelStyleById.has(t.id);

              const drag = draggingRef.current;
              const isDraggingThis = !!drag && drag.taskId === t.id;
              const dragMode = isDraggingThis ? drag.mode : null;
              const showLeftBubble = isDraggingThis && (dragMode === 'move' || dragMode === 'resize-left');
              const showRightBubble = isDraggingThis && (dragMode === 'move' || dragMode === 'resize-right');
              const startDayLabel = dayNumberLabel(t.startDate);
              const endDayLabel = dayNumberLabel(t.endDate);

              const style = { left: x, top: y, width: w, zIndex: z } as CSSProperties & Record<string, unknown>;
              if (isShort && typeof titleMaxPx === 'number' && Number.isFinite(titleMaxPx)) {
                style['--gantt-title-max'] = `${Math.max(0, Math.trunc(titleMaxPx))}px`;
              }

              return (
                <div
                  key={t.id}
                  className={`gantt-task tone-${tone}${isShort ? ' is-short' : ''}${hasPinnedLabel ? ' has-pinned-label' : ''}${isDraggingThis ? ' is-dragging' : ''}${isSelected ? ' selected' : ''}`}
                  style={style}
                  role="button"
                  tabIndex={0}
                  onPointerDown={(ev) => onTaskPointerDown(ev, t, 'move')}
                  onDoubleClick={(ev) => {
                    if (draggingRef.current) return;
                    ev.preventDefault();
                    ev.stopPropagation();
                    props.onOpenTaskId?.(t.id);
                  }}
                  onKeyDown={(ev) => {
                    if (ev.key === 'Enter' || ev.key === ' ') {
                      ev.preventDefault();
                      props.onSelectTaskId(t.id);
                    }
                  }}
                  onClick={(ev) => {
                    if (draggingRef.current) {
                      ev.preventDefault();
                      ev.stopPropagation();
                      return;
                    }
                    props.onSelectTaskId(t.id);
                  }}
                >
                  <div className="gantt-task-handle left" onPointerDown={(ev) => onTaskPointerDown(ev, t, 'resize-left')} />
                  <div className="gantt-task-body">
                    <div className="gantt-task-title">{String(t.title || '（無題）')}</div>
                  </div>
                  <div className="gantt-task-handle right" onPointerDown={(ev) => onTaskPointerDown(ev, t, 'resize-right')} />

                  {showLeftBubble ? (
                    <div className="gantt-date-bubble left" aria-hidden="true">
                      {startDayLabel}
                    </div>
                  ) : null}
                  {showRightBubble ? (
                    <div className="gantt-date-bubble right" aria-hidden="true">
                      {endDayLabel}
                    </div>
                  ) : null}
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}
