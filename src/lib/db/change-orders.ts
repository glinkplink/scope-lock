import { supabase } from '../supabase';
import type { ChangeOrder, ChangeOrderLineItem } from '../../types/db';

export function computeCOTotal(lineItems: ChangeOrderLineItem[]): number {
  return (
    Math.round(lineItems.reduce((sum, item) => sum + item.quantity * item.unit_rate, 0) * 100) / 100
  );
}

function mapLineItem(raw: Record<string, unknown>): ChangeOrderLineItem {
  return {
    id: String(raw.id ?? ''),
    description: String(raw.description ?? ''),
    quantity: Number(raw.quantity) || 0,
    unit_rate: Number(raw.unit_rate) || 0,
  };
}

function mapChangeOrderRow(data: Record<string, unknown>): ChangeOrder {
  const li = Array.isArray(data.line_items) ? data.line_items : [];
  return {
    id: data.id as string,
    user_id: data.user_id as string,
    job_id: data.job_id as string,
    co_number: Number(data.co_number),
    description: String(data.description ?? ''),
    reason: String(data.reason ?? ''),
    status: data.status as ChangeOrder['status'],
    requires_approval: Boolean(data.requires_approval),
    line_items: li.map((x) => mapLineItem(x as Record<string, unknown>)),
    time_amount: Number(data.time_amount) || 0,
    time_unit: (data.time_unit === 'hours' ? 'hours' : 'days') as ChangeOrder['time_unit'],
    time_note: String(data.time_note ?? ''),
    created_at: String(data.created_at ?? ''),
    updated_at: String(data.updated_at ?? ''),
  };
}

export async function listChangeOrders(jobId: string): Promise<ChangeOrder[]> {
  const { data, error } = await supabase
    .from('change_orders')
    .select('*')
    .eq('job_id', jobId)
    .order('co_number', { ascending: true });

  if (error) {
    console.error('listChangeOrders:', error);
    return [];
  }
  return (data ?? []).map((row) => mapChangeOrderRow(row as Record<string, unknown>));
}

export type CreateChangeOrderFields = {
  description: string;
  reason: string;
  requires_approval: boolean;
  line_items: ChangeOrderLineItem[];
  time_amount: number;
  time_unit: 'hours' | 'days';
  time_note: string;
};

function isUniqueViolation(err: { code?: string; message?: string } | null): boolean {
  return err?.code === '23505' || (err?.message?.includes('duplicate key') ?? false);
}

export async function createChangeOrder(
  userId: string,
  jobId: string,
  fields: CreateChangeOrderFields
): Promise<{ data: ChangeOrder | null; error: Error | null }> {
  const status: ChangeOrder['status'] = fields.requires_approval ? 'pending_approval' : 'approved';

  for (let attempt = 0; attempt < 2; attempt++) {
    const { data: coNumRaw, error: rpcError } = await supabase.rpc('next_co_number', {
      p_job_id: jobId,
    });

    if (rpcError) {
      return { data: null, error: new Error(rpcError.message) };
    }

    const co_number = typeof coNumRaw === 'number' ? coNumRaw : Number(coNumRaw);
    if (!Number.isFinite(co_number)) {
      return { data: null, error: new Error('Failed to allocate change order number') };
    }

    const row = {
      user_id: userId,
      job_id: jobId,
      co_number,
      description: fields.description,
      reason: fields.reason,
      status,
      requires_approval: fields.requires_approval,
      line_items: fields.line_items,
      time_amount: fields.time_amount,
      time_unit: fields.time_unit,
      time_note: fields.time_note,
    };

    const { data, error } = await supabase.from('change_orders').insert(row).select().single();

    if (!error && data) {
      return { data: mapChangeOrderRow(data as Record<string, unknown>), error: null };
    }

    if (error && isUniqueViolation(error) && attempt === 0) {
      continue;
    }

    return { data: null, error: new Error(error?.message || 'Failed to create change order') };
  }

  return { data: null, error: new Error('Could not save change order. Try again.') };
}

export async function updateChangeOrder(
  id: string,
  fields: Partial<
    Pick<
      ChangeOrder,
      | 'description'
      | 'reason'
      | 'requires_approval'
      | 'status'
      | 'line_items'
      | 'time_amount'
      | 'time_unit'
      | 'time_note'
    >
  >
): Promise<{ data: ChangeOrder | null; error: Error | null }> {
  const { data, error } = await supabase
    .from('change_orders')
    .update(fields)
    .eq('id', id)
    .select()
    .single();

  if (error) {
    return { data: null, error: new Error(error.message) };
  }
  return { data: mapChangeOrderRow(data as Record<string, unknown>), error: null };
}

export async function deleteChangeOrder(id: string): Promise<{ error: Error | null }> {
  const { error } = await supabase.from('change_orders').delete().eq('id', id);
  if (error) {
    return { error: new Error(error.message) };
  }
  return { error: null };
}
