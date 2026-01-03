import { SupabaseTaskManager } from '../../../src/lib/supabaseTaskManager';
import { getUserIdFromRequest } from '../../../src/lib/supabaseAuth';
import { corsHeaders, json } from '../../../src/lib/responses';

function getParts(pathname: string) {
  return pathname.replace(/^\/api\/?/, '').split('/').filter(Boolean);
}

async function readJsonBody(request: Request) {
  const contentType = request.headers.get('content-type') || '';
  if (!contentType.toLowerCase().includes('application/json')) {
    return null;
  }
  try {
    return await request.json();
  } catch {
    return null;
  }
}

export async function OPTIONS() {
  return new Response(null, { status: 204, headers: corsHeaders() });
}

async function handle(request: Request) {
  const url = new URL(request.url);
  const pathname = url.pathname;

  if (pathname === '/api/health') {
    return json(
      { status: 'healthy', timestamp: new Date().toISOString() },
      { status: 200, headers: corsHeaders() }
    );
  }

  const supabaseUrl = process.env.SUPABASE_URL;
  const anonKey = process.env.SUPABASE_ANON_KEY;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !anonKey || !serviceRoleKey) {
    return json(
      {
        success: false,
        error: 'Missing required env vars: SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY',
      },
      { status: 500, headers: corsHeaders() }
    );
  }

  const auth = await getUserIdFromRequest(request, { supabaseUrl, anonKey });
  if (!auth.ok) {
    return json(auth.body, { status: auth.status, headers: corsHeaders() });
  }

  const userId = auth.userId;
  const taskManager = new SupabaseTaskManager({ supabaseUrl, serviceRoleKey });
  const parts = getParts(pathname);
  const body = await readJsonBody(request);

  try {
    // /api/tasks
    if (request.method === 'GET' && parts.length === 1 && parts[0] === 'tasks') {
      const dateString = url.searchParams.get('dateString') || null;
      if (!dateString && typeof (taskManager as any).processDueReservations === 'function') {
        try {
          await (taskManager as any).processDueReservations(userId);
        } catch {
          // ignore
        }
      }
      const tasks = await taskManager.loadSchedule(dateString, userId);
      return json({ success: true, tasks }, { status: 200, headers: corsHeaders() });
    }

    if (request.method === 'POST' && parts.length === 1 && parts[0] === 'tasks') {
      const taskName = String(body?.name || '').trim();
      const dateString = body?.dateString || null;
      const tag = body?.tag || null;
      const startTime = body?.startTime || null;

      if (!taskName) {
        return json({ success: false, error: 'タスク名が必要です' }, { status: 400, headers: corsHeaders() });
      }

      const newTask = await taskManager.addTask(taskName, false, dateString, tag, startTime, userId);
      return json({ success: true, task: newTask, taskId: (newTask as any).id }, { status: 200, headers: corsHeaders() });
    }

    if (request.method === 'POST' && parts.length === 2 && parts[0] === 'tasks' && parts[1] === 'reserve') {
      const taskName = String(body?.name || '').trim();
      const tag = body?.tag || null;
      const startTime = body?.startTime || null;
      const dateString = body?.dateString || null;

      if (dateString) {
        return json({ success: false, error: '予約は今日のみに対応しています' }, { status: 400, headers: corsHeaders() });
      }
      if (!taskName) {
        return json({ success: false, error: 'タスク名が必要です' }, { status: 400, headers: corsHeaders() });
      }
      if (!startTime) {
        return json({ success: false, error: '開始時間が必要です' }, { status: 400, headers: corsHeaders() });
      }

      const newReservation = await taskManager.addReservation(taskName, startTime, tag, userId);
      return json(
        { success: true, task: newReservation, taskId: (newReservation as any).id },
        { status: 200, headers: corsHeaders() }
      );
    }

    if (request.method === 'POST' && parts.length === 2 && parts[0] === 'tasks' && parts[1] === 'end') {
      const endedTask = await taskManager.endCurrentTask(null, userId);
      if (endedTask) return json({ success: true, task: endedTask }, { status: 200, headers: corsHeaders() });
      return json({ success: false, error: '終了するタスクがありません' }, { status: 400, headers: corsHeaders() });
    }

    if (request.method === 'POST' && parts.length === 2 && parts[0] === 'tasks' && parts[1] === 'clear') {
      const success = await taskManager.clearAllTasks(userId);
      if (success) return json({ success: true, message: 'すべてのタスクをクリアしました' }, { status: 200, headers: corsHeaders() });
      return json({ success: false, error: 'タスクのクリアに失敗しました' }, { status: 500, headers: corsHeaders() });
    }

    // timeline
    if (request.method === 'POST' && parts.length === 2 && parts[0] === 'timeline' && parts[1] === 'copy') {
      const timelineText = await taskManager.getTimelineText(null, userId);
      if (timelineText) {
        return json({ success: true, message: 'タイムラインをコピーしました' }, { status: 200, headers: corsHeaders() });
      }
      return json({ success: false, error: 'コピーするデータがありません' }, { status: 400, headers: corsHeaders() });
    }

    if (request.method === 'POST' && parts.length === 2 && parts[0] === 'timeline' && parts[1] === 'clear-all') {
      const success = await taskManager.clearAllTimelineData(userId);
      if (success) return json({ success: true, message: 'すべてのタイムラインデータを削除しました' }, { status: 200, headers: corsHeaders() });
      return json({ success: false, error: 'タイムラインデータの削除に失敗しました' }, { status: 500, headers: corsHeaders() });
    }

    // /api/tasks/:taskId
    if (parts.length === 2 && parts[0] === 'tasks' && request.method === 'PUT') {
      const taskId = parts[1];
      const taskName = String(body?.name || '').trim();
      const startTime = String(body?.startTime || '').trim();
      const endTime = String(body?.endTime || '').trim();
      const tag = body?.tag || null;

      if (!taskName || !startTime) {
        return json({ success: false, error: 'タスク名と開始時刻は必須です' }, { status: 400, headers: corsHeaders() });
      }

      const result = await taskManager.updateTask(taskId, taskName, startTime, endTime, tag, userId);
      if (!result) return json({ success: false, error: 'タスクが見つかりません' }, { status: 404, headers: corsHeaders() });
      return json({ success: true, task: (result as any).task }, { status: 200, headers: corsHeaders() });
    }

    if (parts.length === 2 && parts[0] === 'tasks' && request.method === 'DELETE') {
      const taskId = parts[1];
      const deletedTask = await taskManager.deleteTask(taskId, userId);
      if (!deletedTask) return json({ success: false, error: 'タスクが見つかりません' }, { status: 404, headers: corsHeaders() });
      return json({ success: true, task: deletedTask }, { status: 200, headers: corsHeaders() });
    }

    // history
    if (request.method === 'GET' && parts.length === 2 && parts[0] === 'history' && parts[1] === 'dates') {
      const result = await taskManager.getAllHistoryDates(userId);
      return json(result, { status: 200, headers: corsHeaders() });
    }

    if (parts.length === 2 && parts[0] === 'history' && request.method === 'GET') {
      const dateString = parts[1];
      const result = await taskManager.loadHistoryByDate(dateString, userId);
      return json(result, { status: (result as any).success ? 200 : 404, headers: corsHeaders() });
    }

    if (parts.length === 2 && parts[0] === 'history' && request.method === 'POST') {
      const dateString = parts[1];
      const result = await taskManager.updateHistoryByDate(dateString, body, userId);
      return json(result, { status: (result as any).success ? 200 : 500, headers: corsHeaders() });
    }

    if (parts.length === 3 && parts[0] === 'history' && parts[2] === 'create' && request.method === 'POST') {
      const dateString = parts[1];
      const result = await taskManager.createNewHistoryForDate(dateString, userId);
      return json(result, { status: (result as any).success ? 200 : 400, headers: corsHeaders() });
    }

    if (parts.length === 3 && parts[0] === 'history' && parts[2] === 'tasks' && request.method === 'POST') {
      const dateString = parts[1];
      if (!dateString || !/^\d{4}-\d{2}-\d{2}$/.test(dateString)) {
        return json(
          { success: false, message: '無効な日付形式です。YYYY-MM-DD形式で指定してください。' },
          { status: 400, headers: corsHeaders() }
        );
      }
      const result = await taskManager.addTaskToHistory(dateString, body, userId);
      return json(result, { status: (result as any).success ? 200 : 400, headers: corsHeaders() });
    }

    if (parts.length === 4 && parts[0] === 'history' && parts[2] === 'tasks' && request.method === 'PUT') {
      const dateString = parts[1];
      const taskId = parts[3];
      const taskName = String(body?.name || '').trim();
      const startTime = String(body?.startTime || '').trim();
      const endTime = String(body?.endTime || '').trim();
      const tag = body?.tag || null;

      if (!dateString || !/^\d{4}-\d{2}-\d{2}$/.test(dateString)) {
        return json(
          { success: false, message: '無効な日付形式です。YYYY-MM-DD形式で指定してください。' },
          { status: 400, headers: corsHeaders() }
        );
      }
      if (!taskName || !startTime) {
        return json({ success: false, error: 'タスク名と開始時刻は必須です' }, { status: 400, headers: corsHeaders() });
      }

      const result = await taskManager.updateHistoryTask(dateString, taskId, taskName, startTime, endTime, tag, userId);
      return json(result, { status: (result as any).success ? 200 : 400, headers: corsHeaders() });
    }

    if (parts.length === 4 && parts[0] === 'history' && parts[2] === 'tasks' && request.method === 'DELETE') {
      const dateString = parts[1];
      const taskId = parts[3];
      const result = await taskManager.deleteHistoryTask(dateString, taskId, userId);
      return json(result, { status: (result as any).success ? 200 : 404, headers: corsHeaders() });
    }

    if (parts.length === 2 && parts[0] === 'history' && parts[1] === 'cleanup' && request.method === 'POST') {
      const targetDate = body?.targetDate || null;
      const result = await (taskManager as any).cleanupHistoryByDate(targetDate, userId);
      return json(result, { status: 200, headers: corsHeaders() });
    }

    // report
    if (parts.length === 1 && parts[0] === 'report' && request.method === 'GET') {
      const content = await taskManager.loadReport(userId);
      return json({ success: true, content }, { status: 200, headers: corsHeaders() });
    }

    if (parts.length === 1 && parts[0] === 'report' && request.method === 'POST') {
      const content = body?.content || '';
      const success = await taskManager.saveReport(content, userId);
      if (success) return json({ success: true, message: '報告書を保存しました' }, { status: 200, headers: corsHeaders() });
      return json({ success: false, error: '報告書の保存に失敗しました' }, { status: 500, headers: corsHeaders() });
    }

    // report urls
    if (parts.length === 1 && parts[0] === 'report-urls' && request.method === 'GET') {
      const urls = await taskManager.loadReportUrls(userId);
      return json({ success: true, urls }, { status: 200, headers: corsHeaders() });
    }

    if (parts.length === 1 && parts[0] === 'report-urls' && request.method === 'POST') {
      const name = String(body?.name || '').trim();
      const link = String(body?.url || '').trim();
      if (!name || !link) {
        return json({ success: false, error: '名前とURLは必須です' }, { status: 400, headers: corsHeaders() });
      }
      const newUrl = await taskManager.addReportUrl(name, link, userId);
      if (newUrl) return json({ success: true, url: newUrl }, { status: 200, headers: corsHeaders() });
      return json({ success: false, error: 'URLの追加に失敗しました' }, { status: 500, headers: corsHeaders() });
    }

    if (parts.length === 2 && parts[0] === 'report-urls' && request.method === 'DELETE') {
      const urlId = Number(parts[1]);
      const deletedUrl = await taskManager.deleteReportUrl(urlId, userId);
      if (!deletedUrl) return json({ success: false, error: 'URLが見つかりません' }, { status: 404, headers: corsHeaders() });
      return json({ success: true, url: deletedUrl }, { status: 200, headers: corsHeaders() });
    }

    // report tabs
    if (parts.length === 1 && parts[0] === 'report-tabs' && request.method === 'GET') {
      await (taskManager as any).migrateLegacyReportData?.(userId);
      const tabData = await taskManager.loadReportTabs(userId);
      return json({ success: true, tabs: tabData }, { status: 200, headers: corsHeaders() });
    }

    if (parts.length === 2 && parts[0] === 'report-tabs' && request.method === 'GET') {
      const tabId = parts[1];
      const content = await taskManager.getReportTabContent(tabId, userId);
      return json({ success: true, content }, { status: 200, headers: corsHeaders() });
    }

    if (parts.length === 2 && parts[0] === 'report-tabs' && request.method === 'POST') {
      const tabId = parts[1];
      const content = body?.content || '';
      const success = await taskManager.saveReportTabContent(tabId, content, userId);
      if (success) return json({ success: true, message: '報告内容を保存しました' }, { status: 200, headers: corsHeaders() });
      return json({ success: false, error: '報告内容の保存に失敗しました' }, { status: 500, headers: corsHeaders() });
    }

    // open-url (Web版ではサーバー側で開けない)
    if (parts.length === 1 && parts[0] === 'open-url' && request.method === 'POST') {
      return json({ success: true, message: 'Web版ではクライアントでURLを開きます' }, { status: 200, headers: corsHeaders() });
    }

    // goals
    if (parts.length === 1 && parts[0] === 'goals' && request.method === 'GET') {
      const goals = await taskManager.loadGoalStock(userId);
      return json({ success: true, goals }, { status: 200, headers: corsHeaders() });
    }

    if (parts.length === 1 && parts[0] === 'goals' && request.method === 'POST') {
      await taskManager.saveGoalStock(body?.goals, userId);
      return json({ success: true, message: 'Goal stock saved successfully' }, { status: 200, headers: corsHeaders() });
    }

    // task-stock
    if (parts.length === 1 && parts[0] === 'task-stock' && request.method === 'GET') {
      const tasks = await taskManager.loadTaskStock(userId);
      return json({ success: true, tasks }, { status: 200, headers: corsHeaders() });
    }

    if (parts.length === 1 && parts[0] === 'task-stock' && request.method === 'POST') {
      await taskManager.saveTaskStock(body?.tasks, userId);
      return json({ success: true, message: 'Task stock saved successfully' }, { status: 200, headers: corsHeaders() });
    }

    // tags
    if (parts.length === 1 && parts[0] === 'tags' && request.method === 'GET') {
      const tags = await taskManager.loadTagStock(userId);
      return json({ success: true, tags }, { status: 200, headers: corsHeaders() });
    }

    if (parts.length === 1 && parts[0] === 'tags' && request.method === 'POST') {
      await taskManager.saveTagStock(body?.tags, userId);
      return json({ success: true, message: 'Tag stock saved successfully' }, { status: 200, headers: corsHeaders() });
    }

    // settings
    if (parts.length === 1 && parts[0] === 'settings' && request.method === 'GET') {
      const settings = await taskManager.loadSettings(userId);
      return json({ success: true, settings }, { status: 200, headers: corsHeaders() });
    }

    if (parts.length === 1 && parts[0] === 'settings' && request.method === 'POST') {
      const ok = await taskManager.saveSettings(body?.settings, userId);
      return json({ success: !!ok }, { status: 200, headers: corsHeaders() });
    }

    return json({ success: false, error: 'Not Found' }, { status: 404, headers: corsHeaders() });
  } catch (error: any) {
    return json({ success: false, error: error?.message || String(error) }, { status: 500, headers: corsHeaders() });
  }
}

export async function GET(request: Request) {
  return handle(request);
}
export async function POST(request: Request) {
  return handle(request);
}
export async function PUT(request: Request) {
  return handle(request);
}
export async function DELETE(request: Request) {
  return handle(request);
}
