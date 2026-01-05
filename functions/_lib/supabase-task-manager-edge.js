import { createClient } from '@supabase/supabase-js';

function getTodayDateStringJST() {
  const today = new Date();
  const parts = today
    .toLocaleDateString('ja-JP', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      timeZone: 'Asia/Tokyo',
    })
    .split('/');
  return `${parts[0]}-${parts[1]}-${parts[2]}`;
}

function isReservedTask(task) {
  return !!task && task.status === 'reserved';
}

function getNowMinutesJST() {
  const now = new Date();
  const jst = new Date(now.toLocaleString('en-US', { timeZone: 'Asia/Tokyo' }));
  return jst.getHours() * 60 + jst.getMinutes();
}

function parseTimeToMinutesFlexible(timeStr) {
  if (!timeStr) return null;
  const raw = String(timeStr).trim();
  if (!raw.includes(':')) return null;

  // 24時間形式: HH:mm / H:mm
  const hhmmMatch = raw.match(/^([01]?\d|2[0-3]):([0-5]\d)$/);
  if (hhmmMatch) {
    return parseInt(hhmmMatch[1], 10) * 60 + parseInt(hhmmMatch[2], 10);
  }

  // 12時間形式(日本語): 午前/午後
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

function safeRandomId(prefix = 'id') {
  if (typeof crypto?.randomUUID === 'function') {
    return `${prefix}-${crypto.randomUUID()}`;
  }
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  const hex = Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
  return `${prefix}-${hex}`;
}

function isPlainObject(v) {
  return !!v && typeof v === 'object' && !Array.isArray(v);
}

function deepMerge(a, b) {
  if (!isPlainObject(a)) a = {};
  if (!isPlainObject(b)) return { ...a };
  const out = { ...a };
  for (const [k, v] of Object.entries(b)) {
    if (isPlainObject(v) && isPlainObject(out[k])) out[k] = deepMerge(out[k], v);
    else out[k] = v;
  }
  return out;
}

function calcDurationMinutes(start, end) {
  const s = parseTimeToMinutesFlexible(start);
  const e = parseTimeToMinutesFlexible(end);
  if (s == null || e == null) return null;
  const diff = e - s;
  if (diff < 0) return null;
  return diff;
}

function clampDay(year, month0, day) {
  const last = new Date(year, month0 + 1, 0).getDate();
  const d = Math.max(1, Math.min(last, day));
  return d;
}

function ymdKeyFromDate(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function getNowJstDate() {
  const now = new Date();
  return new Date(now.toLocaleString('en-US', { timeZone: 'Asia/Tokyo' }));
}

function computeClosingPeriodJst(closingDay, nowJst) {
  const cd = Number.isFinite(closingDay) ? Math.trunc(closingDay) : 31;
  const closing = Math.max(1, Math.min(31, cd || 31));

  const y = nowJst.getFullYear();
  const m0 = nowJst.getMonth();
  const today = nowJst.getDate();

  // Determine period end month
  const endMonth0 = today <= clampDay(y, m0, closing) ? m0 : m0 + 1;
  const endDate = new Date(y, endMonth0, clampDay(y, endMonth0, closing));

  const prevMonth0 = endDate.getMonth() - 1;
  const prevYear = prevMonth0 < 0 ? endDate.getFullYear() - 1 : endDate.getFullYear();
  const prevM0 = (prevMonth0 + 12) % 12;
  const prevEnd = new Date(prevYear, prevM0, clampDay(prevYear, prevM0, closing));
  const startDate = new Date(prevEnd);
  startDate.setDate(startDate.getDate() + 1);

  return {
    startDate,
    endDate,
    startKey: ymdKeyFromDate(startDate),
    endKey: ymdKeyFromDate(endDate),
  };
}

export class SupabaseTaskManagerEdge {
  constructor({ supabaseUrl, serviceRoleKey }) {
    if (!supabaseUrl) throw new Error('SUPABASE_URL is required');
    if (!serviceRoleKey) throw new Error('SUPABASE_SERVICE_ROLE_KEY is required');

    this.supabase = createClient(supabaseUrl, serviceRoleKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
  }

  async initialize() {
    return;
  }

  async _getDoc(userId, docType, docKey, defaultContent) {
    const { data, error } = await this.supabase
      .from('nippo_docs')
      .select('content')
      .eq('user_id', userId)
      .eq('doc_type', docType)
      .eq('doc_key', docKey)
      .maybeSingle();

    if (error) throw error;
    if (!data) return defaultContent;
    return data.content ?? defaultContent;
  }

  async _setDoc(userId, docType, docKey, content) {
    const row = {
      user_id: userId,
      doc_type: docType,
      doc_key: docKey,
      content,
      updated_at: new Date().toISOString(),
    };

    const { error } = await this.supabase.from('nippo_docs').upsert(row, {
      onConflict: 'user_id,doc_type,doc_key',
    });

    if (error) throw error;
    return true;
  }

  async _listDocKeys(userId, docType) {
    const { data, error } = await this.supabase
      .from('nippo_docs')
      .select('doc_key')
      .eq('user_id', userId)
      .eq('doc_type', docType);

    if (error) throw error;
    return (data || []).map((r) => r.doc_key).filter(Boolean);
  }

  async _deleteDocs(userId, docType) {
    const { error } = await this.supabase
      .from('nippo_docs')
      .delete()
      .eq('user_id', userId)
      .eq('doc_type', docType);

    if (error) throw error;
    return true;
  }

  _getTimeForNowJST() {
    const now = new Date();
    const jst = new Date(now.toLocaleString('en-US', { timeZone: 'Asia/Tokyo' }));

    const amOrPm = jst.getHours() < 12 ? '午前' : '午後';
    let hour12 = jst.getHours() % 12;
    if (hour12 === 0) hour12 = 12;
    const minute = jst.getMinutes();
    return `${amOrPm} ${hour12}:${minute.toString().padStart(2, '0')}`;
  }

  async loadSchedule(dateString = null, userId) {
    await this.initialize();
    if (!userId) throw new Error('userId is required');

    const dateKey = dateString || getTodayDateStringJST();
    const doc = await this._getDoc(userId, 'tasks', dateKey, {
      date: dateKey,
      tasks: [],
    });

    const tasks = Array.isArray(doc.tasks) ? doc.tasks : [];
    return tasks;
  }

  async _saveSchedule(tasks, dateKey, userId) {
    const content = {
      date: dateKey,
      tasks,
      updatedAt: new Date().toISOString(),
    };
    await this._setDoc(userId, 'tasks', dateKey, content);
  }

  async addTask(taskName, _isBreak = false, dateString = null, tag = null, startTime = null, userId) {
    await this.initialize();
    if (!userId) throw new Error('userId is required');

    const dateKey = dateString || getTodayDateStringJST();
    const tasks = await this.loadSchedule(dateKey, userId);

    const addTime = startTime || this._getTimeForNowJST();
    const nowIso = new Date().toISOString();

    for (const task of tasks) {
      if (!task.endTime && !isReservedTask(task)) {
        task.endTime = addTime;
        task.updatedAt = nowIso;
      }
    }

    const newTask = {
      id: safeRandomId('task'),
      startTime: addTime,
      endTime: '',
      name: taskName,
      tag: tag || '',
      status: null,
      createdAt: nowIso,
      updatedAt: nowIso,
      taskDate: dateKey,
    };

    tasks.push(newTask);
    await this._saveSchedule(tasks, dateKey, userId);
    return newTask;
  }

  async addReservation(taskName, startTime, tag = null, userId) {
    await this.initialize();
    if (!userId) throw new Error('userId is required');

    const dateKey = getTodayDateStringJST();
    const tasks = await this.loadSchedule(dateKey, userId);
    const nowIso = new Date().toISOString();

    const reservation = {
      id: safeRandomId('task'),
      startTime,
      endTime: null,
      name: taskName,
      tag: tag || '',
      status: 'reserved',
      createdAt: nowIso,
      updatedAt: nowIso,
      taskDate: dateKey,
    };

    tasks.push(reservation);
    await this._saveSchedule(tasks, dateKey, userId);
    return reservation;
  }

  async processDueReservations(userId) {
    await this.initialize();
    if (!userId) throw new Error('userId is required');

    const dateKey = getTodayDateStringJST();
    const tasks = await this.loadSchedule(dateKey, userId);
    const nowMinutes = getNowMinutesJST();

    const due = tasks
      .filter((t) => isReservedTask(t))
      .map((t) => ({ task: t, minutes: parseTimeToMinutesFlexible(t.startTime) }))
      .filter((x) => x.minutes !== null && x.minutes <= nowMinutes)
      .sort((a, b) => a.minutes - b.minutes);

    if (due.length === 0) return { changed: false };

    const nowIso = new Date().toISOString();
    let changed = false;

    for (const item of due) {
      const reservation = item.task;
      const startTime = reservation?.startTime;
      if (!startTime) continue;
      if (!isReservedTask(reservation)) continue;

      for (const t of tasks) {
        if (t && !t.endTime && !isReservedTask(t)) {
          t.endTime = startTime;
          t.updatedAt = nowIso;
          changed = true;
        }
      }

      reservation.status = null;
      reservation.endTime = null;
      reservation.updatedAt = nowIso;
      changed = true;
    }

    if (changed) {
      await this._saveSchedule(tasks, dateKey, userId);
    }

    return { changed };
  }

  async endCurrentTask(dateString = null, userId) {
    await this.initialize();
    if (!userId) throw new Error('userId is required');

    const dateKey = dateString || getTodayDateStringJST();
    const tasks = await this.loadSchedule(dateKey, userId);
    const addTime = this._getTimeForNowJST();
    const nowIso = new Date().toISOString();

    for (let i = tasks.length - 1; i >= 0; i--) {
      const task = tasks[i];
      if (!task.endTime && !isReservedTask(task)) {
        task.endTime = addTime;
        task.updatedAt = nowIso;
        await this._saveSchedule(tasks, dateKey, userId);
        return task;
      }
    }

    return null;
  }

  async getTimelineText(dateString = null, userId) {
    const dateKey = dateString || getTodayDateStringJST();
    const tasks = await this.loadSchedule(dateKey, userId);

    const lines = [];
    for (const t of tasks) {
      const title = t.name || t.title || '';
      const start = t.startTime || '';
      const end = t.endTime || '';
      const tag = t.tag ? ` [${t.tag}]` : '';
      if (isReservedTask(t)) {
        lines.push(`(予約) ${start} ${title}${tag}`);
      } else if (end) {
        lines.push(`${start} - ${end} ${title}${tag}`);
      } else {
        lines.push(`${start} -  ${title}${tag}`);
      }
    }

    return lines.join('\n');
  }

  async clearAllTasks(userId) {
    await this.initialize();
    if (!userId) throw new Error('userId is required');

    const today = getTodayDateStringJST();
    await this._saveSchedule([], today, userId);
    return true;
  }

  async clearAllTimelineData(userId) {
    await this.initialize();
    if (!userId) throw new Error('userId is required');

    await this._deleteDocs(userId, 'tasks');
    return true;
  }

  async getAllHistoryDates(userId) {
    await this.initialize();
    if (!userId) throw new Error('userId is required');

    const today = getTodayDateStringJST();
    const keys = await this._listDocKeys(userId, 'tasks');
    const dates = keys
      .filter((d) => d && d !== today)
      .sort()
      .reverse();

    return { success: true, dates };
  }

  async loadHistoryByDate(dateString, userId) {
    await this.initialize();
    if (!userId) throw new Error('userId is required');

    const doc = await this._getDoc(userId, 'tasks', dateString, null);
    if (!doc) {
      return { success: false, message: '指定された日付の履歴が見つかりません' };
    }

    const data = {
      date: dateString,
      tasks: Array.isArray(doc.tasks) ? doc.tasks : [],
      updatedAt: doc.updatedAt || null,
    };

    return { success: true, data };
  }

  async updateHistoryByDate(dateString, data, userId) {
    await this.initialize();
    if (!userId) throw new Error('userId is required');

    const normalized = {
      ...(data || {}),
      date: dateString,
      updatedAt: new Date().toISOString(),
      tasks: Array.isArray(data?.tasks) ? data.tasks : [],
    };

    await this._setDoc(userId, 'tasks', dateString, normalized);
    return { success: true, data: normalized };
  }

  async createNewHistoryForDate(dateString, userId) {
    await this.initialize();
    if (!userId) throw new Error('userId is required');

    const empty = {
      date: dateString,
      tasks: [],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      note: '手動作成された空の履歴',
    };

    await this._setDoc(userId, 'tasks', dateString, empty);
    return { success: true, data: empty };
  }

  async addTaskToHistory(dateString, taskData, userId) {
    await this.initialize();
    if (!userId) throw new Error('userId is required');

    const existing = await this.loadHistoryByDate(dateString, userId);
    const tasks = existing.success ? existing.data.tasks : [];

    const nowIso = new Date().toISOString();
    const newTask = {
      id: safeRandomId('task'),
      startTime: taskData?.startTime || this._getTimeForNowJST(),
      endTime: taskData?.endTime || '',
      name: taskData?.name || taskData?.title || '',
      tag: taskData?.tag || '',
      status: taskData?.status || null,
      createdAt: taskData?.createdAt || nowIso,
      updatedAt: nowIso,
      taskDate: dateString,
    };

    tasks.push(newTask);
    await this._setDoc(userId, 'tasks', dateString, {
      date: dateString,
      tasks,
      updatedAt: nowIso,
    });

    return { success: true, task: newTask };
  }

  async updateHistoryTask(dateString, taskId, taskName, startTime, endTime, tag, userId) {
    await this.initialize();
    if (!userId) throw new Error('userId is required');

    const current = await this.loadHistoryByDate(dateString, userId);
    if (!current.success) {
      return { success: false, message: '指定された日付の履歴が見つかりません' };
    }

    const tasks = current.data.tasks;
    const idx = tasks.findIndex((t) => String(t.id) === String(taskId));
    if (idx === -1) {
      return { success: false, message: 'タスクが見つかりません' };
    }

    const nowIso = new Date().toISOString();
    tasks[idx] = {
      ...tasks[idx],
      name: taskName,
      startTime,
      endTime: endTime || '',
      tag: tag || '',
      updatedAt: nowIso,
    };

    await this._setDoc(userId, 'tasks', dateString, {
      date: dateString,
      tasks,
      updatedAt: nowIso,
    });

    return { success: true, task: tasks[idx] };
  }

  async updateTask(taskId, taskName, startTime, endTime, tag, userId) {
    await this.initialize();
    if (!userId) throw new Error('userId is required');

    const today = getTodayDateStringJST();
    const tasks = await this.loadSchedule(today, userId);
    const idx = tasks.findIndex((t) => String(t.id) === String(taskId));
    if (idx === -1) return null;

    const nowIso = new Date().toISOString();
    tasks[idx] = {
      ...tasks[idx],
      name: taskName,
      startTime,
      endTime: endTime || '',
      tag: tag || '',
      updatedAt: nowIso,
    };

    await this._saveSchedule(tasks, today, userId);
    return { task: tasks[idx] };
  }

  async deleteTask(taskId, userId) {
    await this.initialize();
    if (!userId) throw new Error('userId is required');

    const today = getTodayDateStringJST();
    const tasks = await this.loadSchedule(today, userId);
    const idx = tasks.findIndex((t) => String(t.id) === String(taskId));
    if (idx === -1) return null;

    const [deleted] = tasks.splice(idx, 1);
    await this._saveSchedule(tasks, today, userId);
    return deleted;
  }

  async deleteHistoryTask(dateString, taskId, userId) {
    await this.initialize();
    if (!userId) throw new Error('userId is required');

    const current = await this.loadHistoryByDate(dateString, userId);
    if (!current.success) {
      return { success: false, message: '指定された日付の履歴が見つかりません' };
    }

    const tasks = current.data.tasks;
    const idx = tasks.findIndex((t) => String(t.id) === String(taskId));
    if (idx === -1) {
      return { success: false, message: 'タスクが見つかりません' };
    }

    const [deleted] = tasks.splice(idx, 1);
    const nowIso = new Date().toISOString();
    await this._setDoc(userId, 'tasks', dateString, { date: dateString, tasks, updatedAt: nowIso });
    return { success: true, task: deleted };
  }

  async loadReport(userId) {
    if (!userId) throw new Error('userId is required');
    const doc = await this._getDoc(userId, 'report', 'default', { content: '' });
    return doc.content || '';
  }

  async saveReport(content, userId) {
    if (!userId) throw new Error('userId is required');
    await this._setDoc(userId, 'report', 'default', { content: content || '', updatedAt: new Date().toISOString() });
    return true;
  }

  async loadReportUrls(userId) {
    if (!userId) throw new Error('userId is required');
    const doc = await this._getDoc(userId, 'report_urls', 'default', { urls: [] });
    return Array.isArray(doc.urls) ? doc.urls : [];
  }

  async addReportUrl(name, url, userId) {
    const urls = await this.loadReportUrls(userId);
    const maxId = urls.reduce((m, u) => (typeof u.id === 'number' && u.id > m ? u.id : m), 0);
    const newUrl = { id: maxId + 1, name, url };
    urls.push(newUrl);
    await this._setDoc(userId, 'report_urls', 'default', { urls, updatedAt: new Date().toISOString() });
    return newUrl;
  }

  async deleteReportUrl(urlId, userId) {
    const urls = await this.loadReportUrls(userId);
    const idx = urls.findIndex((u) => Number(u.id) === Number(urlId));
    if (idx === -1) return null;
    const [deleted] = urls.splice(idx, 1);
    await this._setDoc(userId, 'report_urls', 'default', { urls, updatedAt: new Date().toISOString() });
    return deleted;
  }

  async migrateLegacyReportData() {
    return;
  }

  async loadReportTabs(userId) {
    if (!userId) throw new Error('userId is required');
    const doc = await this._getDoc(userId, 'report_tabs', 'default', {
      tabs: [{ id: 'default', name: 'デフォルト' }],
    });
    return Array.isArray(doc.tabs) ? doc.tabs : [{ id: 'default', name: 'デフォルト' }];
  }

  async getReportTabContent(tabId, userId) {
    if (!userId) throw new Error('userId is required');
    const key = String(tabId);
    const doc = await this._getDoc(userId, 'report_tab_content', key, { content: '' });
    return doc.content || '';
  }

  async saveReportTabContent(tabId, content, userId) {
    if (!userId) throw new Error('userId is required');
    const key = String(tabId);
    await this._setDoc(userId, 'report_tab_content', key, { content: content || '', updatedAt: new Date().toISOString() });
    return true;
  }

  async loadGoalStock(userId) {
    if (!userId) throw new Error('userId is required');
    const doc = await this._getDoc(userId, 'goal_stock', 'default', { goals: [] });
    return Array.isArray(doc.goals) ? doc.goals : [];
  }

  async saveGoalStock(goals, userId) {
    if (!userId) throw new Error('userId is required');
    await this._setDoc(userId, 'goal_stock', 'default', {
      goals: Array.isArray(goals) ? goals : [],
      updatedAt: new Date().toISOString(),
    });
    return true;
  }

  async loadTaskStock(userId) {
    if (!userId) throw new Error('userId is required');
    const doc = await this._getDoc(userId, 'task_stock', 'default', { tasks: [] });
    return Array.isArray(doc.tasks) ? doc.tasks : [];
  }

  async saveTaskStock(tasks, userId) {
    if (!userId) throw new Error('userId is required');
    await this._setDoc(userId, 'task_stock', 'default', {
      tasks: Array.isArray(tasks) ? tasks : [],
      updatedAt: new Date().toISOString(),
    });
    return true;
  }

  async loadTagStock(userId) {
    if (!userId) throw new Error('userId is required');
    const doc = await this._getDoc(userId, 'tag_stock', 'default', { tags: [] });
    return Array.isArray(doc.tags) ? doc.tags : [];
  }

  async saveTagStock(tags, userId) {
    if (!userId) throw new Error('userId is required');
    await this._setDoc(userId, 'tag_stock', 'default', {
      tags: Array.isArray(tags) ? tags : [],
      updatedAt: new Date().toISOString(),
    });
    return true;
  }

  async cleanupHistoryByDate(_targetDate, _userId) {
    return { success: true, message: 'Supabase版ではcleanupは不要です' };
  }

  async loadSettings(userId) {
    if (!userId) throw new Error('userId is required');
    const doc = await this._getDoc(userId, 'settings', 'default', {});
    return doc || {};
  }

  async saveSettings(settings, userId) {
    if (!userId) throw new Error('userId is required');
    const current = await this._getDoc(userId, 'settings', 'default', {});
    const merged = deepMerge(current || {}, settings || {});
    await this._setDoc(userId, 'settings', 'default', merged);
    return true;
  }

  async loadTasksRange(startKey, endKey, userId) {
    if (!userId) throw new Error('userId is required');
    if (!startKey || !endKey) return [];

    const { data, error } = await this.supabase
      .from('nippo_docs')
      .select('doc_key,content')
      .eq('user_id', userId)
      .eq('doc_type', 'tasks')
      .gte('doc_key', startKey)
      .lte('doc_key', endKey);

    if (error) throw error;
    return Array.isArray(data) ? data : [];
  }

  async computeBillingSummary(userId) {
    if (!userId) throw new Error('userId is required');

    const settings = (await this.loadSettings(userId)) || {};
    const billing = isPlainObject(settings.billing) ? settings.billing : {};
    const workTime = isPlainObject(settings.workTime) ? settings.workTime : {};

    const modeRaw = String(billing.mode || 'hourly');
    const mode = modeRaw === 'daily' ? 'daily' : 'hourly';

    const closingDay = Number(billing.closingDay);
    const hourlyRate = Number(billing.hourlyRate);
    const dailyRate = Number(billing.dailyRate);
    const hourlyCapHours = Number(billing.hourlyCapHours);

    const nowJst = getNowJstDate();
    const period = computeClosingPeriodJst(
      Number.isFinite(closingDay) ? closingDay : 31,
      nowJst
    );

    const cal = await this.loadHolidayCalendar(userId);
    const holidayKeys = new Set(Array.isArray(cal?.holidays) ? cal.holidays.filter((x) => typeof x === 'string') : []);

    const exclude = new Set(
      Array.isArray(workTime.excludeTaskNames)
        ? workTime.excludeTaskNames.map((x) => String(x ?? '').trim()).filter(Boolean)
        : []
    );

    if (mode === 'daily') {
      let workDays = 0;
      const cur = new Date(period.startDate);
      while (cur <= period.endDate) {
        const dow = cur.getDay();
        const key = ymdKeyFromDate(cur);
        const isWeekend = dow === 0 || dow === 6;
        const isHoliday = holidayKeys.has(key);
        if (!isWeekend && !isHoliday) workDays++;
        cur.setDate(cur.getDate() + 1);
      }

      const rate = Number.isFinite(dailyRate) ? dailyRate : 0;
      const amount = Math.round(workDays * rate);
      return {
        mode,
        closingDay: Number.isFinite(closingDay) ? Math.trunc(closingDay) : 31,
        periodStart: period.startKey,
        periodEnd: period.endKey,
        workDays,
        dailyRate: Number.isFinite(dailyRate) ? dailyRate : 0,
        amount,
      };
    }

    // hourly
    const rows = await this.loadTasksRange(period.startKey, period.endKey, userId);
    const capMin = Number.isFinite(hourlyCapHours) && hourlyCapHours > 0 ? Math.round(hourlyCapHours * 60) : 0;
    const byDate = new Map();

    for (const row of rows) {
      const dateKey = String(row?.doc_key || '');
      const tasks = Array.isArray(row?.content?.tasks) ? row.content.tasks : [];
      let total = 0;
      for (const t of tasks) {
        if (!t) continue;
        if (t.status === 'reserved') continue;
        const name = String(t.name ?? '').trim();
        if (name && exclude.has(name)) continue;
        const minutes = calcDurationMinutes(t.startTime, t.endTime);
        if (minutes == null) continue;
        total += minutes;
      }
      if (!dateKey) continue;
      byDate.set(dateKey, (byDate.get(dateKey) || 0) + total);
    }

    let totalMinutes = 0;
    let billedMinutes = 0;
    for (const m of byDate.values()) {
      totalMinutes += m;
      billedMinutes += capMin > 0 ? Math.min(m, capMin) : m;
    }

    const rate = Number.isFinite(hourlyRate) ? hourlyRate : 0;
    const amount = Math.round((billedMinutes / 60) * rate);

    return {
      mode,
      closingDay: Number.isFinite(closingDay) ? Math.trunc(closingDay) : 31,
      periodStart: period.startKey,
      periodEnd: period.endKey,
      hourlyRate: Number.isFinite(hourlyRate) ? hourlyRate : 0,
      hourlyCapHours: capMin > 0 ? capMin / 60 : 0,
      totalMinutes,
      billedMinutes,
      amount,
    };
  }

  async loadHolidayCalendar(userId) {
    if (!userId) throw new Error('userId is required');
    const doc = await this._getDoc(userId, 'holiday_calendar', 'default', null);
    if (!doc) return null;
    const holidays = Array.isArray(doc.holidays) ? doc.holidays : [];
    const month = typeof doc.month === 'string' ? doc.month : null;
    return { month, holidays };
  }

  async saveHolidayCalendar(calendar, userId) {
    if (!userId) throw new Error('userId is required');
    const month = typeof calendar?.month === 'string' ? calendar.month : null;
    const holidaysRaw = Array.isArray(calendar?.holidays) ? calendar.holidays : [];
    const holidays = holidaysRaw.filter((x) => typeof x === 'string');
    await this._setDoc(userId, 'holiday_calendar', 'default', {
      month,
      holidays,
      updatedAt: new Date().toISOString(),
    });
    return true;
  }
}
