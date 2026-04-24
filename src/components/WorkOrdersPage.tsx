import { memo, useCallback, useEffect, useMemo, useState, type MouseEvent } from 'react';
import type {
  BusinessProfile,
  Invoice,
  Job,
  WorkOrderDashboardJob,
  WorkOrdersDashboardCursor,
  WorkOrdersDashboardSummary,
} from '../types/db';
import {
  getJobById,
  getSignedWorkOrdersCount,
  getWorkOrdersDashboardSummary,
  listWorkOrdersDashboardPage,
} from '../lib/db/jobs';
import { getInvoice, getInvoiceBusinessStatus } from '../lib/db/invoices';
import { useWorkOrderRowActions } from '../hooks/useWorkOrderRowActions';
import { getEsignProgressModel } from '../lib/esign-progress';
import { getWorkOrderSignatureState } from '../lib/work-order-signature';
import {
  formatUsd,
  formatWorkOrderDashboardRowDate,
  formatWorkOrderDashboardWoLabel,
} from '../lib/work-order-dashboard-display';
import './WorkOrdersPage.css';

const HIDE_COMPLETE_PROFILE_CTA_PREFIX = 'scope-lock-hide-complete-profile-cta:';
const PROFILE_NUDGE_DISMISS_MS = 48 * 60 * 60 * 1000;
const WORK_ORDERS_PAGE_SIZE = 25;

const WORK_ORDER_FILTER_OPTIONS = [
  'all',
  'needs_signature',
  'signed',
  'draft_invoice',
  'invoiced',
  'paid',
  'paid_offline',
] as const;

type WorkOrderFilterOption = (typeof WORK_ORDER_FILTER_OPTIONS)[number];

const WORK_ORDER_FILTER_LABELS: Record<WorkOrderFilterOption, string> = {
  all: 'All',
  needs_signature: 'Needs signature',
  signed: 'Signed',
  draft_invoice: 'Draft invoice',
  invoiced: 'Invoiced',
  paid: 'Paid',
  paid_offline: 'Paid offline',
};

function readProfileNudgeDismissedActive(userId: string): boolean {
  try {
    const raw = localStorage.getItem(`${HIDE_COMPLETE_PROFILE_CTA_PREFIX}${userId}`);
    if (!raw) return false;
    const ts = Number(raw);
    if (!Number.isFinite(ts)) return false;
    return Date.now() - ts < PROFILE_NUDGE_DISMISS_MS;
  } catch {
    return false;
  }
}

function hasBusinessPhone(profile: BusinessProfile | null): boolean {
  return Boolean(profile?.phone?.replace(/\D/g, '').length);
}

function renderEsignStrip(
  status: WorkOrderDashboardJob['esign_status'],
  offlineSignedAt: string | null
) {
  const { displayLabel, isSignatureSatisfied } = getWorkOrderSignatureState(status, offlineSignedAt);
  if (!isSignatureSatisfied && status === 'not_sent') return null;

  if (displayLabel === 'Signed offline' || displayLabel === 'Signed') {
    return (
      <span
        className="esign-strip"
        title={`Signature: ${displayLabel}`}
        aria-label={`Signature status: ${displayLabel}`}
      >
        <span className="esign-strip-segment esign-strip-segment-success" aria-hidden="true" />
        <span className="esign-strip-segment esign-strip-segment-success" aria-hidden="true" />
        <span className="esign-strip-segment esign-strip-segment-success" aria-hidden="true" />
        <span className="esign-strip-text">{displayLabel}</span>
      </span>
    );
  }

  const progress = getEsignProgressModel(status);
  return (
    <span
      className="esign-strip"
      title={`E-signature: ${progress.title}`}
      aria-label={`E-signature status: ${progress.title}`}
    >
      {progress.steps.map((step) => (
        <span
          key={step.key}
          className={`esign-strip-segment esign-strip-segment-${step.tone}`}
          aria-hidden="true"
        />
      ))}
      <span className="esign-strip-text">{progress.title}</span>
    </span>
  );
}

function appendDashboardRows(
  currentJobs: WorkOrderDashboardJob[],
  nextJobs: WorkOrderDashboardJob[]
): WorkOrderDashboardJob[] {
  if (nextJobs.length === 0) return currentJobs;

  const mergedJobs = [...currentJobs];
  const indexById = new Map(currentJobs.map((job, index) => [job.id, index]));

  nextJobs.forEach((job) => {
    const existingIndex = indexById.get(job.id);
    if (existingIndex == null) {
      indexById.set(job.id, mergedJobs.length);
      mergedJobs.push(job);
      return;
    }
    mergedJobs[existingIndex] = job;
  });

  return mergedJobs;
}

function getRowInvoiceLabel(job: WorkOrderDashboardJob): string | null {
  const invoice = job.latestInvoice;
  if (!invoice) return null;
  if (invoice.payment_status === 'paid') return 'Paid';
  if (invoice.payment_status === 'offline') return 'Paid offline';
  if (getInvoiceBusinessStatus(invoice) === 'draft') return 'Invoice draft';
  return 'Invoiced';
}

function matchesWorkOrderFilter(job: WorkOrderDashboardJob, filter: WorkOrderFilterOption): boolean {
  if (filter === 'all') return true;

  const signatureState = getWorkOrderSignatureState(job.esign_status, job.offline_signed_at);
  const invoice = job.latestInvoice;
  const invoiceBusinessStatus = invoice ? getInvoiceBusinessStatus(invoice) : null;

  switch (filter) {
    case 'needs_signature':
      return !signatureState.isSignatureSatisfied;
    case 'signed':
      return signatureState.isSignatureSatisfied;
    case 'draft_invoice':
      return Boolean(invoice && invoiceBusinessStatus === 'draft');
    case 'invoiced':
      return Boolean(
        invoice &&
        invoiceBusinessStatus === 'invoiced' &&
        invoice.payment_status !== 'paid' &&
        invoice.payment_status !== 'offline'
      );
    case 'paid':
      return Boolean(invoice && invoice.payment_status === 'paid');
    case 'paid_offline':
      return Boolean(invoice && invoice.payment_status === 'offline');
    default:
      return true;
  }
}

function matchesWorkOrderSearch(job: WorkOrderDashboardJob, searchTerm: string): boolean {
  const trimmed = searchTerm.trim().toLowerCase();
  if (!trimmed) return true;

  const signatureState = getWorkOrderSignatureState(job.esign_status, job.offline_signed_at);
  const progressTitle = getEsignProgressModel(job.esign_status, 'work_order').title;
  const invoiceLabel = getRowInvoiceLabel(job);
  const haystack = [
    formatWorkOrderDashboardWoLabel(job),
    job.customer_name,
    job.job_type,
    job.other_classification,
    formatWorkOrderDashboardRowDate(job),
    formatUsd(job.price),
    Number.isFinite(job.price) ? job.price.toFixed(2) : null,
    signatureState.displayLabel,
    progressTitle,
    invoiceLabel,
  ]
    .filter((value): value is string => Boolean(value))
    .join(' ')
    .toLowerCase();

  return haystack.includes(trimmed);
}

type WorkOrderRowProps = {
  job: WorkOrderDashboardJob;
  rowBusy: boolean;
  onOpenDetail: (job: WorkOrderDashboardJob) => void;
  onOpenChangeOrdersSection: (job: WorkOrderDashboardJob) => void;
  onStartInvoice: (job: WorkOrderDashboardJob) => void;
  onOpenPendingInvoice: (job: WorkOrderDashboardJob) => void;
};

const WorkOrderRow = memo(function WorkOrderRow({
  job,
  rowBusy,
  onOpenDetail,
  onOpenChangeOrdersSection,
  onStartInvoice,
  onOpenPendingInvoice,
}: WorkOrderRowProps) {
  const woLabel = formatWorkOrderDashboardWoLabel(job);
  const invoice = job.latestInvoice;
  const jobMetaLabel = formatWorkOrderDashboardRowDate(job);

  const handleRowClick = (e: MouseEvent<HTMLLIElement>) => {
    if (rowBusy) return;
    if ((e.target as HTMLElement).closest('button')) return;
    onOpenDetail(job);
  };

  return (
    <li className="work-orders-row" onClick={handleRowClick}>
      <div className="work-orders-row-main">
        <div className="work-orders-row-detail-hit work-orders-row-detail-hit--static">
          <span className="work-orders-row-heading">
            <span className="work-orders-wo">{woLabel}</span>
            <span className="work-orders-wo-date">{`· ${jobMetaLabel}`}</span>
          </span>
          <span className="work-orders-customer">{job.customer_name}</span>
        </div>
        {job.changeOrderCount > 0 ? (
          <button
            type="button"
            className="work-orders-change-orders-link"
            disabled={rowBusy}
            onClick={() => onOpenChangeOrdersSection(job)}
          >
            View & Create Change Orders
          </button>
        ) : null}
        {renderEsignStrip(job.esign_status, job.offline_signed_at)}
      </div>
      <div className="work-orders-row-actions">
        {!invoice ? (
          <button
            type="button"
            className="wo-row-invoice-btn wo-row-invoice-btn--outline"
            disabled={rowBusy}
            onClick={() => onStartInvoice(job)}
          >
            Invoice
          </button>
        ) : invoice.payment_status === 'paid' ? (
          <button
            type="button"
            className="iw-status-chip iw-status-chip--paid"
            disabled={rowBusy}
            onClick={() => onOpenPendingInvoice(job)}
          >
            Paid
          </button>
        ) : invoice.payment_status === 'offline' ? (
          <button
            type="button"
            className="iw-status-chip iw-status-chip--offline"
            disabled={rowBusy}
            onClick={() => onOpenPendingInvoice(job)}
          >
            Paid offline
          </button>
        ) : getInvoiceBusinessStatus(invoice) === 'draft' ? (
          <button
            type="button"
            className="iw-status-chip iw-status-chip--draft"
            disabled={rowBusy}
            onClick={() => onOpenPendingInvoice(job)}
          >
            Draft
          </button>
        ) : (
          <button
            type="button"
            className="iw-status-chip iw-status-chip--outstanding"
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
  onCreateWorkOrder: () => void;
  onCompleteProfileClick: () => void;
  onStartInvoice: (job: Job) => void;
  onOpenPendingInvoice: (job: Job, invoice: Invoice) => void;
  onOpenWorkOrderDetail: (jobId: string, targetSection?: 'top' | 'change-orders') => void;
}

export function WorkOrdersPage({
  userId,
  profile,
  successBanner,
  onClearSuccessBanner,
  onCreateWorkOrder,
  onCompleteProfileClick,
  onStartInvoice,
  onOpenPendingInvoice,
  onOpenWorkOrderDetail,
}: WorkOrdersPageProps) {
  const [jobs, setJobs] = useState<WorkOrderDashboardJob[]>([]);
  const [jobsLoading, setJobsLoading] = useState(true);
  const [jobsError, setJobsError] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [nextCursor, setNextCursor] = useState<WorkOrdersDashboardCursor | null>(null);
  const [loadMoreLoading, setLoadMoreLoading] = useState(false);
  const [loadMoreError, setLoadMoreError] = useState<string | null>(null);
  const [summary, setSummary] = useState<WorkOrdersDashboardSummary | null>(null);
  const [signedWorkOrdersCount, setSignedWorkOrdersCount] = useState<number | null>(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [activeFilter, setActiveFilter] = useState<WorkOrderFilterOption>('all');

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
  const [profileNudgeDismissedActive, setProfileNudgeDismissedActive] = useState(() =>
    readProfileNudgeDismissedActive(userId)
  );

  useEffect(() => {
    setProfileNudgeDismissedActive(readProfileNudgeDismissedActive(userId));
  }, [userId]);

  useEffect(() => {
    let cancelled = false;
    setJobsLoading(true);
    setJobsError(null);
    setJobs([]);
    setHasMore(false);
    setNextCursor(null);
    setLoadMoreError(null);
    setSummary(null);
    setSignedWorkOrdersCount(null);

    void Promise.all([
      listWorkOrdersDashboardPage(userId, WORK_ORDERS_PAGE_SIZE),
      getWorkOrdersDashboardSummary(userId),
      getSignedWorkOrdersCount(userId),
    ]).then(([pageResult, summaryResult, signedCountResult]) => {
      if (cancelled) return;

      if (pageResult.error) {
        setJobs([]);
        setHasMore(false);
        setNextCursor(null);
        setJobsError(`Could not load work orders (${pageResult.error.message}).`);
      } else {
        setJobs(pageResult.data);
        setHasMore(pageResult.hasMore);
        setNextCursor(pageResult.nextCursor);
        setJobsError(null);
      }

      if (summaryResult.error) {
        setSummary(null);
      } else {
        setSummary(summaryResult.data);
      }

      if (signedCountResult.error) {
        setSignedWorkOrdersCount(null);
      } else {
        setSignedWorkOrdersCount(signedCountResult.data);
      }

      setJobsLoading(false);
    });

    return () => {
      cancelled = true;
    };
  }, [userId]);

  useEffect(() => {
    if (!successBanner) return;
    const t = setTimeout(() => onClearSuccessBanner(), 10000);
    return () => clearTimeout(t);
  }, [successBanner, onClearSuccessBanner]);

  const showProfileNudge = !hasBusinessPhone(profile) && !profileNudgeDismissedActive;

  const handleNotNowCompleteProfile = () => {
    try {
      localStorage.setItem(hideCtaKey, String(Date.now()));
    } catch {
      /* ignore */
    }
    setProfileNudgeDismissedActive(true);
  };

  const handleOpenPendingInvoiceForRow = useCallback(
    (job: WorkOrderDashboardJob) => {
      if (!job.latestInvoice) return;
      handleOpenPendingInvoice(job, job.latestInvoice);
    },
    [handleOpenPendingInvoice]
  );

  const handleOpenChangeOrdersSection = useCallback(
    (job: WorkOrderDashboardJob) => {
      onOpenWorkOrderDetail(job.id, 'change-orders');
    },
    [onOpenWorkOrderDetail]
  );

  const handleLoadMore = useCallback(() => {
    if (loadMoreLoading || !hasMore || !nextCursor) return;

    setLoadMoreLoading(true);
    setLoadMoreError(null);

    void listWorkOrdersDashboardPage(userId, WORK_ORDERS_PAGE_SIZE, nextCursor).then((result) => {
      if (result.error) {
        setLoadMoreError(`Could not load more work orders (${result.error.message}).`);
        setLoadMoreLoading(false);
        return;
      }

      setJobs((currentJobs) => appendDashboardRows(currentJobs, result.data));
      setHasMore(result.hasMore);
      setNextCursor(result.nextCursor);
      setLoadMoreLoading(false);
    });
  }, [hasMore, loadMoreLoading, nextCursor, userId]);

  const summaryJobCountDisplay = summary?.jobCount ?? 0;
  const signedWorkOrdersDisplay = signedWorkOrdersCount ?? 0;
  const filteredJobs = useMemo(
    () =>
      jobs.filter(
        (job) => matchesWorkOrderFilter(job, activeFilter) && matchesWorkOrderSearch(job, searchTerm)
      ),
    [activeFilter, jobs, searchTerm]
  );
  const hasActiveFilters = activeFilter !== 'all' || searchTerm.trim().length > 0;

  return (
    <div className="work-orders-page">
      <div className="work-orders-toolbar">
        <h1 className="work-orders-title">Work Orders</h1>
        <button type="button" className="btn-primary work-orders-toolbar-cta" onClick={onCreateWorkOrder}>
          Create Work Order
        </button>
      </div>

      {showProfileNudge ? (
        <div className="work-orders-profile-nudge">
          <p className="work-orders-profile-nudge-helper">
            Add your business phone so it appears on agreements and PDFs. Defaults you set in your
            profile (exclusions, customer obligations) apply to new work orders.
          </p>
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
            className="work-orders-stat-strip"
            role="group"
            aria-label="Work order counts"
          >
            <div className="work-orders-stat-card work-orders-stat-card--spark">
              <div className="work-orders-stat-num">{summaryJobCountDisplay}</div>
              <div className="work-orders-stat-label">Work orders</div>
            </div>
            <div className="work-orders-stat-card work-orders-stat-card--signed">
              <div className="work-orders-stat-num">{signedWorkOrdersDisplay}</div>
              <div className="work-orders-stat-label">WO&apos;s signed</div>
            </div>
          </div>
          <div className="work-orders-filters" aria-label="Work order filters">
            <div className="form-group work-orders-search-group">
              <label htmlFor="work-orders-search">Search loaded work orders</label>
              <input
                id="work-orders-search"
                type="search"
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                placeholder="Search WO #, customer, or status"
                autoComplete="off"
              />
            </div>
            <div className="work-orders-filter-chips" role="tablist" aria-label="Work order status filters">
              {WORK_ORDER_FILTER_OPTIONS.map((filter) => {
                const selected = filter === activeFilter;
                return (
                  <button
                    key={filter}
                    type="button"
                    role="tab"
                    aria-selected={selected}
                    className={`work-orders-filter-chip${selected ? ' work-orders-filter-chip--active' : ''}`}
                    onClick={() => setActiveFilter(filter)}
                  >
                    {WORK_ORDER_FILTER_LABELS[filter]}
                  </button>
                );
              })}
            </div>
          </div>
          {jobs.length === 0 ? (
            <div className="work-orders-empty-state">
              <p className="work-orders-empty-title">No work orders yet</p>
              <p className="work-orders-empty-lead">
                Create your first agreement and it will show up here.
              </p>
              <button
                type="button"
                className="btn-primary work-orders-empty-cta"
                aria-label="Create your first work order"
                onClick={onCreateWorkOrder}
              >
                Create Work Order
              </button>
            </div>
          ) : filteredJobs.length === 0 ? (
            <>
              <div className="work-orders-filtered-empty-state">
                <p className="work-orders-empty-title">No loaded work orders match</p>
                <p className="work-orders-empty-lead">
                  {hasActiveFilters
                    ? 'Try a different search or status filter, or load more work orders to expand the local results.'
                    : 'No loaded work orders match the current filters.'}
                </p>
              </div>
              {loadMoreError ? (
                <div className="error-banner work-orders-load-more-error" role="alert">
                  {loadMoreError}
                </div>
              ) : null}
              {hasMore ? (
                <div className="work-orders-load-more-wrap">
                  <button
                    type="button"
                    className="work-orders-load-more-btn"
                    disabled={loadMoreLoading}
                    onClick={handleLoadMore}
                  >
                    {loadMoreLoading ? 'Loading…' : 'Load More'}
                  </button>
                </div>
              ) : null}
            </>
          ) : (
            <>
              <ul className="work-orders-list">
                {filteredJobs.map((job) => (
                  <WorkOrderRow
                    key={job.id}
                    job={job}
                    rowBusy={actionLoadingJobIds.has(job.id)}
                    onOpenDetail={handleOpenDetail}
                    onOpenChangeOrdersSection={handleOpenChangeOrdersSection}
                    onStartInvoice={handleStartInvoice}
                    onOpenPendingInvoice={handleOpenPendingInvoiceForRow}
                  />
                ))}
              </ul>
              {loadMoreError ? (
                <div className="error-banner work-orders-load-more-error" role="alert">
                  {loadMoreError}
                </div>
              ) : null}
              {hasMore ? (
                <div className="work-orders-load-more-wrap">
                  <button
                    type="button"
                    className="work-orders-load-more-btn"
                    disabled={loadMoreLoading}
                    onClick={handleLoadMore}
                  >
                    {loadMoreLoading ? 'Loading…' : 'Load More'}
                  </button>
                </div>
              ) : null}
            </>
          )}
        </>
      )}
    </div>
  );
}
