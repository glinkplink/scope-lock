import { useEffect, useState } from 'react';
import type { Job, Invoice } from '../types/db';
import { listJobs } from '../lib/db/jobs';
import { listInvoices } from '../lib/db/invoices';

function formatRowDate(job: Job): string {
  const raw = job.agreement_date || job.created_at?.split('T')[0] || '';
  if (!raw) return '—';
  const [y, m, d] = raw.split('-').map(Number);
  if (!y || !m || !d) return raw;
  return new Date(y, m - 1, d).toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}

interface WorkOrdersPageProps {
  userId: string;
  successBanner: string | null;
  onClearSuccessBanner: () => void;
  onGoHome: () => void;
  onStartInvoice: (job: Job) => void;
  onOpenPendingInvoice: (job: Job, invoice: Invoice) => void;
  onOpenWorkOrderDetail: (job: Job) => void;
}

export function WorkOrdersPage({
  userId,
  successBanner,
  onClearSuccessBanner,
  onGoHome,
  onStartInvoice,
  onOpenPendingInvoice,
  onOpenWorkOrderDetail,
}: WorkOrdersPageProps) {
  const [jobs, setJobs] = useState<Job[]>([]);
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      const [j, inv] = await Promise.all([listJobs(userId), listInvoices(userId)]);
      if (!cancelled) {
        setJobs(j);
        setInvoices(inv);
        setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [userId]);

  useEffect(() => {
    if (!successBanner) return;
    const t = setTimeout(() => onClearSuccessBanner(), 5000);
    return () => clearTimeout(t);
  }, [successBanner, onClearSuccessBanner]);

  const invoiceByJobId = new Map<string, Invoice>();
  for (const inv of invoices) {
    if (!invoiceByJobId.has(inv.job_id)) {
      invoiceByJobId.set(inv.job_id, inv);
    }
  }

  return (
    <div className="work-orders-page">
      <div className="work-orders-toolbar">
        <button type="button" className="btn-secondary work-orders-toolbar-back" onClick={onGoHome}>
          Go Home
        </button>
        <h1 className="work-orders-title">Work Orders</h1>
        <span className="work-orders-toolbar-balance" aria-hidden="true" />
      </div>

      {successBanner ? (
        <div className="success-banner work-orders-success-banner" role="status">
          {successBanner}
          <button
            type="button"
            className="btn-dismiss-banner"
            onClick={onClearSuccessBanner}
            aria-label="Dismiss"
          >
            ×
          </button>
        </div>
      ) : null}

      {loading ? (
        <p className="work-orders-loading">Loading…</p>
      ) : jobs.length === 0 ? (
        <p className="work-orders-empty">No work orders yet.</p>
      ) : (
        <ul className="work-orders-list">
          {jobs.map((job) => {
            const inv = invoiceByJobId.get(job.id) ?? null;
            const woLabel =
              job.wo_number != null ? `WO #${String(job.wo_number).padStart(4, '0')}` : 'WO (no #)';
            return (
              <li key={job.id} className="work-orders-row">
                <div className="work-orders-row-main">
                  <button
                    type="button"
                    className="work-orders-row-detail-hit"
                    onClick={() => onOpenWorkOrderDetail(job)}
                  >
                    <span className="work-orders-wo">{woLabel}</span>
                    <span className="work-orders-customer">{job.customer_name}</span>
                  </button>
                  <span className="work-orders-meta">
                    {job.job_type} · {formatRowDate(job)}
                  </span>
                </div>
                <div className="work-orders-row-actions">
                  {!inv ? (
                    <button
                      type="button"
                      className="btn-primary wo-row-invoice-btn"
                      onClick={() => onStartInvoice(job)}
                    >
                      Invoice
                    </button>
                  ) : inv.status === 'draft' ? (
                    <button
                      type="button"
                      className="badge-pending"
                      onClick={() => onOpenPendingInvoice(job, inv)}
                    >
                      Pending
                    </button>
                  ) : (
                    <span className="badge-invoiced">Invoiced</span>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
