import { createClient } from '@supabase/supabase-js';

export async function getUserIdFromRequest(request, { supabaseUrl, anonKey }) {
  const header = request.headers.get('Authorization') || '';
  const match = header.match(/^Bearer\s+(.+)$/i);
  if (!match) {
    return { ok: false, status: 401, body: { success: false, error: 'Unauthorized' } };
  }

  const token = match[1];

  const client = createClient(supabaseUrl, anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { Authorization: `Bearer ${token}` } },
  });

  const { data, error } = await client.auth.getUser();
  if (error || !data?.user?.id) {
    return { ok: false, status: 401, body: { success: false, error: 'Invalid token' } };
  }

  return { ok: true, userId: data.user.id };
}
