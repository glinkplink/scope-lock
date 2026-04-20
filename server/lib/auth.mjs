import { createClient } from '@supabase/supabase-js';

function env(name) {
  const value = process.env[name];
  return value != null && String(value).trim() !== '' ? String(value).trim() : '';
}

function getBearerToken(req) {
  const auth = req.headers.authorization;
  if (!auth || !auth.startsWith('Bearer ')) return null;
  const t = auth.slice(7).trim();
  return t || null;
}

/**
 * Validate Authorization Bearer against Supabase (service role).
 * @returns {Promise<{ ok: true, userId: string } | { ok: false, status: number, error: string }>}
 */
export async function verifyBearerUser(req) {
  const token = getBearerToken(req);
  if (!token) {
    return { ok: false, status: 401, error: 'Missing authorization' };
  }
  const supabaseUrl = env('SUPABASE_URL');
  const supabaseKey = env('SUPABASE_SERVICE_ROLE_KEY');
  if (!supabaseUrl || !supabaseKey) {
    return { ok: false, status: 503, error: 'Server authentication is not configured.' };
  }
  const supabase = createClient(supabaseUrl, supabaseKey);
  const { data: userData, error: userErr } = await supabase.auth.getUser(token);
  if (userErr || !userData?.user?.id) {
    return { ok: false, status: 401, error: 'Invalid session' };
  }
  return { ok: true, userId: userData.user.id };
}
