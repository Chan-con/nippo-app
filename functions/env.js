import { javascriptResponse } from './_lib/http.js';

export async function onRequest({ env }) {
  const supabaseUrl = env.SUPABASE_URL || '';
  const anonKey = env.SUPABASE_ANON_KEY || '';

  if (!supabaseUrl || !anonKey) {
    return javascriptResponse(
      `console.error('Missing SUPABASE_URL or SUPABASE_ANON_KEY');\nwindow.__ENV = window.__ENV || {};\n`,
      500,
      { 'Cache-Control': 'no-store' }
    );
  }

  const body =
    `window.__ENV = window.__ENV || {};\n` +
    `window.__ENV.SUPABASE_URL = ${JSON.stringify(supabaseUrl)};\n` +
    `window.__ENV.SUPABASE_ANON_KEY = ${JSON.stringify(anonKey)};\n`;

  return javascriptResponse(body, 200, { 'Cache-Control': 'no-store' });
}
