'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import type { DragEvent as ReactDragEvent, MouseEvent as ReactMouseEvent } from 'react';
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
  onCommitEvents: (next: CalendarEvent[]) => void;
  onSaveAndSync?: (next: CalendarEvent[]) => void;
  onInteractionChange?: (active: boolean, editingId: string | null) => void;
  disabled?: boolean;
  jumpToYmd?: string;
  jumpNonce?: number;
}) {
  const todayYmd = String(props.todayYmd || '').slice(0, 10);
  const initialMonth = /^\d{4}-\d{2}-\d{2}$/.test(todayYmd) ? `${todayYmd.slice(0, 7)}-01` : '1970-01-01';

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

  const [memoTooltip, setMemoTooltip] = useState<null | { title: string; memo: string; x: number; y: number }>(null);

  function toSingleLineText(s: string) {
    return String(s || '')
      .replace(/\r\n/g, '\n')
      .replace(/\n/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  function getMemoTooltipPosFromPoint(clientX: number, clientY: number) {
    const pad = 12;
    const estW = 420;
    const estH = 280;
    const vw = typeof window !== 'undefined' ? window.innerWidth : 0;
    const vh = typeof window !== 'undefined' ? window.innerHeight : 0;
    let x = clientX + pad;
    let y = clientY + pad;
    if (vw) x = Math.max(12, Math.min(x, vw - estW - 12));
    if (vh) y = Math.max(12, Math.min(y, vh - estH - 12));
    return { x, y };
  }

  function showMemoTooltip(ev: ReactMouseEvent, e: CalendarEvent) {
    const memo = String(e.memo || '').trim();
    if (!memo) return;
    const title = String(e.title || '（無題）').trim() || '（無題）';
    const { x, y } = getMemoTooltipPosFromPoint(ev.clientX, ev.clientY);
    setMemoTooltip({ title: toSingleLineText(title), memo: toSingleLineText(memo), x, y });
  }

  function placeMemoTooltipAtPoint(clientX: number, clientY: number) {
    const { x, y } = getMemoTooltipPosFromPoint(clientX, clientY);
    setMemoTooltip((prev) => (prev ? { ...prev, x, y } : prev));
  }

  function hideMemoTooltip() {
    setMemoTooltip(null);
  }

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
    props.onInteractionChange(modalOpen || !!draggingId, modalOpen ? modalEditingId : null);
  }, [modalOpen, modalEditingId, draggingId, props.onInteractionChange]);

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

  function onDragStartEvent(ev: ReactDragEvent, e: CalendarEvent) {
    if (disabled) return;
    setDraggingId(e.id);
    setDragOverKey(null);
    try {
      ev.dataTransfer.effectAllowed = 'copyMove';
      ev.dataTransfer.setData('text/plain', e.id);
      ev.dataTransfer.setData('application/json', JSON.stringify({ id: e.id }));
    } catch {
      // ignore
    }
  }

  function onDragEndEvent() {
    setDraggingId(null);
    setDragOverKey(null);
    try {
      (window as any).__calendarAltCopy = false;
    } catch {
      // ignore
    }

    // まれに dragend が落ちて「操作中」が解除されないことがあるので、親へ即通知
    try {
      if (props.onInteractionChange) {
        const nextActive = !!modalOpen;
        const nextEditingId = modalOpen ? modalEditingId : null;
        props.onInteractionChange(nextActive, nextEditingId);
      }
    } catch {
      // ignore
    }
  }

  // DnD系イベントは環境差で dragend が発火しないことがあるため、保険でクリーンアップ
  useEffect(() => {
    if (!draggingId) return;

    const cleanup = () => {
      onDragEndEvent();
    };

    window.addEventListener('dragend', cleanup, true);
    window.addEventListener('blur', cleanup, true);

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') cleanup();
    };
    window.addEventListener('keydown', onKeyDown, true);

    return () => {
      window.removeEventListener('dragend', cleanup, true);
      window.removeEventListener('blur', cleanup, true);
      window.removeEventListener('keydown', onKeyDown, true);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.jumpNonce]);

  useEffect(() => {
    // 初回は today 月を見える位置へ
    if (!/^\d{4}-\d{2}-\d{2}$/.test(initialMonth)) return;
    window.requestAnimationFrame(() => {
      scrollToMonthAfterRender(initialMonth);
      setActiveMonthFirstYmd(initialMonth);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="calendar-root">
      <div className="calendar-scroll" ref={scrollRef} onScroll={handleScroll}>
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
            return { ymd, day: p?.day ?? 0, weekday0, inMonth, isToday, isHoliday: isHolidayFlag };
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

                  const dropKey = `${cell.ymd}::cell`;
                  const isDragOver = dragOverKey === dropKey;

                  return (
                    <div
                      key={cell.ymd}
                      className={`calendar-cell${cell.inMonth ? '' : ' is-out'}${cell.isToday ? ' is-today' : ''}${isDragOver ? ' is-drag-over' : ''}`}
                      role="gridcell"
                      aria-label={cell.ymd}
                      onDoubleClick={() => {
                        if (disabled) return;
                        openNewEventModal(cell.ymd);
                      }}
                      onDragOver={(ev) => {
                        if (disabled) return;
                        ev.preventDefault();
                        ev.dataTransfer.dropEffect = ev.altKey ? 'copy' : 'move';
                        setDragOverKey(dropKey);
                      }}
                      onDragLeave={() => {
                        if (dragOverKey === dropKey) setDragOverKey(null);
                      }}
                      onDrop={(ev) => {
                        if (disabled) return;
                        ev.preventDefault();
                        const id = ev.dataTransfer.getData('text/plain');
                        if (!id) return;
                        try {
                          (window as any).__calendarAltCopy = !!ev.altKey;
                          moveOrCopyEventToDate(id, cell.ymd, null);
                        } finally {
                          (window as any).__calendarAltCopy = false;
                          setDragOverKey(null);
                          // 環境によっては dragend が発火しないため、drop で確実に終了させる
                          onDragEndEvent();
                        }
                      }}
                    >
                      <div className={`calendar-day-number ${dayToneClass}`}>{cell.day}</div>

                      <div className="calendar-cell-body">
                        <div className="calendar-events-allday" aria-label="終日">
                          {allDay.map((e) => {
                            const overKey = `${cell.ymd}::allday::${e.id}`;
                            const isOver = dragOverKey === overKey;
                            return (
                              <button
                                key={e.id}
                                type="button"
                                className={`calendar-event-chip is-allday${draggingId === e.id ? ' is-dragging' : ''}${isOver ? ' is-drop-target' : ''}`}
                                title={e.title}
                                draggable={!disabled}
                                onDragStart={(ev) => onDragStartEvent(ev, e)}
                                onDragEnd={onDragEndEvent}
                                onDragOver={(ev) => {
                                  if (disabled) return;
                                  ev.preventDefault();
                                  ev.dataTransfer.dropEffect = ev.altKey ? 'copy' : 'move';
                                  setDragOverKey(overKey);
                                }}
                                onDrop={(ev) => {
                                  if (disabled) return;
                                  ev.preventDefault();
                                  const id = ev.dataTransfer.getData('text/plain');
                                  if (!id) return;
                                  try {
                                    (window as any).__calendarAltCopy = !!ev.altKey;
                                    moveOrCopyEventToDate(id, cell.ymd, e.id);
                                  } finally {
                                    (window as any).__calendarAltCopy = false;
                                    setDragOverKey(null);
                                    onDragEndEvent();
                                  }
                                }}
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
                                  if (!memoTooltip) return;
                                  placeMemoTooltipAtPoint(ev.clientX, ev.clientY);
                                }}
                                onMouseLeave={() => hideMemoTooltip()}
                              >
                                {e.title}
                              </button>
                            );
                          })}
                        </div>

                        <div className="calendar-events-timed" aria-label="時間指定">
                          {timed.map((e) => {
                            const overKey = `${cell.ymd}::timed::${e.startTime || 'none'}::${e.id}`;
                            const isOver = dragOverKey === overKey;
                            const timeLabel = e.startTime ? `${e.startTime} ` : '';
                            return (
                              <button
                                key={e.id}
                                type="button"
                                className={`calendar-event-chip${draggingId === e.id ? ' is-dragging' : ''}${isOver ? ' is-drop-target' : ''}`}
                                title={e.title}
                                draggable={!disabled}
                                onDragStart={(ev) => onDragStartEvent(ev, e)}
                                onDragEnd={onDragEndEvent}
                                onDragOver={(ev) => {
                                  if (disabled) return;
                                  ev.preventDefault();
                                  ev.dataTransfer.dropEffect = ev.altKey ? 'copy' : 'move';
                                  setDragOverKey(overKey);
                                }}
                                onDrop={(ev) => {
                                  if (disabled) return;
                                  ev.preventDefault();
                                  const id = ev.dataTransfer.getData('text/plain');
                                  if (!id) return;
                                  try {
                                    (window as any).__calendarAltCopy = !!ev.altKey;
                                    // 時間指定は「開始時刻順」を維持：同じ開始時刻グループ内で並び替える
                                    moveOrCopyEventToDate(id, cell.ymd, e.id);
                                  } finally {
                                    (window as any).__calendarAltCopy = false;
                                    setDragOverKey(null);
                                    onDragEndEvent();
                                  }
                                }}
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
                                  if (!memoTooltip) return;
                                  placeMemoTooltipAtPoint(ev.clientX, ev.clientY);
                                }}
                                onMouseLeave={() => hideMemoTooltip()}
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

      <div className="calendar-hint">
        日付ダブルクリックで追加 / 予定ドラッグで日付移動 / Alt+ドラッグでコピー / 予定ダブルクリックで編集
      </div>

      {memoTooltip
        ? createPortal(
            <div
              className="gantt-memo-tooltip calendar-memo-tooltip"
              style={{ transform: `translate3d(${memoTooltip.x}px, ${memoTooltip.y}px, 0)` }}
              aria-hidden="true"
            >
              <div className="calendar-memo-tooltip-line">{`${memoTooltip.title} — ${memoTooltip.memo}`}</div>
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
