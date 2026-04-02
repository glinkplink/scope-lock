import { supabase } from '../supabase';
import type {
  ChangeOrderInvoiceStatus,
  InvoiceBusinessStatus,
  Invoice,
  InvoiceLineItem,
  InvoiceLineItemSource,
  WorkOrderInvoiceStatus,
} from '../../types/db';
export type { WorkOrderInvoiceStatus } from '../../types/db';
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

type BaseInvoiceStatusRow = {
  id: string;
  job_id: string;
  issued_at: string | null;
  invoice_number: number;
  created_at: string;
  payment_status: 'unpaid' | 'paid' | 'offline';
};

export function getInvoiceBusinessStatus(invoice: {
  issued_at: string | null;
}): InvoiceBusinessStatus {
  return invoice.issued_at ? 'invoiced' : 'draft';
}

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
    issued_at: (data.issued_at as string | null) ?? null,
    line_items,
    stripe_payment_link_id: (data.stripe_payment_link_id as string | null) ?? null,
    stripe_payment_url: (data.stripe_payment_url as string | null) ?? null,
    payment_status: (data.payment_status as Invoice['payment_status']) ?? 'unpaid',
    paid_at: (data.paid_at as string | null) ?? null,
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
    issued_at: invoice.issued_at,
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

export type ListInvoiceStatusByJobResult =
  | { data: WorkOrderInvoiceStatus[]; error: null; warning: string | null }
  | { data: null; error: Error; warning: null };

export type ListInvoiceStatusByChangeOrderResult =
  | { data: ChangeOrderInvoiceStatus[]; error: null; warning: string | null }
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

export function changeOrderInvoiceStatusMapFromRows(
  rows: ChangeOrderInvoiceStatus[]
): Map<string, ChangeOrderInvoiceStatus> {
  const map = new Map<string, ChangeOrderInvoiceStatus>();
  for (const inv of rows) {
    if (!map.has(inv.change_order_id)) {
      map.set(inv.change_order_id, inv);
    }
  }
  return map;
}

function mapBaseInvoiceStatusRow(row: Record<string, unknown>): BaseInvoiceStatusRow | null {
  const id = row.id;
  const job_id = row.job_id;
  if (typeof id !== 'string' || typeof job_id !== 'string') return null;
  const num = row.invoice_number;
  const invoice_number = typeof num === 'number' ? num : Number(num);
  if (!Number.isFinite(invoice_number)) return null;
  const created_at = row.created_at;
  if (typeof created_at !== 'string') return null;
  const issued_at = typeof row.issued_at === 'string' && row.issued_at.trim() ? row.issued_at : null;
  const paymentStatusRaw = row.payment_status;
  const payment_status: 'unpaid' | 'paid' | 'offline' =
    paymentStatusRaw === 'paid' || paymentStatusRaw === 'offline' ? paymentStatusRaw : 'unpaid';
  return {
    id,
    job_id,
    issued_at,
    invoice_number,
    created_at,
    payment_status,
  };
}

function parseWorkOrderInvoiceStatusRow(
  row: Record<string, unknown>
): WorkOrderInvoiceStatus | null | 'ignore' {
  const base = mapBaseInvoiceStatusRow(row);
  if (!base) return null;
  const lineItems = Array.isArray(row.line_items) ? row.line_items : [];
  for (const item of lineItems) {
    if (typeof item !== 'object' || item === null) continue;
    const coId = (item as Record<string, unknown>).change_order_id;
    if (typeof coId === 'string' && coId.trim()) {
      return 'ignore';
    }
  }
  return base;
}

/**
 * True when the row is an issued job-level invoice (no line item has change_order_id).
 * Aligns with `parseWorkOrderInvoiceStatusRow` job-level semantics and `create_change_order` in the DB.
 */
export function isIssuedJobLevelInvoiceRow(row: {
  issued_at: unknown;
  line_items: unknown;
}): boolean {
  if (typeof row.issued_at !== 'string' || row.issued_at.trim() === '') return false;
  const lineItems = Array.isArray(row.line_items) ? row.line_items : [];
  for (const item of lineItems) {
    if (typeof item !== 'object' || item === null) continue;
    const coId = (item as Record<string, unknown>).change_order_id;
    if (typeof coId === 'string' && coId.trim()) {
      return false;
    }
  }
  return true;
}

export type GetBlocksNewChangeOrdersForJobResult = {
  /** When true, new change orders must be disabled (business rule or fail-closed load error). */
  blocks: boolean;
  error: Error | null;
};

/**
 * Whether new change orders are blocked for this job (issued job-level invoice exists).
 * On query failure, returns `{ blocks: true, error }` (fail-closed).
 */
export async function getBlocksNewChangeOrdersForJob(
  userId: string,
  jobId: string
): Promise<GetBlocksNewChangeOrdersForJobResult> {
  const { data, error } = await supabase
    .from('invoices')
    .select('issued_at, line_items')
    .eq('user_id', userId)
    .eq('job_id', jobId);

  if (error) {
    console.error('getBlocksNewChangeOrdersForJob:', error);
    return { blocks: true, error: new Error(error.message) };
  }

  for (const row of data ?? []) {
    if (isIssuedJobLevelInvoiceRow(row as { issued_at: unknown; line_items: unknown })) {
      return { blocks: true, error: null };
    }
  }
  return { blocks: false, error: null };
}

function parseChangeOrderInvoiceStatusRow(
  row: Record<string, unknown>
): ChangeOrderInvoiceStatus | null | 'ignore' {
  const base = mapBaseInvoiceStatusRow(row);
  if (!base) return null;
  const lineItems = Array.isArray(row.line_items) ? row.line_items : [];
  const ids = new Set<string>();
  for (const item of lineItems) {
    if (typeof item !== 'object' || item === null) continue;
    const coId = (item as Record<string, unknown>).change_order_id;
    if (typeof coId === 'string' && coId.trim()) ids.add(coId);
  }
  if (ids.size === 0) return 'ignore';
  if (ids.size !== 1) return null;
  const [change_order_id] = ids;
  return {
    ...base,
    change_order_id,
  };
}

/** Narrow invoice rows for Work Orders list. Query failure: `{ data: null, error, warning: null }`. Malformed rows are skipped with a non-blocking `warning`. */
export const listInvoiceStatusByJob = async (
  userId: string
): Promise<ListInvoiceStatusByJobResult> => {
  const { data, error } = await supabase
    .from('invoices')
    .select('id, job_id, issued_at, invoice_number, created_at, line_items, payment_status')
    .eq('user_id', userId)
    .order('created_at', { ascending: false });

  if (error) {
    console.error('Error listing invoice status:', error);
    return { data: null, error: new Error(error.message), warning: null };
  }

  const out: WorkOrderInvoiceStatus[] = [];
  let malformedCount = 0;
  for (const row of data ?? []) {
    const mapped = parseWorkOrderInvoiceStatusRow(row as Record<string, unknown>);
    if (mapped && mapped !== 'ignore') {
      out.push(mapped);
    } else if (mapped === null) {
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

/** Latest invoice per change_order_id inferred from line_items[].change_order_id. */
export const listInvoiceStatusByChangeOrder = async (
  userId: string,
  jobId: string
): Promise<ListInvoiceStatusByChangeOrderResult> => {
  const { data, error } = await supabase
    .from('invoices')
    .select('id, job_id, issued_at, invoice_number, created_at, line_items')
    .eq('user_id', userId)
    .eq('job_id', jobId)
    .order('created_at', { ascending: false });

  if (error) {
    console.error('Error listing invoice status by change order:', error);
    return { data: null, error: new Error(error.message), warning: null };
  }

  const out: ChangeOrderInvoiceStatus[] = [];
  let malformedCount = 0;
  for (const row of data ?? []) {
    const mapped = parseChangeOrderInvoiceStatusRow(row as Record<string, unknown>);
    if (mapped && mapped !== 'ignore') {
      out.push(mapped);
    } else if (mapped === null) {
      malformedCount += 1;
      console.error('listInvoiceStatusByChangeOrder: malformed invoice row (skipped)', row);
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
    .limit(20);

  if (error) {
    console.error('Error fetching invoice by job:', error);
    return null;
  }

  const rows = Array.isArray(data) ? data : [];
  for (const row of rows) {
    const mapped = parseWorkOrderInvoiceStatusRow(row as Record<string, unknown>);
    if (!mapped || mapped === 'ignore') continue;
    return mapInvoiceRow(row as Record<string, unknown>);
  }
  return null;
};

export const getInvoiceByChangeOrderId = async (jobId: string, changeOrderId: string): Promise<Invoice | null> => {
  const { data, error } = await supabase
    .from('invoices')
    .select('*')
    .eq('job_id', jobId)
    .contains('line_items', [{ change_order_id: changeOrderId }])
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    console.error('Error fetching invoice by change order:', error);
    return null;
  }

  if (!data) return null;
  return mapInvoiceRow(data as Record<string, unknown>);
};
