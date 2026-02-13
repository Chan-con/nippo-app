'use client';

import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import FloatingNotices, { type FloatingNoticeItem } from './_components/FloatingNotices';
import { useFloatingNotices } from './_components/FloatingNoticesProvider';
import CalendarBoard from './_components/calendar/CalendarBoard';
import GanttBoard from './_components/gantt/GanttBoard';
import GanttDrawer from './_components/gantt/GanttDrawer';
import { addDaysYmd } from './_components/gantt/date';
import type { GanttLane, GanttTask } from './_components/gantt/types';
import { useClockNowMs } from './_lib/useClockNowMs';
import {
  DEFAULT_TIME_ZONE,
  formatIsoToZonedYmdHm,
  getCommonTimeZones,
  getZonedPartsFromMs,
  getZonedYmdFromMs,
  isoToZonedDatetimeLocalValue,
  normalizeTimeZone,
  zonedDatetimeLocalValueToIso,
  zonedLocalDateTimeToUtcMs,
} from './_lib/time';

type Task = {
  id: string;
  name: string;
  startTime?: string;
  endTime?: string;
  tag?: string;
  memo?: string;
  url?: string;
  status?: string | null;
  // 就労時間集計に含めるか（タスク単位）。未設定(undefined)なら設定の除外タスク名に従う。
  isTracked?: boolean;
};

type TaskLineCard = {
  id: string;
  text: string;
  lane: TaskLineLane;
  order: number;
};

type TaskLineLane = 'mon' | 'tue' | 'wed' | 'thu' | 'fri' | 'sat' | 'sun' | 'stock';

type TaskLineWeekday = Exclude<TaskLineLane, 'stock'>;

type TodayMainTab = 'timeline' | 'calendar' | 'taskline' | 'gantt' | 'alerts' | 'notes';

type CalendarEvent = {
  id: string;
  title: string;
  date: string; // YYYY-MM-DD (Asia/Tokyo based)
  allDay: boolean;
  startTime: string; // HH:MM (when !allDay)
  order: number;
  memo: string;
};

type AlertKind = 'once' | 'weekly' | 'monthly';

type AlertItem = {
  id: string;
  title: string;
  kind: AlertKind;
  // once
  onceAt?: string; // ISO
  // weekly/monthly
  time?: string; // HH:MM
  weeklyDays?: number[]; // 0=Sun..6=Sat
  monthlyDay?: number | null; // 1..31
  // weekly/monthly: 次回のみスキップ用（ISO）。この時刻を超える次回へ進める。
  skipUntil?: string; // ISO
  // computed
  nextFireAt?: string; // ISO
  lastFiredAt?: string; // ISO
};

type ShortcutItem = {
  id: string;
  url: string;
  title: string;
  iconUrl: string;
  createdAt: string;
};

type NoticeTone = 'info' | 'danger' | 'success' | 'warning' | 'default';

type NoticeData = {
  text: string;
  tone: NoticeTone;
};

function parseHHMMToParts(v: unknown) {
  const m = String(v ?? '').trim().match(/^([01]?\d|2[0-3]):([0-5]\d)$/);
  if (!m) return null;
  return { hh: parseInt(m[1], 10), mm: parseInt(m[2], 10) };
}

function clampInt(v: unknown, min: number, max: number, fallback: number | null) {
  const n = typeof v === 'number' && Number.isFinite(v) ? Math.trunc(v) : parseInt(String(v ?? ''), 10);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, n));
}

function computeNextFireAt(alert: AlertItem, fromDate: Date, timeZone: string) {
  // Store times as ISO(UTC) but *compute schedule* using the selected IANA time zone.
  // Avoid relying on the host OS timezone (Date getters are always local-time based).
  const tz = normalizeTimeZone(timeZone);
  const baseMs = fromDate.getTime();
  const baseParts = getZonedPartsFromMs(baseMs, tz);

  if (alert.kind === 'once') {
    const ms = Date.parse(String(alert.onceAt || ''));
    if (!Number.isFinite(ms)) return '';
    return new Date(ms).toISOString();
  }

  if (alert.kind === 'weekly') {
    const parts = parseHHMMToParts(alert.time);
    if (!parts) return '';
    const rawDays = Array.isArray(alert.weeklyDays) ? alert.weeklyDays : [];
    const days = Array.from(new Set(rawDays.map((x) => clampInt(x, 0, 6, null)).filter((x) => typeof x === 'number'))).sort((a, b) => a - b);
    if (days.length === 0) return '';

    for (let delta = 0; delta <= 14; delta += 1) {
      const candUtcMs = zonedLocalDateTimeToUtcMs(
        {
          year: baseParts.year,
          month0: baseParts.month0,
          day: baseParts.day + delta,
          hour: parts.hh,
          minute: parts.mm,
          second: 0,
        },
        tz
      );

      if (!Number.isFinite(candUtcMs)) continue;
      const candParts = getZonedPartsFromMs(candUtcMs, tz);
      if (!days.includes(candParts.weekday0)) continue;
      if (candUtcMs <= baseMs) continue;
      return new Date(candUtcMs).toISOString();
    }
    return '';
  }

  if (alert.kind === 'monthly') {
    const parts = parseHHMMToParts(alert.time);
    if (!parts) return '';
    const day = clampInt(alert.monthlyDay, 1, 31, null);
    if (day == null) return '';

    for (let addMonths = 0; addMonths <= 24; addMonths += 1) {
      const m0 = baseParts.month0 + addMonths;
      const y2 = baseParts.year + Math.floor(m0 / 12);
      const m2 = ((m0 % 12) + 12) % 12;
      const lastDay = new Date(Date.UTC(y2, m2 + 1, 0, 0, 0, 0, 0)).getUTCDate();
      const d = Math.min(day, lastDay);
      const candUtcMs = zonedLocalDateTimeToUtcMs({ year: y2, month0: m2, day: d, hour: parts.hh, minute: parts.mm, second: 0 }, tz);
      if (!Number.isFinite(candUtcMs)) continue;
      if (candUtcMs <= baseMs) continue;
      return new Date(candUtcMs).toISOString();
    }
    return '';
  }

  return '';
}

function getAlertDefaultTitle(kind: AlertKind) {
  if (kind === 'weekly') return '週次アラート';
  if (kind === 'monthly') return '月次アラート';
  return 'アラート';
}

function getAlertComputeBase(alert: AlertItem, nowJst: Date) {
  // `skipUntil` is stored as ISO; compare by epoch ms to avoid timezone pitfalls.
  if (alert.kind === 'once') return nowJst;
  const ms = Date.parse(String(alert.skipUntil || ''));
  if (!Number.isFinite(ms)) return nowJst;
  if (ms <= nowJst.getTime()) return nowJst;
  return new Date(ms);
}

function normalizeAlertItem(input: any, fallbackId: string, timeZone: string, nowMs: number) {
  const id = typeof input?.id === 'string' ? String(input.id) : fallbackId;
  const titleRaw = typeof input?.title === 'string' ? String(input.title) : '';
  const kindRaw = input?.kind;
  const kind: AlertKind = kindRaw === 'weekly' || kindRaw === 'monthly' || kindRaw === 'once' ? kindRaw : 'once';

  const onceAt = typeof input?.onceAt === 'string' ? String(input.onceAt) : '';
  const time = typeof input?.time === 'string' ? String(input.time) : '';
  const weeklyDays = Array.isArray(input?.weeklyDays) ? input.weeklyDays : [];
  const monthlyDay = input?.monthlyDay;
  const lastFiredAt = typeof input?.lastFiredAt === 'string' ? String(input.lastFiredAt) : '';
  const skipUntilRaw = typeof input?.skipUntil === 'string' ? String(input.skipUntil) : '';

  const base: AlertItem = {
    id: String(id || '').slice(0, 80),
    title: (titleRaw.trim() ? titleRaw : getAlertDefaultTitle(kind)).slice(0, 120),
    kind,
    onceAt: kind === 'once' ? onceAt.slice(0, 64) : '',
    time: kind === 'weekly' || kind === 'monthly' ? time.slice(0, 10) : '',
    weeklyDays: kind === 'weekly' ? weeklyDays.slice(0, 7).map((x: any) => clampInt(x, 0, 6, 0) ?? 0) : [],
    monthlyDay: kind === 'monthly' ? clampInt(monthlyDay, 1, 31, 1) : null,
    lastFiredAt: lastFiredAt.slice(0, 64),
    skipUntil: kind === 'weekly' || kind === 'monthly' ? skipUntilRaw.slice(0, 64) : '',
  };

  // skipUntil が過去ならクリア
  if (base.skipUntil) {
    const suMs = Date.parse(String(base.skipUntil || ''));
    if (!Number.isFinite(suMs) || suMs <= nowMs) base.skipUntil = '';
  }

  const now = new Date(nowMs);
  base.nextFireAt = computeNextFireAt(base, getAlertComputeBase(base, now), timeZone);
  return base;
}

function normalizeAlerts(input: unknown, timeZone: string = DEFAULT_TIME_ZONE, nowMs: number): AlertItem[] {
  const list = Array.isArray(input) ? input : [];
  const out: AlertItem[] = [];
  for (let i = 0; i < list.length; i += 1) {
    const item = (list as any[])[i];
    const fallbackId = `alert-${Math.random().toString(16).slice(2)}${Date.now().toString(16)}`;
    const a = normalizeAlertItem(item, fallbackId, timeZone, nowMs);
    if (!a.id) continue;
    out.push(a);
  }
  return out;
}

const TASK_LINE_LANES: Array<{ key: TaskLineLane; label: string }> = [
  { key: 'mon', label: '月' },
  { key: 'tue', label: '火' },
  { key: 'wed', label: '水' },
  { key: 'thu', label: '木' },
  { key: 'fri', label: '金' },
  { key: 'sat', label: '土' },
  { key: 'sun', label: '日' },
  { key: 'stock', label: 'ストック' },
];

function isTaskLineLane(v: unknown): v is TaskLineLane {
  return v === 'mon' || v === 'tue' || v === 'wed' || v === 'thu' || v === 'fri' || v === 'sat' || v === 'sun' || v === 'stock';
}

type ReportUrl = {
  id: number;
  name: string;
  url: string;
};

type TagStockItem = {
  id?: string;
  name: string;
};

type TagWorkTask = {
  date: string;
  name: string;
  startTime: string;
  endTime: string;
  minutes: number;
};

type TagWorkDateGroup = {
  date: string;
  totalMinutes: number;
  count: number;
  tasks: TagWorkTask[];
};

type TagWorkSummary = {
  tag: string;
  totalMinutes: number;
  groups: TagWorkDateGroup[];
};

const jpPublicHolidayCache = new Map<number, Set<string>>();

function ymdKeyFromParts(year: number, month0: number, day: number) {
  const y = String(year);
  const m = String(month0 + 1).padStart(2, '0');
  const d = String(day).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function getUtcWeekday0(year: number, month0: number, day: number) {
  return new Date(Date.UTC(year, month0, day, 0, 0, 0, 0)).getUTCDay();
}

function getUtcYmdFromDateArgs(args: { year: number; month0: number; day: number }) {
  const dt = new Date(Date.UTC(args.year, args.month0, args.day, 0, 0, 0, 0));
  return { year: dt.getUTCFullYear(), month0: dt.getUTCMonth(), day: dt.getUTCDate() };
}

function nthWeekdayDayOfMonth(year: number, month0: number, weekday0: number, nth: number) {
  const firstDow = getUtcWeekday0(year, month0, 1);
  const delta = (weekday0 - firstDow + 7) % 7;
  return 1 + delta + (nth - 1) * 7;
}

function vernalEquinoxDay(year: number) {
  // Valid / commonly used approximation for 2000-2099
  return Math.floor(20.69115 + 0.242194 * (year - 2000) - Math.floor((year - 2000) / 4));
}

function autumnalEquinoxDay(year: number) {
  // Valid / commonly used approximation for 2000-2099
  return Math.floor(23.09 + 0.242194 * (year - 2000) - Math.floor((year - 2000) / 4));
}

function getJpPublicHolidayKeysForYear(year: number) {
  const cached = jpPublicHolidayCache.get(year);
  if (cached) return cached;

  const holidays = new Set<string>();
  const key = (y: number, m0: number, d: number) => ymdKeyFromParts(y, m0, d);
  const add = (y: number, m0: number, d: number) => {
    holidays.add(key(y, m0, d));
  };

  // Fixed-date holidays
  add(year, 0, 1); // 元日
  add(year, 1, 11); // 建国記念の日
  if (year >= 2020) add(year, 1, 23); // 天皇誕生日
  add(year, 3, 29); // 昭和の日
  add(year, 4, 3); // 憲法記念日
  add(year, 4, 4); // みどりの日
  add(year, 4, 5); // こどもの日
  add(year, 10, 3); // 文化の日
  add(year, 10, 23); // 勤労感謝の日

  // Movable holidays (Happy Monday system)
  // 成人の日: 2000+ 1月第2月曜
  add(year, 0, nthWeekdayDayOfMonth(year, 0, 1, 2));
  // 海の日: 2003+ 7月第3月曜 (Olympics special cases below)
  add(year, 6, nthWeekdayDayOfMonth(year, 6, 1, 3));
  // 敬老の日: 2003+ 9月第3月曜
  add(year, 8, nthWeekdayDayOfMonth(year, 8, 1, 3));
  // スポーツの日（体育の日）: 2000+ 10月第2月曜 (Olympics special cases below)
  add(year, 9, nthWeekdayDayOfMonth(year, 9, 1, 2));

  // Equinoxes
  add(year, 2, vernalEquinoxDay(year));
  add(year, 8, autumnalEquinoxDay(year));

  // 山の日: 2016+
  if (year >= 2016) add(year, 7, 11);

  // Special one-off holidays
  if (year === 2019) {
    add(2019, 4, 1); // 即位の日
    add(2019, 9, 22); // 即位礼正殿の儀
  }

  // Olympics move (2020/2021)
  if (year === 2020) {
    // Override 海の日/スポーツの日/山の日
    holidays.delete(key(2020, 6, nthWeekdayDayOfMonth(2020, 6, 1, 3)));
    holidays.delete(key(2020, 9, nthWeekdayDayOfMonth(2020, 9, 1, 2)));
    holidays.delete(key(2020, 7, 11));
    add(2020, 6, 23);
    add(2020, 6, 24);
    add(2020, 7, 10);
  }
  if (year === 2021) {
    holidays.delete(key(2021, 6, nthWeekdayDayOfMonth(2021, 6, 1, 3)));
    holidays.delete(key(2021, 9, nthWeekdayDayOfMonth(2021, 9, 1, 2)));
    holidays.delete(key(2021, 7, 11));
    add(2021, 6, 22);
    add(2021, 6, 23);
    add(2021, 7, 8);
  }

  // Substitute holidays (振替休日): if holiday falls on Sunday, next weekday becomes holiday
  for (const k of Array.from(holidays)) {
    const m = k.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (!m) continue;
    const y = parseInt(m[1], 10);
    const m0 = parseInt(m[2], 10) - 1;
    const d = parseInt(m[3], 10);
    if (getUtcWeekday0(y, m0, d) !== 0) continue;
    // next day that is not already a holiday
    for (let i = 1; i <= 7; i++) {
      const nd = getUtcYmdFromDateArgs({ year: y, month0: m0, day: d + i });
      const nk = key(nd.year, nd.month0, nd.day);
      if (!holidays.has(nk)) {
        holidays.add(nk);
        break;
      }
    }
  }

  // Citizen's holiday (国民の休日): a weekday between two holidays becomes a holiday
  for (let m0 = 0; m0 < 12; m0++) {
    const days = new Date(Date.UTC(year, m0 + 1, 0, 0, 0, 0, 0)).getUTCDate();
    for (let d = 1; d <= days; d++) {
      const dow = getUtcWeekday0(year, m0, d);
      if (dow === 0 || dow === 6) continue;
      const k0 = key(year, m0, d);
      if (holidays.has(k0)) continue;
      const prev = getUtcYmdFromDateArgs({ year, month0: m0, day: d - 1 });
      const next = getUtcYmdFromDateArgs({ year, month0: m0, day: d + 1 });
      const pk = key(prev.year, prev.month0, prev.day);
      const nk = key(next.year, next.month0, next.day);
      if (holidays.has(pk) && holidays.has(nk)) holidays.add(k0);
    }
  }

  jpPublicHolidayCache.set(year, holidays);
  return holidays;
}

function isJpPublicHolidayYmd(ymd: string) {
  const m = String(ymd || '').match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return false;
  const y = parseInt(m[1], 10);
  if (!Number.isFinite(y)) return false;
  const set = getJpPublicHolidayKeysForYear(y);
  return set.has(`${m[1]}-${m[2]}-${m[3]}`);
}

function parseTimeToMinutesFlexible(input?: string) {
  const s = String(input ?? '').trim();
  if (!s) return null;

  // Accept Japanese AM/PM format used by backend (e.g. "午前 9:30", "午後1:05")
  const m0 = s.match(/^(午前|午後)\s*(\d{1,2}):(\d{2})$/);
  if (m0) {
    const ampm = m0[1];
    const hour12 = parseInt(m0[2], 10);
    const mm = parseInt(m0[3], 10);
    if (!Number.isFinite(hour12) || !Number.isFinite(mm)) return null;
    if (hour12 < 1 || hour12 > 12) return null;
    if (mm < 0 || mm > 59) return null;

    let hh24 = hour12 % 12;
    if (ampm === '午後') hh24 += 12;
    return hh24 * 60 + mm;
  }

  const m1 = s.match(/^(\d{1,2}):(\d{2})$/);
  if (m1) {
    const hh = parseInt(m1[1], 10);
    const mm = parseInt(m1[2], 10);
    if (!Number.isFinite(hh) || !Number.isFinite(mm)) return null;
    if (hh < 0 || hh > 23) return null;
    if (mm < 0 || mm > 59) return null;
    return hh * 60 + mm;
  }

  // Also accept HHMM / HMM (e.g. "930" -> 09:30, "1530" -> 15:30)
  const m2 = s.match(/^(\d{3,4})$/);
  if (m2) {
    const digits = m2[1];
    const hh = parseInt(digits.slice(0, digits.length - 2), 10);
    const mm = parseInt(digits.slice(-2), 10);
    if (!Number.isFinite(hh) || !Number.isFinite(mm)) return null;
    if (hh < 0 || hh > 23) return null;
    if (mm < 0 || mm > 59) return null;
    return hh * 60 + mm;
  }

  return null;
}

function calcDurationMinutes(start?: string, end?: string) {
  const s = parseTimeToMinutesFlexible(start);
  const e = parseTimeToMinutesFlexible(end);
  if (s == null || e == null) return null;
  const diff = e - s;
  if (diff < 0) return null;
  return diff;
}

function formatDurationJa(totalMinutes: number) {
  const h = Math.floor(totalMinutes / 60);
  const m = totalMinutes % 60;
  if (h <= 0) return `${m}分`;
  return `${h}時間${m ? `${m}分` : ''}`;
}

function formatTimeDisplay(timeStr?: string) {
  const minutes = parseTimeToMinutesFlexible(timeStr);
  if (minutes == null) return '';
  const hh = Math.floor(minutes / 60);
  const mm = minutes % 60;
  return `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`;
}

function formatTimeAmPmJa(timeStr?: string) {
  const minutes = parseTimeToMinutesFlexible(timeStr);
  if (minutes == null) return '';
  const hh24 = Math.floor(minutes / 60);
  const mm = minutes % 60;
  const amOrPm = hh24 < 12 ? '午前' : '午後';
  let hour12 = hh24 % 12;
  if (hour12 === 0) hour12 = 12;
  return `${amOrPm} ${hour12}:${String(mm).padStart(2, '0')}`;
}

function normalizeTaskNameList(list: unknown) {
  const arr = Array.isArray(list) ? list : [];
  const out: string[] = [];
  const seen = new Set<string>();
  for (const item of arr) {
    const name = String(item ?? '').trim();
    if (!name) continue;
    if (seen.has(name)) continue;
    seen.add(name);
    out.push(name);
  }
  return out;
}

function normalizeNotifyMinutesBeforeList(list: unknown) {
  const arr = Array.isArray(list) ? list : [];
  const out: number[] = [];
  const seen = new Set<number>();
  for (const item of arr) {
    const n = Math.trunc(Number(item));
    if (!Number.isFinite(n)) continue;
    if (n < 0) continue;
    if (n > 24 * 60) continue;
    if (seen.has(n)) continue;
    seen.add(n);
    out.push(n);
  }
  out.sort((a, b) => a - b);
  return out;
}

function arrayMove<T>(arr: T[], fromIndex: number, toIndex: number) {
  const from = Math.max(0, Math.min(arr.length - 1, fromIndex));
  const to = Math.max(0, Math.min(arr.length - 1, toIndex));
  if (from === to) return arr;
  const copy = arr.slice();
  const [item] = copy.splice(from, 1);
  copy.splice(to, 0, item as T);
  return copy;
}

function newId() {
  try {
    const c: any = typeof crypto !== 'undefined' ? crypto : null;
    if (c && typeof c.randomUUID === 'function') return c.randomUUID();
  } catch {
    // ignore
  }
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function safeRandomId(prefix = 'id') {
  return `${prefix}-${newId()}`;
}

function getSafeLocalStorage(): Storage | undefined {
  try {
    return window.localStorage;
  } catch {
    return undefined;
  }
}

function getSupabase(opts?: { supabaseUrl?: string; supabaseAnonKey?: string }): SupabaseClient | null {
  const url = opts?.supabaseUrl || process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = opts?.supabaseAnonKey || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anonKey) return null;
  return createClient(url, anonKey, {
    auth: {
      // Keep login even after closing the browser by using a refresh-token capable flow.
      flowType: 'pkce',
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: true,
      storage: getSafeLocalStorage(),
    },
  });
}

export default function ClientApp(props: { supabaseUrl?: string; supabaseAnonKey?: string }) {
  const supabase = useMemo(
    () => getSupabase({ supabaseUrl: props.supabaseUrl, supabaseAnonKey: props.supabaseAnonKey }),
    [props.supabaseUrl, props.supabaseAnonKey]
  );

  const [viewMode, setViewMode] = useState<'today' | 'history'>('today');
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [sidebarDesktopCollapsed, setSidebarDesktopCollapsed] = useState(() => {
    if (typeof window === 'undefined') return false;
    try {
      return window.localStorage.getItem('nippoSidebarDesktopCollapsed') === '1';
    } catch {
      return false;
    }
  });
  const [reportOpen, setReportOpen] = useState(false);
  const [tagWorkReportOpen, setTagWorkReportOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [goalStockOpen, setGoalStockOpen] = useState(false);
  const [taskStockOpen, setTaskStockOpen] = useState(false);
  const [tagStockOpen, setTagStockOpen] = useState(false);

  const [accessToken, setAccessToken] = useState<string | null>(null);
  const [userId, setUserId] = useState<string | null>(null);
  const [userEmail, setUserEmail] = useState<string | null>(null);
  const [tasks, setTasks] = useState<Task[]>([]);
  const tasksReloadInFlightRef = useRef(false);
  const [newTaskName, setNewTaskName] = useState('');
  const [newTaskCarryMemoUrlEnabled, setNewTaskCarryMemoUrlEnabled] = useState(false);
  const [newTaskCarryMemo, setNewTaskCarryMemo] = useState('');
  const [newTaskCarryUrl, setNewTaskCarryUrl] = useState('');
  const taskInputRef = useRef<HTMLInputElement | null>(null);
  const [taskInputFocused, setTaskInputFocused] = useState(false);
  const [taskSuggestOpen, setTaskSuggestOpen] = useState(false);
  const [taskSuggestActiveIndex, setTaskSuggestActiveIndex] = useState(-1);
  const taskSuggestCloseTimerRef = useRef<number | null>(null);
  const [addMode, setAddMode] = useState<'now' | 'reserve'>('now');
  const [selectedTag, setSelectedTag] = useState('');
  const [reserveStartTime, setReserveStartTime] = useState('');
  const [tagStock, setTagStock] = useState<TagStockItem[]>([]);
  const [tempTagStock, setTempTagStock] = useState<TagStockItem[]>([]);
  const [tagInput, setTagInput] = useState('');
  const [tagDirty, setTagDirty] = useState(false);
  const tagStockDragFromIndexRef = useRef<number | null>(null);
  const tagStockLastDragAtRef = useRef(0);
  const [tagStockDragOverIndex, setTagStockDragOverIndex] = useState<number | null>(null);
  const [tagStockDraggingIndex, setTagStockDraggingIndex] = useState<number | null>(null);

  const [goalStock, setGoalStock] = useState<Array<{ name: string }>>([]);
  const [tempGoalStock, setTempGoalStock] = useState<Array<{ name: string }>>([]);
  const [goalInput, setGoalInput] = useState('');
  const [goalDirty, setGoalDirty] = useState(false);
  const goalStockDragFromIndexRef = useRef<number | null>(null);
  const [goalStockDragOverIndex, setGoalStockDragOverIndex] = useState<number | null>(null);
  const [goalStockDraggingIndex, setGoalStockDraggingIndex] = useState<number | null>(null);

  const [taskStock, setTaskStock] = useState<string[]>([]);
  const [tempTaskStock, setTempTaskStock] = useState<string[]>([]);
  const [taskStockInput, setTaskStockInput] = useState('');
  const [taskStockDirty, setTaskStockDirty] = useState(false);
  const [taskStockLoaded, setTaskStockLoaded] = useState(false);
  const taskStockDragFromIndexRef = useRef<number | null>(null);
  const taskStockLastDragAtRef = useRef(0);
  const [taskStockDragOverIndex, setTaskStockDragOverIndex] = useState<number | null>(null);
  const [taskStockDraggingIndex, setTaskStockDraggingIndex] = useState<number | null>(null);

  const taskNameSuggestions = useMemo(() => {
    const list = normalizeTaskNameList(taskStock);
    const q = String(newTaskName || '').trim().toLowerCase();
    const filtered = q ? list.filter((n) => n.toLowerCase().includes(q)) : list;
    return filtered;
  }, [taskStock, newTaskName]);

  useEffect(() => {
    setTaskSuggestActiveIndex(-1);
  }, [newTaskName]);

  useEffect(() => {
    if (taskSuggestActiveIndex < 0) return;
    if (taskSuggestActiveIndex >= taskNameSuggestions.length) {
      setTaskSuggestActiveIndex(taskNameSuggestions.length - 1);
    }
  }, [taskNameSuggestions, taskSuggestActiveIndex]);

  const [settingsTimeRoundingInterval, setSettingsTimeRoundingInterval] = useState(0);
  const [settingsTimeRoundingMode, setSettingsTimeRoundingMode] = useState<'nearest' | 'floor' | 'ceil'>('nearest');
  const [settingsExcludeTaskNames, setSettingsExcludeTaskNames] = useState<string[]>([]);
  const [settingsExcludeTaskNameInput, setSettingsExcludeTaskNameInput] = useState('');

  // reservation task notifications
  const [settingsReservationNotifyEnabled, setSettingsReservationNotifyEnabled] = useState(false);
  const [settingsReservationNotifyMinutesBefore, setSettingsReservationNotifyMinutesBefore] = useState<number[]>([]);
  const [settingsReservationNotifyMinutesInput, setSettingsReservationNotifyMinutesInput] = useState('');
  const [settingsAutoShowTimelineOnIdle, setSettingsAutoShowTimelineOnIdle] = useState(false);

  const [settingsTimeZone, setSettingsTimeZone] = useState(() => {
    if (typeof window === 'undefined') return DEFAULT_TIME_ZONE;
    try {
      const raw = window.localStorage.getItem('nippoTimeZone');
      return normalizeTimeZone(raw || DEFAULT_TIME_ZONE);
    } catch {
      return DEFAULT_TIME_ZONE;
    }
  });

  // Single source of truth for "now": tick every second.
  const nowMs = useClockNowMs(1000);
  const now = useMemo(() => new Date(nowMs), [nowMs]);
  const activeTimeZone = useMemo(() => normalizeTimeZone(settingsTimeZone), [settingsTimeZone]);
  const nowParts = useMemo(() => getZonedPartsFromMs(nowMs, activeTimeZone), [nowMs, activeTimeZone]);
  const todayYmd = useMemo(() => `${nowParts.year2}-${nowParts.month2}-${nowParts.day2}`, [nowParts.year2, nowParts.month2, nowParts.day2]);

  // Refs for timer callbacks (avoid stale closures).
  const nowMsRef = useRef(nowMs);
  useEffect(() => {
    nowMsRef.current = nowMs;
  }, [nowMs]);

  const activeTimeZoneRef = useRef(activeTimeZone);
  useEffect(() => {
    activeTimeZoneRef.current = activeTimeZone;
  }, [activeTimeZone]);

  const tasksRef = useRef<Task[]>(tasks);
  useEffect(() => {
    tasksRef.current = tasks;
  }, [tasks]);

  const settingsReservationNotifyEnabledRef = useRef(settingsReservationNotifyEnabled);
  useEffect(() => {
    settingsReservationNotifyEnabledRef.current = settingsReservationNotifyEnabled;
  }, [settingsReservationNotifyEnabled]);

  const settingsReservationNotifyMinutesBeforeRef = useRef<number[]>(settingsReservationNotifyMinutesBefore);
  useEffect(() => {
    settingsReservationNotifyMinutesBeforeRef.current = settingsReservationNotifyMinutesBefore;
  }, [settingsReservationNotifyMinutesBefore]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    try {
      window.localStorage.setItem('nippoTimeZone', activeTimeZone);
    } catch {
      // ignore
    }
  }, [activeTimeZone]);

  // Day-boundary refresh (00:00 in selected TZ).
  // Some backend queries are day-scoped; ensure UI updates without a full reload.
  const lastTodayYmdRef = useRef(todayYmd);
  useEffect(() => {
    const prev = lastTodayYmdRef.current;
    if (prev === todayYmd) return;
    lastTodayYmdRef.current = todayYmd;

    if (!accessToken) return;
    // Refresh today tasks and history date list immediately.
    void reloadTasksSilent();
    void loadHistoryDates();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [todayYmd, accessToken]);

  const todayTaskLineLane = useMemo<TaskLineLane | null>(() => {
    const dow = nowParts.weekday0; // 0=Sun
    if (dow === 1) return 'mon';
    if (dow === 2) return 'tue';
    if (dow === 3) return 'wed';
    if (dow === 4) return 'thu';
    if (dow === 5) return 'fri';
    if (dow === 6) return 'sat';
    if (dow === 0) return 'sun';
    return null;
  }, [nowParts.weekday0]);

  const [reservationNotificationPermission, setReservationNotificationPermission] = useState<'default' | 'granted' | 'denied' | 'unsupported'>(
    'default'
  );
  const reservationNotificationPermissionRef = useRef(reservationNotificationPermission);
  useEffect(() => {
    reservationNotificationPermissionRef.current = reservationNotificationPermission;
  }, [reservationNotificationPermission]);
  const reservationNotifyTimeoutsRef = useRef<Map<string, number>>(new Map());
  const reservationNotifyFiredRef = useRef<Set<string>>(new Set());
  const reservationNotifyIntervalRef = useRef<number | null>(null);
  const floating = useFloatingNotices();

  const [settingsGptApiKeyInput, setSettingsGptApiKeyInput] = useState('');
  const [settingsGptApiKeySaved, setSettingsGptApiKeySaved] = useState(false);
  const [settingsGptEncryptionReady, setSettingsGptEncryptionReady] = useState<boolean | null>(null);
  const [settingsDirty, setSettingsDirty] = useState(false);
  const [settingsRemoteUpdatePending, setSettingsRemoteUpdatePending] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const workTimeExcludedNameSet = useMemo(() => {
    const set = new Set<string>();
    for (const name of settingsExcludeTaskNames) {
      const v = String(name ?? '').trim();
      if (!v) continue;
      set.add(v);
    }
    return set;
  }, [settingsExcludeTaskNames]);

  function isWorkTimeExcludedTaskName(name?: string) {
    const v = String(name ?? '').trim();
    if (!v) return false;
    return workTimeExcludedNameSet.has(v);
  }

  function getDefaultWorkTimeTrackedByName(name?: string) {
    return !isWorkTimeExcludedTaskName(name);
  }

  function isTaskTrackedForWorkTime(task: Task) {
    const explicit = (task as any)?.isTracked;
    if (typeof explicit === 'boolean') return explicit;
    return getDefaultWorkTimeTrackedByName(task?.name);
  }

  function getWorkTimeTrackIconKind(task: Task): 'excluded' | 'override-untracked' | null {
    const name = String(task?.name ?? '').trim();
    const defaultExcluded = isWorkTimeExcludedTaskName(name);
    const explicit = (task as any)?.isTracked;

    // explicit tracked: for excluded-name tasks, we intentionally show *no* excluded icon.
    if (typeof explicit === 'boolean') {
      if (explicit) return null;
      // explicit untracked
      return defaultExcluded ? 'excluded' : 'override-untracked';
    }

    // default behavior
    return defaultExcluded ? 'excluded' : null;
  }

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const update = () => {
      if (!('Notification' in window)) {
        setReservationNotificationPermission('unsupported');
        return;
      }
      try {
        setReservationNotificationPermission(Notification.permission);
      } catch {
        setReservationNotificationPermission('unsupported');
      }
    };

    update();
    window.addEventListener('focus', update);
    document.addEventListener('visibilitychange', update);
    return () => {
      window.removeEventListener('focus', update);
      document.removeEventListener('visibilitychange', update);
    };
  }, []);

  // tag work report (range)
  const [tagWorkReportRangeStart, setTagWorkReportRangeStart] = useState(() => todayYmd);
  const [tagWorkReportRangeEnd, setTagWorkReportRangeEnd] = useState(() => todayYmd);
  const [tagWorkReportSummary, setTagWorkReportSummary] = useState<TagWorkSummary[]>([]);
  const [tagWorkReportActiveTag, setTagWorkReportActiveTag] = useState<string>('');
  const [tagWorkReportLoading, setTagWorkReportLoading] = useState(false);
  const [tagWorkReportError, setTagWorkReportError] = useState<string | null>(null);

  // holiday calendar
  const [holidayCalendarOpen, setHolidayCalendarOpen] = useState(false);
  const [holidayCalendarMonth, setHolidayCalendarMonth] = useState(() => {
    const m = String(todayYmd || '').match(/^(\d{4})-(\d{2})-\d{2}$/);
    if (m) {
      const y = parseInt(m[1], 10);
      const mo = parseInt(m[2], 10);
      if (Number.isFinite(y) && Number.isFinite(mo)) return new Date(y, mo - 1, 1);
    }
    return new Date(nowParts.year, nowParts.month0, 1);
  });
  const [holidayCalendarHolidays, setHolidayCalendarHolidays] = useState<Set<string>>(() => new Set());
  const [holidayCalendarLoaded, setHolidayCalendarLoaded] = useState(false);
  const [holidayCalendarSyncing, setHolidayCalendarSyncing] = useState(false);
  const [holidayCalendarDirty, setHolidayCalendarDirty] = useState(false);
  const [holidayCalendarHasSaved, setHolidayCalendarHasSaved] = useState(false);
  const [holidayCalendarLastSavedSnapshot, setHolidayCalendarLastSavedSnapshot] = useState<string>('');
  const [holidayCalendarExporting, setHolidayCalendarExporting] = useState(false);
  const [holidayCalendarCopiedToast, setHolidayCalendarCopiedToast] = useState(false);
  const [holidayCalendarCopyError, setHolidayCalendarCopyError] = useState<string | null>(null);
  const holidayCalendarToastTimerRef = useRef<number | null>(null);

  // billing
  const [billingOpen, setBillingOpen] = useState(false);
  const [billingMode, setBillingMode] = useState<'hourly' | 'daily'>('hourly');
  const [billingHourlyRate, setBillingHourlyRate] = useState('');
  const [billingDailyRate, setBillingDailyRate] = useState('');
  const [billingClosingDay, setBillingClosingDay] = useState('31');
  const [billingHourlyCapHours, setBillingHourlyCapHours] = useState('');
  const [billingPeriodOffset, setBillingPeriodOffset] = useState(0);
  const [billingDirty, setBillingDirty] = useState(false);
  const [billingRemoteUpdatePending, setBillingRemoteUpdatePending] = useState(false);
  const [billingLoading, setBillingLoading] = useState(false);
  const [billingError, setBillingError] = useState<string | null>(null);
  const [billingSummary, setBillingSummary] = useState<any>(null);

  function formatHoursNumber(minutes: number) {
    const h = minutes / 60;
    if (!Number.isFinite(h)) return '0';
    const fixed = h.toFixed(2);
    return fixed.replace(/\.00$/, '').replace(/(\.\d)0$/, '$1');
  }

  function normalizeYmd(input: unknown) {
    const s = String(input ?? '').trim();
    const m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
    if (!m) return s;
    return `${m[1]}-${String(m[2]).padStart(2, '0')}-${String(m[3]).padStart(2, '0')}`;
  }

  const [gptReportRangeStart, setGptReportRangeStart] = useState(() => todayYmd);
  const [gptReportRangeEnd, setGptReportRangeEnd] = useState(() => todayYmd);

  useEffect(() => {
    if (!reportOpen) return;
    setGptReportRangeStart(todayYmd);
    setGptReportRangeEnd(todayYmd);
  }, [reportOpen, todayYmd]);

  useEffect(() => {
    if (!tagWorkReportOpen) return;
    setTagWorkReportRangeStart(todayYmd);
    setTagWorkReportRangeEnd(todayYmd);
  }, [tagWorkReportOpen, todayYmd]);

  // edit dialog (timeline)
  const [editOpen, setEditOpen] = useState(false);
  const [editingTaskId, setEditingTaskId] = useState<string>('');
  const [editingTaskDateKey, setEditingTaskDateKey] = useState<string | null>(null);
  const [editName, setEditName] = useState('');
  const [editTag, setEditTag] = useState('');
  const [editStartTime, setEditStartTime] = useState('');
  const [editEndTime, setEditEndTime] = useState('');
  const [editMemo, setEditMemo] = useState('');
  const [editUrl, setEditUrl] = useState('');
  const [editTrackedOverride, setEditTrackedOverride] = useState<boolean | null>(null);

  const editNameTrimmed = String(editName ?? '').trim();
  const editNameInTaskStock = !!editNameTrimmed && taskStock.includes(editNameTrimmed);
  const editTagTrimmed = String(editTag ?? '').trim();

  // history
  const [historyDates, setHistoryDates] = useState<string[]>([]);
  const [historyDate, setHistoryDate] = useState<string>('');
  const [historyTasks, setHistoryTasks] = useState<Task[]>([]);
  const [historyStats, setHistoryStats] = useState<{ totalMinutes: number; completed: number; total: number } | null>(null);
  const [historyNewTask, setHistoryNewTask] = useState<{ name: string; startTime: string; endTime: string; tag: string }>(
    { name: '', startTime: '', endTime: '', tag: '' }
  );
  const [historyEditing, setHistoryEditing] = useState<{
    id: string;
    name: string;
    startTime: string;
    endTime: string;
    tag: string;
  } | null>(null);

  // report
  const [reportUrls, setReportUrls] = useState<ReportUrl[]>([]);
  const [newReportUrl, setNewReportUrl] = useState<{ name: string; url: string }>({ name: '', url: '' });
  const [activeReportTabId, setActiveReportTabId] = useState<string | null>(null);
  const [reportSingleContent, setReportSingleContent] = useState('');
  const [reportTabContent, setReportTabContent] = useState<Record<string, string>>({});

  const timelineOpenUrlTimerRef = useRef<number | null>(null);

  const autoShowTimelineLastActivityAtRef = useRef<number>(Date.now());
  const autoShowTimelineIntervalRef = useRef<number | null>(null);
  const autoShowTimelineTriggeredRef = useRef(false);

  const mainBodyRef = useRef<HTMLDivElement | null>(null);

  // today main panels tab (timeline / calendar / taskline / gantt / notes)
  const [todayMainTab, setTodayMainTab] = useState<TodayMainTab>(() => {
    if (typeof window === 'undefined') return 'timeline';
    try {
      const raw = window.localStorage.getItem('nippoTodayMainTab');
      return raw === 'calendar' || raw === 'taskline' || raw === 'gantt' || raw === 'alerts' || raw === 'timeline' || raw === 'notes' ? (raw as TodayMainTab) : 'timeline';
    } catch {
      return 'timeline';
    }
  });

  // `viewMode`（今日/履歴=カレンダー）はタイムライン内の表示モード。
  // タイムライン以外（カンバン/ガント/ノート）では独立して動けるように、
  // それらのUI/副作用では常に「今日」として扱う。
  const effectiveViewMode: 'today' | 'history' = todayMainTab === 'timeline' ? viewMode : 'today';

  useEffect(() => {
    if (typeof window === 'undefined') return;
    try {
      window.localStorage.setItem('nippoTodayMainTab', todayMainTab);
    } catch {
      // ignore
    }
  }, [todayMainTab]);

  // calendar: jump to current month trigger (double click on tab)
  const [calendarJumpNonce, setCalendarJumpNonce] = useState(0);

  // Auto show timeline tab after inactivity.
  useEffect(() => {
    if (typeof window === 'undefined') return;
    if (!accessToken) return;
    if (!settingsAutoShowTimelineOnIdle) return;

    const idleMs = 10 * 60 * 1000;

    autoShowTimelineLastActivityAtRef.current = Date.now();
    autoShowTimelineTriggeredRef.current = false;

    const markActivity = () => {
      autoShowTimelineLastActivityAtRef.current = Date.now();
      autoShowTimelineTriggeredRef.current = false;
    };

    const onVisibilityChange = () => {
      if (typeof document === 'undefined') return;
      if (document.visibilityState === 'visible') markActivity();
    };

    const onFocus = () => {
      markActivity();
    };

    const events: Array<keyof WindowEventMap> = ['pointerdown', 'keydown', 'wheel', 'touchstart'];
    for (const ev of events) {
      try {
        window.addEventListener(ev, markActivity, { passive: true });
      } catch {
        // ignore
      }
    }
    try {
      window.addEventListener('visibilitychange', onVisibilityChange);
      window.addEventListener('focus', onFocus);
    } catch {
      // ignore
    }

    const tick = () => {
      if (!settingsAutoShowTimelineOnIdle) return;
      if (settingsOpen) return;
      const elapsed = Date.now() - autoShowTimelineLastActivityAtRef.current;
      if (elapsed < idleMs) return;
      if (autoShowTimelineTriggeredRef.current) return;

      autoShowTimelineTriggeredRef.current = true;
      setTodayMainTab((prev) => (prev === 'timeline' ? prev : 'timeline'));
    };

    autoShowTimelineIntervalRef.current = window.setInterval(tick, 5_000);

    return () => {
      if (autoShowTimelineIntervalRef.current != null) {
        window.clearInterval(autoShowTimelineIntervalRef.current);
        autoShowTimelineIntervalRef.current = null;
      }
      for (const ev of events) {
        try {
          window.removeEventListener(ev, markActivity);
        } catch {
          // ignore
        }
      }
      try {
        window.removeEventListener('visibilitychange', onVisibilityChange);
        window.removeEventListener('focus', onFocus);
      } catch {
        // ignore
      }
    };
  }, [accessToken, settingsAutoShowTimelineOnIdle, settingsOpen]);

  // notice (above shortcut launcher)
  const NOTICE_KEY = 'nippoNotice';
  const [notice, setNotice] = useState<NoticeData>({ text: '', tone: 'default' });
  const [noticeModalOpen, setNoticeModalOpen] = useState(false);
  const [noticeModalText, setNoticeModalText] = useState('');
  const [noticeModalTone, setNoticeModalTone] = useState<NoticeTone>('default');
  const noticeLoadedFromServerRef = useRef(false);
  const noticeSaveTimerRef = useRef<number | null>(null);
  const noticeLastSavedSnapshotRef = useRef<string>('');
  const noticeIsSavingRef = useRef(false);
  const noticeServerUpdatedAtRef = useRef<string>('');
  const noticePollTimerRef = useRef<number | null>(null);

  function isNoticeTone(v: unknown): v is NoticeTone {
    return v === 'info' || v === 'danger' || v === 'success' || v === 'warning' || v === 'default';
  }

  function normalizeNotice(input: unknown): NoticeData {
    const obj = (input && typeof input === 'object' ? (input as any) : null) as any;
    const text = typeof obj?.text === 'string' ? String(obj.text) : '';
    const toneRaw = obj?.tone;
    const tone: NoticeTone = isNoticeTone(toneRaw) ? toneRaw : 'default';
    return { text, tone };
  }

  function noticeSnapshot(n: NoticeData) {
    try {
      return JSON.stringify({ text: String(n?.text || ''), tone: String(n?.tone || 'default') });
    } catch {
      return '';
    }
  }

  async function loadNoticeFromServer() {
    if (!accessToken) return;
    try {
      const res = await apiFetch('/api/notice', { cache: 'no-store' });
      const body = await res.json().catch(() => null);
      if (!res.ok || !body?.success) throw new Error(body?.error || 'お知らせの取得に失敗しました');
      const serverNotice = normalizeNotice(body?.notice);
      const serverUpdatedAt = typeof body?.notice?.updatedAt === 'string' ? String(body.notice.updatedAt) : '';
      noticeServerUpdatedAtRef.current = serverUpdatedAt;

      // Migration: if server is empty but local has content, upload local once.
      if (String(serverNotice.text || '').trim() === '' && String(notice.text || '').trim() !== '') {
        try {
          await apiFetch('/api/notice', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ notice, baseUpdatedAt: serverUpdatedAt || '' }),
          });
          noticeLoadedFromServerRef.current = true;
          noticeLastSavedSnapshotRef.current = noticeSnapshot(notice);
          return;
        } catch {
          // if upload fails, keep local
          noticeLoadedFromServerRef.current = true;
          noticeLastSavedSnapshotRef.current = noticeSnapshot(notice);
          return;
        }
      }

      noticeLoadedFromServerRef.current = true;
      noticeLastSavedSnapshotRef.current = noticeSnapshot(serverNotice);
      setNotice(serverNotice);
    } catch {
      // If server fails, fall back to local
      noticeLoadedFromServerRef.current = true;
      noticeLastSavedSnapshotRef.current = noticeSnapshot(notice);
    }
  }

  async function saveNoticeToServerNow(next: NoticeData) {
    if (!accessToken) return;
    if (noticeIsSavingRef.current) return;
    noticeIsSavingRef.current = true;
    try {
      const res = await apiFetch('/api/notice', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ notice: next, baseUpdatedAt: noticeServerUpdatedAtRef.current || '' }),
      });
      const body = await res.json().catch(() => null);

      if (res.status === 409 && body?.conflict) {
        const serverNotice = normalizeNotice(body?.notice);
        const serverUpdatedAt = typeof body?.notice?.updatedAt === 'string' ? String(body.notice.updatedAt) : '';
        noticeServerUpdatedAtRef.current = serverUpdatedAt;
        noticeLastSavedSnapshotRef.current = noticeSnapshot(serverNotice);
        // Prefer local; let debounced effect retry with new baseUpdatedAt
        return;
      }

      if (!res.ok || !body?.success) throw new Error(body?.error || 'お知らせの保存に失敗しました');
      const updatedAt = typeof body?.updatedAt === 'string' ? String(body.updatedAt) : '';
      if (updatedAt) noticeServerUpdatedAtRef.current = updatedAt;
      noticeLastSavedSnapshotRef.current = noticeSnapshot(next);
    } catch {
      // ignore (keep local)
    } finally {
      noticeIsSavingRef.current = false;
    }
  }

  useEffect(() => {
    if (typeof window === 'undefined') return;
    try {
      const raw = window.localStorage.getItem(NOTICE_KEY);
      if (!raw) return;
      const parsed = JSON.parse(raw);
      setNotice(normalizeNotice(parsed));
    } catch {
      // ignore
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    try {
      window.localStorage.setItem(NOTICE_KEY, JSON.stringify(notice));
    } catch {
      // ignore
    }

    if (!accessToken) return;
    if (!noticeLoadedFromServerRef.current) return;

    // Debounced server sync
    if (noticeSaveTimerRef.current != null) {
      window.clearTimeout(noticeSaveTimerRef.current);
      noticeSaveTimerRef.current = null;
    }
    const snap = noticeSnapshot(notice);
    if (snap && snap === noticeLastSavedSnapshotRef.current) return;
    noticeSaveTimerRef.current = window.setTimeout(() => {
      noticeSaveTimerRef.current = null;
      void saveNoticeToServerNow(notice);
    }, 800);
  }, [notice, accessToken]);

  useEffect(() => {
    if (!accessToken) return;
    void loadNoticeFromServer();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [accessToken]);

  useEffect(() => {
    if (!accessToken) {
      if (noticePollTimerRef.current != null) {
        window.clearInterval(noticePollTimerRef.current);
        noticePollTimerRef.current = null;
      }
      return;
    }

    if (noticePollTimerRef.current != null) {
      window.clearInterval(noticePollTimerRef.current);
      noticePollTimerRef.current = null;
    }

    noticePollTimerRef.current = window.setInterval(async () => {
      if (!accessToken) return;
      if (noticeModalOpen) return;
      try {
        const res = await apiFetch('/api/notice', { cache: 'no-store' });
        const body = await res.json().catch(() => null);
        if (!res.ok || !body?.success) return;
        const serverUpdatedAt = typeof body?.notice?.updatedAt === 'string' ? String(body.notice.updatedAt) : '';
        if (!serverUpdatedAt || serverUpdatedAt === noticeServerUpdatedAtRef.current) return;
        const serverNotice = normalizeNotice(body?.notice);
        const serverSnap = noticeSnapshot(serverNotice);
        const currentSnap = noticeSnapshot(notice);
        noticeServerUpdatedAtRef.current = serverUpdatedAt;
        noticeLastSavedSnapshotRef.current = serverSnap;
        if (serverSnap !== currentSnap) setNotice(serverNotice);
      } catch {
        // ignore
      }
    }, 15000);

    return () => {
      if (noticePollTimerRef.current != null) {
        window.clearInterval(noticePollTimerRef.current);
        noticePollTimerRef.current = null;
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [accessToken, notice, noticeModalOpen]);

  // shortcut launcher (above timeline / kanban / notes tabs)
  const SHORTCUTS_KEY = 'nippoShortcutLauncher';
  const [shortcuts, setShortcuts] = useState<ShortcutItem[]>([]);
  const [shortcutModalOpen, setShortcutModalOpen] = useState(false);
  const [shortcutModalUrl, setShortcutModalUrl] = useState('');
  const [shortcutModalError, setShortcutModalError] = useState<string | null>(null);
  const [shortcutModalSaving, setShortcutModalSaving] = useState(false);
  const shortcutModalInputRef = useRef<HTMLInputElement | null>(null);
  const [shortcutDraggingId, setShortcutDraggingId] = useState<string | null>(null);
  const [shortcutDragOverId, setShortcutDragOverId] = useState<string | null>(null);
  const shortcutsLoadedFromServerRef = useRef(false);
  const shortcutsSaveTimerRef = useRef<number | null>(null);
  const shortcutsLastSavedSnapshotRef = useRef<string>('');
  const shortcutsIsSavingRef = useRef(false);
  const shortcutsServerUpdatedAtRef = useRef<string>('');
  const shortcutsPollTimerRef = useRef<number | null>(null);

  function normalizeShortcutUrl(input: string) {
    const raw = String(input || '').trim();
    if (!raw) return '';
    const withScheme = /^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(raw) ? raw : `https://${raw}`;
    try {
      const u = new URL(withScheme);
      if (u.protocol !== 'http:' && u.protocol !== 'https:') return '';
      return u.toString();
    } catch {
      return '';
    }
  }

  function shortcutId() {
    return `sc_${Math.random().toString(16).slice(2)}_${Date.now().toString(16)}`;
  }

  function moveShortcutByDrop(sourceId: string, targetId: string | null) {
    setShortcuts((prev) => {
      const list = Array.isArray(prev) ? [...prev] : [];
      const from = list.findIndex((s) => s.id === sourceId);
      if (from < 0) return prev;
      const [item] = list.splice(from, 1);

      if (!targetId) {
        list.push(item);
        return list;
      }

      const to = list.findIndex((s) => s.id === targetId);
      if (to < 0) {
        list.push(item);
        return list;
      }
      list.splice(to, 0, item);
      return list;
    });
  }

  function closeShortcutModal() {
    setShortcutModalOpen(false);
    setShortcutModalError(null);
    setShortcutModalUrl('');
    setShortcutModalSaving(false);
  }

  async function saveShortcutFromModal() {
    if (shortcutModalSaving) return;
    const normalized = normalizeShortcutUrl(shortcutModalUrl);
    if (!normalized) {
      setShortcutModalError('URLが不正です（http/httpsのみ）');
      return;
    }

    const normalizedKey = normalized.replace(/\/$/, '');
    const dup = shortcuts.some((s) => String(s.url || '').replace(/\/$/, '') === normalizedKey);
    if (dup) {
      setShortcutModalError('このURLは既に登録されています');
      return;
    }

    setShortcutModalSaving(true);
    setShortcutModalError(null);
    try {
      // Hash is not sent to servers; remove for metadata fetch to reduce redirect noise.
      const metaTarget = new URL(normalized);
      metaTarget.hash = '';

      let title = '';
      let iconUrl = '';
      let finalUrl = normalized;

      try {
        const res = await apiFetch(`/api/url-metadata?url=${encodeURIComponent(metaTarget.toString())}`);
        const body = await res.json().catch(() => null);
        if (res.ok && body?.success) {
          title = typeof body?.title === 'string' ? String(body.title) : '';
          iconUrl = typeof body?.iconUrl === 'string' ? String(body.iconUrl) : '';
          finalUrl = typeof body?.finalUrl === 'string' ? String(body.finalUrl) : normalized;
        }
      } catch {
        // ignore metadata fetch errors; fallback below
      }

      // Fallback: always allow registration even if metadata fetch failed.
      const u = new URL(normalized);
      const fallbackTitle = u.hostname;
      const fallbackIcon = `${u.protocol}//${u.host}/favicon.ico`;

      const item: ShortcutItem = {
        id: shortcutId(),
        url: finalUrl || normalized,
        title: (title || fallbackTitle || normalized).slice(0, 200),
        iconUrl: iconUrl || fallbackIcon,
        createdAt: now.toISOString(),
      };

      setShortcuts((prev) => [...(Array.isArray(prev) ? prev : []), item]);
      closeShortcutModal();
    } catch (e: any) {
      setShortcutModalError('登録に失敗しました');
      setShortcutModalSaving(false);
    }
  }

  function normalizeShortcuts(input: unknown): ShortcutItem[] {
    const list = Array.isArray(input) ? input : [];
    const out: ShortcutItem[] = [];
    for (const item of list as any[]) {
      const id = typeof item?.id === 'string' ? String(item.id) : '';
      const url = typeof item?.url === 'string' ? String(item.url) : '';
      const title = typeof item?.title === 'string' ? String(item.title) : '';
      const iconUrl = typeof item?.iconUrl === 'string' ? String(item.iconUrl) : '';
      const createdAt = typeof item?.createdAt === 'string' ? String(item.createdAt) : '';
      if (!id || !url) continue;
      out.push({ id, url, title, iconUrl, createdAt });
    }
    return out;
  }

  function shortcutsSnapshot(items: ShortcutItem[]) {
    try {
      return JSON.stringify(
        (Array.isArray(items) ? items : []).map((s) => ({
          id: s.id,
          url: s.url,
          title: s.title,
          iconUrl: s.iconUrl,
          createdAt: s.createdAt,
        }))
      );
    } catch {
      return '';
    }
  }

  function mergeShortcutsPreferLocal(localItems: ShortcutItem[], serverItems: ShortcutItem[]) {
    const localMap = new Map<string, ShortcutItem>();
    for (const s of Array.isArray(localItems) ? localItems : []) {
      if (s?.id) localMap.set(s.id, s);
    }

    const seen = new Set<string>();
    const out: ShortcutItem[] = [];

    // Keep server order, but prefer local content if same id exists.
    for (const s of Array.isArray(serverItems) ? serverItems : []) {
      const id = s?.id;
      if (!id || seen.has(id)) continue;
      seen.add(id);
      out.push(localMap.get(id) ?? s);
    }

    // Append local-only items (prevents accidental loss on conflict).
    for (const s of Array.isArray(localItems) ? localItems : []) {
      const id = s?.id;
      if (!id || seen.has(id)) continue;
      seen.add(id);
      out.push(s);
    }

    return out;
  }

  async function loadShortcutsFromServer() {
    if (!accessToken) return;
    try {
      const res = await apiFetch('/api/shortcuts', { cache: 'no-store' });
      const body = await res.json().catch(() => null);
      if (!res.ok || !body?.success) throw new Error(body?.error || 'ショートカットの取得に失敗しました');

      const serverItems = normalizeShortcuts(body?.shortcuts?.items);
      const serverUpdatedAt = typeof body?.shortcuts?.updatedAt === 'string' ? String(body.shortcuts.updatedAt) : '';
      shortcutsServerUpdatedAtRef.current = serverUpdatedAt;

      // Migration: if server is empty but local has items, upload local once.
      if (serverItems.length === 0 && (Array.isArray(shortcuts) ? shortcuts.length : 0) > 0) {
        try {
          await apiFetch('/api/shortcuts', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ items: Array.isArray(shortcuts) ? shortcuts : [] }),
          });
          shortcutsLoadedFromServerRef.current = true;
          shortcutsLastSavedSnapshotRef.current = shortcutsSnapshot(Array.isArray(shortcuts) ? shortcuts : []);
          return;
        } catch {
          // if upload fails, keep local
          shortcutsLoadedFromServerRef.current = true;
          shortcutsLastSavedSnapshotRef.current = shortcutsSnapshot(Array.isArray(shortcuts) ? shortcuts : []);
          return;
        }
      }

      shortcutsLoadedFromServerRef.current = true;
      shortcutsLastSavedSnapshotRef.current = shortcutsSnapshot(serverItems);
      setShortcuts(serverItems);
    } catch {
      // If server fails, fall back to local
      shortcutsLoadedFromServerRef.current = true;
      shortcutsLastSavedSnapshotRef.current = shortcutsSnapshot(Array.isArray(shortcuts) ? shortcuts : []);
    }
  }

  async function saveShortcutsToServerNow(items: ShortcutItem[]) {
    if (!accessToken) return;
    if (shortcutsIsSavingRef.current) return;
    shortcutsIsSavingRef.current = true;
    try {
      const res = await apiFetch('/api/shortcuts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ items: Array.isArray(items) ? items : [], baseUpdatedAt: shortcutsServerUpdatedAtRef.current || '' }),
      });
      const body = await res.json().catch(() => null);

      if (res.status === 409 && body?.conflict) {
        const serverItems = normalizeShortcuts(body?.shortcuts?.items);
        const serverUpdatedAt = typeof body?.shortcuts?.updatedAt === 'string' ? String(body.shortcuts.updatedAt) : '';
        const merged = mergeShortcutsPreferLocal(Array.isArray(items) ? items : [], serverItems);

        shortcutsServerUpdatedAtRef.current = serverUpdatedAt;
        shortcutsLastSavedSnapshotRef.current = shortcutsSnapshot(serverItems);
        setShortcuts(merged);
        // Let debounced effect save merged state with new baseUpdatedAt
        return;
      }

      if (!res.ok || !body?.success) throw new Error(body?.error || 'ショートカットの保存に失敗しました');
      const updatedAt = typeof body?.updatedAt === 'string' ? String(body.updatedAt) : '';
      if (updatedAt) shortcutsServerUpdatedAtRef.current = updatedAt;
      shortcutsLastSavedSnapshotRef.current = shortcutsSnapshot(items);
    } catch {
      // ignore (keep local)
    } finally {
      shortcutsIsSavingRef.current = false;
    }
  }

  useEffect(() => {
    if (typeof window === 'undefined') return;
    try {
      const raw = window.localStorage.getItem(SHORTCUTS_KEY);
      if (!raw) return;
      const parsed = JSON.parse(raw);
      setShortcuts(normalizeShortcuts(parsed));
    } catch {
      // ignore
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    try {
      window.localStorage.setItem(SHORTCUTS_KEY, JSON.stringify(Array.isArray(shortcuts) ? shortcuts : []));
    } catch {
      // ignore
    }

    if (!accessToken) return;
    if (!shortcutsLoadedFromServerRef.current) return;

    // Debounced server sync
    if (shortcutsSaveTimerRef.current != null) {
      window.clearTimeout(shortcutsSaveTimerRef.current);
      shortcutsSaveTimerRef.current = null;
    }
    const next = Array.isArray(shortcuts) ? shortcuts : [];
    const snap = shortcutsSnapshot(next);
    if (snap && snap === shortcutsLastSavedSnapshotRef.current) return;
    shortcutsSaveTimerRef.current = window.setTimeout(() => {
      shortcutsSaveTimerRef.current = null;
      void saveShortcutsToServerNow(next);
    }, 800);
  }, [shortcuts]);

  useEffect(() => {
    if (!accessToken) return;
    void loadShortcutsFromServer();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [accessToken]);

  useEffect(() => {
    if (!accessToken) {
      if (shortcutsPollTimerRef.current != null) {
        window.clearInterval(shortcutsPollTimerRef.current);
        shortcutsPollTimerRef.current = null;
      }
      return;
    }

    // Poll to pick up updates from other devices.
    if (shortcutsPollTimerRef.current != null) {
      window.clearInterval(shortcutsPollTimerRef.current);
      shortcutsPollTimerRef.current = null;
    }

    shortcutsPollTimerRef.current = window.setInterval(async () => {
      if (!accessToken) return;
      if (shortcutDraggingId) return;
      try {
        const res = await apiFetch('/api/shortcuts', { cache: 'no-store' });
        const body = await res.json().catch(() => null);
        if (!res.ok || !body?.success) return;
        const serverUpdatedAt = typeof body?.shortcuts?.updatedAt === 'string' ? String(body.shortcuts.updatedAt) : '';
        if (!serverUpdatedAt || serverUpdatedAt === shortcutsServerUpdatedAtRef.current) return;
        const serverItems = normalizeShortcuts(body?.shortcuts?.items);
        const merged = mergeShortcutsPreferLocal(Array.isArray(shortcuts) ? shortcuts : [], serverItems);
        const mergedSnap = shortcutsSnapshot(merged);
        const currentSnap = shortcutsSnapshot(Array.isArray(shortcuts) ? shortcuts : []);
        shortcutsServerUpdatedAtRef.current = serverUpdatedAt;
        shortcutsLastSavedSnapshotRef.current = shortcutsSnapshot(serverItems);
        if (mergedSnap !== currentSnap) setShortcuts(merged);
      } catch {
        // ignore
      }
    }, 15000);

    return () => {
      if (shortcutsPollTimerRef.current != null) {
        window.clearInterval(shortcutsPollTimerRef.current);
        shortcutsPollTimerRef.current = null;
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [accessToken, shortcutDraggingId, shortcuts]);

  useEffect(() => {
    if (!shortcutModalOpen) return;
    const t = window.setTimeout(() => {
      shortcutModalInputRef.current?.focus();
      shortcutModalInputRef.current?.select();
    }, 0);
    return () => window.clearTimeout(t);
  }, [shortcutModalOpen]);

  // NOTE: 以前は履歴（カレンダー）中にタイムラインタブへ固定していたが、
  // タブは独立した機能なので固定しない（必要ならユーザーが戻る）。

  // task line (sticky notes) - horizontal, reorderable (synced via Supabase)
  // NOTE: タスクラインは日付ごとの管理ではなく「常に同じ内容」を表示する
  const TASK_LINE_GLOBAL_KEY = 'global';
  const [taskLineCards, setTaskLineCards] = useState<TaskLineCard[]>([]);
  const [taskLineInput, setTaskLineInput] = useState('');
  const [taskLineEditingId, setTaskLineEditingId] = useState<string | null>(null);
  const [taskLineLoadedDateKey, setTaskLineLoadedDateKey] = useState<string | null>(null);
  const [taskLineLoading, setTaskLineLoading] = useState(false);
  const [taskLineSaving, setTaskLineSaving] = useState(false);
  const [taskLineDirty, setTaskLineDirty] = useState(false);
  const [taskLineRemoteUpdatePending, setTaskLineRemoteUpdatePending] = useState(false);
  const [taskLineError, setTaskLineError] = useState<string | null>(null);
  const [taskLineDraggingId, setTaskLineDraggingId] = useState<string | null>(null);
  const [taskLineDraggingIds, setTaskLineDraggingIds] = useState<string[]>([]);
  const [taskLineSelectedCardIds, setTaskLineSelectedCardIds] = useState<string[]>([]);
  const taskLineLastDragAtRef = useRef(0);
  const taskLineDragJustEndedAtRef = useRef(0);
  const taskLineLastPreviewRef = useRef<{ dragId: string; lane: TaskLineLane; index: number } | null>(null);
  const taskLineBoardRef = useRef<HTMLDivElement | null>(null);
  const taskLineLastAutoScrollAtRef = useRef(0);
  const taskLineSaveTimerRef = useRef<number | null>(null);
  const taskLineLastSavedSnapshotRef = useRef<string>('');
  const taskLineIsSavingRef = useRef(false);

  const taskLineSelectedCardSet = useMemo(() => new Set(taskLineSelectedCardIds), [taskLineSelectedCardIds]);
  const taskLineDraggingCardSet = useMemo(() => new Set(taskLineDraggingIds), [taskLineDraggingIds]);

  type TaskLinePointerDragState = {
    pointerId: number;
    dragId: string;
    dragIds: string[];
    startClientX: number;
    startClientY: number;
    didDrag: boolean;
  };
  const taskLinePointerDragRef = useRef<TaskLinePointerDragState | null>(null);

  type TaskLineSelectRectState = {
    pointerId: number;
    startX: number;
    startY: number;
  };
  const taskLineSelectingRef = useRef<TaskLineSelectRectState | null>(null);
  const [taskLineSelectRect, setTaskLineSelectRect] = useState<null | { x: number; y: number; w: number; h: number }>(null);

  // task line edit modal (common edit-dialog spec)
  const [taskLineModalOpen, setTaskLineModalOpen] = useState(false);
  const [taskLineModalCardId, setTaskLineModalCardId] = useState<string | null>(null);
  const [taskLineModalInitialText, setTaskLineModalInitialText] = useState('');
  const [taskLineModalInitialWeekday, setTaskLineModalInitialWeekday] = useState<TaskLineWeekday | ''>('');

  // gantt (roadmap) - lanes + draggable/resizable bars (synced via Supabase)
  const GANTT_GLOBAL_KEY = 'global';
  const [ganttLanes, setGanttLanes] = useState<GanttLane[]>([]);
  const [ganttTasks, setGanttTasks] = useState<GanttTask[]>([]);
  const [ganttLoading, setGanttLoading] = useState(false);
  const [ganttSaving, setGanttSaving] = useState(false);
  const [ganttDirty, setGanttDirty] = useState(false);
  const [ganttRemoteUpdatePending, setGanttRemoteUpdatePending] = useState(false);
  const [ganttError, setGanttError] = useState<string | null>(null);
  const ganttSaveTimerRef = useRef<number | null>(null);
  const ganttLastSavedSnapshotRef = useRef<string>('');
  const ganttIsSavingRef = useRef(false);
  const ganttIsInteractingRef = useRef(false);

  // calendar (events) - all-day + time events (synced via Supabase)
  const CALENDAR_GLOBAL_KEY = 'global';
  const [calendarEvents, setCalendarEvents] = useState<CalendarEvent[]>([]);
  const [calendarLoading, setCalendarLoading] = useState(false);
  const [calendarSaving, setCalendarSaving] = useState(false);
  const [calendarDirty, setCalendarDirty] = useState(false);
  const [calendarRemoteUpdatePending, setCalendarRemoteUpdatePending] = useState(false);
  const [calendarError, setCalendarError] = useState<string | null>(null);
  const calendarSaveTimerRef = useRef<number | null>(null);
  const calendarLastSavedSnapshotRef = useRef<string>('');
  const calendarIsSavingRef = useRef(false);
  const calendarIsInteractingRef = useRef(false);
  const calendarEditingIdRef = useRef<string | null>(null);
  const [calendarIsInteracting, setCalendarIsInteracting] = useState(false);
  const [calendarEditingId, setCalendarEditingId] = useState<string | null>(null);
  const calendarInteractionLastRef = useRef<{ active: boolean; editingId: string | null }>({ active: false, editingId: null });

  // alerts (one-shot / weekly / monthly) - synced via Supabase
  const ALERTS_GLOBAL_KEY = 'global';
  const [alerts, setAlerts] = useState<AlertItem[]>([]);
  const [alertsLoading, setAlertsLoading] = useState(false);
  const [alertsSaving, setAlertsSaving] = useState(false);
  const [alertsDirty, setAlertsDirty] = useState(false);
  const [alertsRemoteUpdatePending, setAlertsRemoteUpdatePending] = useState(false);
  const [alertsError, setAlertsError] = useState<string | null>(null);
  const alertsSaveTimerRef = useRef<number | null>(null);
  const alertsLastSavedSnapshotRef = useRef<string>('');
  const alertsIsSavingRef = useRef(false);
  const alertsExecutorTimerRef = useRef<number | null>(null);
  const alertsDueCheckIntervalRef = useRef<number | null>(null);
  const alertsRef = useRef<AlertItem[]>([]);

  const [alertModalOpen, setAlertModalOpen] = useState(false);
  const [alertEditingId, setAlertEditingId] = useState<string | null>(null);
  const [alertDraft, setAlertDraft] = useState<AlertItem | null>(null);
  const [alertMonthlyDayPickerOpen, setAlertMonthlyDayPickerOpen] = useState(false);
  const alertMonthlyDayPickerRef = useRef<HTMLDivElement | null>(null);
  const alertMonthlyDayPopoverRef = useRef<HTMLDivElement | null>(null);
  const [alertMonthlyDayPopoverPos, setAlertMonthlyDayPopoverPos] = useState<{ top: number; left: number } | null>(null);

  useEffect(() => {
    if (!alertModalOpen) {
      setAlertMonthlyDayPickerOpen(false);
      return;
    }
    if (alertDraft?.kind !== 'monthly') {
      setAlertMonthlyDayPickerOpen(false);
    }
  }, [alertModalOpen, alertDraft?.kind]);

  useEffect(() => {
    if (!alertMonthlyDayPickerOpen) return;

    const updatePos = () => {
      const root = alertMonthlyDayPickerRef.current;
      if (!root) return;
      const anchor = (root.querySelector('.alerts-day-picker-btn') as HTMLElement | null) ?? root;
      const rect = anchor.getBoundingClientRect();

      const popoverWidth = Math.min(360, Math.max(0, (typeof window !== 'undefined' ? window.innerWidth : 360) - 24));
      const estimatedHeight = 240; // 5 rows of days + padding

      const vw = typeof window !== 'undefined' ? window.innerWidth : 0;
      const vh = typeof window !== 'undefined' ? window.innerHeight : 0;

      let left = rect.left;
      if (vw) left = Math.max(12, Math.min(left, vw - 12 - popoverWidth));

      let top = rect.bottom + 8;
      if (vh && top + estimatedHeight > vh - 12) {
        top = Math.max(12, rect.top - 8 - estimatedHeight);
      }

      setAlertMonthlyDayPopoverPos({ top, left });
    };

    updatePos();

    // Keep position in sync when any scrollable container moves.
    document.addEventListener('scroll', updatePos, true);
    window.addEventListener('resize', updatePos);

    const onMouseDown = (ev: MouseEvent) => {
      const root = alertMonthlyDayPickerRef.current;
      const pop = alertMonthlyDayPopoverRef.current;
      if (ev.target instanceof Node) {
        if (root && root.contains(ev.target)) return;
        if (pop && pop.contains(ev.target)) return;
        setAlertMonthlyDayPickerOpen(false);
      }
    };

    const onKeyDown = (ev: KeyboardEvent) => {
      if (ev.key === 'Escape') setAlertMonthlyDayPickerOpen(false);
    };

    document.addEventListener('mousedown', onMouseDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('scroll', updatePos, true);
      window.removeEventListener('resize', updatePos);
      document.removeEventListener('mousedown', onMouseDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [alertMonthlyDayPickerOpen]);

  useEffect(() => {
    alertsRef.current = Array.isArray(alerts) ? alerts : [];
  }, [alerts]);

  function alertsSnapshot(list: AlertItem[]) {
    try {
      return JSON.stringify(
        (Array.isArray(list) ? list : []).map((a) => ({
          id: a.id,
          title: a.title,
          kind: a.kind,
          onceAt: a.onceAt || '',
          time: a.time || '',
          weeklyDays: Array.isArray(a.weeklyDays) ? a.weeklyDays.slice() : [],
          monthlyDay: a.monthlyDay ?? null,
          lastFiredAt: a.lastFiredAt || '',
          skipUntil: a.skipUntil || '',
          nextFireAt: a.nextFireAt || '',
        }))
      );
    } catch {
      return '';
    }
  }

  async function loadAlertsFromServer() {
    if (!accessToken) return;
    setAlertsLoading(true);
    setAlertsError(null);
    try {
      const res = await apiFetch('/api/alerts', { cache: 'no-store' });
      const body = await res.json().catch(() => null as any);
      if (!res.ok || !body?.success) throw new Error(body?.error || 'アラートの取得に失敗しました');
      const remote = normalizeAlerts(body?.alerts?.alerts, activeTimeZone, nowMs);
      setAlerts(remote);
      alertsLastSavedSnapshotRef.current = alertsSnapshot(remote);
      setAlertsDirty(false);
      setAlertsRemoteUpdatePending(false);
    } catch (e: any) {
      setAlertsError(e?.message || String(e));
      setAlerts([]);
      alertsLastSavedSnapshotRef.current = '';
      setAlertsDirty(false);
    } finally {
      setAlertsLoading(false);
    }
  }

  async function saveAlertsToServer(list: AlertItem[], snapshotOverride?: string) {
    if (!accessToken) return;
    if (alertsIsSavingRef.current) return;
    alertsIsSavingRef.current = true;
    setAlertsSaving(true);
    setAlertsError(null);
    try {
      const snapshot = snapshotOverride ?? alertsSnapshot(list);
      const res = await apiFetch('/api/alerts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ alerts: list }),
      });
      const body = await res.json().catch(() => null as any);
      if (!res.ok || !body?.success) throw new Error(body?.error || 'アラートの保存に失敗しました');
      alertsLastSavedSnapshotRef.current = snapshot;
      setAlertsDirty(false);
      setAlertsRemoteUpdatePending(false);
    } catch (e: any) {
      setAlertsError(e?.message || String(e));
    } finally {
      setAlertsSaving(false);
      alertsIsSavingRef.current = false;
    }
  }

  useEffect(() => {
    if (!accessToken) {
      setAlerts([]);
      setAlertsDirty(false);
      setAlertsRemoteUpdatePending(false);
      setAlertsError(null);
      alertsLastSavedSnapshotRef.current = '';
      return;
    }
    void loadAlertsFromServer();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [accessToken]);

  useEffect(() => {
    if (!accessToken) return;
    if (!alertsDirty) return;
    if (alertsIsSavingRef.current) return;
    if (alertModalOpen) return;

    try {
      if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return;
    } catch {
      // ignore
    }
    try {
      if (typeof navigator !== 'undefined' && 'onLine' in navigator && !navigator.onLine) return;
    } catch {
      // ignore
    }

    const snapshot = alertsSnapshot(alerts);
    if (snapshot && snapshot === alertsLastSavedSnapshotRef.current) {
      setAlertsDirty(false);
      return;
    }

    if (alertsSaveTimerRef.current) window.clearTimeout(alertsSaveTimerRef.current);
    alertsSaveTimerRef.current = window.setTimeout(() => {
      void saveAlertsToServer(alerts, snapshot);
    }, 700);

    return () => {
      if (alertsSaveTimerRef.current) window.clearTimeout(alertsSaveTimerRef.current);
      alertsSaveTimerRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [alerts, alertsDirty, alertModalOpen, accessToken]);

  function openNewAlertModal() {
    const id = safeRandomId('alert');
    const base: AlertItem = {
      id,
      title: '',
      kind: 'once',
      onceAt: new Date(nowMs + 5 * 60 * 1000).toISOString(),
      weeklyDays: [1, 2, 3, 4, 5],
      time: '09:00',
      monthlyDay: 1,
      lastFiredAt: '',
      skipUntil: '',
      nextFireAt: '',
    };
    const next = normalizeAlertItem(base as any, id, activeTimeZone, nowMs);
    // タイトルは空欄がデフォルト（保存時にデフォルト名へ補完）
    next.title = '';
    setAlertEditingId(null);
    setAlertDraft(next);
    setAlertModalOpen(true);
  }

  function openEditAlertModal(alertId: string) {
    const id = String(alertId || '');
    const found = (Array.isArray(alerts) ? alerts : []).find((a) => a.id === id) ?? null;
    if (!found) return;
    setAlertEditingId(id);
    setAlertDraft({ ...found });
    setAlertModalOpen(true);
  }

  function closeAlertModal() {
    setAlertModalOpen(false);
    setAlertEditingId(null);
    setAlertDraft(null);
  }

  function upsertAlertFromDraft(draft: AlertItem) {
    const effectiveTitle = String(draft.title || '').trim() ? String(draft.title) : getAlertDefaultTitle(draft.kind);
    const normalized = normalizeAlertItem(
      { ...(draft as any), title: effectiveTitle } as any,
      draft.id || safeRandomId('alert'),
      activeTimeZone,
      nowMs
    );
    normalized.nextFireAt = computeNextFireAt(normalized, getAlertComputeBase(normalized, now), activeTimeZone);

    setAlerts((prev) => {
      const list = Array.isArray(prev) ? prev.slice() : [];
      const idx = list.findIndex((a) => a.id === normalized.id);
      if (idx >= 0) list[idx] = normalized;
      else list.push(normalized);
      return list;
    });
    setAlertsDirty(true);
    setAlertsRemoteUpdatePending(false);
  }

  function upsertAlertFromDraftAndSync(draft: AlertItem) {
    const effectiveTitle = String(draft.title || '').trim() ? String(draft.title) : getAlertDefaultTitle(draft.kind);
    const normalized = normalizeAlertItem(
      { ...(draft as any), title: effectiveTitle } as any,
      draft.id || safeRandomId('alert'),
      activeTimeZone,
      nowMs
    );
    normalized.nextFireAt = computeNextFireAt(normalized, getAlertComputeBase(normalized, now), activeTimeZone);

    const base = Array.isArray(alertsRef.current) ? alertsRef.current : Array.isArray(alerts) ? alerts : [];
    const list = base.slice();
    const idx = list.findIndex((a) => a.id === normalized.id);
    if (idx >= 0) list[idx] = normalized;
    else list.push(normalized);

    // Keep refs in sync to avoid race with effects.
    alertsRef.current = list;
    setAlerts(list);
    setAlertsDirty(true);
    setAlertsRemoteUpdatePending(false);

    try {
      if (alertsSaveTimerRef.current) window.clearTimeout(alertsSaveTimerRef.current);
    } catch {
      // ignore
    }
    alertsSaveTimerRef.current = null;

    const snap = alertsSnapshot(list);
    void saveAlertsToServer(list, snap);
  }

  function deleteAlert(alertId: string) {
    const id = String(alertId || '');
    if (!id) return;
    setAlerts((prev) => (Array.isArray(prev) ? prev.filter((a) => a.id !== id) : prev));
    setAlertsDirty(true);
    setAlertsRemoteUpdatePending(false);
  }

  function deleteAlertAndSync(alertId: string) {
    const id = String(alertId || '');
    if (!id) return;
    const base = Array.isArray(alertsRef.current) ? alertsRef.current : Array.isArray(alerts) ? alerts : [];
    const list = base.filter((a) => a.id !== id);
    alertsRef.current = list;
    setAlerts(list);
    setAlertsDirty(true);
    setAlertsRemoteUpdatePending(false);

    try {
      if (alertsSaveTimerRef.current) window.clearTimeout(alertsSaveTimerRef.current);
    } catch {
      // ignore
    }
    alertsSaveTimerRef.current = null;

    const snap = alertsSnapshot(list);
    void saveAlertsToServer(list, snap);
  }

  const alertsAvailable = reservationNotificationPermission === 'granted';

  useEffect(() => {
    if (todayMainTab !== 'alerts') return;
    if (alertsAvailable) return;
    setTodayMainTab('gantt');
  }, [todayMainTab, alertsAvailable]);

  // alerts executor (only while app is open)
  useEffect(() => {
    const clearTimer = () => {
      if (alertsExecutorTimerRef.current != null) {
        window.clearTimeout(alertsExecutorTimerRef.current);
        alertsExecutorTimerRef.current = null;
      }
    };

    clearTimer();

    if (!accessToken) return;
    if (!alertsAvailable) return;

    const getNextFireAtForExecutor = (a: AlertItem, now: Date, tz: string) => {
      const stored = String(a.nextFireAt || '').trim();
      const storedMs = Date.parse(stored);
      if (stored && Number.isFinite(storedMs)) return { iso: stored, ms: storedMs };
      const computed = computeNextFireAt(a, getAlertComputeBase(a, now), tz);
      const computedMs = Date.parse(String(computed || ''));
      return { iso: computed, ms: computedMs };
    };

    const getCurrentAlertsForExecutor = (nowMs: number, tz: string) => {
      const list = Array.isArray(alertsRef.current) ? alertsRef.current : [];
      return list
        .map((raw) => {
          const fallbackId = raw?.id || safeRandomId('alert');
          const normalized = normalizeAlertItem(raw as any, String(fallbackId), tz, nowMs);
          // Preserve stored nextFireAt so overdue instances can be detected.
          const stored = typeof (raw as any)?.nextFireAt === 'string' ? String((raw as any).nextFireAt) : '';
          if (Number.isFinite(Date.parse(stored))) normalized.nextFireAt = stored;
          return normalized;
        })
        .filter((a) => !!a && !!a.id);
    };

    const scheduleNext = () => {
      clearTimer();

      // Use real wall-clock time. React-driven `nowMs` can be throttled/suspended in background tabs.
      const nowMs = Date.now();
      const now = new Date(nowMs);
      const tz = activeTimeZoneRef.current;
      const list = getCurrentAlertsForExecutor(nowMs, tz);

      const candidates = list
        .map((a) => ({ a, ...getNextFireAtForExecutor(a, now, tz) }))
        .filter((x) => Number.isFinite(x.ms))
        .sort((x, y) => x.ms - y.ms || String(x.a.id).localeCompare(String(y.a.id)));

      if (candidates.length === 0) return;

      const head = candidates[0];
      const delay = Math.max(0, head.ms - now.getTime());
      alertsExecutorTimerRef.current = window.setTimeout(fire, Math.min(delay, 2_147_000_000));
    };

    const fire = async () => {
      // Use real wall-clock time. React-driven `nowMs` can be throttled/suspended in background tabs.
      const nowMs = Date.now();
      const now = new Date(nowMs);
      const tz = activeTimeZoneRef.current;
      const current = getCurrentAlertsForExecutor(nowMs, tz);
      const due = current
        .filter((a) => {
          const { ms } = getNextFireAtForExecutor(a, now, tz);
          return Number.isFinite(ms) && ms <= nowMs;
        })
        .sort((x, y) => {
          const xm = Date.parse(String(x.nextFireAt || ''));
          const ym = Date.parse(String(y.nextFireAt || ''));
          if (Number.isFinite(xm) && Number.isFinite(ym) && xm !== ym) return xm - ym;
          return String(x.id).localeCompare(String(y.id));
        });

      if (due.length === 0) {
        // Timer can fire slightly early; ensure we keep scheduling.
        scheduleNext();
        return;
      }

      // 起動時など「超過分が複数」ある場合は、通知を1回にまとめる
      const canNotify = typeof Notification !== 'undefined' && Notification.permission === 'granted';
      if (canNotify) {
        try {
          if (due.length === 1) {
            const a = due[0];
            new Notification(String(a.title || 'アラート'), { body: '時間になりました', silent: false });
          } else {
            const titles = due
              .map((a) => String(a.title || '（無題）').trim())
              .filter(Boolean)
              .slice(0, 3);
            const suffix = due.length > titles.length ? ` ほか${due.length - titles.length}件` : '';
            const body = titles.length ? `${titles.join(' / ')}${suffix}` : `${due.length}件のアラート`;
            new Notification('アラート（期限超過）', { body, silent: false });
          }
        } catch {
          // ignore
        }
      }

      // In-app floating notice (always, regardless of Notification permission)
      try {
        if (due.length === 1) {
          const a = due[0];
          const title = String(a.title || 'アラート').trim() || 'アラート';
          floating?.push({ text: `${title}：時間になりました`, tone: 'info', icon: 'notifications', ttlMs: 6000 });
        } else {
          const titles = due
            .map((a) => String(a.title || '（無題）').trim())
            .filter(Boolean)
            .slice(0, 3);
          const suffix = due.length > titles.length ? ` ほか${due.length - titles.length}件` : '';
          const body = titles.length ? `${titles.join(' / ')}${suffix}` : `${due.length}件のアラート`;
          floating?.push({ text: `アラート：${body}`, tone: 'info', icon: 'notifications', ttlMs: 6000 });
        }
      } catch {
        // ignore
      }

      const bumpedBase = new Date(nowMs + 60 * 1000);
      const dueIds = new Set(due.map((d) => d.id));
      const updated = current
        .map((a) => {
          if (!dueIds.has(a.id)) return a;

          // 「完了したら消失」
          // - 単発: 役目を終えたら削除
          // - 繰り返し: 過去分は残さず、次回分へ更新
          if (a.kind === 'once') return null;

          const next: AlertItem = { ...a, lastFiredAt: now.toISOString(), skipUntil: '' };
          next.nextFireAt = computeNextFireAt(next, bumpedBase, activeTimeZone);
          return next;
        })
        .filter((x): x is AlertItem => !!x);

      // Keep refs in sync so we can schedule immediately without waiting for state effects.
      alertsRef.current = updated;
      setAlerts(updated);
      setAlertsDirty(true);
      setAlertsRemoteUpdatePending(false);

      // Save promptly (to sync to other devices)
      const snap = alertsSnapshot(updated);
      void saveAlertsToServer(updated, snap);

      // Ensure we always have a next timer even if the environment throttled/dropped long timeouts.
      scheduleNext();
    };

    const onVisibleOrFocus = () => {
      // Catch-up immediately when the app becomes active again.
      void fire();
    };

    scheduleNext();

    // Some browsers throttle/suspend long timers in background tabs.
    // Polling while visible makes weekly/monthly alerts more reliable.
    try {
      if (alertsDueCheckIntervalRef.current != null) window.clearInterval(alertsDueCheckIntervalRef.current);
      alertsDueCheckIntervalRef.current = window.setInterval(() => {
        void fire();
      }, 30_000);
    } catch {
      // ignore
    }

    window.addEventListener('focus', onVisibleOrFocus);
    document.addEventListener('visibilitychange', onVisibleOrFocus);

    return () => {
      clearTimer();
      if (alertsDueCheckIntervalRef.current != null) {
        try {
          window.clearInterval(alertsDueCheckIntervalRef.current);
        } catch {
          // ignore
        }
        alertsDueCheckIntervalRef.current = null;
      }
      window.removeEventListener('focus', onVisibleOrFocus);
      document.removeEventListener('visibilitychange', onVisibleOrFocus);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [accessToken, alerts, alertsAvailable, activeTimeZone]);

  const [ganttDrawerOpen, setGanttDrawerOpen] = useState(false);
  const [ganttSelectedTaskId, setGanttSelectedTaskId] = useState<string | null>(null);
  const [ganttEditingId, setGanttEditingId] = useState<string | null>(null);

  const [ganttBulkDeleteOpen, setGanttBulkDeleteOpen] = useState(false);
  const [ganttBulkDeleteCutoffYmd, setGanttBulkDeleteCutoffYmd] = useState<string | null>(null);

  const ganttSelectedTask = useMemo(() => {
    const id = String(ganttSelectedTaskId || '');
    if (!id) return null;
    return (Array.isArray(ganttTasks) ? ganttTasks : []).find((t) => t.id === id) ?? null;
  }, [ganttSelectedTaskId, ganttTasks]);

  function normalizeGanttTasks(input: unknown): GanttTask[] {
    const list = Array.isArray(input) ? input : [];
    const isYmd = (s: string) => /^\d{4}-\d{2}-\d{2}$/.test(String(s || ''));
    const out: GanttTask[] = [];
    for (let i = 0; i < (list as any[]).length; i += 1) {
      const item = (list as any[])[i];
      const id = typeof item?.id === 'string' ? String(item.id) : '';
      const title = typeof item?.title === 'string' ? String(item.title) : '';
      const memo = typeof item?.memo === 'string' ? String(item.memo) : '';
      const color = typeof item?.color === 'string' ? String(item.color) : '';
      const laneIdRaw = typeof item?.laneId === 'string' ? String(item.laneId) : '';
      const startDate = typeof item?.startDate === 'string' ? String(item.startDate) : '';
      const endDate = typeof item?.endDate === 'string' ? String(item.endDate) : '';
      const yRaw = item?.y;
      const zRaw = item?.z;
      if (!id) continue;
      if (!isYmd(startDate) || !isYmd(endDate)) continue;
      const safeTitle = title.trim() ? title.slice(0, 200) : '（無題）';
      // Ensure inclusive range is valid
      const safeStart = startDate;
      const safeEnd = endDate < safeStart ? safeStart : endDate;
      const laneId = (laneIdRaw || 'default').slice(0, 80);
      const y = typeof yRaw === 'number' && Number.isFinite(yRaw) ? Math.max(0, Math.trunc(yRaw)) : 8 + i * 28;
      const z = typeof zRaw === 'number' && Number.isFinite(zRaw) ? Math.trunc(zRaw) : i;
      out.push({ id: id.slice(0, 80), title: safeTitle, memo: memo.slice(0, 8000), laneId, startDate: safeStart, endDate: safeEnd, color: color.slice(0, 40), y, z });
    }
    return out;
  }

  function normalizeCalendarEvents(input: unknown): CalendarEvent[] {
    const list = Array.isArray(input) ? input : [];
    const isYmd = (s: string) => /^\d{4}-\d{2}-\d{2}$/.test(String(s || ''));
    const isHHMM = (s: string) => /^([01]?\d|2[0-3]):[0-5]\d$/.test(String(s || ''));

    const out: CalendarEvent[] = [];
    for (let i = 0; i < (list as any[]).length; i += 1) {
      const item = (list as any[])[i];
      const id = typeof item?.id === 'string' ? String(item.id) : '';
      const titleRaw = typeof item?.title === 'string' ? String(item.title) : '';
      const date = typeof item?.date === 'string' ? String(item.date) : '';
      const allDay = !!item?.allDay;
      const startTimeRaw = typeof item?.startTime === 'string' ? String(item.startTime) : '';
      const memo = typeof item?.memo === 'string' ? String(item.memo) : '';
      const orderRaw = item?.order;
      if (!id) continue;
      if (!isYmd(date)) continue;
      const title = titleRaw.trim() ? titleRaw.slice(0, 200) : '（無題）';
      const startTime = allDay ? '' : (isHHMM(startTimeRaw) ? startTimeRaw : '');
      const order = typeof orderRaw === 'number' && Number.isFinite(orderRaw) ? Math.trunc(orderRaw) : i;
      out.push({ id: id.slice(0, 80), title, date, allDay: !!allDay, startTime, order, memo: memo.slice(0, 8000) });
    }
    return out;
  }

  function calendarSnapshot(events: CalendarEvent[]) {
    try {
      return JSON.stringify(
        (Array.isArray(events) ? events : []).map((e) => ({
          id: e.id,
          title: e.title,
          date: e.date,
          allDay: !!e.allDay,
          startTime: e.startTime || '',
          order: e.order ?? 0,
          memo: e.memo || '',
        }))
      );
    } catch {
      return '';
    }
  }

  async function loadCalendarFromServer() {
    if (!accessToken) return;
    setCalendarLoading(true);
    setCalendarError(null);
    try {
      const res = await apiFetch('/api/calendar', { cache: 'no-store' });
      const body = await res.json().catch(() => null as any);
      if (!res.ok || !body?.success) throw new Error(body?.error || 'カレンダーの取得に失敗しました');
      const events = normalizeCalendarEvents(body?.calendar?.events);
      setCalendarEvents(events);
      calendarLastSavedSnapshotRef.current = calendarSnapshot(events);
      setCalendarDirty(false);
      setCalendarRemoteUpdatePending(false);
    } catch (e: any) {
      setCalendarError(e?.message || String(e));
      setCalendarEvents([]);
      calendarLastSavedSnapshotRef.current = '';
      setCalendarDirty(false);
    } finally {
      setCalendarLoading(false);
    }
  }

  async function saveCalendarToServer(events: CalendarEvent[], snapshotOverride?: string) {
    if (!accessToken) return;
    if (calendarIsSavingRef.current) return;
    calendarIsSavingRef.current = true;
    setCalendarSaving(true);
    setCalendarError(null);
    try {
      const snapshot = snapshotOverride ?? calendarSnapshot(events);
      const res = await apiFetch('/api/calendar', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ events }),
      });
      const body = await res.json().catch(() => null as any);
      if (!res.ok || !body?.success) throw new Error(body?.error || 'カレンダーの保存に失敗しました');
      calendarLastSavedSnapshotRef.current = snapshot;
      setCalendarDirty(false);
      setCalendarRemoteUpdatePending(false);
    } catch (e: any) {
      setCalendarError(e?.message || String(e));
    } finally {
      setCalendarSaving(false);
      calendarIsSavingRef.current = false;
    }
  }

  useEffect(() => {
    if (!accessToken) {
      setCalendarEvents([]);
      setCalendarDirty(false);
      setCalendarRemoteUpdatePending(false);
      setCalendarError(null);
      calendarLastSavedSnapshotRef.current = '';
      return;
    }
    void loadCalendarFromServer();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [accessToken]);

  useEffect(() => {
    if (!accessToken) return;
    if (!calendarDirty) return;
    if (calendarIsSavingRef.current) return;
    if (calendarIsInteractingRef.current || calendarIsInteracting) return;
    if (calendarEditingIdRef.current || calendarEditingId) return;

    try {
      if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return;
    } catch {
      // ignore
    }
    try {
      if (typeof navigator !== 'undefined' && 'onLine' in navigator && !navigator.onLine) return;
    } catch {
      // ignore
    }

    const snapshot = calendarSnapshot(calendarEvents);
    if (snapshot && snapshot === calendarLastSavedSnapshotRef.current) {
      setCalendarDirty(false);
      return;
    }

    if (calendarSaveTimerRef.current) window.clearTimeout(calendarSaveTimerRef.current);
    calendarSaveTimerRef.current = window.setTimeout(() => {
      void saveCalendarToServer(calendarEvents, snapshot);
    }, 700);

    return () => {
      if (calendarSaveTimerRef.current) window.clearTimeout(calendarSaveTimerRef.current);
      calendarSaveTimerRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [calendarEvents, calendarDirty, accessToken, calendarIsInteracting, calendarEditingId]);

  function commitGanttTasks(nextTasksRaw: GanttTask[]) {
    const nextTasks = normalizeGanttTasks(nextTasksRaw).map((t) => ({ ...t, laneId: 'default' }));

    setGanttTasks(nextTasks);
    setGanttLanes([{ id: 'default', name: '', order: 0 }]);
    setGanttDirty(true);
    setGanttRemoteUpdatePending(false);
  }

  function ganttSnapshot(lanes: GanttLane[], tasks: GanttTask[]) {
    try {
      return JSON.stringify({
        lanes: (Array.isArray(lanes) ? lanes : []).map((l) => ({ id: l.id, name: l.name || '', order: l.order })),
        tasks: (Array.isArray(tasks) ? tasks : []).map((t) => ({ id: t.id, title: t.title, laneId: t.laneId, startDate: t.startDate, endDate: t.endDate, memo: t.memo || '', color: t.color || '', y: t.y ?? null, z: t.z ?? null })),
      });
    } catch {
      return '';
    }
  }

  async function loadGanttFromServer() {
    if (!accessToken) return;
    setGanttLoading(true);
    setGanttError(null);
    try {
      const res = await apiFetch('/api/gantt', { cache: 'no-store' });
      const body = await res.json().catch(() => null as any);
      if (!res.ok || !body?.success) throw new Error(body?.error || 'ガントの取得に失敗しました');

      const tasks = normalizeGanttTasks(body?.gantt?.tasks).map((t) => ({ ...t, laneId: 'default' }));
      const lanes = [{ id: 'default', name: '', order: 0 }];

      setGanttTasks(tasks);
      setGanttLanes(lanes);
      ganttLastSavedSnapshotRef.current = ganttSnapshot(lanes, tasks);
      setGanttDirty(false);
      setGanttRemoteUpdatePending(false);
    } catch (e: any) {
      setGanttError(e?.message || String(e));
      setGanttLanes([]);
      setGanttTasks([]);
      ganttLastSavedSnapshotRef.current = '';
      setGanttDirty(false);
    } finally {
      setGanttLoading(false);
    }
  }

  async function saveGanttToServer(lanes: GanttLane[], tasks: GanttTask[], snapshotOverride?: string) {
    if (!accessToken) return;
    if (ganttIsSavingRef.current) return;
    ganttIsSavingRef.current = true;
    setGanttSaving(true);
    setGanttError(null);
    try {
      const snapshot = snapshotOverride ?? ganttSnapshot(lanes, tasks);
      const res = await apiFetch('/api/gantt', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ lanes, tasks }),
      });
      const body = await res.json().catch(() => null as any);
      if (!res.ok || !body?.success) throw new Error(body?.error || 'ガントの保存に失敗しました');

      ganttLastSavedSnapshotRef.current = snapshot;
      setGanttDirty(false);
      setGanttRemoteUpdatePending(false);
    } catch (e: any) {
      setGanttError(e?.message || String(e));
    } finally {
      setGanttSaving(false);
      ganttIsSavingRef.current = false;
    }
  }

  useEffect(() => {
    if (!accessToken) {
      setGanttLanes([]);
      setGanttTasks([]);
      setGanttDirty(false);
      setGanttRemoteUpdatePending(false);
      setGanttError(null);
      ganttLastSavedSnapshotRef.current = '';
      return;
    }
    void loadGanttFromServer();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [accessToken]);

  useEffect(() => {
    if (!accessToken) return;
    if (!ganttDirty) return;
    if (ganttIsSavingRef.current) return;
    if (ganttEditingId) return;
    if (ganttIsInteractingRef.current) return;

    try {
      if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return;
    } catch {
      // ignore
    }
    try {
      if (typeof navigator !== 'undefined' && 'onLine' in navigator && !navigator.onLine) return;
    } catch {
      // ignore
    }

    const snapshot = ganttSnapshot(ganttLanes, ganttTasks);
    if (snapshot && snapshot === ganttLastSavedSnapshotRef.current) {
      setGanttDirty(false);
      return;
    }

    if (ganttSaveTimerRef.current) window.clearTimeout(ganttSaveTimerRef.current);
    ganttSaveTimerRef.current = window.setTimeout(() => {
      void saveGanttToServer(ganttLanes, ganttTasks, snapshot);
    }, 700);

    return () => {
      if (ganttSaveTimerRef.current) window.clearTimeout(ganttSaveTimerRef.current);
      ganttSaveTimerRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ganttLanes, ganttTasks, ganttDirty, ganttEditingId, accessToken]);

  function openGanttTask(taskId: string) {
    setGanttSelectedTaskId(taskId);
    setGanttDrawerOpen(true);
    setGanttEditingId(taskId);
  }

  function closeGanttDrawer() {
    setGanttDrawerOpen(false);
    setGanttSelectedTaskId(null);
    setGanttEditingId(null);
  }

  function openGanttBulkDelete(cutoffYmd: string) {
    const ymd = String(cutoffYmd || '').slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(ymd)) return;
    setGanttBulkDeleteCutoffYmd(ymd);
    setGanttBulkDeleteOpen(true);
  }

  function closeGanttBulkDelete() {
    setGanttBulkDeleteOpen(false);
    setGanttBulkDeleteCutoffYmd(null);
  }

  useEffect(() => {
    if (!ganttBulkDeleteOpen) return;
    const onKeyDown = (ev: KeyboardEvent) => {
      if (ev.key !== 'Escape') return;
      ev.preventDefault();
      closeGanttBulkDelete();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [ganttBulkDeleteOpen]);

  const ganttBulkDeleteTargets = useMemo(() => {
    const cutoff = String(ganttBulkDeleteCutoffYmd || '');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(cutoff)) return { cutoff: '', count: 0 };
    const list = Array.isArray(ganttTasks) ? ganttTasks : [];
    const count = list.filter((t) => String(t?.endDate || '') && String(t.endDate) <= cutoff).length;
    return { cutoff, count };
  }, [ganttBulkDeleteCutoffYmd, ganttTasks]);

  function confirmGanttBulkDelete() {
    if (busy) return;
    if (!accessToken) return;

    const cutoff = String(ganttBulkDeleteCutoffYmd || '');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(cutoff)) {
      closeGanttBulkDelete();
      return;
    }

    const prev = Array.isArray(ganttTasks) ? ganttTasks : [];
    const next = prev.filter((t) => String(t?.endDate || '') && String(t.endDate) > cutoff);
    if (next.length === prev.length) {
      closeGanttBulkDelete();
      return;
    }

    const selectedId = String(ganttSelectedTaskId || '');
    const selectedWillBeDeleted = !!selectedId && prev.some((t) => t.id === selectedId && String(t?.endDate || '') && String(t.endDate) <= cutoff);

    commitGanttTasks(next);
    if (selectedWillBeDeleted) closeGanttDrawer();
    closeGanttBulkDelete();
  }

  function createGanttTaskAt(args: { laneId: string | null; startDate: string; endDate: string; y?: number }) {
    if (busy) return;
    const laneId = args.laneId || 'default';
    const startDate = String(args.startDate || '').slice(0, 10);
    const endRaw = String(args.endDate || '').slice(0, 10);
    const endDate = endRaw && endRaw < startDate ? startDate : endRaw;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(startDate)) return;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(endDate)) return;

    const maxZ = Math.max(-1, ...(Array.isArray(ganttTasks) ? ganttTasks : []).map((t) => (typeof (t as any)?.z === 'number' ? (t as any).z : -1)));
    const yRaw = args?.y;
    const y = typeof yRaw === 'number' && Number.isFinite(yRaw) ? Math.max(0, Math.trunc(yRaw)) : 8;

    const task: GanttTask = {
      id: `gantt-${newId()}`,
      title: 'タスク',
      laneId,
      startDate,
      endDate,
      memo: '',
      color: 'default',
      y,
      z: maxZ + 1,
    };

    commitGanttTasks([task, ...(Array.isArray(ganttTasks) ? ganttTasks : [])]);
    setGanttSelectedTaskId(task.id);
  }

  // notes (Keep-like) - masonry grid, search, no title, delete by clearing body
  type NoteItem = {
    id: string;
    body: string;
    createdAt: string;
    updatedAt: string;
  };

  const NOTES_GLOBAL_KEY = 'global';
  const [notes, setNotes] = useState<NoteItem[]>([]);
  const [notesQuery, setNotesQuery] = useState('');
  const [notesEditingId, setNotesEditingId] = useState<string | null>(null);
  const [notesLoading, setNotesLoading] = useState(false);
  const [notesSaving, setNotesSaving] = useState(false);
  const [notesDirty, setNotesDirty] = useState(false);
  const [notesRemoteUpdatePending, setNotesRemoteUpdatePending] = useState(false);
  const [notesError, setNotesError] = useState<string | null>(null);
  const notesSaveTimerRef = useRef<number | null>(null);
  const notesLastSavedSnapshotRef = useRef<string>('');
  const notesIsSavingRef = useRef(false);

  const [notesModalOpen, setNotesModalOpen] = useState(false);
  const [notesModalId, setNotesModalId] = useState<string | null>(null);
  const [notesModalBody, setNotesModalBody] = useState('');

  const notesOpenFromUrlIdRef = useRef<string | null>(null);

  const notesGridRef = useRef<HTMLDivElement | null>(null);
  const notesLayoutRafRef = useRef<number | null>(null);

  function normalizeNotes(input: unknown): NoteItem[] {
    const list = Array.isArray(input) ? input : [];
    const out: NoteItem[] = [];
    for (const item of list as any[]) {
      const id = typeof item?.id === 'string' ? String(item.id) : '';
      const body = typeof item?.body === 'string' ? String(item.body) : '';
      const createdAt = typeof item?.createdAt === 'string' ? String(item.createdAt) : '';
      const updatedAt = typeof item?.updatedAt === 'string' ? String(item.updatedAt) : '';
      if (!id) continue;
      out.push({ id, body, createdAt, updatedAt });
    }
    return out;
  }

  function notesSnapshot(items: NoteItem[]) {
    try {
      return JSON.stringify(
        (Array.isArray(items) ? items : []).map((n) => ({ id: n.id, body: n.body, createdAt: n.createdAt, updatedAt: n.updatedAt }))
      );
    } catch {
      return '';
    }
  }

  function getJstDateTimeParts(d: Date) {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone: activeTimeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false,
    }).formatToParts(d);

    const map = new Map<string, string>();
    for (const p of parts) {
      if (p.type !== 'literal') map.set(p.type, p.value);
    }

    return {
      year: map.get('year') || '1970',
      month2: map.get('month') || '01',
      day2: map.get('day') || '01',
      hour2: map.get('hour') || '00',
      minute2: map.get('minute') || '00',
      second2: map.get('second') || '00',
    };
  }

  function nowHHMM() {
    return `${nowParts.hour2}:${nowParts.minute2}`;
  }

  function formatDateISO(d: Date) {
    return getZonedYmdFromMs(d.getTime(), activeTimeZone);
  }

  const taskLineDateKey = TASK_LINE_GLOBAL_KEY;

  const ganttRangeDays = 35;
  const ganttDayWidth = 24;
  const ganttRangeStart = useMemo(() => {
    // show a bit of context before today
    return addDaysYmd(todayYmd, -7);
  }, [todayYmd]);

  function normalizeTaskLineCards(input: unknown): TaskLineCard[] {
    const list = Array.isArray(input) ? input : [];
    const temp: Array<{ id: string; text: string; lane: TaskLineLane; order: number | null; _idx: number }> = [];
    for (let i = 0; i < list.length; i += 1) {
      const item = list[i] as any;
      const id = typeof item?.id === 'string' ? String(item.id) : '';
      const text = typeof item?.text === 'string' ? String(item.text) : '';
      const laneRaw = item?.lane;
      const lane: TaskLineLane = isTaskLineLane(laneRaw) ? laneRaw : 'stock';
      const orderRaw = item?.order;
      const order = typeof orderRaw === 'number' && Number.isFinite(orderRaw) ? orderRaw : null;
      if (!id) continue;
      temp.push({ id, text, lane, order, _idx: i });
    }

    // Ensure per-lane stable ordering even for legacy cards missing `lane`/`order`.
    const byLane = new Map<TaskLineLane, Array<typeof temp[number]>>();
    for (const lane of TASK_LINE_LANES.map((x) => x.key)) byLane.set(lane, []);
    for (const c of temp) byLane.get(c.lane)!.push(c);

    const out: TaskLineCard[] = [];
    for (const lane of TASK_LINE_LANES.map((x) => x.key)) {
      const laneCards = byLane.get(lane)!;
      laneCards.sort((a, b) => {
        const ao = a.order ?? Number.POSITIVE_INFINITY;
        const bo = b.order ?? Number.POSITIVE_INFINITY;
        if (ao !== bo) return ao - bo;
        return a._idx - b._idx;
      });
      for (let j = 0; j < laneCards.length; j += 1) {
        const c = laneCards[j];
        out.push({ id: c.id, text: c.text, lane, order: j });
      }
    }

    return out;
  }

  function taskLineSnapshot(cards: TaskLineCard[]) {
    try {
      return JSON.stringify(cards.map((c) => ({ id: c.id, text: c.text, lane: c.lane, order: c.order })));
    } catch {
      return '';
    }
  }

  function taskLineMoveCard(dragId: string, targetLane: TaskLineLane, targetIndex: number) {
    setTaskLineCards((prev) => {
      const normalized = normalizeTaskLineCards(prev);
      const laneOrder = TASK_LINE_LANES.map((x) => x.key);

      const laneLists = new Map<TaskLineLane, string[]>();
      for (const lane of laneOrder) laneLists.set(lane, []);
      for (const c of normalized) laneLists.get(c.lane)!.push(c.id);

      let fromLane: TaskLineLane | null = null;
      for (const lane of laneOrder) {
        if (laneLists.get(lane)!.includes(dragId)) {
          fromLane = lane;
          break;
        }
      }
      if (!fromLane) return normalized;

      // Remove from source lane
      const fromListBefore = laneLists.get(fromLane)!;
      const fromIndexBefore = fromListBefore.indexOf(dragId);
      laneLists.set(fromLane, fromListBefore.filter((id) => id !== dragId));

      // Insert into target lane
      const targetList = laneLists.get(targetLane)!;
      const rawTargetIndex = Number.isFinite(targetIndex) ? targetIndex : targetList.length;
      let safeInsertIndex = Math.max(0, Math.min(targetList.length, rawTargetIndex));

      // When moving within the same lane, removal shifts indices.
      if (fromLane === targetLane) {
        const fromIndex = fromIndexBefore;
        if (fromIndex >= 0 && safeInsertIndex > fromIndex) {
          safeInsertIndex = Math.max(0, safeInsertIndex - 1);
        }

        // No-op (keep stable)
        if (fromIndex >= 0 && (safeInsertIndex === fromIndex || safeInsertIndex === fromIndex + 1)) {
          return normalized;
        }
      }

      const nextTarget = targetList.slice();
      nextTarget.splice(safeInsertIndex, 0, dragId);
      laneLists.set(targetLane, nextTarget);

      const byId = new Map<string, TaskLineCard>();
      for (const c of normalized) byId.set(c.id, c);

      const rebuilt: TaskLineCard[] = [];
      for (const lane of laneOrder) {
        const ids = laneLists.get(lane)!;
        for (let idx = 0; idx < ids.length; idx += 1) {
          const id = ids[idx];
          const base = byId.get(id);
          if (!base) continue;
          rebuilt.push({ ...base, lane, order: idx });
        }
      }
      return rebuilt;
    });
    setTaskLineDirty(true);
  }

  function taskLineMoveCards(dragIdsRaw: string[], targetLane: TaskLineLane, targetIndex: number) {
    const dragIds = (Array.isArray(dragIdsRaw) ? dragIdsRaw : []).map((x) => String(x || '')).filter(Boolean);
    if (dragIds.length === 0) return;
    const dragIdSet = new Set(dragIds);

    setTaskLineCards((prev) => {
      const normalized = normalizeTaskLineCards(prev);
      const laneOrder = TASK_LINE_LANES.map((x) => x.key);

      const laneLists = new Map<TaskLineLane, string[]>();
      for (const lane of laneOrder) laneLists.set(lane, []);
      for (const c of normalized) laneLists.get(c.lane)!.push(c.id);

      // Preserve relative order: lane order, then current order within lane
      const orderedDragIds: string[] = [];
      for (const lane of laneOrder) {
        const ids = laneLists.get(lane)!;
        for (const id of ids) {
          if (dragIdSet.has(id)) orderedDragIds.push(id);
        }
      }
      if (orderedDragIds.length === 0) return normalized;

      const originalTargetList = laneLists.get(targetLane)!.slice();
      const rawTargetIndex = Number.isFinite(targetIndex) ? targetIndex : originalTargetList.length;
      let safeInsertIndex = Math.max(0, Math.min(originalTargetList.length, rawTargetIndex));

      // Remove dragged ids from all lanes
      for (const lane of laneOrder) {
        const list = laneLists.get(lane)!;
        if (!list.some((id) => dragIdSet.has(id))) continue;
        laneLists.set(lane, list.filter((id) => !dragIdSet.has(id)));
      }

      // If the target lane contained dragged ids before insertion point, adjust for removed items
      let removedBefore = 0;
      for (let i = 0; i < Math.min(safeInsertIndex, originalTargetList.length); i += 1) {
        if (dragIdSet.has(originalTargetList[i])) removedBefore += 1;
      }
      if (removedBefore) safeInsertIndex = Math.max(0, safeInsertIndex - removedBefore);

      const targetListAfterRemoval = laneLists.get(targetLane)!;
      safeInsertIndex = Math.max(0, Math.min(targetListAfterRemoval.length, safeInsertIndex));
      const nextTarget = targetListAfterRemoval.slice();
      nextTarget.splice(safeInsertIndex, 0, ...orderedDragIds);
      laneLists.set(targetLane, nextTarget);

      const byId = new Map<string, TaskLineCard>();
      for (const c of normalized) byId.set(c.id, c);

      const rebuilt: TaskLineCard[] = [];
      for (const lane of laneOrder) {
        const ids = laneLists.get(lane)!;
        for (let idx = 0; idx < ids.length; idx += 1) {
          const id = ids[idx];
          const base = byId.get(id);
          if (!base) continue;
          rebuilt.push({ ...base, lane, order: idx });
        }
      }
      return rebuilt;
    });

    setTaskLineDirty(true);
  }

  function taskLinePreviewMove(dragId: string, targetLane: TaskLineLane, targetIndex: number) {
    const safeIndex = Number.isFinite(targetIndex) ? targetIndex : 0;
    const last = taskLineLastPreviewRef.current;
    if (last && last.dragId === dragId && last.lane === targetLane && last.index === safeIndex) return;
    taskLineLastPreviewRef.current = { dragId, lane: targetLane, index: safeIndex };
    taskLineMoveCard(dragId, targetLane, safeIndex);
  }

  function taskLinePreviewMoveCards(primaryDragId: string, dragIds: string[], targetLane: TaskLineLane, targetIndex: number) {
    const safeIndex = Number.isFinite(targetIndex) ? targetIndex : 0;
    const last = taskLineLastPreviewRef.current;
    if (last && last.dragId === primaryDragId && last.lane === targetLane && last.index === safeIndex) return;
    taskLineLastPreviewRef.current = { dragId: primaryDragId, lane: targetLane, index: safeIndex };
    taskLineMoveCards(dragIds, targetLane, safeIndex);
  }

  function taskLineAutoScrollWhileDraggingAtPoint(clientX: number, clientY: number) {
    if (!taskLineDraggingId) return;

    const nowMs = Date.now();
    if (nowMs - taskLineLastAutoScrollAtRef.current < 16) return;
    taskLineLastAutoScrollAtRef.current = nowMs;

    const edge = 60;
    const maxStep = 18;
    const x = clientX;
    const y = clientY;

    const board = taskLineBoardRef.current;
    if (board) {
      const r = board.getBoundingClientRect();
      let dx = 0;
      if (x < r.left + edge) dx = -maxStep;
      else if (x > r.right - edge) dx = maxStep;
      if (dx) {
        try {
          board.scrollBy({ left: dx });
        } catch {
          board.scrollLeft += dx;
        }
      }
    }

    const body = mainBodyRef.current;
    if (body) {
      const r = body.getBoundingClientRect();
      let dy = 0;
      if (y < r.top + edge) dy = -maxStep;
      else if (y > r.bottom - edge) dy = maxStep;
      if (dy) {
        try {
          body.scrollBy({ top: dy });
        } catch {
          body.scrollTop += dy;
        }
      }
    }
  }

  function getTaskLinePointInScrollFromClient(clientX: number, clientY: number) {
    const root = taskLineBoardRef.current;
    if (!root) return null;
    const r = root.getBoundingClientRect();
    return {
      x: clientX - r.left + root.scrollLeft,
      y: clientY - r.top + root.scrollTop,
    };
  }

  function clearTaskLineSelectionRect() {
    taskLineSelectingRef.current = null;
    setTaskLineSelectRect(null);
  }

  function finalizeTaskLineSelectionRect() {
    const root = taskLineBoardRef.current;
    const sel = taskLineSelectingRef.current;
    const rect = taskLineSelectRect;
    if (!root || !sel || !rect) {
      clearTaskLineSelectionRect();
      return;
    }

    try {
      const rootRect = root.getBoundingClientRect();
      const selected: string[] = [];
      const cardEls = Array.from(root.querySelectorAll<HTMLElement>('.taskline-card[data-taskline-cardid]'));
      for (const el of cardEls) {
        const id = String(el.getAttribute('data-taskline-cardid') || '').trim();
        if (!id) continue;
        const r = el.getBoundingClientRect();
        const elLeft = r.left - rootRect.left + root.scrollLeft;
        const elTop = r.top - rootRect.top + root.scrollTop;
        const elRight = elLeft + r.width;
        const elBottom = elTop + r.height;

        const left = rect.x;
        const top = rect.y;
        const right = rect.x + rect.w;
        const bottom = rect.y + rect.h;

        const intersects = !(elRight < left || elLeft > right || elBottom < top || elTop > bottom);
        if (intersects) selected.push(id);
      }
      setTaskLineSelectedCardIds(selected);
    } catch {
      // ignore
    } finally {
      clearTaskLineSelectionRect();
    }
  }

  function findTaskLineDropTargetFromPoint(clientX: number, clientY: number, draggingIds: string[]) {
    if (typeof document === 'undefined') return null;
    const el = document.elementFromPoint(clientX, clientY);
    if (!(el instanceof HTMLElement)) return null;
    const body = el.closest<HTMLElement>('[data-taskline-drop-lane]');
    if (!body) return null;
    const laneRaw = body.getAttribute('data-taskline-drop-lane') || '';
    if (!isTaskLineLane(laneRaw)) return null;
    const lane = laneRaw as TaskLineLane;

    const draggingIdSet = new Set((Array.isArray(draggingIds) ? draggingIds : []).map((x) => String(x || '')).filter(Boolean));

    const cardEls = Array.from(body.querySelectorAll<HTMLElement>('.taskline-card'));
    let insertAt = cardEls.length;
    for (const cardEl of cardEls) {
      const id = String(cardEl.getAttribute('data-taskline-cardid') || '').trim();
      if (!id || draggingIdSet.has(id)) continue;
      const laneIndexAttr = String(cardEl.getAttribute('data-taskline-laneindex') || '').trim();
      const laneIndex = Number.parseInt(laneIndexAttr, 10);
      if (!Number.isFinite(laneIndex)) continue;
      const rect = cardEl.getBoundingClientRect();
      const midY = rect.top + rect.height / 2;
      if (clientY < midY) {
        insertAt = laneIndex;
        break;
      }
    }

    return { lane, insertAt };
  }

  function taskLineWeekdayFromLane(lane: TaskLineLane): TaskLineWeekday | '' {
    return lane === 'stock' ? '' : lane;
  }

  function taskLineLaneFromWeekday(weekday: TaskLineWeekday | ''): TaskLineLane {
    return weekday ? weekday : 'stock';
  }

  function shortenUrlForDisplay(rawUrl: string) {
    const cleaned = String(rawUrl || '').trim();
    if (!cleaned) return '';
    let display = cleaned.replace(/^https?:\/\//i, '');
    // keep it compact but recognizable
    const maxLen = 38;
    if (display.length <= maxLen) return display;
    const head = display.slice(0, 28);
    const tail = display.slice(-6);
    return `${head}…${tail}`;
  }

  function normalizeExternalUrl(raw: string) {
    const s = String(raw || '').trim();
    if (!s) return '';
    // Keep explicit schemes as-is, otherwise assume https.
    if (/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(s)) return s;
    return `https://${s.replace(/^\/+/, '')}`;
  }

  function scheduleOpenExternalUrl(raw: string) {
    if (typeof window === 'undefined') return;
    if (timelineOpenUrlTimerRef.current != null) {
      try {
        window.clearTimeout(timelineOpenUrlTimerRef.current);
      } catch {
        // ignore
      }
      timelineOpenUrlTimerRef.current = null;
    }
    const href = normalizeExternalUrl(raw);
    if (!href) return;
    timelineOpenUrlTimerRef.current = window.setTimeout(() => {
      timelineOpenUrlTimerRef.current = null;
      try {
        window.open(href, '_blank', 'noopener,noreferrer');
      } catch {
        // ignore
      }
    }, 220);
  }

  function cancelScheduledOpenExternalUrl() {
    if (typeof window === 'undefined') return;
    if (timelineOpenUrlTimerRef.current == null) return;
    try {
      window.clearTimeout(timelineOpenUrlTimerRef.current);
    } catch {
      // ignore
    }
    timelineOpenUrlTimerRef.current = null;
  }

  function renderTextWithLinks(text: string) {
    const s = String(text ?? '');
    if (!s) return s;

    const urlRegex = /(https?:\/\/[^\s]+|www\.[^\s]+)/gi;
    const nodes: React.ReactNode[] = [];

    let lastIndex = 0;
    let match: RegExpExecArray | null;
    let idx = 0;
    while ((match = urlRegex.exec(s)) !== null) {
      const start = match.index;
      const rawToken = match[0];

      if (start > lastIndex) nodes.push(s.slice(lastIndex, start));

      // Trim trailing punctuation that often sticks to URLs in plain text.
      let token = rawToken;
      let trailing = '';
      while (token && /[\]\)\}\.,;:!?]$/.test(token)) {
        trailing = token.slice(-1) + trailing;
        token = token.slice(0, -1);
      }

      const href = token.toLowerCase().startsWith('www.') ? `https://${token}` : token;
      nodes.push(
        <a
          key={`url-${idx}-${start}`}
          href={href}
          target="_blank"
          rel="noreferrer noopener"
          className="inline-url"
          title={href}
          onClick={(e) => {
            e.stopPropagation();
          }}
          onMouseDown={(e) => {
            // prevent parent handlers from reacting to this click
            e.stopPropagation();
          }}
        >
          {shortenUrlForDisplay(token)}
        </a>
      );
      if (trailing) nodes.push(trailing);

      lastIndex = start + rawToken.length;
      idx += 1;
    }

    if (lastIndex < s.length) nodes.push(s.slice(lastIndex));
    return nodes.length ? nodes : s;
  }

  function readTaskLineDraftFromLocal(dateKey: string) {
    try {
      // migration from previous localStorage-based implementation + unauthenticated drafts
      const keys = [`nippoTaskLineDraft:${dateKey}`];
      // old key format: nippoTaskLine:<uid|anon>:<date>
      const uid = userId || 'anon';
      keys.push(`nippoTaskLine:${uid}:${dateKey}`);
      keys.push(`nippoTaskLine:anon:${dateKey}`);

      for (const k of keys) {
        const raw = window.localStorage.getItem(k);
        if (!raw) continue;
        const parsed = JSON.parse(raw);
        const cards = normalizeTaskLineCards(parsed);
        return { key: k, dateKey, cards };
      }
      return null;
    } catch {
      return null;
    }
  }

  function writeTaskLineDraftToLocal(dateKey: string, cards: TaskLineCard[]) {
    try {
      window.localStorage.setItem(`nippoTaskLineDraft:${dateKey}`, JSON.stringify(cards));
    } catch {
      // ignore
    }
  }

  async function loadTaskLineFromServer(dateKey: string) {
    if (!accessToken) return;
    if (!dateKey) return;
    setTaskLineLoading(true);
    setTaskLineError(null);
    try {
      const res = await apiFetch(`/api/taskline?dateString=${encodeURIComponent(dateKey)}`);
      const body = await res.json().catch(() => null as any);
      if (!res.ok || !body?.success) throw new Error(body?.error || 'タスクラインの取得に失敗しました');

      const remoteCards = normalizeTaskLineCards(body?.taskline?.cards);

      const isGlobalTaskLine = dateKey === TASK_LINE_GLOBAL_KEY;

      // One-time migration (localStorage -> server). For global taskline, also look at today's/yesterday's drafts.
      const todayKey = todayYmd;
      const yesterdayKey = addDaysYmd(todayYmd, -1);
      const draftCandidates = isGlobalTaskLine ? [TASK_LINE_GLOBAL_KEY, todayKey, yesterdayKey] : [dateKey];

      // If remote empty, but local has data, push it to server.
      const draft = remoteCards.length === 0 ? draftCandidates.map((k) => readTaskLineDraftFromLocal(k)).find((x) => !!x) : null;
      if (remoteCards.length === 0 && draft?.cards?.length) {
        setTaskLineCards(draft.cards);
        setTaskLineLoadedDateKey(dateKey);
        setTaskLineDirty(true);
        setTaskLineRemoteUpdatePending(false);
        try {
          window.localStorage.removeItem(draft.key);
        } catch {
          // ignore
        }
        try {
          window.localStorage.removeItem(`nippoTaskLineDraft:${draft.dateKey}`);
        } catch {
          // ignore
        }
        // Save migrated data to server
        void saveTaskLineToServer(dateKey, draft.cards, taskLineSnapshot(draft.cards));
        return;
      }

      // One-time migration (server per-day -> server global):
      // If global is empty, try copying from today's/yesterday's server docs.
      if (isGlobalTaskLine && remoteCards.length === 0) {
        const serverCandidates = [todayKey, yesterdayKey].filter((k) => k !== TASK_LINE_GLOBAL_KEY);
        for (const k of serverCandidates) {
          try {
            const r = await apiFetch(`/api/taskline?dateString=${encodeURIComponent(k)}`);
            const b = await r.json().catch(() => null as any);
            if (!r.ok || !b?.success) continue;
            const cards = normalizeTaskLineCards(b?.taskline?.cards);
            if (!cards.length) continue;
            setTaskLineCards(cards);
            setTaskLineLoadedDateKey(dateKey);
            setTaskLineDirty(true);
            setTaskLineRemoteUpdatePending(false);
            void saveTaskLineToServer(dateKey, cards, taskLineSnapshot(cards));
            return;
          } catch {
            // ignore and try next candidate
          }
        }
      }

      setTaskLineCards(remoteCards);
      setTaskLineLoadedDateKey(dateKey);
      taskLineLastSavedSnapshotRef.current = taskLineSnapshot(remoteCards);
      setTaskLineDirty(false);
      setTaskLineRemoteUpdatePending(false);
    } catch (e: any) {
      setTaskLineError(e?.message || String(e));
      setTaskLineCards([]);
      setTaskLineLoadedDateKey(dateKey);
      taskLineLastSavedSnapshotRef.current = '';
      setTaskLineDirty(false);
    } finally {
      setTaskLineLoading(false);
    }
  }

  async function saveTaskLineToServer(dateKey: string, cards: TaskLineCard[], snapshotOverride?: string) {
    if (!accessToken) return;
    if (!dateKey) return;
    if (taskLineIsSavingRef.current) return;
    taskLineIsSavingRef.current = true;
    setTaskLineSaving(true);
    setTaskLineError(null);
    try {
      const snapshot = snapshotOverride ?? taskLineSnapshot(cards);
      const res = await apiFetch('/api/taskline', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ dateString: dateKey, cards }),
      });
      const body = await res.json().catch(() => null as any);
      if (!res.ok || !body?.success) throw new Error(body?.error || 'タスクラインの保存に失敗しました');

      taskLineLastSavedSnapshotRef.current = snapshot;
      if (taskLineDateKey === dateKey) {
        setTaskLineDirty(false);
        setTaskLineRemoteUpdatePending(false);
      }
    } catch (e: any) {
      setTaskLineError(e?.message || String(e));
    } finally {
      setTaskLineSaving(false);
      taskLineIsSavingRef.current = false;
    }
  }

  useEffect(() => {
    if (effectiveViewMode === 'history') return;
    if (!taskLineDateKey) return;

    if (accessToken) {
      setTaskLineDirty(false);
      setTaskLineRemoteUpdatePending(false);
      taskLineLastSavedSnapshotRef.current = '';
      void loadTaskLineFromServer(taskLineDateKey);
      return;
    }

    // login required
    setTaskLineCards([]);
    setTaskLineLoadedDateKey(null);
    setTaskLineDirty(false);
    setTaskLineRemoteUpdatePending(false);
    taskLineLastSavedSnapshotRef.current = '';
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [accessToken, taskLineDateKey, effectiveViewMode]);

  useEffect(() => {
    if (effectiveViewMode === 'history') return;
    if (!taskLineDateKey) return;
    if (taskLineLoadedDateKey !== taskLineDateKey) return;
    if (taskLineEditingId) return;
    if (taskLineDraggingId) return;

    // login required
    if (!accessToken) return;

    // 保存が必要な変更がない場合は何もしない（ロード/Realtime反映での無駄な保存を防ぐ）
    if (!taskLineDirty) return;
    if (taskLineIsSavingRef.current) return;

    // 画面が非表示/オフライン時は保存を抑制（復帰後に再度dirtyで保存される）
    try {
      if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return;
    } catch {
      // ignore
    }
    try {
      if (typeof navigator !== 'undefined' && 'onLine' in navigator && !navigator.onLine) return;
    } catch {
      // ignore
    }

    const snapshot = taskLineSnapshot(taskLineCards);
    if (snapshot && snapshot === taskLineLastSavedSnapshotRef.current) {
      setTaskLineDirty(false);
      return;
    }

    if (taskLineSaveTimerRef.current) window.clearTimeout(taskLineSaveTimerRef.current);
    taskLineSaveTimerRef.current = window.setTimeout(() => {
      void saveTaskLineToServer(taskLineDateKey, taskLineCards, snapshot);
    }, 600);

    return () => {
      if (taskLineSaveTimerRef.current) window.clearTimeout(taskLineSaveTimerRef.current);
      taskLineSaveTimerRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [taskLineCards, taskLineDirty, taskLineDateKey, taskLineLoadedDateKey, taskLineEditingId, taskLineDraggingId, accessToken, effectiveViewMode]);

  async function loadNotesFromServer() {
    if (!accessToken) return;
    setNotesLoading(true);
    setNotesError(null);
    try {
      const res = await apiFetch('/api/notes', { cache: 'no-store' });
      const body = await res.json().catch(() => null as any);
      if (!res.ok || !body?.success) throw new Error(body?.error || 'ノートの取得に失敗しました');

      const remoteNotes = normalizeNotes(body?.notes?.notes);
      // Keep server representation stable (new/updated first)
      remoteNotes.sort((a, b) => {
        const au = Date.parse(a.updatedAt || a.createdAt || '');
        const bu = Date.parse(b.updatedAt || b.createdAt || '');
        if (Number.isFinite(au) && Number.isFinite(bu) && au !== bu) return bu - au;
        const ac = Date.parse(a.createdAt || '');
        const bc = Date.parse(b.createdAt || '');
        if (Number.isFinite(ac) && Number.isFinite(bc) && ac !== bc) return bc - ac;
        return String(b.id).localeCompare(String(a.id));
      });

      setNotes(remoteNotes);
      notesLastSavedSnapshotRef.current = notesSnapshot(remoteNotes);
      setNotesDirty(false);
      setNotesRemoteUpdatePending(false);
    } catch (e: any) {
      setNotesError(e?.message || String(e));
      setNotes([]);
      notesLastSavedSnapshotRef.current = '';
      setNotesDirty(false);
    } finally {
      setNotesLoading(false);
    }
  }

  async function saveNotesToServer(items: NoteItem[], snapshotOverride?: string) {
    if (!accessToken) return;
    if (notesIsSavingRef.current) return;
    notesIsSavingRef.current = true;
    setNotesSaving(true);
    setNotesError(null);
    try {
      const cleaned = normalizeNotes(items)
        .map((n) => ({
          ...n,
          body: String(n.body || ''),
        }))
        .filter((n) => String(n.body || '').trim() !== '');

      cleaned.sort((a, b) => {
        const au = Date.parse(a.updatedAt || a.createdAt || '');
        const bu = Date.parse(b.updatedAt || b.createdAt || '');
        if (Number.isFinite(au) && Number.isFinite(bu) && au !== bu) return bu - au;
        const ac = Date.parse(a.createdAt || '');
        const bc = Date.parse(b.createdAt || '');
        if (Number.isFinite(ac) && Number.isFinite(bc) && ac !== bc) return bc - ac;
        return String(b.id).localeCompare(String(a.id));
      });

      const snapshot = snapshotOverride ?? notesSnapshot(cleaned);
      const res = await apiFetch('/api/notes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ notes: cleaned }),
      });
      const body = await res.json().catch(() => null as any);
      if (!res.ok || !body?.success) throw new Error(body?.error || 'ノートの保存に失敗しました');

      notesLastSavedSnapshotRef.current = snapshot;
      setNotesDirty(false);
      setNotesRemoteUpdatePending(false);
    } catch (e: any) {
      setNotesError(e?.message || String(e));
    } finally {
      setNotesSaving(false);
      notesIsSavingRef.current = false;
    }
  }

  useEffect(() => {
    if (!accessToken) {
      setNotes([]);
      setNotesDirty(false);
      setNotesRemoteUpdatePending(false);
      notesLastSavedSnapshotRef.current = '';
      return;
    }
    void loadNotesFromServer();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [accessToken]);

  useEffect(() => {
    if (!accessToken) return;

    if (!notesDirty) return;
    if (notesIsSavingRef.current) return;
    if (notesEditingId) return;

    // 画面が非表示/オフライン時は保存を抑制
    try {
      if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return;
    } catch {
      // ignore
    }
    try {
      if (typeof navigator !== 'undefined' && 'onLine' in navigator && !navigator.onLine) return;
    } catch {
      // ignore
    }

    const snapshot = notesSnapshot(notes);
    if (snapshot && snapshot === notesLastSavedSnapshotRef.current) {
      setNotesDirty(false);
      return;
    }

    if (notesSaveTimerRef.current) window.clearTimeout(notesSaveTimerRef.current);
    notesSaveTimerRef.current = window.setTimeout(() => {
      void saveNotesToServer(notes, snapshot);
    }, 600);

    return () => {
      if (notesSaveTimerRef.current) window.clearTimeout(notesSaveTimerRef.current);
      notesSaveTimerRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [notes, notesDirty, notesEditingId, accessToken]);

  function createNoteFromBody(rawBody: string) {
    const body = String(rawBody || '').trim();
    if (!body) return;
    const nowIso = now.toISOString();
    const id = `note-${newId()}`;
    const note: NoteItem = { id, body, createdAt: nowIso, updatedAt: nowIso };
    setNotes((prev) => [note, ...normalizeNotes(prev)]);
    setNotesDirty(true);
    setNotesRemoteUpdatePending(false);
  }

  function autoGrowTextarea(el: HTMLTextAreaElement | null) {
    if (!el) return;
    try {
      el.style.height = 'auto';
      el.style.height = `${el.scrollHeight}px`;
    } catch {
      // ignore
    }
  }

  function openNoteModal(noteId: string) {
    const found = normalizeNotes(notes).find((n) => n.id === noteId);
    if (!found) return;
    setNotesModalId(noteId);
    setNotesModalBody(found.body ?? '');
    setNotesModalOpen(true);
    setNotesEditingId(noteId);
  }

  function openNewNoteModal() {
    setNotesModalId(null);
    setNotesModalBody('');
    setNotesModalOpen(true);
    setNotesEditingId('new');
  }

  async function copyNotePermalinkToClipboard(noteId: string): Promise<boolean> {
    if (typeof window === 'undefined') return false;
    const id = String(noteId || '').trim();
    if (!id) return false;
    try {
      const url = new URL(window.location.href);
      url.search = '';
      url.searchParams.set('tab', 'notes');
      url.searchParams.set('note', id);
      const text = url.toString();

      // Prefer async Clipboard API
      if (navigator?.clipboard?.writeText) {
        await navigator.clipboard.writeText(text);
        return true;
      }

      // Fallback
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.setAttribute('readonly', '');
      ta.style.position = 'fixed';
      ta.style.left = '-9999px';
      ta.style.top = '0';
      document.body.appendChild(ta);
      ta.focus();
      ta.select();
      const ok = document.execCommand('copy');
      document.body.removeChild(ta);
      return !!ok;
    } catch {
      return false;
    }
  }

  function closeNoteModal() {
    setNotesModalOpen(false);
    setNotesModalId(null);
    setNotesModalBody('');
    setNotesEditingId(null);
  }

  function saveNoteModal(body: string) {
    const id = notesModalId;
    const trimmed = String(body || '').trim();

    // create mode
    if (!id) {
      if (trimmed) {
        const nowIso = now.toISOString();
        const note: NoteItem = { id: `note-${newId()}`, body: trimmed, createdAt: nowIso, updatedAt: nowIso };
        const nextList = [note, ...normalizeNotes(notes)];
        setNotes(nextList);
        setNotesDirty(true);
        setNotesRemoteUpdatePending(false);

        try {
          if (notesSaveTimerRef.current) window.clearTimeout(notesSaveTimerRef.current);
        } catch {
          // ignore
        }
        notesSaveTimerRef.current = null;
        const snap = notesSnapshot(nextList);
        void saveNotesToServer(nextList, snap);
      }
      closeNoteModal();
      return;
    }

    // update/delete mode
    const normalizedPrev = normalizeNotes(notes);
    const idx = normalizedPrev.findIndex((n) => n.id === id);
    if (idx !== -1) {
      let nextList = normalizedPrev;
      if (!trimmed) {
        nextList = normalizedPrev.filter((n) => n.id !== id);
      } else {
        const nowIso = now.toISOString();
        const cur = normalizedPrev[idx];
        const updated: NoteItem = { ...cur, body: trimmed, updatedAt: nowIso };
        nextList = normalizedPrev.slice();
        nextList[idx] = updated;
      }
      setNotes(nextList);
      setNotesDirty(true);
      setNotesRemoteUpdatePending(false);

      try {
        if (notesSaveTimerRef.current) window.clearTimeout(notesSaveTimerRef.current);
      } catch {
        // ignore
      }
      notesSaveTimerRef.current = null;
      const snap = notesSnapshot(nextList);
      void saveNotesToServer(nextList, snap);
    }
    closeNoteModal();
  }

  useEffect(() => {
    if (typeof window === 'undefined') return;

    const applyFromUrl = () => {
      try {
        const sp = new URLSearchParams(window.location.search);
        const tab = String(sp.get('tab') || '');
        const note = String(sp.get('note') || '').trim();

        if (tab === 'notes' || note) {
          setViewMode('today');
          setTodayMainTab('notes');
        }
        if (note) notesOpenFromUrlIdRef.current = note;
      } catch {
        // ignore
      }
    };

    applyFromUrl();
    window.addEventListener('popstate', applyFromUrl);
    return () => {
      window.removeEventListener('popstate', applyFromUrl);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const pending = notesOpenFromUrlIdRef.current;
    if (!pending) return;
    if (!accessToken) return;
    if (todayMainTab !== 'notes') return;

    const normalized = normalizeNotes(notes);
    const found = normalized.find((n) => n.id === pending);
    if (!found) {
      if (!notesLoading) notesOpenFromUrlIdRef.current = null;
      return;
    }

    notesOpenFromUrlIdRef.current = null;
    openNoteModal(found.id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [accessToken, todayMainTab, notes, notesLoading]);

  function scheduleNotesLayout() {
    if (typeof window === 'undefined') return;
    if (notesLayoutRafRef.current != null) window.cancelAnimationFrame(notesLayoutRafRef.current);
    notesLayoutRafRef.current = window.requestAnimationFrame(() => {
      notesLayoutRafRef.current = null;

      const grid = notesGridRef.current;
      if (!grid) return;

      const cards = Array.from(grid.querySelectorAll('[data-note-id]')) as HTMLElement[];
      if (cards.length === 0) {
        try {
          grid.style.height = '';
        } catch {
          // ignore
        }
        return;
      }

      const gap = 12;
      const minColWidth = 260;
      const width = grid.clientWidth;
      const colCount = Math.max(1, Math.floor((width + gap) / (minColWidth + gap)));
      const colWidth = Math.max(160, Math.floor((width - gap * (colCount - 1)) / colCount));
      const heights = Array.from({ length: colCount }, () => 0);

      // First pass: apply width so height measurement is correct
      for (const el of cards) {
        try {
          el.style.width = `${colWidth}px`;
        } catch {
          // ignore
        }
      }

      // Second pass: place into the shortest column
      for (const el of cards) {
        const h = el.offsetHeight;
        let bestCol = 0;
        for (let i = 1; i < heights.length; i += 1) {
          if (heights[i] < heights[bestCol]) bestCol = i;
        }
        const x = bestCol * (colWidth + gap);
        const y = heights[bestCol];
        try {
          el.style.transform = `translate(${x}px, ${y}px)`;
        } catch {
          // ignore
        }
        heights[bestCol] = y + h + gap;
      }

      const maxH = Math.max(...heights);
      try {
        grid.style.height = `${Math.max(0, maxH - gap)}px`;
      } catch {
        // ignore
      }
    });
  }

  useLayoutEffect(() => {
    if (todayMainTab !== 'notes') return;
    scheduleNotesLayout();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [notes, notesQuery, todayMainTab]);

  useEffect(() => {
    if (todayMainTab !== 'notes') return;
    const grid = notesGridRef.current;
    if (!grid) return;

    const ro = new ResizeObserver(() => {
      scheduleNotesLayout();
    });
    ro.observe(grid);

    return () => {
      try {
        ro.disconnect();
      } catch {
        // ignore
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [todayMainTab]);

  useEffect(() => {
    if (todayMainTab !== 'notes') return;
    if (typeof window === 'undefined') return;

    const onResize = () => {
      scheduleNotesLayout();
    };

    window.addEventListener('resize', onResize, { passive: true });
    window.addEventListener('orientationchange', onResize, { passive: true });

    // Mobile address-bar / zoom changes
    const vv = window.visualViewport;
    if (vv) vv.addEventListener('resize', onResize, { passive: true });

    return () => {
      window.removeEventListener('resize', onResize);
      window.removeEventListener('orientationchange', onResize);
      if (vv) vv.removeEventListener('resize', onResize);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [todayMainTab]);

  function clearNewTaskCarryMemoUrl() {
    setNewTaskCarryMemoUrlEnabled(false);
    setNewTaskCarryMemo('');
    setNewTaskCarryUrl('');
  }

  function setNewTaskNamePlain(name: string) {
    clearNewTaskCarryMemoUrl();
    setNewTaskName(name);
  }

  function copyTimelineTaskToNewTask(task: Task) {
    const memo = typeof (task as any)?.memo === 'string' ? String((task as any).memo).trim() : '';
    const url = typeof (task as any)?.url === 'string' ? String((task as any).url).trim() : '';
    setNewTaskName(task.name);
    if (memo || url) {
      setNewTaskCarryMemoUrlEnabled(true);
      setNewTaskCarryMemo(memo);
      setNewTaskCarryUrl(url);
    } else {
      clearNewTaskCarryMemoUrl();
    }
  }

  function focusTaskInputWithName(name: string) {
    setNewTaskNamePlain(name);
    const isMobile =
      typeof window !== 'undefined' &&
      typeof window.matchMedia === 'function' &&
      window.matchMedia('(max-width: 639px)').matches;
    if (isMobile) setSidebarOpen(true);
    if (!isMobile && sidebarDesktopCollapsed) setSidebarDesktopCollapsed(false);

    window.setTimeout(() => {
      const input = document.getElementById('task-input') as HTMLInputElement | null;
      input?.focus();
      if (input) {
        try {
          input.scrollIntoView({ block: 'center' });
        } catch {
          // ignore
        }
        const len = input.value.length;
        try {
          input.setSelectionRange(len, len);
        } catch {
          // ignore
        }
      }
    }, 0);
  }

  function addTaskLineCard(text?: string, lane: TaskLineLane = 'stock') {
    const v = String(text ?? taskLineInput ?? '').trim();
    if (!v) return;
    const id = newId();
    setTaskLineCards((prev) => {
      const normalized = normalizeTaskLineCards(prev);
      const next = [...normalized, { id, text: v, lane, order: 9999 }];
      return normalizeTaskLineCards(next);
    });
    setTaskLineInput('');
    setTaskLineDirty(true);
  }

  function openTaskLineEditModalForCard(cardId: string) {
    if (busy) return;
    const id = String(cardId || '').trim();
    if (!id) return;
    const found = normalizeTaskLineCards(taskLineCards).find((c) => c.id === id) ?? null;
    if (!found) return;
    setTaskLineModalCardId(found.id);
    setTaskLineModalInitialText(found.text ?? '');
    setTaskLineModalInitialWeekday(taskLineWeekdayFromLane(found.lane));
    setTaskLineModalOpen(true);
    setTaskLineEditingId(found.id);
  }

  function openTaskLineEditModalForNew(defaultLane: TaskLineLane) {
    if (busy) return;
    setTaskLineModalCardId(null);
    setTaskLineModalInitialText('');
    setTaskLineModalInitialWeekday(taskLineWeekdayFromLane(defaultLane));
    setTaskLineModalOpen(true);
    setTaskLineEditingId('new');
  }

  function closeTaskLineEditModal() {
    setTaskLineModalOpen(false);
    setTaskLineModalCardId(null);
    setTaskLineModalInitialText('');
    setTaskLineModalInitialWeekday('');
    setTaskLineEditingId(null);
  }

  function saveTaskLineEditModal(draft: { text: string; weekday: TaskLineWeekday | '' }) {
    const text = String(draft?.text || '').trim();
    if (!text) return;
    const nextLane = taskLineLaneFromWeekday(draft.weekday);

    const editingId = taskLineModalCardId;

    // create
    if (!editingId) {
      const id = newId();
      setTaskLineCards((prev) => {
        const normalized = normalizeTaskLineCards(prev);
        const next = [{ id, text, lane: nextLane, order: -1 }, ...normalized];
        return normalizeTaskLineCards(next);
      });
      setTaskLineDirty(true);
      setTaskLineRemoteUpdatePending(false);
      closeTaskLineEditModal();
      return;
    }

    // update
    setTaskLineCards((prev) => {
      const normalized = normalizeTaskLineCards(prev);
      const cur = normalized.find((c) => c.id === editingId) ?? null;
      const laneChanged = !!cur && cur.lane !== nextLane;
      const next = normalized.map((c) => (c.id === editingId ? { ...c, text, lane: nextLane, order: laneChanged ? 9999 : c.order } : c));
      return normalizeTaskLineCards(next);
    });
    setTaskLineDirty(true);
    setTaskLineRemoteUpdatePending(false);
    closeTaskLineEditModal();
  }

  function deleteTaskLineFromModal() {
    const id = String(taskLineModalCardId || '').trim();
    if (!id) {
      closeTaskLineEditModal();
      return;
    }
    deleteTaskLineCard(id);
    setTaskLineRemoteUpdatePending(false);
    closeTaskLineEditModal();
  }

  function addTaskLineCardAtStart(lane: TaskLineLane = 'stock') {
    openTaskLineEditModalForNew(lane);
  }

  function updateTaskLineCardText(id: string, text: string) {
    setTaskLineCards((prev) => normalizeTaskLineCards(prev.map((c) => (c.id === id ? { ...c, text } : c))));
    setTaskLineDirty(true);
  }

  function deleteTaskLineCard(id: string) {
    setTaskLineCards((prev) => normalizeTaskLineCards(prev.filter((c) => c.id !== id)));
    setTaskLineEditingId((cur) => (cur === id ? null : cur));
    setTaskLineDirty(true);
  }

  useEffect(() => {
    document.body.classList.toggle('sidebar-open', sidebarOpen);
    return () => {
      document.body.classList.remove('sidebar-open');
    };
  }, [sidebarOpen]);

  useEffect(() => {
    document.body.classList.toggle('sidebar-desktop-collapsed', !!sidebarDesktopCollapsed);
    try {
      window.localStorage.setItem('nippoSidebarDesktopCollapsed', sidebarDesktopCollapsed ? '1' : '0');
    } catch {
      // ignore
    }
    return () => {
      document.body.classList.remove('sidebar-desktop-collapsed');
    };
  }, [sidebarDesktopCollapsed]);

  function holidayCalendarSnapshot(monthDate: Date, holidays: Set<string>) {
    const y = monthDate.getFullYear();
    const m = String(monthDate.getMonth() + 1).padStart(2, '0');
    const monthKey = `${y}-${m}-01`;
    const list = Array.from(holidays).slice().sort();
    return JSON.stringify({ month: monthKey, holidays: list });
  }

  function readHolidayCalendarDraft() {
    try {
      const raw = localStorage.getItem('nippoHolidayCalendarData');
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      const holidays = Array.isArray(parsed?.holidays) ? parsed.holidays.filter((x: any) => typeof x === 'string') : [];
      const monthStr = typeof parsed?.month === 'string' ? parsed.month : '';
      let monthDate: Date | null = null;
      if (monthStr) {
        const m = new Date(monthStr);
        if (!Number.isNaN(m.getTime())) monthDate = new Date(m.getFullYear(), m.getMonth(), 1);
      }
      return { monthDate, holidays };
    } catch {
      return null;
    }
  }

  function writeHolidayCalendarDraft(monthDate: Date, holidays: Set<string>) {
    try {
      const data = {
        holidays: Array.from(holidays),
        month: monthDate.toISOString(),
      };
      localStorage.setItem('nippoHolidayCalendarData', JSON.stringify(data));
    } catch {
      // ignore
    }
  }

  async function loadHolidayCalendarFromServer() {
    if (!accessToken) return;
    setHolidayCalendarSyncing(true);
    setHolidayCalendarCopyError(null);
    try {
      const res = await apiFetch('/api/holiday-calendar');
      const body = await res.json();
      if (!res.ok || !body?.success) throw new Error(body?.error || 'カレンダーの同期に失敗しました');

      const cal = body?.calendar;
      if (cal && typeof cal === 'object') {
        const holidays = Array.isArray(cal.holidays) ? cal.holidays.filter((x: any) => typeof x === 'string') : [];
        const monthStr = typeof cal.month === 'string' ? cal.month : '';

        setHolidayCalendarHolidays(new Set(holidays));
        if (monthStr && /^\d{4}-\d{2}-\d{2}$/.test(monthStr)) {
          const y = parseInt(monthStr.slice(0, 4), 10);
          const m0 = parseInt(monthStr.slice(5, 7), 10) - 1;
          if (!Number.isNaN(y) && !Number.isNaN(m0)) setHolidayCalendarMonth(new Date(y, m0, 1));
        }

        const snapshot = holidayCalendarSnapshot(
          monthStr && /^\d{4}-\d{2}-\d{2}$/.test(monthStr)
            ? new Date(parseInt(monthStr.slice(0, 4), 10), parseInt(monthStr.slice(5, 7), 10) - 1, 1)
            : holidayCalendarMonth,
          new Set(holidays)
        );
        setHolidayCalendarLastSavedSnapshot(snapshot);
        setHolidayCalendarDirty(false);
        setHolidayCalendarHasSaved(true);
        setHolidayCalendarLoaded(true);
        return;
      }

      // No server data yet: fallback to local draft (migration)
      const draft = readHolidayCalendarDraft();
      if (draft?.holidays) setHolidayCalendarHolidays(new Set(draft.holidays));
      if (draft?.monthDate) setHolidayCalendarMonth(draft.monthDate);

      setHolidayCalendarHasSaved(false);
      setHolidayCalendarDirty(false);
      setHolidayCalendarLastSavedSnapshot('');
      setHolidayCalendarLoaded(true);
    } catch (e: any) {
      setHolidayCalendarCopyError(e?.message || String(e));
      setHolidayCalendarLoaded(true);
    } finally {
      setHolidayCalendarSyncing(false);
    }
  }

  // calendar tab でも「おやすみ日」を表示したいので、ログイン後に一度だけ取得しておく
  useEffect(() => {
    if (!accessToken) return;
    if (holidayCalendarLoaded) return;
    void loadHolidayCalendarFromServer();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [accessToken, holidayCalendarLoaded]);

  async function saveHolidayCalendarToServer() {
    if (!accessToken) return;
    setHolidayCalendarSyncing(true);
    setHolidayCalendarCopyError(null);
    try {
      const y = holidayCalendarMonth.getFullYear();
      const m = String(holidayCalendarMonth.getMonth() + 1).padStart(2, '0');
      const monthKey = `${y}-${m}-01`;
      const holidays = Array.from(holidayCalendarHolidays);
      const res = await apiFetch('/api/holiday-calendar', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ month: monthKey, holidays }),
      });
      const body = await res.json();
      if (!res.ok || !body?.success) throw new Error(body?.error || '保存に失敗しました');

      const snapshot = holidayCalendarSnapshot(holidayCalendarMonth, holidayCalendarHolidays);
      setHolidayCalendarLastSavedSnapshot(snapshot);
      setHolidayCalendarDirty(false);
      setHolidayCalendarHasSaved(true);
    } catch (e: any) {
      setHolidayCalendarCopyError(e?.message || String(e));
    } finally {
      setHolidayCalendarSyncing(false);
    }
  }

  async function requestCloseHolidayCalendar() {
    if (holidayCalendarExporting || holidayCalendarSyncing) return;

    if (!accessToken) {
      setHolidayCalendarOpen(false);
      return;
    }

    if (!holidayCalendarHasSaved || holidayCalendarDirty) {
      const ok = window.confirm('保存していない変更があります。閉じますか？');
      if (!ok) return;
      await saveHolidayCalendarToServer();
      // 保存に失敗した場合はエラー文言が入るので閉じない
      if (holidayCalendarCopyError) return;
    }

    setHolidayCalendarOpen(false);
  }

  useEffect(() => {
    if (!holidayCalendarOpen) return;
    // local draft first (instant), then server (when logged in)
    const draft = readHolidayCalendarDraft();
    if (draft) {
      if (draft.holidays) setHolidayCalendarHolidays(new Set(draft.holidays));
      if (draft.monthDate) setHolidayCalendarMonth(draft.monthDate);
    }
    if (accessToken) void loadHolidayCalendarFromServer();
    else setHolidayCalendarLoaded(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [holidayCalendarOpen, accessToken]);

  useEffect(() => {
    // persist holiday calendar data
    if (!holidayCalendarLoaded) return;
    writeHolidayCalendarDraft(holidayCalendarMonth, holidayCalendarHolidays);

    const snap = holidayCalendarSnapshot(holidayCalendarMonth, holidayCalendarHolidays);
    if (accessToken) {
      const saved = holidayCalendarLastSavedSnapshot;
      if (!holidayCalendarHasSaved) {
        // unsaved to server (migration/new)
        setHolidayCalendarDirty(false);
      } else {
        setHolidayCalendarDirty(saved ? snap !== saved : true);
      }
    }
  }, [holidayCalendarLoaded, holidayCalendarHolidays, holidayCalendarMonth, accessToken, holidayCalendarHasSaved, holidayCalendarLastSavedSnapshot]);

  useEffect(() => {
    return () => {
      if (holidayCalendarToastTimerRef.current != null) {
        window.clearTimeout(holidayCalendarToastTimerRef.current);
        holidayCalendarToastTimerRef.current = null;
      }
    };
  }, []);

  useEffect(() => {
    const client = supabase;
    if (!client) return;

    let cancelled = false;

    async function bootstrap(nonNullClient: SupabaseClient) {
      const { data } = await nonNullClient.auth.getSession();
      if (cancelled) return;
      const session = data.session;
      setAccessToken(session?.access_token ?? null);
      setUserId(session?.user?.id ?? null);
      setUserEmail(session?.user?.email ?? null);
    }

    bootstrap(client);

    const { data: sub } = client.auth.onAuthStateChange((_event, session) => {
      setAccessToken(session?.access_token ?? null);
      setUserId(session?.user?.id ?? null);
      setUserEmail(session?.user?.email ?? null);
    });

    return () => {
      cancelled = true;
      sub.subscription.unsubscribe();
    };
  }, [supabase]);

  useEffect(() => {
    if (!accessToken) {
      setTasks([]);
      setHistoryDates([]);
      setHistoryDate('');
      setHistoryTasks([]);
      setHistoryStats(null);
      setReportUrls([]);
      setActiveReportTabId(null);
      setReportSingleContent('');
      setReportTabContent({});
      setTagStock([]);
      setTempTagStock([]);
      setTagInput('');
      setTagDirty(false);
      setGoalStock([]);
      setTempGoalStock([]);
      setGoalInput('');
      setGoalDirty(false);
      setTaskStock([]);
      setTempTaskStock([]);
      setTaskStockInput('');
      setTaskStockDirty(false);
      setTaskStockLoaded(false);
      setEditOpen(false);
      setEditingTaskId('');
      setEditingTaskDateKey(null);
      setEditName('');
      setEditTag('');
      setEditStartTime('');
      setEditEndTime('');
      setEditTrackedOverride(null);
      setSettingsTimeRoundingInterval(0);
      setSettingsTimeRoundingMode('nearest');
      setSettingsExcludeTaskNames([]);
      setSettingsExcludeTaskNameInput('');
      setSettingsReservationNotifyEnabled(false);
      setSettingsReservationNotifyMinutesBefore([]);
      setSettingsReservationNotifyMinutesInput('');
      setSettingsAutoShowTimelineOnIdle(false);
      setSettingsTimeZone(DEFAULT_TIME_ZONE);
      setSettingsDirty(false);
      setSettingsRemoteUpdatePending(false);

      setBillingOpen(false);
      setBillingMode('hourly');
      setBillingHourlyRate('');
      setBillingDailyRate('');
      setBillingClosingDay('31');
      setBillingHourlyCapHours('');
      setBillingDirty(false);
      setBillingRemoteUpdatePending(false);
      setBillingLoading(false);
      setBillingError(null);
      setBillingSummary(null);
      setUserId(null);
      return;
    }
    void reloadTasks();
    void loadHistoryDates();
    void loadReportUrls();
    void loadReportSingle();
    void loadTagStock();
    void loadGoalStock();
    void loadTaskStock();
    void loadSettings();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [accessToken]);

  async function loadTagStock() {
    if (!accessToken) return;
    try {
      const res = await apiFetch('/api/tags');
      const body = await res.json();
      if (!res.ok || !body?.success) return;
      const raw = Array.isArray(body.tags) ? body.tags : [];
      const items: TagStockItem[] = raw
        .map((t: any) => {
          if (!t) return null;
          if (typeof t === 'string') return { id: undefined, name: t } as TagStockItem;
          if (typeof t === 'object') {
            const name = String(t.name ?? '').trim();
            if (!name) return null;
            const id = t.id != null ? String(t.id) : undefined;
            return { id, name } as TagStockItem;
          }
          return null;
        })
        .filter(Boolean) as TagStockItem[];
      setTagStock(items);
    } catch {
      // ignore
    }
  }

  async function loadGoalStock() {
    if (!accessToken) return;
    try {
      const res = await apiFetch('/api/goals');
      const body = await res.json();
      if (!res.ok || !body?.success) return;
      const goals = Array.isArray(body.goals) ? body.goals : [];
      const normalized = goals
        .map((g: any) => {
          if (!g) return null;
          const name = String(g.name ?? '').trim();
          if (!name) return null;
          return { name };
        })
        .filter(Boolean) as Array<{ name: string }>;
      setGoalStock(normalized);
      setTempGoalStock(JSON.parse(JSON.stringify(normalized)));
      setGoalDirty(false);
    } catch {
      // ignore
    }
  }

  async function saveGoalStockChanges() {
    if (!accessToken) return;
    setBusy(true);
    setError(null);
    try {
      const res = await apiFetch('/api/goals', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ goals: tempGoalStock }),
      });
      const body = await res.json();
      if (!res.ok || !body?.success) throw new Error(body?.error || '保存に失敗しました');
      setGoalStock(JSON.parse(JSON.stringify(tempGoalStock)));
      setGoalDirty(false);
      setGoalStockOpen(false);
    } catch (e: any) {
      setError(e?.message || String(e));
    } finally {
      setBusy(false);
    }
  }

  async function loadTaskStock() {
    if (!accessToken) return;
    try {
      const res = await apiFetch('/api/task-stock');
      const body = await res.json();
      if (!res.ok || !body?.success) return;
      const raw = Array.isArray(body.tasks) ? body.tasks : [];
      const normalized = raw
        .map((t: any) => {
          if (typeof t === 'string') return t;
          if (t && typeof t === 'object' && t.name) return String(t.name);
          if (t == null) return null;
          return String(t);
        })
        .filter((x: any) => typeof x === 'string' && x.trim())
        .map((x: string) => x.trim());
      setTaskStock(normalized);
      setTempTaskStock(JSON.parse(JSON.stringify(normalized)));
      setTaskStockDirty(false);
      setTaskStockLoaded(true);
    } catch {
      // ignore
    }
  }

  async function saveTaskStockChanges() {
    if (!accessToken) return;
    setBusy(true);
    setError(null);
    try {
      const res = await apiFetch('/api/task-stock', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tasks: tempTaskStock }),
      });
      const body = await res.json();
      if (!res.ok || !body?.success) throw new Error(body?.error || '保存に失敗しました');
      setTaskStock(JSON.parse(JSON.stringify(tempTaskStock)));
      setTaskStockDirty(false);
      setTaskStockOpen(false);
    } catch (e: any) {
      setError(e?.message || String(e));
    } finally {
      setBusy(false);
    }
  }

  async function addTextToTaskStock(nameRaw: string) {
    if (!accessToken) return;
    const name = String(nameRaw ?? '').trim();
    if (!name) return;

    setBusy(true);
    setError(null);
    try {
      // Prefer already-loaded task stock, otherwise fetch once.
      let current = taskStock;
      if (!taskStockLoaded) {
        const res = await apiFetch('/api/task-stock');
        const body = await res.json();
        if (res.ok && body?.success) {
          const raw = Array.isArray(body.tasks) ? body.tasks : [];
          current = raw
            .map((t: any) => {
              if (typeof t === 'string') return t;
              if (t && typeof t === 'object' && t.name) return String(t.name);
              if (t == null) return null;
              return String(t);
            })
            .filter((x: any) => typeof x === 'string' && x.trim())
            .map((x: string) => x.trim());
        }
      }

      // newest-first (ensure newly added task appears at top of stock/suggestions)
      const merged = normalizeTaskNameList([name, ...(Array.isArray(current) ? current : [])]);
      const alreadySame =
        Array.isArray(current) &&
        current.length === merged.length &&
        current.every((v, i) => v === merged[i]);

      if (!alreadySame) {
        const res = await apiFetch('/api/task-stock', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ tasks: merged }),
        });
        const body = await res.json();
        if (!res.ok || !body?.success) throw new Error(body?.error || 'タスクストックへの追加に失敗しました');
      }

      setTaskStock(JSON.parse(JSON.stringify(merged)));
      setTempTaskStock(JSON.parse(JSON.stringify(merged)));
      setTaskStockDirty(false);
      setTaskStockLoaded(true);
    } catch (e: any) {
      setError(e?.message || String(e));
    } finally {
      setBusy(false);
    }
  }

  async function removeTextFromTaskStock(nameRaw: string) {
    if (!accessToken) return;
    const name = String(nameRaw ?? '').trim();
    if (!name) return;

    setBusy(true);
    setError(null);
    try {
      // Prefer already-loaded task stock, otherwise fetch once.
      let current = taskStock;
      if (!taskStockLoaded) {
        const res = await apiFetch('/api/task-stock');
        const body = await res.json();
        if (res.ok && body?.success) {
          const raw = Array.isArray(body.tasks) ? body.tasks : [];
          current = raw
            .map((t: any) => {
              if (typeof t === 'string') return t;
              if (t && typeof t === 'object' && t.name) return String(t.name);
              if (t == null) return null;
              return String(t);
            })
            .filter((x: any) => typeof x === 'string' && x.trim())
            .map((x: string) => x.trim());
        }
      }

      const next = (Array.isArray(current) ? current : []).filter((t) => String(t ?? '').trim() !== name);
      const alreadySame =
        Array.isArray(current) &&
        current.length === next.length &&
        current.every((v, i) => v === next[i]);

      if (!alreadySame) {
        const res = await apiFetch('/api/task-stock', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ tasks: next }),
        });
        const body = await res.json();
        if (!res.ok || !body?.success) throw new Error(body?.error || 'タスクストックからの解除に失敗しました');
      }

      setTaskStock(JSON.parse(JSON.stringify(next)));
      setTempTaskStock(JSON.parse(JSON.stringify(next)));
      setTaskStockDirty(false);
      setTaskStockLoaded(true);
    } catch (e: any) {
      setError(e?.message || String(e));
    } finally {
      setBusy(false);
    }
  }

  async function loadSettings() {
    if (!accessToken) return;
    try {
      const res = await apiFetch('/api/settings');
      const body = await res.json();
      if (!res.ok || !body?.success) return;
      const s = body.settings || {};
      const interval = Number(s?.timeRounding?.interval ?? 0);
      const mode = String(s?.timeRounding?.mode ?? 'nearest');
      setSettingsTimeRoundingInterval(Number.isFinite(interval) ? interval : 0);
      setSettingsTimeRoundingMode(mode === 'floor' || mode === 'ceil' || mode === 'nearest' ? (mode as any) : 'nearest');
      setSettingsExcludeTaskNames(normalizeTaskNameList(s?.workTime?.excludeTaskNames));
      setSettingsExcludeTaskNameInput('');

      const n = s?.notifications?.reservations || {};
      const enabled = !!n?.enabled;
      const minutesBefore = normalizeNotifyMinutesBeforeList(n?.minutesBefore);
      setSettingsReservationNotifyEnabled(enabled);
      setSettingsReservationNotifyMinutesBefore(minutesBefore);
      setSettingsReservationNotifyMinutesInput('');

      const ui = s?.ui || {};
      setSettingsAutoShowTimelineOnIdle(!!ui?.autoShowTimelineOnIdle);
      setSettingsTimeZone(normalizeTimeZone(ui?.timeZone || DEFAULT_TIME_ZONE));

      setSettingsDirty(false);
      setSettingsRemoteUpdatePending(false);

      const b = s?.billing || {};
      const wt = s?.workTime || {};
      const bMode = String(b?.mode ?? 'hourly') === 'daily' ? 'daily' : 'hourly';
      setBillingMode(bMode as any);
      setBillingHourlyRate(Number.isFinite(Number(b?.hourlyRate)) ? String(Number(b?.hourlyRate)) : '');
      setBillingDailyRate(Number.isFinite(Number(b?.dailyRate)) ? String(Number(b?.dailyRate)) : '');
      setBillingClosingDay(Number.isFinite(Number(b?.closingDay)) ? String(Math.trunc(Number(b?.closingDay))) : '31');
      // 1日の労働時間上限（後方互換: billing.hourlyCapHours）
      const dailyCapHours = Number(wt?.dailyCapHours);
      const legacyCapHours = Number(b?.hourlyCapHours);
      const capHours = Number.isFinite(dailyCapHours) ? dailyCapHours : Number.isFinite(legacyCapHours) ? legacyCapHours : NaN;
      setBillingHourlyCapHours(Number.isFinite(capHours) ? String(capHours) : '');
      setBillingDirty(false);
      setBillingRemoteUpdatePending(false);

      try {
        const r2 = await apiFetch('/api/gpt-api-key');
        const b2 = await r2.json().catch(() => null as any);
        if (r2.ok && b2?.success) {
          setSettingsGptApiKeySaved(!!b2?.hasKey);
          setSettingsGptEncryptionReady(typeof b2?.encryptionReady === 'boolean' ? b2.encryptionReady : null);
        }
      } catch {
        // ignore
      }
    } catch {
      // ignore
    }
  }

  async function saveSettings() {
    if (!accessToken) return;
    setBusy(true);
    setError(null);
    try {
      const excludeTaskNames = normalizeTaskNameList(settingsExcludeTaskNames);
      const minutesBefore = normalizeNotifyMinutesBeforeList(settingsReservationNotifyMinutesBefore);
      const res = await apiFetch('/api/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          settings: {
            timeRounding: {
              interval: settingsTimeRoundingInterval,
              mode: settingsTimeRoundingMode,
            },
            workTime: {
              excludeTaskNames,
            },
            notifications: {
              reservations: {
                enabled: !!settingsReservationNotifyEnabled,
                minutesBefore,
              },
            },
            ui: {
              autoShowTimelineOnIdle: !!settingsAutoShowTimelineOnIdle,
              timeZone: activeTimeZone,
            },
          },
        }),
      });
      const body = await res.json();
      if (!res.ok || !body?.success) throw new Error(body?.error || '保存に失敗しました');

      const gptKey = settingsGptApiKeyInput.trim();
      if (gptKey) {
        if (settingsGptEncryptionReady === false) {
          throw new Error('サーバ側の GPT_API_KEY_ENCRYPTION_SECRET が未設定のため、APIキーを保存できません');
        }
        const r2 = await apiFetch('/api/gpt-api-key', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ apiKey: gptKey }),
        });
        const b2 = await r2.json().catch(() => null as any);
        if (!r2.ok || !b2?.success) throw new Error(b2?.error || 'GPT APIキーの保存に失敗しました');
        setSettingsGptApiKeyInput('');
        setSettingsGptApiKeySaved(true);
      }

      setSettingsDirty(false);
      setSettingsRemoteUpdatePending(false);
      setSettingsOpen(false);
    } catch (e: any) {
      setError(e?.message || String(e));
    } finally {
      setBusy(false);
    }
  }

  function getActiveReportText() {
    if (activeReportTabId) return reportTabContent[activeReportTabId] ?? '';
    return reportSingleContent;
  }

  function setActiveReportText(next: string) {
    if (activeReportTabId) {
      setReportTabContent((p) => ({ ...p, [activeReportTabId]: next }));
    } else {
      setReportSingleContent(next);
    }
  }

  async function gptGenerateReportFromTimeline() {
    if (!accessToken) return;
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const parseYmdToUtcDate = (ymd: string) => {
        const m = String(ymd || '').trim().match(/^(\d{4})-(\d{2})-(\d{2})$/);
        if (!m) return null;
        const y = Number(m[1]);
        const mo = Number(m[2]);
        const d = Number(m[3]);
        const dt = new Date(Date.UTC(y, mo - 1, d, 0, 0, 0));
        if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== mo - 1 || dt.getUTCDate() !== d) return null;
        return dt;
      };

      const listDatesInclusive = (startYmd: string, endYmd: string) => {
        const start = parseYmdToUtcDate(startYmd);
        const end = parseYmdToUtcDate(endYmd);
        if (!start || !end) return [] as string[];
        const out: string[] = [];
        const cur = new Date(start.getTime());
        while (cur.getTime() <= end.getTime()) {
          out.push(ymdKeyFromParts(cur.getUTCFullYear(), cur.getUTCMonth(), cur.getUTCDate()));
          cur.setUTCDate(cur.getUTCDate() + 1);
          if (out.length > 366) break;
        }
        return out;
      };

      const todayKey = todayYmd;
      let startYmd = String(gptReportRangeStart || '').trim();
      let endYmd = String(gptReportRangeEnd || '').trim();
      if (!startYmd) startYmd = todayKey;
      if (!endYmd) endYmd = todayKey;
      startYmd = normalizeYmd(startYmd);
      endYmd = normalizeYmd(endYmd);
      if (startYmd > endYmd) {
        const tmp = startYmd;
        startYmd = endYmd;
        endYmd = tmp;
      }

      const dateList = listDatesInclusive(startYmd, endYmd);
      if (dateList.length === 0) throw new Error('期間の形式が不正です（yyyy-mm-dd）');
      if (dateList.length > 31) throw new Error('期間が長すぎます（最大31日まで）');

      const payloadTasks: Array<{ dateString: string; name: string; memo: string }> = [];
      for (const dateString of dateList) {
        let dayTasks: any[] = [];
        if (dateString === todayKey && effectiveViewMode === 'today') {
          dayTasks = Array.isArray(tasks) ? tasks : [];
        } else {
          const resTasks = await apiFetch(`/api/tasks?dateString=${encodeURIComponent(dateString)}`);
          const bodyTasks = await resTasks.json().catch(() => null as any);
          if (!resTasks.ok || !bodyTasks?.success) {
            throw new Error(bodyTasks?.error || 'タスクの取得に失敗しました');
          }
          dayTasks = Array.isArray(bodyTasks?.tasks) ? bodyTasks.tasks : [];
        }

        for (const t of dayTasks) {
          if (!t || t.status === 'reserved') continue;
          const memo = typeof t?.memo === 'string' ? t.memo : '';
          if (!String(memo).trim()) continue;
          payloadTasks.push({
            dateString,
            name: String(t?.name || ''),
            memo,
          });
        }
      }

      const res = await apiFetch('/api/gpt/report-from-timeline', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tasks: payloadTasks }),
      });
      const body = await res.json().catch(() => null as any);
      if (!res.ok || !body?.success) throw new Error(body?.error || '生成に失敗しました');
      const text = String(body?.text || '').trim();
      if (!text) throw new Error('生成結果が空です');
      setActiveReportText(text);
    } catch (e: any) {
      setError(e?.message || String(e));
    } finally {
      setBusy(false);
    }
  }

  async function fetchBillingSummary(offset = billingPeriodOffset) {
    if (!accessToken) return;
    setBillingLoading(true);
    setBillingError(null);
    try {
      const o = Number(offset) || 0;
      const path = `/api/billing-summary${o ? `?offset=${encodeURIComponent(String(o))}` : ''}`;
      const res = await apiFetch(path);
      const body = await res.json().catch(() => null as any);
      if (!res.ok || !body?.success) throw new Error(body?.error || '請求の集計に失敗しました');
      setBillingSummary(body.summary || null);
    } catch (e: any) {
      setBillingError(e?.message || String(e));
      setBillingSummary(null);
    } finally {
      setBillingLoading(false);
    }
  }

  async function saveBillingSettings() {
    if (!accessToken) return;
    setBusy(true);
    setBillingError(null);
    try {
      const closingDayNum = Math.max(1, Math.min(31, parseInt(billingClosingDay || '31', 10) || 31));
      const mode = billingMode === 'daily' ? 'daily' : 'hourly';
      const hourlyRateNum = Number(billingHourlyRate);
      const dailyRateNum = Number(billingDailyRate);
      const capNum = Number(billingHourlyCapHours);
      const capHours = Number.isFinite(capNum) ? capNum : 0;

      const res = await apiFetch('/api/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          settings: {
            billing: {
              mode,
              closingDay: closingDayNum,
              hourlyRate: Number.isFinite(hourlyRateNum) ? hourlyRateNum : 0,
              dailyRate: Number.isFinite(dailyRateNum) ? dailyRateNum : 0,
              // 後方互換のため billing 側にも残す
              hourlyCapHours: capHours,
            },
            workTime: {
              // 1日の労働時間上限（時間/日）
              dailyCapHours: capHours,
            },
          },
        }),
      });
      const body = await res.json().catch(() => null as any);
      if (!res.ok || !body?.success) throw new Error(body?.error || '保存に失敗しました');

      setBillingDirty(false);
      setBillingRemoteUpdatePending(false);
      await fetchBillingSummary();
    } catch (e: any) {
      setBillingError(e?.message || String(e));
    } finally {
      setBusy(false);
    }
  }

  // realtime: settings doc updates (Supabase Realtime)
  useEffect(() => {
    const client = supabase;
    if (!client) return;
    if (!accessToken) return;
    if (!userId) return;

    const channel = client
      .channel(`nippo_docs:${userId}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'nippo_docs',
          filter: `user_id=eq.${userId}`,
        },
        (payload: any) => {
          const docType = payload?.new?.doc_type ?? payload?.old?.doc_type ?? null;
          const docKey = payload?.new?.doc_key ?? payload?.old?.doc_key ?? null;
          if (docType === 'settings' && docKey === 'default') {
            if (settingsOpen && settingsDirty) {
              setSettingsRemoteUpdatePending(true);
              return;
            }
            if (billingOpen && billingDirty) {
              setBillingRemoteUpdatePending(true);
              return;
            }
            void loadSettings();
            if (billingOpen) void fetchBillingSummary();
            return;
          }

          if (docType === 'holiday_calendar' && docKey === 'default') {
            if (holidayCalendarOpen && !holidayCalendarDirty) void loadHolidayCalendarFromServer();
            return;
          }

          if (docType === 'taskline' && typeof docKey === 'string' && docKey === taskLineDateKey) {
            if (effectiveViewMode === 'history') return;
            if (taskLineEditingId || taskLineDraggingId) return;
            if (taskLineDirty) {
              setTaskLineRemoteUpdatePending(true);
              return;
            }
            if (taskLineIsSavingRef.current) return;
            void loadTaskLineFromServer(taskLineDateKey);
            return;
          }

          if (docType === 'notes' && typeof docKey === 'string' && docKey === NOTES_GLOBAL_KEY) {
            if (effectiveViewMode === 'history') return;
            if (notesEditingId) return;
            if (notesDirty) {
              setNotesRemoteUpdatePending(true);
              return;
            }
            if (notesIsSavingRef.current) return;
            void loadNotesFromServer();
            return;
          }

          if (docType === 'alerts' && typeof docKey === 'string' && docKey === ALERTS_GLOBAL_KEY) {
            if (effectiveViewMode === 'history') return;
            if (alertModalOpen) return;
            if (alertsDirty) {
              setAlertsRemoteUpdatePending(true);
              return;
            }
            if (alertsIsSavingRef.current) return;
            void loadAlertsFromServer();
            return;
          }

          if (docType === 'gantt' && typeof docKey === 'string' && docKey === GANTT_GLOBAL_KEY) {
            if (effectiveViewMode === 'history') return;
            if (ganttEditingId) return;
            if (ganttDirty || ganttIsInteractingRef.current) {
              setGanttRemoteUpdatePending(true);
              return;
            }
            if (ganttIsSavingRef.current) return;
            void loadGanttFromServer();
            return;
          }

          if (docType === 'calendar' && typeof docKey === 'string' && docKey === CALENDAR_GLOBAL_KEY) {
            if (effectiveViewMode === 'history') return;
            if (calendarEditingIdRef.current) return;
            if (calendarDirty || calendarIsInteractingRef.current) {
              setCalendarRemoteUpdatePending(true);
              return;
            }
            if (calendarIsSavingRef.current) return;
            void loadCalendarFromServer();
            return;
          }

          if (docType === 'tasks' && billingOpen) {
            void fetchBillingSummary();
          }
        }
      )
      .subscribe();

    return () => {
      try {
        client.removeChannel(channel);
      } catch {
        // ignore
      }
    };
  }, [
    supabase,
    accessToken,
    userId,
    settingsOpen,
    settingsDirty,
    billingOpen,
    billingDirty,
    holidayCalendarOpen,
    holidayCalendarDirty,
    taskLineDateKey,
    taskLineEditingId,
    taskLineDraggingId,
    taskLineDirty,
    ganttEditingId,
    ganttDirty,
    calendarDirty,
    notesEditingId,
    notesDirty,
    alertModalOpen,
    alertsDirty,
    effectiveViewMode,
  ]);

  useEffect(() => {
    if (!accessToken) return;
    if (!billingOpen) return;
    void loadSettings();
    setBillingPeriodOffset(0);
    void fetchBillingSummary(0);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [accessToken, billingOpen]);

  async function saveTagStockChanges() {
    if (!accessToken) return;
    setBusy(true);
    setError(null);
    try {
      const res = await apiFetch('/api/tags', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tags: tempTagStock }),
      });
      const body = await res.json();
      if (!res.ok || !body?.success) throw new Error(body?.error || '保存に失敗しました');
      setTagStock(JSON.parse(JSON.stringify(tempTagStock)));
      setTagDirty(false);
      setTagStockOpen(false);
    } catch (e: any) {
      setError(e?.message || String(e));
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => {
    if (!accessToken) return;
    if (!goalStockOpen) return;
    void loadGoalStock();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [accessToken, goalStockOpen]);

  useEffect(() => {
    if (!accessToken) return;
    if (!taskStockOpen) return;
    // まず手元のキャッシュを即表示（モーダルを開いた瞬間に内容が出る）
    setTempTaskStock(JSON.parse(JSON.stringify(taskStock)));
    setTaskStockDirty(false);

    // 未ロード時のみ裏で取得（初回でも遅延感を最小化）
    if (!taskStockLoaded) void loadTaskStock();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [accessToken, taskStockOpen, taskStock, taskStockLoaded]);

  useEffect(() => {
    if (!accessToken) return;
    if (!tagStockOpen) return;
    setTempTagStock(JSON.parse(JSON.stringify(tagStock)));
    setTagDirty(false);
  }, [accessToken, tagStockOpen, tagStock]);

  useEffect(() => {
    if (!accessToken) return;
    if (!settingsOpen) return;
    void loadSettings();
    void loadReportUrls();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [accessToken, settingsOpen]);

  useEffect(() => {
    if (!accessToken) return;
    // 通知などのため、設定画面を開かなくても一度は取得しておく
    void loadSettings();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [accessToken]);

  useEffect(() => {
    if (!accessToken) return;
    if (reportUrls.length === 0) return;
    const tabId = activeReportTabId ?? String(reportUrls[0]?.id ?? '');
    if (!tabId) return;
    setActiveReportTabId(tabId);
    void loadReportTab(tabId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [accessToken, reportUrls.length]);

  async function apiFetch(path: string, init?: RequestInit) {
    if (!accessToken) throw new Error('Not logged in');
    const headers = new Headers(init?.headers);
    headers.set('Authorization', `Bearer ${accessToken}`);
    return fetch(path, { ...init, headers });
  }

  async function reloadTasksInternal(opts: { silent: boolean }) {
    const silent = !!opts?.silent;
    if (!silent) setError(null);
    try {
      const res = await apiFetch('/api/tasks', { cache: 'no-store' });
      const body = await res.json();
      if (!res.ok || !body?.success) {
        throw new Error(body?.error || 'タスク取得に失敗しました');
      }
      setTasks(Array.isArray(body.tasks) ? body.tasks : []);
    } catch (e: any) {
      if (!silent) setError(e?.message || String(e));
    }
  }

  async function reloadTasks() {
    await reloadTasksInternal({ silent: false });
  }

  async function reloadTasksSilent() {
    await reloadTasksInternal({ silent: true });
  }

  function showReservationToast(message: string) {
    floating?.push({ text: message, tone: 'success', icon: 'notifications', ttlMs: 6000 });
  }

  function notifyReservationTask(opts: { task: Task; startTimeMinutes: number; minutesBefore: number }) {
    const name = String(opts.task?.name || '').trim() || '（無題）';
    showReservationToast(name);

    if (typeof window === 'undefined') return;
    if (!('Notification' in window)) return;
    if (reservationNotificationPermissionRef.current !== 'granted') return;
    try {
      // tag を付けて同一キーの多重表示を抑制
      const tag = `nippo:reserved:${opts.task.id}:${opts.task.startTime ?? ''}:${opts.minutesBefore}`;
      const n = new Notification(name, { tag });
      n.onclick = () => {
        try {
          setViewMode('today');
          window.focus();
        } catch {
          // ignore
        }

        // 可能ならアプリのトップへ寄せる（別ルートで開いている場合の保険）
        try {
          if (typeof window.location?.pathname === 'string' && window.location.pathname !== '/') {
            window.location.assign('/');
          }
        } catch {
          // ignore
        }

        try {
          n.close();
        } catch {
          // ignore
        }
      };
    } catch {
      // ignore
    }
  }

  function clearReservationNotificationSchedule() {
    for (const id of reservationNotifyTimeoutsRef.current.values()) {
      try {
        window.clearTimeout(id);
      } catch {
        // ignore
      }
    }
    reservationNotifyTimeoutsRef.current.clear();
  }

  function fireDueReservationNotifications() {
    if (!settingsReservationNotifyEnabledRef.current) return;
    if (effectiveViewMode === 'history') return;

    const minutesBeforeList = normalizeNotifyMinutesBeforeList(settingsReservationNotifyMinutesBeforeRef.current);
    if (minutesBeforeList.length === 0) return;

    const nowMs = nowMsRef.current;
    const tz = activeTimeZoneRef.current;
    const parts = getZonedPartsFromMs(nowMs, tz);
    const y = parts.year;
    const mo0 = parts.month0;
    const d = parts.day;

    // スリープ復帰などを考慮して、通知時刻を過ぎていても一定時間は拾う
    const lateWindowMs = 10 * 60 * 1000;

    for (const task of tasksRef.current) {
      if (!task || task.status !== 'reserved') continue;
      const startMinutes = parseTimeToMinutesFlexible(task.startTime);
      if (startMinutes == null) continue;

      for (const minutesBefore of minutesBeforeList) {
        const key = `${task.id}|${String(task.startTime ?? '')}|${minutesBefore}`;
        if (reservationNotifyFiredRef.current.has(key)) continue;

        const fireMinutes = startMinutes - minutesBefore;
        if (fireMinutes < 0) continue;
        const fireAt = zonedLocalDateTimeToUtcMs(
          { year: y, month0: mo0, day: d, hour: Math.floor(fireMinutes / 60), minute: fireMinutes % 60, second: 0 },
          tz
        );

        if (nowMs < fireAt) continue;
        if (nowMs > fireAt + lateWindowMs) continue;

        reservationNotifyFiredRef.current.add(key);
        notifyReservationTask({ task, startTimeMinutes: startMinutes, minutesBefore });
      }
    }
  }

  function syncReservationNotificationSchedule() {
    clearReservationNotificationSchedule();
    if (!settingsReservationNotifyEnabledRef.current) return;
    if (effectiveViewMode === 'history') return;

    const minutesBeforeList = normalizeNotifyMinutesBeforeList(settingsReservationNotifyMinutesBeforeRef.current);
    if (minutesBeforeList.length === 0) return;

    const nowMs = nowMsRef.current;
    const tz = activeTimeZoneRef.current;
    const parts = getZonedPartsFromMs(nowMs, tz);
    const y = parts.year;
    const mo0 = parts.month0;
    const d = parts.day;

    for (const task of tasksRef.current) {
      if (!task || task.status !== 'reserved') continue;
      const startMinutes = parseTimeToMinutesFlexible(task.startTime);
      if (startMinutes == null) continue;

      for (const minutesBefore of minutesBeforeList) {
        const key = `${task.id}|${String(task.startTime ?? '')}|${minutesBefore}`;
        if (reservationNotifyFiredRef.current.has(key)) continue;

        const fireMinutes = startMinutes - minutesBefore;
        if (fireMinutes < 0) continue;
        const fireAtMs = zonedLocalDateTimeToUtcMs(
          { year: y, month0: mo0, day: d, hour: Math.floor(fireMinutes / 60), minute: fireMinutes % 60, second: 0 },
          tz
        );
        const delay = fireAtMs - nowMs;
        if (delay <= 0) continue;

        const timeoutId = window.setTimeout(() => {
          // 直前に編集/削除される可能性があるので、発火時点の状態で再判定
          fireDueReservationNotifications();
        }, delay);
        reservationNotifyTimeoutsRef.current.set(key, timeoutId);
      }
    }
  }

  useEffect(() => {
    // settings/tasks の変化に追従してスケジュールを組み直す
    if (!accessToken) return;
    if (effectiveViewMode === 'history') return;
    syncReservationNotificationSchedule();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [accessToken, effectiveViewMode, tasks, settingsReservationNotifyEnabled, settingsReservationNotifyMinutesBefore, activeTimeZone, todayYmd]);

  useEffect(() => {
    if (!accessToken) return;
    if (effectiveViewMode === 'history') return;

    const tick = () => {
      if (document.visibilityState !== 'visible') return;
      fireDueReservationNotifications();
    };

    // 15秒程度で十分（分単位の予約なので）
    if (reservationNotifyIntervalRef.current != null) window.clearInterval(reservationNotifyIntervalRef.current);
    reservationNotifyIntervalRef.current = window.setInterval(tick, 15_000);

    const onVisibleOrFocus = () => {
      tick();
    };
    window.addEventListener('focus', onVisibleOrFocus);
    document.addEventListener('visibilitychange', onVisibleOrFocus);

    // すぐ1回
    tick();

    return () => {
      if (reservationNotifyIntervalRef.current != null) {
        window.clearInterval(reservationNotifyIntervalRef.current);
        reservationNotifyIntervalRef.current = null;
      }
      window.removeEventListener('focus', onVisibleOrFocus);
      document.removeEventListener('visibilitychange', onVisibleOrFocus);
      clearReservationNotificationSchedule();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [accessToken, effectiveViewMode]);

  useEffect(() => {
    // 予約の期限到来処理は /api/tasks(GET) のタイミングで走るため、
    // 画面を開いている間は定期的に取得してステータスを自動反映させる。
    if (!accessToken) return;
    if (effectiveViewMode === 'history') return;

    let disposed = false;

    async function tick() {
      if (disposed) return;
      if (document.visibilityState !== 'visible') return;
      if (tasksReloadInFlightRef.current) return;
      tasksReloadInFlightRef.current = true;
      try {
        await reloadTasksSilent();
      } finally {
        tasksReloadInFlightRef.current = false;
      }
    }

    // 予約の「分」精度で十分なので 60 秒間隔。
    const intervalId = window.setInterval(() => {
      void tick();
    }, 60_000);

    const onVisibleOrFocus = () => {
      void tick();
    };
    window.addEventListener('focus', onVisibleOrFocus);
    document.addEventListener('visibilitychange', onVisibleOrFocus);

    // すぐ1回だけ同期
    void tick();

    return () => {
      disposed = true;
      window.clearInterval(intervalId);
      window.removeEventListener('focus', onVisibleOrFocus);
      document.removeEventListener('visibilitychange', onVisibleOrFocus);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [accessToken, effectiveViewMode]);

  async function loadHistoryDates() {
    if (!accessToken) return;
    try {
      const res = await apiFetch('/api/history/dates');
      const body = await res.json();
      if (!res.ok || !body?.success) return;
      setHistoryDates(Array.isArray(body.dates) ? body.dates : []);
    } catch {
      // ignore
    }
  }

  async function loadHistory(dateString: string) {
    if (!accessToken) return;
    setError(null);
    setHistoryTasks([]);
    setHistoryStats(null);
    try {
      const res = await apiFetch(`/api/history/${dateString}`);
      const body = await res.json();

      if (res.status === 404) {
        setHistoryTasks([]);
        setHistoryStats({ totalMinutes: 0, completed: 0, total: 0 });
        return;
      }

      if (!res.ok || !body?.success) {
        throw new Error(body?.message || body?.error || '履歴取得に失敗しました');
      }

      const tasks = Array.isArray(body?.data?.tasks) ? (body.data.tasks as Task[]) : [];
      setHistoryTasks(tasks);

      const completed = tasks.filter((t) => !!t.endTime).length;
      const totalMinutesRaw = tasks.reduce((sum, t) => {
        if (t.status === 'reserved') return sum;
        if (!isTaskTrackedForWorkTime(t)) return sum;
        const m = calcDurationMinutes(t.startTime, t.endTime);
        return sum + (m ?? 0);
      }, 0);
      const totalMinutes = dailyWorkCapMin > 0 ? Math.min(totalMinutesRaw, dailyWorkCapMin) : totalMinutesRaw;
      setHistoryStats({ totalMinutes, completed, total: tasks.length });
    } catch (e: any) {
      setError(e?.message || String(e));
    }
  }

  async function addHistoryTask() {
    if (!accessToken || !historyDate) return;
    const name = historyNewTask.name.trim();
    if (!name) return;

    setBusy(true);
    setError(null);
    try {
      const res = await apiFetch(`/api/history/${historyDate}/tasks`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name,
          startTime: historyNewTask.startTime || undefined,
          endTime: historyNewTask.endTime || undefined,
          tag: historyNewTask.tag || undefined,
        }),
      });
      const body = await res.json();
      if (!res.ok || !body?.success) throw new Error(body?.message || body?.error || '履歴タスク追加に失敗しました');
      setHistoryNewTask({ name: '', startTime: '', endTime: '', tag: '' });
      await loadHistory(historyDate);
      await loadHistoryDates();
    } catch (e: any) {
      setError(e?.message || String(e));
    } finally {
      setBusy(false);
    }
  }

  async function saveHistoryTask() {
    if (!accessToken || !historyDate || !historyEditing) return;
    setBusy(true);
    setError(null);
    try {
      const res = await apiFetch(`/api/history/${historyDate}/tasks/${historyEditing.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: historyEditing.name,
          startTime: historyEditing.startTime,
          endTime: historyEditing.endTime,
          tag: historyEditing.tag,
        }),
      });
      const body = await res.json();
      if (!res.ok || !body?.success) throw new Error(body?.message || body?.error || '更新に失敗しました');
      setHistoryEditing(null);
      await loadHistory(historyDate);
    } catch (e: any) {
      setError(e?.message || String(e));
    } finally {
      setBusy(false);
    }
  }

  async function deleteHistoryTask(taskId: string) {
    if (!accessToken || !historyDate) return;
    setBusy(true);
    setError(null);
    try {
      const res = await apiFetch(`/api/history/${historyDate}/tasks/${taskId}`, { method: 'DELETE' });
      const body = await res.json();
      if (!res.ok || !body?.success) throw new Error(body?.message || body?.error || '削除に失敗しました');
      setHistoryEditing(null);
      await loadHistory(historyDate);
      await loadHistoryDates();
    } catch (e: any) {
      setError(e?.message || String(e));
    } finally {
      setBusy(false);
    }
  }

  async function loadReportUrls() {
    if (!accessToken) return;
    try {
      const res = await apiFetch('/api/report-urls');
      const body = await res.json();
      if (!res.ok || !body?.success) return;
      const urls = Array.isArray(body.urls) ? (body.urls as ReportUrl[]) : [];
      setReportUrls(urls);
      if (urls.length > 0) {
        const first = String(urls[0].id);
        setActiveReportTabId((prev) => prev ?? first);
      } else {
        setActiveReportTabId(null);
      }
    } catch {
      // ignore
    }
  }

  async function loadReportSingle() {
    if (!accessToken) return;
    try {
      const res = await apiFetch('/api/report');
      const body = await res.json();
      if (!res.ok || !body?.success) return;
      setReportSingleContent(String(body.content || ''));
    } catch {
      // ignore
    }
  }

  async function loadReportTab(tabId: string) {
    if (!accessToken) return;
    if (Object.prototype.hasOwnProperty.call(reportTabContent, tabId)) return;
    try {
      const res = await apiFetch(`/api/report-tabs/${tabId}`);
      const body = await res.json();
      if (!res.ok || !body?.success) return;
      setReportTabContent((prev) => ({ ...prev, [tabId]: String(body.content || '') }));
    } catch {
      // ignore
    }
  }

  async function saveReport() {
    if (!accessToken) return;
    setBusy(true);
    setError(null);
    try {
      if (reportUrls.length === 0) {
        const res = await apiFetch('/api/report', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ content: reportSingleContent }),
        });
        const body = await res.json();
        if (!res.ok || !body?.success) throw new Error(body?.error || '保存に失敗しました');
        return;
      }

      const tabId = activeReportTabId;
      if (!tabId) return;
      const content = reportTabContent[tabId] ?? '';
      const res = await apiFetch(`/api/report-tabs/${tabId}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content }),
      });
      const body = await res.json();
      if (!res.ok || !body?.success) throw new Error(body?.error || '保存に失敗しました');
    } catch (e: any) {
      setError(e?.message || String(e));
    } finally {
      setBusy(false);
    }
  }

  async function copyReportToClipboard() {
    try {
      const text = reportUrls.length === 0 ? reportSingleContent : activeReportTabId ? reportTabContent[activeReportTabId] ?? '' : '';
      await navigator.clipboard.writeText(text);
    } catch (e: any) {
      setError(e?.message || String(e));
    }
  }

  async function copyGoalsToClipboard() {
    try {
      const text = goalStock.map((g) => `・ ${g.name}`).join('\n').trim();
      if (!text) return;
      await navigator.clipboard.writeText(text);
    } catch {
      // ignore
    }
  }

  async function addReportUrl() {
    if (!accessToken) return;
    const name = newReportUrl.name.trim();
    const url = newReportUrl.url.trim();
    if (!name || !url) return;
    setBusy(true);
    setError(null);
    try {
      const res = await apiFetch('/api/report-urls', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, url }),
      });
      const body = await res.json();
      if (!res.ok || !body?.success) throw new Error(body?.error || '追加に失敗しました');
      setNewReportUrl({ name: '', url: '' });
      setReportTabContent({});
      await loadReportUrls();
    } catch (e: any) {
      setError(e?.message || String(e));
    } finally {
      setBusy(false);
    }
  }

  async function deleteReportUrl(urlId: number) {
    if (!accessToken) return;
    setBusy(true);
    setError(null);
    try {
      const res = await apiFetch(`/api/report-urls/${urlId}`, { method: 'DELETE' });
      const body = await res.json();
      if (!res.ok || !body?.success) throw new Error(body?.error || '削除に失敗しました');
      setReportTabContent({});
      await loadReportUrls();
    } catch (e: any) {
      setError(e?.message || String(e));
    } finally {
      setBusy(false);
    }
  }

  function Header() {
    return (
      <div className="sticky top-0 z-20 border-b border-[var(--border)] bg-[var(--bg-secondary)]">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-3 px-4 py-3">
          <div className="flex min-w-0 items-center gap-2">
            <button
              className="inline-flex h-9 w-9 items-center justify-center rounded-[var(--radius-small)] border border-[var(--border)] bg-[var(--bg-tertiary)] sm:hidden"
              onClick={() => setSidebarOpen(true)}
              aria-label="メニュー"
              type="button"
            >
              <span className="text-lg leading-none">≡</span>
            </button>
            <div className="min-w-0">
              <div className="truncate text-sm font-medium text-[var(--text-secondary)]">日報管理アプリ</div>
              <div className="text-xs text-[var(--text-muted)]">
                {effectiveViewMode === 'today' ? '今日' : '履歴'}
              </div>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <div className="hidden min-w-0 sm:block">
              <div className="text-xs text-[var(--text-muted)]">ログイン</div>
              <div className="max-w-[260px] truncate text-sm text-[var(--text-secondary)]">
                {userEmail ? userEmail : '未ログイン'}
              </div>
            </div>

            {userEmail ? (
              <button
                className="rounded-[var(--radius-small)] border border-[var(--border)] bg-[var(--bg-tertiary)] px-3 py-2 text-sm text-[var(--text-primary)]"
                onClick={logout}
                disabled={busy}
                type="button"
              >
                ログアウト
              </button>
            ) : (
              <button
                className="rounded-[var(--radius-small)] bg-[var(--accent)] px-3 py-2 text-sm text-[var(--bg-primary)]"
                onClick={login}
                disabled={busy}
                type="button"
              >
                Googleでログイン
              </button>
            )}
          </div>
        </div>
      </div>
    );
  }

  function SidebarNav(props: { onNavigate?: () => void }) {
    const onNavigate = props.onNavigate;

    const navButton = (id: 'today' | 'history' | 'report' | 'tag-report', label: string) => {
      const isActive = id === 'today' ? effectiveViewMode === 'today' : id === 'history' ? effectiveViewMode === 'history' : false;
      return (
        <button
          key={id}
          className={`w-full rounded-[var(--radius-small)] border px-3 py-2 text-left text-sm ${
            isActive
              ? 'border-[var(--accent)] bg-[var(--bg-tertiary)] text-[var(--text-primary)]'
              : 'border-[var(--border)] bg-[var(--bg-primary)] text-[var(--text-secondary)]'
          }`}
          onClick={() => {
            if (id === 'report') {
              setReportOpen(true);
            } else if (id === 'tag-report') {
              setTagWorkReportOpen(true);
            } else {
              if (id === 'history') setTodayMainTab('timeline');
              setViewMode(id);
            }
            onNavigate?.();
          }}
          type="button"
        >
          {label}
        </button>
      );
    };

    return (
      <div className="space-y-2">
        {navButton('today', '今日')}
        {navButton('history', '履歴')}
        {navButton('report', '報告書作成')}
        <div className="pl-3">{navButton('tag-report', 'タグ別作業報告')}</div>

        <div className="mt-4 rounded-[var(--radius-small)] border border-[var(--border)] bg-[var(--bg-primary)] p-3">
          <div className="text-xs text-[var(--text-muted)]">ログイン</div>
          <div className="mt-1 truncate text-sm text-[var(--text-secondary)]">{userEmail ? userEmail : '未ログイン'}</div>
          <div className="mt-3">
            {userEmail ? (
              <button
                className="w-full rounded-[var(--radius-small)] border border-[var(--border)] bg-[var(--bg-tertiary)] px-3 py-2 text-sm"
                onClick={logout}
                disabled={busy}
                type="button"
              >
                ログアウト
              </button>
            ) : (
              <button
                className="w-full rounded-[var(--radius-small)] bg-[var(--accent)] px-3 py-2 text-sm text-[var(--bg-primary)]"
                onClick={login}
                disabled={busy}
                type="button"
              >
                Googleでログイン
              </button>
            )}
          </div>
        </div>
      </div>
    );
  }

  function TodayView() {
    return (
      <div className="rounded-[var(--radius-medium)] border border-[var(--border)] bg-[var(--bg-secondary)] p-4">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-sm font-medium text-[var(--text-secondary)]">今日のタスク</h2>
          <button
            className="rounded-[var(--radius-small)] border border-[var(--border)] bg-[var(--bg-tertiary)] px-3 py-2 text-sm"
            onClick={reloadTasks}
            disabled={!accessToken || busy}
            type="button"
          >
            再読込
          </button>
        </div>

        <div className="flex gap-2">
          <input
            className="w-full rounded-[var(--radius-small)] border border-[var(--border)] bg-[var(--bg-primary)] px-3 py-2 text-sm text-[var(--text-primary)]"
            placeholder="タスク名"
            value={newTaskName}
            onChange={(e) => setNewTaskName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') void addTask();
            }}
            disabled={!accessToken || busy}
          />
          <button
            className="shrink-0 rounded-[var(--radius-small)] bg-[var(--accent)] px-3 py-2 text-sm text-[var(--bg-primary)]"
            onClick={addTask}
            disabled={!accessToken || busy}
            type="button"
          >
            追加
          </button>
          <button
            className="shrink-0 rounded-[var(--radius-small)] border border-[var(--border)] bg-[var(--bg-tertiary)] px-3 py-2 text-sm"
            onClick={endTask}
            disabled={!accessToken || busy}
            type="button"
          >
            終了
          </button>
        </div>

        <div className="mt-4 space-y-2">
          {tasks.length === 0 ? (
            <div className="text-sm text-[var(--text-muted)]">タスクはまだありません</div>
          ) : (
            tasks.map((t) => (
              <div
                key={t.id}
                className="flex items-start justify-between gap-3 rounded-[var(--radius-small)] border border-[var(--border)] bg-[var(--bg-primary)] px-3 py-2"
              >
                <div className="min-w-0">
                  <div className="flex min-w-0 items-center gap-1">
                    {getWorkTimeTrackIconKind(t) === 'excluded' ? (
                      <span
                        className="material-icons"
                        title="就労時間の集計から除外（設定）"
                        aria-label="就労時間の集計から除外（設定）"
                        style={{ fontSize: 16, color: 'var(--text-muted)' }}
                      >
                        local_cafe
                      </span>
                    ) : getWorkTimeTrackIconKind(t) === 'override-untracked' ? (
                      <span
                        className="material-icons"
                        title="就労時間の集計から除外（このタスクのみ）"
                        aria-label="就労時間の集計から除外（このタスクのみ）"
                        style={{ fontSize: 16, color: 'var(--text-muted)' }}
                      >
                        timer_off
                      </span>
                    ) : null}
                    <div className="truncate text-sm text-[var(--text-primary)]">{t.name}</div>
                  </div>
                  <div className="text-xs text-[var(--text-muted)]">
                    {t.status === 'reserved' ? '(予約) ' : ''}
                    {t.startTime || ''}
                    {t.endTime ? ` - ${t.endTime}` : ''}
                    {t.tag ? ` [${t.tag}]` : ''}
                  </div>
                </div>
              </div>
            ))
          )}
        </div>
      </div>
    );
  }

  function HistoryView() {
    return (
      <div className="rounded-[var(--radius-medium)] border border-[var(--border)] bg-[var(--bg-secondary)] p-4">
        <div className="mb-3 flex items-center justify-between gap-2">
          <h2 className="text-sm font-medium text-[var(--text-secondary)]">履歴</h2>
          <div className="flex gap-2">
            <button
              className="rounded-[var(--radius-small)] border border-[var(--border)] bg-[var(--bg-tertiary)] px-3 py-2 text-sm"
              onClick={loadHistoryDates}
              disabled={!accessToken || busy}
              type="button"
            >
              日付一覧
            </button>
          </div>
        </div>

        <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
          <input
            type="date"
            className="w-full rounded-[var(--radius-small)] border border-[var(--border)] bg-[var(--bg-primary)] px-3 py-2 text-sm text-[var(--text-primary)]"
            value={historyDate}
            onChange={(e) => {
              const v = e.target.value;
              setHistoryDate(v);
              if (v) void loadHistory(v);
            }}
            disabled={!accessToken || busy}
          />
          <div className="text-xs text-[var(--text-muted)] sm:text-right">
            {historyStats
              ? `合計 ${formatDurationJa(historyStats.totalMinutes)} / 完了 ${historyStats.completed} / 件数 ${historyStats.total}`
              : '日付を選択してください'}
          </div>
        </div>

        {historyDates.length > 0 ? (
          <div className="mt-3 flex flex-wrap gap-2">
            {historyDates.slice(0, 14).map((d) => (
              <button
                key={d}
                className={`rounded-[var(--radius-small)] border px-2 py-1 text-xs ${
                  d === historyDate
                    ? 'border-[var(--accent)] bg-[var(--bg-tertiary)]'
                    : 'border-[var(--border)] bg-[var(--bg-primary)]'
                }`}
                onClick={() => {
                  setHistoryDate(d);
                  void loadHistory(d);
                }}
                disabled={!accessToken || busy}
                type="button"
              >
                {d}
              </button>
            ))}
          </div>
        ) : null}

        <div className="mt-4 space-y-2">
          {!historyDate ? (
            <div className="text-sm text-[var(--text-muted)]">履歴は日付を選択すると表示されます</div>
          ) : historyTasks.length === 0 ? (
            <div className="text-sm text-[var(--text-muted)]">この日はタスクがありません</div>
          ) : (
            historyTasks.map((t) => (
              <div
                key={t.id}
                className="flex items-start justify-between gap-3 rounded-[var(--radius-small)] border border-[var(--border)] bg-[var(--bg-primary)] px-3 py-2"
              >
                <div className="min-w-0">
                  <div className="flex min-w-0 items-center gap-1">
                    {getWorkTimeTrackIconKind(t) === 'excluded' ? (
                      <span
                        className="material-icons"
                        title="就労時間の集計から除外（設定）"
                        aria-label="就労時間の集計から除外（設定）"
                        style={{ fontSize: 16, color: 'var(--text-muted)' }}
                      >
                        local_cafe
                      </span>
                    ) : getWorkTimeTrackIconKind(t) === 'override-untracked' ? (
                      <span
                        className="material-icons"
                        title="就労時間の集計から除外（このタスクのみ）"
                        aria-label="就労時間の集計から除外（このタスクのみ）"
                        style={{ fontSize: 16, color: 'var(--text-muted)' }}
                      >
                        timer_off
                      </span>
                    ) : null}
                    <div className="truncate text-sm text-[var(--text-primary)]">{t.name}</div>
                  </div>
                  <div className="text-xs text-[var(--text-muted)]">
                    {t.startTime || ''}
                    {t.endTime ? ` - ${t.endTime}` : ''}
                    {t.tag ? ` [${t.tag}]` : ''}
                  </div>
                </div>
                <button
                  className="shrink-0 rounded-[var(--radius-small)] border border-[var(--border)] bg-[var(--bg-tertiary)] px-2 py-1 text-xs"
                  onClick={() =>
                    setHistoryEditing({
                      id: t.id,
                      name: t.name || '',
                      startTime: formatTimeDisplay(t.startTime) || '',
                      endTime: formatTimeDisplay(t.endTime) || '',
                      tag: t.tag || '',
                    })
                  }
                  disabled={!accessToken || busy}
                  type="button"
                >
                  編集
                </button>
              </div>
            ))
          )}
        </div>

        {historyEditing ? (
          <div className="mt-4 rounded-[var(--radius-small)] border border-[var(--border)] bg-[var(--bg-primary)] p-3">
            <div className="mb-2 text-xs text-[var(--text-muted)]">履歴タスク編集</div>
            <div className="grid gap-2 sm:grid-cols-2">
              <input
                className="w-full rounded-[var(--radius-small)] border border-[var(--border)] bg-[var(--bg-secondary)] px-3 py-2 text-sm"
                value={historyEditing.name}
                onChange={(e) => setHistoryEditing((p) => (p ? { ...p, name: e.target.value } : p))}
                placeholder="タスク名"
                disabled={busy}
              />
              <select
                className="w-full rounded-[var(--radius-small)] border border-[var(--border)] bg-[var(--bg-secondary)] px-3 py-2 text-sm"
                aria-label="タグを選択"
                value={String(historyEditing.tag || '').trim()}
                onChange={(e) => setHistoryEditing((p) => (p ? { ...p, tag: e.target.value } : p))}
                disabled={busy}
              >
                <option value="">タグを選択</option>
                {String(historyEditing.tag || '').trim() &&
                !tagStock.some((t) => String(t?.name || '').trim() === String(historyEditing.tag || '').trim()) ? (
                  <option value={String(historyEditing.tag || '').trim()}>{String(historyEditing.tag || '').trim()}</option>
                ) : null}
                {tagStock.map((t) => (
                  <option key={`${t.id ?? ''}:${t.name}`} value={t.name}>
                    {t.name}
                  </option>
                ))}
              </select>
              <input
                className="w-full rounded-[var(--radius-small)] border border-[var(--border)] bg-[var(--bg-secondary)] px-3 py-2 text-sm"
                value={historyEditing.startTime}
                onChange={(e) => setHistoryEditing((p) => (p ? { ...p, startTime: e.target.value } : p))}
                type="time"
                onClick={() => {
                  if (busy) return;
                  setHistoryEditing((p) => (p && !p.startTime ? { ...p, startTime: nowHHMM() } : p));
                }}
                onDoubleClick={() => {
                  if (busy) return;
                  setHistoryEditing((p) => (p ? { ...p, startTime: '' } : p));
                }}
                disabled={busy}
              />
              <input
                className="w-full rounded-[var(--radius-small)] border border-[var(--border)] bg-[var(--bg-secondary)] px-3 py-2 text-sm"
                value={historyEditing.endTime}
                onChange={(e) => setHistoryEditing((p) => (p ? { ...p, endTime: e.target.value } : p))}
                type="time"
                onClick={() => {
                  if (busy) return;
                  setHistoryEditing((p) => (p && !p.endTime ? { ...p, endTime: nowHHMM() } : p));
                }}
                onDoubleClick={() => {
                  if (busy) return;
                  setHistoryEditing((p) => (p ? { ...p, endTime: '' } : p));
                }}
                disabled={busy}
              />
            </div>
            <div className="mt-3 flex flex-wrap gap-2">
              <button
                className="rounded-[var(--radius-small)] bg-[var(--accent)] px-3 py-2 text-sm text-[var(--bg-primary)]"
                onClick={saveHistoryTask}
                disabled={busy}
                type="button"
              >
                保存
              </button>
              <button
                className="rounded-[var(--radius-small)] border border-[var(--border)] bg-[var(--bg-tertiary)] px-3 py-2 text-sm"
                onClick={() => setHistoryEditing(null)}
                disabled={busy}
                type="button"
              >
                キャンセル
              </button>
              <button
                className="rounded-[var(--radius-small)] border border-[var(--error)] bg-[var(--bg-tertiary)] px-3 py-2 text-sm text-[var(--error)]"
                onClick={() => deleteHistoryTask(historyEditing.id)}
                disabled={busy}
                type="button"
              >
                削除
              </button>
            </div>
          </div>
        ) : null}

        <div className="mt-4 rounded-[var(--radius-small)] border border-[var(--border)] bg-[var(--bg-primary)] p-3">
          <div className="mb-2 text-xs text-[var(--text-muted)]">履歴タスク追加</div>
          <div className="grid gap-2 sm:grid-cols-2">
            <input
              className="w-full rounded-[var(--radius-small)] border border-[var(--border)] bg-[var(--bg-secondary)] px-3 py-2 text-sm"
              value={historyNewTask.name}
              onChange={(e) => setHistoryNewTask((p) => ({ ...p, name: e.target.value }))}
              placeholder="タスク名"
              disabled={!historyDate || busy}
            />
            <input
              className="w-full rounded-[var(--radius-small)] border border-[var(--border)] bg-[var(--bg-secondary)] px-3 py-2 text-sm"
              value={historyNewTask.tag}
              onChange={(e) => setHistoryNewTask((p) => ({ ...p, tag: e.target.value }))}
              placeholder="タグ (任意)"
              disabled={!historyDate || busy}
            />
            <input
              className="w-full rounded-[var(--radius-small)] border border-[var(--border)] bg-[var(--bg-secondary)] px-3 py-2 text-sm"
              value={historyNewTask.startTime}
              onChange={(e) => setHistoryNewTask((p) => ({ ...p, startTime: e.target.value }))}
              type="time"
              onClick={() => {
                if (busy) return;
                setHistoryNewTask((p) => (!p.startTime ? { ...p, startTime: nowHHMM() } : p));
              }}
              onDoubleClick={() => {
                if (busy) return;
                setHistoryNewTask((p) => ({ ...p, startTime: '' }));
              }}
              disabled={!historyDate || busy}
            />
            <input
              className="w-full rounded-[var(--radius-small)] border border-[var(--border)] bg-[var(--bg-secondary)] px-3 py-2 text-sm"
              value={historyNewTask.endTime}
              onChange={(e) => setHistoryNewTask((p) => ({ ...p, endTime: e.target.value }))}
              type="time"
              onClick={() => {
                if (busy) return;
                setHistoryNewTask((p) => (!p.endTime ? { ...p, endTime: nowHHMM() } : p));
              }}
              onDoubleClick={() => {
                if (busy) return;
                setHistoryNewTask((p) => ({ ...p, endTime: '' }));
              }}
              disabled={!historyDate || busy}
            />
          </div>
          <div className="mt-3">
            <button
              className="rounded-[var(--radius-small)] bg-[var(--accent)] px-3 py-2 text-sm text-[var(--bg-primary)]"
              onClick={addHistoryTask}
              disabled={!historyDate || busy}
              type="button"
            >
              追加
            </button>
          </div>
        </div>
      </div>
    );
  }

  function ReportView() {
    return (
      <div className="rounded-[var(--radius-medium)] border border-[var(--border)] bg-[var(--bg-secondary)] p-4">
        <div className="mb-3 flex items-center justify-between gap-2">
          <h2 className="text-sm font-medium text-[var(--text-secondary)]">報告書</h2>
          <div className="flex gap-2">
            <button
              className="rounded-[var(--radius-small)] border border-[var(--border)] bg-[var(--bg-tertiary)] px-3 py-2 text-sm"
              onClick={async () => {
                await loadReportUrls();
                await loadReportSingle();
              }}
              disabled={!accessToken || busy}
              type="button"
            >
              再読込
            </button>
            <button
              className="rounded-[var(--radius-small)] border border-[var(--border)] bg-[var(--bg-tertiary)] px-3 py-2 text-sm"
              onClick={copyReportToClipboard}
              disabled={!accessToken || busy}
              type="button"
            >
              コピー
            </button>
            <button
              className="rounded-[var(--radius-small)] bg-[var(--accent)] px-3 py-2 text-sm text-[var(--bg-primary)]"
              onClick={saveReport}
              disabled={!accessToken || busy}
              type="button"
            >
              保存
            </button>
          </div>
        </div>

        {reportUrls.length === 0 ? (
          <textarea
            className="min-h-[220px] w-full rounded-[var(--radius-small)] border border-[var(--border)] bg-[var(--bg-primary)] px-3 py-2 text-sm text-[var(--text-primary)]"
            placeholder="今日の作業について記述してください"
            value={reportSingleContent}
            onChange={(e) => setReportSingleContent(e.target.value)}
            disabled={!accessToken || busy}
          />
        ) : (
          <div className="space-y-3">
            <div className="flex flex-wrap gap-2">
              {reportUrls.map((u) => {
                const tabId = String(u.id);
                const active = tabId === activeReportTabId;
                return (
                  <button
                    key={u.id}
                    className={`rounded-[var(--radius-small)] border px-3 py-2 text-sm ${
                      active
                        ? 'border-[var(--accent)] bg-[var(--bg-tertiary)]'
                        : 'border-[var(--border)] bg-[var(--bg-primary)]'
                    }`}
                    onClick={() => {
                      setActiveReportTabId(tabId);
                      void loadReportTab(tabId);
                    }}
                    disabled={!accessToken || busy}
                    title={u.url}
                    type="button"
                  >
                    {u.name}
                  </button>
                );
              })}
            </div>

            <div className="flex flex-wrap gap-2">
              {reportUrls.map((u) => (
                <button
                  key={`open-${u.id}`}
                  className="rounded-[var(--radius-small)] border border-[var(--border)] bg-[var(--bg-tertiary)] px-3 py-2 text-sm"
                  onClick={() => window.open(u.url, '_blank', 'noopener')}
                  disabled={!accessToken || busy}
                  title={u.url}
                  type="button"
                >
                  {u.name} を開く
                </button>
              ))}
            </div>

            {activeReportTabId ? (
              <textarea
                className="min-h-[220px] w-full rounded-[var(--radius-small)] border border-[var(--border)] bg-[var(--bg-primary)] px-3 py-2 text-sm text-[var(--text-primary)]"
                placeholder="報告内容"
                value={reportTabContent[activeReportTabId] ?? ''}
                onChange={(e) =>
                  setReportTabContent((prev) => ({
                    ...prev,
                    [activeReportTabId]: e.target.value,
                  }))
                }
                disabled={!accessToken || busy}
              />
            ) : null}
          </div>
        )}

        <div className="mt-4 rounded-[var(--radius-small)] border border-[var(--border)] bg-[var(--bg-primary)] p-3">
          <div className="mb-2 text-xs text-[var(--text-muted)]">報告先URL</div>

          <div className="space-y-2">
            {reportUrls.length === 0 ? (
              <div className="text-sm text-[var(--text-muted)]">報告先が未設定です</div>
            ) : (
              reportUrls.map((u) => (
                <div
                  key={`url-${u.id}`}
                  className="flex items-center justify-between gap-3 rounded-[var(--radius-small)] border border-[var(--border)] bg-[var(--bg-secondary)] px-3 py-2"
                >
                  <div className="min-w-0">
                    <div className="truncate text-sm text-[var(--text-primary)]">{u.name}</div>
                    <div className="truncate text-xs text-[var(--text-muted)]">{u.url}</div>
                  </div>
                  <button
                    className="shrink-0 rounded-[var(--radius-small)] border border-[var(--error)] bg-[var(--bg-tertiary)] px-2 py-1 text-xs text-[var(--error)]"
                    onClick={() => deleteReportUrl(u.id)}
                    disabled={!accessToken || busy}
                    type="button"
                  >
                    削除
                  </button>
                </div>
              ))
            )}
          </div>

          <div className="mt-3 grid gap-2 sm:grid-cols-2">
            <input
              className="w-full rounded-[var(--radius-small)] border border-[var(--border)] bg-[var(--bg-secondary)] px-3 py-2 text-sm"
              value={newReportUrl.name}
              onChange={(e) => setNewReportUrl((p) => ({ ...p, name: e.target.value }))}
              placeholder="名前"
              disabled={!accessToken || busy}
            />
            <input
              className="w-full rounded-[var(--radius-small)] border border-[var(--border)] bg-[var(--bg-secondary)] px-3 py-2 text-sm"
              value={newReportUrl.url}
              onChange={(e) => setNewReportUrl((p) => ({ ...p, url: e.target.value }))}
              placeholder="URL"
              disabled={!accessToken || busy}
            />
          </div>
          <div className="mt-3">
            <button
              className="rounded-[var(--radius-small)] bg-[var(--accent)] px-3 py-2 text-sm text-[var(--bg-primary)]"
              onClick={addReportUrl}
              disabled={!accessToken || busy}
              type="button"
            >
              追加
            </button>
          </div>
        </div>
      </div>
    );
  }

  async function addTask() {
    if (!accessToken) return;
    const name = newTaskName.trim();
    if (!name) return;

    const carryMemoUrl = newTaskCarryMemoUrlEnabled;
    const carryMemo = String(newTaskCarryMemo || '').trim();
    const carryUrl = String(newTaskCarryUrl || '').trim();

    const todayIso = todayYmd;
    const isHistoryTarget = effectiveViewMode === 'history' && !!historyDate;
    const isReserve = addMode === 'reserve';
    const isPastReservationInCalendar = isHistoryTarget && isReserve && historyDate < todayIso;
    const reserveDateString = isHistoryTarget ? (historyDate === todayIso ? null : historyDate) : null;

    if (isPastReservationInCalendar) {
      setError('過去の日付には予約できません');
      return;
    }

    if (isReserve && !reserveStartTime) {
      setError('開始時刻が必要です');
      return;
    }

    setBusy(true);
    setError(null);
    try {
      if (isHistoryTarget && isReserve) {
        const payload: any = { name };
        if (selectedTag) payload.tag = selectedTag;
        if (reserveStartTime) payload.startTime = reserveStartTime;
        if (reserveDateString) payload.dateString = reserveDateString;
        if (carryMemoUrl) {
          if (carryMemo) payload.memo = carryMemo;
          if (carryUrl) payload.url = carryUrl;
        }

        const res = await apiFetch('/api/tasks/reserve', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        });
        const body = await res.json();
        if (!res.ok || !body?.success) throw new Error(body?.error || '追加に失敗しました');

        setNewTaskName('');
        clearNewTaskCarryMemoUrl();
        setReserveStartTime('');
        await loadHistory(historyDate);
        await loadHistoryDates();
      } else if (isHistoryTarget) {
        const payload: any = { name };
        if (selectedTag) payload.tag = selectedTag;
        if (carryMemoUrl) {
          if (carryMemo) payload.memo = carryMemo;
          if (carryUrl) payload.url = carryUrl;
        }

        const res = await apiFetch(`/api/history/${historyDate}/tasks`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        });
        const body = await res.json();
        if (!res.ok || !body?.success) throw new Error(body?.message || body?.error || '追加に失敗しました');

        setNewTaskName('');
        clearNewTaskCarryMemoUrl();
        setReserveStartTime('');
        await loadHistory(historyDate);
        await loadHistoryDates();
      } else {
        const url = isReserve ? '/api/tasks/reserve' : '/api/tasks';
        const payload: any = { name };
        if (selectedTag) payload.tag = selectedTag;
        if (isReserve && reserveStartTime) payload.startTime = reserveStartTime;
        if (carryMemoUrl) {
          if (carryMemo) payload.memo = carryMemo;
          if (carryUrl) payload.url = carryUrl;
        }

        const res = await apiFetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        });
        const body = await res.json();
        if (!res.ok || !body?.success) throw new Error(body?.error || '追加に失敗しました');
        setNewTaskName('');
        clearNewTaskCarryMemoUrl();
        setReserveStartTime('');
        await reloadTasks();
      }
    } catch (e: any) {
      setError(e?.message || String(e));
    } finally {
      setBusy(false);
    }
  }

  async function endTask() {
    setBusy(true);
    setError(null);
    try {
      const res = await apiFetch('/api/tasks/end', { method: 'POST' });
      const body = await res.json();
      if (!res.ok || !body?.success) throw new Error(body?.error || '終了に失敗しました');
      await reloadTasks();
    } catch (e: any) {
      setError(e?.message || String(e));
    } finally {
      setBusy(false);
    }
  }

  async function login() {
    const client = supabase;
    if (!client) return;
    setError(null);
    const { error } = await client.auth.signInWithOAuth({
      provider: 'google',
      options: {
        redirectTo: window.location.origin + '/',
      },
    });
    if (error) setError(error.message);
  }

  async function logout() {
    const client = supabase;
    if (!client) return;
    setError(null);
    await client.auth.signOut();
  }

  if (!supabase) {
    return (
      <div className="rounded-[var(--radius-medium)] border border-[var(--border)] bg-[var(--bg-secondary)] p-4">
        <p className="text-sm text-[var(--text-secondary)]">
          環境変数が不足しています。
          <span className="font-mono">SUPABASE_URL</span>/<span className="font-mono">SUPABASE_ANON_KEY</span>
          （または <span className="font-mono">NEXT_PUBLIC_SUPABASE_URL</span>/<span className="font-mono">NEXT_PUBLIC_SUPABASE_ANON_KEY</span>）
          を設定してください。
        </p>
      </div>
    );
  }

  function formatDateJa(d: Date) {
    const p = getJstDateTimeParts(d);
    const m = Number(p.month2);
    const day = Number(p.day2);
    return `${p.year}年${m}月${day}日`;
  }

  function formatTimeHHMM(d: Date) {
    const p = getJstDateTimeParts(d);
    return `${p.hour2}:${p.minute2}`;
  }

  function formatTimeHHMMSS(d: Date) {
    const p = getJstDateTimeParts(d);
    return `${p.hour2}:${p.minute2}:${p.second2}`;
  }

  function formatNowTimeDisplay(d: Date) {
    return formatTimeHHMMSS(d);
  }

  const effectiveTasks = effectiveViewMode === 'today' ? tasks : historyTasks;
  const runningTask = tasks
    .slice()
    .reverse()
    .find((t) => !t.endTime && t.status !== 'reserved');
  const completedCount = effectiveTasks.filter((t) => !!t.endTime && t.status !== 'reserved').length;
  const dailyWorkCapMin = useMemo(() => {
    const h = Number(billingHourlyCapHours);
    return Number.isFinite(h) && h > 0 ? Math.round(h * 60) : 0;
  }, [billingHourlyCapHours]);

  const totalMinutesRaw = effectiveTasks.reduce((sum, t) => {
    if (t.status === 'reserved') return sum;
    if (!isTaskTrackedForWorkTime(t)) return sum;
    const m = calcDurationMinutes(t.startTime, t.endTime);
    return sum + (m ?? 0);
  }, 0);
  const totalMinutes = dailyWorkCapMin > 0 ? Math.min(totalMinutesRaw, dailyWorkCapMin) : totalMinutesRaw;

  const sortedTimelineTasks = useMemo(() => {
    const list = [...effectiveTasks];
    list.sort((a, b) => {
      const ma = parseTimeToMinutesFlexible(a.startTime);
      const mb = parseTimeToMinutesFlexible(b.startTime);
      if (ma == null && mb == null) return 0;
      if (ma == null) return 1;
      if (mb == null) return -1;
      return ma - mb;
    });
    return list;
  }, [effectiveTasks]);

  const timelineEmptyText = effectiveViewMode === 'today' ? 'まだタスクがありません' : 'この日はタスクがありません';

  const reportCompletedTasks = useMemo(() => {
    const list = tasks
      .filter((t) => !!t.endTime && t.status !== 'reserved')
      .slice()
      .sort((a, b) => {
        const ma = parseTimeToMinutesFlexible(a.startTime);
        const mb = parseTimeToMinutesFlexible(b.startTime);
        if (ma == null && mb == null) return 0;
        if (ma == null) return 1;
        if (mb == null) return -1;
        return ma - mb;
      });
    return list;
  }, [tasks]);

  const reportTimelineCopyBlocked = (effectiveViewMode === 'today' ? tasks : historyTasks).some(
    (t) => t.status === 'reserved' || (!t.endTime && t.status !== 'reserved')
  );

  function formatDateISOToJaShort(date: string) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return date;
    if (date === todayYmd) return '今日';
    return date;
  }

  function formatDateISOToJaLong(date: string) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return date;
    const [y, m, d] = date.split('-');
    return `${y}年${Number(m)}月${Number(d)}日`;
  }

  function formatDateISOToSlash(date: string) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return date;
    return date.replace(/-/g, '/');
  }

  function isYmdInRange(date: string, start: string, end: string) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return false;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(start)) return false;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(end)) return false;
    return date >= start && date <= end;
  }

  async function loadTagWorkReportSummaryRange() {
    if (!accessToken) return;
    const startYmd = normalizeYmd(tagWorkReportRangeStart);
    const endYmd = normalizeYmd(tagWorkReportRangeEnd);

    if (!/^\d{4}-\d{2}-\d{2}$/.test(startYmd) || !/^\d{4}-\d{2}-\d{2}$/.test(endYmd)) {
      setTagWorkReportError('期間の形式が不正です');
      setTagWorkReportSummary([]);
      setTagWorkReportActiveTag('');
      return;
    }
    if (startYmd > endYmd) {
      setTagWorkReportError('開始日は終了日以前にしてください');
      setTagWorkReportSummary([]);
      setTagWorkReportActiveTag('');
      return;
    }

    setTagWorkReportLoading(true);
    setTagWorkReportError(null);
    try {
      const tagMap = new Map<string, { totalMinutes: number; byDate: Map<string, TagWorkTask[]> }>();

      const addTasksToMap = (date: string, tasksInDay: any[]) => {
        for (const t of tasksInDay) {
          const tag = typeof t?.tag === 'string' ? t.tag.trim() : '';
          const startTime = typeof t?.startTime === 'string' ? t.startTime : '';
          const endTime = typeof t?.endTime === 'string' ? t.endTime : '';
          const name = String(t?.name || t?.title || '').trim();
          const status = t?.status ?? null;

          if (!tag || !name) continue;
          if (!startTime || !endTime) continue;
          if (status === 'reserved') continue;

          const minutes = calcDurationMinutes(startTime, endTime);
          if (minutes == null) continue;

          if (!tagMap.has(tag)) tagMap.set(tag, { totalMinutes: 0, byDate: new Map() });
          const entry = tagMap.get(tag)!;
          entry.totalMinutes += minutes;
          if (!entry.byDate.has(date)) entry.byDate.set(date, []);
          entry.byDate.get(date)!.push({ date, name, startTime, endTime, minutes });
        }
      };

      const todayIso = todayYmd;
      if (isYmdInRange(todayIso, startYmd, endYmd)) {
        const resToday = await apiFetch('/api/tasks', { method: 'GET' });
        const bodyToday = await resToday.json().catch(() => null as any);
        const todayTasks: any[] = Array.isArray(bodyToday?.tasks) ? bodyToday.tasks : [];
        addTasksToMap(todayIso, todayTasks);
      }

      const resDates = await apiFetch('/api/history/dates', { method: 'GET' });
      const bodyDates = await resDates.json().catch(() => null as any);
      const dates: string[] = Array.isArray(bodyDates?.dates)
        ? bodyDates.dates
        : Array.isArray(bodyDates?.data)
          ? bodyDates.data
          : [];

      const inRangeDates = dates.filter((d) => isYmdInRange(d, startYmd, endYmd));
      for (const date of inRangeDates) {
        const res = await apiFetch(`/api/history/${encodeURIComponent(date)}`, { method: 'GET' });
        if (!res.ok) continue;
        const body = await res.json().catch(() => null as any);
        const tasksInDay: any[] = Array.isArray(body?.data?.tasks) ? body.data.tasks : Array.isArray(body?.tasks) ? body.tasks : [];
        addTasksToMap(date, tasksInDay);
      }

      const summaries: TagWorkSummary[] = Array.from(tagMap.entries())
        .map(([tag, v]) => {
          const groups: TagWorkDateGroup[] = Array.from(v.byDate.entries())
            .sort((a, b) => (a[0] < b[0] ? 1 : a[0] > b[0] ? -1 : 0))
            .map(([date, tasks]) => {
              const sorted = tasks.slice().sort((a, b) => {
                const ma = parseTimeToMinutesFlexible(a.startTime);
                const mb = parseTimeToMinutesFlexible(b.startTime);
                if (ma == null && mb == null) return 0;
                if (ma == null) return 1;
                if (mb == null) return -1;
                return ma - mb;
              });
              const totalMinutes = sorted.reduce((s, x) => s + x.minutes, 0);
              return { date, totalMinutes, count: sorted.length, tasks: sorted };
            });

          return { tag, totalMinutes: v.totalMinutes, groups };
        })
        .sort((a, b) => b.totalMinutes - a.totalMinutes);

      setTagWorkReportSummary(summaries);
      if (summaries.length > 0) {
        setTagWorkReportActiveTag((prev) => (prev && summaries.some((s) => s.tag === prev) ? prev : summaries[0].tag));
      } else {
        setTagWorkReportActiveTag('');
      }
    } catch (e: any) {
      setTagWorkReportError(e?.message || 'タグ別作業時間の取得に失敗しました');
      setTagWorkReportSummary([]);
      setTagWorkReportActiveTag('');
    } finally {
      setTagWorkReportLoading(false);
    }
  }

  function openEditForTask(task: Task) {
    if (!accessToken || busy) return;
    if (!task?.id) return;
    if (effectiveViewMode === 'history' && !historyDate) return;

    setEditingTaskId(String(task.id));
    setEditingTaskDateKey(effectiveViewMode === 'history' ? historyDate : null);
    setEditName(String(task.name || ''));
    setEditTag(String(task.tag || '').trim());
    setEditStartTime(formatTimeDisplay(task.startTime) || '');
    setEditEndTime(formatTimeDisplay(task.endTime) || '');
    setEditMemo(String(task.memo || ''));
    setEditUrl(String((task as any)?.url || ''));
    setEditTrackedOverride(typeof (task as any)?.isTracked === 'boolean' ? (task as any).isTracked : null);
    setEditOpen(true);
  }

  async function saveEditingTask() {
    if (!accessToken) return;
    if (!editingTaskId) return;
    const name = editName.trim();
    const startTime = editStartTime.trim();
    const endTime = editEndTime.trim();
    const tag = editTag.trim();
    const memo = editMemo;
    const url = editUrl;

    if (!name || !startTime) return;

    setBusy(true);
    setError(null);
    try {
      if (effectiveViewMode === 'history') {
        const dateKey = editingTaskDateKey || historyDate;
        if (!dateKey) throw new Error('日付が未選択です');
        const res = await apiFetch(`/api/history/${dateKey}/tasks/${editingTaskId}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name, startTime, endTime, tag: tag || null, memo, url }),
        });
        const body = await res.json().catch(() => null as any);
        if (!res.ok || !body?.success) throw new Error(body?.message || body?.error || '更新に失敗しました');
        await loadHistory(dateKey);
      } else {
        const res = await apiFetch(`/api/tasks/${editingTaskId}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name, startTime, endTime, tag: tag || null, memo, url }),
        });
        const body = await res.json().catch(() => null as any);
        if (!res.ok || !body?.success) throw new Error(body?.message || body?.error || '更新に失敗しました');
        await reloadTasks();
      }

      setEditOpen(false);
    } catch (e: any) {
      setError(e?.message || String(e));
    } finally {
      setBusy(false);
    }
  }

  type TaskEditDraft = {
    name: string;
    tag: string;
    startTime: string;
    endTime: string;
    memo: string;
    url: string;
    isTracked: boolean | null;
  };

  async function saveEditingTaskFromDraft(draft: TaskEditDraft) {
    if (!accessToken) return;
    if (!editingTaskId) return;

    const name = String(draft?.name || '').trim();
    const startTime = String(draft?.startTime || '').trim();
    const endTime = String(draft?.endTime || '').trim();
    const tag = String(draft?.tag || '').trim();
    const memo = String(draft?.memo || '');
    const url = String(draft?.url || '');
    const isTracked = typeof draft?.isTracked === 'boolean' ? draft.isTracked : null;

    if (!name || !startTime) return;

    setBusy(true);
    setError(null);
    try {
      if (effectiveViewMode === 'history') {
        const dateKey = editingTaskDateKey || historyDate;
        if (!dateKey) throw new Error('日付が未選択です');
        const res = await apiFetch(`/api/history/${dateKey}/tasks/${editingTaskId}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name, startTime, endTime, tag: tag || null, memo, url, isTracked }),
        });
        const body = await res.json().catch(() => null as any);
        if (!res.ok || !body?.success) throw new Error(body?.message || body?.error || '更新に失敗しました');
        await loadHistory(dateKey);
      } else {
        const res = await apiFetch(`/api/tasks/${editingTaskId}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name, startTime, endTime, tag: tag || null, memo, url, isTracked }),
        });
        const body = await res.json().catch(() => null as any);
        if (!res.ok || !body?.success) throw new Error(body?.message || body?.error || '更新に失敗しました');
        await reloadTasks();
      }

      // keep parent snapshot in sync for next open
      setEditName(name);
      setEditTag(tag);
      setEditStartTime(startTime);
      setEditEndTime(endTime);
      setEditMemo(memo);
      setEditUrl(url);
      setEditTrackedOverride(isTracked);

      setEditOpen(false);
    } catch (e: any) {
      setError(e?.message || String(e));
    } finally {
      setBusy(false);
    }
  }

  async function deleteEditingTask() {
    if (!accessToken) return;
    if (!editingTaskId) return;

    setBusy(true);
    setError(null);
    try {
      if (effectiveViewMode === 'history') {
        const dateKey = editingTaskDateKey || historyDate;
        if (!dateKey) throw new Error('日付が未選択です');
        const res = await apiFetch(`/api/history/${dateKey}/tasks/${editingTaskId}`, { method: 'DELETE' });
        const body = await res.json().catch(() => null as any);
        if (!res.ok || !body?.success) throw new Error(body?.message || body?.error || '削除に失敗しました');
        await loadHistory(dateKey);
      } else {
        const res = await apiFetch(`/api/tasks/${editingTaskId}`, { method: 'DELETE' });
        const body = await res.json().catch(() => null as any);
        if (!res.ok || !body?.success) throw new Error(body?.message || body?.error || '削除に失敗しました');
        await reloadTasks();
      }

      setEditOpen(false);
    } catch (e: any) {
      setError(e?.message || String(e));
    } finally {
      setBusy(false);
    }
  }

  type HolidayCalendarCell = {
    year: number;
    month0: number;
    day: number;
    ymd: string;
    inMonth: boolean;
    weekday0: number; // 0=Sun..6=Sat
  };

  function getWeekday0InTimeZone(args: { year: number; month0: number; day: number }, timeZone: string) {
    const tz = normalizeTimeZone(timeZone);
    const utcMs = zonedLocalDateTimeToUtcMs({ year: args.year, month0: args.month0, day: args.day, hour: 0, minute: 0, second: 0 }, tz);
    return getZonedPartsFromMs(utcMs, tz).weekday0;
  }

  function getMonthEdgesInTimeZone(monthDate: Date, timeZone: string) {
    const tz = normalizeTimeZone(timeZone);
    const year = monthDate.getFullYear();
    const month0 = monthDate.getMonth();

    const curStartUtcMs = zonedLocalDateTimeToUtcMs({ year, month0, day: 1, hour: 0, minute: 0, second: 0 }, tz);
    const nextStartUtcMs = zonedLocalDateTimeToUtcMs({ year, month0: month0 + 1, day: 1, hour: 0, minute: 0, second: 0 }, tz);

    const curStartParts = getZonedPartsFromMs(curStartUtcMs, tz);
    const prevLastParts = getZonedPartsFromMs(curStartUtcMs - 1, tz);
    const curLastParts = getZonedPartsFromMs(nextStartUtcMs - 1, tz);
    const nextStartParts = getZonedPartsFromMs(nextStartUtcMs, tz);

    return {
      year,
      month0,
      firstWeekday0: curStartParts.weekday0,
      daysInMonth: curLastParts.day,
      prev: { year: prevLastParts.year, month0: prevLastParts.month0, daysInMonth: prevLastParts.day },
      next: { year: nextStartParts.year, month0: nextStartParts.month0 },
    };
  }

  function getHolidayCalendarCells(monthDate: Date, timeZone: string): HolidayCalendarCell[] {
    const tz = normalizeTimeZone(timeZone);
    const edges = getMonthEdgesInTimeZone(monthDate, tz);

    // UI is Monday-first.
    const adjustedFirst = (edges.firstWeekday0 + 6) % 7; // Mon=0

    const cells: HolidayCalendarCell[] = [];

    // Previous month tail
    for (let i = adjustedFirst - 1; i >= 0; i--) {
      const day = edges.prev.daysInMonth - i;
      const year = edges.prev.year;
      const month0 = edges.prev.month0;
      const weekday0 = getWeekday0InTimeZone({ year, month0, day }, tz);
      cells.push({ year, month0, day, ymd: ymdKeyFromParts(year, month0, day), inMonth: false, weekday0 });
    }

    // Current month
    for (let day = 1; day <= edges.daysInMonth; day++) {
      const year = edges.year;
      const month0 = edges.month0;
      const weekday0 = getWeekday0InTimeZone({ year, month0, day }, tz);
      cells.push({ year, month0, day, ymd: ymdKeyFromParts(year, month0, day), inMonth: true, weekday0 });
    }

    // Next month head (fill to 6 weeks)
    const remaining = 42 - cells.length;
    for (let day = 1; day <= remaining; day++) {
      const year = edges.next.year;
      const month0 = edges.next.month0;
      const weekday0 = getWeekday0InTimeZone({ year, month0, day }, tz);
      cells.push({ year, month0, day, ymd: ymdKeyFromParts(year, month0, day), inMonth: false, weekday0 });
    }
    return cells;
  }

  function getHolidayCalendarCounts(monthDate: Date, holidays: Set<string>, timeZone: string) {
    const tz = normalizeTimeZone(timeZone);
    const edges = getMonthEdgesInTimeZone(monthDate, tz);
    const year = edges.year;
    const month0 = edges.month0;
    const daysInMonth = edges.daysInMonth;
    let holidayCount = 0;
    let jobdayCount = 0;
    for (let day = 1; day <= daysInMonth; day++) {
      const ymd = ymdKeyFromParts(year, month0, day);
      const dow = getWeekday0InTimeZone({ year, month0, day }, tz);
      if (holidays.has(ymd)) {
        holidayCount++;
      } else if (dow !== 0 && dow !== 6) {
        jobdayCount++;
      }
    }
    return { holidayCount, jobdayCount };
  }

  function toggleHolidayCalendarDay(ymd: string) {
    const key = String(ymd || '').trim();
    if (!key) return;
    setHolidayCalendarHolidays((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  function clearHolidayCalendar() {
    setHolidayCalendarHolidays(new Set());
  }

  async function exportHolidayCalendar() {
    if (holidayCalendarExporting) return;
    setHolidayCalendarExporting(true);
    setHolidayCalendarCopyError(null);
    try {
      const root = getComputedStyle(document.documentElement);
      const accent = root.getPropertyValue('--accent').trim() || '#2563eb';
      const errorColor = root.getPropertyValue('--error').trim() || '#ef4444';

      const year = holidayCalendarMonth.getFullYear();
      const month = holidayCalendarMonth.getMonth();
      const monthLabel = `${year}年 ${month + 1}月`;

      // Export image style: light / readable like the sample
      const bg = '#ffffff';
      const border = '#e5e7eb';
      const text = '#111827';
      const muted = '#d1d5db';
      const red = '#ef4444';

      // Render to canvas directly to keep day numbers perfectly centered.
      const canvas = document.createElement('canvas');
      canvas.width = 1000;
      canvas.height = 1000;
      const ctx = canvas.getContext('2d');
      if (!ctx) throw new Error('画像の生成に失敗しました');

      const padding = 60;
      const headerFontSize = 52;
      const headerMarginBottom = 36;
      const calHeight = 760;
      const headerRowHeight = 64;
      const calX = padding;
      const calY = padding + headerFontSize + headerMarginBottom;
      const calW = canvas.width - padding * 2;
      const calH = calHeight;
      const gridY = calY + headerRowHeight;
      const gridH = calH - headerRowHeight;
      const colW = calW / 7;
      const rowH = gridH / 6;

      const fontFamily = 'Inter, system-ui, -apple-system, "Segoe UI", sans-serif';

      // Background
      ctx.fillStyle = bg;
      ctx.fillRect(0, 0, canvas.width, canvas.height);

      // Month header
      ctx.fillStyle = text;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.font = `500 ${headerFontSize}px ${fontFamily}`;
      ctx.fillText(monthLabel, canvas.width / 2, padding + headerFontSize / 2);

      // Calendar outline
      ctx.strokeStyle = border;
      ctx.lineWidth = 1;
      ctx.strokeRect(calX + 0.5, calY + 0.5, calW - 1, calH - 1);

      // Header row separator
      ctx.beginPath();
      ctx.moveTo(calX, calY + headerRowHeight);
      ctx.lineTo(calX + calW, calY + headerRowHeight);
      ctx.stroke();

      // Day name row
      const dayNames = ['月', '火', '水', '木', '金', '土', '日'];
      ctx.fillStyle = '#4b5563';
      ctx.font = `500 22px ${fontFamily}`;
      for (let i = 0; i < 7; i++) {
        ctx.fillText(dayNames[i], calX + colW * (i + 0.5), calY + headerRowHeight / 2);
      }

      // Grid lines
      ctx.strokeStyle = border;
      ctx.lineWidth = 1;
      ctx.beginPath();
      for (let i = 1; i < 7; i++) {
        const x = calX + colW * i;
        ctx.moveTo(x, gridY);
        ctx.lineTo(x, gridY + gridH);
      }
      for (let j = 1; j < 6; j++) {
        const y = gridY + rowH * j;
        ctx.moveTo(calX, y);
        ctx.lineTo(calX + calW, y);
      }
      ctx.stroke();

      const cells = getHolidayCalendarCells(holidayCalendarMonth, activeTimeZone);

      // Day numbers + holidays
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.font = `700 58px ${fontFamily}`;
      for (let idx = 0; idx < cells.length; idx++) {
        const c = cells[idx];
        const isHoliday = c.inMonth && holidayCalendarHolidays.has(c.ymd);
        const col = idx % 7;
        const row = Math.floor(idx / 7);
        const x0 = calX + colW * col;
        const y0 = gridY + rowH * row;
        const cx = x0 + colW / 2;
        const cy = y0 + rowH / 2;

        // Text color
        if (!c.inMonth) ctx.fillStyle = muted;
        else if (isHoliday) ctx.fillStyle = red;
        else ctx.fillStyle = accent;

        ctx.fillText(String(c.day), cx, cy);

        if (isHoliday) {
          ctx.save();
          ctx.strokeStyle = red;
          ctx.lineWidth = 6;
          ctx.lineCap = 'butt';
          const inset = 8;
          ctx.beginPath();
          ctx.moveTo(x0 + inset, y0 + inset);
          ctx.lineTo(x0 + colW - inset, y0 + rowH - inset);
          ctx.moveTo(x0 + colW - inset, y0 + inset);
          ctx.lineTo(x0 + inset, y0 + rowH - inset);
          ctx.stroke();
          ctx.restore();
        }
      }

      const blob: Blob | null = await new Promise((resolve) => {
        canvas.toBlob((b) => resolve(b), 'image/png');
      });
      if (!blob) throw new Error('画像の生成に失敗しました');

      const fileName = `${year}年${String(month + 1).padStart(2, '0')}月予定表.png`;

      // Try clipboard first
      let copied = false;
      try {
        const navAny = navigator as any;
        if (navAny?.clipboard?.write && (window as any).ClipboardItem) {
          const item = new (window as any).ClipboardItem({ 'image/png': blob });
          await navAny.clipboard.write([item]);
          copied = true;
        }
      } catch {
        copied = false;
      }

      // Fallback: download
      if (!copied) {
        try {
          const url = URL.createObjectURL(blob);
          const a = document.createElement('a');
          a.href = url;
          a.download = fileName;
          document.body.appendChild(a);
          a.click();
          a.remove();
          URL.revokeObjectURL(url);
          setHolidayCalendarCopyError('この環境では画像のクリップボードコピーに未対応のため、代わりにダウンロードしました');
        } catch {
          setHolidayCalendarCopyError('画像のクリップボードコピーに失敗しました');
        }
      }

      setHolidayCalendarCopiedToast(true);
      if (holidayCalendarToastTimerRef.current != null) window.clearTimeout(holidayCalendarToastTimerRef.current);
      holidayCalendarToastTimerRef.current = window.setTimeout(() => {
        setHolidayCalendarCopiedToast(false);
        holidayCalendarToastTimerRef.current = null;
      }, 2000);
    } finally {
      setHolidayCalendarExporting(false);
    }
  }

  // このヘッダー（日時・今日/履歴切替・カレンダー）はタイムラインで必要な要素なので、
  // 今日モードのタブ表示時は「タイムライン」タブでのみ表示する。
  const showMainHeader = effectiveViewMode === 'history' || !(effectiveViewMode === 'today' && accessToken) || todayMainTab === 'timeline';

  const floatingNotices: FloatingNoticeItem[] = useMemo(() => {
    const items: FloatingNoticeItem[] = [];

    // global warnings
    if (error) items.push({ id: 'global:error', text: String(error), tone: 'danger', icon: 'error' });
    if (!accessToken) items.push({ id: 'global:login', text: 'Googleでログインしてください', tone: 'info', icon: 'login' });

    // active tab statuses
    if (effectiveViewMode === 'today' && accessToken) {
      if (todayMainTab === 'taskline') {
        if (taskLineLoading) items.push({ id: 'status:taskline:loading', text: '同期中…' });
        if (!taskLineLoading && taskLineSaving) items.push({ id: 'status:taskline:saving', text: '保存中…' });
        if (!taskLineLoading && !taskLineSaving && taskLineDirty) items.push({ id: 'status:taskline:dirty', text: '未保存' });
        if (taskLineRemoteUpdatePending) items.push({ id: 'status:taskline:remote', text: '他端末で更新あり（保存後に反映）' });
        if (taskLineError) items.push({ id: 'status:taskline:error', text: String(taskLineError), tone: 'danger', icon: 'error' });
      }

      if (todayMainTab === 'calendar') {
        if (calendarLoading) items.push({ id: 'status:calendar:loading', text: '同期中…' });
        if (!calendarLoading && calendarSaving) items.push({ id: 'status:calendar:saving', text: '保存中…' });
        if (!calendarLoading && !calendarSaving && calendarDirty) items.push({ id: 'status:calendar:dirty', text: '未保存' });
        if (calendarRemoteUpdatePending) items.push({ id: 'status:calendar:remote', text: '他端末で更新あり（保存後に反映）' });
        if (calendarError) items.push({ id: 'status:calendar:error', text: String(calendarError), tone: 'danger', icon: 'error' });
      }

      if (todayMainTab === 'gantt') {
        if (ganttLoading) items.push({ id: 'status:gantt:loading', text: '同期中…' });
        if (!ganttLoading && ganttSaving) items.push({ id: 'status:gantt:saving', text: '保存中…' });
        if (!ganttLoading && !ganttSaving && ganttDirty) items.push({ id: 'status:gantt:dirty', text: '未保存' });
        if (ganttRemoteUpdatePending) items.push({ id: 'status:gantt:remote', text: '他端末で更新あり（保存後に反映）' });
        if (ganttError) items.push({ id: 'status:gantt:error', text: String(ganttError), tone: 'danger', icon: 'error' });
      }

      if (todayMainTab === 'alerts') {
        if (alertsLoading) items.push({ id: 'status:alerts:loading', text: '同期中…' });
        if (!alertsLoading && alertsSaving) items.push({ id: 'status:alerts:saving', text: '保存中…' });
        if (!alertsLoading && !alertsSaving && alertsDirty) items.push({ id: 'status:alerts:dirty', text: '未保存' });
        if (alertsRemoteUpdatePending) items.push({ id: 'status:alerts:remote', text: '他端末で更新あり（保存後に反映）' });
        if (alertsError) items.push({ id: 'status:alerts:error', text: String(alertsError), tone: 'danger', icon: 'error' });
      }

      if (todayMainTab === 'notes') {
        if (notesLoading) items.push({ id: 'status:notes:loading', text: '同期中…' });
        if (!notesLoading && notesSaving) items.push({ id: 'status:notes:saving', text: '保存中…' });
        if (!notesLoading && !notesSaving && notesDirty) items.push({ id: 'status:notes:dirty', text: '未保存' });
        if (notesRemoteUpdatePending) items.push({ id: 'status:notes:remote', text: '他端末で更新あり（保存後に反映）' });
        if (notesError) items.push({ id: 'status:notes:error', text: String(notesError), tone: 'danger', icon: 'error' });
      }
    }

    // ephemeral toasts last
    const toasts = Array.isArray(floating?.toasts) ? floating?.toasts : [];
    for (const t of toasts) items.push(t);
    return items;
  }, [
    accessToken,
    alertsDirty,
    alertsError,
    alertsLoading,
    alertsRemoteUpdatePending,
    alertsSaving,
    calendarDirty,
    calendarError,
    calendarLoading,
    calendarRemoteUpdatePending,
    calendarSaving,
    effectiveViewMode,
    error,
    floating?.toasts,
    ganttDirty,
    ganttError,
    ganttLoading,
    ganttRemoteUpdatePending,
    ganttSaving,
    notesDirty,
    notesError,
    notesLoading,
    notesRemoteUpdatePending,
    notesSaving,
    taskLineDirty,
    taskLineError,
    taskLineLoading,
    taskLineRemoteUpdatePending,
    taskLineSaving,
    todayMainTab,
  ]);

  return (
    <div style={{ display: 'contents' }}>
      <div className="titlebar">
        <div className="titlebar-drag">
          <button
            id="mobile-menu-btn"
            className="mobile-menu-btn"
            type="button"
            aria-label="メニュー"
            aria-controls="mobile-sidebar"
            aria-expanded={sidebarOpen}
            onClick={() => setSidebarOpen(true)}
          >
            <span className="material-icons">menu</span>
          </button>

          <button
            id="desktop-sidebar-toggle-btn"
            className="desktop-sidebar-toggle-btn"
            type="button"
            aria-label={sidebarDesktopCollapsed ? 'サイドバーを表示' : 'サイドバーを格納'}
            title={sidebarDesktopCollapsed ? 'サイドバーを表示' : 'サイドバーを格納'}
            onClick={() => setSidebarDesktopCollapsed((v) => !v)}
          >
            <span className="material-icons">{sidebarDesktopCollapsed ? 'chevron_right' : 'chevron_left'}</span>
          </button>

          <div id="web-auth-bar" className="web-auth-bar">
            <div className="web-auth-left">
              <span id="web-auth-status">{userEmail ? userEmail : '未ログイン'}</span>
            </div>
            <div className="web-auth-right">
              {userEmail ? (
                <button
                  id="web-logout-btn"
                  className="btn-secondary"
                  type="button"
                  title="ログアウト"
                  aria-label="ログアウト"
                  onClick={logout}
                  disabled={busy}
                >
                  <span className="material-icons">logout</span>
                </button>
              ) : (
                <button
                  id="web-login-btn"
                  className="btn-secondary"
                  type="button"
                  title="ログイン"
                  aria-label="ログイン"
                  onClick={login}
                  disabled={busy}
                >
                  <span className="material-icons">login</span>
                </button>
              )}
            </div>
          </div>
        </div>
      </div>

      <div className="app-container">
        <div
          id="mobile-overlay"
          className="mobile-overlay"
          aria-hidden={!sidebarOpen}
          onClick={() => setSidebarOpen(false)}
        />
        <aside className="sidebar" id="mobile-sidebar" aria-hidden={!sidebarOpen}>
          <div className="sidebar-header">
            <h2>📋 今日のタスク</h2>
            <div className="task-counter">
              <span id="task-count">{tasks.length}</span> 件
            </div>
          </div>

          <div className="sidebar-content">
            <div className="task-input-section">
              <div className="task-add-tabs" role="tablist" aria-label="タスク追加モード">
                <button
                  id="task-add-tab-now"
                  className={`task-add-tab ${addMode === 'now' ? 'active' : ''}`}
                  role="tab"
                  aria-selected={addMode === 'now'}
                  type="button"
                  title="今すぐ"
                  aria-label="今すぐ"
                  onClick={() => setAddMode('now')}
                >
                  <span className="material-icons">play_arrow</span>
                </button>
                <button
                  id="task-add-tab-reserve"
                  className={`task-add-tab ${addMode === 'reserve' ? 'active' : ''}`}
                  role="tab"
                  aria-selected={addMode === 'reserve'}
                  type="button"
                  title="予約"
                  aria-label="予約"
                  onClick={() => setAddMode('reserve')}
                  disabled={!accessToken || busy || (effectiveViewMode === 'history' && !historyDate)}
                >
                  <span className="material-icons">schedule</span>
                </button>
              </div>

              <div className="tag-select-group">
                <select
                  id="task-tag-select"
                  className="tag-select"
                  aria-label="タグを選択"
                  value={selectedTag}
                  onChange={(e) => setSelectedTag(e.target.value)}
                  disabled={!accessToken || busy}
                >
                  <option value="">タグを選択</option>
                  {tagStock.map((t) => (
                    <option key={`${t.id ?? ''}:${t.name}`} value={t.name}>
                      {t.name}
                    </option>
                  ))}
                </select>
              </div>

              <div id="reserve-time-row" className="reserve-time-row" hidden={addMode !== 'reserve'}>
                <input
                  type="time"
                  id="reserve-time-input"
                  className="reserve-time-input"
                  aria-label="開始時刻"
                  value={reserveStartTime}
                  onChange={(e) => setReserveStartTime(e.target.value)}
                  disabled={!accessToken || busy || (effectiveViewMode === 'history' && (!historyDate || historyDate < todayYmd))}
                />
              </div>

              <div className="task-name-row input-with-button relative">
                <input
                  type="text"
                  id="task-input"
                  name="task-input"
                  autoComplete="off"
                  placeholder="新しいタスクを入力..."
                  className="task-input"
                  ref={taskInputRef}
                  value={newTaskName}
                  onChange={(e) => {
                    setNewTaskName(e.target.value);
                    setTaskSuggestOpen(true);
                  }}
                  onFocus={() => {
                    if (taskSuggestCloseTimerRef.current != null) {
                      window.clearTimeout(taskSuggestCloseTimerRef.current);
                      taskSuggestCloseTimerRef.current = null;
                    }
                    setTaskInputFocused(true);
                    setTaskSuggestOpen(true);
                  }}
                  onBlur={() => {
                    setTaskInputFocused(false);
                    if (taskSuggestCloseTimerRef.current != null) window.clearTimeout(taskSuggestCloseTimerRef.current);
                    taskSuggestCloseTimerRef.current = window.setTimeout(() => {
                      setTaskSuggestOpen(false);
                      taskSuggestCloseTimerRef.current = null;
                    }, 120);
                  }}
                  onKeyDown={(e) => {
                    if (e.key === 'Escape') {
                      setTaskSuggestOpen(false);
                      setTaskSuggestActiveIndex(-1);
                      return;
                    }

                    if (e.key === 'ArrowDown') {
                      e.preventDefault();
                      setTaskSuggestOpen(true);
                      setTaskSuggestActiveIndex((idx) => {
                        if (!taskNameSuggestions.length) return -1;
                        const next = Math.min(idx + 1, taskNameSuggestions.length - 1);
                        return next < 0 ? 0 : next;
                      });
                      return;
                    }

                    if (e.key === 'ArrowUp') {
                      e.preventDefault();
                      setTaskSuggestOpen(true);
                      setTaskSuggestActiveIndex((idx) => {
                        if (!taskNameSuggestions.length) return -1;
                        if (idx <= 0) return 0;
                        return idx - 1;
                      });
                      return;
                    }

                    if (e.key === 'Enter' && taskSuggestOpen && taskSuggestActiveIndex >= 0) {
                      const picked = taskNameSuggestions[taskSuggestActiveIndex];
                      if (picked) {
                        e.preventDefault();
                        setNewTaskNamePlain(picked);
                        setTaskSuggestOpen(false);
                        setTaskSuggestActiveIndex(-1);
                        window.requestAnimationFrame(() => {
                          taskInputRef.current?.focus();
                          try {
                            taskInputRef.current?.setSelectionRange(picked.length, picked.length);
                          } catch {
                            // ignore
                          }
                        });
                        return;
                      }
                    }

                    if (e.key === 'Enter' && String(newTaskName || '').trim()) void addTask();
                  }}
                  disabled={!accessToken || busy || (effectiveViewMode === 'history' && !historyDate)}
                />

                {newTaskCarryMemoUrlEnabled ? (
                  <button
                    type="button"
                    className="icon-btn"
                    title="メモ/URLを引き継ぎ中（クリックで解除）"
                    aria-label="メモ/URLを引き継ぎ中（クリックで解除）"
                    onClick={() => {
                      clearNewTaskCarryMemoUrl();
                      try {
                        taskInputRef.current?.focus();
                      } catch {
                        // ignore
                      }
                    }}
                    disabled={!accessToken || busy || (effectiveViewMode === 'history' && !historyDate)}
                  >
                    <span className="material-icons" aria-hidden="true">
                      sticky_note_2
                    </span>
                  </button>
                ) : null}

                {taskInputFocused && taskSuggestOpen && accessToken && !busy ? (
                  <div
                    className="absolute left-0 right-0 top-full z-20 mt-1 max-h-64 overflow-auto rounded-[var(--radius-small)] border border-[var(--border)] bg-[var(--bg-primary)]"
                    role="listbox"
                    aria-label="タスク候補"
                  >
                    {taskNameSuggestions.length ? (
                      taskNameSuggestions.map((name, idx) => (
                        <button
                          key={name}
                          type="button"
                          role="option"
                          aria-selected={idx === taskSuggestActiveIndex}
                          className={`block w-full px-3 py-2 text-left text-sm text-[var(--text-primary)] hover:bg-[var(--bg-secondary)] ${
                            idx === taskSuggestActiveIndex ? 'bg-[var(--bg-secondary)]' : ''
                          }`}
                          onMouseEnter={() => setTaskSuggestActiveIndex(idx)}
                          onMouseDown={(ev) => {
                            ev.preventDefault();
                            if (taskSuggestCloseTimerRef.current != null) {
                              window.clearTimeout(taskSuggestCloseTimerRef.current);
                              taskSuggestCloseTimerRef.current = null;
                            }
                            setNewTaskNamePlain(name);
                            setTaskSuggestOpen(false);
                            setTaskSuggestActiveIndex(-1);
                            window.requestAnimationFrame(() => {
                              taskInputRef.current?.focus();
                              try {
                                taskInputRef.current?.setSelectionRange(name.length, name.length);
                              } catch {
                                // ignore
                              }
                            });
                          }}
                        >
                          {name}
                        </button>
                      ))
                    ) : (
                      <div className="px-3 py-2 text-sm text-[var(--text-secondary)]">候補なし</div>
                    )}
                  </div>
                ) : null}
              </div>

              <div className="task-add-actions">
                <button
                  id="add-task-btn"
                  className={`btn-primary btn-add-task ${effectiveViewMode === 'today' && addMode !== 'reserve' && runningTask ? 'btn-add-task-big' : ''}`}
                  type="button"
                  title={effectiveViewMode === 'history' && addMode === 'reserve' && historyDate && historyDate < todayYmd ? '過去には予約できません' : '追加'}
                  aria-label={effectiveViewMode === 'history' && addMode === 'reserve' && historyDate && historyDate < todayYmd ? '過去には予約できません' : '追加'}
                  onClick={addTask}
                  disabled={
                    !accessToken ||
                    busy ||
                    !String(newTaskName || '').trim() ||
                    (effectiveViewMode === 'history' && !historyDate) ||
                    (effectiveViewMode === 'history' && addMode === 'reserve' && !!historyDate && historyDate < todayYmd)
                  }
                >
                  <span className="material-icons">
                    {effectiveViewMode === 'history' && addMode === 'reserve' && historyDate && historyDate < todayYmd ? 'remove' : 'add'}
                  </span>
                </button>

                {effectiveViewMode === 'today' && addMode !== 'reserve' && runningTask ? (
                  <button
                    id="end-task-btn"
                    className="btn-primary btn-end-task btn-end-task-small"
                    type="button"
                    title="タスク終了"
                    aria-label="タスク終了"
                    onClick={endTask}
                    disabled={!accessToken || busy}
                  >
                    <span className="material-icons">stop_circle</span>
                  </button>
                ) : null}
              </div>
            </div>

            <div className="action-buttons">
              <button
                id="create-report-btn"
                className="btn-secondary"
                title="報告書作成"
                aria-label="報告書作成"
                type="button"
                onClick={() => setReportOpen(true)}
                disabled={!accessToken || busy}
              >
                <span className="material-icons">description</span>
                報告書作成
              </button>
              <button
                id="tag-work-report-btn"
                className="btn-secondary"
                title="タグ別作業報告"
                aria-label="タグ別作業報告"
                type="button"
                onClick={() => setTagWorkReportOpen(true)}
                disabled={!accessToken || busy}
                style={{ paddingLeft: 32 }}
              >
                <span className="material-icons">label</span>
                タグ別作業報告
              </button>
              <button
                id="goal-stock-btn"
                className="btn-secondary"
                title="目標"
                aria-label="目標"
                type="button"
                onClick={() => setGoalStockOpen(true)}
                disabled={!accessToken || busy}
              >
                <span className="material-icons">flag</span>
                目標
              </button>
              <button
                id="task-stock-btn"
                className="btn-secondary"
                title="タスクストック"
                aria-label="タスクストック"
                type="button"
                onClick={() => setTaskStockOpen(true)}
                disabled={!accessToken || busy}
              >
                <span className="material-icons">bookmark</span>
                タスクストック
              </button>
              <button
                id="tag-stock-btn"
                className="btn-secondary"
                title="タグ"
                aria-label="タグ"
                type="button"
                onClick={() => setTagStockOpen(true)}
                disabled={!accessToken || busy}
              >
                <span className="material-icons">label</span>
                タグ
              </button>
              <button
                id="holiday-calendar-btn"
                className="btn-secondary"
                title="お休みカレンダー"
                aria-label="お休みカレンダー"
                type="button"
                onClick={() => setHolidayCalendarOpen(true)}
                disabled={!accessToken || busy}
              >
                <span className="material-icons">event</span>
                お休みカレンダー
              </button>
              <button
                id="billing-btn"
                className="btn-secondary"
                title="請求"
                aria-label="請求"
                type="button"
                onClick={() => setBillingOpen(true)}
                disabled={!accessToken || busy}
              >
                <span className="material-icons">receipt_long</span>
                請求
              </button>
              <button
                id="settings-btn"
                className="btn-secondary"
                title="設定"
                aria-label="設定"
                type="button"
                onClick={() => setSettingsOpen(true)}
                disabled={!accessToken || busy}
              >
                <span className="material-icons" style={{ fontSize: 18 }}>settings</span>
                設定
              </button>
            </div>
          </div>
        </aside>

        <main className="main-content">
          {accessToken ? (
            <div className={`today-panels-header${showMainHeader ? '' : ' no-main-header'}`}>
              <div className="w-full" aria-label="お知らせ">
                {(() => {
                  const trimmed = String(notice.text || '').trim();
                  const tone = notice.tone || 'default';
                  const isEmpty = trimmed === '';

                  const toneStyles: Record<NoticeTone, { icon: string; border: string; bg: string }> = {
                    info: { icon: 'info', bg: 'bg-blue-950/40', border: 'border-blue-700/40' },
                    danger: { icon: 'error', bg: 'bg-rose-950/45', border: 'border-rose-700/40' },
                    success: { icon: 'check_circle', bg: 'bg-emerald-950/40', border: 'border-emerald-700/40' },
                    warning: { icon: 'warning', bg: 'bg-amber-950/45', border: 'border-amber-700/40' },
                    default: { icon: 'campaign', bg: 'bg-slate-900/55', border: 'border-slate-700/50' },
                  };

                  const s = isEmpty
                    ? { icon: 'campaign', bg: 'bg-white/5', border: 'border-white/10' }
                    : toneStyles[(tone as NoticeTone) || 'default'] || toneStyles.default;
                  return (
                    <div className={`w-full rounded-xl border ${s.border} ${s.bg} px-4 py-3 mb-3`}>
                      <div className="flex items-start gap-3">
                        <span className="material-icons" style={{ fontSize: 18, marginTop: 2, color: 'var(--text-secondary)' }} aria-hidden="true">
                          {s.icon}
                        </span>
                        <div className="min-w-0 flex-1">
                          <div
                            className={`text-sm whitespace-pre-wrap break-words ${
                              isEmpty ? 'text-[color:var(--text-muted)]' : 'text-[color:var(--text-secondary)]'
                            }`}
                          >
                            {trimmed ? notice.text : 'None'}
                          </div>
                        </div>
                        <button
                          type="button"
                          className="shrink-0 rounded-md border border-transparent hover:border-white/10 hover:bg-white/5 p-1"
                          title="お知らせを編集"
                          aria-label="お知らせを編集"
                          onClick={() => {
                            setNoticeModalText(notice.text || '');
                            setNoticeModalTone((notice.tone as NoticeTone) || 'default');
                            setNoticeModalOpen(true);
                          }}
                          disabled={busy}
                        >
                          <span className="material-icons" style={{ fontSize: 18, color: 'var(--text-muted)' }}>
                            edit
                          </span>
                        </button>
                      </div>
                    </div>
                  );
                })()}
              </div>

              <div className="shortcut-launcher-frame" aria-label="ショートカットランチャー">
                <div className="shortcut-launcher-label" aria-hidden="true">Shortcut</div>
                <div
                  className="shortcut-launcher"
                  onDragOver={(ev) => {
                    if (!shortcutDraggingId) return;
                    ev.preventDefault();
                    ev.dataTransfer.dropEffect = 'move';
                    setShortcutDragOverId(null);
                  }}
                  onDrop={(ev) => {
                    if (!shortcutDraggingId) return;
                    ev.preventDefault();
                    const id = ev.dataTransfer.getData('text/plain') || shortcutDraggingId;
                    if (!id) return;
                    moveShortcutByDrop(id, null);
                    setShortcutDragOverId(null);
                  }}
                >
                  {(Array.isArray(shortcuts) ? shortcuts : []).map((sc) => {
                    const label = String(sc.title || sc.url || 'ショートカット');
                    return (
                      <a
                        key={sc.id}
                        href={sc.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className={`shortcut-icon-button${shortcutDragOverId === sc.id ? ' drag-over' : ''}${shortcutDraggingId === sc.id ? ' dragging' : ''}`}
                        title={label}
                        aria-label={label}
                        draggable
                        onClick={(ev) => {
                          if (shortcutDraggingId) {
                            ev.preventDefault();
                            ev.stopPropagation();
                          }
                        }}
                        onContextMenu={(ev) => {
                          ev.preventDefault();
                          ev.stopPropagation();
                          const ok = window.confirm('このショートカットを削除しますか？');
                          if (!ok) return;
                          setShortcuts((prev) => (Array.isArray(prev) ? prev.filter((x) => x.id !== sc.id) : prev));
                        }}
                        onDragStart={(ev) => {
                          setShortcutDraggingId(sc.id);
                          setShortcutDragOverId(null);
                          try {
                            ev.dataTransfer.effectAllowed = 'move';
                            ev.dataTransfer.setData('text/plain', sc.id);
                          } catch {
                            // ignore
                          }
                        }}
                        onDragEnd={() => {
                          setShortcutDraggingId(null);
                          setShortcutDragOverId(null);
                        }}
                        onDragOver={(ev) => {
                          if (!shortcutDraggingId || shortcutDraggingId === sc.id) return;
                          ev.preventDefault();
                          ev.dataTransfer.dropEffect = 'move';
                          setShortcutDragOverId(sc.id);
                        }}
                        onDragLeave={() => {
                          if (shortcutDragOverId === sc.id) setShortcutDragOverId(null);
                        }}
                        onDrop={(ev) => {
                          if (!shortcutDraggingId) return;
                          ev.preventDefault();
                          ev.stopPropagation();
                          const id = ev.dataTransfer.getData('text/plain') || shortcutDraggingId;
                          if (!id || id === sc.id) return;
                          moveShortcutByDrop(id, sc.id);
                          setShortcutDragOverId(null);
                        }}
                      >
                        {sc.iconUrl ? (
                          <img
                            className="shortcut-icon-img"
                            src={sc.iconUrl}
                            alt=""
                            loading="lazy"
                            onError={() => {
                              // clear iconUrl to show fallback icon
                              setShortcuts((prev) => (Array.isArray(prev) ? prev.map((x) => (x.id === sc.id ? { ...x, iconUrl: '' } : x)) : prev));
                            }}
                          />
                        ) : null}
                        <span className="material-icons shortcut-fallback-icon">link</span>
                      </a>
                    );
                  })}
                  <button
                    type="button"
                    className="shortcut-icon-button shortcut-add-button"
                    title={accessToken ? 'ショートカットを追加' : 'ログインすると追加できます'}
                    aria-label={accessToken ? 'ショートカットを追加' : 'ログインすると追加できます'}
                    onClick={() => {
                      if (!accessToken) return;
                      setShortcutModalError(null);
                      setShortcutModalUrl('');
                      setShortcutModalOpen(true);
                    }}
                    disabled={!accessToken || busy}
                  >
                    <span className="material-icons">{accessToken ? 'add' : 'lock'}</span>
                  </button>
                </div>
              </div>

              <div
                className="tab-navigation today-panels-tabs"
                role="tablist"
                aria-label="今日の表示切り替え"
                onWheel={(ev) => {
                  const el = ev.currentTarget;
                  if (el.scrollWidth <= el.clientWidth) return;
                  if (Math.abs(ev.deltaX) > Math.abs(ev.deltaY)) return;
                  el.scrollLeft += ev.deltaY;
                  ev.preventDefault();
                }}
              >
                <button
                  type="button"
                  className={`tab-button tab-icon-only ${todayMainTab === 'timeline' ? 'active' : ''}`}
                  role="tab"
                  aria-selected={todayMainTab === 'timeline'}
                  aria-label="タイムライン"
                  data-tooltip="タイムライン"
                  onClick={() => setTodayMainTab('timeline')}
                >
                  <span aria-hidden="true">📈</span>
                </button>
                <button
                  type="button"
                  className={`tab-button tab-icon-only ${todayMainTab === 'calendar' ? 'active' : ''}`}
                  role="tab"
                  aria-selected={todayMainTab === 'calendar'}
                  aria-label="カレンダー"
                  data-tooltip="カレンダー"
                  onClick={() => setTodayMainTab('calendar')}
                  onDoubleClick={() => {
                    setTodayMainTab('calendar');
                    setCalendarJumpNonce((n) => n + 1);
                  }}
                >
                  <span aria-hidden="true">🗓️</span>
                </button>
                <button
                  type="button"
                  className={`tab-button tab-icon-only ${todayMainTab === 'taskline' ? 'active' : ''}`}
                  role="tab"
                  aria-selected={todayMainTab === 'taskline'}
                  aria-label="カンバン"
                  data-tooltip="カンバン"
                  onClick={() => setTodayMainTab('taskline')}
                >
                  <span aria-hidden="true">🗃️</span>
                </button>
                <button
                  type="button"
                  className={`tab-button tab-icon-only ${todayMainTab === 'gantt' ? 'active' : ''}`}
                  role="tab"
                  aria-selected={todayMainTab === 'gantt'}
                  aria-label="ガント"
                  data-tooltip="ガント"
                  onClick={() => setTodayMainTab('gantt')}
                >
                  <span aria-hidden="true">📅</span>
                </button>
                <button
                  type="button"
                  className={`tab-button tab-icon-only ${todayMainTab === 'alerts' ? 'active' : ''}`}
                  role="tab"
                  aria-selected={todayMainTab === 'alerts'}
                  aria-label="アラート"
                  data-tooltip={alertsAvailable ? 'アラート' : 'アラート（通知の許可が必要です）'}
                  onClick={() => {
                    if (!alertsAvailable) return;
                    setTodayMainTab('alerts');
                  }}
                  disabled={!alertsAvailable}
                  title={alertsAvailable ? undefined : '通知の許可が必要です（設定から許可してください）'}
                >
                  <span aria-hidden="true">🔔</span>
                </button>
                <button
                  type="button"
                  className={`tab-button tab-icon-only ${todayMainTab === 'notes' ? 'active' : ''}`}
                  role="tab"
                  aria-selected={todayMainTab === 'notes'}
                  aria-label="ノート"
                  data-tooltip="ノート"
                  onClick={() => setTodayMainTab('notes')}
                >
                  <span aria-hidden="true">📝</span>
                </button>
              </div>
            </div>
          ) : null}

          {showMainHeader ? (
            <div
              className={`main-header ${effectiveViewMode === 'history' ? 'history-mode' : ''}${effectiveViewMode === 'today' && accessToken ? ' with-tabs' : ''}`}
            >
              <div className="date-display">
                <h1 id="current-date">
                  {effectiveViewMode === 'history' ? (historyDate ? formatDateISOToJaLong(historyDate) : '日付を選択') : formatDateJa(now)}
                </h1>
                <p
                  id="current-time"
                  style={{ visibility: effectiveViewMode === 'history' ? 'hidden' : 'visible' }}
                  aria-hidden={effectiveViewMode === 'history'}
                >
                  {formatTimeHHMMSS(now)}
                </p>
              </div>
              <div className="history-controls">
                <div className="view-mode-toggle">
                  <button
                    id="today-btn"
                    className={`mode-btn ${effectiveViewMode === 'today' ? 'active' : ''}`}
                    title="今日"
                    aria-label="今日"
                    type="button"
                    onClick={() => setViewMode('today')}
                  >
                    <span className="material-icons">today</span>
                  </button>
                  <button
                    id="history-btn"
                    className={`mode-btn ${effectiveViewMode === 'history' ? 'active' : ''}`}
                    title="カレンダー"
                    aria-label="カレンダー"
                    type="button"
                    onClick={() => {
                      setTodayMainTab('timeline');
                      setViewMode('history');
                      if (!historyDate) {
                        const todayIso = todayYmd;
                        const defaultDate = historyDates.includes(todayIso) ? todayIso : (historyDates[0] ?? todayIso);
                        setHistoryDate(defaultDate);
                        if (defaultDate) void loadHistory(defaultDate);
                      }
                    }}
                  >
                    <span className="material-icons">event</span>
                  </button>
                </div>
                <div className="date-selector" id="date-selector" style={{ display: effectiveViewMode === 'history' ? 'flex' : 'none' }}>
                  <div className={`date-input-wrap ${historyDate ? 'has-value' : ''}`} id="date-input-wrap">
                    <input
                      type="date"
                      id="calendar-date-input"
                      value={historyDate}
                      onChange={(e) => {
                        const v = e.target.value;
                        setHistoryDate(v);
                        if (v) void loadHistory(v);
                      }}
                      disabled={!accessToken || busy}
                    />
                  </div>
                </div>
              </div>
              <div className="status-indicators">
                <div className="status-card">
                  <span className="material-icons">access_time</span>
                  <div>
                    <p className="status-label">実行中</p>
                    <p id="current-task">{runningTask?.name || 'タスクなし'}</p>
                  </div>
                </div>
              </div>
            </div>
          ) : null}

          <div
            className={`main-body${showMainHeader ? '' : ' no-header'}${todayMainTab === 'calendar' ? ' is-calendar-tab' : ''}`}
            ref={mainBodyRef}
          >
            {effectiveViewMode === 'today' && accessToken ? (
              <div className="taskline-section" style={{ display: todayMainTab === 'taskline' ? undefined : 'none' }}>
              <div
                className="taskline-scroll"
                ref={taskLineBoardRef}
                onDoubleClick={(ev) => {
                  if (busy) return;
                  // If we are already editing, ignore.
                  if (taskLineEditingId) return;

                  // In some browsers, pointer capture / drag interactions can cause dblclick to target
                  // the scroll container instead of the card. Use the coordinates to find the card.
                  try {
                    const hit = typeof document !== 'undefined' ? document.elementFromPoint(ev.clientX, ev.clientY) : null;
                    const cardEl = hit instanceof HTMLElement ? hit.closest<HTMLElement>('.taskline-card[data-taskline-cardid]') : null;
                    const id = String(cardEl?.getAttribute('data-taskline-cardid') || '').trim();
                    if (!id) return;
                    ev.preventDefault();
                    ev.stopPropagation();
                    openTaskLineEditModalForCard(id);
                  } catch {
                    // ignore
                  }
                }}
                onPointerDown={(ev) => {
                  if (busy) return;
                  if (taskLineEditingId) return;
                  if (ev.button !== 0) return;
                  if (taskLinePointerDragRef.current) return;

                  const target = ev.target instanceof HTMLElement ? ev.target : null;
                  if (target) {
                    if (target.closest('.taskline-card')) return;
                    if (target.closest('button, input, textarea, select, a')) return;
                  }

                  const p = getTaskLinePointInScrollFromClient(ev.clientX, ev.clientY);
                  if (!p) return;
                  taskLineSelectingRef.current = { pointerId: ev.pointerId, startX: p.x, startY: p.y };
                  setTaskLineSelectRect({ x: p.x, y: p.y, w: 0, h: 0 });

                  try {
                    ev.currentTarget.setPointerCapture(ev.pointerId);
                  } catch {
                    // ignore
                  }
                }}
                onPointerMove={(ev) => {
                  const sel = taskLineSelectingRef.current;
                  if (sel && sel.pointerId === ev.pointerId) {
                    const p = getTaskLinePointInScrollFromClient(ev.clientX, ev.clientY);
                    if (!p) return;
                    const left = Math.min(sel.startX, p.x);
                    const top = Math.min(sel.startY, p.y);
                    const w = Math.abs(p.x - sel.startX);
                    const h = Math.abs(p.y - sel.startY);
                    setTaskLineSelectRect({ x: left, y: top, w, h });
                    return;
                  }

                  const drag = taskLinePointerDragRef.current;
                  if (!drag || drag.pointerId !== ev.pointerId) return;

                  const dx = ev.clientX - drag.startClientX;
                  const dy = ev.clientY - drag.startClientY;
                  const threshold = 3;
                  if (!drag.didDrag && dx * dx + dy * dy >= threshold * threshold) {
                    drag.didDrag = true;
                    setTaskLineDraggingId(drag.dragId);
                    setTaskLineDraggingIds(drag.dragIds.slice());
                    taskLineLastPreviewRef.current = null;
                  }
                  if (!drag.didDrag) return;

                  taskLineAutoScrollWhileDraggingAtPoint(ev.clientX, ev.clientY);
                  const nowMs = Date.now();
                  if (nowMs - taskLineLastDragAtRef.current < 40) return;
                  taskLineLastDragAtRef.current = nowMs;
                  const drop = findTaskLineDropTargetFromPoint(ev.clientX, ev.clientY, drag.dragIds);
                  if (!drop) return;
                  if (drag.dragIds.length > 1) taskLinePreviewMoveCards(drag.dragId, drag.dragIds, drop.lane, drop.insertAt);
                  else taskLinePreviewMove(drag.dragId, drop.lane, drop.insertAt);
                }}
                onPointerUp={(ev) => {
                  const sel = taskLineSelectingRef.current;
                  if (sel && sel.pointerId === ev.pointerId) {
                    finalizeTaskLineSelectionRect();
                    try {
                      ev.currentTarget.releasePointerCapture(ev.pointerId);
                    } catch {
                      // ignore
                    }
                    return;
                  }

                  const drag = taskLinePointerDragRef.current;
                  if (drag && drag.pointerId === ev.pointerId) {
                    taskLinePointerDragRef.current = null;
                    if (drag.didDrag) {
                      setTaskLineDraggingId(null);
                      setTaskLineDraggingIds([]);
                      taskLineDragJustEndedAtRef.current = Date.now();
                    } else {
                      setTaskLineDraggingIds([]);
                    }
                    try {
                      ev.currentTarget.releasePointerCapture(ev.pointerId);
                    } catch {
                      // ignore
                    }
                  }
                }}
                onPointerCancel={(ev) => {
                  const sel = taskLineSelectingRef.current;
                  if (sel && sel.pointerId === ev.pointerId) {
                    clearTaskLineSelectionRect();
                  }
                  const drag = taskLinePointerDragRef.current;
                  if (drag && drag.pointerId === ev.pointerId) {
                    taskLinePointerDragRef.current = null;
                    if (drag.didDrag) {
                      setTaskLineDraggingId(null);
                      setTaskLineDraggingIds([]);
                      taskLineDragJustEndedAtRef.current = Date.now();
                    } else {
                      setTaskLineDraggingIds([]);
                    }
                  }
                  try {
                    ev.currentTarget.releasePointerCapture(ev.pointerId);
                  } catch {
                    // ignore
                  }
                }}
              >
                {TASK_LINE_LANES.map((lane) => {
                  const laneCards = taskLineCards
                    .filter((c) => c.lane === lane.key)
                    .slice()
                    .sort((a, b) => (a.order ?? 0) - (b.order ?? 0));

                  const isTodayLane = lane.key !== 'stock' && todayTaskLineLane === lane.key;

                  return (
                    <div
                      key={lane.key}
                      className={`taskline-column${isTodayLane ? ' is-today' : ''}`}
                    >
                      <div className="taskline-column-header">
                        <div className="taskline-column-title">{lane.label}</div>
                        <button
                          type="button"
                          className="taskline-column-add"
                          onClick={() => {
                            if (busy) return;
                            addTaskLineCardAtStart(lane.key);
                          }}
                          title={`${lane.label} に付箋を追加`}
                          aria-label={`${lane.label} に付箋を追加`}
                          disabled={busy}
                        >
                          <span className="material-icons" aria-hidden="true">
                            add
                          </span>
                        </button>
                      </div>

                      <div
                        className="taskline-column-body"
                        data-taskline-drop-lane={lane.key}
                      >
                        {laneCards.map((card, laneIndex) => {
                          return (
                            <div
                              key={card.id}
                              className={`taskline-card${taskLineDraggingCardSet.has(card.id) ? ' dragging' : ''}${taskLineSelectedCardSet.has(card.id) ? ' is-selected' : ''}`}
                              data-taskline-cardid={card.id}
                              data-taskline-laneindex={laneIndex}
                              onPointerDown={(ev) => {
                                if (busy) return;
                                if (taskLineEditingId) return;
                                if (taskLineSelectingRef.current) return;
                                if (ev.button !== 0) return;
                                if (ev.target instanceof HTMLElement && ev.target.closest('a.inline-url')) return;

                                const root = taskLineBoardRef.current;
                                if (!root) return;

                                const currentlySelected = taskLineSelectedCardSet.has(card.id) && taskLineSelectedCardIds.length > 0;
                                const dragIds = currentlySelected ? taskLineSelectedCardIds.slice() : [card.id];
                                if (!currentlySelected) setTaskLineSelectedCardIds([card.id]);

                                taskLinePointerDragRef.current = {
                                  pointerId: ev.pointerId,
                                  dragId: card.id,
                                  dragIds,
                                  startClientX: ev.clientX,
                                  startClientY: ev.clientY,
                                  didDrag: false,
                                };
                                try {
                                  root.setPointerCapture(ev.pointerId);
                                } catch {
                                  // ignore
                                }
                              }}
                              onClick={() => {
                                if (Date.now() - taskLineDragJustEndedAtRef.current < 200) return;
                              }}
                              onDoubleClick={(ev) => {
                                ev.preventDefault();
                                ev.stopPropagation();
                                if (busy) return;
                                openTaskLineEditModalForCard(card.id);
                              }}
                              title={'ダブルクリックで編集'}
                            >
                              <div className="taskline-card-text">{renderTextWithLinks(card.text)}</div>
                            </div>
                          );
                        })}

                        {laneCards.length === 0 ? <div className="taskline-column-empty">ここにドロップ</div> : null}
                      </div>
                    </div>
                  );
                })}
                {taskLineSelectRect ? (
                  <div
                    className="taskline-select-rect"
                    style={{ left: taskLineSelectRect.x, top: taskLineSelectRect.y, width: taskLineSelectRect.w, height: taskLineSelectRect.h }}
                    aria-hidden="true"
                  />
                ) : null}
              </div>
              </div>
            ) : null}

            {effectiveViewMode === 'today' && accessToken ? (
              <div className="calendar-section" style={{ display: todayMainTab === 'calendar' ? undefined : 'none' }}>
                <CalendarBoard
                  todayYmd={todayYmd}
                  nowMs={nowMs}
                  events={calendarEvents}
                  holidayYmds={holidayCalendarHolidays}
                  jumpToYmd={todayYmd}
                  jumpNonce={calendarJumpNonce}
                  onCommitEvents={(nextEvents) => {
                    setCalendarEvents(normalizeCalendarEvents(nextEvents));
                    setCalendarDirty(true);
                    setCalendarRemoteUpdatePending(false);
                  }}
                  onSaveAndSync={(nextEvents) => {
                    if (!accessToken) return;
                    try {
                      if (calendarSaveTimerRef.current) window.clearTimeout(calendarSaveTimerRef.current);
                    } catch {
                      // ignore
                    }
                    calendarSaveTimerRef.current = null;
                    const snapshot = calendarSnapshot(nextEvents);
                    void saveCalendarToServer(normalizeCalendarEvents(nextEvents), snapshot);
                  }}
                  onInteractionChange={(active, editingId) => {
                    const nextActive = !!active;
                    const nextEditingId = editingId ? String(editingId) : null;
                    calendarIsInteractingRef.current = nextActive;
                    calendarEditingIdRef.current = nextEditingId;

                    const prev = calendarInteractionLastRef.current;
                    if (prev.active === nextActive && prev.editingId === nextEditingId) return;
                    calendarInteractionLastRef.current = { active: nextActive, editingId: nextEditingId };
                    setCalendarIsInteracting(nextActive);
                    setCalendarEditingId(nextEditingId);
                  }}
                  disabled={busy}
                />
              </div>
            ) : null}

            {effectiveViewMode === 'today' && accessToken ? (
              <div className="gantt-section" style={{ display: todayMainTab === 'gantt' ? undefined : 'none' }}>
                <GanttBoard
                  tasks={normalizeGanttTasks(ganttTasks)}
                  todayYmd={todayYmd}
                  nowMs={nowMs}
                  rangeStart={ganttRangeStart}
                  rangeDays={ganttRangeDays}
                  dayWidth={ganttDayWidth}
                  selectedTaskId={ganttSelectedTaskId}
                  onSelectTaskId={(id) => {
                    setGanttSelectedTaskId(id);
                  }}
                  onOpenTaskId={(id) => {
                    openGanttTask(id);
                  }}
                  onCreateTaskAt={(args) => {
                    createGanttTaskAt(args);
                  }}
                  onCommitTasks={(nextTasks) => {
                    commitGanttTasks(nextTasks);
                  }}
                  onHeaderDayContextMenu={(ymd) => {
                    if (busy) return;
                    if (!accessToken) return;
                    openGanttBulkDelete(ymd);
                  }}
                  onInteractionChange={(active) => {
                    ganttIsInteractingRef.current = !!active;
                  }}
                  disabled={busy}
                />

                <GanttDrawer
                  open={ganttDrawerOpen}
                  task={ganttSelectedTask}
                  onClose={() => closeGanttDrawer()}
                  onDelete={(taskId) => {
                    const nextTasks = (Array.isArray(ganttTasks) ? ganttTasks : []).filter((t) => t.id !== taskId);
                    commitGanttTasks(nextTasks);
                    try {
                      if (ganttSaveTimerRef.current) window.clearTimeout(ganttSaveTimerRef.current);
                    } catch {
                      // ignore
                    }
                    ganttSaveTimerRef.current = null;
                    const lanes = [{ id: 'default', name: '', order: 0 }];
                    const normalized = normalizeGanttTasks(nextTasks).map((t) => ({ ...t, laneId: 'default' }));
                    const snap = ganttSnapshot(lanes, normalized);
                    void saveGanttToServer(lanes, normalized, snap);
                    closeGanttDrawer();
                  }}
                  onSave={(next) => {
                    const safe = { ...next, endDate: String(next.endDate || '') < String(next.startDate || '') ? String(next.startDate || '') : next.endDate };
                    const nextTasks = (Array.isArray(ganttTasks) ? ganttTasks : []).map((t) => (t.id === safe.id ? safe : t));
                    commitGanttTasks(nextTasks);
                    try {
                      if (ganttSaveTimerRef.current) window.clearTimeout(ganttSaveTimerRef.current);
                    } catch {
                      // ignore
                    }
                    ganttSaveTimerRef.current = null;
                    const lanes = [{ id: 'default', name: '', order: 0 }];
                    const normalized = normalizeGanttTasks(nextTasks).map((t) => ({ ...t, laneId: 'default' }));
                    const snap = ganttSnapshot(lanes, normalized);
                    void saveGanttToServer(lanes, normalized, snap);
                    closeGanttDrawer();
                  }}
                  disabled={busy}
                />

                <div
                  className={`edit-dialog ${ganttBulkDeleteOpen ? 'show' : ''}`}
                  id="gantt-bulk-delete-dialog"
                  aria-hidden={!ganttBulkDeleteOpen}
                  onMouseDown={(e) => {
                    if (e.target === e.currentTarget) closeGanttBulkDelete();
                  }}
                >
                  <div className="edit-content" onMouseDown={(e) => e.stopPropagation()}>
                    <div className="edit-header">
                      <h3>🗑️ 一括削除</h3>
                      <button
                        className="edit-close"
                        title="閉じる"
                        aria-label="閉じる"
                        type="button"
                        onClick={() => closeGanttBulkDelete()}
                      >
                        <span className="material-icons">close</span>
                      </button>
                    </div>
                    <div className="edit-body">
                      <div className="edit-field">
                        <div style={{ fontSize: 14, lineHeight: 1.6, color: 'var(--text-primary)' }}>
                          {ganttBulkDeleteTargets.cutoff ? (
                            <>
                              <div>
                                <strong>{ganttBulkDeleteTargets.cutoff.replace(/-/g, '/')}</strong> 以前（終了日がこの日付以前）のタスクを削除します。
                              </div>
                              <div style={{ marginTop: 6, fontSize: 12, color: 'var(--text-secondary)' }}>
                                対象: {ganttBulkDeleteTargets.count} 件（この日付を跨ぐタスクは残ります）
                              </div>
                            </>
                          ) : (
                            <div>対象日付が不正です。</div>
                          )}
                        </div>
                      </div>
                    </div>
                    <div className="edit-footer">
                      <button
                        className="btn-cancel"
                        type="button"
                        title="キャンセル"
                        aria-label="キャンセル"
                        onClick={() => closeGanttBulkDelete()}
                        disabled={busy}
                      >
                        <span className="material-icons">close</span>
                      </button>
                      <button
                        className="btn-danger"
                        type="button"
                        title="削除"
                        aria-label="削除"
                        onClick={() => confirmGanttBulkDelete()}
                        disabled={!accessToken || busy || !ganttBulkDeleteTargets.cutoff || ganttBulkDeleteTargets.count === 0}
                      >
                        <span className="material-icons">delete</span>
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            ) : null}

            {effectiveViewMode === 'today' && accessToken ? (
              <div className="alerts-section" style={{ display: todayMainTab === 'alerts' ? undefined : 'none' }}>
                <div className="alerts-toolbar">
                  <div className="alerts-actions">
                    <button
                      type="button"
                      className="icon-btn"
                      title="アラートを追加"
                      aria-label="アラートを追加"
                      onClick={() => {
                        if (busy) return;
                        openNewAlertModal();
                      }}
                      disabled={busy}
                    >
                      <span className="material-icons" aria-hidden="true">
                        add
                      </span>
                    </button>
                  </div>
                </div>

                <div className="alerts-list">
                  {(() => {
                    const nowDate = new Date(nowMs);
                    const list = normalizeAlerts(alerts, activeTimeZone, nowMs).map((a) => ({
                      ...a,
                      nextFireAt: computeNextFireAt(a, getAlertComputeBase(a, nowDate), activeTimeZone) || a.nextFireAt || '',
                    }));
                    if (list.length === 0) return <div className="alerts-empty">アラートがありません</div>;

                    const sorted = list
                      .slice()
                      .sort((a, b) => {
                        const am = Date.parse(String(a.nextFireAt || ''));
                        const bm = Date.parse(String(b.nextFireAt || ''));
                        const aOk = Number.isFinite(am);
                        const bOk = Number.isFinite(bm);
                        if (aOk && bOk && am !== bm) return am - bm;
                        if (aOk && !bOk) return -1;
                        if (!aOk && bOk) return 1;
                        return String(a.id).localeCompare(String(b.id));
                      });

                    const weekdayLabel = (d: number) => (d === 0 ? '日' : d === 1 ? '月' : d === 2 ? '火' : d === 3 ? '水' : d === 4 ? '木' : d === 5 ? '金' : d === 6 ? '土' : '');

                    return sorted.map((a) => {
                      const nextText = a.nextFireAt ? formatIsoToZonedYmdHm(a.nextFireAt, activeTimeZone) : '';
                      const nextMs = Date.parse(String(a.nextFireAt || ''));
                      const overdue = Number.isFinite(nextMs) && nextMs <= nowDate.getTime();

                      const ruleText =
                        a.kind === 'once'
                          ? '単発'
                          : a.kind === 'weekly'
                            ? `毎週(${(Array.isArray(a.weeklyDays) ? a.weeklyDays : []).slice().sort((x, y) => x - y).map(weekdayLabel).join('') || '未設定'}) ${String(a.time || '')}`
                            : `毎月(${String(a.monthlyDay || '')}日) ${String(a.time || '')}`;

                      return (
                        <div
                          key={a.id}
                          className={`alerts-item${overdue ? ' is-overdue' : ''}`}
                          onDoubleClick={(e) => {
                            if (busy) return;
                            if (e.target instanceof HTMLElement && e.target.closest('.alerts-item-actions')) return;
                            openEditAlertModal(a.id);
                          }}
                        >
                          <div className="alerts-item-main">
                            <div className="alerts-item-title">{String(a.title || getAlertDefaultTitle(a.kind))}</div>
                            <div className="alerts-item-meta">
                              <span className="alerts-chip">{ruleText}</span>
                              {nextText ? <span className="alerts-next">次回: {nextText}</span> : <span className="alerts-next">次回: —</span>}
                            </div>
                          </div>
                          <div className="alerts-item-actions">
                            <button
                              type="button"
                              className="icon-btn"
                              title="次回をスキップ"
                              aria-label="次回をスキップ"
                              onClick={() => {
                                if (busy) return;
                                if (a.kind === 'once') return;

                                const curNext = String(a.nextFireAt || '').trim();
                                if (!curNext) return;

                                const baseMs = Date.parse(curNext);
                                if (!Number.isFinite(baseMs)) return;
                                const base = new Date(baseMs);

                                setAlerts((prev) =>
                                  (Array.isArray(prev) ? prev : []).map((x) => {
                                    if (x.id !== a.id) return x;
                                    if (x.kind === 'once') return x;
                                    const next: AlertItem = { ...x, skipUntil: curNext };
                                    next.nextFireAt = computeNextFireAt(next, base, activeTimeZone);
                                    return next;
                                  })
                                );
                                setAlertsDirty(true);
                                setAlertsRemoteUpdatePending(false);
                              }}
                              disabled={busy || a.kind === 'once' || !String(a.nextFireAt || '').trim()}
                            >
                              <span className="material-icons" aria-hidden="true">
                                skip_next
                              </span>
                            </button>
                          </div>
                        </div>
                      );
                    });
                  })()}
                </div>

                <div
                  className={`edit-dialog ${alertModalOpen ? 'show' : ''}`}
                  aria-hidden={!alertModalOpen}
                  onMouseDown={(e) => {
                    if (e.target === e.currentTarget) closeAlertModal();
                  }}
                >
                  {alertModalOpen && alertDraft ? (
                    <div
                      className="edit-content"
                      role="dialog"
                      aria-modal="true"
                      aria-label={alertEditingId ? 'アラート編集' : 'アラート追加'}
                      onMouseDown={(e) => e.stopPropagation()}
                    >
                      <div className="edit-body">
                        <div className="edit-field">
                          <label>タイトル</label>
                          <input
                            className="edit-input"
                            value={String(alertDraft.title || '')}
                            onChange={(e) => setAlertDraft({ ...alertDraft, title: e.target.value })}
                            disabled={busy}
                            placeholder={getAlertDefaultTitle(alertDraft.kind)}
                          />
                        </div>

                        <div className="edit-field">
                          <label>種類</label>
                          <select
                            className="edit-input"
                            value={alertDraft.kind}
                            onChange={(e) => {
                              const kind = (e.target.value === 'weekly' || e.target.value === 'monthly' || e.target.value === 'once' ? e.target.value : 'once') as AlertKind;
                              const next: AlertItem = { ...alertDraft, kind };
                              if (kind === 'once') {
                                next.onceAt = next.onceAt || new Date(nowMs + 5 * 60 * 1000).toISOString();
                              }
                              if (kind === 'weekly') {
                                next.time = next.time || '09:00';
                                next.weeklyDays = Array.isArray(next.weeklyDays) && next.weeklyDays.length ? next.weeklyDays : [1, 2, 3, 4, 5];
                              }
                              if (kind === 'monthly') {
                                next.time = next.time || '09:00';
                                next.monthlyDay = typeof next.monthlyDay === 'number' ? next.monthlyDay : 1;
                              }
                              setAlertDraft(next);
                            }}
                            disabled={busy}
                          >
                            <option value="once">単発（指定日時）</option>
                            <option value="weekly">毎週（曜日+時間）</option>
                            <option value="monthly">毎月（日+時間）</option>
                          </select>
                        </div>

                        {alertDraft.kind === 'once' ? (
                          <div className="edit-field">
                            <label>日時（{activeTimeZone}）</label>
                            <input
                              type="datetime-local"
                              className="edit-input"
                              value={isoToZonedDatetimeLocalValue(String(alertDraft.onceAt || ''), activeTimeZone)}
                              onChange={(e) => {
                                const iso = zonedDatetimeLocalValueToIso(e.target.value, activeTimeZone);
                                setAlertDraft({ ...alertDraft, onceAt: iso });
                              }}
                              disabled={busy}
                            />
                          </div>
                        ) : null}

                        {alertDraft.kind === 'weekly' ? (
                          <div className="edit-field">
                            <label>曜日</label>
                            <div className="alerts-weekdays">
                              {(
                                [
                                  { d: 0, label: '日' },
                                  { d: 1, label: '月' },
                                  { d: 2, label: '火' },
                                  { d: 3, label: '水' },
                                  { d: 4, label: '木' },
                                  { d: 5, label: '金' },
                                  { d: 6, label: '土' },
                                ] as Array<{ d: number; label: string }>
                              ).map((opt) => {
                                const days = Array.isArray(alertDraft.weeklyDays) ? alertDraft.weeklyDays : [];
                                const active = days.includes(opt.d);
                                return (
                                  <button
                                    key={opt.d}
                                    type="button"
                                    className={`alerts-weekday-btn ${active ? 'active' : ''}`}
                                    aria-pressed={active}
                                    onClick={() => {
                                      const cur = new Set(days);
                                      if (cur.has(opt.d)) cur.delete(opt.d);
                                      else cur.add(opt.d);
                                      setAlertDraft({ ...alertDraft, weeklyDays: Array.from(cur).sort((a, b) => a - b) });
                                    }}
                                    disabled={busy}
                                  >
                                    {opt.label}
                                  </button>
                                );
                              })}
                            </div>
                          </div>
                        ) : null}

                        {alertDraft.kind === 'weekly' || alertDraft.kind === 'monthly' ? (
                          <div className="edit-field">
                            <label>時間（JST）</label>
                            <input
                              type="time"
                              step={60}
                              className="edit-input"
                              value={String(alertDraft.time || '')}
                              onChange={(e) => setAlertDraft({ ...alertDraft, time: e.target.value })}
                              disabled={busy}
                            />
                          </div>
                        ) : null}

                        {alertDraft.kind === 'monthly' ? (
                          <div className="edit-field">
                            <label>日（1〜31）</label>
                            <div className="alerts-day-picker-wrap" ref={alertMonthlyDayPickerRef}>
                              <div className="alerts-day-picker-row">
                                <input
                                  type="number"
                                  min={1}
                                  max={31}
                                  step={1}
                                  className="edit-input"
                                  value={String(alertDraft.monthlyDay ?? 1)}
                                  onChange={(e) => setAlertDraft({ ...alertDraft, monthlyDay: clampInt(e.target.value, 1, 31, 1) })}
                                  disabled={busy}
                                  aria-label="日"
                                />
                                <button
                                  type="button"
                                  className="icon-btn alerts-day-picker-btn"
                                  title="日を選択"
                                  aria-label="日を選択"
                                  aria-haspopup="dialog"
                                  aria-expanded={alertMonthlyDayPickerOpen}
                                  onClick={() => setAlertMonthlyDayPickerOpen((v) => !v)}
                                  disabled={busy}
                                >
                                  <span className="material-icons" aria-hidden="true">
                                    event
                                  </span>
                                </button>
                              </div>

                              {alertMonthlyDayPickerOpen ? (
                                typeof document !== 'undefined' && alertMonthlyDayPopoverPos
                                  ? createPortal(
                                      <div
                                        ref={alertMonthlyDayPopoverRef}
                                        className="alerts-day-popover"
                                        role="dialog"
                                        aria-label="日を選択"
                                        style={{
                                          position: 'fixed',
                                          top: alertMonthlyDayPopoverPos.top,
                                          left: alertMonthlyDayPopoverPos.left,
                                          zIndex: 7001,
                                        }}
                                        onMouseDown={(e) => e.stopPropagation()}
                                      >
                                        <div className="alerts-day-grid">
                                          {Array.from({ length: 31 }, (_, i) => i + 1).map((d) => {
                                            const active = (alertDraft.monthlyDay ?? 1) === d;
                                            return (
                                              <button
                                                key={`monthly-day-pop-${d}`}
                                                type="button"
                                                className={`alerts-day-cell ${active ? 'active' : ''}`}
                                                aria-pressed={active}
                                                onClick={() => {
                                                  setAlertDraft({ ...alertDraft, monthlyDay: d });
                                                  setAlertMonthlyDayPickerOpen(false);
                                                }}
                                                disabled={busy}
                                              >
                                                {d}
                                              </button>
                                            );
                                          })}
                                        </div>
                                      </div>,
                                      document.body
                                    )
                                  : null
                              ) : null}
                            </div>
                            <div className="alerts-help">※ 存在しない日（例: 2月31日）はその月の最終日に繰り上げます。</div>
                          </div>
                        ) : null}
                      </div>

                      <div className="edit-footer">
                        <button className="btn-cancel" type="button" title="キャンセル" aria-label="キャンセル" onClick={() => closeAlertModal()} disabled={busy}>
                          <span className="material-icons">close</span>
                        </button>
                        <button
                          className="btn-secondary"
                          type="button"
                          title="テスト通知"
                          aria-label="テスト通知"
                          onClick={async () => {
                            if (typeof window === 'undefined') return;
                            if (!('Notification' in window)) {
                              setReservationNotificationPermission('unsupported');
                              return;
                            }

                            try {
                              if (Notification.permission === 'default') {
                                const p = await Notification.requestPermission();
                                setReservationNotificationPermission(p);
                              } else {
                                setReservationNotificationPermission(Notification.permission);
                              }
                            } catch {
                              // ignore
                            }

                            if (Notification.permission !== 'granted') return;
                            try {
                              new Notification('テスト通知', { body: 'アラート通知のテストです', silent: false });
                            } catch {
                              // ignore
                            }
                          }}
                          disabled={busy || reservationNotificationPermission === 'unsupported'}
                        >
                          <span className="material-icons">notifications</span>
                        </button>
                        <button
                          className="btn-primary"
                          type="button"
                          title="保存"
                          aria-label="保存"
                          onClick={() => {
                            if (!alertDraft) return;
                            const effectiveTitle = String(alertDraft.title || '').trim() ? String(alertDraft.title) : getAlertDefaultTitle(alertDraft.kind);
                            upsertAlertFromDraftAndSync({ ...alertDraft, title: effectiveTitle });
                            closeAlertModal();
                          }}
                          disabled={busy}
                        >
                          <span className="material-icons">done</span>
                        </button>
                        {alertEditingId ? (
                          <button
                            className="btn-danger"
                            type="button"
                            title="削除"
                            aria-label="削除"
                            onClick={() => {
                              if (!alertEditingId) return;
                              deleteAlertAndSync(alertEditingId);
                              closeAlertModal();
                            }}
                            disabled={busy}
                          >
                            <span className="material-icons">delete</span>
                          </button>
                        ) : null}
                      </div>
                    </div>
                  ) : null}
                </div>
              </div>
            ) : null}

            {effectiveViewMode === 'today' && accessToken ? (
              <div className="notes-section" style={{ display: todayMainTab === 'notes' ? undefined : 'none' }}>
                <div className="notes-center">
                  <div className="notes-toolbar">
                    <div className="notes-search-row">
                      <button
                        type="button"
                        className="icon-btn notes-add-btn"
                        title="ノートを追加"
                        aria-label="ノートを追加"
                        onClick={() => openNewNoteModal()}
                        disabled={busy}
                      >
                        <span className="material-icons" aria-hidden="true">
                          add
                        </span>
                      </button>
                      <div className="notes-search">
                        <span className="material-icons" aria-hidden="true">
                          search
                        </span>
                        <input
                          type="search"
                          placeholder="本文を検索…"
                          value={notesQuery}
                          onChange={(e) => setNotesQuery(e.target.value)}
                          disabled={busy}
                        />
                      </div>
                    </div>
                  </div>
                </div>

                <div className="notes-grid" ref={notesGridRef}>
                  {(() => {
                    const q = String(notesQuery || '').trim().toLowerCase();
                    const list = normalizeNotes(notes)
                      .filter((n) => {
                        if (!q) return true;
                        return String(n.body || '').toLowerCase().includes(q);
                      })
                      .slice();

                    list.sort((a, b) => {
                      const au = Date.parse(a.updatedAt || a.createdAt || '');
                      const bu = Date.parse(b.updatedAt || b.createdAt || '');
                      if (Number.isFinite(au) && Number.isFinite(bu) && au !== bu) return bu - au;
                      const ac = Date.parse(a.createdAt || '');
                      const bc = Date.parse(b.createdAt || '');
                      if (Number.isFinite(ac) && Number.isFinite(bc) && ac !== bc) return bc - ac;
                      return String(b.id).localeCompare(String(a.id));
                    });

                    if (list.length === 0) {
                      return <div className="notes-empty">ノートがありません</div>;
                    }

                    return list.map((note) => {
                      return (
                        <button
                          key={note.id}
                          className="note-card"
                          type="button"
                          title="クリックして編集"
                          aria-label="クリックして編集"
                          onClick={() => openNoteModal(note.id)}
                          data-note-id={note.id}
                        >
                          <div className="note-preview">{renderTextWithLinks(note.body)}</div>
                        </button>
                      );
                    });
                  })()}
                </div>
              </div>
            ) : null}

            {(effectiveViewMode === 'history' || !(effectiveViewMode === 'today' && accessToken) || todayMainTab === 'timeline') ? (
              <div className={`timeline-section ${effectiveViewMode === 'history' ? 'history-mode' : ''}`}>
                {effectiveViewMode === 'today' && accessToken ? null : <h3>📈 タイムライン</h3>}
                <div className="timeline-container" id="timeline-container">
                  {sortedTimelineTasks.length === 0 ? (
                    <div className="timeline-empty">
                      <span className="material-icons">schedule</span>
                      <p>{timelineEmptyText}</p>
                      <p className="sub-text">新しいタスクを追加してください</p>
                    </div>
                  ) : (
                    sortedTimelineTasks.map((t) => {
                      const isReserved = t.status === 'reserved';
                      const isRunning = !isReserved && !t.endTime;
                      const durationMinutes = !isReserved && t.endTime ? calcDurationMinutes(t.startTime, t.endTime) : null;
                      const duration = durationMinutes != null ? formatDurationJa(durationMinutes) : '';

                      const itemClass = `timeline-item${isRunning ? ' running' : ''}${isReserved ? ' reserved' : ''}`;

                      const startTimeDisplay = formatTimeDisplay(t.startTime);
                      // 実行中は終了時刻が確定するまで空欄（秒不要）
                      // ただし「実行中感」の縦線は表示する
                      const endTimeDisplay = isReserved ? formatTimeDisplay(t.endTime) : t.endTime ? formatTimeDisplay(t.endTime) : '';
                      // 予約は「開始時刻のみ」表示（縦線/終了は非表示）
                      const showRange = !isReserved && !!startTimeDisplay && (isRunning ? true : !!endTimeDisplay);
                      const timeColumn = isReserved ? (
                        <div className="timeline-time">{startTimeDisplay}</div>
                      ) : showRange ? (
                        <div className="timeline-time range">
                          <span className="time-start">{startTimeDisplay}</span>
                          <span className="time-line" aria-hidden="true" />
                          <span className="time-end">{endTimeDisplay}</span>
                        </div>
                      ) : (
                        <div className="timeline-time">{startTimeDisplay}</div>
                      );

                      const statusChip = isReserved ? (
                        <span className="timeline-duration" style={{ background: 'var(--purple)', color: 'var(--bg-primary)' }}>
                          予約
                        </span>
                      ) : isRunning ? (
                        <span className="timeline-duration" style={{ background: 'var(--accent)', color: 'white' }}>
                          実行中
                        </span>
                      ) : null;

                      return (
                        <div key={t.id} className={itemClass}>
                          {timeColumn}
                          <div
                            className="timeline-content"
                            onClick={(e) => {
                              if (e.target instanceof HTMLElement && e.target.closest('a.inline-url')) return;
                              // タイトルクリックは「コピー」を優先（URLがあってもここでは開かない）
                              if (e.target instanceof HTMLElement && e.target.closest('.timeline-task')) return;
                              const urlValue = String((t as any)?.url || '').trim();
                              if (!urlValue) return;
                              e.preventDefault();
                              e.stopPropagation();
                              scheduleOpenExternalUrl(urlValue);
                            }}
                            onDoubleClick={(e) => {
                              e.preventDefault();
                              e.stopPropagation();
                              cancelScheduledOpenExternalUrl();
                              openEditForTask(t);
                            }}
                          >
                            <div
                              className="timeline-task"
                              title="クリックでタスク名をコピー"
                              onClick={(e) => {
                                if (e.target instanceof HTMLElement && e.target.closest('a.inline-url')) return;
                                // タイトルクリックは常に「新しいタスクへ入力」を優先
                                e.preventDefault();
                                e.stopPropagation();
                                e.preventDefault();
                                copyTimelineTaskToNewTask(t);
                                const isMobile =
                                  typeof window !== 'undefined' &&
                                  typeof window.matchMedia === 'function' &&
                                  window.matchMedia('(max-width: 639px)').matches;
                                if (isMobile) setSidebarOpen(true);
                                if (!isMobile && sidebarDesktopCollapsed) setSidebarDesktopCollapsed(false);

                                window.setTimeout(() => {
                                  const input = document.getElementById('task-input') as HTMLInputElement | null;
                                  input?.focus();
                                  if (input) {
                                    try {
                                      input.scrollIntoView({ block: 'center' });
                                    } catch {
                                      // ignore
                                    }
                                    const len = input.value.length;
                                    try {
                                      input.setSelectionRange(len, len);
                                    } catch {
                                      // ignore
                                    }
                                  }
                                }, 0);
                              }}
                            onContextMenu={(e) => {
                              if (e.target instanceof HTMLElement && e.target.closest('a.inline-url')) return;
                              e.preventDefault();
                              copyTimelineTaskToNewTask(t);
                              const input = document.getElementById('task-input') as HTMLInputElement | null;
                              input?.focus();
                            }}
                          >
                            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                              {getWorkTimeTrackIconKind(t) === 'excluded' ? (
                                <span
                                  className="material-icons"
                                  title="就労時間の集計から除外（設定）"
                                  aria-label="就労時間の集計から除外（設定）"
                                  style={{ fontSize: 16, color: 'var(--text-muted)' }}
                                >
                                  local_cafe
                                </span>
                              ) : getWorkTimeTrackIconKind(t) === 'override-untracked' ? (
                                <span
                                  className="material-icons"
                                  title="就労時間の集計から除外（このタスクのみ）"
                                  aria-label="就労時間の集計から除外（このタスクのみ）"
                                  style={{ fontSize: 16, color: 'var(--text-muted)' }}
                                >
                                  timer_off
                                </span>
                              ) : null}
                              <span>{renderTextWithLinks(t.name)}</span>
                                {String((t as any)?.url || '').trim() ? (
                                  <span
                                    className="material-icons"
                                    title="URLを開く"
                                    aria-label="URLを開く"
                                    style={{ fontSize: 16, color: 'var(--text-muted)', cursor: 'pointer' }}
                                    onMouseDown={(ev) => ev.stopPropagation()}
                                    onClick={(ev) => {
                                      ev.preventDefault();
                                      ev.stopPropagation();
                                      scheduleOpenExternalUrl(String((t as any)?.url || ''));
                                    }}
                                  >
                                    link
                                  </span>
                                ) : null}
                            </span>
                          </div>
                          {typeof (t as any)?.memo === 'string' && String((t as any).memo).trim() ? (
                            <div
                              className="timeline-memo"
                              onMouseDownCapture={(e) => {
                                if (e.target instanceof HTMLElement && e.target.closest('a.inline-url')) return;
                                if (String((t as any)?.url || '').trim()) return;
                                e.stopPropagation();
                              }}
                              onClickCapture={(e) => {
                                if (e.target instanceof HTMLElement && e.target.closest('a.inline-url')) return;
                                if (String((t as any)?.url || '').trim()) return;
                                e.stopPropagation();
                              }}
                            >
                              {renderTextWithLinks(String((t as any).memo).trim())}
                            </div>
                          ) : null}
                          <div className="timeline-meta">
                            {duration ? <span className="timeline-duration">{duration}</span> : null}
                            {t.tag ? <span className="task-tag">{t.tag}</span> : null}
                            {statusChip}
                          </div>
                        </div>
                      </div>
                    );
                  })
                )}
              </div>
            </div>
            ) : null}

            <div className="stats-section">
              <div className="stats-grid">
                <div className="stat-card">
                  <div className="stat-icon">
                    <span className="material-icons">trending_up</span>
                  </div>
                  <div className="stat-content">
                    <h4>完了タスク</h4>
                    <p className="stat-number" id="completed-tasks">
                      {completedCount}
                    </p>
                  </div>
                </div>
                <div className="stat-card">
                  <div className="stat-icon">
                    <span className="material-icons">timer</span>
                  </div>
                  <div className="stat-content">
                    <h4>作業時間</h4>
                    <p className="stat-number" id="work-time">
                      {Math.floor(totalMinutes / 60)}:{String(totalMinutes % 60).padStart(2, '0')}
                    </p>
                  </div>
                </div>
                <div className="stat-card">
                  <div className="stat-icon">
                    <span className="material-icons">assessment</span>
                  </div>
                  <div className="stat-content">
                    <h4>生産性</h4>
                    <p className="stat-number" id="productivity">
                      -
                    </p>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </main>
      </div>

      <TaskEditDialog
        open={editOpen}
        busy={busy}
        accessToken={accessToken}
        initial={{ name: editName, tag: editTagTrimmed, startTime: editStartTime, endTime: editEndTime, memo: editMemo, url: editUrl, trackedOverride: editTrackedOverride }}
        taskStock={taskStock}
        tagStock={tagStock}
        getDefaultIsTracked={(name) => getDefaultWorkTimeTrackedByName(name)}
        onClose={() => setEditOpen(false)}
        onToggleTaskStock={(name) => {
          const trimmed = String(name || '').trim();
          if (!trimmed) return;
          const inStock = taskStock.includes(trimmed);
          void (inStock ? removeTextFromTaskStock(trimmed) : addTextToTaskStock(trimmed));
        }}
        onSave={(draft) => {
          void saveEditingTaskFromDraft(draft);
        }}
        onDelete={() => {
          void deleteEditingTask();
        }}
      />

      <NotesEditDialog
        open={notesModalOpen}
        noteId={notesModalId}
        initialBody={notesModalBody}
        busy={busy}
        onClose={() => closeNoteModal()}
        onSave={(body) => saveNoteModal(body)}
        onCopyLink={async (noteId) => {
          setNotesError(null);
          const ok = await copyNotePermalinkToClipboard(noteId);
          if (!ok) setNotesError('リンクのコピーに失敗しました');
          return ok;
        }}
      />

      <NoticeEditDialog
        open={noticeModalOpen}
        busy={busy}
        initial={{ text: noticeModalText, tone: noticeModalTone }}
        onClose={() => setNoticeModalOpen(false)}
        onSave={(next) => {
          setNotice(next);
          void saveNoticeToServerNow(next);
          setNoticeModalOpen(false);
        }}
      />

      <TaskLineEditDialog
        open={taskLineModalOpen}
        busy={busy}
        cardId={taskLineModalCardId}
        initial={{ text: taskLineModalInitialText, weekday: taskLineModalInitialWeekday }}
        onClose={() => closeTaskLineEditModal()}
        onSave={(draft) => saveTaskLineEditModal(draft)}
        onDelete={() => deleteTaskLineFromModal()}
      />

      <div
        className={`edit-dialog ${shortcutModalOpen ? 'show' : ''}`}
        id="shortcut-add-dialog"
        aria-hidden={!shortcutModalOpen}
        onMouseDown={(e) => {
          if (e.target === e.currentTarget) closeShortcutModal();
        }}
      >
        <div className="edit-content shortcut-edit-content" onMouseDown={(e) => e.stopPropagation()}>
          <div className="edit-body">
            <div className="edit-field">
              <label htmlFor="shortcut-add-url">URL</label>
              <input
                ref={shortcutModalInputRef}
                id="shortcut-add-url"
                className="edit-input"
                value={shortcutModalUrl}
                onChange={(e) => setShortcutModalUrl(e.target.value)}
                placeholder="https://..."
                inputMode="url"
                autoCapitalize="none"
                autoCorrect="off"
                spellCheck={false}
                onKeyDown={(ev) => {
                  if (ev.key === 'Escape') {
                    ev.preventDefault();
                    closeShortcutModal();
                    return;
                  }
                  if (ev.key === 'Enter') {
                    ev.preventDefault();
                    void saveShortcutFromModal();
                  }
                }}
                disabled={busy || shortcutModalSaving}
              />
              {shortcutModalError ? (
                <div style={{ marginTop: 8, color: 'var(--error)', fontSize: 12 }}>{shortcutModalError}</div>
              ) : null}
            </div>
          </div>
          <div className="edit-footer">
            <button
              className="btn-cancel"
              type="button"
              title="キャンセル"
              aria-label="キャンセル"
              onClick={() => closeShortcutModal()}
              disabled={busy || shortcutModalSaving}
            >
              <span className="material-icons">close</span>
            </button>
            <button
              className="btn-primary"
              type="button"
              title="保存"
              aria-label="保存"
              onClick={() => void saveShortcutFromModal()}
              disabled={busy || shortcutModalSaving}
            >
              <span className="material-icons">done</span>
            </button>
          </div>
        </div>
      </div>

      <div className={`report-dialog ${reportOpen ? 'show' : ''}`} id="report-dialog" aria-hidden={!reportOpen}>
        <div className="report-content">
          <div className="report-body">
            <div className="report-section">
              <h4>🎯 目標</h4>
              <div className="goal-summary">
                {goalStock.length === 0 ? (
                  <div className="sub-text">未設定</div>
                ) : (
                  goalStock.map((g, idx) => (
                    <div key={`${g.name}:${idx}`} style={{ marginBottom: 6 }}>
                      ・ {g.name}
                    </div>
                  ))
                )}
              </div>
            </div>

            <div className="report-section">
              <h4>🗓️ 今日の作業内容</h4>
              <div className="task-summary">
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8, color: 'var(--text-primary)', fontWeight: 600 }}>
                  <span className="material-icons" style={{ fontSize: 18, color: 'var(--success)' }}>
                    check_box
                  </span>
                  完了したタスク:
                </div>

                {reportCompletedTasks.length === 0 ? (
                  <div className="sub-text">完了したタスクはありません</div>
                ) : (
                  reportCompletedTasks.map((t) => {
                    const minutes = calcDurationMinutes(t.startTime, t.endTime);
                    const duration = minutes != null ? formatDurationJa(minutes) : '';
                    const timeText = `${t.startTime || ''} - ${t.endTime || ''}`;
                    return (
                      <div key={`report-task-${t.id}`} className="task-item">
                        <div>
                          <div className="task-item-name">{t.name}</div>
                          <div className="task-item-time">{timeText}</div>
                        </div>
                        <div className="task-item-duration">{duration || '0分'}</div>
                      </div>
                    );
                  })
                )}
              </div>
            </div>

            <div className="report-section">
              <h4>🔗 報告先</h4>
              <div className="report-links" id="report-links">
                {reportUrls.length === 0 ? (
                  <div className="sub-text">未設定</div>
                ) : (
                  reportUrls.map((u) => (
                    <a key={u.id} href={u.url} target="_blank" rel="noreferrer" className="report-link-btn">
                      <span className="material-icons">open_in_new</span>
                      {u.name}
                    </a>
                  ))
                )}
              </div>
            </div>
            <div className="report-section">
              <h4>📝 報告内容</h4>
              <div className="report-tabs">
                <div
                  className="tab-navigation"
                  id="tab-navigation"
                  onWheel={(ev) => {
                    const el = ev.currentTarget;
                    if (el.scrollWidth <= el.clientWidth) return;
                    if (Math.abs(ev.deltaX) > Math.abs(ev.deltaY)) return;
                    el.scrollLeft += ev.deltaY;
                    ev.preventDefault();
                  }}
                >
                  {reportUrls.map((u) => {
                    const id = String(u.id);
                    const active = (activeReportTabId ?? String(reportUrls[0]?.id ?? '')) === id;
                    return (
                      <button
                        key={u.id}
                        type="button"
                        className={`tab-button ${active ? 'active' : ''}`}
                        onClick={() => {
                          setActiveReportTabId(id);
                          void loadReportTab(id);
                        }}
                      >
                        {u.name}
                      </button>
                    );
                  })}
                </div>
                <div className="tab-content" id="tab-content">
                  <textarea
                    className="tab-textarea"
                    value={activeReportTabId ? reportTabContent[activeReportTabId] ?? '' : reportSingleContent}
                    onChange={(e) => {
                      const v = e.target.value;
                      if (activeReportTabId) {
                        setReportTabContent((p) => ({ ...p, [activeReportTabId]: v }));
                      } else {
                        setReportSingleContent(v);
                      }
                    }}
                  />

                  <div className="report-gpt-controls">
                    <div className="report-date-range">
                      <span className="report-date-label">対象期間</span>
                      <input
                        type="date"
                        value={gptReportRangeStart}
                        onChange={(e) => setGptReportRangeStart(normalizeYmd(e.target.value))}
                        disabled={!accessToken || busy}
                        aria-label="対象期間（開始日）"
                        className="report-date-input"
                      />
                      <span className="report-date-sep">〜</span>
                      <input
                        type="date"
                        value={gptReportRangeEnd}
                        onChange={(e) => setGptReportRangeEnd(normalizeYmd(e.target.value))}
                        disabled={!accessToken || busy}
                        aria-label="対象期間（終了日）"
                        className="report-date-input"
                      />
                    </div>
                    <button
                      type="button"
                      className="btn-secondary report-gpt-generate-btn"
                      title="タイムラインから生成"
                      aria-label="タイムラインから生成"
                      onClick={() => void gptGenerateReportFromTimeline()}
                      disabled={!accessToken || busy}
                    >
                      <span className="material-icons">auto_awesome</span>
                      タイムラインから生成
                    </button>
                  </div>
                </div>
              </div>
            </div>
          </div>
          <div className="report-footer">
            <button className="btn-cancel" id="report-cancel" title="戻る" aria-label="戻る" type="button" onClick={() => setReportOpen(false)}>
              <span className="material-icons">arrow_back</span>
            </button>
            <button
              className="btn-secondary"
              id="goal-copy"
              title="目標をコピー"
              aria-label="目標をコピー"
              type="button"
              onClick={copyGoalsToClipboard}
              disabled={goalStock.length === 0}
            >
              <span className="material-icons">flag</span>
            </button>
            <button
              className="btn-secondary"
              id="copy-timeline-btn"
              title="タイムラインをコピー"
              aria-label="タイムラインをコピー"
              type="button"
              disabled={reportTimelineCopyBlocked}
              onClick={async () => {
                try {
                  const base = effectiveViewMode === 'today' ? tasks : historyTasks;
                  const sorted = [...base].sort((a, b) => {
                    const ma = parseTimeToMinutesFlexible(a.startTime);
                    const mb = parseTimeToMinutesFlexible(b.startTime);
                    if (ma == null && mb == null) return 0;
                    if (ma == null) return 1;
                    if (mb == null) return -1;
                    return ma - mb;
                  });

                  const text = sorted
                    .map((t) => {
                      const tag = t.tag ? ` [${t.tag}]` : '';
                      const start = formatTimeAmPmJa(t.startTime);
                      const end = formatTimeAmPmJa(t.endTime);

                      if (t.status === 'reserved') {
                        const timeLine = `${start} ~ 予約`;
                        const titleLine = `(予約) ${t.name}${tag}`;
                        return `${timeLine}\n${titleLine}`;
                      }

                      if (t.endTime) {
                        const timeLine = `${start} ~ ${end}`;
                        const titleLine = `${t.name}${tag}`;
                        return `${timeLine}\n${titleLine}`;
                      }

                      const timeLine = `${start} ~ 実行中`;
                      const titleLine = `${t.name}${tag}`;
                      return `${timeLine}\n${titleLine}`;
                    })
                    .join('\n');
                  await navigator.clipboard.writeText(text);
                } catch {
                  // ignore
                }
              }}
            >
              <span className="material-icons">timeline</span>
            </button>
            <button
              className="btn-secondary"
              id="report-copy"
              title="テキストをコピー"
              aria-label="テキストをコピー"
              type="button"
              onClick={async () => {
                try {
                  const text = activeReportTabId ? reportTabContent[activeReportTabId] ?? '' : reportSingleContent;
                  await navigator.clipboard.writeText(text);
                } catch {
                  // ignore
                }
              }}
            >
              <span className="material-icons">content_copy</span>
            </button>
            <button
              className="btn-primary"
              id="report-save"
              title="保存"
              aria-label="保存"
              type="button"
              onClick={async () => {
                await saveReport();
              }}
              disabled={!accessToken || busy}
            >
              <span className="material-icons">save</span>
            </button>
          </div>
        </div>
      </div>

      <div className={`report-dialog ${tagWorkReportOpen ? 'show' : ''}`} id="tag-work-report-dialog" aria-hidden={!tagWorkReportOpen}>
        <div className="report-content">
          <div className="report-body">
            <div className="report-section">
              <h4>🗓️ 対象期間</h4>
              <div className="task-summary">
                <div className="report-gpt-controls" style={{ marginTop: 0 }}>
                  <div className="report-date-range">
                    <span className="report-date-label">対象期間</span>
                    <input
                      type="date"
                      value={tagWorkReportRangeStart}
                      onChange={(e) => setTagWorkReportRangeStart(normalizeYmd(e.target.value))}
                      disabled={!accessToken || tagWorkReportLoading}
                      aria-label="対象期間（開始日）"
                      className="report-date-input"
                    />
                    <span className="report-date-sep">〜</span>
                    <input
                      type="date"
                      value={tagWorkReportRangeEnd}
                      onChange={(e) => setTagWorkReportRangeEnd(normalizeYmd(e.target.value))}
                      disabled={!accessToken || tagWorkReportLoading}
                      aria-label="対象期間（終了日）"
                      className="report-date-input"
                    />
                  </div>
                  <button
                    type="button"
                    className="btn-secondary report-gpt-generate-btn"
                    title="表示"
                    aria-label="表示"
                    onClick={() => void loadTagWorkReportSummaryRange()}
                    disabled={!accessToken || tagWorkReportLoading}
                  >
                    <span className="material-icons">refresh</span>
                    表示
                  </button>
                </div>
              </div>
            </div>

            <div className="report-section">
              <h4>⏱️ 合計時間</h4>
              <div className="tag-summary">
                {(() => {
                  const total = tagWorkReportSummary.reduce((s, x) => s + (x.totalMinutes || 0), 0);
                  const rangeText = `${formatDateISOToSlash(normalizeYmd(tagWorkReportRangeStart))}〜${formatDateISOToSlash(
                    normalizeYmd(tagWorkReportRangeEnd)
                  )}`;
                  const totalText = formatDurationJa(total);

                  return (
                    <>
                      {tagWorkReportError ? <div style={{ color: 'var(--error)', fontSize: 12 }}>{tagWorkReportError}</div> : null}
                      <div className="tag-total" style={{ marginTop: 0 }}>
                        <span>
                          対象期間: {rangeText} / 合計: {totalText}
                        </span>
                        <div className="tag-total-actions">
                          <button
                            type="button"
                            className="tag-copy-btn"
                            onClick={async () => {
                              try {
                                await navigator.clipboard.writeText(`${rangeText} 合計 ${totalText}`);
                              } catch {
                                // ignore
                              }
                            }}
                            disabled={total <= 0}
                          >
                            <span className="material-icons">content_copy</span>
                            コピー
                          </button>
                          <button
                            type="button"
                            className="tag-copy-btn tag-csv-btn"
                            onClick={() => {
                              const rows: string[] = ['タグ,合計(分),合計(表示)'];
                              for (const s of tagWorkReportSummary) {
                                const safe = (v: string) => `"${String(v).replace(/"/g, '""')}"`;
                                rows.push([safe(s.tag), String(s.totalMinutes), safe(formatDurationJa(s.totalMinutes))].join(','));
                              }

                              const start = normalizeYmd(tagWorkReportRangeStart);
                              const end = normalizeYmd(tagWorkReportRangeEnd);
                              const blob = new Blob([rows.join('\n')], { type: 'text/csv;charset=utf-8' });
                              const url = URL.createObjectURL(blob);
                              const a = document.createElement('a');
                              a.href = url;
                              a.download = `tag_summary_${start}_${end}.csv`;
                              document.body.appendChild(a);
                              a.click();
                              a.remove();
                              URL.revokeObjectURL(url);
                            }}
                            disabled={tagWorkReportSummary.length === 0}
                          >
                            <span className="material-icons">download</span>
                            CSV
                          </button>
                        </div>
                      </div>
                    </>
                  );
                })()}
              </div>
            </div>

            <div className="report-section">
              <h4>🏷️ タグ別作業時間</h4>
              <div className="tag-summary">
                {tagWorkReportLoading ? (
                  <div className="sub-text">読み込み中...</div>
                ) : tagWorkReportError ? (
                  <div style={{ color: 'var(--error)', fontSize: 12 }}>{tagWorkReportError}</div>
                ) : tagWorkReportSummary.length === 0 ? (
                  <div className="sub-text">対象期間にタグ付きのタスクがありません</div>
                ) : (
                  <>
                    <div className="tag-tabs-container">
                      <div className="tag-tabs-navigation" role="tablist" aria-label="タグ別作業時間（対象期間）">
                        {tagWorkReportSummary.map((s) => {
                          const label = `${s.tag} (${formatDurationJa(s.totalMinutes)})`;
                          return (
                            <button
                              key={`tag-report-tab-${s.tag}`}
                              type="button"
                              className={`tag-tab ${tagWorkReportActiveTag === s.tag ? 'active' : ''}`}
                              role="tab"
                              aria-selected={tagWorkReportActiveTag === s.tag}
                              onClick={() => setTagWorkReportActiveTag(s.tag)}
                            >
                              {label}
                            </button>
                          );
                        })}
                      </div>
                    </div>

                    <div className="tag-tabs-content">
                      {tagWorkReportSummary.map((s) => {
                        const isActive = s.tag === tagWorkReportActiveTag;
                        return (
                          <div key={`tag-report-panel-${s.tag}`} className={`tag-tab-panel ${isActive ? 'active' : ''}`} role="tabpanel">
                            <div className="tag-tasks">
                              {s.groups.map((g) => (
                                <div key={`tag-report-date-${s.tag}-${g.date}`} className="tag-date-group">
                                  <div className="date-header-with-stats">
                                    <div className="date-header">{formatDateISOToJaShort(g.date)}</div>
                                    <div className="date-total">
                                      <span>{formatDurationJa(g.totalMinutes)}</span>
                                      <span>({g.count}件)</span>
                                    </div>
                                  </div>

                                  {g.tasks.map((t, idx) => (
                                    <div key={`tag-report-task-${s.tag}-${g.date}-${idx}`} className="task-item">
                                      <div>
                                        <div className="task-item-name">{t.name}</div>
                                        <div className="task-item-time">
                                          {formatTimeDisplay(t.startTime)} - {formatTimeDisplay(t.endTime)}
                                        </div>
                                      </div>
                                      <div className="task-item-duration">{formatDurationJa(t.minutes)}</div>
                                    </div>
                                  ))}
                                </div>
                              ))}
                            </div>

                            <div className="tag-total">
                              <span>合計: {formatDurationJa(s.totalMinutes)}</span>
                              <div className="tag-total-actions">
                                <button
                                  type="button"
                                  className="tag-copy-btn"
                                  onClick={async () => {
                                    try {
                                      await navigator.clipboard.writeText(`${s.tag} - ${formatDurationJa(s.totalMinutes)}`);
                                    } catch {
                                      // ignore
                                    }
                                  }}
                                >
                                  <span className="material-icons">content_copy</span>
                                  コピー
                                </button>
                                <button
                                  type="button"
                                  className="tag-copy-btn tag-csv-btn"
                                  onClick={() => {
                                    const rows: string[] = ['作業日,作業内容,作業開始時刻,作業終了時刻'];
                                    for (const g of s.groups) {
                                      for (const t of g.tasks) {
                                        const safe = (v: string) => `"${String(v).replace(/"/g, '""')}"`;
                                        const dateCell = formatDateISOToSlash(g.date);
                                        const start = formatTimeDisplay(t.startTime);
                                        const end = formatTimeDisplay(t.endTime);
                                        rows.push([safe(dateCell), safe(t.name), safe(start), safe(end)].join(','));
                                      }
                                    }

                                    const start = normalizeYmd(tagWorkReportRangeStart);
                                    const end = normalizeYmd(tagWorkReportRangeEnd);
                                    const fileTag = String(s.tag || 'tag').replace(/[\\/:*?"<>|]/g, '_');
                                    const blob = new Blob([rows.join('\n')], { type: 'text/csv;charset=utf-8' });
                                    const url = URL.createObjectURL(blob);
                                    const a = document.createElement('a');
                                    a.href = url;
                                    a.download = `tag_${fileTag}_${start}_${end}.csv`;
                                    document.body.appendChild(a);
                                    a.click();
                                    a.remove();
                                    URL.revokeObjectURL(url);
                                  }}
                                  disabled={s.groups.length === 0}
                                >
                                  <span className="material-icons">download</span>
                                  CSV
                                </button>
                              </div>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </>
                )}
              </div>
            </div>
          </div>

          <div className="report-footer">
            <button
              className="btn-cancel"
              id="tag-work-report-cancel"
              title="戻る"
              aria-label="戻る"
              type="button"
              onClick={() => setTagWorkReportOpen(false)}
            >
              <span className="material-icons">arrow_back</span>
            </button>
          </div>
        </div>
      </div>

      <div className={`settings-dialog ${settingsOpen ? 'show' : ''}`} id="settings-dialog" aria-hidden={!settingsOpen}>
        <div className="settings-content">
          <div className="settings-body">
            {error ? (
              <div className="settings-section">
                <p className="settings-hint" style={{ color: 'var(--error)' }}>{error}</p>
              </div>
            ) : null}
            {settingsRemoteUpdatePending ? (
              <div className="settings-section">
                <p className="settings-hint">他端末で設定が更新されました。保存すると上書きされるため、必要なら閉じてから開き直してください。</p>
              </div>
            ) : null}
            <div className="settings-section">
              <h4>⏱️ 時刻の丸め</h4>
              <p className="settings-hint">タスクの開始/終了ボタンを押した時刻を、指定した単位で自動的に丸めます。</p>
              <div className="settings-grid-2col">
                <div className="settings-field">
                  <label htmlFor="time-rounding-interval" className="settings-label">
                    丸め単位
                  </label>
                  <select
                    id="time-rounding-interval"
                    className="edit-input"
                    value={String(settingsTimeRoundingInterval)}
                    onChange={(e) => {
                      setSettingsTimeRoundingInterval(parseInt(e.target.value || '0', 10) || 0);
                      setSettingsDirty(true);
                    }}
                  >
                    <option value="0">リアルタイム（丸めなし）</option>
                    <option value="5">5分</option>
                    <option value="10">10分</option>
                    <option value="15">15分</option>
                    <option value="30">30分</option>
                  </select>
                </div>
                <div className="settings-field">
                  <label htmlFor="time-rounding-mode" className="settings-label">
                    丸め方法
                  </label>
                  <select
                    id="time-rounding-mode"
                    className="edit-input"
                    value={settingsTimeRoundingMode}
                    onChange={(e) => {
                      setSettingsTimeRoundingMode((e.target.value as any) || 'nearest');
                      setSettingsDirty(true);
                    }}
                  >
                    <option value="nearest">最近接（四捨五入）</option>
                    <option value="floor">切り捨て</option>
                    <option value="ceil">切り上げ</option>
                  </select>
                </div>
              </div>
              <div id="time-rounding-preview" className="rounding-preview" aria-live="polite">
                例: 現在 10:12 → 丸め後 10:10
              </div>
            </div>

            <div className="settings-section">
              <h4>🌐 タイムゾーン</h4>
              <p className="settings-hint">表示・日付の切り替わり・アラート計算に使用します。</p>
              <div className="settings-grid-2col">
                <div className="settings-field" style={{ gridColumn: '1 / -1' }}>
                  <label htmlFor="ui-timezone" className="settings-label">
                    タイムゾーン
                  </label>
                  <select
                    id="ui-timezone"
                    className="edit-input"
                    value={activeTimeZone}
                    onChange={(e) => {
                      setSettingsTimeZone(normalizeTimeZone(e.target.value || DEFAULT_TIME_ZONE));
                      setSettingsDirty(true);
                    }}
                    disabled={!accessToken || busy}
                  >
                    {Array.from(new Set([activeTimeZone, ...getCommonTimeZones()])).map((tz) => (
                      <option key={tz} value={tz}>
                        {tz}
                      </option>
                    ))}
                  </select>
                  <div className="settings-hint" style={{ margin: 0 }}>
                    現在: {activeTimeZone} / 今日: {todayYmd.replace(/-/g, '/')}
                  </div>
                </div>
              </div>
            </div>

            <div className="settings-section">
              <h4>🔗 報告先URL</h4>
              <div className="url-list">
                {reportUrls.length === 0 ? (
                  <div className="url-list-empty">
                    <span className="material-icons">link_off</span>
                    <div>報告先が未設定です</div>
                  </div>
                ) : (
                  reportUrls.map((u) => (
                    <div key={`settings-url-${u.id}`} className="url-item">
                      <div className="url-info">
                        <div className="url-name">{u.name}</div>
                        <div className="url-address">{u.url}</div>
                      </div>
                      <div className="url-actions">
                        <button
                          className="delete"
                          type="button"
                          title="削除"
                          aria-label="削除"
                          onClick={() => deleteReportUrl(u.id)}
                          disabled={!accessToken || busy}
                        >
                          <span className="material-icons">delete</span>
                        </button>
                      </div>
                    </div>
                  ))
                )}
              </div>

              <div className="add-url-form">
                <h5>新しい報告先を追加</h5>
                <div className="input-row">
                  <input
                    type="text"
                    value={newReportUrl.name}
                    onChange={(e) => setNewReportUrl((p) => ({ ...p, name: e.target.value }))}
                    placeholder="表示名（例：Slack、Teams）"
                    disabled={!accessToken || busy}
                  />
                  <input
                    type="url"
                    value={newReportUrl.url}
                    onChange={(e) => setNewReportUrl((p) => ({ ...p, url: e.target.value }))}
                    placeholder="URL（例：https://hooks.slack.com/...）"
                    disabled={!accessToken || busy}
                  />
                  <button type="button" title="追加" aria-label="追加" onClick={addReportUrl} disabled={!accessToken || busy}>
                    <span className="material-icons">add</span>
                  </button>
                </div>
              </div>
            </div>

            <div className="settings-section">
              <h4>🧮 就労時間集計</h4>
              <p className="settings-hint">ここで指定したタスク名は、就労時間の集計から除外します（完全一致）。</p>
              <div className="url-list">
                {settingsExcludeTaskNames.length === 0 ? (
                  <div className="url-list-empty">
                    <span className="material-icons">do_not_disturb_on</span>
                    <div>除外タスクは未設定です</div>
                  </div>
                ) : (
                  settingsExcludeTaskNames.map((name) => (
                    <div key={`settings-exclude-${name}`} className="url-item">
                      <div className="url-info">
                        <div className="url-name">{name}</div>
                        <div className="url-address">完全一致で除外</div>
                      </div>
                      <div className="url-actions">
                        <button
                          className="delete"
                          type="button"
                          title="削除"
                          aria-label="削除"
                          onClick={() => {
                            setSettingsExcludeTaskNames((p) => p.filter((x) => x !== name));
                            setSettingsDirty(true);
                          }}
                          disabled={!accessToken || busy}
                        >
                          <span className="material-icons">delete</span>
                        </button>
                      </div>
                    </div>
                  ))
                )}
              </div>

              <div className="add-url-form">
                <h5>除外タスクを追加</h5>
                <div className="input-row">
                  <input
                    type="text"
                    value={settingsExcludeTaskNameInput}
                    onChange={(e) => setSettingsExcludeTaskNameInput(e.target.value)}
                    placeholder="タスク名（例：休憩）"
                    disabled={!accessToken || busy}
                  />
                  <button
                    type="button"
                    title="追加"
                    aria-label="追加"
                    onClick={() => {
                      const name = settingsExcludeTaskNameInput.trim();
                      if (!name) return;
                      setSettingsExcludeTaskNames((p) => {
                        if (p.includes(name)) return p;
                        return [...p, name];
                      });
                      setSettingsExcludeTaskNameInput('');
                      setSettingsDirty(true);
                    }}
                    disabled={!accessToken || busy}
                  >
                    <span className="material-icons">add</span>
                  </button>
                </div>
              </div>
            </div>

            <div className="settings-section">
              <h4>🔔 予約タスク通知</h4>
              <p className="settings-hint">予約タスク（status=reserved）の開始時刻に合わせて通知します。0分前（開始時）も設定できます。</p>
              <div className="settings-grid-2col">
                <div className="settings-field" style={{ gridColumn: '1 / -1' }}>
                  <label className="settings-label" htmlFor="reservation-notify-enabled">
                    有効化
                  </label>
                  <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
                    <input
                      id="reservation-notify-enabled"
                      type="checkbox"
                      checked={!!settingsReservationNotifyEnabled}
                      onChange={(e) => {
                        setSettingsReservationNotifyEnabled(!!e.target.checked);
                        setSettingsDirty(true);
                      }}
                      disabled={!accessToken || busy}
                    />
                    <div className="settings-hint" style={{ margin: 0 }}>
                      {settingsReservationNotifyEnabled ? 'ON' : 'OFF'}
                    </div>
                  </div>
                </div>

                <div className="settings-field" style={{ gridColumn: '1 / -1' }}>
                  <label className="settings-label">ブラウザ通知（Web Notification）</label>
                  <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
                    <div className="settings-hint" style={{ margin: 0 }}>
                      状態: {reservationNotificationPermission === 'unsupported' ? '未対応' : reservationNotificationPermission}
                    </div>
                    <button
                      type="button"
                      className="btn-secondary"
                      onClick={async () => {
                        if (typeof window === 'undefined') return;
                        if (!('Notification' in window)) {
                          setReservationNotificationPermission('unsupported');
                          return;
                        }
                        try {
                          const p = await Notification.requestPermission();
                          setReservationNotificationPermission(p);
                        } catch {
                          // ignore
                        }
                      }}
                      disabled={!accessToken || busy || reservationNotificationPermission === 'unsupported'}
                      title="通知の許可をリクエスト"
                      aria-label="通知の許可をリクエスト"
                    >
                      <span className="material-icons">notifications</span>
                      許可する
                    </button>
                    <div className="settings-hint" style={{ margin: 0 }}>
                      許可がなくても、アプリ内トーストは表示します。
                    </div>
                  </div>
                </div>

                <div className="settings-field" style={{ gridColumn: '1 / -1' }}>
                  <label className="settings-label">通知タイミング（分前）</label>
                  <div className="url-list">
                    {settingsReservationNotifyMinutesBefore.length === 0 ? (
                      <div className="url-list-empty">
                        <span className="material-icons">notifications_off</span>
                        <div>未設定です（例: 0, 5, 10）</div>
                      </div>
                    ) : (
                      settingsReservationNotifyMinutesBefore.map((m) => (
                        <div key={`reservation-notify-min-${m}`} className="url-item">
                          <div className="url-info">
                            <div className="url-name">{m}分前</div>
                            <div className="url-address">{m === 0 ? '開始時刻' : `開始の${m}分前`}</div>
                          </div>
                          <div className="url-actions">
                            <button
                              className="delete"
                              type="button"
                              title="削除"
                              aria-label="削除"
                              onClick={() => {
                                setSettingsReservationNotifyMinutesBefore((p) => p.filter((x) => x !== m));
                                setSettingsDirty(true);
                              }}
                              disabled={!accessToken || busy}
                            >
                              <span className="material-icons">delete</span>
                            </button>
                          </div>
                        </div>
                      ))
                    )}
                  </div>

                  <div className="add-url-form">
                    <h5>追加</h5>
                    <div className="input-row">
                      <input
                        type="number"
                        min={0}
                        max={1440}
                        value={settingsReservationNotifyMinutesInput}
                        onChange={(e) => setSettingsReservationNotifyMinutesInput(e.target.value)}
                        placeholder="分（例: 0）"
                        disabled={!accessToken || busy}
                      />
                      <button
                        type="button"
                        title="追加"
                        aria-label="追加"
                        onClick={() => {
                          const n = Math.trunc(Number(settingsReservationNotifyMinutesInput));
                          if (!Number.isFinite(n)) return;
                          if (n < 0 || n > 1440) return;
                          setSettingsReservationNotifyMinutesBefore((p) => normalizeNotifyMinutesBeforeList([...(p || []), n]));
                          setSettingsReservationNotifyMinutesInput('');
                          setSettingsDirty(true);
                        }}
                        disabled={!accessToken || busy}
                      >
                        <span className="material-icons">add</span>
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            </div>

            <div className="settings-section">
              <h4>🕒 自動表示</h4>
              <p className="settings-hint">10分間操作（クリック/入力など）がない場合、タイムラインタブを表示します。</p>
              <div className="settings-grid-2col">
                <div className="settings-field" style={{ gridColumn: '1 / -1' }}>
                  <label className="settings-label" htmlFor="auto-show-timeline-on-idle">
                    無操作でタイムラインへ戻す
                  </label>
                  <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
                    <input
                      id="auto-show-timeline-on-idle"
                      type="checkbox"
                      checked={!!settingsAutoShowTimelineOnIdle}
                      onChange={(e) => {
                        setSettingsAutoShowTimelineOnIdle(!!e.target.checked);
                        setSettingsDirty(true);
                      }}
                      disabled={!accessToken || busy}
                    />
                    <div className="settings-hint" style={{ margin: 0 }}>
                      {settingsAutoShowTimelineOnIdle ? 'ON' : 'OFF'}
                    </div>
                  </div>
                </div>
              </div>
            </div>

            <div className="settings-section">
              <h4>🤖 GPT</h4>
              <p className="settings-hint">GPTのAPIキーを保存します（DBには暗号化して保存されます）。</p>
              <div className="settings-grid-2col">
                <div className="settings-field">
                  <label htmlFor="gpt-api-key" className="settings-label">
                    GPT APIキー
                  </label>
                  <input
                    id="gpt-api-key"
                    className="edit-input"
                    type="password"
                    value={settingsGptApiKeyInput}
                    onChange={(e) => setSettingsGptApiKeyInput(e.target.value)}
                    placeholder={settingsGptApiKeySaved ? '設定済み（変更する場合のみ入力）' : 'sk-...'}
                    disabled={!accessToken || busy}
                  />
                </div>
                <div className="settings-field" style={{ display: 'flex', alignItems: 'flex-end' }}>
                  <div className="settings-hint" style={{ margin: 0 }}>
                    {settingsGptApiKeySaved ? '現在: 設定済み' : '現在: 未設定'}
                    {settingsGptEncryptionReady === false ? '（サーバ設定不足）' : ''}
                  </div>
                </div>
              </div>
            </div>
          </div>
          <div className="settings-footer">
            <button className="btn-cancel" id="settings-cancel" title="戻る" aria-label="戻る" type="button" onClick={() => setSettingsOpen(false)}>
              <span className="material-icons">arrow_back</span>
            </button>
            <button
              className="btn-primary"
              id="settings-save"
              title="保存"
              aria-label="保存"
              type="button"
              onClick={saveSettings}
              disabled={!accessToken || busy}
            >
              <span className="material-icons">save</span>
            </button>
          </div>
        </div>
      </div>

      <div className={`task-stock-dialog ${goalStockOpen ? 'show' : ''}`} id="goal-stock-dialog" aria-hidden={!goalStockOpen}>
        <div className="task-stock-content">
          <div className="task-stock-body">
            <div className="task-stock-section">
              <h4>🎯 保存済み目標</h4>
              <p className="task-stock-help-text">目標はドラッグで並び替えできます</p>
              <div className="task-stock-list" id="goal-stock-list">
                {tempGoalStock.length === 0 ? (
                  <div className="task-stock-empty">
                    <span className="material-icons">inventory_2</span>
                    <p>目標は空です</p>
                  </div>
                ) : (
                  tempGoalStock.map((g, idx) => (
                    <div
                      key={`${g.name}:${idx}`}
                      className={`goal-stock-item${goalStockDragOverIndex === idx ? ' drag-over' : ''}${goalStockDraggingIndex === idx ? ' dragging' : ''}`}
                    >
                      <div className="goal-stock-content">
                        <div
                          className="goal-stock-item-name"
                          title="目標名"
                          draggable
                          onDragStart={(e) => {
                            goalStockDragFromIndexRef.current = idx;
                            setGoalStockDraggingIndex(idx);
                            setGoalStockDragOverIndex(idx);
                            try {
                              e.dataTransfer.effectAllowed = 'move';
                              e.dataTransfer.setData('text/plain', g.name);
                            } catch {
                              // ignore
                            }
                          }}
                          onDragOver={(e) => {
                            e.preventDefault();
                            if (goalStockDragFromIndexRef.current != null) setGoalStockDragOverIndex(idx);
                            try {
                              e.dataTransfer.dropEffect = 'move';
                            } catch {
                              // ignore
                            }
                          }}
                          onDrop={(e) => {
                            e.preventDefault();
                            const from = goalStockDragFromIndexRef.current;
                            if (from == null) return;
                            if (from === idx) return;
                            setTempGoalStock((p) => arrayMove(p, from, idx));
                            setGoalDirty(true);
                            goalStockDragFromIndexRef.current = idx;
                            setGoalStockDraggingIndex(idx);
                            setGoalStockDragOverIndex(null);
                          }}
                          onDragEnd={() => {
                            goalStockDragFromIndexRef.current = null;
                            setGoalStockDraggingIndex(null);
                            setGoalStockDragOverIndex(null);
                          }}
                          style={{ cursor: 'grab' }}
                        >
                          {g.name}
                        </div>
                        <button
                          type="button"
                          title="削除"
                          onClick={() => {
                            setTempGoalStock((p) => p.filter((_, i) => i !== idx));
                            setGoalDirty(true);
                          }}
                        >
                          <span className="material-icons">delete</span>
                        </button>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>
            <div className="task-stock-section">
              <h4>➕ 新しい目標を追加</h4>
              <div className="task-stock-input">
                <input
                  type="text"
                  id="goal-stock-input"
                  className="edit-input"
                  placeholder="目標を入力してください"
                  value={goalInput}
                  onChange={(e) => setGoalInput(e.target.value)}
                />
                <button
                  id="add-goal-stock-btn"
                  className="btn-primary"
                  title="追加"
                  aria-label="追加"
                  type="button"
                  onClick={() => {
                    const name = goalInput.trim();
                    if (!name) return;
                    setTempGoalStock((p) => [...p, { name }]);
                    setGoalInput('');
                    setGoalDirty(true);
                  }}
                  disabled={!accessToken || busy}
                >
                  <span className="material-icons">add</span>
                </button>
              </div>
            </div>
          </div>
          <div className="task-stock-footer">
            <div className="task-stock-footer-buttons">
              <button className="btn-cancel" id="goal-stock-cancel" title="戻る" aria-label="戻る" type="button" onClick={() => setGoalStockOpen(false)}>
                <span className="material-icons">arrow_back</span>
              </button>
              <button
                className="btn-primary"
                id="save-goal-stock-btn"
                type="button"
                onClick={saveGoalStockChanges}
                disabled={!accessToken || busy || !goalDirty}
              >
                <span className="material-icons">save</span>
              </button>
            </div>
          </div>
        </div>
      </div>

      <div className={`task-stock-dialog ${taskStockOpen ? 'show' : ''}`} id="task-stock-dialog" aria-hidden={!taskStockOpen}>
        <div className="task-stock-content">
          <div className="task-stock-body">
            <div className="task-stock-section">
              <h4>💾 保存済みタスク</h4>
              <p className="task-stock-help-text">タスクはドラッグで並び替えできます（クリックで入力欄に追加）</p>
              <div className="task-stock-list" id="task-stock-list">
                {tempTaskStock.length === 0 ? (
                  <div className="task-stock-empty">
                    <span className="material-icons">inventory_2</span>
                    <p>タスクストックは空です</p>
                    <p className="sub-text">📚ボタンでタスクを追加してください</p>
                  </div>
                ) : (
                  tempTaskStock.map((t, idx) => (
                    <div
                      key={`${t}:${idx}`}
                      className={`task-stock-item${taskStockDragOverIndex === idx ? ' drag-over' : ''}${taskStockDraggingIndex === idx ? ' dragging' : ''}`}
                    >
                      <div className="stock-item-content">
                        <div
                          className="task-stock-item-name clickable"
                          title="クリックして新しいタスクに追加"
                          draggable
                          onDragStart={(e) => {
                            taskStockDragFromIndexRef.current = idx;
                            taskStockLastDragAtRef.current = Date.now();
                            setTaskStockDraggingIndex(idx);
                            setTaskStockDragOverIndex(idx);
                            try {
                              e.dataTransfer.effectAllowed = 'move';
                              e.dataTransfer.setData('text/plain', t);
                            } catch {
                              // ignore
                            }
                          }}
                          onDragOver={(e) => {
                            e.preventDefault();
                            if (taskStockDragFromIndexRef.current != null) setTaskStockDragOverIndex(idx);
                            try {
                              e.dataTransfer.dropEffect = 'move';
                            } catch {
                              // ignore
                            }
                          }}
                          onDrop={(e) => {
                            e.preventDefault();
                            taskStockLastDragAtRef.current = Date.now();
                            const from = taskStockDragFromIndexRef.current;
                            if (from == null) return;
                            if (from === idx) return;
                            setTempTaskStock((p) => arrayMove(p, from, idx));
                            setTaskStockDirty(true);
                            taskStockDragFromIndexRef.current = idx;
                            setTaskStockDraggingIndex(idx);
                            setTaskStockDragOverIndex(null);
                          }}
                          onDragEnd={() => {
                            taskStockLastDragAtRef.current = Date.now();
                            taskStockDragFromIndexRef.current = null;
                            setTaskStockDraggingIndex(null);
                            setTaskStockDragOverIndex(null);
                          }}
                          onClick={() => {
                            if (Date.now() - taskStockLastDragAtRef.current < 250) return;
                            setNewTaskNamePlain(t);
                            setTaskStockOpen(false);
                          }}
                          style={{ cursor: 'grab' }}
                        >
                          <span className="material-icons" style={{ fontSize: 14, marginRight: 6, opacity: 0.6, color: 'var(--accent)' }}>
                            add_circle_outline
                          </span>
                          {t}
                        </div>
                        <button
                          type="button"
                          title="削除"
                          onClick={() => {
                            setTempTaskStock((p) => p.filter((_, i) => i !== idx));
                            setTaskStockDirty(true);
                          }}
                        >
                          <span className="material-icons">delete</span>
                        </button>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>
            <div className="task-stock-section">
              <h4>➕ 新しいタスクを追加</h4>
              <div className="task-stock-input">
                <input
                  type="text"
                  id="task-stock-input"
                  className="edit-input"
                  placeholder="タスク名を入力してください"
                  value={taskStockInput}
                  onChange={(e) => setTaskStockInput(e.target.value)}
                />
                <button
                  id="add-task-stock-btn"
                  className="btn-primary"
                  title="追加"
                  aria-label="追加"
                  type="button"
                  onClick={() => {
                    const name = taskStockInput.trim();
                    if (!name) return;
                    // newest-first
                    setTempTaskStock((p) => normalizeTaskNameList([name, ...p]));
                    setTaskStockInput('');
                    setTaskStockDirty(true);
                  }}
                  disabled={!accessToken || busy}
                >
                  <span className="material-icons">add</span>
                </button>
              </div>
            </div>
          </div>
          <div className="task-stock-footer">
            <div className="task-stock-footer-buttons">
              <button className="btn-cancel" id="task-stock-cancel" title="戻る" aria-label="戻る" type="button" onClick={() => setTaskStockOpen(false)}>
                <span className="material-icons">arrow_back</span>
              </button>
              <button
                className="btn-primary"
                id="save-task-stock-btn"
                type="button"
                onClick={saveTaskStockChanges}
                disabled={!accessToken || busy || !taskStockDirty}
              >
                <span className="material-icons">save</span>
              </button>
            </div>
          </div>
        </div>
      </div>

      <div className={`task-stock-dialog ${tagStockOpen ? 'show' : ''}`} id="tag-stock-dialog" aria-hidden={!tagStockOpen}>
        <div className="task-stock-content">
          <div className="task-stock-body">
            <div className="task-stock-section">
              <h4>🏷️ 保存済みタグ</h4>
              <p className="task-stock-help-text">タグはドラッグで並び替えできます</p>
              <div className="task-stock-list" id="tag-stock-list">
                {tempTagStock.length === 0 ? (
                  <div className="task-stock-empty">
                    <span className="material-icons">inventory_2</span>
                    <p>タグは空です</p>
                  </div>
                ) : (
                  tempTagStock.map((tag, idx) => (
                    <div
                      key={`${tag.id ?? ''}:${tag.name}:${idx}`}
                      className={`stock-item tag-stock-item${tagStockDragOverIndex === idx ? ' drag-over' : ''}${tagStockDraggingIndex === idx ? ' dragging' : ''}`}
                    >
                      <div className="stock-item-content">
                        <div
                          className="tag-stock-item-name"
                          title="タグ名"
                          draggable
                          onDragStart={(e) => {
                            tagStockDragFromIndexRef.current = idx;
                            tagStockLastDragAtRef.current = Date.now();
                            setTagStockDraggingIndex(idx);
                            setTagStockDragOverIndex(idx);
                            try {
                              e.dataTransfer.effectAllowed = 'move';
                              e.dataTransfer.setData('text/plain', tag.name);
                            } catch {
                              // ignore
                            }
                          }}
                          onDragOver={(e) => {
                            e.preventDefault();
                            if (tagStockDragFromIndexRef.current != null) setTagStockDragOverIndex(idx);
                            try {
                              e.dataTransfer.dropEffect = 'move';
                            } catch {
                              // ignore
                            }
                          }}
                          onDrop={(e) => {
                            e.preventDefault();
                            tagStockLastDragAtRef.current = Date.now();
                            const from = tagStockDragFromIndexRef.current;
                            if (from == null) return;
                            if (from === idx) return;
                            setTempTagStock((p) => arrayMove(p, from, idx));
                            setTagDirty(true);
                            tagStockDragFromIndexRef.current = idx;
                            setTagStockDraggingIndex(idx);
                            setTagStockDragOverIndex(null);
                          }}
                          onDragEnd={() => {
                            tagStockLastDragAtRef.current = Date.now();
                            tagStockDragFromIndexRef.current = null;
                            setTagStockDraggingIndex(null);
                            setTagStockDragOverIndex(null);
                          }}
                          style={{ cursor: 'grab' }}
                        >
                          {tag.name}
                        </div>
                        <button
                          className="stock-item-remove"
                          type="button"
                          title="削除"
                          onClick={() => {
                            setTempTagStock((p) => p.filter((_, i) => i !== idx));
                            setTagDirty(true);
                            if (selectedTag === tag.name) setSelectedTag('');
                          }}
                        >
                          <span className="material-icons">delete</span>
                        </button>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>
            <div className="task-stock-section">
              <h4>➕ 新しいタグを追加</h4>
              <div className="task-stock-input">
                <input
                  type="text"
                  id="tag-stock-input"
                  className="edit-input"
                  placeholder="タグ名を入力してください"
                  value={tagInput}
                  onChange={(e) => setTagInput(e.target.value)}
                />
                <button
                  id="add-tag-stock-btn"
                  className="btn-primary"
                  title="追加"
                  aria-label="追加"
                  type="button"
                  onClick={() => {
                    const name = tagInput.trim();
                    if (!name) return;
                    const dup = tempTagStock.some((t) => t.name === name);
                    if (dup) return;
                    setTempTagStock((p) => [...p, { id: `tag-${Date.now()}-${Math.random().toString(36).slice(2)}`, name }]);
                    setTagInput('');
                    setTagDirty(true);
                  }}
                  disabled={!accessToken || busy}
                >
                  <span className="material-icons">add</span>
                </button>
              </div>
            </div>
          </div>
          <div className="task-stock-footer">
            <div className="task-stock-footer-buttons">
              <button className="btn-cancel" id="tag-stock-cancel" title="戻る" aria-label="戻る" type="button" onClick={() => setTagStockOpen(false)}>
                <span className="material-icons">arrow_back</span>
              </button>
              <button
                className="btn-primary"
                id="save-tag-stock-btn"
                type="button"
                onClick={saveTagStockChanges}
                disabled={!accessToken || busy || !tagDirty}
              >
                <span className="material-icons">save</span>
              </button>
            </div>
          </div>
        </div>
      </div>

      <div
        className={`task-stock-dialog ${holidayCalendarOpen ? 'show' : ''}`}
        id="holiday-calendar-dialog"
        aria-hidden={!holidayCalendarOpen}
      >
        <div className="task-stock-content holiday-cal-content">
          <div className="task-stock-body">
            <div className="holiday-cal-header">
              <button
                type="button"
                className="holiday-cal-nav btn-secondary"
                aria-label="前の月"
                title="前の月"
                onClick={() => setHolidayCalendarMonth((p) => new Date(p.getFullYear(), p.getMonth() - 1, 1))}
                disabled={holidayCalendarExporting || holidayCalendarSyncing}
              >
                ◀
              </button>
              <div className="holiday-cal-month" aria-live="polite">
                {holidayCalendarMonth.getFullYear()}年 {holidayCalendarMonth.getMonth() + 1}月
              </div>
              <button
                type="button"
                className="holiday-cal-nav btn-secondary"
                aria-label="次の月"
                title="次の月"
                onClick={() => setHolidayCalendarMonth((p) => new Date(p.getFullYear(), p.getMonth() + 1, 1))}
                disabled={holidayCalendarExporting || holidayCalendarSyncing}
              >
                ▶
              </button>
            </div>

            <div className="holiday-cal-controls">
              <button
                type="button"
                className="btn-primary holiday-cal-save"
                onClick={async () => {
                  if (!accessToken) {
                    await exportHolidayCalendar();
                    return;
                  }
                  if (!holidayCalendarHasSaved || holidayCalendarDirty) return;
                  await saveHolidayCalendarToServer();
                  await exportHolidayCalendar();
                }}
                disabled={holidayCalendarExporting || holidayCalendarSyncing || (accessToken ? !holidayCalendarHasSaved || holidayCalendarDirty : false)}
              >
                <span className="material-icons">content_copy</span>
                {holidayCalendarCopiedToast ? 'コピー完了' : holidayCalendarExporting ? 'コピー中...' : '画像をコピー'}
              </button>
              <button
                type="button"
                className="btn-secondary holiday-cal-reset"
                onClick={clearHolidayCalendar}
                disabled={holidayCalendarExporting || holidayCalendarSyncing}
              >
                <span className="material-icons">restart_alt</span>
                リセット
              </button>
            </div>

            {(() => {
              const counts = getHolidayCalendarCounts(holidayCalendarMonth, holidayCalendarHolidays, activeTimeZone);
              return (
                <div className="holiday-cal-counters" aria-label="集計">
                  <div className="holiday-cal-counter">
                    <div className="holiday-cal-counter-label">お休み</div>
                    <div className="holiday-cal-counter-value">{counts.holidayCount}</div>
                  </div>
                  <div className="holiday-cal-counter">
                    <div className="holiday-cal-counter-label">お仕事</div>
                    <div className="holiday-cal-counter-value">{counts.jobdayCount}</div>
                  </div>
                </div>
              );
            })()}

            <div className="holiday-cal-calendar" aria-label="カレンダー">
              <div className="holiday-cal-weekdays">
                {['月', '火', '水', '木', '金', '土', '日'].map((d) => (
                  <div key={d} className="holiday-cal-weekday">
                    {d}
                  </div>
                ))}
              </div>
              <div className="holiday-cal-grid" role="grid" aria-label="日付">
                {getHolidayCalendarCells(holidayCalendarMonth, activeTimeZone).map((c, idx) => {
                  const isToday = c.inMonth && c.ymd === todayYmd;
                  const isHoliday = c.inMonth && holidayCalendarHolidays.has(c.ymd);
                  const isJpHoliday = c.inMonth && isJpPublicHolidayYmd(c.ymd);
                  const isSat = c.weekday0 === 6;
                  const isSun = c.weekday0 === 0;

                  const cls = [
                    'holiday-cal-day',
                    c.inMonth ? '' : 'inactive',
                    isToday ? 'today' : '',
                    isSat ? 'saturday' : '',
                    isSun ? 'sunday' : '',
                    isJpHoliday ? 'jp-holiday' : '',
                    isHoliday ? 'holiday' : '',
                  ]
                    .filter(Boolean)
                    .join(' ');

                  return (
                    <button
                      key={`${c.ymd}:${idx}`}
                      type="button"
                      className={cls}
                      onClick={() => {
                        if (!c.inMonth) return;
                        toggleHolidayCalendarDay(c.ymd);
                      }}
                      disabled={!c.inMonth || holidayCalendarExporting || holidayCalendarSyncing}
                      aria-label={`${c.year}年${c.month0 + 1}月${c.day}日`}
                    >
                      {c.day}
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="holiday-cal-hint">日付をクリックして「お休み」を切り替えできます</div>
            {holidayCalendarCopyError ? (
              <div className="holiday-cal-hint" style={{ color: 'var(--text-muted)' }}>
                {holidayCalendarCopyError}
              </div>
            ) : null}
          </div>

          <div className="task-stock-footer">
            <div className="task-stock-footer-buttons">
              <button
                className="btn-cancel"
                id="holiday-calendar-cancel"
                title="戻る"
                aria-label="戻る"
                type="button"
                onClick={() => void requestCloseHolidayCalendar()}
              >
                <span className="material-icons">arrow_back</span>
              </button>
              <button
                className="btn-primary"
                id="holiday-calendar-save"
                title="保存"
                aria-label="保存"
                type="button"
                onClick={() => void saveHolidayCalendarToServer()}
                disabled={!accessToken || holidayCalendarSyncing || holidayCalendarExporting || (!holidayCalendarDirty && holidayCalendarHasSaved)}
              >
                <span className="material-icons">save</span>
              </button>
            </div>
          </div>
        </div>
      </div>

      <div className={`task-stock-dialog ${billingOpen ? 'show' : ''}`} id="billing-dialog" aria-hidden={!billingOpen}>
        <div className="task-stock-content billing-content">
          <div className="task-stock-body">
            {billingRemoteUpdatePending ? (
              <div className="task-stock-section">
                <p className="settings-hint">他端末で請求設定が更新されました。保存すると上書きされるため、必要なら閉じてから開き直してください。</p>
              </div>
            ) : null}

            <div className="task-stock-section">
              <h4>⚙️ 請求設定</h4>
              <div className="settings-grid-2col">
                <div className="settings-field">
                  <label className="settings-label" htmlFor="billing-mode">
                    モード
                  </label>
                  <select
                    id="billing-mode"
                    className="edit-input"
                    value={billingMode}
                    onChange={(e) => {
                      setBillingMode((e.target.value as any) || 'hourly');
                      setBillingDirty(true);
                    }}
                    disabled={!accessToken || busy}
                  >
                    <option value="hourly">時給</option>
                    <option value="daily">日給</option>
                  </select>
                </div>
                <div className="settings-field">
                  <label className="settings-label" htmlFor="billing-closing-day">
                    締め日（1〜31）
                  </label>
                  <input
                    id="billing-closing-day"
                    className="edit-input"
                    type="number"
                    min={1}
                    max={31}
                    value={billingClosingDay}
                    onChange={(e) => {
                      setBillingClosingDay(e.target.value);
                      setBillingDirty(true);
                    }}
                    disabled={!accessToken || busy}
                  />
                </div>
                <div className="settings-field">
                  <label className="settings-label" htmlFor="billing-hourly-rate">
                    時給（円）
                  </label>
                  <input
                    id="billing-hourly-rate"
                    className="edit-input"
                    type="number"
                    min={0}
                    value={billingHourlyRate}
                    onChange={(e) => {
                      setBillingHourlyRate(e.target.value);
                      setBillingDirty(true);
                    }}
                    disabled={!accessToken || busy}
                  />
                </div>
                <div className="settings-field">
                  <label className="settings-label" htmlFor="billing-daily-rate">
                    日給（円）
                  </label>
                  <input
                    id="billing-daily-rate"
                    className="edit-input"
                    type="number"
                    min={0}
                    value={billingDailyRate}
                    onChange={(e) => {
                      setBillingDailyRate(e.target.value);
                      setBillingDirty(true);
                    }}
                    disabled={!accessToken || busy}
                  />
                </div>
                <div className="settings-field" style={{ gridColumn: '1 / -1' }}>
                  <label className="settings-label" htmlFor="billing-hourly-cap">
                    一日の労働時間上限（時間/日、未設定=上限なし）
                  </label>
                  <input
                    id="billing-hourly-cap"
                    className="edit-input"
                    type="number"
                    min={0}
                    step={0.25}
                    value={billingHourlyCapHours}
                    onChange={(e) => {
                      setBillingHourlyCapHours(e.target.value);
                      setBillingDirty(true);
                    }}
                    disabled={!accessToken || busy}
                  />
                </div>
              </div>
            </div>

            <div className="task-stock-section">
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, marginBottom: 12 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, minWidth: 0 }}>
                  <span className="material-icons" aria-hidden="true" style={{ fontSize: 18, lineHeight: 1 }}>
                    calculate
                  </span>
                  <h4 style={{ margin: 0 }}>集計</h4>
                </div>
                <div style={{ display: 'flex', gap: 8 }}>
                  <button
                    type="button"
                    className="icon-btn"
                    title="前の期間"
                    aria-label="前の期間"
                    onClick={() => {
                      const o = billingPeriodOffset - 1;
                      setBillingPeriodOffset(o);
                      void fetchBillingSummary(o);
                    }}
                    disabled={!accessToken || busy || billingLoading}
                  >
                    <span className="material-icons">chevron_left</span>
                  </button>
                  <button
                    type="button"
                    className="icon-btn"
                    title="現在の期間"
                    aria-label="現在の期間"
                    onClick={() => {
                      setBillingPeriodOffset(0);
                      void fetchBillingSummary(0);
                    }}
                    disabled={!accessToken || busy || billingLoading || billingPeriodOffset === 0}
                  >
                    <span className="material-icons">today</span>
                  </button>
                  <button
                    type="button"
                    className="icon-btn"
                    title="次の期間"
                    aria-label="次の期間"
                    onClick={() => {
                      const o = billingPeriodOffset + 1;
                      setBillingPeriodOffset(o);
                      void fetchBillingSummary(o);
                    }}
                    disabled={!accessToken || busy || billingLoading}
                  >
                    <span className="material-icons">chevron_right</span>
                  </button>
                </div>
              </div>
              {billingLoading ? <div className="sub-text">読み込み中...</div> : null}
              {billingError ? <div style={{ color: 'var(--error)', fontSize: 12 }}>{billingError}</div> : null}
              {billingSummary ? (
                <div className="holiday-cal-counters" aria-label="請求集計">
                  <div className="holiday-cal-counter">
                    <div className="holiday-cal-counter-label">期間</div>
                    <div className="holiday-cal-counter-value" style={{ fontSize: 14, fontWeight: 800 }}>
                      <button
                        type="button"
                        className="billing-copy-number"
                        title="開始日（yyyy-mm-dd）をコピー"
                        aria-label="開始日（yyyy-mm-dd）をコピー"
                        onClick={async () => {
                          try {
                            await navigator.clipboard.writeText(normalizeYmd(billingSummary.periodStart));
                          } catch {
                            // ignore
                          }
                        }}
                      >
                        {normalizeYmd(billingSummary.periodStart)}
                      </button>
                      <span className="billing-copy-sep"> / </span>
                      <button
                        type="button"
                        className="billing-copy-number"
                        title="終了日（yyyy-mm-dd）をコピー"
                        aria-label="終了日（yyyy-mm-dd）をコピー"
                        onClick={async () => {
                          try {
                            await navigator.clipboard.writeText(normalizeYmd(billingSummary.periodEnd));
                          } catch {
                            // ignore
                          }
                        }}
                      >
                        {normalizeYmd(billingSummary.periodEnd)}
                      </button>
                    </div>
                  </div>
                  <div className="holiday-cal-counter">
                    <div className="holiday-cal-counter-label">請求額</div>
                    <div className="holiday-cal-counter-value">
                      <button
                        type="button"
                        className="billing-copy-number"
                        title="請求額（数値）をコピー"
                        aria-label="請求額（数値）をコピー"
                        onClick={async () => {
                          try {
                            const v = Number(billingSummary.amount || 0);
                            await navigator.clipboard.writeText(String(Number.isFinite(v) ? v : 0));
                          } catch {
                            // ignore
                          }
                        }}
                      >
                        {Number(billingSummary.amount || 0).toLocaleString('ja-JP')}円
                      </button>
                    </div>
                  </div>
                  {billingSummary.mode === 'daily' ? (
                    <div className="holiday-cal-counter" style={{ gridColumn: '1 / -1' }}>
                      <div className="holiday-cal-counter-label">稼働日数</div>
                      <div className="holiday-cal-counter-value">
                        <button
                          type="button"
                          className="billing-copy-number"
                          title="稼働日数（数値）をコピー"
                          aria-label="稼働日数（数値）をコピー"
                          onClick={async () => {
                            try {
                              const v = Number(billingSummary.workedDays ?? billingSummary.workDays ?? 0);
                              await navigator.clipboard.writeText(String(Number.isFinite(v) ? v : 0));
                            } catch {
                              // ignore
                            }
                          }}
                        >
                          {Number(billingSummary.workedDays ?? billingSummary.workDays ?? 0)}日
                        </button>
                      </div>
                    </div>
                  ) : (
                    <>
                      <div className="holiday-cal-counter">
                        <div className="holiday-cal-counter-label">時間（合計 / 上限反映後）</div>
                        <div className="holiday-cal-counter-value" style={{ fontSize: 16 }}>
                          <button
                            type="button"
                            className="billing-copy-number"
                            title="合計時間（数値）をコピー"
                            aria-label="合計時間（数値）をコピー"
                            onClick={async () => {
                              try {
                                const m = Number(billingSummary.totalMinutes || 0);
                                await navigator.clipboard.writeText(formatHoursNumber(m));
                              } catch {
                                // ignore
                              }
                            }}
                          >
                            {formatDurationJa(Number(billingSummary.totalMinutes || 0))}
                          </button>
                          <span className="billing-copy-sep"> / </span>
                          <button
                            type="button"
                            className="billing-copy-number"
                            title="上限反映後時間（数値）をコピー"
                            aria-label="上限反映後時間（数値）をコピー"
                            onClick={async () => {
                              try {
                                const m = Number(billingSummary.billedMinutes || 0);
                                await navigator.clipboard.writeText(formatHoursNumber(m));
                              } catch {
                                // ignore
                              }
                            }}
                          >
                            {formatDurationJa(Number(billingSummary.billedMinutes || 0))}
                          </button>
                        </div>
                      </div>
                      <div className="holiday-cal-counter">
                        <div className="holiday-cal-counter-label">稼働日数</div>
                        <div className="holiday-cal-counter-value">
                          <button
                            type="button"
                            className="billing-copy-number"
                            title="稼働日数（数値）をコピー"
                            aria-label="稼働日数（数値）をコピー"
                            onClick={async () => {
                              try {
                                const v = Number(billingSummary.workedDays ?? 0);
                                await navigator.clipboard.writeText(String(Number.isFinite(v) ? v : 0));
                              } catch {
                                // ignore
                              }
                            }}
                          >
                            {Number(billingSummary.workedDays ?? 0)}日
                          </button>
                        </div>
                      </div>
                    </>
                  )}
                </div>
              ) : null}
            </div>
          </div>

          <div className="task-stock-footer">
            <div className="task-stock-footer-buttons">
              <button className="btn-cancel" id="billing-cancel" title="戻る" aria-label="戻る" type="button" onClick={() => setBillingOpen(false)}>
                <span className="material-icons">arrow_back</span>
              </button>
              <button
                className="btn-secondary"
                id="billing-reload"
                title="再読み込み"
                aria-label="再読み込み"
                type="button"
                onClick={() => void fetchBillingSummary()}
                disabled={!accessToken || busy || billingLoading}
              >
                <span className="material-icons">refresh</span>
              </button>
              <button
                className="btn-primary"
                id="billing-save"
                type="button"
                onClick={saveBillingSettings}
                disabled={!accessToken || busy || !billingDirty}
              >
                <span className="material-icons">save</span>
              </button>
            </div>
          </div>
        </div>
      </div>

      <FloatingNotices items={floatingNotices} />
    </div>
  );
}

function TaskEditDialog(props: {
  open: boolean;
  busy: boolean;
  accessToken: string | null;
  initial: { name: string; tag: string; startTime: string; endTime: string; memo: string; url: string; trackedOverride: boolean | null };
  taskStock: string[];
  tagStock: Array<{ id?: string | null; name: string }>;
  getDefaultIsTracked: (name: string) => boolean;
  onClose: () => void;
  onToggleTaskStock: (name: string) => void;
  onSave: (draft: { name: string; tag: string; startTime: string; endTime: string; memo: string; url: string; isTracked: boolean | null }) => void;
  onDelete: () => void;
}) {
  function hhmmNow() {
    const d = new Date();
    const hh = String(d.getHours()).padStart(2, '0');
    const mm = String(d.getMinutes()).padStart(2, '0');
    return `${hh}:${mm}`;
  }

  const [name, setName] = useState(props.initial.name);
  const [tag, setTag] = useState(props.initial.tag);
  const [startTime, setStartTime] = useState(props.initial.startTime);
  const [endTime, setEndTime] = useState(props.initial.endTime);
  const [memo, setMemo] = useState(props.initial.memo);
  const [url, setUrl] = useState(props.initial.url);
  const [trackedOverride, setTrackedOverride] = useState<boolean | null>(props.initial.trackedOverride);

  useEffect(() => {
    if (!props.open) return;
    setName(props.initial.name);
    setTag(props.initial.tag);
    setStartTime(props.initial.startTime);
    setEndTime(props.initial.endTime);
    setMemo(props.initial.memo);
    setUrl(props.initial.url);
    setTrackedOverride(props.initial.trackedOverride);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.open, props.initial.name, props.initial.tag, props.initial.startTime, props.initial.endTime, props.initial.memo, props.initial.url, props.initial.trackedOverride]);

  if (!props.open) {
    return <div className={`edit-dialog ${props.open ? 'show' : ''}`} id="edit-dialog" aria-hidden={!props.open} />;
  }

  const trimmedName = String(name || '').trim();
  const trimmedTag = String(tag || '').trim();
  const inStock = !!trimmedName && (Array.isArray(props.taskStock) ? props.taskStock : []).includes(trimmedName);
  const effectiveTagStock = Array.isArray(props.tagStock) ? props.tagStock : [];
  const defaultIsTracked = props.getDefaultIsTracked(trimmedName);
  const effectiveIsTracked = typeof trackedOverride === 'boolean' ? trackedOverride : defaultIsTracked;

  return (
    <div className={`edit-dialog ${props.open ? 'show' : ''}`} id="edit-dialog" aria-hidden={!props.open}>
      <div className="edit-content">
        <div className="edit-header">
          <h3>✏️ タスク編集</h3>
          <button className="edit-close" id="edit-close" title="閉じる" aria-label="閉じる" type="button" onClick={props.onClose}>
            <span className="material-icons">close</span>
          </button>
        </div>

        <div className="edit-body">
          <div className="edit-field">
            <label htmlFor="edit-task-name">作業内容</label>
            <div className="input-with-button">
              <input
                id="edit-task-name"
                className="edit-input"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="タスク名"
                disabled={props.busy}
              />
              <button
                id="edit-add-to-task-stock-btn"
                className="icon-btn"
                title={inStock ? 'タスクストックから解除' : 'タスクストックに追加'}
                aria-label={inStock ? 'タスクストックから解除' : 'タスクストックに追加'}
                type="button"
                onClick={() => props.onToggleTaskStock(trimmedName)}
                disabled={!props.accessToken || props.busy || !trimmedName}
              >
                <span className="material-icons">{inStock ? 'bookmark_remove' : 'bookmark_add'}</span>
              </button>
              <button
                id="edit-toggle-track-btn"
                className="icon-btn"
                title={effectiveIsTracked ? '就労時間集計に含める（クリックで除外）' : '就労時間集計から除外（クリックで含める）'}
                aria-label={effectiveIsTracked ? '就労時間集計に含める（クリックで除外）' : '就労時間集計から除外（クリックで含める）'}
                type="button"
                onClick={() => {
                  if (props.busy) return;
                  setTrackedOverride(!effectiveIsTracked);
                }}
                disabled={!props.accessToken || props.busy}
              >
                <span className="material-icons">{effectiveIsTracked ? 'timer' : 'timer_off'}</span>
              </button>
            </div>
          </div>

          <div className="edit-field">
            <label htmlFor="edit-task-tag">タグ（任意）</label>
            <select
              id="edit-task-tag"
              className="edit-input"
              aria-label="タグを選択"
              value={trimmedTag}
              onChange={(e) => setTag(e.target.value)}
              disabled={props.busy}
            >
              <option value="">タグを選択</option>
              {trimmedTag && !effectiveTagStock.some((t) => String(t?.name || '').trim() === trimmedTag) ? (
                <option value={trimmedTag}>{trimmedTag}</option>
              ) : null}
              {effectiveTagStock.map((t) => (
                <option key={`${t.id ?? ''}:${t.name}`} value={t.name}>
                  {t.name}
                </option>
              ))}
            </select>
          </div>

          <div className="edit-field">
            <label htmlFor="edit-task-start">作業開始時刻</label>
            <input
              id="edit-task-start"
              className="edit-input"
              value={startTime}
              onChange={(e) => setStartTime(e.target.value)}
              type="time"
              onClick={() => {
                if (props.busy) return;
                if (!startTime) setStartTime(hhmmNow());
              }}
              onDoubleClick={() => {
                if (props.busy) return;
                setStartTime('');
              }}
              disabled={props.busy}
            />
          </div>

          <div className="edit-field">
            <label htmlFor="edit-task-end">作業終了時刻</label>
            <input
              id="edit-task-end"
              className="edit-input"
              value={endTime}
              onChange={(e) => setEndTime(e.target.value)}
              type="time"
              onClick={() => {
                if (props.busy) return;
                if (!endTime) setEndTime(hhmmNow());
              }}
              onDoubleClick={() => {
                if (props.busy) return;
                setEndTime('');
              }}
              disabled={props.busy}
            />
          </div>

          <div className="edit-field">
            <label htmlFor="edit-task-memo">メモ（任意）</label>
            <textarea
              id="edit-task-memo"
              className="edit-input"
              value={memo}
              onChange={(e) => setMemo(e.target.value)}
              placeholder="メモ"
              rows={3}
              disabled={props.busy}
            />
          </div>

          <div className="edit-field">
            <label htmlFor="edit-task-url">URL（任意）</label>
            <input
              id="edit-task-url"
              className="edit-input"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="https://..."
              inputMode="url"
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
              disabled={props.busy}
            />
          </div>
        </div>

        <div className="edit-footer">
          <button className="btn-cancel" id="edit-cancel" title="キャンセル" aria-label="キャンセル" type="button" onClick={props.onClose} disabled={props.busy}>
            <span className="material-icons">arrow_back</span>
          </button>
          <button
            className="btn-primary"
            id="edit-save"
            title="保存"
            aria-label="保存"
            type="button"
            onClick={() => props.onSave({ name, tag: trimmedTag, startTime, endTime, memo, url, isTracked: trackedOverride })}
            disabled={!props.accessToken || props.busy}
          >
            <span className="material-icons">save</span>
          </button>
          <button
            className="btn-danger"
            id="edit-delete"
            title="削除"
            aria-label="削除"
            type="button"
            onClick={props.onDelete}
            disabled={!props.accessToken || props.busy}
          >
            <span className="material-icons">delete</span>
          </button>
        </div>
      </div>
    </div>
  );
}

function TaskLineEditDialog(props: {
  open: boolean;
  busy: boolean;
  cardId: string | null;
  initial: { text: string; weekday: TaskLineWeekday | '' };
  onClose: () => void;
  onSave: (draft: { text: string; weekday: TaskLineWeekday | '' }) => void;
  onDelete: () => void;
}) {
  const [text, setText] = useState(String(props.initial.text || ''));
  const [weekday, setWeekday] = useState<TaskLineWeekday | ''>(props.initial.weekday);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);

  useEffect(() => {
    if (!props.open) return;
    setText(String(props.initial.text || ''));
    setWeekday(props.initial.weekday);
    const t = window.setTimeout(() => {
      try {
        textareaRef.current?.focus();
        textareaRef.current?.select();
      } catch {
        // ignore
      }
    }, 0);
    return () => window.clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.open, props.cardId, props.initial.text, props.initial.weekday]);

  const trimmed = String(text || '').trim();
  const canSave = !!trimmed;

  return (
    <div
      className={`edit-dialog ${props.open ? 'show' : ''}`}
      id="taskline-edit-dialog"
      aria-hidden={!props.open}
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) props.onClose();
      }}
    >
      <div className="edit-content" role="dialog" aria-modal="true" aria-label="付箋の編集" onMouseDown={(e) => e.stopPropagation()}>
        <div className="edit-body">
          <div className="edit-field">
            <label>テキスト</label>
            <textarea
              ref={textareaRef}
              className="edit-input"
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder="タスク内容"
              rows={6}
              style={{ resize: 'vertical', minHeight: 140, lineHeight: 1.5 }}
              onKeyDown={(ev) => {
                if (ev.key === 'Escape') {
                  ev.preventDefault();
                  props.onClose();
                  return;
                }
                if (ev.key === 'Enter' && (ev.ctrlKey || ev.metaKey)) {
                  ev.preventDefault();
                  if (!canSave) return;
                  props.onSave({ text, weekday });
                }
              }}
              disabled={props.busy}
            />
          </div>

          <div className="edit-field">
            <label>曜日</label>
            <select
              className="edit-input"
              value={weekday}
              onChange={(e) => setWeekday((e.target.value || '') as TaskLineWeekday | '')}
              disabled={props.busy}
            >
              <option value="">ストック</option>
              <option value="mon">月</option>
              <option value="tue">火</option>
              <option value="wed">水</option>
              <option value="thu">木</option>
              <option value="fri">金</option>
              <option value="sat">土</option>
              <option value="sun">日</option>
            </select>
          </div>
        </div>

        <div className="edit-footer">
          <button className="btn-cancel" type="button" title="キャンセル" aria-label="キャンセル" onClick={props.onClose} disabled={props.busy}>
            <span className="material-icons">close</span>
          </button>
          <button
            className="btn-primary"
            type="button"
            title="保存"
            aria-label="保存"
            onClick={() => {
              if (!canSave) return;
              props.onSave({ text, weekday });
            }}
            disabled={props.busy || !canSave}
          >
            <span className="material-icons">done</span>
          </button>
          <button
            className="btn-danger"
            type="button"
            title="削除"
            aria-label="削除"
            onClick={props.onDelete}
            disabled={props.busy || !props.cardId}
          >
            <span className="material-icons">delete</span>
          </button>
        </div>
      </div>
    </div>
  );
}

function NotesEditDialog(props: {
  open: boolean;
  noteId: string | null;
  initialBody: string;
  busy: boolean;
  onClose: () => void;
  onSave: (body: string) => void;
  onCopyLink: (noteId: string) => Promise<boolean>;
}) {
  const [body, setBody] = useState(props.initialBody);
  const [linkCopied, setLinkCopied] = useState(false);
  const copiedTimerRef = useRef<number | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);

  useEffect(() => {
    if (!props.open) return;
    setBody(props.initialBody);
    setLinkCopied(false);
    if (copiedTimerRef.current != null) {
      try {
        window.clearTimeout(copiedTimerRef.current);
      } catch {
        // ignore
      }
      copiedTimerRef.current = null;
    }
    window.setTimeout(() => {
      try {
        textareaRef.current?.focus();
      } catch {
        // ignore
      }
    }, 0);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.open, props.noteId, props.initialBody]);

  useEffect(() => {
    return () => {
      if (copiedTimerRef.current != null) {
        try {
          window.clearTimeout(copiedTimerRef.current);
        } catch {
          // ignore
        }
        copiedTimerRef.current = null;
      }
    };
  }, []);

  const trimmed = String(body || '').trim();
  const willDelete = !!props.noteId && !trimmed;

  return (
    <div
      className={`edit-dialog ${props.open ? 'show' : ''}`}
      id="notes-edit-dialog"
      aria-hidden={!props.open}
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) props.onClose();
      }}
    >
      <div className="edit-content notes-edit-content" onMouseDown={(e) => e.stopPropagation()}>
        <div className="edit-body">
          <textarea
            ref={textareaRef}
            className="notes-modal-textarea"
            placeholder="本文（タイトル不要）"
            value={body}
            onChange={(e) => setBody(e.target.value)}
            onKeyDown={(ev) => {
              if (ev.key === 'Escape') {
                ev.preventDefault();
                props.onClose();
                return;
              }
              if (ev.key === 'Enter' && (ev.ctrlKey || ev.metaKey)) {
                ev.preventDefault();
                props.onSave(body);
              }
            }}
            disabled={props.busy}
          />
        </div>

        <div className="edit-footer">
          <button className="btn-cancel" type="button" title="キャンセル" aria-label="キャンセル" onClick={props.onClose} disabled={props.busy}>
            <span className="material-icons">close</span>
          </button>
          <button
            className="btn-cancel"
            type="button"
            title={linkCopied ? 'コピー完了' : 'リンクをコピー'}
            aria-label={linkCopied ? 'コピー完了' : 'リンクをコピー'}
            onClick={async () => {
              if (!props.noteId) return;
              const ok = await props.onCopyLink(props.noteId);
              if (!ok) return;

              setLinkCopied(true);
              if (copiedTimerRef.current != null) {
                try {
                  window.clearTimeout(copiedTimerRef.current);
                } catch {
                  // ignore
                }
                copiedTimerRef.current = null;
              }
              copiedTimerRef.current = window.setTimeout(() => {
                setLinkCopied(false);
                copiedTimerRef.current = null;
              }, 1200);
            }}
            disabled={!props.noteId || props.busy}
          >
            <span className="material-icons">{linkCopied ? 'done' : 'content_copy'}</span>
          </button>
          <button
            className={willDelete ? 'btn-danger' : 'btn-primary'}
            type="button"
            title={willDelete ? '削除' : '保存'}
            aria-label={willDelete ? '削除' : '保存'}
            onClick={() => props.onSave(body)}
            disabled={props.busy}
          >
            <span className="material-icons">{willDelete ? 'close' : 'done'}</span>
          </button>
        </div>
      </div>
    </div>
  );
}

function NoticeEditDialog(props: {
  open: boolean;
  busy: boolean;
  initial: { text: string; tone: any };
  onClose: () => void;
  onSave: (next: { text: string; tone: any }) => void;
}) {
  const [text, setText] = useState(String(props.initial.text || ''));
  const [tone, setTone] = useState(props.initial.tone);

  useEffect(() => {
    if (!props.open) return;
    setText(String(props.initial.text || ''));
    setTone(props.initial.tone);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.open, props.initial.text, props.initial.tone]);

  return (
    <div
      className={`edit-dialog ${props.open ? 'show' : ''}`}
      id="notice-edit-dialog"
      aria-hidden={!props.open}
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) props.onClose();
      }}
    >
      <div className="edit-content" onMouseDown={(e) => e.stopPropagation()}>
        <div className="edit-body">
          <div className="edit-field">
            <label htmlFor="notice-text">お知らせ</label>
            <textarea
              id="notice-text"
              className="edit-input"
              value={text}
              onChange={(e) => setText(e.target.value)}
              rows={5}
              placeholder="お知らせ内容（改行OK）"
              onKeyDown={(ev) => {
                if (ev.key === 'Escape') {
                  ev.preventDefault();
                  props.onClose();
                  return;
                }
                if (ev.key === 'Enter' && (ev.ctrlKey || ev.metaKey)) {
                  ev.preventDefault();
                  props.onSave({ text, tone });
                }
              }}
              disabled={props.busy}
              style={{ resize: 'vertical', minHeight: 120, lineHeight: 1.5 }}
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
                ] as Array<{ tone: any; label: string; cls: string }>
              ).map((opt) => {
                const active = tone === opt.tone;
                return (
                  <button
                    key={String(opt.tone)}
                    type="button"
                    className={`inline-flex items-center gap-2 rounded-lg border px-3 py-2 text-sm ${opt.cls} ${
                      active ? 'ring-2 ring-[rgba(137,180,250,0.25)]' : 'hover:bg-white/5'
                    }`}
                    aria-pressed={active}
                    onClick={() => setTone(opt.tone)}
                    disabled={props.busy}
                  >
                    <span className="inline-block h-2.5 w-2.5 rounded-full bg-white/70" aria-hidden="true" />
                    <span className="text-[color:var(--text-primary)]">{opt.label}</span>
                  </button>
                );
              })}
            </div>
          </div>
        </div>

        <div className="edit-footer">
          <button className="btn-cancel" type="button" title="キャンセル" aria-label="キャンセル" onClick={props.onClose} disabled={props.busy}>
            <span className="material-icons">close</span>
          </button>
          <button className="btn-primary" type="button" title="保存" aria-label="保存" onClick={() => props.onSave({ text, tone })} disabled={props.busy}>
            <span className="material-icons">done</span>
          </button>
        </div>
      </div>
    </div>
  );
}
