import { createClient } from '@supabase/supabase-js';

export type AuthResult =
  | { ok: true; userId: string }
  | { ok: false; status: number; body: unknown };

export async function getUserIdFromRequest(
  request: Request,
  opts: { supabaseUrl: string; anonKey: string }
): Promise<AuthResult> {
  const header = request.headers.get('Authorization') || '';
  const match = header.match(/^Bearer\s+(.+)$/i);
  if (!match) {
    return { ok: false, status: 401, body: { success: false, error: 'Unauthorized' } };
  }

  const token = match[1];

  const client = createClient(opts.supabaseUrl, opts.anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { Authorization: `Bearer ${token}` } },
  });

  const { data, error } = await client.auth.getUser();
  if (error || !data?.user?.id) {
    return { ok: false, status: 401, body: { success: false, error: 'Invalid token' } };
  }

  return { ok: true, userId: data.user.id };
}
