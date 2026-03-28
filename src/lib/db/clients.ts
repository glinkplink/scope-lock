import { supabase } from '../supabase';
import type { Client } from '../../types/db';

/** Escape `%`, `_`, and `\` for use inside a Postgres ILIKE pattern (default escape `\`). */
function escapeIlikePattern(fragment: string): string {
  return fragment.replace(/\\/g, '\\\\').replace(/%/g, '\\%').replace(/_/g, '\\_');
}

function normalizeClientSearchFragment(value: string): string {
  return value.trim().replace(/\s+/g, ' ');
}

export interface ClientSearchQuery {
  firstName?: string;
  lastName?: string;
}

/**
 * Case-insensitive contains match on `clients.name`, scoped to the user.
 * Returns a broad candidate set for the caller to rank client-side.
 */
export const searchClients = async (
  userId: string,
  query: ClientSearchQuery
): Promise<Client[]> => {
  const firstName = normalizeClientSearchFragment(query.firstName ?? '');
  const lastName = normalizeClientSearchFragment(query.lastName ?? '');
  const terms = Array.from(new Set([firstName, lastName].filter(Boolean)));
  if (terms.length === 0) {
    return [];
  }

  let builder = supabase.from('clients').select('*').eq('user_id', userId);
  if (terms.length === 1) {
    builder = builder.ilike('name', `%${escapeIlikePattern(terms[0])}%`);
  } else {
    builder = builder.or(
      terms.map((term) => `name.ilike.%${escapeIlikePattern(term)}%`).join(',')
    );
  }

  const { data, error } = await builder
    .order('name', { ascending: true })
    .limit(50);

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
