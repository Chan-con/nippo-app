import { jsonResponse, readJsonBody, withCors } from '../_lib/http.js';
import { getUserIdFromRequest } from '../_lib/supabase-auth.js';
import { SupabaseTaskManagerEdge } from '../_lib/supabase-task-manager-edge.js';

function bytesToBase64(bytes) {
  const chunkSize = 0x8000;
  let binary = '';
  for (let i = 0; i < bytes.length; i += chunkSize) {
    const chunk = bytes.subarray(i, i + chunkSize);
    binary += String.fromCharCode.apply(null, Array.from(chunk));
  }
  return btoa(binary);
}

function base64ToBytes(b64) {
  const bin = atob(String(b64 || ''));
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

async function getAesGcmKeyFromSecret(secret) {
  const enc = new TextEncoder();
  const digest = await crypto.subtle.digest('SHA-256', enc.encode(String(secret)));
  return await crypto.subtle.importKey('raw', digest, { name: 'AES-GCM' }, false, ['encrypt', 'decrypt']);
}

async function encryptStringAesGcm(plaintext, secret) {
  const key = await getAesGcmKeyFromSecret(secret);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const enc = new TextEncoder();
  const cipherBuf = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, enc.encode(String(plaintext)));
  const cipherBytes = new Uint8Array(cipherBuf);
  return { iv: bytesToBase64(iv), ciphertext: bytesToBase64(cipherBytes) };
}

async function decryptStringAesGcm(ivB64, cipherB64, secret) {
  const key = await getAesGcmKeyFromSecret(secret);
  const iv = base64ToBytes(ivB64);
  const cipherBytes = base64ToBytes(cipherB64);
  const plainBuf = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, cipherBytes);
  const dec = new TextDecoder();
  return dec.decode(plainBuf);
}

async function callOpenAiChat({ apiKey, messages, temperature = 0.3, maxTokens = 800 }) {
  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: 'gpt-5.2',
      messages,
      temperature,
      max_completion_tokens: maxTokens,
    }),
  });

  const data = await res.json().catch(() => null);
  if (!res.ok) {
    const msg = data?.error?.message || data?.error || 'OpenAI API error';
    throw new Error(msg);
  }
  const text = data?.choices?.[0]?.message?.content;
  return String(text || '');
}

function getParts(pathname) {
  return pathname.replace(/^\/api\/?/, '').split('/').filter(Boolean);
}

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

function isPrivateIpV4(hostname) {
  const m = String(hostname || '').match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (!m) return false;
  const parts = m.slice(1).map((v) => Number(v));
  if (parts.some((n) => Number.isNaN(n) || n < 0 || n > 255)) return false;
  const a = parts[0];
  const b = parts[1];
  if (a === 10) return true;
  if (a === 127) return true;
  if (a === 169 && b === 254) return true;
  if (a === 192 && b === 168) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  return false;
}

function isPrivateHostname(hostname) {
  const h = String(hostname || '').toLowerCase();
  if (!h) return true;
  if (h === 'localhost') return true;
  if (h.endsWith('.local')) return true;
  if (h === '::1') return true;
  if (h.startsWith('127.')) return true;
  if (isPrivateIpV4(h)) return true;
  // Rough IPv6 private checks
  if (h.startsWith('fc') || h.startsWith('fd')) return true; // fc00::/7
  if (h.startsWith('fe80:')) return true; // link-local
  return false;
}

function extractTitle(html) {
  const m = String(html || '').match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  if (!m) return '';
  return String(m[1] || '')
    .replace(/\s+/g, ' ')
    .trim();
}

function extractIconHref(html) {
  const patterns = [
    /<link[^>]*rel=["'][^"']*icon[^"']*["'][^>]*href=["']([^"']+)["'][^>]*>/i,
    /<link[^>]*href=["']([^"']+)["'][^>]*rel=["'][^"']*icon[^"']*["'][^>]*>/i,
    /<link[^>]*rel=["'][^"']*apple-touch-icon[^"']*["'][^>]*href=["']([^"']+)["'][^>]*>/i,
    /<link[^>]*href=["']([^"']+)["'][^>]*rel=["'][^"']*apple-touch-icon[^"']*["'][^>]*>/i,
  ];
  for (const re of patterns) {
    const m = String(html || '').match(re);
    if (m?.[1]) return String(m[1]).trim();
  }
  return '';
}

async function fetchWithRedirectLimit(startUrl, { maxRedirects = 6, headers = {} } = {}) {
  const visited = new Set();
  let current = String(startUrl);
  for (let i = 0; i <= maxRedirects; i++) {
    if (visited.has(current)) throw new Error('Too many redirects');
    visited.add(current);

    const res = await fetch(current, {
      method: 'GET',
      redirect: 'manual',
      headers,
    });

    if (res.status >= 300 && res.status < 400) {
      const loc = res.headers.get('location') || '';
      if (!loc) throw new Error('Redirect with no location');
      const next = new URL(loc, current);
      if (isPrivateHostname(next.hostname)) throw new Error('blocked hostname');
      current = next.toString();
      continue;
    }

    return { res, finalUrl: current };
  }
  throw new Error('Too many redirects');
}

const TASKLINE_GLOBAL_KEY = 'global';

const NOTES_GLOBAL_KEY = 'global';

const SHORTCUTS_GLOBAL_KEY = 'global';

const NOTICE_GLOBAL_KEY = 'global';

function normalizeNotice(input) {
  const obj = input && typeof input === 'object' ? input : {};
  const text = typeof obj?.text === 'string' ? String(obj.text) : '';
  const toneRaw = obj?.tone;
  const tone = toneRaw === 'info' || toneRaw === 'danger' || toneRaw === 'success' || toneRaw === 'warning' || toneRaw === 'default' ? toneRaw : 'default';
  const updatedAt = typeof obj?.updatedAt === 'string' ? String(obj.updatedAt) : '';
  return { text, tone, updatedAt };
}

function normalizeTaskLineCards(input) {
  const list = Array.isArray(input) ? input : [];
  const out = [];
  const isLane = (v) => v === 'mon' || v === 'tue' || v === 'wed' || v === 'thu' || v === 'fri' || v === 'sat' || v === 'sun' || v === 'stock';
  for (const item of list) {
    const id = typeof item?.id === 'string' ? String(item.id) : '';
    const text = typeof item?.text === 'string' ? String(item.text) : '';
    const color = typeof item?.color === 'string' ? String(item.color) : '';
    const laneRaw = item?.lane;
    const lane = isLane(laneRaw) ? laneRaw : 'stock';
    const orderRaw = item?.order;
    const order = typeof orderRaw === 'number' && Number.isFinite(orderRaw) ? orderRaw : null;
    if (!id) continue;
    out.push({ id, text, color, lane, order });
  }
  return out;
}

function normalizeNotes(input) {
  const list = Array.isArray(input) ? input : [];
  const out = [];
  for (const item of list) {
    const id = typeof item?.id === 'string' ? String(item.id) : '';
    const body = typeof item?.body === 'string' ? String(item.body) : '';
    const createdAt = typeof item?.createdAt === 'string' ? String(item.createdAt) : '';
    const updatedAt = typeof item?.updatedAt === 'string' ? String(item.updatedAt) : '';
    if (!id) continue;
    out.push({ id, body, createdAt, updatedAt });
  }
  return out;
}

function normalizeShortcuts(input) {
  const list = Array.isArray(input) ? input : [];
  const out = [];
  for (const item of list) {
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
    // URL metadata (title + favicon) for shortcut launcher
    if (parts.length === 1 && parts[0] === 'url-metadata' && request.method === 'GET') {
      const rawUrl = String(url.searchParams.get('url') || '').trim();
      if (!rawUrl) return jsonResponse({ success: false, error: 'url is required' }, 400);

      let target;
      try {
        target = new URL(rawUrl);
      } catch {
        return jsonResponse({ success: false, error: 'invalid url' }, 400);
      }

      if (target.protocol !== 'http:' && target.protocol !== 'https:') {
        return jsonResponse({ success: false, error: 'only http/https are allowed' }, 400);
      }
      if (isPrivateHostname(target.hostname)) {
        return jsonResponse({ success: false, error: 'blocked hostname' }, 400);
      }

      const fallback = {
        title: target.hostname,
        iconUrl: `${target.protocol}//${target.host}/favicon.ico`,
        finalUrl: target.toString(),
      };

      try {
        const { res, finalUrl } = await fetchWithRedirectLimit(target.toString(), {
          maxRedirects: 6,
          headers: {
            'user-agent': 'nippo-app/1.0 (+metadata-fetch)',
            accept: 'text/html,application/xhtml+xml',
          },
        });

        if (!res.ok) {
          return jsonResponse({ success: true, ...fallback, finalUrl, fetched: false });
        }

        const ct = (res.headers.get('content-type') || '').toLowerCase();
        if (!ct.includes('text/html') && !ct.includes('application/xhtml+xml')) {
          return jsonResponse({ success: true, ...fallback, finalUrl, fetched: false });
        }

        const MAX_BYTES = 200 * 1024;
        const buf = await res.arrayBuffer();
        const slice = buf.byteLength > MAX_BYTES ? buf.slice(0, MAX_BYTES) : buf;
        const html = new TextDecoder('utf-8').decode(slice);

        const title = extractTitle(html) || new URL(finalUrl).hostname;
        const iconHref = extractIconHref(html);
        let iconUrl = '';
        if (iconHref) {
          try {
            iconUrl = new URL(iconHref, finalUrl).toString();
          } catch {
            iconUrl = '';
          }
        }
        if (!iconUrl) {
          try {
            iconUrl = new URL('/favicon.ico', finalUrl).toString();
          } catch {
            iconUrl = fallback.iconUrl;
          }
        }

        return jsonResponse({ success: true, title, iconUrl, finalUrl, fetched: true });
      } catch (e) {
        // On redirect loops / auth redirects, return fallback without failing the UX.
        return jsonResponse({ success: true, ...fallback, fetched: false });
      }
    }

    // GPT API key (encrypted)
    if (parts.length === 1 && parts[0] === 'gpt-api-key' && request.method === 'GET') {
      const doc = await taskManager._getDoc(userId, 'gpt_api_key', 'default', null);
      const hasKey = !!(doc && typeof doc === 'object' && doc.iv && doc.ciphertext);
      const encryptionReady = !!env.GPT_API_KEY_ENCRYPTION_SECRET;
      return jsonResponse({ success: true, hasKey, encryptionReady });
    }

    if (parts.length === 1 && parts[0] === 'gpt-api-key' && request.method === 'POST') {
      const apiKey = String(body?.apiKey || '').trim();
      if (!apiKey) return jsonResponse({ success: false, error: 'APIキーが必要です' }, 400);

      const secret = env.GPT_API_KEY_ENCRYPTION_SECRET;
      if (!secret) return jsonResponse({ success: false, error: 'Missing env var: GPT_API_KEY_ENCRYPTION_SECRET' }, 500);

      const encrypted = await encryptStringAesGcm(apiKey, secret);
      await taskManager._setDoc(userId, 'gpt_api_key', 'default', {
        ...encrypted,
        updatedAt: new Date().toISOString(),
      });
      return jsonResponse({ success: true });
    }

    // GPT helpers
    if (parts.length === 2 && parts[0] === 'gpt' && parts[1] === 'report-from-timeline' && request.method === 'POST') {
      const secret = env.GPT_API_KEY_ENCRYPTION_SECRET;
      if (!secret) return jsonResponse({ success: false, error: 'Missing env var: GPT_API_KEY_ENCRYPTION_SECRET' }, 500);

      const doc = await taskManager._getDoc(userId, 'gpt_api_key', 'default', null);
      if (!doc?.iv || !doc?.ciphertext) return jsonResponse({ success: false, error: 'GPT APIキーが未設定です（設定から登録してください）' }, 400);

      const apiKey = await decryptStringAesGcm(doc.iv, doc.ciphertext, secret);
      if (!apiKey) return jsonResponse({ success: false, error: 'GPT APIキーの復号に失敗しました' }, 500);

      const tasks = Array.isArray(body?.tasks) ? body.tasks : [];
      const normalized = tasks
        .map((t) => ({
          name: String(t?.name || '').slice(0, 200),
          memo: String(t?.memo || '').slice(0, 1400),
        }))
        .filter((t) => String(t.memo || '').trim() !== '');

      const limited = normalized.slice(0, 80);
      if (limited.length === 0) {
        return jsonResponse({ success: false, error: 'メモがあるタスクがありません' }, 400);
      }

      const timeline = limited
        .map((t) => {
          const title = String(t.name || '').trim();
          const memo = String(t.memo || '').trim();
          if (!memo) return '';
          if (!title) return `【メモ】\n${memo}`;
          return `【${title}】\n${memo}`;
        })
        .filter(Boolean)
        .join('\n\n');

      const messages = [
        {
          role: 'system',
          content:
            'あなたは日本語の業務日報を作成するアシスタントです。入力(作業タイトル/メモ)のみを根拠に、社内向けの丁寧で簡潔な報告文を作成してください。誇張せず、事実ベースでまとめます。硬い言い回しは避け、です/ます調は維持しつつ、できるだけ平易でわかりやすい言葉を使います。',
        },
        {
          role: 'user',
          content:
            '次の入力から「報告内容」を作ってください。\n\n要件:\n- 日本語\n- 丁寧な文体(です/ます)\n- 文章は硬くしすぎない（自然でわかりやすい言葉を使う）\n- 難しい言い回し・過度にビジネスっぽい敬語・抽象語（例: 〜いたしました/〜させていただきました/推進/実施/対応 等）の多用は避ける\n- 箇条書きは使わず、読みやすい文章\n- 改行は段落区切りのみ（文の途中で不自然に改行しない）\n- 2〜4段落程度に収める（必要なら段落を分ける）\n- 作業時間・工数・時間帯など時間情報には一切触れない（推測もしない）\n- 対象期間・日付・複数日にわたる継続など、期間に関する言及は一切しない（推測もしない）\n- 入力に無い事実は追加しない\n- メモがあれば自然に文章へ反映する\n- 入力にタグ名やカテゴリ名（例: [xxx] や接頭辞）が含まれていても、タグごとに章立て・見出し分けはしない\n- 似た内容や同一趣旨の作業は、言い換えて繰り返さず可能な限り統合して一度だけ述べる（冗長な重複を避ける）\n\n入力（作業タイトル/メモ）:\n' + timeline,
        },
      ];

      const text = await callOpenAiChat({ apiKey, messages, temperature: 0.1, maxTokens: 900 });
      return jsonResponse({ success: true, text });
    }

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
      const memo = typeof body?.memo === 'string' ? body.memo : '';
      const taskUrl = typeof body?.url === 'string' ? body.url : '';

      if (!taskName) {
        return jsonResponse({ success: false, error: 'タスク名が必要です' }, 400);
      }

      const newTask = await taskManager.addTask(taskName, false, dateString, tag, startTime, userId, memo, taskUrl);
      return jsonResponse({ success: true, task: newTask, taskId: newTask.id });
    }

    if (request.method === 'POST' && parts.length === 2 && parts[0] === 'tasks' && parts[1] === 'reserve') {
      const taskName = String(body?.name || '').trim();
      const tag = body?.tag || null;
      const startTime = body?.startTime || null;
      const dateString = body?.dateString || null;
      const memo = typeof body?.memo === 'string' ? body.memo : '';
      const taskUrl = typeof body?.url === 'string' ? body.url : '';

      if (!taskName) {
        return jsonResponse({ success: false, error: 'タスク名が必要です' }, 400);
      }
      if (!startTime) {
        return jsonResponse({ success: false, error: '開始時間が必要です' }, 400);
      }

      if (dateString) {
        const ds = String(dateString);
        if (!/^\d{4}-\d{2}-\d{2}$/.test(ds)) {
          return jsonResponse({ success: false, error: '日付の形式が不正です' }, 400);
        }
        const today = new Date();
        const partsJst = today
          .toLocaleDateString('ja-JP', {
            year: 'numeric',
            month: '2-digit',
            day: '2-digit',
            timeZone: 'Asia/Tokyo',
          })
          .split('/');
        const todayJst = `${partsJst[0]}-${partsJst[1]}-${partsJst[2]}`;
        if (ds < todayJst) {
          return jsonResponse({ success: false, error: '過去の日付には予約できません' }, 400);
        }
      }

      const newReservation = await taskManager.addReservation(taskName, startTime, tag, dateString, userId, memo, taskUrl);
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
      const memo = typeof body?.memo === 'string' ? body.memo : undefined;
      const url = typeof body?.url === 'string' ? body.url : undefined;

      if (!taskName || !startTime) {
        return jsonResponse({ success: false, error: 'タスク名と開始時刻は必須です' }, 400);
      }

      const result = await taskManager.updateTask(taskId, taskName, startTime, endTime, tag, memo, url, userId);
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
      const memo = typeof body?.memo === 'string' ? body.memo : undefined;
      const url = typeof body?.url === 'string' ? body.url : undefined;

      if (!dateString || !/^\d{4}-\d{2}-\d{2}$/.test(dateString)) {
        return jsonResponse(
          { success: false, message: '無効な日付形式です。YYYY-MM-DD形式で指定してください。' },
          400
        );
      }
      if (!taskName || !startTime) {
        return jsonResponse({ success: false, error: 'タスク名と開始時刻は必須です' }, 400);
      }

      const result = await taskManager.updateHistoryTask(dateString, taskId, taskName, startTime, endTime, tag, memo, url, userId);
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

    // taskline (KANBAN-style sticky notes)
    if (parts.length === 1 && parts[0] === 'taskline' && request.method === 'GET') {
      const dateString = url.searchParams.get('dateString') || null;
      const dateKey = dateString || getTodayDateStringJST();
      if (dateString && dateString !== TASKLINE_GLOBAL_KEY && !/^\d{4}-\d{2}-\d{2}$/.test(dateString)) {
        return jsonResponse({ success: false, error: '無効な日付形式です。YYYY-MM-DD形式で指定してください。' }, 400);
      }

      const doc = await taskManager._getDoc(userId, 'taskline', dateKey, {
        date: dateKey,
        cards: [],
      });
      const cards = normalizeTaskLineCards(doc?.cards);
      return jsonResponse({ success: true, taskline: { date: dateKey, cards } });
    }

    if (parts.length === 1 && parts[0] === 'taskline' && request.method === 'POST') {
      const dateString = typeof body?.dateString === 'string' ? body.dateString : null;
      const dateKey = dateString || getTodayDateStringJST();
      if (dateString && dateString !== TASKLINE_GLOBAL_KEY && !/^\d{4}-\d{2}-\d{2}$/.test(dateString)) {
        return jsonResponse({ success: false, error: '無効な日付形式です。YYYY-MM-DD形式で指定してください。' }, 400);
      }

      const cards = normalizeTaskLineCards(body?.cards).slice(0, 200).map((c) => ({
        id: String(c.id).slice(0, 80),
        text: String(c.text || '').slice(0, 200),
        color: String(c.color || '').slice(0, 80),
        lane: String(c.lane || 'stock').slice(0, 16),
        order: typeof c.order === 'number' && Number.isFinite(c.order) ? c.order : null,
      }));

      await taskManager._setDoc(userId, 'taskline', dateKey, {
        date: dateKey,
        cards,
        updatedAt: new Date().toISOString(),
      });
      return jsonResponse({ success: true });
    }

    // notes (Keep-like sticky notes)
    if (parts.length === 1 && parts[0] === 'notes' && request.method === 'GET') {
      const doc = await taskManager._getDoc(userId, 'notes', NOTES_GLOBAL_KEY, {
        notes: [],
      });

      const notes = normalizeNotes(doc?.notes);
      return jsonResponse({ success: true, notes: { key: NOTES_GLOBAL_KEY, notes } });
    }

    if (parts.length === 1 && parts[0] === 'notes' && request.method === 'POST') {
      const notes = normalizeNotes(body?.notes)
        .map((n) => ({
          id: String(n.id).slice(0, 80),
          body: String(n.body || '').slice(0, 8000),
          createdAt: String(n.createdAt || '').slice(0, 64),
          updatedAt: String(n.updatedAt || '').slice(0, 64),
        }))
        // 削除は「本文を全消し」仕様なので、空はサーバー側でも落とす
        .filter((n) => String(n.body || '').trim() !== '')
        .slice(0, 600);

      await taskManager._setDoc(userId, 'notes', NOTES_GLOBAL_KEY, {
        key: NOTES_GLOBAL_KEY,
        notes,
        updatedAt: new Date().toISOString(),
      });

      return jsonResponse({ success: true });
    }

    // shortcuts (shortcut launcher)
    if (parts.length === 1 && parts[0] === 'shortcuts' && request.method === 'GET') {
      const doc = await taskManager._getDoc(userId, 'shortcuts', SHORTCUTS_GLOBAL_KEY, {
        items: [],
      });

      const items = normalizeShortcuts(doc?.items);
      const updatedAt = typeof doc?.updatedAt === 'string' ? String(doc.updatedAt) : '';
      return jsonResponse({ success: true, shortcuts: { key: SHORTCUTS_GLOBAL_KEY, items, updatedAt } });
    }

    if (parts.length === 1 && parts[0] === 'shortcuts' && request.method === 'POST') {
      const baseUpdatedAt = typeof body?.baseUpdatedAt === 'string' ? String(body.baseUpdatedAt) : '';

      const currentDoc = await taskManager._getDoc(userId, 'shortcuts', SHORTCUTS_GLOBAL_KEY, {
        items: [],
      });
      const currentUpdatedAt = typeof currentDoc?.updatedAt === 'string' ? String(currentDoc.updatedAt) : '';

      // Optimistic concurrency: if client thinks baseUpdatedAt but server differs, return conflict
      if (baseUpdatedAt && currentUpdatedAt && baseUpdatedAt !== currentUpdatedAt) {
        const serverItems = normalizeShortcuts(currentDoc?.items);
        return jsonResponse(
          {
            success: false,
            error: 'Conflict',
            conflict: true,
            shortcuts: { key: SHORTCUTS_GLOBAL_KEY, items: serverItems, updatedAt: currentUpdatedAt },
          },
          409
        );
      }

      const items = normalizeShortcuts(body?.items)
        .map((s) => ({
          id: String(s.id).slice(0, 80),
          url: String(s.url || '').slice(0, 2000),
          title: String(s.title || '').slice(0, 200),
          iconUrl: String(s.iconUrl || '').slice(0, 2000),
          createdAt: String(s.createdAt || '').slice(0, 64),
        }))
        .slice(0, 80);

      const updatedAt = new Date().toISOString();
      await taskManager._setDoc(userId, 'shortcuts', SHORTCUTS_GLOBAL_KEY, {
        key: SHORTCUTS_GLOBAL_KEY,
        items,
        updatedAt,
      });

      return jsonResponse({ success: true, updatedAt });
    }

    // notice (announcement)
    if (parts.length === 1 && parts[0] === 'notice' && request.method === 'GET') {
      const doc = await taskManager._getDoc(userId, 'notice', NOTICE_GLOBAL_KEY, {
        text: '',
        tone: 'default',
      });

      const n = normalizeNotice(doc);
      const updatedAt = typeof doc?.updatedAt === 'string' ? String(doc.updatedAt) : '';
      return jsonResponse({ success: true, notice: { key: NOTICE_GLOBAL_KEY, text: n.text, tone: n.tone, updatedAt } });
    }

    if (parts.length === 1 && parts[0] === 'notice' && request.method === 'POST') {
      const baseUpdatedAt = typeof body?.baseUpdatedAt === 'string' ? String(body.baseUpdatedAt) : '';

      const currentDoc = await taskManager._getDoc(userId, 'notice', NOTICE_GLOBAL_KEY, {
        text: '',
        tone: 'default',
      });
      const currentUpdatedAt = typeof currentDoc?.updatedAt === 'string' ? String(currentDoc.updatedAt) : '';

      if (baseUpdatedAt && currentUpdatedAt && baseUpdatedAt !== currentUpdatedAt) {
        const server = normalizeNotice(currentDoc);
        return jsonResponse(
          {
            success: false,
            error: 'Conflict',
            conflict: true,
            notice: { key: NOTICE_GLOBAL_KEY, text: server.text, tone: server.tone, updatedAt: currentUpdatedAt },
          },
          409
        );
      }

      const incoming = normalizeNotice(body?.notice);
      const text = String(incoming.text || '').slice(0, 8000);
      const tone = incoming.tone;

      const updatedAt = new Date().toISOString();
      await taskManager._setDoc(userId, 'notice', NOTICE_GLOBAL_KEY, {
        key: NOTICE_GLOBAL_KEY,
        text,
        tone,
        updatedAt,
      });

      return jsonResponse({ success: true, updatedAt });
    }

    // billing-summary
    if (parts.length === 1 && parts[0] === 'billing-summary' && request.method === 'GET') {
      const offset = parseInt(url.searchParams.get('offset') || '0', 10) || 0;
      const summary = await taskManager.computeBillingSummary(userId, { offset });
      return jsonResponse({ success: true, summary });
    }

    return jsonResponse({ success: false, error: 'Not Found' }, 404);
  } catch (error) {
    return jsonResponse({ success: false, error: error?.message || String(error) }, 500);
  }
}
