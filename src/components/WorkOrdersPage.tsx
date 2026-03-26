import { useEffect, useState } from 'react';
import type { BusinessProfile, Job, Invoice } from '../types/db';
import { listJobs } from '../lib/db/jobs';
import { listInvoices } from '../lib/db/invoices';

const HIDE_COMPLETE_PROFILE_CTA_PREFIX = 'scope-lock-hide-complete-profile-cta:';

function hasBusinessPhone(profile: BusinessProfile | null): boolean {
  return Boolean(profile?.phone?.replace(/\D/g, '').length);
}

function formatUsd(amount: number): string {
  const n = Number.isFinite(amount) ? amount : 0;
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(n);
}

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
  profile: BusinessProfile | null;
  successBanner: string | null;
  onClearSuccessBanner: () => void;
  onCompleteProfileClick: () => void;
  onStartInvoice: (job: Job) => void;
  onOpenPendingInvoice: (job: Job, invoice: Invoice) => void;
  onOpenWorkOrderDetail: (job: Job) => void;
}

export function WorkOrdersPage({
  userId,
  profile,
  successBanner,
  onClearSuccessBanner,
  onCompleteProfileClick,
  onStartInvoice,
  onOpenPendingInvoice,
  onOpenWorkOrderDetail,
}: WorkOrdersPageProps) {
  const [jobs, setJobs] = useState<Job[]>([]);
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [loading, setLoading] = useState(true);
  const hideCtaKey = `${HIDE_COMPLETE_PROFILE_CTA_PREFIX}${userId}`;
  const [hideCompleteProfileCta, setHideCompleteProfileCta] = useState(() => {
    try {
      return sessionStorage.getItem(`${HIDE_COMPLETE_PROFILE_CTA_PREFIX}${userId}`) === '1';
    } catch {
      return false;
    }
  });

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

  const contractPrice = (job: Job) =>
    typeof job.price === 'number' && Number.isFinite(job.price) ? job.price : 0;

  const invoicedContractTotal = jobs.reduce((acc, job) => {
    const inv = invoiceByJobId.get(job.id);
    if (inv?.status !== 'downloaded') return acc;
    return acc + contractPrice(job);
  }, 0);

  const pendingContractTotal = jobs.reduce((acc, job) => {
    const inv = invoiceByJobId.get(job.id);
    if (inv && inv.status !== 'draft') return acc;
    return acc + contractPrice(job);
  }, 0);

  const showProfileNudge = !hasBusinessPhone(profile);

  const handleNotNowCompleteProfile = () => {
    try {
      sessionStorage.setItem(hideCtaKey, '1');
    } catch {
      /* ignore */
    }
    setHideCompleteProfileCta(true);
  };

  return (
    <div className="work-orders-page">
      <div className="work-orders-toolbar">
        <h1 className="work-orders-title">Work Orders</h1>
      </div>

      {showProfileNudge ? (
        <div className="work-orders-profile-nudge">
          <p className="work-orders-profile-nudge-helper">
            Add your business phone so it appears on agreements and PDFs. Defaults you set in your
            profile (exclusions, customer obligations) apply to new work orders.
          </p>
          {!hideCompleteProfileCta ? (
            <div className="work-orders-profile-nudge-actions">
              <button
                type="button"
                className="work-orders-complete-profile-btn"
                onClick={onCompleteProfileClick}
              >
                Complete Profile
              </button>
              <button
                type="button"
                className="work-orders-nudge-not-now"
                onClick={handleNotNowCompleteProfile}
              >
                Not now
              </button>
            </div>
          ) : null}
        </div>
      ) : null}

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
      ) : (
        <>
          <div className="work-orders-summary-strip" aria-label="Work order contract totals">
            <span className="work-orders-summary-item work-orders-summary-invoiced">
              <span className="work-orders-summary-label">Invoiced:</span>
              <span className="work-orders-summary-amount">{formatUsd(invoicedContractTotal)}</span>
            </span>
            <span className="work-orders-summary-item work-orders-summary-pending">
              <span className="work-orders-summary-label">Pending Invoice:</span>
              <span className="work-orders-summary-amount">{formatUsd(pendingContractTotal)}</span>
            </span>
          </div>
          {jobs.length === 0 ? (
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
                      className="wo-row-create-invoice-outline"
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
                    <button
                      type="button"
                      className="badge-invoiced"
                      onClick={() => onOpenPendingInvoice(job, inv)}
                    >
                      Invoiced
                    </button>
                  )}
                </div>
              </li>
            );
          })}
          </ul>
          )}
        </>
      )}
    </div>
  );
}
