import { supabase } from './supabase';

/** Same-origin fetch with `Authorization: Bearer` from the current Supabase session. */
export async function fetchWithSupabaseAuth(
  input: string,
  init: RequestInit = {}
): Promise<Response> {
  const { data, error } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  if (error || !token) {
    throw new Error('You must be signed in to perform this action.');
  }
  const headers = new Headers(init.headers);
  headers.set('Authorization', `Bearer ${token}`);
  if (!headers.has('Content-Type') && init.body != null) {
    headers.set('Content-Type', 'application/json');
  }
  return fetch(input, { ...init, headers });
}
