'use client';

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { MouseEvent as ReactMouseEvent } from 'react';
import { createPortal } from 'react-dom';
import { isHoliday } from '@holiday-jp/holiday_jp';

type CalendarEvent = {
  id: string;
  title: string;
  date: string; // YYYY-MM-DD
  allDay: boolean;
  startTime: string; // HH:MM
  order: number;
  memo: string;
};

function pad2(n: number) {
  return String(n).padStart(2, '0');
}

function ymdFromYMDParts(year: number, month0: number, day: number) {
  return `${year}-${pad2(month0 + 1)}-${pad2(day)}`;
}

function parseYmd(ymd: string) {
  const m = String(ymd || '').match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return null;
  const year = Number(m[1]);
  const month0 = Number(m[2]) - 1;
  const day = Number(m[3]);
  if (!Number.isFinite(year) || !Number.isFinite(month0) || !Number.isFinite(day)) return null;
  return { year, month0, day };
}

function addMonthsYmd(baseYmd: string, deltaMonths: number) {
  const p = parseYmd(baseYmd);
  if (!p) return baseYmd;
  const baseM = p.year * 12 + p.month0;
  const nextM = baseM + Math.trunc(deltaMonths || 0);
  const year = Math.floor(nextM / 12);
  const month0 = ((nextM % 12) + 12) % 12;
  return ymdFromYMDParts(year, month0, 1);
}

function weekday0FromYmd(ymd: string) {
  const p = parseYmd(ymd);
  if (!p) return 0;
  // local-time based; this app is JP-first, so this matches typical holiday calendars.
  return new Date(p.year, p.month0, p.day).getDay(); // 0=Sun..6=Sat
}

function startOfCalendarGrid(monthFirstYmd: string) {
  const p = parseYmd(monthFirstYmd);
  if (!p) return monthFirstYmd;
  const firstWeekday0 = new Date(p.year, p.month0, 1).getDay(); // 0=Sun..6=Sat
  // 月曜始まりにしたいので、月曜を 0 とするオフセットに変換
  // Mon(1)->0, Tue(2)->1, ... Sun(0)->6
  const mondayBased = (firstWeekday0 + 6) % 7;
  const startDay = 1 - mondayBased;
  const start = new Date(p.year, p.month0, startDay);
  return ymdFromYMDParts(start.getFullYear(), start.getMonth(), start.getDate());
}

function addDaysLocalYmd(baseYmd: string, deltaDays: number) {
  const p = parseYmd(baseYmd);
  if (!p) return baseYmd;
  const dt = new Date(p.year, p.month0, p.day + Math.trunc(deltaDays || 0));
  return ymdFromYMDParts(dt.getFullYear(), dt.getMonth(), dt.getDate());
}

function monthTitleJa(monthFirstYmd: string) {
  const p = parseYmd(monthFirstYmd);
  if (!p) return '';
  return `${p.year}年${p.month0 + 1}月`;
}

function parseHHMMToMinutes(v: string) {
  const m = String(v || '').match(/^([01]?\d|2[0-3]):([0-5]\d)$/);
  if (!m) return null;
  const hh = parseInt(m[1], 10);
  const mm = parseInt(m[2], 10);
  return hh * 60 + mm;
}

function safeRandomId(prefix = 'id') {
  const anyCrypto: any = (globalThis as any).crypto;
  if (typeof anyCrypto?.randomUUID === 'function') {
    return `${prefix}-${anyCrypto.randomUUID()}`;
  }
  return `${prefix}-${Math.random().toString(16).slice(2)}${Date.now().toString(16)}`;
}

function clampTitle(titleRaw: string) {
  const t = String(titleRaw || '').trim();
  return (t ? t : '（無題）').slice(0, 200);
}

function normalizeEvents(input: CalendarEvent[]) {
  const list = Array.isArray(input) ? input : [];
  const isYmd = (s: string) => /^\d{4}-\d{2}-\d{2}$/.test(String(s || ''));
  const isHHMM = (s: string) => /^([01]?\d|2[0-3]):[0-5]\d$/.test(String(s || ''));
  const out: CalendarEvent[] = [];
  for (let i = 0; i < list.length; i += 1) {
    const e = list[i] as any;
    const id = typeof e?.id === 'string' ? String(e.id) : '';
    const date = typeof e?.date === 'string' ? String(e.date) : '';
    const allDay = !!e?.allDay;
    const startTimeRaw = typeof e?.startTime === 'string' ? String(e.startTime) : '';
    const memo = typeof e?.memo === 'string' ? String(e.memo) : '';
    const orderRaw = e?.order;
    if (!id) continue;
    if (!isYmd(date)) continue;
    const startTime = allDay ? '' : (isHHMM(startTimeRaw) ? startTimeRaw : '');
    const order = typeof orderRaw === 'number' && Number.isFinite(orderRaw) ? Math.trunc(orderRaw) : i;
    out.push({
      id: id.slice(0, 80),
      title: clampTitle(String(e?.title || '')),
      date,
      allDay,
      startTime,
      order,
      memo: memo.slice(0, 8000),
    });
  }
  return out;
}

function reindexGroup(list: CalendarEvent[]) {
  return list.map((e, idx) => ({ ...e, order: idx }));
}

function sortForDayRender(list: CalendarEvent[]) {
  const items = Array.isArray(list) ? list.slice() : [];
  const allDay = items
    .filter((e) => !!e.allDay)
    .sort((a, b) => (a.order ?? 0) - (b.order ?? 0) || String(a.id).localeCompare(String(b.id)));

  const timed = items
    .filter((e) => !e.allDay)
    .slice()
    .sort((a, b) => {
      const am = parseHHMMToMinutes(a.startTime);
      const bm = parseHHMMToMinutes(b.startTime);
      if (am == null && bm == null) return 0;
      if (am == null) return 1;
      if (bm == null) return -1;
      if (am !== bm) return am - bm;
      return (a.order ?? 0) - (b.order ?? 0) || String(a.id).localeCompare(String(b.id));
    });

  return { allDay, timed };
}

export default function CalendarBoard(props: {
  todayYmd: string;
  nowMs: number;
  events: CalendarEvent[];
  holidayYmds?: Set<string> | string[];
  onCommitEvents: (next: CalendarEvent[]) => void;
  onSaveAndSync?: (next: CalendarEvent[]) => void;
  onInteractionChange?: (active: boolean, editingId: string | null) => void;
  disabled?: boolean;
  jumpToYmd?: string;
  jumpNonce?: number;
}) {
  const todayYmd = String(props.todayYmd || '').slice(0, 10);
  const initialMonth = /^\d{4}-\d{2}-\d{2}$/.test(todayYmd) ? `${todayYmd.slice(0, 7)}-01` : '1970-01-01';

  const CALENDAR_SCROLL_SESSION_KEY = 'nippoCalendarScrollV1';
  type CalendarScrollSession = {
    v: 1;
    scrollTop: number;
    windowStartMonthFirstYmd: string;
    activeMonthFirstYmd: string;
  };

  function getSafeSessionStorage(): Storage | undefined {
    try {
      return window.sessionStorage;
    } catch {
      return undefined;
    }
  }

  // 無限スクロール: 表示する月の「ウィンドウ」を固定個数だけ描画し、
  // 端に近づいたらウィンドウ自体を前後にスライドして年数無制限を実現する。
  const monthsCount = 9;
  const shiftStep = 1;
  const edgeThresholdPx = 180;
  const shiftCooldownMs = 350;
  const centerIndex = Math.floor(monthsCount / 2);

  const [windowStartMonthFirstYmd, setWindowStartMonthFirstYmd] = useState<string>(addMonthsYmd(initialMonth, -centerIndex));
  const [activeMonthFirstYmd, setActiveMonthFirstYmd] = useState<string>(initialMonth);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const monthAnchorRefs = useRef<Record<string, HTMLDivElement | null>>({});
  const shiftingRef = useRef(false);
  const lastShiftAtRef = useRef(0);
  const ignoreScrollUntilRef = useRef(0);

  const userHolidaySet = useMemo(() => {
    const raw = props.holidayYmds;
    if (!raw) return new Set<string>();
    if (raw instanceof Set) return raw;
    if (Array.isArray(raw)) return new Set(raw.map((s) => String(s || '').slice(0, 10)));
    return new Set<string>();
  }, [props.holidayYmds]);

  const windowStartMonthFirstYmdRef = useRef(windowStartMonthFirstYmd);
  useEffect(() => {
    windowStartMonthFirstYmdRef.current = windowStartMonthFirstYmd;
  }, [windowStartMonthFirstYmd]);

  const activeMonthFirstYmdRef = useRef(activeMonthFirstYmd);
  useEffect(() => {
    activeMonthFirstYmdRef.current = activeMonthFirstYmd;
  }, [activeMonthFirstYmd]);

  const hasRestoredScrollRef = useRef(false);
  const hasInitializedScrollRef = useRef(false);
  const persistTimerRef = useRef<number | null>(null);
  const pendingRestoreRef = useRef<CalendarScrollSession | null>(null);
  const pendingScrollToInitialMonthRef = useRef<string | null>(null);

  function schedulePersistScrollPosition() {
    if (typeof window === 'undefined') return;
    const storage = getSafeSessionStorage();
    if (!storage) return;
    if (persistTimerRef.current != null) return;

    persistTimerRef.current = window.setTimeout(() => {
      persistTimerRef.current = null;
      const root = scrollRef.current;
      if (!root) return;
      const payload: CalendarScrollSession = {
        v: 1,
        scrollTop: Number.isFinite(root.scrollTop) ? root.scrollTop : 0,
        windowStartMonthFirstYmd: String(windowStartMonthFirstYmdRef.current || ''),
        activeMonthFirstYmd: String(activeMonthFirstYmdRef.current || ''),
      };
      try {
        storage.setItem(CALENDAR_SCROLL_SESSION_KEY, JSON.stringify(payload));
      } catch {
        // ignore
      }
    }, 120);
  }

  const months = useMemo(() => {
    const out: string[] = [];
    for (let i = 0; i < monthsCount; i += 1) out.push(addMonthsYmd(windowStartMonthFirstYmd, i));
    return out;
  }, [windowStartMonthFirstYmd]);

  const normalizedEvents = useMemo(() => normalizeEvents(props.events), [props.events]);

  const eventsByDay = useMemo(() => {
    const by = new Map<string, CalendarEvent[]>();
    for (const e of normalizedEvents) {
      const key = String(e.date || '');
      if (!by.has(key)) by.set(key, []);
      by.get(key)!.push(e);
    }
    return by;
  }, [normalizedEvents]);

  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [dragOverKey, setDragOverKey] = useState<string | null>(null);
  const [multiSelectedEventIds, setMultiSelectedEventIds] = useState<string[]>([]);
  const multiSelectedEventSet = useMemo(() => new Set(multiSelectedEventIds), [multiSelectedEventIds]);

  const [dragHoverPreview, setDragHoverPreview] = useState<null | { dateYmd: string; beforeEventId: string | null; overKey: string | null }>(null);
  const [draggingPreviewEventIds, setDraggingPreviewEventIds] = useState<string[] | null>(null);

  // PointerEvent ベースの自前ドラッグ（ドラッグ中でもホイールスクロールが効く）
  type PointerDragState = {
    eventId: string;
    selectedEventIds: string[];
    pointerId: number;
    startClientX: number;
    startClientY: number;
    didDrag: boolean;
    lastAltKey: boolean;
    drop: null | { dateYmd: string; beforeEventId: string | null; overKey: string | null };
  };

  const pointerDragRef = useRef<PointerDragState | null>(null);

  type SelectRectState = {
    pointerId: number;
    startClientX: number;
    startClientY: number;
    startX: number; // scroll content coordinate (px)
    startY: number; // scroll content coordinate (px)
    curX: number;
    curY: number;
    didDrag: boolean;
  };

  const selectingRef = useRef<SelectRectState | null>(null);
  const [selectRect, setSelectRect] = useState<null | { x: number; y: number; w: number; h: number }>(null);

  function getPointInScrollFromClient(clientX: number, clientY: number) {
    const root = scrollRef.current;
    if (!root) return null;
    const r = root.getBoundingClientRect();
    const x = clientX - r.left + root.scrollLeft;
    const y = clientY - r.top + root.scrollTop;
    if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
    return { x, y };
  }

  function makePreviewItems(
    baseEvents: CalendarEvent[],
    previewEvents: CalendarEvent[],
    beforeEventId: string | null
  ): Array<{ e: CalendarEvent; preview: boolean }> {
    const baseItems = baseEvents.map((e) => ({ e, preview: false }));
    if (!previewEvents.length) return baseItems;
    const previewItems = previewEvents.map((e) => ({ e, preview: true }));
    if (!beforeEventId) return [...baseItems, ...previewItems];
    const idx = baseEvents.findIndex((e) => e.id === beforeEventId);
    if (idx < 0) return [...baseItems, ...previewItems];
    return [...baseItems.slice(0, idx), ...previewItems, ...baseItems.slice(idx)];
  }

  function findDropTargetFromPoint(clientX: number, clientY: number) {
    if (typeof document === 'undefined') return null;
    let el = document.elementFromPoint(clientX, clientY) as HTMLElement | null;
    while (el) {
      const dateYmd = String(el.dataset?.calDropDate || '').slice(0, 10);
      const overKey = el.dataset?.calDropKey ? String(el.dataset.calDropKey) : null;
      if (/^\d{4}-\d{2}-\d{2}$/.test(dateYmd)) {
        const beforeRaw = el.dataset?.calDropBefore ? String(el.dataset.calDropBefore) : '';
        const beforeEventId = beforeRaw ? beforeRaw : null;
        return { dateYmd, beforeEventId, overKey };
      }
      el = el.parentElement;
    }
    return null;
  }

  function onEventPointerDown(ev: React.PointerEvent, e: CalendarEvent) {
    if (disabled) return;
    if (ev.button !== 0) return;

    // ドラッグ開始時にホバーツールチップが残りやすいので、先に閉じる。
    hideMemoTooltip();
    setDragHoverPreview(null);
    setDraggingPreviewEventIds(null);

    ev.stopPropagation();

    // Pointer drag starts from a chip.
    // If it's already selected, keep multi-selection; otherwise collapse to this event.
    const selectedAtStart = multiSelectedEventSet.has(e.id) ? multiSelectedEventIds : [e.id];
    if (!multiSelectedEventSet.has(e.id)) setMultiSelectedEventIds([e.id]);
    pointerDragRef.current = {
      eventId: e.id,
      selectedEventIds: selectedAtStart,
      pointerId: ev.pointerId,
      startClientX: ev.clientX,
      startClientY: ev.clientY,
      didDrag: false,
      lastAltKey: !!ev.altKey,
      drop: null,
    };

    try {
      (ev.currentTarget as HTMLElement).setPointerCapture(ev.pointerId);
    } catch {
      // ignore
    }
  }

  function cancelPointerDrag() {
    pointerDragRef.current = null;
    setDraggingId(null);
    setDragOverKey(null);
    setDragHoverPreview(null);
    setDraggingPreviewEventIds(null);
    hideMemoTooltip();
  }

  function cancelSelecting() {
    selectingRef.current = null;
    setSelectRect(null);
    hideMemoTooltip();
  }

  function onRootPointerMove(ev: React.PointerEvent) {
    const sel = selectingRef.current;
    if (sel && sel.pointerId === ev.pointerId) {
      const p = getPointInScrollFromClient(ev.clientX, ev.clientY);
      if (p) {
        sel.curX = p.x;
        sel.curY = p.y;
        const dx = ev.clientX - sel.startClientX;
        const dy = ev.clientY - sel.startClientY;
        if (!sel.didDrag && (Math.abs(dx) > 3 || Math.abs(dy) > 3)) sel.didDrag = true;
        const left = Math.min(sel.startX, sel.curX);
        const top = Math.min(sel.startY, sel.curY);
        const w = Math.abs(sel.curX - sel.startX);
        const h = Math.abs(sel.curY - sel.startY);
        setSelectRect({ x: left, y: top, w, h });
      }
      return;
    }

    const st = pointerDragRef.current;
    if (!st) return;
    if (st.pointerId !== ev.pointerId) return;

    st.lastAltKey = !!ev.altKey;
    const dx = ev.clientX - st.startClientX;
    const dy = ev.clientY - st.startClientY;
    if (!st.didDrag && (Math.abs(dx) > 3 || Math.abs(dy) > 3)) {
      st.didDrag = true;
      setDraggingId(st.eventId);
      setDraggingPreviewEventIds(Array.isArray(st.selectedEventIds) && st.selectedEventIds.length ? st.selectedEventIds : [st.eventId]);
      hideMemoTooltip();
    }
    if (!st.didDrag) return;

    const next = findDropTargetFromPoint(ev.clientX, ev.clientY);
    st.drop = next;
    setDragOverKey(next?.overKey ?? null);
    setDragHoverPreview(next);
  }

  function onRootPointerUp(ev: React.PointerEvent) {
    const sel = selectingRef.current;
    if (sel && sel.pointerId === ev.pointerId) {
      selectingRef.current = null;
      setSelectRect(null);

      if (!sel.didDrag) {
        setMultiSelectedEventIds([]);
        return;
      }

      const root = scrollRef.current;
      if (!root) {
        setMultiSelectedEventIds([]);
        return;
      }

      const left = Math.min(sel.startX, sel.curX);
      const right = Math.max(sel.startX, sel.curX);
      const top = Math.min(sel.startY, sel.curY);
      const bottom = Math.max(sel.startY, sel.curY);

      const rootRect = root.getBoundingClientRect();
      const nodes = Array.from(root.querySelectorAll('[data-cal-event-id]')) as HTMLElement[];
      const hits: string[] = [];
      for (const el of nodes) {
        const id = String(el.dataset?.calEventId || '');
        if (!id) continue;
        const r = el.getBoundingClientRect();
        const elLeft = r.left - rootRect.left + root.scrollLeft;
        const elTop = r.top - rootRect.top + root.scrollTop;
        const elRight = elLeft + r.width;
        const elBottom = elTop + r.height;
        const intersects = elLeft <= right && elRight >= left && elTop <= bottom && elBottom >= top;
        if (!intersects) continue;
        hits.push(id);
      }

      // Keep stable order
      const uniq = Array.from(new Set(hits));
      setMultiSelectedEventIds(uniq);
      hideMemoTooltip();
      return;
    }

    const st = pointerDragRef.current;
    if (!st) return;
    if (st.pointerId !== ev.pointerId) return;
    pointerDragRef.current = null;

    const didDrag = st.didDrag;
    const drop = st.drop;

    setDraggingId(null);
    setDragOverKey(null);
    setDragHoverPreview(null);
    setDraggingPreviewEventIds(null);
    hideMemoTooltip();

    if (!didDrag || !drop) return;
    try {
      (window as any).__calendarAltCopy = st.lastAltKey;
      const ids = Array.isArray(st.selectedEventIds) && st.selectedEventIds.length ? st.selectedEventIds : [st.eventId];
      const affected = moveOrCopyEventsToDate(ids, drop.dateYmd, drop.beforeEventId);
      setMultiSelectedEventIds(affected);
    } finally {
      (window as any).__calendarAltCopy = false;
    }
  }

  function onRootPointerCancel(ev: React.PointerEvent) {
    const sel = selectingRef.current;
    if (sel && sel.pointerId === ev.pointerId) {
      cancelSelecting();
      return;
    }
    const st = pointerDragRef.current;
    if (!st) return;
    if (st.pointerId !== ev.pointerId) return;
    cancelPointerDrag();
  }

  const [memoTooltip, setMemoTooltip] = useState<null | { title: string; memo: string; x: number; y: number }>(null);

  const memoTooltipElRef = useRef<HTMLDivElement | null>(null);
  const memoTooltipSizeRef = useRef<{ w: number; h: number } | null>(null);
  const memoTooltipPointRef = useRef<{ x: number; y: number } | null>(null);

  function getMemoTooltipPosFromPoint(clientX: number, clientY: number, size?: { w: number; h: number } | null) {
    const pad = 12;
    const estW = Math.max(1, Math.trunc(size?.w ?? 420));
    const estH = Math.max(1, Math.trunc(size?.h ?? 280));
    const vw = typeof window !== 'undefined' ? window.innerWidth : 0;
    const vh = typeof window !== 'undefined' ? window.innerHeight : 0;

    // Prefer slightly to the bottom-right of the cursor.
    // If it would overflow, flip to the opposite side, then clamp.
    let x = clientX + pad;
    let y = clientY + pad;

    if (vw) {
      const maxX = vw - estW - 12;
      if (x > maxX) x = clientX - pad - estW;
      x = Math.max(12, Math.min(x, vw - estW - 12));
    }

    if (vh) {
      const maxY = vh - estH - 12;
      if (y > maxY) y = clientY - pad - estH;
      y = Math.max(12, Math.min(y, vh - estH - 12));
    }

    return { x, y };
  }

  function showMemoTooltip(ev: ReactMouseEvent, e: CalendarEvent) {
    const memo = String(e.memo || '').trim();
    const title = String(e.title || '（無題）').trim() || '（無題）';
    memoTooltipPointRef.current = { x: ev.clientX, y: ev.clientY };
    const { x, y } = getMemoTooltipPosFromPoint(ev.clientX, ev.clientY, memoTooltipSizeRef.current);
    setMemoTooltip({ title, memo, x, y });
  }

  function placeMemoTooltipAtPoint(clientX: number, clientY: number) {
    memoTooltipPointRef.current = { x: clientX, y: clientY };
    const { x, y } = getMemoTooltipPosFromPoint(clientX, clientY, memoTooltipSizeRef.current);
    setMemoTooltip((prev) => (prev ? { ...prev, x, y } : prev));
  }

  function hideMemoTooltip() {
    setMemoTooltip(null);
  }

  // After the tooltip is rendered, measure its real size and re-position.
  useLayoutEffect(() => {
    if (!memoTooltip) return;
    const el = memoTooltipElRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    if (!(r.width > 0 && r.height > 0)) return;

    memoTooltipSizeRef.current = { w: r.width, h: r.height };
    const p = memoTooltipPointRef.current;
    if (!p) return;

    const next = getMemoTooltipPosFromPoint(p.x, p.y, memoTooltipSizeRef.current);
    setMemoTooltip((prev) => {
      if (!prev) return prev;
      if (prev.x === next.x && prev.y === next.y) return prev;
      return { ...prev, x: next.x, y: next.y };
    });
  }, [memoTooltip?.title, memoTooltip?.memo]);

  // modal
  const [modalOpen, setModalOpen] = useState(false);
  const [modalBaseDate, setModalBaseDate] = useState<string>('');
  const [modalEditingId, setModalEditingId] = useState<string | null>(null);
  const [modalTitle, setModalTitle] = useState('');
  const [modalStartTime, setModalStartTime] = useState('');
  const [modalMemo, setModalMemo] = useState('');
  const titleRef = useRef<HTMLInputElement | null>(null);

  const disabled = !!props.disabled;

  useEffect(() => {
    if (!props.onInteractionChange) return;
    props.onInteractionChange(modalOpen || !!draggingId || !!selectRect, modalOpen ? modalEditingId : null);
  }, [modalOpen, modalEditingId, draggingId, selectRect, props.onInteractionChange]);

  // Selecting cleanup (Escape/blur)
  useEffect(() => {
    if (!selectRect) return;
    const cleanup = () => cancelSelecting();
    window.addEventListener('blur', cleanup, true);
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') cleanup();
    };
    window.addEventListener('keydown', onKeyDown, true);
    return () => {
      window.removeEventListener('blur', cleanup, true);
      window.removeEventListener('keydown', onKeyDown, true);
    };
  }, [selectRect]);

  useEffect(() => {
    if (!modalOpen) return;
    const t = window.setTimeout(() => {
      titleRef.current?.focus();
      titleRef.current?.select();
    }, 0);
    return () => window.clearTimeout(t);
  }, [modalOpen]);

  useEffect(() => {
    if (!modalOpen) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setModalOpen(false);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [modalOpen]);

  function openNewEventModal(dateYmd: string) {
    setModalEditingId(null);
    setModalBaseDate(String(dateYmd || '').slice(0, 10));
    setModalTitle('');
    setModalStartTime('');
    setModalMemo('');
    setModalOpen(true);
  }

  function openEditEventModal(eventId: string) {
    const id = String(eventId || '');
    const found = normalizedEvents.find((e) => e.id === id) ?? null;
    if (!found) return;
    setModalEditingId(id);
    setModalBaseDate(found.date);
    setModalTitle(found.title);
    setModalStartTime(found.allDay ? '' : found.startTime || '');
    setModalMemo(found.memo || '');
    setModalOpen(true);
  }

  function nextOrderFor(date: string, allDay: boolean, startTime: string) {
    const list = eventsByDay.get(date) ?? [];
    const filtered = list.filter((e) => !!e.allDay === !!allDay && (allDay ? true : String(e.startTime || '') === String(startTime || '')));
    const max = filtered.reduce((m, e) => Math.max(m, typeof e.order === 'number' ? e.order : 0), -1);
    return max + 1;
  }

  function commit(mutator: (prev: CalendarEvent[]) => CalendarEvent[]) {
    const next = mutator(normalizedEvents);
    const normalized = normalizeEvents(next);
    props.onCommitEvents(normalized);
    return normalized;
  }

  function upsertFromModal() {
    const date = String(modalBaseDate || '').slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return;
    const title = clampTitle(modalTitle);
    const startTimeRaw = String(modalStartTime || '').trim();
    const allDay = !startTimeRaw;
    const startTime = allDay ? '' : startTimeRaw;
    if (!allDay && !/^([01]?\d|2[0-3]):[0-5]\d$/.test(startTime)) return;
    const memo = String(modalMemo || '').slice(0, 8000);

    const nextEvents = commit((prev) => {
      const list = prev.slice();
      if (!modalEditingId) {
        const id = safeRandomId('cal');
        list.push({ id, title, date, allDay, startTime, order: nextOrderFor(date, allDay, startTime), memo });
        return list;
      }
      const idx = list.findIndex((e) => e.id === modalEditingId);
      if (idx === -1) return list;
      const before = list[idx];
      const changedGroup = before.date !== date || !!before.allDay !== allDay || String(before.startTime || '') !== String(startTime || '');
      const order = changedGroup ? nextOrderFor(date, allDay, startTime) : before.order;
      list[idx] = { ...before, title, date, allDay, startTime, memo, order };
      return list;
    });

    setModalOpen(false);
    try {
      props.onSaveAndSync?.(nextEvents);
    } catch {
      // ignore
    }
  }

  function deleteFromModal() {
    const id = String(modalEditingId || '');
    if (!id) {
      setModalOpen(false);
      return;
    }
    const nextEvents = commit((prev) => prev.filter((e) => e.id !== id));
    setModalOpen(false);
    try {
      props.onSaveAndSync?.(nextEvents);
    } catch {
      // ignore
    }
  }

  useEffect(() => {
    if (!draggingId) return;

    const cleanup = () => cancelPointerDrag();
    window.addEventListener('blur', cleanup, true);
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') cleanup();
    };
    window.addEventListener('keydown', onKeyDown, true);

    return () => {
      window.removeEventListener('blur', cleanup, true);
      window.removeEventListener('keydown', onKeyDown, true);
    };
  }, [draggingId]);

  function moveOrCopyEventToDate(eventId: string, targetDate: string, beforeEventId: string | null) {
    const id = String(eventId || '');
    const date = String(targetDate || '').slice(0, 10);
    if (!id || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return;

    commit((prev) => {
      const list = prev.slice();
      const src = list.find((x) => x.id === id) ?? null;
      if (!src) return list;
      const willCopy = !!draggingId && id === draggingId; // active drag

      const isCopy = willCopy && !!(window as any).__calendarAltCopy;
      const base = isCopy ? { ...src, id: safeRandomId('cal') } : src;

      // レーン(終日/時間指定)や開始時刻は、ドラッグでは変えない
      //（日付移動・同グループ内の並び替えのみ）
      const allDay = !!base.allDay;
      const startTime = allDay ? '' : String(base.startTime || '');

      // remove original when moving
      let working = list;
      if (!isCopy) working = list.filter((x) => x.id !== id);

      const targetList = working.filter((x) => x.date === date && !!x.allDay === allDay && (allDay ? true : String(x.startTime || '') === startTime));
      const reordered = targetList.slice().sort((a, b) => (a.order ?? 0) - (b.order ?? 0) || String(a.id).localeCompare(String(b.id)));

      const insertBeforeId = beforeEventId ? String(beforeEventId) : '';
      const insertIndex = insertBeforeId ? reordered.findIndex((x) => x.id === insertBeforeId) : -1;

      const without = reordered.filter((x) => x.id !== base.id);
      const nextGroup = without.slice();
      const insertAt = insertIndex >= 0 ? insertIndex : nextGroup.length;
      nextGroup.splice(insertAt, 0, { ...base, date, allDay, startTime, order: 0 });

      const reindexed = reindexGroup(nextGroup).map((x) => ({ ...x, date, allDay, startTime }));

      // merge back: keep other events + replaced group
      const keep = working.filter((x) => !(x.date === date && !!x.allDay === allDay && (allDay ? true : String(x.startTime || '') === startTime)));
      return keep.concat(reindexed);
    });
  }

  function moveOrCopyEventsToDate(eventIds: string[], targetDate: string, beforeEventId: string | null) {
    const date = String(targetDate || '').slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return [] as string[];

    const ids = Array.from(new Set((Array.isArray(eventIds) ? eventIds : []).map((s) => String(s || '')).filter(Boolean)));
    if (!ids.length) return [] as string[];

    // Called only from active drag drop.
    const isCopy = !!(window as any).__calendarAltCopy;
    let affectedIds: string[] = [];

    commit((prev) => {
      const list = prev.slice();
      const srcById = new Map<string, CalendarEvent>();
      for (const e of list) srcById.set(e.id, e);

      const selected = ids
        .map((id, idx) => {
          const src = srcById.get(id) ?? null;
          return src ? ({ src, idx } as const) : null;
        })
        .filter(Boolean) as Array<{ src: CalendarEvent; idx: number }>;
      if (!selected.length) {
        affectedIds = [];
        return list;
      }

      // remove originals when moving
      const working = isCopy ? list : list.filter((x) => !ids.includes(x.id));

      // materialize bases (copy => new ids)
      const bases = selected.map(({ src, idx }) => {
        const base = isCopy ? { ...src, id: safeRandomId('cal') } : src;
        return { base, srcOrder: typeof src.order === 'number' ? src.order : 0, idx };
      });
      affectedIds = bases.map((b) => b.base.id);

      // group by lane (allDay/startTime)
      const groupKeyOf = (e: CalendarEvent) => `${date}::${e.allDay ? '1' : '0'}::${e.allDay ? '' : String(e.startTime || '')}`;
      const byGroup = new Map<string, Array<{ base: CalendarEvent; srcOrder: number; idx: number }>>();
      for (const b of bases) {
        const k = groupKeyOf(b.base);
        if (!byGroup.has(k)) byGroup.set(k, []);
        byGroup.get(k)!.push(b);
      }

      // stable order within selected: by src.order then selection order
      for (const [k, items] of byGroup.entries()) {
        items.sort((a, b) => a.srcOrder - b.srcOrder || a.idx - b.idx);
        byGroup.set(k, items);
      }

      let out = working;
      for (const [, items] of byGroup.entries()) {
        const any = items[0]?.base;
        if (!any) continue;
        const allDay = !!any.allDay;
        const startTime = allDay ? '' : String(any.startTime || '');

        const targetList = out.filter((x) => x.date === date && !!x.allDay === allDay && (allDay ? true : String(x.startTime || '') === startTime));
        const reordered = targetList.slice().sort((a, b) => (a.order ?? 0) - (b.order ?? 0) || String(a.id).localeCompare(String(b.id)));

        const insertBeforeId = beforeEventId ? String(beforeEventId) : '';
        const insertIndex = insertBeforeId ? reordered.findIndex((x) => x.id === insertBeforeId) : -1;
        const insertAt = insertIndex >= 0 ? insertIndex : reordered.length;

        const nextGroup = reordered.slice();
        const normalizedItems = items.map(({ base }) => ({ ...base, date, allDay, startTime, order: 0 }));
        nextGroup.splice(insertAt, 0, ...normalizedItems);

        const reindexed = reindexGroup(nextGroup).map((x) => ({ ...x, date, allDay, startTime }));
        const keep = out.filter((x) => !(x.date === date && !!x.allDay === allDay && (allDay ? true : String(x.startTime || '') === startTime)));
        out = keep.concat(reindexed);
      }

      return out;
    });

    return affectedIds;
  }

  function getScrollInsetTopPx(root: HTMLElement) {
    try {
      const cs = window.getComputedStyle(root);
      const pad = parseFloat(String(cs.paddingTop || '0'));
      const border = parseFloat(String(cs.borderTopWidth || '0'));
      const padV = Number.isFinite(pad) ? pad : 0;
      const borderV = Number.isFinite(border) ? border : 0;
      return padV + borderV;
    } catch {
      return 0;
    }
  }

  function scrollToMonthExact(monthFirstYmd: string) {
    const el = monthAnchorRefs.current[String(monthFirstYmd)] || null;
    const root = scrollRef.current;
    if (!el || !root) return false;
    if (root.clientHeight <= 0) return false;

    const rootRect = root.getBoundingClientRect();
    const elRect = el.getBoundingClientRect();
    const insetTop = getScrollInsetTopPx(root);
    const desiredTop = rootRect.top + insetTop;
    const delta = elRect.top - desiredTop;
    if (!Number.isFinite(delta)) return false;

    root.scrollTop = Math.max(0, Math.round(root.scrollTop + delta));
    return true;
  }

  function scrollToMonthAfterRender(monthFirstYmd: string) {
    const maxTries = 12;
    let tries = 0;

    const tick = () => {
      tries += 1;
      const ok = scrollToMonthExact(monthFirstYmd);
      if (ok || tries >= maxTries) {
        const now = performance.now();
        ignoreScrollUntilRef.current = now + 900;
        lastShiftAtRef.current = now;
        return;
      }
      window.requestAnimationFrame(tick);
    };

    window.requestAnimationFrame(() => {
      window.requestAnimationFrame(tick);
    });
  }

  function getAnchorMonthKey(scrollTop: number) {
    // ビュー上端に近い月をアンカーにする（ウィンドウをスライドしても見た目が飛びにくい）
    const y = scrollTop + 12;
    let bestKey: string | null = null;
    let bestTop = -Infinity;
    for (const k of months) {
      const el = monthAnchorRefs.current[k] || null;
      if (!el) continue;
      const t = el.offsetTop;
      if (t <= y && t > bestTop) {
        bestTop = t;
        bestKey = k;
      }
    }
    return bestKey ?? months[0] ?? null;
  }

  function shiftWindow(deltaMonths: number, reason: 'top' | 'bottom' | 'today') {
    const root = scrollRef.current;
    if (!root) {
      setWindowStartMonthFirstYmd((prev) => addMonthsYmd(prev, deltaMonths));
      return;
    }
    const anchorKey = getAnchorMonthKey(root.scrollTop);
    const anchorEl = anchorKey ? monthAnchorRefs.current[anchorKey] : null;
    const anchorOffset = anchorEl ? anchorEl.offsetTop - root.scrollTop : 0;

    shiftingRef.current = true;
    setWindowStartMonthFirstYmd((prev) => addMonthsYmd(prev, deltaMonths));

    window.requestAnimationFrame(() => {
      const root2 = scrollRef.current;
      const anchorEl2 = anchorKey ? monthAnchorRefs.current[anchorKey] : null;
      if (root2 && anchorEl2) {
        root2.scrollTop = Math.max(0, anchorEl2.offsetTop - anchorOffset);
      } else if (root2 && reason === 'today') {
        // today の場合は target を優先
        scrollToMonthExact(activeMonthFirstYmd);
      }
      const now = performance.now();
      ignoreScrollUntilRef.current = now + 350;
      lastShiftAtRef.current = now;
      shiftingRef.current = false;

      schedulePersistScrollPosition();
    });
  }

  function handleScroll() {
    const root = scrollRef.current;
    if (!root) return;

    const now = performance.now();
    if (now < ignoreScrollUntilRef.current) return;

    const anchorKey = getAnchorMonthKey(root.scrollTop);
    if (anchorKey && anchorKey !== activeMonthFirstYmd) setActiveMonthFirstYmd(anchorKey);

    if (shiftingRef.current) return;

    // 端で暴発しないように、一定間隔以上でしか月ウィンドウを動かさない
    if (now - lastShiftAtRef.current < shiftCooldownMs) return;

    const nearTop = root.scrollTop < edgeThresholdPx;
    const nearBottom = root.scrollHeight - (root.scrollTop + root.clientHeight) < edgeThresholdPx;
    if (nearTop) {
      lastShiftAtRef.current = now;
      shiftWindow(-shiftStep, 'top');
    } else if (nearBottom) {
      lastShiftAtRef.current = now;
      shiftWindow(+shiftStep, 'bottom');
    }

    schedulePersistScrollPosition();
  }

  function isValidMonthFirstYmd(v: string) {
    return /^\d{4}-\d{2}-\d{2}$/.test(String(v || '')) && String(v).endsWith('-01');
  }

  function applyPendingScrollIfPossible() {
    const root = scrollRef.current;
    if (!root) return false;
    if (root.clientHeight <= 0) return false;

    const restore = pendingRestoreRef.current;
    if (restore) {
      pendingRestoreRef.current = null;
      root.scrollTop = Math.max(0, Math.round(Number.isFinite(restore.scrollTop) ? restore.scrollTop : 0));
      const now = performance.now();
      ignoreScrollUntilRef.current = now + 600;
      lastShiftAtRef.current = now;
      hasInitializedScrollRef.current = true;
      schedulePersistScrollPosition();
      return true;
    }

    const targetMonth = pendingScrollToInitialMonthRef.current;
    if (targetMonth && isValidMonthFirstYmd(targetMonth) && !hasInitializedScrollRef.current && !hasRestoredScrollRef.current) {
      pendingScrollToInitialMonthRef.current = null;
      scrollToMonthAfterRender(targetMonth);
      setActiveMonthFirstYmd(targetMonth);
      hasInitializedScrollRef.current = true;
      schedulePersistScrollPosition();
      return true;
    }

    return false;
  }

  // 外部トリガーで「今月(指定月)へ」
  useEffect(() => {
    const ymd = String(props.jumpToYmd || '').slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(ymd)) return;
    const m = `${ymd.slice(0, 7)}-01`;
    setActiveMonthFirstYmd(m);
    setWindowStartMonthFirstYmd(addMonthsYmd(m, -centerIndex));
    // display:none → 表示に切り替わるケースがあるので、2フレーム待ってから合わせる
    scrollToMonthAfterRender(m);

    // 明示ジャンプは「初期化済み」として扱う（ここからはユーザーの位置を維持）
    hasInitializedScrollRef.current = true;
    schedulePersistScrollPosition();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.jumpNonce]);

  useEffect(() => {
    if (typeof window === 'undefined') return;

    // 1) 可能ならセッションからスクロール位置を復元（ブラウザ更新まで保持）
    const storage = getSafeSessionStorage();
    if (storage) {
      try {
        const raw = storage.getItem(CALENDAR_SCROLL_SESSION_KEY);
        const parsed = raw ? (JSON.parse(raw) as CalendarScrollSession) : null;
        if (
          parsed &&
          parsed.v === 1 &&
          typeof parsed.scrollTop === 'number' &&
          isValidMonthFirstYmd(String(parsed.windowStartMonthFirstYmd || '')) &&
          isValidMonthFirstYmd(String(parsed.activeMonthFirstYmd || ''))
        ) {
          hasRestoredScrollRef.current = true;
          pendingRestoreRef.current = {
            v: 1,
            scrollTop: parsed.scrollTop,
            windowStartMonthFirstYmd: String(parsed.windowStartMonthFirstYmd),
            activeMonthFirstYmd: String(parsed.activeMonthFirstYmd),
          };
          setActiveMonthFirstYmd(String(parsed.activeMonthFirstYmd));
          setWindowStartMonthFirstYmd(String(parsed.windowStartMonthFirstYmd));
        }
      } catch {
        // ignore
      }
    }

    // 2) 復元がなければ、初回は「今月」をデフォルト表示（ただし可視になるまで待つ）
    if (!hasRestoredScrollRef.current && isValidMonthFirstYmd(initialMonth)) {
      pendingScrollToInitialMonthRef.current = initialMonth;
      setActiveMonthFirstYmd(initialMonth);
    }

    // 3) display:none から表示に切り替わるときに scroll が失敗しやすいので、可視化を監視してから適用
    const root = scrollRef.current;
    if (!root) return;
    let stopped = false;

    const tryApply = () => {
      if (stopped) return;
      applyPendingScrollIfPossible();
    };

    // まず1回は即トライ（既に可視なケース）
    window.requestAnimationFrame(() => {
      window.requestAnimationFrame(tryApply);
    });

    // 以降はサイズ変化（=可視化）でトライ
    let ro: ResizeObserver | null = null;
    try {
      if (typeof ResizeObserver !== 'undefined') {
        ro = new ResizeObserver(() => {
          tryApply();
        });
        ro.observe(root);
      }
    } catch {
      ro = null;
    }

    return () => {
      stopped = true;
      try {
        ro?.disconnect();
      } catch {
        // ignore
      }
      ro = null;
      if (persistTimerRef.current != null) {
        try {
          window.clearTimeout(persistTimerRef.current);
        } catch {
          // ignore
        }
        persistTimerRef.current = null;
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="calendar-root" onPointerMove={onRootPointerMove} onPointerUp={onRootPointerUp} onPointerCancel={onRootPointerCancel}>
      <div
        className="calendar-scroll"
        ref={scrollRef}
        onScroll={handleScroll}
        onPointerDown={(ev) => {
          if (disabled) return;
          if (pointerDragRef.current) return;
          if (selectingRef.current) return;
          if (ev.button !== 0) return;

          // Only start selecting from inside the scroll area.
          const p = getPointInScrollFromClient(ev.clientX, ev.clientY);
          if (!p) return;

          hideMemoTooltip();
          setDragHoverPreview(null);
          setDraggingPreviewEventIds(null);

          selectingRef.current = {
            pointerId: ev.pointerId,
            startClientX: ev.clientX,
            startClientY: ev.clientY,
            startX: p.x,
            startY: p.y,
            curX: p.x,
            curY: p.y,
            didDrag: false,
          };
          setSelectRect({ x: p.x, y: p.y, w: 0, h: 0 });

          try {
            (ev.currentTarget as HTMLElement).setPointerCapture(ev.pointerId);
          } catch {
            // ignore
          }

          ev.preventDefault();
          ev.stopPropagation();
        }}
      >
        {selectRect ? <div className="calendar-select-rect" style={{ left: selectRect.x, top: selectRect.y, width: selectRect.w, height: selectRect.h }} aria-hidden="true" /> : null}
        {months.map((monthFirstYmd) => {
          const gridStartYmd = startOfCalendarGrid(monthFirstYmd);
          const monthPrefix = monthFirstYmd.slice(0, 7);

          const gridDays = Array.from({ length: 42 }, (_, i) => {
            const ymd = addDaysLocalYmd(gridStartYmd, i);
            const p = parseYmd(ymd);
            const weekday0 = weekday0FromYmd(ymd);
            const inMonth = ymd.slice(0, 7) === monthPrefix;
            const isToday = ymd === todayYmd;
            const isHolidayFlag = !!p && isHoliday(new Date(p.year, p.month0, p.day));
            const isUserHoliday = userHolidaySet.has(ymd);
            return { ymd, day: p?.day ?? 0, weekday0, inMonth, isToday, isHoliday: isHolidayFlag, isUserHoliday };
          });

          return (
            <div
              key={monthFirstYmd}
              className="calendar-month"
              ref={(el) => {
                monthAnchorRefs.current[monthFirstYmd] = el;
              }}
            >
              <div className="calendar-month-title">{monthTitleJa(monthFirstYmd)}</div>

              <div className="calendar-weekdays" aria-hidden="true">
                {[
                  { key: 'mon', label: '月' },
                  { key: 'tue', label: '火' },
                  { key: 'wed', label: '水' },
                  { key: 'thu', label: '木' },
                  { key: 'fri', label: '金' },
                  { key: 'sat', label: '土', cls: 'is-sat' },
                  { key: 'sun', label: '日', cls: 'is-sun' },
                ].map((d) => (
                  <div key={d.key} className={`calendar-weekday${d.cls ? ` ${d.cls}` : ''}`}>
                    {d.label}
                  </div>
                ))}
              </div>

              <div className="calendar-grid" role="grid" aria-label={`月間カレンダー ${monthTitleJa(monthFirstYmd)}`}>
                {gridDays.map((cell) => {
                  const dayToneClass = cell.isHoliday ? 'is-holiday' : cell.weekday0 === 0 ? 'is-sun' : cell.weekday0 === 6 ? 'is-sat' : '';
                  const dayEvents = eventsByDay.get(cell.ymd) ?? [];
                  const { allDay, timed } = sortForDayRender(dayEvents);

                  const previewActive = !!(dragHoverPreview && draggingPreviewEventIds && draggingPreviewEventIds.length && dragHoverPreview.dateYmd === cell.ymd);
                  const previewBeforeId = previewActive ? dragHoverPreview!.beforeEventId : null;
                  const previewIds = previewActive ? draggingPreviewEventIds! : [];

                  const previewEvents = previewActive
                    ? (previewIds.map((id) => normalizedEvents.find((e) => e.id === id) ?? null).filter(Boolean) as CalendarEvent[])
                    : ([] as CalendarEvent[]);
                  const previewAllDay = previewEvents.filter((e) => !!e.allDay);
                  const previewTimed = previewEvents.filter((e) => !e.allDay);

                  const baseAllDay = previewActive ? allDay.filter((e) => !previewIds.includes(e.id)) : allDay;
                  const baseTimed = previewActive ? timed.filter((e) => !previewIds.includes(e.id)) : timed;

                  const beforeInAllDay = !!(previewActive && previewBeforeId && baseAllDay.some((e) => e.id === previewBeforeId));
                  const beforeInTimed = !!(previewActive && previewBeforeId && baseTimed.some((e) => e.id === previewBeforeId));

                  const allDayItemsFinal = makePreviewItems(baseAllDay, previewAllDay, beforeInAllDay ? previewBeforeId : null);
                  const timedItemsFinal = makePreviewItems(baseTimed, previewTimed, beforeInTimed ? previewBeforeId : null);

                  const dropKey = `${cell.ymd}::cell`;
                  const isDragOver = dragOverKey === dropKey;

                  return (
                    <div
                      key={cell.ymd}
                      className={`calendar-cell${cell.inMonth ? '' : ' is-out'}${cell.isToday ? ' is-today' : ''}${cell.isUserHoliday ? ' is-user-holiday' : ''}${isDragOver ? ' is-drag-over' : ''}`}
                      role="gridcell"
                      aria-label={cell.ymd}
                      data-cal-drop-date={cell.ymd}
                      data-cal-drop-before=""
                      data-cal-drop-key={dropKey}
                      onDoubleClick={() => {
                        if (disabled) return;
                        openNewEventModal(cell.ymd);
                      }}
                    >
                      <div className={`calendar-day-number ${dayToneClass}`}>{cell.day}</div>

                      <div className="calendar-cell-body">
                        <div className="calendar-events-allday" aria-label="終日">
                          {allDayItemsFinal.map((it) => {
                            const e = it.e;
                            if (it.preview) {
                              return (
                                <div key={`preview-${e.id}`} className={`calendar-event-chip is-allday is-preview${multiSelectedEventSet.has(e.id) ? ' is-selected' : ''}`} aria-hidden="true">
                                  <span className="calendar-event-title">{e.title}</span>
                                </div>
                              );
                            }
                            const overKey = `${cell.ymd}::allday::${e.id}`;
                            const isOver = dragOverKey === overKey;
                            return (
                              <button
                                key={e.id}
                                type="button"
                                className={`calendar-event-chip is-allday${multiSelectedEventSet.has(e.id) ? ' is-selected' : ''}${isOver ? ' is-drop-target' : ''}`}
                                data-cal-drop-date={cell.ymd}
                                data-cal-drop-before={e.id}
                                data-cal-drop-key={overKey}
                                data-cal-event-id={e.id}
                                onPointerDown={(ev) => onEventPointerDown(ev, e)}
                                onClick={(ev) => {
                                  ev.stopPropagation();
                                }}
                                onDoubleClick={(ev) => {
                                  ev.preventDefault();
                                  ev.stopPropagation();
                                  if (disabled) return;
                                  openEditEventModal(e.id);
                                }}
                                onMouseEnter={(ev) => showMemoTooltip(ev, e)}
                                onMouseMove={(ev) => {
                                  if (pointerDragRef.current) return;
                                  if (draggingId) return;
                                  if (!memoTooltip) return;
                                  placeMemoTooltipAtPoint(ev.clientX, ev.clientY);
                                }}
                                onMouseLeave={() => {
                                  if (pointerDragRef.current) return;
                                  if (draggingId) return;
                                  hideMemoTooltip();
                                }}
                              >
                                <span className="calendar-event-title">{e.title}</span>
                              </button>
                            );
                          })}
                        </div>

                        <div className="calendar-events-timed" aria-label="時間指定">
                          {timedItemsFinal.map((it) => {
                            const e = it.e;
                            const timeLabel = e.startTime ? `${e.startTime} ` : '';
                            if (it.preview) {
                              return (
                                <div key={`preview-${e.id}`} className={`calendar-event-chip is-preview${multiSelectedEventSet.has(e.id) ? ' is-selected' : ''}`} aria-hidden="true">
                                  <span className="calendar-event-time" aria-hidden="true">
                                    {timeLabel}
                                  </span>
                                  <span className="calendar-event-title">{e.title}</span>
                                </div>
                              );
                            }
                            const overKey = `${cell.ymd}::timed::${e.startTime || 'none'}::${e.id}`;
                            const isOver = dragOverKey === overKey;
                            return (
                              <button
                                key={e.id}
                                type="button"
                                className={`calendar-event-chip${multiSelectedEventSet.has(e.id) ? ' is-selected' : ''}${isOver ? ' is-drop-target' : ''}`}
                                data-cal-drop-date={cell.ymd}
                                data-cal-drop-before={e.id}
                                data-cal-drop-key={overKey}
                                data-cal-event-id={e.id}
                                onPointerDown={(ev) => onEventPointerDown(ev, e)}
                                onClick={(ev) => {
                                  ev.stopPropagation();
                                }}
                                onDoubleClick={(ev) => {
                                  ev.preventDefault();
                                  ev.stopPropagation();
                                  if (disabled) return;
                                  openEditEventModal(e.id);
                                }}
                                onMouseEnter={(ev) => showMemoTooltip(ev, e)}
                                onMouseMove={(ev) => {
                                  if (pointerDragRef.current) return;
                                  if (draggingId) return;
                                  if (!memoTooltip) return;
                                  placeMemoTooltipAtPoint(ev.clientX, ev.clientY);
                                }}
                                onMouseLeave={() => {
                                  if (pointerDragRef.current) return;
                                  if (draggingId) return;
                                  hideMemoTooltip();
                                }}
                              >
                                <span className="calendar-event-time" aria-hidden="true">
                                  {timeLabel}
                                </span>
                                <span className="calendar-event-title">{e.title}</span>
                              </button>
                            );
                          })}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>

      {memoTooltip
        ? createPortal(
            <div
              className="gantt-memo-tooltip calendar-memo-tooltip"
              style={{ left: memoTooltip.x, top: memoTooltip.y }}
              ref={memoTooltipElRef}
              aria-hidden="true"
            >
              <div className="gantt-memo-tooltip-title">{memoTooltip.title}</div>
              {memoTooltip.memo ? <div className="gantt-memo-tooltip-body">{memoTooltip.memo}</div> : null}
            </div>,
            document.body
          )
        : null}

      <div
        className={`edit-dialog ${modalOpen ? 'show' : ''}`}
        id="calendar-event-dialog"
        aria-hidden={!modalOpen}
        role="presentation"
        onMouseDown={(e) => {
          if (e.target === e.currentTarget) setModalOpen(false);
        }}
      >
        <div className="edit-content" role="dialog" aria-modal="true" aria-label="予定の編集" onMouseDown={(e) => e.stopPropagation()}>
          <div className="edit-body">
            <div className="edit-field">
              <label>タイトル</label>
              <input
                ref={titleRef}
                className="edit-input"
                value={modalTitle}
                onChange={(e) => setModalTitle(e.target.value)}
                disabled={disabled}
                placeholder="例: 打ち合わせ"
              />
            </div>

            <div className="edit-field">
              <label>種類</label>
              <div className="flex items-center gap-2" style={{ flexWrap: 'wrap' }}>
                <span className="text-sm" style={{ color: 'var(--text-secondary)' }}>
                  開始時刻（未設定なら終日）
                </span>
                <input
                  type="time"
                  className="edit-input"
                  style={{ width: 160 }}
                  value={modalStartTime}
                  onChange={(e) => setModalStartTime(e.target.value)}
                  disabled={disabled}
                />
                {!String(modalStartTime || '').trim() ? (
                  <span className="text-sm" style={{ color: 'var(--text-muted)' }}>
                    終日
                  </span>
                ) : null}
              </div>
              {modalStartTime && !/^([01]?\d|2[0-3]):[0-5]\d$/.test(String(modalStartTime || '')) ? (
                <div style={{ marginTop: 6, fontSize: 12, color: 'var(--error)' }}>開始時刻は HH:MM で入力してください</div>
              ) : null}
            </div>

            <div className="edit-field">
              <label>詳細メモ（ホバーで表示）</label>
              <textarea
                className="edit-input"
                value={modalMemo}
                onChange={(e) => setModalMemo(e.target.value)}
                disabled={disabled}
                placeholder="背景、補足、リンクなど"
                rows={8}
                style={{ resize: 'vertical', minHeight: 160, lineHeight: 1.5 }}
              />
            </div>
          </div>

          <div className="edit-footer">
            <button className="btn-cancel" type="button" title="キャンセル" aria-label="キャンセル" onClick={() => setModalOpen(false)} disabled={disabled}>
              <span className="material-icons">close</span>
            </button>
            <button
              className="btn-primary"
              type="button"
              title="保存"
              aria-label="保存"
              onClick={() => {
                upsertFromModal();
              }}
              disabled={disabled || !String(modalTitle || '').trim() || (!!String(modalStartTime || '').trim() && !/^([01]?\d|2[0-3]):[0-5]\d$/.test(String(modalStartTime || '')))}
            >
              <span className="material-icons">done</span>
            </button>
            <button className="btn-danger" type="button" title="削除" aria-label="削除" onClick={() => deleteFromModal()} disabled={disabled || !modalEditingId}>
              <span className="material-icons">delete</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
