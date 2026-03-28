import { useEffect, useMemo, useState } from 'react';
import type {
  BusinessProfile,
  Job,
  Invoice,
  EsignJobStatus,
  WorkOrderListJob,
  WorkOrderInvoiceStatus,
} from '../types/db';
import { listJobsForWorkOrders, getJobById } from '../lib/db/jobs';
import { listInvoiceStatusByJob, getInvoice, invoiceStatusMapFromRows } from '../lib/db/invoices';
import { useWorkOrderRowActions } from '../hooks/useWorkOrderRowActions';
import { getEsignProgressModel } from '../lib/esign-progress';
import { formatWorkOrderListJobType } from '../lib/work-order-list-label';
import './WorkOrdersPage.css';

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

function renderEsignStrip(status: EsignJobStatus) {
  const progress = getEsignProgressModel(status);
  if (status === 'not_sent') return null;

  return (
    <span
      className="work-orders-esign-strip"
      title={`E-signature: ${progress.title}`}
      aria-label={`E-signature status: ${progress.title}`}
    >
      {progress.steps.map((step) => (
        <span
          key={step.key}
          className={`work-orders-esign-segment work-orders-esign-segment-${step.tone}`}
          aria-hidden="true"
        />
      ))}
      <span className="work-orders-esign-text">{progress.title}</span>
    </span>
  );
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
  const [invoiceStatusWarning, setInvoiceStatusWarning] = useState<string | null>(null);
  /** Non-null array only after a successful invoice-status fetch (may be empty). */
  const [invoiceStatusRows, setInvoiceStatusRows] = useState<WorkOrderInvoiceStatus[] | null>(null);

  const {
    busyJobIds: actionLoadingJobIds,
    handleOpenDetail,
    handleStartInvoice,
    handleOpenPendingInvoice,
  } = useWorkOrderRowActions({
    userId,
    getJobById,
    getInvoice,
    onOpenWorkOrderDetail,
    onStartInvoice,
    onOpenPendingInvoice,
  });

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
    // eslint-disable-next-line react-hooks/set-state-in-effect -- intentional reset-before-fetch pattern; all calls batch in React 18
    setJobsLoading(true);
    setInvoiceStatusLoading(true);
    setInvoiceStatusError(null);
    setInvoiceStatusWarning(null);
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
        setInvoiceStatusWarning(result.warning);
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

      {invoiceStatusWarning && !invoiceStatusError ? (
        <div className="work-orders-invoice-warning-banner" role="status">
          {invoiceStatusWarning}
        </div>
      ) : null}

      {jobsLoading ? (
        <p className="work-orders-loading">Loading…</p>
      ) : (
        <>
          <div
            className="work-orders-summary-strip"
            role="group"
            aria-label="Invoiced and pending invoice totals from work order prices"
          >
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
                        <span className="work-orders-meta-date">{formatRowDate(job)}</span>
                        <span className="work-orders-meta-type">
                          {formatWorkOrderListJobType(job)}
                        </span>
                        {renderEsignStrip(job.esign_status)}
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
