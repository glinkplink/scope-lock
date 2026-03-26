import { useEffect, useMemo, useRef, useState } from 'react';
import type { BusinessProfile, Job, Invoice, WorkOrderListJob, WorkOrderInvoiceStatus } from '../types/db';
import { listJobsForWorkOrders, getJobById } from '../lib/db/jobs';
import {
  listInvoiceStatusByJob,
  getInvoice,
  invoiceStatusMapFromRows,
} from '../lib/db/invoices';

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

function formatRowDate(job: WorkOrderListJob): string {
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
  const [jobs, setJobs] = useState<WorkOrderListJob[]>([]);
  const [jobsLoading, setJobsLoading] = useState(true);
  const [invoiceStatusLoading, setInvoiceStatusLoading] = useState(true);
  const [invoiceStatusError, setInvoiceStatusError] = useState<string | null>(null);
  /** Non-null array only after a successful invoice-status fetch (may be empty). */
  const [invoiceStatusRows, setInvoiceStatusRows] = useState<WorkOrderInvoiceStatus[] | null>(null);
  const [actionLoadingJobIds, setActionLoadingJobIds] = useState<Set<string>>(() => new Set());
  /** Synchronous guard so rapid double-clicks on one row do not start duplicate hydrations. */
  const actionLoadingIdsRef = useRef<Set<string>>(new Set());

  const jobCacheRef = useRef<Map<string, Job>>(new Map());
  const invoiceCacheRef = useRef<Map<string, Invoice>>(new Map());

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
    jobCacheRef.current = new Map();
    invoiceCacheRef.current = new Map();
    setJobsLoading(true);
    setInvoiceStatusLoading(true);
    setInvoiceStatusError(null);
    setInvoiceStatusRows(null);
    setJobs([]);

    void (async () => {
      const j = await listJobsForWorkOrders(userId);
      if (cancelled) return;
      setJobs(j);
      setJobsLoading(false);
    })();

    void (async () => {
      const result = await listInvoiceStatusByJob(userId);
      if (cancelled) return;
      setInvoiceStatusLoading(false);
      if (result.error) {
        setInvoiceStatusError(
          `Could not load invoice status (${result.error.message}). Invoice actions are unavailable.`
        );
        setInvoiceStatusRows(null);
      } else {
        setInvoiceStatusError(null);
        setInvoiceStatusRows(result.data);
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

  const invoiceByJobId = useMemo(() => {
    if (invoiceStatusRows === null) return null;
    return invoiceStatusMapFromRows(invoiceStatusRows);
  }, [invoiceStatusRows]);

  const invoiceStatusReady = invoiceStatusRows !== null && invoiceStatusError === null;

  const contractPrice = (job: WorkOrderListJob) =>
    typeof job.price === 'number' && Number.isFinite(job.price) ? job.price : 0;

  const invoicedContractTotal = invoiceStatusReady && invoiceByJobId
    ? jobs.reduce((acc, job) => {
        const inv = invoiceByJobId.get(job.id);
        if (inv?.status !== 'downloaded') return acc;
        return acc + contractPrice(job);
      }, 0)
    : null;

  const pendingContractTotal = invoiceStatusReady && invoiceByJobId
    ? jobs.reduce((acc, job) => {
        const inv = invoiceByJobId.get(job.id);
        if (inv && inv.status !== 'draft') return acc;
        return acc + contractPrice(job);
      }, 0)
    : null;

  const showProfileNudge = !hasBusinessPhone(profile);

  const handleNotNowCompleteProfile = () => {
    try {
      sessionStorage.setItem(hideCtaKey, '1');
    } catch {
      /* ignore */
    }
    setHideCompleteProfileCta(true);
  };

  const beginRowAction = (jobId: string) => {
    if (actionLoadingIdsRef.current.has(jobId)) return false;
    actionLoadingIdsRef.current.add(jobId);
    setActionLoadingJobIds(new Set(actionLoadingIdsRef.current));
    return true;
  };

  const endRowAction = (jobId: string) => {
    actionLoadingIdsRef.current.delete(jobId);
    setActionLoadingJobIds(new Set(actionLoadingIdsRef.current));
  };

  const runWithJobHydration = async (
    listJob: WorkOrderListJob,
    fn: (fullJob: Job) => void
  ) => {
    if (!beginRowAction(listJob.id)) return;
    try {
      let full: Job | undefined = jobCacheRef.current.get(listJob.id);
      if (full === undefined) {
        const fetched = await getJobById(listJob.id);
        if (fetched) {
          jobCacheRef.current.set(listJob.id, fetched);
          full = fetched;
        }
      }
      if (full) fn(full);
      else console.error('WorkOrdersPage: getJobById returned no row for', listJob.id);
    } finally {
      endRowAction(listJob.id);
    }
  };

  const handleOpenDetail = (listJob: WorkOrderListJob) => {
    void runWithJobHydration(listJob, (full) => onOpenWorkOrderDetail(full));
  };

  const handleStartInvoice = (listJob: WorkOrderListJob) => {
    void runWithJobHydration(listJob, (full) => onStartInvoice(full));
  };

  const handleOpenPendingInvoice = (listJob: WorkOrderListJob, status: WorkOrderInvoiceStatus) => {
    if (!beginRowAction(listJob.id)) return;
    void (async () => {
      try {
        let fullJob: Job | undefined = jobCacheRef.current.get(listJob.id);
        if (fullJob === undefined) {
          const j = await getJobById(listJob.id);
          if (j) {
            jobCacheRef.current.set(listJob.id, j);
            fullJob = j;
          }
        }
        let fullInv: Invoice | undefined = invoiceCacheRef.current.get(status.id);
        if (fullInv === undefined) {
          const inv = await getInvoice(status.id);
          if (inv) {
            invoiceCacheRef.current.set(status.id, inv);
            fullInv = inv;
          }
        }
        if (fullJob && fullInv) onOpenPendingInvoice(fullJob, fullInv);
        else console.error('WorkOrdersPage: missing full job or invoice for pending flow');
      } finally {
        endRowAction(listJob.id);
      }
    })();
  };

  const summaryInvoicedDisplay =
    invoicedContractTotal !== null ? formatUsd(invoicedContractTotal) : '—';
  const summaryPendingDisplay =
    pendingContractTotal !== null ? formatUsd(pendingContractTotal) : '—';

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

      {invoiceStatusError ? (
        <div className="error-banner work-orders-invoice-status-banner" role="alert">
          {invoiceStatusError}
        </div>
      ) : null}

      {jobsLoading ? (
        <p className="work-orders-loading">Loading…</p>
      ) : (
        <>
          <div
            className="work-orders-summary-strip"
            role="group"
            aria-labelledby="work-orders-contract-value-label"
          >
            <span id="work-orders-contract-value-label" className="work-orders-summary-contract-label">
              Contract value
            </span>
            <span className="work-orders-summary-item work-orders-summary-invoiced">
              <span className="work-orders-summary-label">Invoiced:</span>
              <span className="work-orders-summary-amount">{summaryInvoicedDisplay}</span>
            </span>
            <span className="work-orders-summary-item work-orders-summary-pending">
              <span className="work-orders-summary-label">Pending Invoice:</span>
              <span className="work-orders-summary-amount">{summaryPendingDisplay}</span>
            </span>
          </div>
          {jobs.length === 0 ? (
            <p className="work-orders-empty">No work orders yet.</p>
          ) : (
            <ul className="work-orders-list">
              {jobs.map((job) => {
                const inv =
                  invoiceStatusReady && invoiceByJobId ? invoiceByJobId.get(job.id) ?? null : null;
                const woLabel =
                  job.wo_number != null
                    ? `WO #${String(job.wo_number).padStart(4, '0')}`
                    : 'WO (no #)';
                const rowBusy = actionLoadingJobIds.has(job.id);
                return (
                  <li key={job.id} className="work-orders-row">
                    <div className="work-orders-row-main">
                      <button
                        type="button"
                        className="work-orders-row-detail-hit"
                        disabled={rowBusy}
                        onClick={() => handleOpenDetail(job)}
                      >
                        <span className="work-orders-wo">{woLabel}</span>
                        <span className="work-orders-customer">{job.customer_name}</span>
                      </button>
                      <span className="work-orders-meta">
                        {job.job_type} · {formatRowDate(job)}
                      </span>
                    </div>
                    <div className="work-orders-row-actions">
                      {invoiceStatusLoading ? (
                        <button
                          type="button"
                          className="wo-row-create-invoice-outline work-orders-invoice-status-loading"
                          disabled
                          aria-busy="true"
                        >
                          Loading…
                        </button>
                      ) : invoiceStatusError ? (
                        <button
                          type="button"
                          className="wo-row-create-invoice-outline work-orders-invoice-status-unavailable"
                          disabled
                        >
                          Unavailable
                        </button>
                      ) : !inv ? (
                        <button
                          type="button"
                          className="wo-row-create-invoice-outline"
                          disabled={rowBusy}
                          onClick={() => handleStartInvoice(job)}
                        >
                          Invoice
                        </button>
                      ) : inv.status === 'draft' ? (
                        <button
                          type="button"
                          className="badge-pending"
                          disabled={rowBusy}
                          onClick={() => handleOpenPendingInvoice(job, inv)}
                        >
                          Pending
                        </button>
                      ) : (
                        <button
                          type="button"
                          className="badge-invoiced"
                          disabled={rowBusy}
                          onClick={() => handleOpenPendingInvoice(job, inv)}
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
