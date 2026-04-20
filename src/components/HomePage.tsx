import { useEffect, useRef, useState } from 'react';
import { ClipboardList, Plus } from 'lucide-react';
import type { BusinessProfile, WorkOrderDashboardJob, WorkOrdersDashboardSummary } from '../types/db';
import { getWorkOrdersDashboardSummary, listWorkOrdersDashboardPage } from '../lib/db/jobs';
import { splitFullNameForForm } from '../lib/owner-name';
import {
  compactWorkOrderDashboardStatusLabel,
  formatUsd,
  formatWorkOrderDashboardRowDate,
  formatWorkOrderDashboardWoLabel,
} from '../lib/work-order-dashboard-display';
import './HomePage.css';

const HOME_RECENT_LIMIT = 5;

function greetingTimePhrase(): string {
  const h = new Date().getHours();
  if (h < 12) return 'Good morning';
  if (h < 17) return 'Good afternoon';
  return 'Good evening';
}

export interface HomePageProps {
  userId: string | null;
  profile: BusinessProfile | null;
  onCreateAgreement: () => void;
  onOpenWorkOrders: () => void;
  onOpenWorkOrderDetail: (jobId: string) => void;
}

export function HomePage({
  userId,
  profile,
  onCreateAgreement,
  onOpenWorkOrders,
  onOpenWorkOrderDetail,
}: HomePageProps) {
  const [summary, setSummary] = useState<WorkOrdersDashboardSummary | null>(null);
  const [recentJobs, setRecentJobs] = useState<WorkOrderDashboardJob[]>([]);
  const [dashboardError, setDashboardError] = useState<string | null>(null);
  const loadSeq = useRef(0);
  const retryLoadRef = useRef<() => void>(() => {});

  useEffect(() => {
    const uid = userId;
    const prof = profile;

    if (!uid || !prof) {
      loadSeq.current += 1;
      /* eslint-disable react-hooks/set-state-in-effect -- clear dashboard on sign-out or missing profile */
      setSummary(null);
      setRecentJobs([]);
      setDashboardError(null);
      /* eslint-enable react-hooks/set-state-in-effect */
      retryLoadRef.current = () => {};
      return;
    }

    let cancelled = false;

    const performLoad = () => {
      const seq = ++loadSeq.current;
      setDashboardError(null);

      void Promise.all([
        listWorkOrdersDashboardPage(uid, HOME_RECENT_LIMIT, null),
        getWorkOrdersDashboardSummary(uid),
      ]).then(([pageResult, summaryResult]) => {
        if (cancelled || seq !== loadSeq.current) return;

        if (pageResult.error || summaryResult.error) {
          const msg =
            pageResult.error?.message ?? summaryResult.error?.message ?? 'Unknown error';
          setSummary(null);
          setRecentJobs([]);
          setDashboardError(`Could not load dashboard (${msg}).`);
          return;
        }

        setSummary(summaryResult.data);
        setRecentJobs(pageResult.data ?? []);
        setDashboardError(null);
      });
    };

    retryLoadRef.current = performLoad;
    performLoad();

    return () => {
      cancelled = true;
    };
  }, [userId, profile]);

  const signedIn = Boolean(userId && profile);

  if (!signedIn) {
    return (
      <div className="home-page home-page--guest">
        <div className="home-hero">
          <h1 className="home-hero-title">IronWork</h1>
          <p className="home-hero-lead">Stop working for free. Get it in writing.</p>
          <button type="button" className="btn-primary btn-large home-hero-cta" onClick={onCreateAgreement}>
            Create Work Order
          </button>
        </div>
      </div>
    );
  }

  const firstName = splitFullNameForForm(profile!.owner_name ?? '').first;
  const greetingName = firstName ? `, ${firstName}` : '';
  const awaitingDashboard = !dashboardError && summary === null;
  const jobCount = summary?.jobCount ?? 0;
  const subline =
    summary === null
      ? ''
      : jobCount === 0
        ? 'No work orders yet — create your first one below.'
        : `You have ${jobCount} work order${jobCount === 1 ? '' : 's'}.`;

  return (
    <div className="home-page home-page--dashboard" aria-busy={awaitingDashboard}>
      <div className="home-dash-greeting">
        <h1 className="home-dash-greeting-title">
          {greetingTimePhrase()}
          {greetingName}
        </h1>
        {subline ? <p className="home-dash-greeting-sub">{subline}</p> : null}
      </div>

      {dashboardError ? (
        <div className="home-dash-error" role="alert">
          <p>{dashboardError}</p>
          <button type="button" className="btn-secondary" onClick={() => retryLoadRef.current()}>
            Retry
          </button>
        </div>
      ) : awaitingDashboard ? (
        <p className="home-dash-loading">Loading…</p>
      ) : (
        <>
          <div
            className="home-stat-strip"
            role="group"
            aria-label="Work order totals from dashboard summary"
          >
            <div className="home-stat-card home-stat-card--spark">
              <div className="home-stat-num">{jobCount}</div>
              <div className="home-stat-label">Work orders</div>
            </div>
            <div className="home-stat-card home-stat-card--blue">
              <div className="home-stat-num">{formatUsd(summary?.invoicedContractTotal)}</div>
              <div className="home-stat-label">Invoiced</div>
            </div>
            <div className="home-stat-card home-stat-card--paid">
              <div className="home-stat-num">{formatUsd(summary?.paidContractTotal)}</div>
              <div className="home-stat-label">Paid</div>
            </div>
            <div className="home-stat-card home-stat-card--green">
              <div className="home-stat-num">{formatUsd(summary?.pendingContractTotal)}</div>
              <div className="home-stat-label">Pending invoice</div>
            </div>
          </div>

          <div className="home-quick-actions">
            <button type="button" className="btn-primary home-quick-action" onClick={onCreateAgreement}>
              <span className="home-quick-action-icon" aria-hidden="true">
                <Plus size={20} strokeWidth={2.5} />
              </span>
              New Work Order
            </button>
            <button type="button" className="btn-secondary home-quick-action" onClick={onOpenWorkOrders}>
              <span className="home-quick-action-icon" aria-hidden="true">
                <ClipboardList size={18} strokeWidth={2} />
              </span>
              Work Orders
            </button>
          </div>

          <div className="home-section-head">
            <h2 className="home-section-title">Recent work orders</h2>
            <button type="button" className="home-section-link" onClick={onOpenWorkOrders}>
              View all
            </button>
          </div>

          {recentJobs.length === 0 ? (
            <p className="home-dash-empty">No work orders yet.</p>
          ) : (
            <ul className="home-recent-list">
              {recentJobs.map((job) => {
                const statusLabel = compactWorkOrderDashboardStatusLabel(job);
                return (
                  <li key={job.id}>
                    <button
                      type="button"
                      className="home-dash-card"
                      onClick={() => onOpenWorkOrderDetail(job.id)}
                    >
                      <div className="home-dash-card-top">
                        <span className="home-dash-card-wo">{formatWorkOrderDashboardWoLabel(job)}</span>
                        {statusLabel ? (
                          <span className="home-dash-card-status">{statusLabel}</span>
                        ) : null}
                      </div>
                      <div className="home-dash-card-title">{job.job_type}</div>
                      <div className="home-dash-card-client">{job.customer_name}</div>
                      <div className="home-dash-card-footer">
                        <span className="home-dash-card-amount">{formatUsd(job.price)}</span>
                        <span className="home-dash-card-date">{formatWorkOrderDashboardRowDate(job)}</span>
                      </div>
                    </button>
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
