import { fetchWithSupabaseAuth } from './fetch-with-supabase-auth';
import type { Invoice } from '../types/db';

export async function markInvoiceIssued(invoiceId: string): Promise<{
  data: Invoice | null;
  error: Error | null;
}> {
  try {
    const res = await fetchWithSupabaseAuth(
      `/api/invoices/${encodeURIComponent(invoiceId)}/mark-issued`,
      { method: 'POST' }
    );

    const json = (await res.json().catch(() => ({}))) as {
      invoice?: Invoice;
      error?: string;
    };

    if (!res.ok) {
      return {
        data: null,
        error: new Error(json.error || 'Could not mark invoice as issued'),
      };
    }

    return { data: json.invoice || null, error: null };
  } catch (err) {
    return {
      data: null,
      error: err instanceof Error ? err : new Error('Could not mark invoice as issued'),
    };
  }
}
