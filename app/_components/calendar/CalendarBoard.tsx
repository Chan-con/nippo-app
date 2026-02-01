'use client';

import { useMemo, useState } from 'react';
import { isHoliday } from '@holiday-jp/holiday_jp';
import type { GanttTask } from '../gantt/types';

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
  const firstWeekday0 = new Date(p.year, p.month0, 1).getDay();
  const startDay = 1 - firstWeekday0;
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

function isTaskInDay(task: GanttTask, ymd: string) {
  const s = String(task?.startDate || '');
  const e = String(task?.endDate || '');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s) || !/^\d{4}-\d{2}-\d{2}$/.test(e)) return false;
  if (e < s) return false;
  return s <= ymd && ymd <= e;
}

export default function CalendarBoard(props: {
  todayYmd: string;
  tasks: GanttTask[];
  selectedTaskId: string | null;
  onSelectTaskId: (id: string | null) => void;
  onOpenTaskId?: (id: string) => void;
}) {
  const todayYmd = String(props.todayYmd || '').slice(0, 10);
  const initialMonth = /^\d{4}-\d{2}-\d{2}$/.test(todayYmd) ? `${todayYmd.slice(0, 7)}-01` : '1970-01-01';
  const [viewMonthFirstYmd, setViewMonthFirstYmd] = useState<string>(initialMonth);

  const gridStartYmd = useMemo(() => startOfCalendarGrid(viewMonthFirstYmd), [viewMonthFirstYmd]);

  const gridDays = useMemo(() => {
    const out: Array<{
      ymd: string;
      day: number;
      inMonth: boolean;
      weekday0: number;
      isToday: boolean;
      isHoliday: boolean;
    }> = [];

    const monthPrefix = viewMonthFirstYmd.slice(0, 7);

    for (let i = 0; i < 42; i += 1) {
      const ymd = addDaysLocalYmd(gridStartYmd, i);
      const p = parseYmd(ymd);
      const weekday0 = weekday0FromYmd(ymd);
      const inMonth = ymd.slice(0, 7) === monthPrefix;
      const isToday = ymd === todayYmd;
      const isHolidayFlag = !!p && isHoliday(new Date(p.year, p.month0, p.day));
      out.push({ ymd, day: p?.day ?? 0, inMonth, weekday0, isToday, isHoliday: isHolidayFlag });
    }
    return out;
  }, [gridStartYmd, todayYmd, viewMonthFirstYmd]);

  const tasksByDay = useMemo(() => {
    const byYmd = new Map<string, GanttTask[]>();
    const list = Array.isArray(props.tasks) ? props.tasks : [];
    for (const cell of gridDays) {
      byYmd.set(cell.ymd, []);
    }
    for (const t of list) {
      if (!t?.id) continue;
      for (const cell of gridDays) {
        if (!cell.inMonth) continue;
        if (!isTaskInDay(t, cell.ymd)) continue;
        const arr = byYmd.get(cell.ymd);
        if (!arr) continue;
        arr.push(t);
      }
    }

    for (const [k, arr] of byYmd.entries()) {
      byYmd.set(
        k,
        (Array.isArray(arr) ? arr : []).slice().sort((a, b) => {
          return String(a.title || '').localeCompare(String(b.title || ''));
        })
      );
    }

    return byYmd;
  }, [gridDays, props.tasks]);

  return (
    <div className="calendar-root">
      <div className="calendar-toolbar">
        <div className="calendar-toolbar-left">
          <button
            type="button"
            className="btn-secondary calendar-nav-btn"
            aria-label="前の月"
            title="前の月"
            onClick={() => setViewMonthFirstYmd((prev) => addMonthsYmd(prev, -1))}
          >
            <span className="material-icons">chevron_left</span>
          </button>
          <button
            type="button"
            className="btn-secondary calendar-nav-btn"
            aria-label="今日"
            title="今日"
            onClick={() => {
              if (!/^\d{4}-\d{2}-\d{2}$/.test(todayYmd)) return;
              setViewMonthFirstYmd(`${todayYmd.slice(0, 7)}-01`);
            }}
          >
            <span className="material-icons">today</span>
          </button>
          <button
            type="button"
            className="btn-secondary calendar-nav-btn"
            aria-label="次の月"
            title="次の月"
            onClick={() => setViewMonthFirstYmd((prev) => addMonthsYmd(prev, 1))}
          >
            <span className="material-icons">chevron_right</span>
          </button>

          <div className="calendar-title" aria-label="表示中の月">
            {monthTitleJa(viewMonthFirstYmd)}
          </div>
        </div>

        <div className="calendar-toolbar-right">
          <div className="calendar-legend">
            <span className="calendar-legend-item sun">日</span>
            <span className="calendar-legend-item sat">土</span>
            <span className="calendar-legend-item holiday">祝</span>
          </div>
        </div>
      </div>

      <div className="calendar-weekdays" aria-hidden="true">
        {['日', '月', '火', '水', '木', '金', '土'].map((w, idx) => (
          <div key={w} className={`calendar-weekday ${idx === 0 ? 'is-sun' : idx === 6 ? 'is-sat' : ''}`}> 
            {w}
          </div>
        ))}
      </div>

      <div className="calendar-grid" role="grid" aria-label="月間カレンダー">
        {gridDays.map((cell) => {
          const dayTasks = tasksByDay.get(cell.ymd) ?? [];
          const dayToneClass = cell.isHoliday ? 'is-holiday' : cell.weekday0 === 0 ? 'is-sun' : cell.weekday0 === 6 ? 'is-sat' : '';

          return (
            <div
              key={cell.ymd}
              className={`calendar-cell${cell.inMonth ? '' : ' is-out'}${cell.isToday ? ' is-today' : ''}`}
              role="gridcell"
              aria-label={cell.ymd}
            >
              <div className={`calendar-day-number ${dayToneClass}`}>
                {cell.day}
              </div>

              <div className="calendar-cell-body">
                {dayTasks.slice(0, 3).map((t) => {
                  const selected = props.selectedTaskId === t.id;
                  const tone = String((t as any)?.color || 'default');
                  return (
                    <button
                      key={t.id}
                      type="button"
                      className={`calendar-task-chip tone-${tone}${selected ? ' active' : ''}`}
                      title={String(t.title || '')}
                      onClick={() => {
                        props.onSelectTaskId(t.id);
                      }}
                      onDoubleClick={() => {
                        if (!props.onOpenTaskId) return;
                        props.onOpenTaskId(t.id);
                      }}
                    >
                      {String(t.title || '').trim() || '（無題）'}
                    </button>
                  );
                })}
                {dayTasks.length > 3 ? <div className="calendar-more">+{dayTasks.length - 3}</div> : null}
              </div>
            </div>
          );
        })}
      </div>

      <div className="calendar-hint">タスクはダブルクリックで編集（ガントを開きます）</div>
    </div>
  );
}
