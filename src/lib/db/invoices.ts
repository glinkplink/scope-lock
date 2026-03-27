import { supabase } from '../supabase';
import type {
  Invoice,
  InvoiceLineItem,
  InvoiceLineItemSource,
  WorkOrderInvoiceStatus,
} from '../../types/db';
import { normalizePaymentMethods } from '../payment-methods';

export type CreateInvoiceInput = {
  user_id: string;
  job_id: string;
  invoice_date: string;
  due_date: string;
  line_items: InvoiceLineItem[];
  subtotal: number;
  tax_rate: number;
  tax_amount: number;
  total: number;
  payment_methods: string[];
  notes?: string | null;
};

const VALID_LINE_SOURCES: Record<InvoiceLineItemSource, true> = {
  original_scope: true,
  change_order: true,
  labor: true,
  material: true,
  manual: true,
  legacy: true,
};

function normalizeLineItemSource(s: unknown): InvoiceLineItemSource {
  if (typeof s === 'string' && s in VALID_LINE_SOURCES) return s as InvoiceLineItemSource;
  return 'legacy';
}

function normalizeLineItemPosition(value: unknown): number | undefined {
  const n = typeof value === 'number' ? value : Number(value);
  return Number.isInteger(n) && n >= 0 ? n : undefined;
}

export function mapInvoiceRow(data: Record<string, unknown>): Invoice {
  const rawItems = Array.isArray(data.line_items) ? data.line_items : [];
  const line_items: InvoiceLineItem[] = rawItems.map((row) => {
    const r = row as Record<string, unknown>;
    return {
      id: typeof r.id === 'string' && r.id.trim() ? r.id : undefined,
      kind: (r.kind === 'material' ? 'material' : 'labor') as InvoiceLineItem['kind'],
      description: String(r.description ?? ''),
      qty: Number(r.qty),
      unit_price: Number(r.unit_price),
      total: Number(r.total),
      source: normalizeLineItemSource(r.source),
      position: normalizeLineItemPosition(r.position),
      change_order_id:
        typeof r.change_order_id === 'string' && r.change_order_id.trim()
          ? r.change_order_id
          : undefined,
    };
  });
  const pm = data.payment_methods;
  const payment_methods = normalizePaymentMethods(Array.isArray(pm) ? (pm as string[]) : []);

  return {
    id: data.id as string,
    user_id: data.user_id as string,
    job_id: data.job_id as string,
    invoice_number: Number(data.invoice_number),
    invoice_date: data.invoice_date as string,
    due_date: data.due_date as string,
    status: data.status as Invoice['status'],
    line_items,
    subtotal: Number(data.subtotal),
    tax_rate: Number(data.tax_rate),
    tax_amount: Number(data.tax_amount),
    total: Number(data.total),
    payment_methods,
    notes: (data.notes as string | null) ?? null,
    created_at: data.created_at as string,
    updated_at: data.updated_at as string,
  };
}

export const createInvoice = async (
  input: CreateInvoiceInput
): Promise<{ data: Invoice | null; error: Error | null }> => {
  const { data: numRaw, error: rpcError } = await supabase.rpc('next_invoice_number', {
    p_user_id: input.user_id,
  });

  if (rpcError) {
    return { data: null, error: new Error(rpcError.message) };
  }

  const invoice_number = typeof numRaw === 'number' ? numRaw : Number(numRaw);
  if (!Number.isFinite(invoice_number)) {
    return {
      data: null,
      error: new Error('Failed to allocate invoice number'),
    };
  }

  const row = {
    user_id: input.user_id,
    job_id: input.job_id,
    invoice_number,
    invoice_date: input.invoice_date,
    due_date: input.due_date,
    status: 'draft' as const,
    line_items: input.line_items,
    subtotal: input.subtotal,
    tax_rate: input.tax_rate,
    tax_amount: input.tax_amount,
    total: input.total,
    payment_methods: normalizePaymentMethods(input.payment_methods),
    notes: input.notes ?? null,
  };

  const { data, error } = await supabase.from('invoices').insert(row).select().single();

  if (error) {
    return { data: null, error: new Error(error.message) };
  }

  return { data: mapInvoiceRow(data as Record<string, unknown>), error: null };
};

/** Full-row overwrite (all updatable columns). */
export const updateInvoice = async (
  invoice: Invoice
): Promise<{ data: Invoice | null; error: Error | null }> => {
  const payload = {
    user_id: invoice.user_id,
    job_id: invoice.job_id,
    invoice_number: invoice.invoice_number,
    invoice_date: invoice.invoice_date,
    due_date: invoice.due_date,
    status: invoice.status,
    line_items: invoice.line_items,
    subtotal: invoice.subtotal,
    tax_rate: invoice.tax_rate,
    tax_amount: invoice.tax_amount,
    total: invoice.total,
    payment_methods: normalizePaymentMethods(invoice.payment_methods),
    notes: invoice.notes,
  };

  const { data, error } = await supabase
    .from('invoices')
    .update(payload)
    .eq('id', invoice.id)
    .select()
    .single();

  if (error) {
    return { data: null, error: new Error(error.message) };
  }

  return { data: mapInvoiceRow(data as Record<string, unknown>), error: null };
};

export const markInvoiceDownloaded = async (
  id: string
): Promise<{ error: Error | null }> => {
  const { error } = await supabase.from('invoices').update({ status: 'downloaded' }).eq('id', id);

  if (error) {
    return { error: new Error(error.message) };
  }
  return { error: null };
};

export type ListInvoiceStatusByJobResult =
  | { data: WorkOrderInvoiceStatus[]; error: null; warning: string | null }
  | { data: null; error: Error; warning: null };

/**
 * Latest invoice per job_id: caller should pass rows ordered by created_at desc; first seen wins.
 */
export function invoiceStatusMapFromRows(
  rows: WorkOrderInvoiceStatus[]
): Map<string, WorkOrderInvoiceStatus> {
  const map = new Map<string, WorkOrderInvoiceStatus>();
  for (const inv of rows) {
    if (!map.has(inv.job_id)) {
      map.set(inv.job_id, inv);
    }
  }
  return map;
}

function mapInvoiceStatusRow(row: Record<string, unknown>): WorkOrderInvoiceStatus | null {
  const status = row.status;
  if (status !== 'draft' && status !== 'downloaded') return null;
  const id = row.id;
  const job_id = row.job_id;
  if (typeof id !== 'string' || typeof job_id !== 'string') return null;
  const num = row.invoice_number;
  const invoice_number = typeof num === 'number' ? num : Number(num);
  if (!Number.isFinite(invoice_number)) return null;
  const created_at = row.created_at;
  if (typeof created_at !== 'string') return null;
  return {
    id,
    job_id,
    status,
    invoice_number,
    created_at,
  };
}

/** Narrow invoice rows for Work Orders list. Query failure: `{ data: null, error, warning: null }`. Malformed rows are skipped with a non-blocking `warning`. */
export const listInvoiceStatusByJob = async (
  userId: string
): Promise<ListInvoiceStatusByJobResult> => {
  const { data, error } = await supabase
    .from('invoices')
    .select('id, job_id, status, invoice_number, created_at')
    .eq('user_id', userId)
    .order('created_at', { ascending: false });

  if (error) {
    console.error('Error listing invoice status:', error);
    return { data: null, error: new Error(error.message), warning: null };
  }

  const out: WorkOrderInvoiceStatus[] = [];
  let malformedCount = 0;
  for (const row of data ?? []) {
    const mapped = mapInvoiceStatusRow(row as Record<string, unknown>);
    if (mapped) {
      out.push(mapped);
    } else {
      malformedCount += 1;
      console.error('listInvoiceStatusByJob: malformed invoice row (skipped)', row);
    }
  }
  const warning =
    malformedCount > 0
      ? `${malformedCount} invoice row(s) could not be read and were skipped. Other invoices still work.`
      : null;
  return { data: out, error: null, warning };
};

export const listInvoices = async (userId: string): Promise<Invoice[]> => {
  const { data, error } = await supabase
    .from('invoices')
    .select('*')
    .eq('user_id', userId)
    .order('created_at', { ascending: false });

  if (error) {
    console.error('Error listing invoices:', error);
    return [];
  }

  return (data ?? []).map((row) => mapInvoiceRow(row as Record<string, unknown>));
};

export const getInvoice = async (id: string): Promise<Invoice | null> => {
  const { data, error } = await supabase.from('invoices').select('*').eq('id', id).maybeSingle();

  if (error) {
    console.error('Error fetching invoice:', error);
    return null;
  }

  if (!data) return null;
  return mapInvoiceRow(data as Record<string, unknown>);
};

export const getInvoiceByJobId = async (jobId: string): Promise<Invoice | null> => {
  const { data, error } = await supabase
    .from('invoices')
    .select('*')
    .eq('job_id', jobId)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    console.error('Error fetching invoice by job:', error);
    return null;
  }

  if (!data) return null;
  return mapInvoiceRow(data as Record<string, unknown>);
};
