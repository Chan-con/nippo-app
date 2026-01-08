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

function isReservedTask(task: any) {
  return !!task && task.status === 'reserved';
}

function getNowMinutesJST() {
  const now = new Date();
  const jst = new Date(now.toLocaleString('en-US', { timeZone: 'Asia/Tokyo' }));
  return jst.getHours() * 60 + jst.getMinutes();
}

function parseTimeToMinutesFlexible(timeStr: any) {
  if (!timeStr) return null;
  const raw = String(timeStr).trim();
  if (!raw.includes(':')) return null;

  const hhmmMatch = raw.match(/^([01]?\d|2[0-3]):([0-5]\d)$/);
  if (hhmmMatch) {
    return parseInt(hhmmMatch[1], 10) * 60 + parseInt(hhmmMatch[2], 10);
  }

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
  // Node18+ なら crypto.randomUUID が使える
  const anyCrypto: any = (globalThis as any).crypto;
  if (typeof anyCrypto?.randomUUID === 'function') {
    return `${prefix}-${anyCrypto.randomUUID()}`;
  }
  // fallback
  return `${prefix}-${Math.random().toString(16).slice(2)}${Date.now().toString(16)}`;
}

export class SupabaseTaskManager {
  private supabase: ReturnType<typeof createClient>;

  constructor(opts: { supabaseUrl: string; serviceRoleKey: string }) {
    if (!opts.supabaseUrl) throw new Error('SUPABASE_URL is required');
    if (!opts.serviceRoleKey) throw new Error('SUPABASE_SERVICE_ROLE_KEY is required');

    this.supabase = createClient(opts.supabaseUrl, opts.serviceRoleKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
  }

  async initialize() {
    return;
  }

  private async _getDoc(userId: string, docType: string, docKey: string, defaultContent: any) {
    const { data, error } = await this.supabase
      .from('nippo_docs')
      .select('content')
      .eq('user_id', userId)
      .eq('doc_type', docType)
      .eq('doc_key', docKey)
      .maybeSingle();

    if (error) throw error;
    if (!data) return defaultContent;
    return (data as any).content ?? defaultContent;
  }

  private async _setDoc(userId: string, docType: string, docKey: string, content: any) {
    const row = {
      user_id: userId,
      doc_type: docType,
      doc_key: docKey,
      content,
      updated_at: new Date().toISOString(),
    };

    const { error } = await this.supabase.from('nippo_docs').upsert(row as any, {
      onConflict: 'user_id,doc_type,doc_key',
    });
    if (error) throw error;
    return true;
  }

  private async _listDocKeys(userId: string, docType: string) {
    const { data, error } = await this.supabase
      .from('nippo_docs')
      .select('doc_key')
      .eq('user_id', userId)
      .eq('doc_type', docType);
    if (error) throw error;
    return (data || []).map((r: any) => r.doc_key).filter(Boolean);
  }

  private async _deleteDocs(userId: string, docType: string) {
    const { error } = await this.supabase.from('nippo_docs').delete().eq('user_id', userId).eq('doc_type', docType);
    if (error) throw error;
    return true;
  }

  private _getTimeForNowJST() {
    const now = new Date();
    const jst = new Date(now.toLocaleString('en-US', { timeZone: 'Asia/Tokyo' }));

    const amOrPm = jst.getHours() < 12 ? '午前' : '午後';
    let hour12 = jst.getHours() % 12;
    if (hour12 === 0) hour12 = 12;
    const minute = jst.getMinutes();
    return `${amOrPm} ${hour12}:${minute.toString().padStart(2, '0')}`;
  }

  async loadSchedule(dateString: string | null = null, userId: string) {
    await this.initialize();
    if (!userId) throw new Error('userId is required');

    const dateKey = dateString || getTodayDateStringJST();
    const doc = await this._getDoc(userId, 'tasks', dateKey, { date: dateKey, tasks: [] });

    const tasks = Array.isArray(doc.tasks) ? doc.tasks : [];
    return tasks;
  }

  private async _saveSchedule(tasks: any[], dateKey: string, userId: string) {
    const content = {
      date: dateKey,
      tasks,
      updatedAt: new Date().toISOString(),
    };
    await this._setDoc(userId, 'tasks', dateKey, content);
  }

  async addTask(taskName: string, _isBreak = false, dateString: string | null = null, tag: string | null = null, startTime: string | null = null, userId: string) {
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
      memo: '',
      status: null,
      createdAt: nowIso,
      updatedAt: nowIso,
      taskDate: dateKey,
    };

    tasks.push(newTask);
    await this._saveSchedule(tasks, dateKey, userId);
    return newTask;
  }

  async addReservation(taskName: string, startTime: string, tag: string | null = null, userId: string) {
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
      memo: '',
      status: 'reserved',
      createdAt: nowIso,
      updatedAt: nowIso,
      taskDate: dateKey,
    };

    tasks.push(reservation);
    await this._saveSchedule(tasks, dateKey, userId);
    return reservation;
  }

  async processDueReservations(userId: string) {
    await this.initialize();
    if (!userId) throw new Error('userId is required');

    const dateKey = getTodayDateStringJST();
    const tasks = await this.loadSchedule(dateKey, userId);

    const nowMinutes = getNowMinutesJST();
    const due = tasks
      .filter((t: any) => isReservedTask(t))
      .map((t: any) => ({ task: t, minutes: parseTimeToMinutesFlexible(t.startTime) }))
      .filter((x: any) => x.minutes !== null && x.minutes <= nowMinutes)
      .sort((a: any, b: any) => a.minutes - b.minutes);

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

  async endCurrentTask(dateString: string | null = null, userId: string) {
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

  async getTimelineText(dateString: string | null = null, userId: string) {
    const dateKey = dateString || getTodayDateStringJST();
    const tasks = await this.loadSchedule(dateKey, userId);

    const lines: string[] = [];
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

  async clearAllTasks(userId: string) {
    await this.initialize();
    if (!userId) throw new Error('userId is required');

    const today = getTodayDateStringJST();
    await this._saveSchedule([], today, userId);
    return true;
  }

  async clearAllTimelineData(userId: string) {
    await this.initialize();
    if (!userId) throw new Error('userId is required');

    await this._deleteDocs(userId, 'tasks');
    return true;
  }

  async getAllHistoryDates(userId: string) {
    await this.initialize();
    if (!userId) throw new Error('userId is required');

    const today = getTodayDateStringJST();
    const keys = await this._listDocKeys(userId, 'tasks');
    const dates = keys
      .filter((d: any) => d && d !== today)
      .sort()
      .reverse();

    return { success: true, dates };
  }

  async loadHistoryByDate(dateString: string, userId: string) {
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

  async updateHistoryByDate(dateString: string, data: any, userId: string) {
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

  // 以下、report / urls / tabs / goals / task-stock / tags / settings は
  // 既存仕様に合わせて順次追加していく（API移植フェーズで必要分を実装）

  async loadReport(userId: string) {
    return await this._getDoc(userId, 'report', 'default', '');
  }

  async saveReport(content: string, userId: string) {
    await this._setDoc(userId, 'report', 'default', content);
    return true;
  }

  async loadReportUrls(userId: string) {
    return await this._getDoc(userId, 'report_urls', 'default', []);
  }

  async addReportUrl(name: string, url: string, userId: string) {
    const urls = await this.loadReportUrls(userId);
    const list = Array.isArray(urls) ? urls : [];
    const nextId = Math.max(0, ...list.map((u: any) => Number(u.id) || 0)) + 1;
    const row = { id: nextId, name, url };
    list.push(row);
    await this._setDoc(userId, 'report_urls', 'default', list);
    return row;
  }

  async deleteReportUrl(urlId: number, userId: string) {
    const urls = await this.loadReportUrls(userId);
    const list = Array.isArray(urls) ? urls : [];
    const idx = list.findIndex((u: any) => Number(u.id) === Number(urlId));
    if (idx === -1) return null;
    const [deleted] = list.splice(idx, 1);
    await this._setDoc(userId, 'report_urls', 'default', list);
    return deleted;
  }

  async loadSettings(userId: string) {
    return await this._getDoc(userId, 'settings', 'default', {});
  }

  async saveSettings(settings: any, userId: string) {
    await this._setDoc(userId, 'settings', 'default', settings || {});
    return true;
  }

  async loadGoalStock(userId: string) {
    return await this._getDoc(userId, 'goals', 'default', []);
  }

  async saveGoalStock(goals: any, userId: string) {
    await this._setDoc(userId, 'goals', 'default', Array.isArray(goals) ? goals : []);
    return true;
  }

  async loadTaskStock(userId: string) {
    return await this._getDoc(userId, 'task_stock', 'default', []);
  }

  async saveTaskStock(tasks: any, userId: string) {
    await this._setDoc(userId, 'task_stock', 'default', Array.isArray(tasks) ? tasks : []);
    return true;
  }

  async loadTagStock(userId: string) {
    return await this._getDoc(userId, 'tags', 'default', []);
  }

  async saveTagStock(tags: any, userId: string) {
    await this._setDoc(userId, 'tags', 'default', Array.isArray(tags) ? tags : []);
    return true;
  }

  async loadReportTabs(userId: string) {
    return await this._getDoc(userId, 'report_tabs', 'index', []);
  }

  async getReportTabContent(tabId: string, userId: string) {
    return await this._getDoc(userId, 'report_tab_content', tabId, '');
  }

  async saveReportTabContent(tabId: string, content: string, userId: string) {
    await this._setDoc(userId, 'report_tab_content', tabId, content || '');
    return true;
  }

  async migrateLegacyReportData(_userId: string) {
    // Next移植では互換目的で no-op
    return;
  }

  async cleanupHistoryByDate(targetDate: string | null, userId: string) {
    // 既存実装に合わせる: targetDate が指定されていればその日の履歴を削除
    if (!targetDate) {
      return { success: false, error: 'targetDate is required' };
    }
    await this._setDoc(userId, 'tasks', targetDate, null);
    return { success: true };
  }

  async createNewHistoryForDate(dateString: string, userId: string) {
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

  async addTaskToHistory(dateString: string, taskData: any, userId: string) {
    const existing = await this.loadHistoryByDate(dateString, userId);
    const tasks = existing.success ? (existing as any).data.tasks : [];

    const nowIso = new Date().toISOString();
    const newTask = {
      id: safeRandomId('task'),
      startTime: taskData?.startTime || this._getTimeForNowJST(),
      endTime: taskData?.endTime || '',
      name: taskData?.name || taskData?.title || '',
      tag: taskData?.tag || '',
      memo: typeof taskData?.memo === 'string' ? taskData.memo : '',
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

  async updateHistoryTask(dateString: string, taskId: string, taskName: string, startTime: string, endTime: string, tag: string | null, memo: string | undefined, userId: string) {
    const current = await this.loadHistoryByDate(dateString, userId);
    if (!(current as any).success) {
      return { success: false, message: '指定された日付の履歴が見つかりません' };
    }

    const tasks = (current as any).data.tasks;
    const idx = tasks.findIndex((t: any) => String(t.id) === String(taskId));
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
      memo: typeof memo === 'string' ? memo : (tasks[idx] as any)?.memo || '',
      updatedAt: nowIso,
    };

    await this._setDoc(userId, 'tasks', dateString, {
      date: dateString,
      tasks,
      updatedAt: nowIso,
    });

    return { success: true, task: tasks[idx] };
  }

  async deleteHistoryTask(dateString: string, taskId: string, userId: string) {
    const current = await this.loadHistoryByDate(dateString, userId);
    if (!(current as any).success) {
      return { success: false, message: '指定された日付の履歴が見つかりません' };
    }

    const tasks = (current as any).data.tasks;
    const idx = tasks.findIndex((t: any) => String(t.id) === String(taskId));
    if (idx === -1) {
      return { success: false, message: 'タスクが見つかりません' };
    }

    const [deleted] = tasks.splice(idx, 1);
    const nowIso = new Date().toISOString();
    await this._setDoc(userId, 'tasks', dateString, { date: dateString, tasks, updatedAt: nowIso });
    return { success: true, task: deleted };
  }

  async updateTask(taskId: string, taskName: string, startTime: string, endTime: string, tag: string | null, memo: string | undefined, userId: string) {
    const today = getTodayDateStringJST();
    const tasks = await this.loadSchedule(today, userId);
    const idx = tasks.findIndex((t: any) => String(t.id) === String(taskId));
    if (idx === -1) return null;

    const nowIso = new Date().toISOString();
    tasks[idx] = {
      ...tasks[idx],
      name: taskName,
      startTime,
      endTime: endTime || '',
      tag: tag || '',
      memo: typeof memo === 'string' ? memo : (tasks[idx] as any)?.memo || '',
      updatedAt: nowIso,
    };

    await this._saveSchedule(tasks, today, userId);
    return { task: tasks[idx] };
  }

  async deleteTask(taskId: string, userId: string) {
    const today = getTodayDateStringJST();
    const tasks = await this.loadSchedule(today, userId);
    const idx = tasks.findIndex((t: any) => String(t.id) === String(taskId));
    if (idx === -1) return null;

    const [deleted] = tasks.splice(idx, 1);
    await this._saveSchedule(tasks, today, userId);
    return deleted;
  }
}
