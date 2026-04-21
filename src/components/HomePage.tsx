import { useEffect, useRef, useState, type FormEvent } from 'react';
import type { BusinessProfile, WorkOrderDashboardJob, WorkOrdersDashboardSummary } from '../types/db';
import { getWorkOrdersDashboardSummary, listWorkOrdersDashboardPage } from '../lib/db/jobs';
import { splitFullNameForForm } from '../lib/owner-name';
import {
  compactWorkOrderDashboardStatusLabel,
  formatUsd,
  formatWorkOrderDashboardRowDate,
  formatWorkOrderDashboardWoLabel,
} from '../lib/work-order-dashboard-display';
import { supabase } from '../lib/supabase';
import { LandingPreviewModal } from './LandingPreviewModal';
import './HomePage.css';

const HOME_RECENT_LIMIT = 5;

/** Placeholder until real agreement HTML is embedded from a sample PDF. */
const LANDING_WO_PREVIEW_PLACEHOLDER_HTML = `
<div class="agreement-document" style="padding:2rem;font-family:Barlow,system-ui,sans-serif;color:#1a1a1a;">
  <p style="margin:0 0 1rem;font-size:1rem;line-height:1.5;">
    Full work order preview with scope, exclusions, and payment terms will appear here. Swap in real markup from a sample job when ready.
  </p>
  <p style="margin:0;font-size:0.9rem;color:#444;">
    Tap <strong>Try it free</strong> above to build a real agreement in about two minutes.
  </p>
</div>
`;

const LANDING_INVOICE_PREVIEW_PLACEHOLDER_HTML = `
<div class="agreement-document" style="padding:2rem;font-family:Barlow,system-ui,sans-serif;color:#1a1a1a;">
  <p style="margin:0 0 1rem;font-size:1rem;line-height:1.5;">
    Full invoice preview will appear here. Swap in real markup from a sample invoice when ready.
  </p>
  <p style="margin:0;font-size:0.9rem;color:#444;">
    Invoices are included with every job in IronWork.
  </p>
</div>
`;

type LandingPreviewKind = 'work-order' | 'invoice';

function isValidSignupEmail(value: string): boolean {
  const v = value.trim();
  if (!v || v.length > 320) return false;
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v);
}

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
      setSummary(null);
      setRecentJobs([]);
      setDashboardError(null);
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

  const [landingPreview, setLandingPreview] = useState<LandingPreviewKind | null>(null);
  const [updatesEmail, setUpdatesEmail] = useState('');
  const [updatesSubmitting, setUpdatesSubmitting] = useState(false);
  const [updatesFeedback, setUpdatesFeedback] = useState<{ tone: 'ok' | 'err'; text: string } | null>(
    null
  );

  async function handleUpdatesSubmit(e: FormEvent) {
    e.preventDefault();
    setUpdatesFeedback(null);
    const email = updatesEmail.trim();
    if (!isValidSignupEmail(email)) {
      setUpdatesFeedback({ tone: 'err', text: 'Enter a valid email address.' });
      return;
    }
    setUpdatesSubmitting(true);
    try {
      const { error } = await supabase.from('landing_email_captures').insert({
        email,
        source: 'landing_page',
      });
      if (error) {
        setUpdatesFeedback({
          tone: 'err',
          text: error.message || 'Something went wrong. Try again in a moment.',
        });
        return;
      }
      setUpdatesEmail('');
      setUpdatesFeedback({ tone: 'ok', text: "Thanks, we'll keep you posted." });
    } finally {
      setUpdatesSubmitting(false);
    }
  }

  if (!signedIn) {
    return (
      <div className="home-page home-page--guest">
        <section className="home-hero">
          <h1 className="home-hero-title">IronWork</h1>
          <p className="home-hero-lead">Stop working for free. Get it in writing.</p>
          <div className="home-hero-sub-block">
            <p className="home-hero-sub">Work orders, change orders, and invoices for solo welders.</p>
            <p className="home-hero-sub home-hero-sub--timing">Ready in 2 minutes.</p>
          </div>
          <button type="button" className="btn-primary btn-large home-hero-cta" onClick={onCreateAgreement}>
            Try it free
          </button>
          <p className="home-hero-trust">Free to try. No credit card required.</p>
        </section>

        <p className="home-identity">Built for welders, not corporations.</p>

        <section className="home-pain" aria-labelledby="home-pain-heading">
          <h2 id="home-pain-heading" className="home-section-heading">Sound familiar?</h2>
          <ul className="home-pain-list">
            <li>Clients change the scope mid-job.</li>
            <li>You chase payments for weeks.</li>
            <li>Your handwritten invoices don't look professional.</li>
          </ul>
        </section>

        <section className="home-shots" aria-labelledby="home-shots-heading">
          <h2 id="home-shots-heading" className="home-section-heading">What you get</h2>
          <div className="home-shots-grid">
            <div className="home-shot-tile">
              <button
                type="button"
                className="home-shot-placeholder"
                aria-label="Open full work order preview"
                onClick={() => setLandingPreview('work-order')}
              >
                <span>Work Order PDF</span>
              </button>
              <p className="home-shot-hint">Click to preview full agreement</p>
            </div>
            <div className="home-shot-tile">
              <button
                type="button"
                className="home-shot-placeholder"
                aria-label="Open full invoice preview"
                onClick={() => setLandingPreview('invoice')}
              >
                <span>Invoice PDF</span>
              </button>
              <p className="home-shot-hint">Click for full invoice preview</p>
            </div>
          </div>
        </section>

        <section className="home-steps" aria-labelledby="home-steps-heading">
          <h2 id="home-steps-heading" className="home-section-heading">How it works</h2>
          <ol className="home-steps-list">
            <li>
              <span className="home-step-num">1</span>
              <span className="home-step-text">Fill in the job details.</span>
            </li>
            <li>
              <span className="home-step-num">2</span>
              <span className="home-step-text">Preview the agreement.</span>
            </li>
            <li>
              <span className="home-step-num">3</span>
              <span className="home-step-text">Download it or send for e-signature.</span>
            </li>
          </ol>
        </section>

        <section className="home-updates" aria-labelledby="home-updates-heading">
          <h2 id="home-updates-heading" className="home-section-heading">
            Not ready? Get updates
          </h2>
          <form className="home-updates-form" onSubmit={handleUpdatesSubmit}>
            <label className="home-updates-label" htmlFor="landing-updates-email">
              Email
            </label>
            <div className="home-updates-row">
              <input
                id="landing-updates-email"
                name="email"
                type="email"
                autoComplete="email"
                className="home-updates-input"
                placeholder="you@example.com"
                value={updatesEmail}
                onChange={(ev) => setUpdatesEmail(ev.target.value)}
                disabled={updatesSubmitting}
              />
              <button type="submit" className="btn-secondary home-updates-submit" disabled={updatesSubmitting}>
                {updatesSubmitting ? 'Sending…' : 'Get updates'}
              </button>
            </div>
            {updatesFeedback ? (
              <p
                className={
                  updatesFeedback.tone === 'ok' ? 'home-updates-msg home-updates-msg--ok' : 'home-updates-msg home-updates-msg--err'
                }
                role={updatesFeedback.tone === 'err' ? 'alert' : 'status'}
              >
                {updatesFeedback.text}
              </p>
            ) : null}
          </form>
        </section>

        <section className="home-cta-footer">
          <h2 className="home-section-heading">Ready to get paid for the work you actually did?</h2>
          <button type="button" className="btn-primary btn-large home-hero-cta" onClick={onCreateAgreement}>
            Try it free
          </button>
        </section>

        <footer className="home-landing-footer">
          <p className="home-landing-tagline">Built for contractors who are tired of getting burned.</p>
          <nav className="home-landing-footer-nav" aria-label="Legal and contact">
            <a className="home-landing-footer-link" href="mailto:hello@ironwork.app">
              Contact
            </a>
            <a className="home-landing-footer-link" href="#">
              Terms
            </a>
            <a className="home-landing-footer-link" href="#">
              Privacy
            </a>
          </nav>
        </footer>

        <LandingPreviewModal
          open={landingPreview !== null}
          onClose={() => setLandingPreview(null)}
          title={landingPreview === 'invoice' ? 'Invoice preview' : 'Work order preview'}
          htmlMarkup={
            landingPreview === 'invoice'
              ? LANDING_INVOICE_PREVIEW_PLACEHOLDER_HTML
              : LANDING_WO_PREVIEW_PLACEHOLDER_HTML
          }
        />
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
        ? 'No work orders yet — tap + to create one.'
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
