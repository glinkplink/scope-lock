import { fetchWithSupabaseAuth } from './fetch-with-supabase-auth';
import type { Invoice } from '../types/db';

export async function sendInvoice(
  invoiceId: string,
  html: string,
  includePaymentLink: boolean
): Promise<{
  data: Invoice | null;
  error: Error | null;
}> {
  try {
    const res = await fetchWithSupabaseAuth(`/api/invoices/${invoiceId}/send`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        html,
        include_payment_link: includePaymentLink,
      }),
    });

    const json = (await res.json()) as { invoice?: Invoice; error?: string };

    if (!res.ok) {
      return {
        data: null,
        error: new Error(json.error || 'Could not send invoice'),
      };
    }

    return { data: json.invoice || null, error: null };
  } catch (err) {
    return {
      data: null,
      error: err instanceof Error ? err : new Error('Could not send invoice'),
    };
  }
}
