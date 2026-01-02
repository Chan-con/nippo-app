require('dotenv').config();

process.on('uncaughtException', (err) => {
  console.error('[web-server] uncaughtException:', err);
  process.exitCode = 1;
});

process.on('unhandledRejection', (reason) => {
  console.error('[web-server] unhandledRejection:', reason);
  process.exitCode = 1;
});

process.on('exit', (code) => {
  console.log(`[web-server] exit code=${code}`);
});

const path = require('path');
const express = require('express');
const { createApp } = require('./backend/task-manager');
const {
  SupabaseTaskManager,
  createSupabaseAuthMiddleware,
} = require('./backend/supabase-task-manager');

const PORT = Number(process.env.PORT || 3000);
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SUPABASE_ANON_KEY || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error('Missing required env vars: SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY');
  process.exit(1);
}

const taskManager = new SupabaseTaskManager({
  supabaseUrl: SUPABASE_URL,
  serviceRoleKey: SUPABASE_SERVICE_ROLE_KEY,
});

const authMiddleware = createSupabaseAuthMiddleware({
  supabaseUrl: SUPABASE_URL,
  anonKey: SUPABASE_ANON_KEY,
});

const rendererDir = path.join(__dirname, 'renderer');

const { app } = createApp(taskManager, {
  beforeRoutes: (app) => {
    // ヘルスチェックはログイン不要
    app.get('/api/health', (req, res) => {
      res.json({ status: 'healthy', timestamp: new Date().toISOString() });
    });

    // 静的配信（先に登録しても /api は後続ルートに流れる）
    // Cloudflare Pages Functions互換で /env を提供（旧: /env.js も互換のため残す）
    const sendEnv = (res) => {
      res.type('application/javascript');
      res.set('Cache-Control', 'no-store');
      res.send(
        `window.__ENV = window.__ENV || {};\n` +
          `window.__ENV.SUPABASE_URL = ${JSON.stringify(SUPABASE_URL)};\n` +
          `window.__ENV.SUPABASE_ANON_KEY = ${JSON.stringify(SUPABASE_ANON_KEY)};\n`
      );
    };

    app.get('/env', (req, res) => sendEnv(res));
    app.get('/env.js', (req, res) => sendEnv(res));

    app.use(express.static(rendererDir));

    // APIはログイン必須
    app.use('/api', authMiddleware);

    // ルートはindex.html
    app.get('/', (req, res) => {
      res.sendFile(path.join(rendererDir, 'index.html'));
    });
  },
});

app.listen(PORT, () => {
  console.log(`Web server listening on http://localhost:${PORT}`);
});
