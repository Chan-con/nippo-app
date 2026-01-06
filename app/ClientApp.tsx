'use client';

import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { useEffect, useMemo, useRef, useState } from 'react';

type Task = {
  id: string;
  name: string;
  startTime?: string;
  endTime?: string;
  tag?: string;
  status?: string | null;
};

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

function ymdKeyFromDate(date: Date) {
  return ymdKeyFromParts(date.getFullYear(), date.getMonth(), date.getDate());
}

function nthWeekdayOfMonth(year: number, month0: number, weekday0: number, nth: number) {
  const first = new Date(year, month0, 1);
  const firstDow = first.getDay();
  const delta = (weekday0 - firstDow + 7) % 7;
  const day = 1 + delta + (nth - 1) * 7;
  return new Date(year, month0, day);
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
  const add = (date: Date) => holidays.add(ymdKeyFromDate(date));
  const addParts = (m0: number, d: number) => holidays.add(ymdKeyFromParts(year, m0, d));

  // Fixed holidays
  addParts(0, 1); // 元日
  addParts(1, 11); // 建国記念の日
  if (year >= 2020) addParts(1, 23); // 天皇誕生日 (2020-)
  if (year >= 1989 && year <= 2018) addParts(11, 23); // 天皇誕生日 (1989-2018)
  addParts(3, 29); // 昭和の日
  addParts(4, 3); // 憲法記念日
  addParts(4, 4); // みどりの日
  addParts(4, 5); // こどもの日
  if (year >= 2016) addParts(7, 11); // 山の日 (2016-)
  addParts(10, 3); // 文化の日
  addParts(10, 23); // 勤労感謝の日

  // Happy Monday system
  add(nthWeekdayOfMonth(year, 0, 1, 2)); // 成人の日: 1月第2月曜
  add(nthWeekdayOfMonth(year, 6, 1, 3)); // 海の日: 7月第3月曜
  add(nthWeekdayOfMonth(year, 8, 1, 3)); // 敬老の日: 9月第3月曜
  add(nthWeekdayOfMonth(year, 9, 1, 2)); // スポーツの日: 10月第2月曜

  // Equinoxes
  addParts(2, vernalEquinoxDay(year));
  addParts(8, autumnalEquinoxDay(year));

  // One-off adjustments (recent years)
  if (year === 2019) {
    addParts(4, 1); // 即位の日
    addParts(9, 22); // 即位礼正殿の儀
  }
  if (year === 2020) {
    // Olympics shifts
    holidays.delete(ymdKeyFromDate(nthWeekdayOfMonth(year, 6, 1, 3)));
    holidays.delete(ymdKeyFromDate(nthWeekdayOfMonth(year, 9, 1, 2)));
    if (year >= 2016) holidays.delete(ymdKeyFromParts(year, 7, 11));
    addParts(6, 23); // 海の日
    addParts(6, 24); // スポーツの日
    addParts(7, 10); // 山の日
  }
  if (year === 2021) {
    holidays.delete(ymdKeyFromDate(nthWeekdayOfMonth(year, 6, 1, 3)));
    holidays.delete(ymdKeyFromDate(nthWeekdayOfMonth(year, 9, 1, 2)));
    if (year >= 2016) holidays.delete(ymdKeyFromParts(year, 7, 11));
    addParts(6, 22); // 海の日
    addParts(6, 23); // スポーツの日
    addParts(7, 8); // 山の日
  }

  // Substitute holidays (振替休日): Sunday -> next non-holiday weekday
  for (const key of Array.from(holidays)) {
    const [yy, mm, dd] = key.split('-').map((v) => parseInt(v, 10));
    const date = new Date(yy, (mm ?? 1) - 1, dd ?? 1);
    if (date.getDay() !== 0) continue;
    const sub = new Date(date);
    do {
      sub.setDate(sub.getDate() + 1);
    } while (holidays.has(ymdKeyFromDate(sub)));
    holidays.add(ymdKeyFromDate(sub));
  }

  // Citizen's holidays (国民の休日): weekday between two holidays
  const cur = new Date(year, 0, 2);
  const end = new Date(year, 11, 30);
  while (cur <= end) {
    const key = ymdKeyFromDate(cur);
    if (!holidays.has(key) && cur.getDay() !== 0) {
      const prev = new Date(cur);
      prev.setDate(prev.getDate() - 1);
      const next = new Date(cur);
      next.setDate(next.getDate() + 1);
      if (holidays.has(ymdKeyFromDate(prev)) && holidays.has(ymdKeyFromDate(next))) {
        holidays.add(key);
      }
    }
    cur.setDate(cur.getDate() + 1);
  }

  jpPublicHolidayCache.set(year, holidays);
  return holidays;
}

function isJpPublicHoliday(date: Date) {
  const set = getJpPublicHolidayKeysForYear(date.getFullYear());
  return set.has(ymdKeyFromDate(date));
}

function parseTimeToMinutesFlexible(timeStr?: string) {
  if (!timeStr) return null;
  const raw = String(timeStr).trim();
  if (!raw.includes(':')) return null;

  // 24h HH:mm
  const hhmmMatch = raw.match(/^([01]?\d|2[0-3]):([0-5]\d)$/);
  if (hhmmMatch) {
    return parseInt(hhmmMatch[1], 10) * 60 + parseInt(hhmmMatch[2], 10);
  }

  // JP 午前/午後
  const hasAm = raw.includes('午前');
  const hasPm = raw.includes('午後');
  if (!hasAm && !hasPm) return null;

  const timeOnly = raw.replace('午前', '').replace('午後', '').trim();
  const parts = timeOnly.split(':');
  if (parts.length !== 2) return null;

  let hour = parseInt(parts[0], 10);
  const minute = parseInt(parts[1], 10);
  if (Number.isNaN(hour) || Number.isNaN(minute)) return null;

  if (hasPm && hour !== 12) hour += 12;
  if (hasAm && hour === 12) hour = 0;
  return hour * 60 + minute;
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

function arrayMove<T>(arr: T[], fromIndex: number, toIndex: number) {
  const from = Math.max(0, Math.min(arr.length - 1, fromIndex));
  const to = Math.max(0, Math.min(arr.length - 1, toIndex));
  if (from === to) return arr;
  const copy = arr.slice();
  const [item] = copy.splice(from, 1);
  copy.splice(to, 0, item as T);
  return copy;
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
  const [reportOpen, setReportOpen] = useState(false);
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

  const [tagWorkSummary, setTagWorkSummary] = useState<TagWorkSummary[]>([]);
  const [activeTag, setActiveTag] = useState<string>('');
  const [tagWorkLoading, setTagWorkLoading] = useState(false);
  const [tagWorkError, setTagWorkError] = useState<string | null>(null);

  // holiday calendar
  const [holidayCalendarOpen, setHolidayCalendarOpen] = useState(false);
  const [holidayCalendarMonth, setHolidayCalendarMonth] = useState(() => {
    const d = new Date();
    return new Date(d.getFullYear(), d.getMonth(), 1);
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

  // edit dialog (timeline)
  const [editOpen, setEditOpen] = useState(false);
  const [editingTaskId, setEditingTaskId] = useState<string>('');
  const [editingTaskDateKey, setEditingTaskDateKey] = useState<string | null>(null);
  const [editName, setEditName] = useState('');
  const [editTag, setEditTag] = useState('');
  const [editStartTime, setEditStartTime] = useState('');
  const [editEndTime, setEditEndTime] = useState('');

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
  const [now, setNow] = useState(() => new Date());

  function nowHHMM() {
    const d = new Date();
    const hh = String(d.getHours()).padStart(2, '0');
    const mm = String(d.getMinutes()).padStart(2, '0');
    return `${hh}:${mm}`;
  }

  useEffect(() => {
    // 履歴モードでは予約を扱わない（予約は「今日のみ」要件）
    if (viewMode !== 'history') return;
    setAddMode('now');
    setReserveStartTime('');
  }, [viewMode]);

  function formatDateISO(d: Date) {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
  }

  useEffect(() => {
    const t = window.setInterval(() => setNow(new Date()), 30_000);
    return () => window.clearInterval(t);
  }, []);

  useEffect(() => {
    document.body.classList.toggle('sidebar-open', sidebarOpen);
    return () => {
      document.body.classList.remove('sidebar-open');
    };
  }, [sidebarOpen]);

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
      setSettingsTimeRoundingInterval(0);
      setSettingsTimeRoundingMode('nearest');
      setSettingsExcludeTaskNames([]);
      setSettingsExcludeTaskNameInput('');
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

      const merged = normalizeTaskNameList([...(Array.isArray(current) ? current : []), name]);
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
          },
        }),
      });
      const body = await res.json();
      if (!res.ok || !body?.success) throw new Error(body?.error || '保存に失敗しました');
      setSettingsDirty(false);
      setSettingsRemoteUpdatePending(false);
      setSettingsOpen(false);
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
  }, [supabase, accessToken, userId, settingsOpen, settingsDirty, billingOpen, billingDirty, holidayCalendarOpen, holidayCalendarDirty]);

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

  useEffect(() => {
    // 予約の期限到来処理は /api/tasks(GET) のタイミングで走るため、
    // 画面を開いている間は定期的に取得してステータスを自動反映させる。
    if (!accessToken) return;
    if (viewMode === 'history') return;

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
  }, [accessToken, viewMode]);

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
        if (isWorkTimeExcludedTaskName(t.name)) return sum;
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
                {viewMode === 'today' ? '今日' : '履歴'}
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

    const navButton = (id: 'today' | 'history' | 'report', label: string) => {
      const isActive = id === 'today' ? viewMode === 'today' : id === 'history' ? viewMode === 'history' : false;
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
            } else {
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
        {navButton('report', '報告書')}

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
                    {isWorkTimeExcludedTaskName(t.name) ? (
                      <span
                        className="material-icons"
                        title="就労時間の集計から除外"
                        aria-label="就労時間の集計から除外"
                        style={{ fontSize: 16, color: 'var(--text-muted)' }}
                      >
                        local_cafe
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
                    {isWorkTimeExcludedTaskName(t.name) ? (
                      <span
                        className="material-icons"
                        title="就労時間の集計から除外"
                        aria-label="就労時間の集計から除外"
                        style={{ fontSize: 16, color: 'var(--text-muted)' }}
                      >
                        local_cafe
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
              <input
                className="w-full rounded-[var(--radius-small)] border border-[var(--border)] bg-[var(--bg-secondary)] px-3 py-2 text-sm"
                value={historyEditing.tag}
                onChange={(e) => setHistoryEditing((p) => (p ? { ...p, tag: e.target.value } : p))}
                placeholder="タグ (任意)"
                disabled={busy}
              />
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

    const isHistoryTarget = viewMode === 'history' && !!historyDate;

    setBusy(true);
    setError(null);
    try {
      if (isHistoryTarget) {
        const payload: any = { name };
        if (selectedTag) payload.tag = selectedTag;

        const res = await apiFetch(`/api/history/${historyDate}/tasks`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        });
        const body = await res.json();
        if (!res.ok || !body?.success) throw new Error(body?.message || body?.error || '追加に失敗しました');

        setNewTaskName('');
        setReserveStartTime('');
        await loadHistory(historyDate);
        await loadHistoryDates();
      } else {
        const isReserve = addMode === 'reserve';
        const url = isReserve ? '/api/tasks/reserve' : '/api/tasks';
        const payload: any = { name };
        if (selectedTag) payload.tag = selectedTag;
        if (isReserve && reserveStartTime) payload.startTime = reserveStartTime;

        const res = await apiFetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        });
        const body = await res.json();
        if (!res.ok || !body?.success) throw new Error(body?.error || '追加に失敗しました');
        setNewTaskName('');
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
    const y = d.getFullYear();
    const m = d.getMonth() + 1;
    const day = d.getDate();
    return `${y}年${m}月${day}日`;
  }

  function formatTimeHHMM(d: Date) {
    const hh = String(d.getHours()).padStart(2, '0');
    const mm = String(d.getMinutes()).padStart(2, '0');
    return `${hh}:${mm}`;
  }

  function formatNowTimeDisplay(d: Date) {
    return formatTimeHHMM(d);
  }

  const effectiveTasks = viewMode === 'today' ? tasks : historyTasks;
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
    if (isWorkTimeExcludedTaskName(t.name)) return sum;
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

  const timelineEmptyText = viewMode === 'today' ? 'まだタスクがありません' : 'この日はタスクがありません';

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

  function formatDateISOToJaShort(date: string) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return date;
    const todayIso = formatDateISO(new Date());
    if (date === todayIso) return '今日';
    return date;
  }

  function formatDateISOToSlash(date: string) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return date;
    return date.replace(/-/g, '/');
  }

  function formatDateYYYYMMDD(d: Date) {
    return formatDateISO(d).replace(/-/g, '');
  }

  async function loadTagWorkSummary() {
    if (!accessToken) return;
    setTagWorkLoading(true);
    setTagWorkError(null);
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

      // 今日のタスクも含める（/api/history/dates は今日を含まないため）
      const todayIso = formatDateISO(new Date());
      const resToday = await apiFetch('/api/tasks', { method: 'GET' });
      const bodyToday = await resToday.json().catch(() => null as any);
      const todayTasks: any[] = Array.isArray(bodyToday?.tasks) ? bodyToday.tasks : [];
      addTasksToMap(todayIso, todayTasks);

      // 履歴日付
      const resDates = await apiFetch('/api/history/dates', { method: 'GET' });
      const bodyDates = await resDates.json().catch(() => null as any);
      const dates: string[] = Array.isArray(bodyDates?.dates)
        ? bodyDates.dates
        : Array.isArray(bodyDates?.data)
          ? bodyDates.data
          : [];

      for (const date of dates) {
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

      setTagWorkSummary(summaries);
      if (summaries.length > 0) {
        setActiveTag((prev) => (prev && summaries.some((s) => s.tag === prev) ? prev : summaries[0].tag));
      } else {
        setActiveTag('');
      }
    } catch (e: any) {
      setTagWorkError(e?.message || 'タグ別作業時間の取得に失敗しました');
      setTagWorkSummary([]);
      setActiveTag('');
    } finally {
      setTagWorkLoading(false);
    }
  }

  useEffect(() => {
    if (!reportOpen) return;
    if (!accessToken) return;
    // 画面を開いたタイミングで最新を取得（旧UIと同じ）
    void loadTagWorkSummary();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reportOpen, accessToken]);

  function openEditForTask(task: Task) {
    if (!accessToken || busy) return;
    if (!task?.id) return;
    if (viewMode === 'history' && !historyDate) return;

    setEditingTaskId(String(task.id));
    setEditingTaskDateKey(viewMode === 'history' ? historyDate : null);
    setEditName(String(task.name || ''));
    setEditTag(String(task.tag || ''));
    setEditStartTime(formatTimeDisplay(task.startTime) || '');
    setEditEndTime(formatTimeDisplay(task.endTime) || '');
    setEditOpen(true);
  }

  async function saveEditingTask() {
    if (!accessToken) return;
    if (!editingTaskId) return;
    const name = editName.trim();
    const startTime = editStartTime.trim();
    const endTime = editEndTime.trim();
    const tag = editTag.trim();

    if (!name || !startTime) return;

    setBusy(true);
    setError(null);
    try {
      if (viewMode === 'history') {
        const dateKey = editingTaskDateKey || historyDate;
        if (!dateKey) throw new Error('日付が未選択です');
        const res = await apiFetch(`/api/history/${dateKey}/tasks/${editingTaskId}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name, startTime, endTime, tag: tag || null }),
        });
        const body = await res.json().catch(() => null as any);
        if (!res.ok || !body?.success) throw new Error(body?.message || body?.error || '更新に失敗しました');
        await loadHistory(dateKey);
      } else {
        const res = await apiFetch(`/api/tasks/${editingTaskId}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name, startTime, endTime, tag: tag || null }),
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

  async function deleteEditingTask() {
    if (!accessToken) return;
    if (!editingTaskId) return;

    setBusy(true);
    setError(null);
    try {
      if (viewMode === 'history') {
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

  function holidayKey(d: Date) {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
  }

  function getHolidayCalendarCells(monthDate: Date) {
    const year = monthDate.getFullYear();
    const month = monthDate.getMonth();
    const firstDay = new Date(year, month, 1);
    const firstDow = firstDay.getDay(); // 0=Sun
    const adjustedFirst = (firstDow + 6) % 7; // Mon=0
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    const daysInPrevMonth = new Date(year, month, 0).getDate();

    const cells: Array<{ date: Date; inMonth: boolean }> = [];
    for (let i = adjustedFirst - 1; i >= 0; i--) {
      cells.push({ date: new Date(year, month - 1, daysInPrevMonth - i), inMonth: false });
    }
    for (let d = 1; d <= daysInMonth; d++) {
      cells.push({ date: new Date(year, month, d), inMonth: true });
    }
    const remaining = 42 - cells.length;
    for (let d = 1; d <= remaining; d++) {
      cells.push({ date: new Date(year, month + 1, d), inMonth: false });
    }
    return cells;
  }

  function getHolidayCalendarCounts(monthDate: Date, holidays: Set<string>) {
    const year = monthDate.getFullYear();
    const month = monthDate.getMonth();
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    let holidayCount = 0;
    let jobdayCount = 0;
    for (let d = 1; d <= daysInMonth; d++) {
      const date = new Date(year, month, d);
      const key = holidayKey(date);
      const dow = date.getDay();
      if (holidays.has(key)) {
        holidayCount++;
      } else if (dow !== 0 && dow !== 6) {
        jobdayCount++;
      }
    }
    return { holidayCount, jobdayCount };
  }

  function toggleHolidayCalendarDay(date: Date) {
    const key = holidayKey(date);
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

      const cells = getHolidayCalendarCells(holidayCalendarMonth);

      // Day numbers + holidays
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.font = `700 58px ${fontFamily}`;
      for (let idx = 0; idx < cells.length; idx++) {
        const c = cells[idx];
        const d = c.date;
        const key = holidayKey(d);
        const isHoliday = c.inMonth && holidayCalendarHolidays.has(key);
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

        ctx.fillText(String(d.getDate()), cx, cy);

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

  return (
    <>
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
                  disabled={!accessToken || busy || viewMode !== 'today'}
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
                  disabled={!accessToken || busy || viewMode !== 'today'}
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
                        setNewTaskName(picked);
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
                  disabled={!accessToken || busy || (viewMode === 'history' && !historyDate)}
                />

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
                            setNewTaskName(name);
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

              <button
                id="add-task-btn"
                className="btn-primary btn-add-task"
                type="button"
                title="追加"
                aria-label="追加"
                onClick={addTask}
                disabled={!accessToken || busy || !String(newTaskName || '').trim() || (viewMode === 'history' && !historyDate)}
              >
                <span className="material-icons">add</span>
              </button>
            </div>

            <div className="action-buttons">
              {runningTask ? (
                <button
                  id="end-task-btn"
                  className="btn-secondary"
                  title="タスク終了"
                  aria-label="タスク終了"
                  type="button"
                  onClick={endTask}
                  disabled={!accessToken || busy}
                >
                  <span className="material-icons">check_circle</span>
                  タスク終了
                </button>
              ) : null}
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

            {error ? (
              <div style={{ marginTop: 12, color: 'var(--error)', fontSize: 12 }}>{error}</div>
            ) : null}
            {!accessToken ? (
              <div style={{ marginTop: 12, color: 'var(--text-muted)', fontSize: 12 }}>Googleでログインしてください</div>
            ) : null}
          </div>
        </aside>

        <main className="main-content">
          <div className={`main-header ${viewMode === 'history' ? 'history-mode' : ''}`}>
            <div className="date-display">
              <h1 id="current-date">{formatDateJa(now)}</h1>
              <p id="current-time">{formatTimeHHMM(now)}</p>
            </div>
            <div className="history-controls">
              <div className="view-mode-toggle">
                <button
                  id="today-btn"
                  className={`mode-btn ${viewMode === 'today' ? 'active' : ''}`}
                  title="今日"
                  aria-label="今日"
                  type="button"
                  onClick={() => setViewMode('today')}
                >
                  <span className="material-icons">today</span>
                </button>
                <button
                  id="history-btn"
                  className={`mode-btn ${viewMode === 'history' ? 'active' : ''}`}
                  title="履歴"
                  aria-label="履歴"
                  type="button"
                  onClick={() => {
                    setViewMode('history');
                    if (!historyDate) {
                      const todayIso = formatDateISO(new Date());
                      const defaultDate = historyDates.includes(todayIso) ? todayIso : (historyDates[0] ?? todayIso);
                      setHistoryDate(defaultDate);
                      if (defaultDate) void loadHistory(defaultDate);
                    }
                  }}
                >
                  <span className="material-icons">history</span>
                </button>
              </div>
              <div className="date-selector" id="date-selector" style={{ display: viewMode === 'history' ? 'flex' : 'none' }}>
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

          <div className="main-body">
            <div className={`timeline-section ${viewMode === 'history' ? 'history-mode' : ''}`}>
              <h3>📈 タイムライン</h3>
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
                    const endTimeDisplay = isReserved
                      ? formatTimeDisplay(t.endTime)
                      : isRunning
                        ? formatNowTimeDisplay(now)
                        : formatTimeDisplay(t.endTime);
                    const showRange = !!startTimeDisplay && !!endTimeDisplay && (!isReserved || !!t.endTime);
                    const timeColumn = showRange ? (
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
                          onDoubleClick={(e) => {
                            e.preventDefault();
                            e.stopPropagation();
                            openEditForTask(t);
                          }}
                        >
                          <div
                            className="timeline-task"
                            title="クリックでタスク名をコピー"
                            onClick={(e) => {
                              e.preventDefault();
                              setNewTaskName(t.name);
                              const input = document.getElementById('task-input') as HTMLInputElement | null;
                              input?.focus();
                              if (input) {
                                const len = input.value.length;
                                try {
                                  input.setSelectionRange(len, len);
                                } catch {
                                  // ignore
                                }
                              }
                            }}
                            onContextMenu={(e) => {
                              e.preventDefault();
                              setNewTaskName(t.name);
                              const input = document.getElementById('task-input') as HTMLInputElement | null;
                              input?.focus();
                            }}
                          >
                            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                              {isWorkTimeExcludedTaskName(t.name) ? (
                                <span
                                  className="material-icons"
                                  title="就労時間の集計から除外"
                                  aria-label="就労時間の集計から除外"
                                  style={{ fontSize: 16, color: 'var(--text-muted)' }}
                                >
                                  local_cafe
                                </span>
                              ) : null}
                              <span>{t.name}</span>
                            </span>
                          </div>
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

      <div className={`edit-dialog ${editOpen ? 'show' : ''}`} id="edit-dialog" aria-hidden={!editOpen}>
        <div className="edit-content">
          <div className="edit-header">
            <h3>✏️ タスク編集</h3>
            <button
              className="edit-close"
              id="edit-close"
              title="閉じる"
              aria-label="閉じる"
              type="button"
              onClick={() => setEditOpen(false)}
            >
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
                  value={editName}
                  onChange={(e) => setEditName(e.target.value)}
                  placeholder="タスク名"
                  disabled={busy}
                />
                <button
                  id="edit-add-to-task-stock-btn"
                  className="icon-btn"
                  title="タスクストックに追加"
                  aria-label="タスクストックに追加"
                  type="button"
                  onClick={() => void addTextToTaskStock(editName)}
                  disabled={!accessToken || busy || !String(editName || '').trim()}
                >
                  <span className="material-icons">bookmark_add</span>
                </button>
              </div>
            </div>
            <div className="edit-field">
              <label htmlFor="edit-task-tag">タグ（任意）</label>
              <input
                id="edit-task-tag"
                className="edit-input"
                value={editTag}
                onChange={(e) => setEditTag(e.target.value)}
                placeholder="タグ"
                disabled={busy}
              />
            </div>
            <div className="edit-field">
              <label htmlFor="edit-task-start">作業開始時刻</label>
              <input
                id="edit-task-start"
                className="edit-input"
                value={editStartTime}
                onChange={(e) => setEditStartTime(e.target.value)}
                type="time"
                onClick={() => {
                  if (busy) return;
                  if (!editStartTime) setEditStartTime(nowHHMM());
                }}
                onDoubleClick={() => {
                  if (busy) return;
                  setEditStartTime('');
                }}
                disabled={busy}
              />
            </div>
            <div className="edit-field">
              <label htmlFor="edit-task-end">作業終了時刻</label>
              <input
                id="edit-task-end"
                className="edit-input"
                value={editEndTime}
                onChange={(e) => setEditEndTime(e.target.value)}
                type="time"
                onClick={() => {
                  if (busy) return;
                  if (!editEndTime) setEditEndTime(nowHHMM());
                }}
                onDoubleClick={() => {
                  if (busy) return;
                  setEditEndTime('');
                }}
                disabled={busy}
              />
            </div>
          </div>
          <div className="edit-footer">
            <button className="btn-cancel" id="edit-cancel" title="キャンセル" aria-label="キャンセル" type="button" onClick={() => setEditOpen(false)} disabled={busy}>
              <span className="material-icons">arrow_back</span>
            </button>
            <button className="btn-primary" id="edit-save" title="保存" aria-label="保存" type="button" onClick={saveEditingTask} disabled={!accessToken || busy}>
              <span className="material-icons">save</span>
            </button>
            <button className="btn-danger" id="edit-delete" title="削除" aria-label="削除" type="button" onClick={deleteEditingTask} disabled={!accessToken || busy}>
              <span className="material-icons">delete</span>
            </button>
          </div>
        </div>
      </div>

      <div className={`report-dialog ${reportOpen ? 'show' : ''}`} id="report-dialog" aria-hidden={!reportOpen}>
        <div className="report-content">
          <div className="report-header">
            <h3>📋 報告書作成</h3>
            <button className="report-close" id="report-close" title="閉じる" aria-label="閉じる" type="button" onClick={() => setReportOpen(false)}>
              <span className="material-icons">close</span>
            </button>
          </div>
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
              <h4>🏷️ タグ別作業時間</h4>
              <div className="tag-summary">
                {tagWorkLoading ? (
                  <div className="sub-text">読み込み中...</div>
                ) : tagWorkError ? (
                  <div style={{ color: 'var(--error)', fontSize: 12 }}>{tagWorkError}</div>
                ) : tagWorkSummary.length === 0 ? (
                  <div className="sub-text">タグ付きの履歴タスクがありません</div>
                ) : (
                  <>
                    <div className="tag-tabs-container">
                      <div className="tag-tabs-navigation" role="tablist" aria-label="タグ別作業時間">
                        {tagWorkSummary.map((s) => {
                          const label = `${s.tag} (${formatDurationJa(s.totalMinutes)})`;
                          return (
                            <button
                              key={`tag-tab-${s.tag}`}
                              type="button"
                              className={`tag-tab ${activeTag === s.tag ? 'active' : ''}`}
                              role="tab"
                              aria-selected={activeTag === s.tag}
                              onClick={() => setActiveTag(s.tag)}
                            >
                              {label}
                            </button>
                          );
                        })}
                      </div>
                    </div>

                    <div className="tag-tabs-content">
                      {tagWorkSummary.map((s) => {
                        const isActive = s.tag === activeTag;
                        return (
                          <div key={`tag-panel-${s.tag}`} className={`tag-tab-panel ${isActive ? 'active' : ''}`} role="tabpanel">
                            <div className="tag-tasks">
                              {s.groups.map((g) => (
                                <div key={`tag-date-${s.tag}-${g.date}`} className="tag-date-group">
                                  <div className="date-header-with-stats">
                                    <div className="date-header">{formatDateISOToJaShort(g.date)}</div>
                                    <div className="date-total">
                                      <span>{formatDurationJa(g.totalMinutes)}</span>
                                      <span>({g.count}件)</span>
                                    </div>
                                  </div>

                                  {g.tasks.map((t, idx) => (
                                    <div key={`tag-task-${s.tag}-${g.date}-${idx}`} className="task-item">
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
                              <span>合計: {formatDurationJa(s.totalMinutes)}（履歴含む）</span>
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
                                        rows.push(
                                          [safe(dateCell), safe(t.name), safe(start), safe(end)].join(',')
                                        );
                                      }
                                    }
                                    const blob = new Blob([rows.join('\n')], { type: 'text/csv;charset=utf-8' });
                                    const url = URL.createObjectURL(blob);
                                    const a = document.createElement('a');
                                    a.href = url;
                                    a.download = `tag_${s.tag}_${formatDateYYYYMMDD(new Date())}.csv`;
                                    document.body.appendChild(a);
                                    a.click();
                                    a.remove();
                                    URL.revokeObjectURL(url);
                                  }}
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
                <div className="tab-navigation" id="tab-navigation">
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
              onClick={async () => {
                try {
                  const base = viewMode === 'today' ? tasks : historyTasks;
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

      <div className={`settings-dialog ${settingsOpen ? 'show' : ''}`} id="settings-dialog" aria-hidden={!settingsOpen}>
        <div className="settings-content">
          <div className="settings-header">
            <h3>⚙️ 設定</h3>
            <button className="settings-close" id="settings-close" title="閉じる" aria-label="閉じる" type="button" onClick={() => setSettingsOpen(false)}>
              <span className="material-icons">close</span>
            </button>
          </div>
          <div className="settings-body">
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
          <div className="task-stock-header">
            <h3>🎯 目標管理</h3>
            <button className="task-stock-close" id="goal-stock-close" title="閉じる" aria-label="閉じる" type="button" onClick={() => setGoalStockOpen(false)}>
              <span className="material-icons">close</span>
            </button>
          </div>
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
          <div className="task-stock-header">
            <h3>📚 タスクストック</h3>
            <button className="task-stock-close" id="task-stock-close" title="閉じる" aria-label="閉じる" type="button" onClick={() => setTaskStockOpen(false)}>
              <span className="material-icons">close</span>
            </button>
          </div>
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
                            setNewTaskName(t);
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
                    setTempTaskStock((p) => [...p, name]);
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
          <div className="task-stock-header">
            <h3>🏷️ タグ管理</h3>
            <button className="task-stock-close" id="tag-stock-close" title="閉じる" aria-label="閉じる" type="button" onClick={() => setTagStockOpen(false)}>
              <span className="material-icons">close</span>
            </button>
          </div>
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
          <div className="task-stock-header">
            <h3>📅 お休みカレンダー</h3>
            <button
              className="task-stock-close"
              id="holiday-calendar-close"
              title="閉じる"
              aria-label="閉じる"
              type="button"
              onClick={() => void requestCloseHolidayCalendar()}
            >
              <span className="material-icons">close</span>
            </button>
          </div>

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
              const counts = getHolidayCalendarCounts(holidayCalendarMonth, holidayCalendarHolidays);
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
                {getHolidayCalendarCells(holidayCalendarMonth).map((c, idx) => {
                  const d = c.date;
                  const key = holidayKey(d);
                  const dow = d.getDay();
                  const isToday =
                    c.inMonth &&
                    d.getFullYear() === new Date().getFullYear() &&
                    d.getMonth() === new Date().getMonth() &&
                    d.getDate() === new Date().getDate();
                  const isHoliday = c.inMonth && holidayCalendarHolidays.has(key);
                  const isJpHoliday = c.inMonth && isJpPublicHoliday(d);
                  const isSat = dow === 6;
                  const isSun = dow === 0;

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
                      key={`${key}:${idx}`}
                      type="button"
                      className={cls}
                      onClick={() => {
                        if (!c.inMonth) return;
                        toggleHolidayCalendarDay(d);
                      }}
                      disabled={!c.inMonth || holidayCalendarExporting || holidayCalendarSyncing}
                      aria-label={`${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日`}
                    >
                      {d.getDate()}
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
          <div className="task-stock-header">
            <h3>🧾 請求</h3>
            <button
              className="task-stock-close"
              id="billing-close"
              title="閉じる"
              aria-label="閉じる"
              type="button"
              onClick={() => setBillingOpen(false)}
            >
              <span className="material-icons">close</span>
            </button>
          </div>

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
    </>
  );
}
