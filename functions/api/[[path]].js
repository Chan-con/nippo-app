import { jsonResponse, readJsonBody, withCors } from '../_lib/http.js';
import { getUserIdFromRequest } from '../_lib/supabase-auth.js';
import { SupabaseTaskManagerEdge } from '../_lib/supabase-task-manager-edge.js';

function getParts(pathname) {
  return pathname.replace(/^\/api\/?/, '').split('/').filter(Boolean);
}

export async function onRequest(context) {
  const { request, env } = context;
  const url = new URL(request.url);

  if (request.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: withCors() });
  }

  const pathname = url.pathname;

  // health はログイン不要
  if (pathname === '/api/health') {
    return jsonResponse({ status: 'healthy', timestamp: new Date().toISOString() });
  }

  const supabaseUrl = env.SUPABASE_URL;
  const anonKey = env.SUPABASE_ANON_KEY;
  const serviceRoleKey = env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !anonKey || !serviceRoleKey) {
    return jsonResponse(
      {
        success: false,
        error: 'Missing required env vars: SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY',
      },
      500
    );
  }

  // auth
  const auth = await getUserIdFromRequest(request, { supabaseUrl, anonKey });
  if (!auth.ok) {
    return jsonResponse(auth.body, auth.status);
  }

  const userId = auth.userId;
  const taskManager = new SupabaseTaskManagerEdge({ supabaseUrl, serviceRoleKey });

  const parts = getParts(pathname);
  const body = await readJsonBody(request);

  try {
    // /api/tasks
    if (request.method === 'GET' && parts.length === 1 && parts[0] === 'tasks') {
      const dateString = url.searchParams.get('dateString') || null;

      // 予約は「今日のみ」要件のため、今日の取得時だけ予約の期限到来を処理
      if (!dateString && typeof taskManager.processDueReservations === 'function') {
        try {
          await taskManager.processDueReservations(userId);
        } catch (e) {
          // 取得自体は継続（表示を壊さない）
          console.warn('processDueReservations failed (ignored):', e);
        }
      }

      const tasks = await taskManager.loadSchedule(dateString, userId);
      return jsonResponse({ success: true, tasks });
    }

    if (request.method === 'POST' && parts.length === 1 && parts[0] === 'tasks') {
      const taskName = String(body?.name || '').trim();
      const dateString = body?.dateString || null;
      const tag = body?.tag || null;
      const startTime = body?.startTime || null;

      if (!taskName) {
        return jsonResponse({ success: false, error: 'タスク名が必要です' }, 400);
      }

      const newTask = await taskManager.addTask(taskName, false, dateString, tag, startTime, userId);
      return jsonResponse({ success: true, task: newTask, taskId: newTask.id });
    }

    if (request.method === 'POST' && parts.length === 2 && parts[0] === 'tasks' && parts[1] === 'reserve') {
      const taskName = String(body?.name || '').trim();
      const tag = body?.tag || null;
      const startTime = body?.startTime || null;
      const dateString = body?.dateString || null;

      if (dateString) {
        return jsonResponse({ success: false, error: '予約は今日のみに対応しています' }, 400);
      }
      if (!taskName) {
        return jsonResponse({ success: false, error: 'タスク名が必要です' }, 400);
      }
      if (!startTime) {
        return jsonResponse({ success: false, error: '開始時間が必要です' }, 400);
      }

      const newReservation = await taskManager.addReservation(taskName, startTime, tag, userId);
      return jsonResponse({ success: true, task: newReservation, taskId: newReservation.id });
    }

    if (request.method === 'POST' && parts.length === 2 && parts[0] === 'tasks' && parts[1] === 'end') {
      const endedTask = await taskManager.endCurrentTask(null, userId);
      if (endedTask) return jsonResponse({ success: true, task: endedTask });
      return jsonResponse({ success: false, error: '終了するタスクがありません' }, 400);
    }

    if (request.method === 'POST' && parts.length === 2 && parts[0] === 'timeline' && parts[1] === 'copy') {
      const timelineText = await taskManager.getTimelineText(null, userId);
      if (timelineText) {
        return jsonResponse({ success: true, message: 'タイムラインをコピーしました' });
      }
      return jsonResponse({ success: false, error: 'コピーするデータがありません' }, 400);
    }

    if (request.method === 'POST' && parts.length === 2 && parts[0] === 'tasks' && parts[1] === 'clear') {
      const success = await taskManager.clearAllTasks(userId);
      if (success) return jsonResponse({ success: true, message: 'すべてのタスクをクリアしました' });
      return jsonResponse({ success: false, error: 'タスクのクリアに失敗しました' }, 500);
    }

    if (request.method === 'POST' && parts.length === 2 && parts[0] === 'timeline' && parts[1] === 'clear-all') {
      const success = await taskManager.clearAllTimelineData(userId);
      if (success) return jsonResponse({ success: true, message: 'すべてのタイムラインデータを削除しました' });
      return jsonResponse({ success: false, error: 'タイムラインデータの削除に失敗しました' }, 500);
    }

    // /api/tasks/:taskId
    if (parts.length === 2 && parts[0] === 'tasks' && request.method === 'PUT') {
      const taskId = parts[1];
      const taskName = String(body?.name || '').trim();
      const startTime = String(body?.startTime || '').trim();
      const endTime = String(body?.endTime || '').trim();
      const tag = body?.tag || null;

      if (!taskName || !startTime) {
        return jsonResponse({ success: false, error: 'タスク名と開始時刻は必須です' }, 400);
      }

      const result = await taskManager.updateTask(taskId, taskName, startTime, endTime, tag, userId);
      if (!result) return jsonResponse({ success: false, error: 'タスクが見つかりません' }, 404);
      return jsonResponse({ success: true, task: result.task });
    }

    if (parts.length === 2 && parts[0] === 'tasks' && request.method === 'DELETE') {
      const taskId = parts[1];
      const deletedTask = await taskManager.deleteTask(taskId, userId);
      if (!deletedTask) return jsonResponse({ success: false, error: 'タスクが見つかりません' }, 404);
      return jsonResponse({ success: true, task: deletedTask });
    }

    // history
    if (request.method === 'GET' && parts.length === 2 && parts[0] === 'history' && parts[1] === 'dates') {
      const result = await taskManager.getAllHistoryDates(userId);
      return jsonResponse(result);
    }

    if (parts.length === 2 && parts[0] === 'history' && request.method === 'GET') {
      const dateString = parts[1];
      const result = await taskManager.loadHistoryByDate(dateString, userId);
      return jsonResponse(result, result.success ? 200 : 404);
    }

    if (parts.length === 2 && parts[0] === 'history' && request.method === 'POST') {
      const dateString = parts[1];
      const result = await taskManager.updateHistoryByDate(dateString, body, userId);
      return jsonResponse(result, result.success ? 200 : 500);
    }

    if (parts.length === 3 && parts[0] === 'history' && parts[2] === 'create' && request.method === 'POST') {
      const dateString = parts[1];
      const result = await taskManager.createNewHistoryForDate(dateString, userId);
      return jsonResponse(result, result.success ? 200 : 400);
    }

    if (parts.length === 3 && parts[0] === 'history' && parts[2] === 'tasks' && request.method === 'POST') {
      const dateString = parts[1];
      if (!dateString || !/^\d{4}-\d{2}-\d{2}$/.test(dateString)) {
        return jsonResponse(
          { success: false, message: '無効な日付形式です。YYYY-MM-DD形式で指定してください。' },
          400
        );
      }
      const result = await taskManager.addTaskToHistory(dateString, body, userId);
      return jsonResponse(result, result.success ? 200 : 400);
    }

    if (parts.length === 4 && parts[0] === 'history' && parts[2] === 'tasks' && request.method === 'PUT') {
      const dateString = parts[1];
      const taskId = parts[3];
      const taskName = String(body?.name || '').trim();
      const startTime = String(body?.startTime || '').trim();
      const endTime = String(body?.endTime || '').trim();
      const tag = body?.tag || null;

      if (!dateString || !/^\d{4}-\d{2}-\d{2}$/.test(dateString)) {
        return jsonResponse(
          { success: false, message: '無効な日付形式です。YYYY-MM-DD形式で指定してください。' },
          400
        );
      }
      if (!taskName || !startTime) {
        return jsonResponse({ success: false, error: 'タスク名と開始時刻は必須です' }, 400);
      }

      const result = await taskManager.updateHistoryTask(dateString, taskId, taskName, startTime, endTime, tag, userId);
      return jsonResponse(result, result.success ? 200 : 400);
    }

    if (parts.length === 4 && parts[0] === 'history' && parts[2] === 'tasks' && request.method === 'DELETE') {
      const dateString = parts[1];
      const taskId = parts[3];
      const result = await taskManager.deleteHistoryTask(dateString, taskId, userId);
      return jsonResponse(result, result.success ? 200 : 404);
    }

    if (parts.length === 2 && parts[0] === 'history' && parts[1] === 'cleanup' && request.method === 'POST') {
      const targetDate = body?.targetDate;
      const result = await taskManager.cleanupHistoryByDate(targetDate, userId);
      return jsonResponse(result);
    }

    // report
    if (parts.length === 1 && parts[0] === 'report' && request.method === 'GET') {
      const content = await taskManager.loadReport(userId);
      return jsonResponse({ success: true, content });
    }

    if (parts.length === 1 && parts[0] === 'report' && request.method === 'POST') {
      const content = body?.content || '';
      const success = await taskManager.saveReport(content, userId);
      if (success) return jsonResponse({ success: true, message: '報告書を保存しました' });
      return jsonResponse({ success: false, error: '報告書の保存に失敗しました' }, 500);
    }

    // report urls
    if (parts.length === 1 && parts[0] === 'report-urls' && request.method === 'GET') {
      const urls = await taskManager.loadReportUrls(userId);
      return jsonResponse({ success: true, urls });
    }

    if (parts.length === 1 && parts[0] === 'report-urls' && request.method === 'POST') {
      const name = String(body?.name || '').trim();
      const link = String(body?.url || '').trim();
      if (!name || !link) {
        return jsonResponse({ success: false, error: '名前とURLは必須です' }, 400);
      }
      const newUrl = await taskManager.addReportUrl(name, link, userId);
      if (newUrl) return jsonResponse({ success: true, url: newUrl });
      return jsonResponse({ success: false, error: 'URLの追加に失敗しました' }, 500);
    }

    if (parts.length === 2 && parts[0] === 'report-urls' && request.method === 'DELETE') {
      const urlId = Number(parts[1]);
      const deletedUrl = await taskManager.deleteReportUrl(urlId, userId);
      if (!deletedUrl) return jsonResponse({ success: false, error: 'URLが見つかりません' }, 404);
      return jsonResponse({ success: true, url: deletedUrl });
    }

    // report tabs
    if (parts.length === 1 && parts[0] === 'report-tabs' && request.method === 'GET') {
      await taskManager.migrateLegacyReportData?.(userId);
      const tabData = await taskManager.loadReportTabs(userId);
      return jsonResponse({ success: true, tabs: tabData });
    }

    if (parts.length === 2 && parts[0] === 'report-tabs' && request.method === 'GET') {
      const tabId = parts[1];
      const content = await taskManager.getReportTabContent(tabId, userId);
      return jsonResponse({ success: true, content });
    }

    if (parts.length === 2 && parts[0] === 'report-tabs' && request.method === 'POST') {
      const tabId = parts[1];
      const content = body?.content || '';
      const success = await taskManager.saveReportTabContent(tabId, content, userId);
      if (success) return jsonResponse({ success: true, message: '報告内容を保存しました' });
      return jsonResponse({ success: false, error: '報告内容の保存に失敗しました' }, 500);
    }

    // open-url (Web版ではサーバー側で開けない)
    if (parts.length === 1 && parts[0] === 'open-url' && request.method === 'POST') {
      return jsonResponse({ success: true, message: 'Web版ではクライアントでURLを開きます' });
    }

    // goals
    if (parts.length === 1 && parts[0] === 'goals' && request.method === 'GET') {
      const goals = await taskManager.loadGoalStock(userId);
      return jsonResponse({ success: true, goals });
    }

    if (parts.length === 1 && parts[0] === 'goals' && request.method === 'POST') {
      await taskManager.saveGoalStock(body?.goals, userId);
      return jsonResponse({ success: true, message: 'Goal stock saved successfully' });
    }

    // task-stock
    if (parts.length === 1 && parts[0] === 'task-stock' && request.method === 'GET') {
      const tasks = await taskManager.loadTaskStock(userId);
      return jsonResponse({ success: true, tasks });
    }

    if (parts.length === 1 && parts[0] === 'task-stock' && request.method === 'POST') {
      await taskManager.saveTaskStock(body?.tasks, userId);
      return jsonResponse({ success: true, message: 'Task stock saved successfully' });
    }

    // tags
    if (parts.length === 1 && parts[0] === 'tags' && request.method === 'GET') {
      const tags = await taskManager.loadTagStock(userId);
      return jsonResponse({ success: true, tags });
    }

    if (parts.length === 1 && parts[0] === 'tags' && request.method === 'POST') {
      await taskManager.saveTagStock(body?.tags, userId);
      return jsonResponse({ success: true, message: 'Tag stock saved successfully' });
    }

    // settings
    if (parts.length === 1 && parts[0] === 'settings' && request.method === 'GET') {
      const settings = await taskManager.loadSettings(userId);
      return jsonResponse({ success: true, settings });
    }

    if (parts.length === 1 && parts[0] === 'settings' && request.method === 'POST') {
      const ok = await taskManager.saveSettings(body?.settings, userId);
      return jsonResponse({ success: !!ok });
    }

    // holiday-calendar
    if (parts.length === 1 && parts[0] === 'holiday-calendar' && request.method === 'GET') {
      const calendar = await taskManager.loadHolidayCalendar(userId);
      return jsonResponse({ success: true, calendar });
    }

    if (parts.length === 1 && parts[0] === 'holiday-calendar' && request.method === 'POST') {
      const month = typeof body?.month === 'string' ? body.month : null;
      const holidays = Array.isArray(body?.holidays) ? body.holidays : [];
      await taskManager.saveHolidayCalendar({ month, holidays }, userId);
      return jsonResponse({ success: true });
    }

    return jsonResponse({ success: false, error: 'Not Found' }, 404);
  } catch (error) {
    return jsonResponse({ success: false, error: error?.message || String(error) }, 500);
  }
}
