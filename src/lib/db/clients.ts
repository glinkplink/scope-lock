import { supabase } from '../supabase';
import type { Client } from '../../types/db';

/** Escape `%`, `_`, and `\` for use inside a Postgres ILIKE pattern (default escape `\`). */
function escapeIlikePattern(fragment: string): string {
  return fragment.replace(/\\/g, '\\\\').replace(/%/g, '\\%').replace(/_/g, '\\_');
}

/**
 * Case-insensitive contains match on `clients.name`, scoped to the user.
 */
export const searchClients = async (userId: string, query: string): Promise<Client[]> => {
  const trimmed = query.trim();
  if (!trimmed) {
    return [];
  }

  const pattern = `%${escapeIlikePattern(trimmed)}%`;

  const { data, error } = await supabase
    .from('clients')
    .select('*')
    .eq('user_id', userId)
    .ilike('name', pattern)
    .order('name', { ascending: true })
    .limit(15);

  if (error) {
    console.error('Error searching clients:', error);
    return [];
  }

  return data ?? [];
};

export const listClients = async (userId: string): Promise<Client[]> => {
  const { data, error } = await supabase
    .from('clients')
    .select('*')
    .eq('user_id', userId)
    .order('created_at', { ascending: false });

  if (error) {
    console.error('Error listing clients:', error);
    return [];
  }

  return data;
};

export const upsertClient = async (client: Partial<Client> & { user_id: string }) => {
  const { data, error } = await supabase
    .from('clients')
    .upsert(client)
    .select()
    .single();

  return { data, error };
};

export const deleteClient = async (id: string) => {
  const { error } = await supabase.from('clients').delete().eq('id', id);

  return { error };
};
