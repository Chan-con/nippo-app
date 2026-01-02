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
    await this._setDoc(userId, 'settings', 'default', settings || {});
    return true;
  }
}
