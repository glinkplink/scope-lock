import { supabase } from '../supabase';
import type { ChangeOrder, ChangeOrderLineItem, EsignJobStatus } from '../../types/db';

/** Same text as RAISE in migration `0008_block_co_after_job_invoice.sql`. */
export const CHANGE_ORDER_BLOCKED_AFTER_FINALIZED_WO_INVOICE =
  'Change orders cannot be added after the work order invoice has been finalized.';

const VALID_CO_STATUSES: ChangeOrder['status'][] = [
  'draft',
  'pending_approval',
  'approved',
  'rejected',
];

function roundCurrency(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

export function computeCOTotal(lineItems: ChangeOrderLineItem[]): number {
  const totalCents = lineItems.reduce((sum, item) => {
    const lineTotal = Number(item.quantity) * Number(item.unit_rate);
    return sum + Math.round((lineTotal + Number.EPSILON) * 100);
  }, 0);

  return totalCents / 100;
}

function mapLineItem(raw: Record<string, unknown>): ChangeOrderLineItem {
  return {
    id: String(raw.id ?? ''),
    description: String(raw.description ?? ''),
    quantity: Number(raw.quantity) || 0,
    unit_rate: Number(raw.unit_rate) || 0,
  };
}

function parseStatus(raw: unknown): ChangeOrder['status'] {
  return VALID_CO_STATUSES.includes(raw as ChangeOrder['status'])
    ? (raw as ChangeOrder['status'])
    : 'draft';
}

function optStringCol(v: unknown): string | null {
  if (v == null) return null;
  if (typeof v === 'string') return v;
  return String(v);
}

function mapChangeOrderRow(data: Record<string, unknown>): ChangeOrder {
  const li = Array.isArray(data.line_items)
    ? data.line_items.filter(
        (value): value is Record<string, unknown> => typeof value === 'object' && value !== null
      )
    : [];

  const esignRaw = data.esign_status;
  const esign_status: EsignJobStatus =
    esignRaw === 'sent' ||
    esignRaw === 'opened' ||
    esignRaw === 'completed' ||
    esignRaw === 'declined' ||
    esignRaw === 'expired'
      ? esignRaw
      : 'not_sent';

  return {
    id: data.id as string,
    user_id: data.user_id as string,
    job_id: data.job_id as string,
    co_number: Number(data.co_number),
    description: String(data.description ?? ''),
    reason: String(data.reason ?? ''),
    status: parseStatus(data.status),
    requires_approval: Boolean(data.requires_approval),
    line_items: li.map((x) => mapLineItem(x)),
    time_amount: roundCurrency(Number(data.time_amount) || 0),
    time_unit: (data.time_unit === 'hours' ? 'hours' : 'days') as ChangeOrder['time_unit'],
    time_note: String(data.time_note ?? ''),
    created_at: String(data.created_at ?? ''),
    updated_at: String(data.updated_at ?? ''),
    esign_submission_id: optStringCol(data.esign_submission_id),
    esign_submitter_id: optStringCol(data.esign_submitter_id),
    esign_embed_src: optStringCol(data.esign_embed_src),
    esign_status,
    esign_submission_state: optStringCol(data.esign_submission_state),
    esign_submitter_state: optStringCol(data.esign_submitter_state),
    esign_sent_at: optStringCol(data.esign_sent_at),
    esign_opened_at: optStringCol(data.esign_opened_at),
    esign_completed_at: optStringCol(data.esign_completed_at),
    esign_declined_at: optStringCol(data.esign_declined_at),
    esign_decline_reason: optStringCol(data.esign_decline_reason),
    esign_signed_document_url: optStringCol(data.esign_signed_document_url),
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
  const row = {
    p_user_id: userId,
    p_job_id: jobId,
    p_description: fields.description,
    p_reason: fields.reason,
    p_status: status,
    p_requires_approval: fields.requires_approval,
    p_line_items: fields.line_items,
    p_time_amount: roundCurrency(fields.time_amount),
    p_time_unit: fields.time_unit,
    p_time_note: fields.time_note,
  };

  const { data, error } = await supabase.rpc('create_change_order', row);

  if (error) {
    if (isUniqueViolation(error)) {
      return { data: null, error: new Error('Could not save change order. Try again.') };
    }
    if (error.message.includes('work order invoice has been finalized')) {
      return { data: null, error: new Error(CHANGE_ORDER_BLOCKED_AFTER_FINALIZED_WO_INVOICE) };
    }
    return { data: null, error: new Error(error.message) };
  }

  if (!data) {
    return { data: null, error: new Error('Failed to create change order') };
  }

  return { data: mapChangeOrderRow(data as Record<string, unknown>), error: null };
}

export async function updateChangeOrder(
  userId: string,
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
  const nextFields = {
    ...fields,
    ...(fields.time_amount != null ? { time_amount: roundCurrency(fields.time_amount) } : {}),
  };

  const { data, error } = await supabase
    .from('change_orders')
    .update(nextFields)
    .eq('id', id)
    .eq('user_id', userId)
    .select()
    .single();

  if (error) {
    return { data: null, error: new Error(error.message) };
  }
  return { data: mapChangeOrderRow(data as Record<string, unknown>), error: null };
}

export async function deleteChangeOrder(
  userId: string,
  id: string
): Promise<{ error: Error | null }> {
  const { error } = await supabase.from('change_orders').delete().eq('id', id).eq('user_id', userId);
  if (error) {
    return { error: new Error(error.message) };
  }
  return { error: null };
}

export async function getChangeOrderById(id: string): Promise<ChangeOrder | null> {
  const { data, error } = await supabase
    .from('change_orders')
    .select('*')
    .eq('id', id)
    .maybeSingle();
  if (error) {
    console.error('getChangeOrderById:', error);
    return null;
  }
  return data ? mapChangeOrderRow(data as Record<string, unknown>) : null;
}
