'use client';

import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { useEffect, useMemo, useState } from 'react';

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

function getSupabase(opts?: { supabaseUrl?: string; supabaseAnonKey?: string }): SupabaseClient | null {
  const url = opts?.supabaseUrl || process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = opts?.supabaseAnonKey || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anonKey) return null;
  return createClient(url, anonKey);
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
  const [userEmail, setUserEmail] = useState<string | null>(null);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [newTaskName, setNewTaskName] = useState('');
  const [addMode, setAddMode] = useState<'now' | 'reserve'>('now');
  const [selectedTag, setSelectedTag] = useState('');
  const [reserveStartTime, setReserveStartTime] = useState('');
  const [tagStock, setTagStock] = useState<TagStockItem[]>([]);
  const [tempTagStock, setTempTagStock] = useState<TagStockItem[]>([]);
  const [tagInput, setTagInput] = useState('');
  const [tagDirty, setTagDirty] = useState(false);

  const [goalStock, setGoalStock] = useState<Array<{ name: string }>>([]);
  const [tempGoalStock, setTempGoalStock] = useState<Array<{ name: string }>>([]);
  const [goalInput, setGoalInput] = useState('');
  const [goalDirty, setGoalDirty] = useState(false);

  const [taskStock, setTaskStock] = useState<string[]>([]);
  const [tempTaskStock, setTempTaskStock] = useState<string[]>([]);
  const [taskStockInput, setTaskStockInput] = useState('');
  const [taskStockDirty, setTaskStockDirty] = useState(false);

  const [settingsTimeRoundingInterval, setSettingsTimeRoundingInterval] = useState(0);
  const [settingsTimeRoundingMode, setSettingsTimeRoundingMode] = useState<'nearest' | 'floor' | 'ceil'>('nearest');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

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

  useEffect(() => {
    const client = supabase;
    if (!client) return;

    let cancelled = false;

    async function bootstrap(nonNullClient: SupabaseClient) {
      const { data } = await nonNullClient.auth.getSession();
      if (cancelled) return;
      const session = data.session;
      setAccessToken(session?.access_token ?? null);
      setUserEmail(session?.user?.email ?? null);
    }

    bootstrap(client);

    const { data: sub } = client.auth.onAuthStateChange((_event, session) => {
      setAccessToken(session?.access_token ?? null);
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
      setSettingsTimeRoundingInterval(0);
      setSettingsTimeRoundingMode('nearest');
      return;
    }
    void reloadTasks();
    void loadHistoryDates();
    void loadReportUrls();
    void loadReportSingle();
    void loadTagStock();
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
    } catch {
      // ignore
    }
  }

  async function saveSettings() {
    if (!accessToken) return;
    setBusy(true);
    setError(null);
    try {
      const res = await apiFetch('/api/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          settings: {
            timeRounding: {
              interval: settingsTimeRoundingInterval,
              mode: settingsTimeRoundingMode,
            },
          },
        }),
      });
      const body = await res.json();
      if (!res.ok || !body?.success) throw new Error(body?.error || '保存に失敗しました');
      setSettingsOpen(false);
    } catch (e: any) {
      setError(e?.message || String(e));
    } finally {
      setBusy(false);
    }
  }

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
    void loadTaskStock();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [accessToken, taskStockOpen]);

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

  async function reloadTasks() {
    setError(null);
    try {
      const res = await apiFetch('/api/tasks');
      const body = await res.json();
      if (!res.ok || !body?.success) {
        throw new Error(body?.error || 'タスク取得に失敗しました');
      }
      setTasks(Array.isArray(body.tasks) ? body.tasks : []);
    } catch (e: any) {
      setError(e?.message || String(e));
    }
  }

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
      const totalMinutes = tasks.reduce((sum, t) => {
        const m = calcDurationMinutes(t.startTime, t.endTime);
        return sum + (m ?? 0);
      }, 0);
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
                  <div className="truncate text-sm text-[var(--text-primary)]">{t.name}</div>
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
                  <div className="truncate text-sm text-[var(--text-primary)]">{t.name}</div>
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
                      startTime: t.startTime || '',
                      endTime: t.endTime || '',
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
                placeholder="開始 (例: 午前 9:00 / 09:00)"
                disabled={busy}
              />
              <input
                className="w-full rounded-[var(--radius-small)] border border-[var(--border)] bg-[var(--bg-secondary)] px-3 py-2 text-sm"
                value={historyEditing.endTime}
                onChange={(e) => setHistoryEditing((p) => (p ? { ...p, endTime: e.target.value } : p))}
                placeholder="終了 (任意)"
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
              placeholder="開始 (任意)"
              disabled={!historyDate || busy}
            />
            <input
              className="w-full rounded-[var(--radius-small)] border border-[var(--border)] bg-[var(--bg-secondary)] px-3 py-2 text-sm"
              value={historyNewTask.endTime}
              onChange={(e) => setHistoryNewTask((p) => ({ ...p, endTime: e.target.value }))}
              placeholder="終了 (任意)"
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

    setBusy(true);
    setError(null);
    try {
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

  const effectiveTasks = viewMode === 'today' ? tasks : historyTasks;
  const runningTask = tasks
    .slice()
    .reverse()
    .find((t) => !t.endTime && t.status !== 'reserved');
  const completedCount = effectiveTasks.filter((t) => !!t.endTime && t.status !== 'reserved').length;
  const totalMinutes = effectiveTasks.reduce((sum, t) => {
    const m = calcDurationMinutes(t.startTime, t.endTime);
    return sum + (m ?? 0);
  }, 0);

  const timelineEmptyText = viewMode === 'today' ? 'まだタスクがありません' : 'この日はタスクがありません';

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

      <div
        id="mobile-overlay"
        className="mobile-overlay"
        aria-hidden={!sidebarOpen}
        onClick={() => setSidebarOpen(false)}
      />

      <div className="app-container">
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
                  disabled={!accessToken || busy}
                />
              </div>

              <div className="task-name-row">
                <input
                  type="text"
                  id="task-input"
                  placeholder="新しいタスクを入力..."
                  className="task-input"
                  value={newTaskName}
                  onChange={(e) => setNewTaskName(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') void addTask();
                  }}
                  disabled={!accessToken || busy}
                />
              </div>

              <button
                id="add-task-btn"
                className="btn-primary btn-add-task"
                type="button"
                title="追加"
                aria-label="追加"
                onClick={addTask}
                disabled={!accessToken || busy}
              >
                <span className="material-icons">add</span>
              </button>
            </div>

            <div className="action-buttons">
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
                  onClick={() => setViewMode('history')}
                >
                  <span className="material-icons">history</span>
                </button>
              </div>
              <div className="date-selector" id="date-selector" style={{ display: viewMode === 'history' ? 'flex' : 'none' }}>
                <div className="date-input-wrap" id="date-input-wrap">
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
            <div className="timeline-section">
              <h3>📈 タイムライン</h3>
              <div className="timeline-container" id="timeline-container">
                {effectiveTasks.length === 0 ? (
                  <div className="timeline-empty">
                    <span className="material-icons">schedule</span>
                    <p>{timelineEmptyText}</p>
                    <p className="sub-text">新しいタスクを追加してください</p>
                  </div>
                ) : (
                  effectiveTasks.map((t) => (
                    <div key={t.id} className="timeline-item">
                      <div className="timeline-time">
                        {t.status === 'reserved' ? '(予約) ' : ''}
                        {t.startTime || ''}
                        {t.endTime ? ` - ${t.endTime}` : ''}
                      </div>
                      <div className="timeline-content">
                        <div className="timeline-title">{t.name}</div>
                        {t.tag ? <div className="timeline-tag">{t.tag}</div> : null}
                      </div>
                    </div>
                  ))
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
              <h4>🔗 報告先</h4>
              <div className="report-links" id="report-links">
                {reportUrls.length === 0 ? (
                  <div className="text-muted">未設定</div>
                ) : (
                  reportUrls.map((u) => (
                    <a key={u.id} href={u.url} target="_blank" rel="noreferrer" className="report-link">
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
                        className={`tab-btn ${active ? 'active' : ''}`}
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
              id="copy-timeline-btn"
              title="タイムラインをコピー"
              aria-label="タイムラインをコピー"
              type="button"
              onClick={async () => {
                try {
                  const text = (viewMode === 'today' ? tasks : historyTasks)
                    .map((t) => {
                      const tag = t.tag ? ` [${t.tag}]` : '';
                      if (t.status === 'reserved') return `(予約) ${t.startTime || ''} ${t.name}${tag}`;
                      if (t.endTime) return `${t.startTime || ''} - ${t.endTime} ${t.name}${tag}`;
                      return `${t.startTime || ''} -  ${t.name}${tag}`;
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
                    onChange={(e) => setSettingsTimeRoundingInterval(parseInt(e.target.value || '0', 10) || 0)}
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
                    onChange={(e) => setSettingsTimeRoundingMode((e.target.value as any) || 'nearest')}
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
              <div className="task-stock-list" id="goal-stock-list">
                {tempGoalStock.length === 0 ? (
                  <div className="task-stock-empty">
                    <span className="material-icons">inventory_2</span>
                    <p>目標は空です</p>
                  </div>
                ) : (
                  tempGoalStock.map((g, idx) => (
                    <div key={`${g.name}:${idx}`} className="goal-stock-item">
                      <div className="goal-stock-content">
                        <div className="goal-stock-item-name" title="目標名">
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
              <p className="task-stock-help-text">タスクをクリックすると入力欄に追加されます</p>
              <div className="task-stock-list" id="task-stock-list">
                {tempTaskStock.length === 0 ? (
                  <div className="task-stock-empty">
                    <span className="material-icons">inventory_2</span>
                    <p>タスクストックは空です</p>
                    <p className="sub-text">📚ボタンでタスクを追加してください</p>
                  </div>
                ) : (
                  tempTaskStock.map((t, idx) => (
                    <div key={`${t}:${idx}`} className="task-stock-item">
                      <div className="stock-item-content">
                        <div
                          className="task-stock-item-name clickable"
                          title="クリックして新しいタスクに追加"
                          onClick={() => {
                            setNewTaskName(t);
                            setTaskStockOpen(false);
                          }}
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
              <div className="task-stock-list" id="tag-stock-list">
                {tempTagStock.length === 0 ? (
                  <div className="task-stock-empty">
                    <span className="material-icons">inventory_2</span>
                    <p>タグは空です</p>
                  </div>
                ) : (
                  tempTagStock.map((tag, idx) => (
                    <div key={`${tag.id ?? ''}:${tag.name}:${idx}`} className="stock-item">
                      <div className="stock-item-content">
                        <div className="tag-stock-item-name" title="タグ名">
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
    </>
  );
}
