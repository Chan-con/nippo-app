'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import type { GanttLane, GanttTask } from './types';
import { addDaysYmd, utcDayNumberToYmd, ymdToUtcDayNumber } from './date';

const NEW_LANE_DROP_ID = '__gantt_new_lane__';
const EMPTY_LANE_ID = '__gantt_empty__';

type DragMode = 'move' | 'resize-left' | 'resize-right';

type DragState = {
  taskId: string;
  pointerId: number;
  mode: DragMode;
  startClientX: number;
  startClientY: number;
  baseStartDay: number;
  baseEndDay: number;
  baseLaneId: string;
  didDrag: boolean;
};

function clampInt(n: number, min: number, max: number) {
  const v = Math.trunc(n);
  return Math.max(min, Math.min(max, v));
}

function assignSubRows(tasks: Array<{ id: string; start: number; end: number }>): Map<string, number> {
  const sorted = tasks.slice().sort((a, b) => (a.start !== b.start ? a.start - b.start : a.end - b.end));
  const rowEnds: number[] = [];
  const out = new Map<string, number>();

  for (const t of sorted) {
    let row = 0;
    for (; row < rowEnds.length; row += 1) {
      if (t.start > rowEnds[row]) break;
    }
    if (row === rowEnds.length) rowEnds.push(t.end);
    else rowEnds[row] = Math.max(rowEnds[row], t.end);
    out.set(t.id, row);
  }

  return out;
}

export default function GanttBoard(props: {
  lanes: GanttLane[];
  tasks: GanttTask[];
  rangeStart: string; // YYYY-MM-DD
  rangeDays: number;
  dayWidth: number;
  selectedTaskId: string | null;
  onSelectTaskId: (id: string | null) => void;
  onOpenTaskId?: (id: string) => void;
  onCommitTasks: (nextTasks: GanttTask[]) => void;
  onLaneDoubleClick?: (laneId: string | null) => void;
  onInteractionChange?: (active: boolean) => void;
  disabled?: boolean;
}) {
  const laneOrder = useMemo(() => {
    return (Array.isArray(props.lanes) ? props.lanes : []).slice().sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
  }, [props.lanes]);

  const [draftTasks, setDraftTasks] = useState<GanttTask[]>(Array.isArray(props.tasks) ? props.tasks : []);
  const [isDragging, setIsDragging] = useState(false);
  const draggingRef = useRef<DragState | null>(null);
  const rootRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (draggingRef.current) return;
    setDraftTasks(Array.isArray(props.tasks) ? props.tasks : []);
  }, [props.tasks]);

  const rangeStartDay = ymdToUtcDayNumber(props.rangeStart) ?? ymdToUtcDayNumber(utcDayNumberToYmd(Math.floor(Date.now() / 86400000))) ?? 0;
  const rangeEndDay = rangeStartDay + Math.max(1, Math.trunc(props.rangeDays || 1)) - 1;

  const visibleDays = useMemo(() => {
    const days: string[] = [];
    const n = Math.max(1, Math.trunc(props.rangeDays || 1));
    for (let i = 0; i < n; i += 1) days.push(addDaysYmd(props.rangeStart, i));
    return days;
  }, [props.rangeStart, props.rangeDays]);

  const tasksByLane = useMemo(() => {
    const map = new Map<string, GanttTask[]>();
    const baseLanes = laneOrder.length ? laneOrder : [{ id: EMPTY_LANE_ID, order: 0, name: '' }];
    for (const lane of baseLanes) map.set(lane.id, []);
    if (isDragging) map.set(NEW_LANE_DROP_ID, []);
    for (const t of Array.isArray(draftTasks) ? draftTasks : []) {
      if (!t?.id) continue;
      const laneId = String(t.laneId || '');
      if (!map.has(laneId)) map.set(laneId, []);
      map.get(laneId)!.push(t);
    }
    return map;
  }, [draftTasks, laneOrder, isDragging]);

  const stackedMetaByLane = useMemo(() => {
    const out = new Map<string, { rowByTaskId: Map<string, number>; rowCount: number; clipped: Array<{ id: string; start: number; end: number }> }>();

    for (const [laneId, list] of tasksByLane.entries()) {
      const clipped: Array<{ id: string; start: number; end: number }> = [];
      for (const t of list) {
        const s = ymdToUtcDayNumber(t.startDate);
        const e = ymdToUtcDayNumber(t.endDate);
        if (s == null || e == null) continue;
        const start = clampInt(s, rangeStartDay, rangeEndDay);
        const end = clampInt(e, rangeStartDay, rangeEndDay);
        if (end < rangeStartDay || start > rangeEndDay) continue;
        clipped.push({ id: t.id, start, end: Math.max(start, end) });
      }
      const rowByTaskId = assignSubRows(clipped);
      const rowCount = Math.max(1, ...Array.from(rowByTaskId.values()).map((v) => v + 1), 1);
      out.set(laneId, { rowByTaskId, rowCount, clipped });
    }

    return out;
  }, [tasksByLane, rangeStartDay, rangeEndDay]);

  function findLaneIdFromPoint(clientX: number, clientY: number): string | null {
    try {
      const el = document.elementFromPoint(clientX, clientY) as HTMLElement | null;
      if (!el) return null;
      const row = el.closest?.('[data-gantt-lane-id]') as HTMLElement | null;
      const id = row?.dataset?.ganttLaneId;
      return id ? String(id) : null;
    } catch {
      return null;
    }
  }

  function applyDragPreview(next: { taskId: string; startDay: number; endDay: number; laneId: string }) {
    setDraftTasks((prev) => {
      const list = Array.isArray(prev) ? prev : [];
      const idx = list.findIndex((t) => t.id === next.taskId);
      if (idx < 0) return list;
      const current = list[idx];
      const startDate = utcDayNumberToYmd(next.startDay);
      const endDate = utcDayNumberToYmd(next.endDay);
      const updated: GanttTask = {
        ...current,
        laneId: next.laneId,
        startDate,
        endDate,
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

    const laneId = String(task.laneId || '');
    if (!laneId) return;

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
      baseLaneId: laneId,
      didDrag: false,
    };

    setIsDragging(true);

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

    const laneFromPoint = findLaneIdFromPoint(ev.clientX, ev.clientY);
    const nextLaneId = laneFromPoint || st.baseLaneId;

    const duration = Math.max(0, st.baseEndDay - st.baseStartDay);

    let nextStart = st.baseStartDay;
    let nextEnd = st.baseEndDay;

    if (st.mode === 'move') {
      nextStart = st.baseStartDay + deltaDays;
      nextEnd = st.baseEndDay + deltaDays;
    } else if (st.mode === 'resize-left') {
      nextStart = Math.min(st.baseEndDay, st.baseStartDay + deltaDays);
      nextEnd = st.baseEndDay;
      if (nextEnd < nextStart) nextEnd = nextStart;
    } else {
      nextStart = st.baseStartDay;
      nextEnd = Math.max(st.baseStartDay, st.baseEndDay + deltaDays);
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

    applyDragPreview({ taskId: st.taskId, startDay: nextStart, endDay: nextEnd, laneId: nextLaneId });
  }

  function onRootPointerUp(ev: React.PointerEvent) {
    const st = draggingRef.current;
    if (!st) return;
    if (st.pointerId !== ev.pointerId) return;

    draggingRef.current = null;
    setIsDragging(false);

    try {
      props.onInteractionChange?.(false);
    } catch {
      // ignore
    }

    // Commit
    props.onCommitTasks(draftTasks);

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
    setIsDragging(false);
    try {
      props.onInteractionChange?.(false);
    } catch {
      // ignore
    }
    setDraftTasks(Array.isArray(props.tasks) ? props.tasks : []);
  }

  const timelineWidth = Math.max(1, Math.trunc(props.rangeDays || 1)) * Math.max(6, Math.trunc(props.dayWidth || 24));

  const laneLayout = useMemo(() => {
    const baseLanes = laneOrder.length ? laneOrder : [{ id: EMPTY_LANE_ID, order: 0, name: '' }];
    const lanesToRender = isDragging ? baseLanes.concat([{ id: NEW_LANE_DROP_ID, order: 999999, name: '' }]) : baseLanes;
    return lanesToRender.map((lane) => {
      const list = tasksByLane.get(lane.id) || [];
      const meta = stackedMetaByLane.get(lane.id);

      if (lane.id === NEW_LANE_DROP_ID) {
        return { lane, list, meta, rowHeight: 0, height: 34 };
      }

      if (lane.id === EMPTY_LANE_ID) {
        return { lane, list, meta, rowHeight: 0, height: 72 };
      }

      const rowCount = meta?.rowCount ?? 1;
      const rowHeight = 28;
      const height = Math.max(56, rowCount * rowHeight + 16);
      return { lane, list, meta, rowHeight, height };
    });
  }, [laneOrder, tasksByLane, stackedMetaByLane, isDragging]);

  return (
    <div
      ref={rootRef}
      className={`gantt-root${props.disabled ? ' is-disabled' : ''}`}
      onPointerMove={onRootPointerMove}
      onPointerUp={onRootPointerUp}
      onPointerCancel={onRootPointerCancel}
    >
      <div className="gantt-frame">
        <div className="gantt-scroll-x">
          <div className="gantt-days" style={{ width: timelineWidth }}>
            {visibleDays.map((ymd) => {
              const m = String(ymd).match(/^(\d{4})-(\d{2})-(\d{2})$/);
              const label = m ? `${Number(m[2])}/${Number(m[3])}` : ymd;
              return (
                <div key={ymd} className="gantt-day" style={{ width: Math.max(6, props.dayWidth) }}>
                  {label}
                </div>
              );
            })}
          </div>

          <div className="gantt-timeline">
            {laneLayout.map(({ lane, list, meta, rowHeight, height }) => {
              const isNewLaneDrop = lane.id === NEW_LANE_DROP_ID;
              const isEmptyPlaceholder = lane.id === EMPTY_LANE_ID;

              return (
                <div
                  key={lane.id}
                  className={`gantt-timeline-row${isNewLaneDrop ? ' is-new-lane-drop' : ''}${isEmptyPlaceholder ? ' is-empty-placeholder' : ''}`}
                  data-gantt-lane-id={lane.id}
                  style={{ height, width: timelineWidth }}
                  onDoubleClick={(ev) => {
                    if (props.disabled) return;
                    if (draggingRef.current) return;
                    if (isNewLaneDrop) return;
                    ev.preventDefault();
                    ev.stopPropagation();
                    props.onLaneDoubleClick?.(isEmptyPlaceholder ? null : lane.id);
                  }}
                  title={props.disabled ? '' : 'ダブルクリックでこのレーンに追加'}
                >
                  <div className="gantt-row-grid" style={{ width: timelineWidth, backgroundSize: `${Math.max(6, props.dayWidth)}px 1px` }} />

                  {isNewLaneDrop ? <div className="gantt-new-lane-drop-text">ここにドロップで新規レーン</div> : null}
                  {isEmptyPlaceholder ? <div className="gantt-empty-placeholder-text">ダブルクリックでタスクを追加</div> : null}

                  {(Array.isArray(list) ? list : []).map((t) => {
                    const s = ymdToUtcDayNumber(t.startDate);
                    const e = ymdToUtcDayNumber(t.endDate);
                    if (s == null || e == null) return null;

                    const start = clampInt(s, rangeStartDay, rangeEndDay);
                    const end = clampInt(e, rangeStartDay, rangeEndDay);
                    if (end < rangeStartDay || start > rangeEndDay) return null;

                    const safeEnd = Math.max(start, end);
                    const x = (start - rangeStartDay) * Math.max(6, props.dayWidth);
                    const w = (safeEnd - start + 1) * Math.max(6, props.dayWidth);
                    const rowByTaskId = meta?.rowByTaskId;
                    const subRow = rowByTaskId?.get(t.id) ?? 0;
                    const y = 8 + subRow * rowHeight;

                    const isSelected = props.selectedTaskId === t.id;

                    return (
                      <div
                        key={t.id}
                        className={`gantt-task${isSelected ? ' selected' : ''}`}
                        style={{ left: x, top: y, width: w }}
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
                      </div>
                    );
                  })}
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}
