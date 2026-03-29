import { memo, useCallback, useEffect, useMemo, useState } from 'react';
import type {
  BusinessProfile,
  ChangeOrder,
  Job,
  Invoice,
  EsignJobStatus,
  WorkOrderDashboardJob,
} from '../types/db';
import { listWorkOrdersDashboard, getJobById } from '../lib/db/jobs';
import { getChangeOrderById } from '../lib/db/change-orders';
import { getInvoice } from '../lib/db/invoices';
import { useEsignPoller } from '../hooks/useEsignPoller';
import { useWorkOrderRowActions } from '../hooks/useWorkOrderRowActions';
import { shouldPollEsignStatus } from '../lib/esign-live';
import { getEsignProgressModel } from '../lib/esign-progress';
import { formatEsignStatusLabel } from '../lib/esign-labels';
import { formatWorkOrderListJobType } from '../lib/work-order-list-label';
import './WorkOrdersPage.css';

const HIDE_COMPLETE_PROFILE_CTA_PREFIX = 'scope-lock-hide-complete-profile-cta:';

const USD_FORMATTER = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
  minimumFractionDigits: 0,
  maximumFractionDigits: 0,
});

const ROW_DATE_FORMATTER = new Intl.DateTimeFormat('en-US', {
  year: 'numeric',
  month: 'short',
  day: 'numeric',
});

function hasBusinessPhone(profile: BusinessProfile | null): boolean {
  return Boolean(profile?.phone?.replace(/\D/g, '').length);
}

function formatUsd(amount: number): string {
  const n = Number.isFinite(amount) ? amount : 0;
  return USD_FORMATTER.format(n);
}

function formatRowDate(job: WorkOrderDashboardJob): string {
  const raw = job.agreement_date || job.created_at?.split('T')[0] || '';
  if (!raw) return '—';
  const [y, m, d] = raw.split('-').map(Number);
  if (!y || !m || !d) return raw;
  return ROW_DATE_FORMATTER.format(new Date(y, m - 1, d));
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

function hasInFlightEsign(job: WorkOrderDashboardJob): boolean {
  return (
    shouldPollEsignStatus(job.esign_status) ||
    job.changeOrders.some((changeOrder) => shouldPollEsignStatus(changeOrder.esign_status))
  );
}

function collectInFlightJobIds(jobs: WorkOrderDashboardJob[]): string[] {
  return jobs.filter((job) => hasInFlightEsign(job)).map((job) => job.id);
}

function mergeDashboardRows(
  currentJobs: WorkOrderDashboardJob[],
  refreshedJobs: WorkOrderDashboardJob[]
): WorkOrderDashboardJob[] {
  if (refreshedJobs.length === 0) return currentJobs;
  const refreshedById = new Map(refreshedJobs.map((job) => [job.id, job]));
  return currentJobs.map((job) => refreshedById.get(job.id) ?? job);
}

function coStatusTone(status: EsignJobStatus): 'inactive' | 'active' | 'success' | 'danger' | 'warning' {
  switch (status) {
    case 'sent':
    case 'opened':
      return 'active';
    case 'completed':
      return 'success';
    case 'declined':
      return 'danger';
    case 'expired':
      return 'warning';
    case 'not_sent':
    default:
      return 'inactive';
  }
}

type WorkOrderRowProps = {
  job: WorkOrderDashboardJob;
  rowBusy: boolean;
  onPrefetchJob: (jobId: string) => void;
  onOpenDetail: (job: WorkOrderDashboardJob) => void;
  onOpenChangeOrderDetail: (
    job: WorkOrderDashboardJob,
    changeOrder: WorkOrderDashboardJob['changeOrders'][number]
  ) => void;
  onStartInvoice: (job: WorkOrderDashboardJob) => void;
  onOpenPendingInvoice: (job: WorkOrderDashboardJob) => void;
};

const WorkOrderRow = memo(function WorkOrderRow({
  job,
  rowBusy,
  onPrefetchJob,
  onOpenDetail,
  onOpenChangeOrderDetail,
  onStartInvoice,
  onOpenPendingInvoice,
}: WorkOrderRowProps) {
  const woLabel =
    job.wo_number != null ? `WO #${String(job.wo_number).padStart(4, '0')}` : 'WO (no #)';
  const invoice = job.latestInvoice;

  return (
    <li className="work-orders-row">
      <div className="work-orders-row-main">
        <button
          type="button"
          className="work-orders-row-detail-hit"
          disabled={rowBusy}
          onClick={() => onOpenDetail(job)}
          onMouseEnter={() => onPrefetchJob(job.id)}
          onFocus={() => onPrefetchJob(job.id)}
        >
          <span className="work-orders-wo">{woLabel}</span>
          {renderEsignStrip(job.esign_status)}
          <span className="work-orders-customer">{job.customer_name}</span>
        </button>
        <span className="work-orders-meta">
          <span className="work-orders-meta-date">{formatRowDate(job)}</span>
          <span className="work-orders-meta-type">{formatWorkOrderListJobType(job)}</span>
          {job.changeOrders.length > 0 ? (
            <span className="work-orders-co-shortcuts" role="list" aria-label={`${woLabel} change orders`}>
              {job.changeOrders.map((changeOrder) => {
                const coLabel = `CO #${String(changeOrder.co_number).padStart(4, '0')}`;
                const statusLabel = formatEsignStatusLabel(changeOrder.esign_status);
                return (
                  <span
                    key={changeOrder.id}
                    className="work-orders-co-shortcut-wrap"
                    role="listitem"
                  >
                    <button
                      type="button"
                      className="work-orders-co-shortcut"
                      disabled={rowBusy}
                      onClick={() => onOpenChangeOrderDetail(job, changeOrder)}
                      aria-label={`Open ${coLabel}`}
                    >
                      <span className="work-orders-co-shortcut-label">{coLabel}</span>
                      <span className="work-orders-co-shortcut-status">
                        <span
                          className={`work-orders-co-shortcut-segment work-orders-co-shortcut-segment-${coStatusTone(changeOrder.esign_status)}`}
                          aria-hidden="true"
                        />
                        <span className="work-orders-co-shortcut-status-text">{statusLabel}</span>
                      </span>
                    </button>
                  </span>
                );
              })}
            </span>
          ) : null}
        </span>
      </div>
      <div className="work-orders-row-actions">
        {!invoice ? (
          <button
            type="button"
            className="wo-row-create-invoice-outline"
            disabled={rowBusy}
            onClick={() => onStartInvoice(job)}
          >
            Invoice
          </button>
        ) : invoice.status === 'draft' ? (
          <button
            type="button"
            className="badge-pending"
            disabled={rowBusy}
            onClick={() => onOpenPendingInvoice(job)}
          >
            Pending
          </button>
        ) : (
          <button
            type="button"
            className="badge-invoiced"
            disabled={rowBusy}
            onClick={() => onOpenPendingInvoice(job)}
          >
            Invoiced
          </button>
        )}
      </div>
    </li>
  );
});

interface WorkOrdersPageProps {
  userId: string;
  profile: BusinessProfile | null;
  successBanner: string | null;
  onClearSuccessBanner: () => void;
  onCompleteProfileClick: () => void;
  onStartInvoice: (job: Job) => void;
  onOpenPendingInvoice: (job: Job, invoice: Invoice) => void;
  onOpenWorkOrderDetail: (jobId: string) => void;
  onOpenChangeOrderDetail: (job: Job, changeOrder: ChangeOrder) => void;
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
  onOpenChangeOrderDetail,
}: WorkOrdersPageProps) {
  const [jobs, setJobs] = useState<WorkOrderDashboardJob[]>([]);
  const [jobsLoading, setJobsLoading] = useState(true);
  const [jobsError, setJobsError] = useState<string | null>(null);

  const {
    busyJobIds: actionLoadingJobIds,
    handleOpenDetail,
    handleOpenChangeOrderDetail,
    handleStartInvoice,
    handleOpenPendingInvoice,
    prefetchJob,
  } = useWorkOrderRowActions({
    userId,
    getJobById,
    getChangeOrderById,
    getInvoice,
    onOpenWorkOrderDetail,
    onOpenChangeOrderDetail,
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

  const loadDashboard = useCallback(async (jobIds?: string[]) => {
    const dashboardRows = await listWorkOrdersDashboard(userId, jobIds);
    return dashboardRows;
  }, [userId]);

  useEffect(() => {
    let cancelled = false;
    setJobsLoading(true);
    setJobsError(null);
    setJobs([]);

    void (async () => {
      const dashboardRows = await loadDashboard();
      if (cancelled) return;
      if (dashboardRows.length === 0) {
        const hasLoadFailure = dashboardRows.length === 0;
        if (hasLoadFailure) {
          setJobsError(null);
        }
      }
      setJobs(dashboardRows);
      setJobsLoading(false);
    })().catch((error: unknown) => {
      if (cancelled) return;
      setJobsError(error instanceof Error ? error.message : 'Could not load work orders.');
      setJobsLoading(false);
    });

    return () => {
      cancelled = true;
    };
  }, [loadDashboard]);

  const inFlightJobIds = useMemo(() => collectInFlightJobIds(jobs), [jobs]);

  useEsignPoller({
    enabled: inFlightJobIds.length > 0,
    pollOnce: async () => {
      const refreshedJobs = await loadDashboard(inFlightJobIds);
      if (refreshedJobs.length === 0) return false;
      let shouldContinue = false;
      setJobs((currentJobs) => {
        const mergedJobs = mergeDashboardRows(currentJobs, refreshedJobs);
        shouldContinue = collectInFlightJobIds(mergedJobs).length > 0;
        return mergedJobs;
      });
      return shouldContinue;
    },
  });

  useEffect(() => {
    if (!successBanner) return;
    const t = setTimeout(() => onClearSuccessBanner(), 10000);
    return () => clearTimeout(t);
  }, [successBanner, onClearSuccessBanner]);

  const invoicedContractTotal = useMemo(
    () =>
      jobs.reduce((acc, job) => {
        if (job.latestInvoice?.status !== 'downloaded') return acc;
        return acc + (typeof job.price === 'number' && Number.isFinite(job.price) ? job.price : 0);
      }, 0),
    [jobs]
  );

  const pendingContractTotal = useMemo(
    () =>
      jobs.reduce((acc, job) => {
        if (job.latestInvoice && job.latestInvoice.status !== 'draft') return acc;
        return acc + (typeof job.price === 'number' && Number.isFinite(job.price) ? job.price : 0);
      }, 0),
    [jobs]
  );

  const showProfileNudge = !hasBusinessPhone(profile);

  const handleNotNowCompleteProfile = () => {
    try {
      sessionStorage.setItem(hideCtaKey, '1');
    } catch {
      /* ignore */
    }
    setHideCompleteProfileCta(true);
  };

  const handleOpenPendingInvoiceForRow = useCallback(
    (job: WorkOrderDashboardJob) => {
      if (!job.latestInvoice) return;
      handleOpenPendingInvoice(job, job.latestInvoice);
    },
    [handleOpenPendingInvoice]
  );

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
          <span className="work-orders-success-banner-text">{successBanner}</span>
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

      {jobsError ? (
        <div className="error-banner work-orders-invoice-status-banner" role="alert">
          {jobsError}
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
              {jobs.map((job) => (
                <WorkOrderRow
                  key={job.id}
                  job={job}
                  rowBusy={actionLoadingJobIds.has(job.id)}
                  onPrefetchJob={prefetchJob}
                  onOpenDetail={handleOpenDetail}
                  onOpenChangeOrderDetail={handleOpenChangeOrderDetail}
                  onStartInvoice={handleStartInvoice}
                  onOpenPendingInvoice={handleOpenPendingInvoiceForRow}
                />
              ))}
            </ul>
          )}
        </>
      )}
    </div>
  );
}
