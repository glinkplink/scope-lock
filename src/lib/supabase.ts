import { createClient } from '@supabase/supabase-js';

const isVitest = import.meta.env.MODE === 'test' || import.meta.env.VITEST;
const supabaseUrl =
  import.meta.env.VITE_SUPABASE_URL ?? (isVitest ? 'https://example.supabase.co' : undefined);
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY ?? (isVitest ? 'test-anon-key' : undefined);

if (!supabaseUrl || !supabaseAnonKey) {
  throw new Error('Missing Supabase environment variables');
}

export const supabase = createClient(supabaseUrl, supabaseAnonKey);
