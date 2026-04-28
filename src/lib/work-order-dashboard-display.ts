import type { WorkOrderDashboardJob } from '../types/db';
import { getInvoiceBusinessStatus } from './db/invoices';
import { getEsignProgressModel } from './esign-progress';
import { getWorkOrderSignatureState } from './work-order-signature';

const USD_FORMATTER = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
  minimumFractionDigits: 0,
  maximumFractionDigits: 0,
});

const USD_CONTRACT_FORMATTER = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

const ROW_DATE_FORMATTER = new Intl.DateTimeFormat('en-US', {
  year: 'numeric',
  month: 'short',
  day: 'numeric',
  timeZone: 'UTC',
});

/** Same semantics as the former Work Orders list `formatUsd` (0 fraction digits — used for stat cards). */
export function formatUsd(amount: number | null | undefined): string {
  if (typeof amount !== 'number' || !Number.isFinite(amount)) return '—';
  return USD_FORMATTER.format(amount);
}

/** Format work-order contract price with 2 decimal places so list/home match invoice wizard precision. */
export function formatUsdContract(amount: number | null | undefined): string {
  if (typeof amount !== 'number' || !Number.isFinite(amount)) return '—';
  return USD_CONTRACT_FORMATTER.format(amount);
}

/** Agreement date if set, else calendar date from `created_at`; same rules as Work Orders list. */
export function formatWorkOrderDashboardRowDate(job: WorkOrderDashboardJob): string {
  const raw = job.agreement_date || job.created_at?.split('T')[0] || '';
  if (!raw) return '—';
  const [y, m, d] = raw.split('-').map(Number);
  if (!y || !m || !d) return raw;
  // Use UTC date to avoid timezone shift when parsing YYYY-MM-DD
  return ROW_DATE_FORMATTER.format(new Date(Date.UTC(y, m - 1, d)));
}

export function formatWorkOrderDashboardWoLabel(job: WorkOrderDashboardJob): string {
  return job.wo_number != null ? `WO #${String(job.wo_number).padStart(4, '0')}` : 'WO (no #)';
}

export function formatWorkOrderDashboardJobType(job: WorkOrderDashboardJob): string {
  const otherClassification = job.other_classification?.trim();
  return otherClassification || job.job_type || '—';
}

export function isWorkOrderDashboardJobComplete(job: WorkOrderDashboardJob): boolean {
  return job.latestInvoice?.payment_status === 'paid' || job.latestInvoice?.payment_status === 'offline';
}

/**
 * Single badge for Home recent rows: invoice-first (matches list action column + detail paid pills),
 * else primary e-sign label (matches list strip visibility and text).
 */
export function compactWorkOrderDashboardStatusLabel(job: WorkOrderDashboardJob): string | null {
  const inv = job.latestInvoice;
  if (inv) {
    if (inv.payment_status === 'paid') return 'Paid';
    if (inv.payment_status === 'offline') return 'Paid';
    if (getInvoiceBusinessStatus(inv) === 'draft') return 'Invoice draft';
    return 'Pending';
  }

  const { displayLabel, isSignatureSatisfied } = getWorkOrderSignatureState(
    job.esign_status,
    job.offline_signed_at
  );
  if (!isSignatureSatisfied && job.esign_status === 'not_sent') return null;

  if (displayLabel === 'Signed offline' || displayLabel === 'Signed') return 'Signed';

  return getEsignProgressModel(job.esign_status).title;
}
