import { useEffect, useLayoutEffect, useRef, useState, type FormEvent } from 'react';
import type {
  BusinessProfile,
  InvoiceDashboardSummary,
  WorkOrderDashboardJob,
  WorkOrdersDashboardSummary,
} from '../types/db';
import { getInvoiceDashboardSummary } from '../lib/db/invoices';
import { getWorkOrdersDashboardSummary, listWorkOrdersDashboardPage } from '../lib/db/jobs';
import { splitFullNameForForm } from '../lib/owner-name';
import {
  formatWorkOrderDashboardJobType,
  formatUsd,
  formatUsdContract,
  formatWorkOrderDashboardRowDate,
  formatWorkOrderDashboardWoLabel,
  isWorkOrderDashboardJobComplete,
} from '../lib/work-order-dashboard-display';
import { getWorkOrderSignatureState } from '../lib/work-order-signature';
import { supabase } from '../lib/supabase';
import { LandingPreviewModal } from './LandingPreviewModal';
import './HomePage.css';

const HOME_RECENT_LIMIT = 5;

const LANDING_WO_PREVIEW_HTML = `
<div class="agreement-document">
  <div class="agreement-section">
    <h3 class="section-title">1. Parties &amp; Project Information</h3>
    <div class="section-content">
      <div class="parties-layout">
        <div class="parties-plain">
          <div class="parties-plain-row">
            <span class="parties-plain-label">Agreement Date:</span>
            <span class="parties-plain-value">April 30, 2026</span>
          </div>
        </div>
        <table class="content-table parties-party-table">
          <tbody>
            <tr class="party-table-header-row">
              <th class="party-header-cell party-header-spacer" scope="col" aria-hidden="true">&nbsp;</th>
              <th scope="col" class="party-header-cell">Service Provider</th>
              <th scope="col" class="party-header-cell">Customer</th>
            </tr>
            <tr>
              <td class="table-label">Name</td>
              <td class="table-value">Mike's Custom Fabrications</td>
              <td class="table-value">John Smith</td>
            </tr>
            <tr>
              <td class="table-label">Phone</td>
              <td class="table-value">(484) 654-1525</td>
              <td class="table-value">(651) 548-6548</td>
            </tr>
            <tr>
              <td class="table-label">Email</td>
              <td class="table-value">mikey@customfab.com</td>
              <td class="table-value">johnsmith@industry.com</td>
            </tr>
          </tbody>
        </table>
        <div class="parties-plain">
          <div class="parties-plain-row">
            <span class="parties-plain-label">Job Site Address:</span>
            <span class="parties-plain-value">123 Main Street, Laurel, MD 20707</span>
          </div>
        </div>
      </div>
    </div>
  </div>
  <div class="agreement-section">
    <h3 class="section-title">2. Project Overview</h3>
    <div class="section-content">
      <table class="content-table">
        <tbody>
          <tr><td class="table-label">Job type</td><td class="table-value">Repair</td></tr>
          <tr><td class="table-label">Item / Structure</td><td class="table-value">Stainless steel 304 flange-to-pipe connection (2&quot; NPT)</td></tr>
          <tr><td class="table-label">Work Requested</td><td class="table-value">TIG weld repair on root pass. Clean and re-pass with ER308L rod.</td></tr>
          <tr><td class="table-label">Target Start Date</td><td class="table-value">May 4, 2026</td></tr>
          <tr><td class="table-label">Target Completion Date</td><td class="table-value">May 8, 2026</td></tr>
        </tbody>
      </table>
    </div>
  </div>
  <div class="agreement-section">
    <h3 class="section-title">3. Scope of Work</h3>
    <div class="section-content">
      <ul class="content-bullets">
        <li>TIG weld repair on root pass. Clean and re-pass with ER308L rod.</li>
        <li>Installation of repaired/fabricated components</li>
        <li>Grinding welds smooth</li>
      </ul>
      <p class="content-paragraph">All materials will be provided by Mike's Custom Fabrications.</p>
    </div>
  </div>
  <div class="agreement-section">
    <h3 class="section-title">4. Exclusions</h3>
    <div class="section-content">
      <ul class="content-bullets">
        <li>Painting, powder coating, or any surface finishing</li>
        <li>Replacement of rusted sections beyond the defined repair area</li>
        <li>Permit acquisition or code compliance inspections</li>
        <li>Any structural engineering assessment or certification</li>
        <li>Work not specified in Section 3 above</li>
      </ul>
    </div>
  </div>
  <div class="agreement-section">
    <h3 class="section-title">5. Customer Obligations &amp; Site Conditions</h3>
    <div class="section-content">
      <ul class="content-bullets">
        <li>Provide clear, unobstructed access to the work area at the scheduled time</li>
        <li>Ensure weather conditions are suitable for outdoor welding (no precipitation, wind below 25 mph)</li>
        <li>Confirm no hazardous materials (asbestos, lead paint, pressurized lines) are present in or adjacent to the work area</li>
        <li>Designate a point of contact who is reachable during the work period</li>
      </ul>
      <p class="content-note">Failure to meet site conditions may result in rescheduling and/or a mobilization fee.</p>
    </div>
  </div>
  <div class="agreement-section">
    <h3 class="section-title">6. Pricing &amp; Payment Terms</h3>
    <div class="section-content">
      <table class="content-table">
        <tbody>
          <tr><td class="table-label">Price Type</td><td class="table-value">Fixed Price</td></tr>
          <tr><td class="table-label">Total Contract Price</td><td class="table-value">$2,500.00</td></tr>
          <tr><td class="table-label">Deposit Required</td><td class="table-value">$250.00</td></tr>
          <tr><td class="table-label">Balance Due</td><td class="table-value">$2,250.00</td></tr>
        </tbody>
      </table>
      <p class="content-note">Note: Customers are subject to applicable state and local sales tax on labor and materials as required by law. Service Provider will include applicable taxes on the final invoice.</p>
      <p class="content-paragraph">Payment is due within 14 days of invoice date. Overdue balances accrue a late fee of 1.5% per month.</p>
      <p class="content-paragraph">The Service Provider may suspend work if payment is more than 14 days overdue, and is not liable for project delays caused by non-payment.</p>
    </div>
  </div>
  <div class="agreement-section">
    <h3 class="section-title">7. Change Orders &amp; Hidden Damage</h3>
    <div class="section-content">
      <p class="content-paragraph">Any work outside the agreed scope requires approval from the Customer before the Service Provider proceeds. Extra work may cost more and take longer; The Service Provider will give an estimate before starting that work.</p>
    </div>
  </div>
  <div class="agreement-section">
    <h3 class="section-title">8. Workmanship Warranty</h3>
    <div class="section-content">
      <p class="content-paragraph">Upon completion of the work and the Customer approval, responsibility for the repaired/fabricated item transfers back to the Customer. The Service Provider is only responsible for workmanship defects as outlined in the Workmanship Warranty section.</p>
      <p class="content-paragraph">The Service Provider guarantees the welding workmanship for 30 days from the completion date.</p>
      <p class="content-paragraph">Covers:</p>
      <ul class="content-bullets">
        <li>Defects in welding workmanship</li>
        <li>Failure of weld joints under normal use</li>
      </ul>
      <p class="content-paragraph">Does NOT Cover:</p>
      <ul class="content-bullets">
        <li>Misuse or abuse of the repaired item</li>
        <li>Modifications made after completion</li>
        <li>Damage from accidents, impacts, or overloading</li>
        <li>Normal wear and tear</li>
        <li>Rust or corrosion (unless specifically coated)</li>
        <li>Structural failures unrelated to the weld repair</li>
      </ul>
    </div>
  </div>
  <div class="agreement-section">
    <h3 class="section-title">9. Liability &amp; Indemnification</h3>
    <div class="section-content">
      <p class="content-paragraph">The Service Provider's total liability under this agreement shall not exceed $2,500.00. The Service Provider shall not be liable for indirect, incidental, or consequential damages. The Customer agrees to indemnify and hold the Service Provider harmless from claims arising from the Customer's misuse or modification of the work after completion. Additionally, The Service Provider is not responsible for work performed by other contractors, modifications made after completion of this agreement, issues arising from prior repairs or work by others, or damage caused by misuse after work completion.</p>
    </div>
  </div>
  <div class="agreement-section">
    <h3 class="section-title">10. Cancellation &amp; Rescheduling</h3>
    <div class="section-content">
      <p class="content-paragraph">Either party may cancel this Agreement before work commences with 24 hours written notice. If the Customer cancels after work has commenced, the Customer shall pay for work completed to date plus any materials purchased. The deposit is non-refundable if the Service Provider has mobilized to the job site.</p>
    </div>
  </div>
  <div class="agreement-section">
    <h3 class="section-title">11. Dispute Resolution</h3>
    <div class="section-content">
      <p class="content-paragraph">The parties agree to attempt to resolve any dispute arising under this Agreement through good-faith negotiation first. If negotiation fails within 10 days, the parties agree to non-binding mediation before pursuing litigation. This Agreement shall be governed by and construed under the laws of the applicable state.</p>
    </div>
  </div>
  <div class="agreement-section signature-section">
    <h3 class="section-title">Signatures &amp; Acceptance</h3>
    <div class="section-content">
      <p class="content-paragraph">This document constitutes the entire agreement and supersedes all prior discussions. Modifications must be in writing and signed by both parties.</p>
      <div class="signature-blocks">
        <div class="signature-block">
          <div class="signature-block-identifier">Customer</div>
          <div class="signature-field">
            <span class="signature-field-label">Name</span>
            <div class="signature-field-value">John Smith</div>
          </div>
          <div class="signature-field">
            <span class="signature-field-label">Signature</span>
            <div class="signature-field-value"></div>
          </div>
          <div class="signature-field">
            <span class="signature-field-label">Date</span>
            <div class="signature-field-value"></div>
          </div>
        </div>
        <div class="signature-block">
          <div class="signature-block-identifier">Service Provider</div>
          <div class="signature-field">
            <span class="signature-field-label">Name</span>
            <div class="signature-field-value">Mikey Jones</div>
          </div>
          <div class="signature-field">
            <span class="signature-field-label">Signature</span>
            <div class="signature-field-value">
              <div class="signature-autofill-name">Mikey Jones</div>
            </div>
          </div>
          <div class="signature-field">
            <span class="signature-field-label">Date</span>
            <div class="signature-field-value">4/30/2026</div>
          </div>
        </div>
      </div>
    </div>
  </div>
</div>
`;

const LANDING_INVOICE_PREVIEW_HTML = `
<div class="agreement-document invoice-document">
  <h2 class="invoice-title">INVOICE</h2>
  <div class="parties-layout">
    <div class="parties-plain">
      <div class="parties-plain-row">
        <span class="parties-plain-label">Invoice Date:</span>
        <span class="parties-plain-value">April 21, 2026</span>
      </div>
    </div>
    <table class="content-table parties-party-table">
      <tbody>
        <tr class="party-table-header-row">
          <th class="party-header-cell party-header-spacer" scope="col" aria-hidden="true">&nbsp;</th>
          <th scope="col" class="party-header-cell">Service Provider</th>
          <th scope="col" class="party-header-cell">Customer</th>
        </tr>
        <tr>
          <td class="table-label">Name</td>
          <td class="table-value">Mike's Custom Fabrications</td>
          <td class="table-value">John Smith</td>
        </tr>
        <tr>
          <td class="table-label">Phone</td>
          <td class="table-value">(484) 654-1525</td>
          <td class="table-value">(651) 548-6548</td>
        </tr>
        <tr>
          <td class="table-label">Email</td>
          <td class="table-value">mikey@customfab.com</td>
          <td class="table-value">johnsmith@industry.com</td>
        </tr>
      </tbody>
    </table>
    <div class="parties-plain">
      <div class="parties-plain-row">
        <span class="parties-plain-label">Job Site Address:</span>
        <span class="parties-plain-value">123 Main Street, Laurel, MD 20707</span>
      </div>
    </div>
  </div>
  <div class="invoice-details-block">
    <table class="content-table">
      <tbody>
        <tr>
          <td class="table-label">Invoice date</td>
          <td class="table-value">April 21, 2026</td>
        </tr>
        <tr>
          <td class="table-label">Due date</td>
          <td class="table-value invoice-due-date">May 5, 2026</td>
        </tr>
      </tbody>
    </table>
  </div>
  <h3 class="section-title">Line items</h3>
  <table class="content-table invoice-line-table">
    <thead>
      <tr>
        <th class="table-label" scope="col">Description</th>
        <th class="table-label" scope="col" style="text-align:right">Qty</th>
        <th class="table-label" scope="col" style="text-align:right">Unit price</th>
        <th class="table-label" scope="col" style="text-align:right">Total</th>
      </tr>
    </thead>
    <tbody>
      <tr>
        <td class="table-value">Stainless steel 304 flange-to-pipe connection (2&quot; NPT) — TIG weld repair on root pass. Clean and re-pass with ER308L rod.</td>
        <td class="table-value" style="text-align:right">1</td>
        <td class="table-value" style="text-align:right">$2,500.00</td>
        <td class="table-value" style="text-align:right">$2,500.00</td>
      </tr>
    </tbody>
  </table>
  <div class="invoice-totals-block">
    <table class="invoice-totals-table">
      <tbody>
        <tr>
          <td class="table-label">Subtotal</td>
          <td class="table-value" style="text-align:right">$2,500.00</td>
        </tr>
        <tr>
          <td class="table-label">Tax (6%)</td>
          <td class="table-value" style="text-align:right">$150.00</td>
        </tr>
        <tr class="invoice-total-row">
          <td class="table-label"><strong>Total</strong></td>
          <td class="table-value" style="text-align:right"><strong>$2,650.00</strong></td>
        </tr>
      </tbody>
    </table>
  </div>
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

const DOC_RENDER_WIDTH = 816;

function DocThumbnail({ htmlMarkup, onClick, ariaLabel }: { htmlMarkup: string; onClick: () => void; ariaLabel: string }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(1);

  useLayoutEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const update = () => {
      const w = el.getBoundingClientRect().width;
      if (w > 0) setScale(w / DOC_RENDER_WIDTH);
    };
    update();
    if (typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  return (
    <button type="button" className="home-shot-doc-thumb" aria-label={ariaLabel} onClick={onClick}>
      <div ref={containerRef} className="home-shot-doc-viewport">
        <div
          className="home-shot-doc-sheet"
          style={{ transform: `scale(${scale})`, width: DOC_RENDER_WIDTH }}
          dangerouslySetInnerHTML={{ __html: htmlMarkup }}
        />
      </div>
      <div className="home-shot-doc-overlay" aria-hidden="true">
        <span className="home-shot-doc-overlay-label">Read full document</span>
      </div>
    </button>
  );
}

function getHomeRecentStatusChip(job: WorkOrderDashboardJob): { className: string; label: string } | null {
  if (isWorkOrderDashboardJobComplete(job)) {
    return { className: 'iw-status-chip iw-status-chip--paid', label: 'Completed' };
  }

  const signatureState = getWorkOrderSignatureState(job.esign_status, job.offline_signed_at);
  if (signatureState.isSignatureSatisfied) {
    return { className: 'iw-status-chip iw-status-chip--paid', label: 'Signed' };
  }

  if (job.esign_status === 'sent' || job.esign_status === 'opened') {
    return { className: 'iw-status-chip iw-status-chip--draft', label: 'Sent' };
  }

  if (job.esign_status === 'declined') {
    return { className: 'iw-status-chip iw-status-chip--negative', label: 'Declined' };
  }

  if (job.esign_status === 'expired') {
    return { className: 'iw-status-chip iw-status-chip--negative', label: 'Expired' };
  }

  return null;
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
  const [invoiceSummary, setInvoiceSummary] = useState<InvoiceDashboardSummary | null>(null);
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
      setInvoiceSummary(null);
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
        getInvoiceDashboardSummary(uid),
      ]).then(([pageResult, summaryResult, invoiceSummaryResult]) => {
        if (cancelled || seq !== loadSeq.current) return;

        if (pageResult.error || summaryResult.error || invoiceSummaryResult.error) {
          const msg =
            pageResult.error?.message ??
            summaryResult.error?.message ??
            invoiceSummaryResult.error?.message ??
            'Unknown error';
          setSummary(null);
          setInvoiceSummary(null);
          setRecentJobs([]);
          setDashboardError(`Could not load dashboard (${msg}).`);
          return;
        }

        setSummary(summaryResult.data);
        setInvoiceSummary(invoiceSummaryResult.data);
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
          <h1 className="home-hero-lead">
            Pros don&apos;t work on a promise.{' '}
            <span className="home-hero-lead-second">Your job, your terms.</span>
          </h1>
          <div className="home-hero-sub-block">
            <p className="home-hero-sub">Ironclad scope. Signed price. Paid on time.</p>
            <p className="home-hero-sub home-hero-sub--timing">Ready in 2 minutes.</p>
          </div>
          <button type="button" className="btn-primary btn-large home-hero-cta" onClick={onCreateAgreement}>
            Create my first work order
          </button>
          <p className="home-hero-trust">Free while we&apos;re in beta. No credit card, no commitment.</p>
        </section>

        <section className="home-proof-stats" aria-label="Why this exists">
          <div className="home-proof-stat">
            <div className="home-proof-stat-num">82%</div>
            <div className="home-proof-stat-label">of contractors wait over 30 days to get paid</div>
            <div className="home-proof-stat-source">Construction Payments Report, 2025</div>
          </div>
          <div className="home-proof-stat">
            <div className="home-proof-stat-num">60%</div>
            <div className="home-proof-stat-label">of projects go over budget — scope changes are the top cause</div>
            <div className="home-proof-stat-source">Constrafor / PMI</div>
          </div>
          <div className="home-proof-stat">
            <div className="home-proof-stat-num">1 in 2</div>
            <div className="home-proof-stat-label">independent contractors weren't paid on time last year</div>
            <div className="home-proof-stat-source">Freelance Statistics 2025</div>
          </div>
        </section>

        <section className="home-journey" aria-labelledby="home-journey-heading">
          <p className="home-journey-eyebrow">The Journey</p>
          <h2 id="home-journey-heading" className="home-section-heading home-journey-heading">
            From messy jobsite to paid in full.
          </h2>
          <p className="home-journey-sub">Three steps. Same day. No more chasing.</p>

          <div className="home-journey-col-labels" aria-hidden="true">
            <span className="home-journey-col-label home-journey-col-label--problem">
              <span className="home-journey-col-dot" />
              The Problem
            </span>
            <span className="home-journey-col-label home-journey-col-label--solution">
              <span className="home-journey-col-dot home-journey-col-dot--solution" />
              What IronWork Does
            </span>
          </div>

          <div className="home-journey-rows">
            <div className="home-journey-row">
              <div className="home-journey-problem-card">
                <span className="home-journey-card-eyebrow home-journey-card-eyebrow--problem">On the Job</span>
                <p className="home-journey-card-text">Clients add to the scope mid-job and expect it free.</p>
              </div>
              <div className="home-journey-step">
                <div className="home-journey-step-circle">1</div>
                <span className="home-journey-step-label">Scope</span>
              </div>
              <div className="home-journey-solution-card">
                <span className="home-journey-card-eyebrow home-journey-card-eyebrow--solution">IronWork</span>
                <p className="home-journey-card-text home-journey-card-text--solution">Signed change order required before any extra work begins.</p>
              </div>
            </div>

            <div className="home-journey-row">
              <div className="home-journey-problem-card">
                <span className="home-journey-card-eyebrow home-journey-card-eyebrow--problem">After the Job</span>
                <p className="home-journey-card-text">Client disputes what was supposed to be done.</p>
              </div>
              <div className="home-journey-step">
                <div className="home-journey-step-circle">2</div>
                <span className="home-journey-step-label">Protect</span>
              </div>
              <div className="home-journey-solution-card">
                <span className="home-journey-card-eyebrow home-journey-card-eyebrow--solution">IronWork</span>
                <p className="home-journey-card-text home-journey-card-text--solution">Scope and exclusions locked in writing before you start.</p>
              </div>
            </div>

            <div className="home-journey-row">
              <div className="home-journey-problem-card">
                <span className="home-journey-card-eyebrow home-journey-card-eyebrow--problem">Chasing Payment</span>
                <p className="home-journey-card-text">Invoice sits unpaid for weeks and you have no leverage.</p>
              </div>
              <div className="home-journey-step">
                <div className="home-journey-step-circle">3</div>
                <span className="home-journey-step-label">Paid</span>
              </div>
              <div className="home-journey-solution-card">
                <span className="home-journey-card-eyebrow home-journey-card-eyebrow--solution">IronWork</span>
                <p className="home-journey-card-text home-journey-card-text--solution">Late fees and work-suspension rights written into every agreement.</p>
              </div>
            </div>
          </div>

          <div className="home-journey-terminal" aria-hidden="true">
            <span className="home-journey-terminal-dot" />
            Paid. Filed. Done.
          </div>
        </section>

        <section className="home-shots" aria-labelledby="home-shots-heading">
          <h2 id="home-shots-heading" className="home-section-heading home-shots-heading">
            Client approves. Your money's protected. No more bullshit.
          </h2>
          <p className="home-shots-sub">
            Not a price in an email. Scope exclusions, enforceable late fees, and work-suspension rights baked into every agreement.
          </p>
          <p className="home-shots-promise">Do the work, get paid on time — the way it should be.</p>
          <div className="home-shots-grid">
            <div className="home-shot-tile">
              <DocThumbnail
                htmlMarkup={LANDING_WO_PREVIEW_HTML}
                ariaLabel="Open full work order preview"
                onClick={() => setLandingPreview('work-order')}
              />
              <p className="home-shot-hint">Work Order PDF — numbered sections, e-signed</p>
            </div>
            <div className="home-shot-tile">
              <DocThumbnail
                htmlMarkup={LANDING_INVOICE_PREVIEW_HTML}
                ariaLabel="Open full invoice preview"
                onClick={() => setLandingPreview('invoice')}
              />
              <p className="home-shot-hint">Invoice PDF — Stripe payment link baked in</p>
            </div>
          </div>
        </section>

        <section className="home-steps" aria-labelledby="home-steps-heading">
          <h2 id="home-steps-heading" className="home-section-heading">Quotes don't get you paid.</h2>
          <p className="home-steps-sub">Other apps send a price. IronWork sends protection.</p>
          <ol className="home-steps-list">
            <li>
              <span className="home-step-num">1</span>
              <div className="home-step-body">
                <span className="home-step-title">Build a real agreement in 2 minutes.</span>
                <span className="home-step-detail">Scope of work, exclusions, customer obligations, and payment terms — legal language that holds up when a client pushes back. Not just a price quote.</span>
              </div>
            </li>
            <li>
              <span className="home-step-num">2</span>
              <div className="home-step-body">
                <span className="home-step-title">Client signs before you touch a tool.</span>
                <span className="home-step-detail">E-sign in seconds. Any scope change mid-job triggers a new change order — new signature required. No handshake agreements.</span>
              </div>
            </li>
            <li>
              <span className="home-step-num">3</span>
              <div className="home-step-body">
                <span className="home-step-title">Invoice the day you finish.</span>
                <span className="home-step-detail">Pro PDF sent immediately with a Stripe payment link. Late-fee terms and work-suspension rights are already in the contract — no extras needed.</span>
              </div>
            </li>
          </ol>
        </section>

        <section className="home-faq" aria-labelledby="home-faq-heading">
          <h2 id="home-faq-heading" className="home-section-heading home-faq-heading">
            Questions you're about to ask.
          </h2>

          <div className="home-faq-list">
            <details className="home-faq-item">
              <summary>Will this hold up in my state?</summary>
              <p>
                Every agreement has the same clauses contractor attorneys use: scope, exclusions, customer obligations, warranty, limitation of liability, change orders, and dispute resolution. Nothing state-specific is enforced — you can edit anything before sending. If your state requires specific contractor-license language, you add it once to your profile defaults and it prints on every job.
              </p>
            </details>
            <details className="home-faq-item">
              <summary>What if my client refuses to sign?</summary>
              <p>
                Then they're not your client — you just found out before starting the work, not after. You can also mark the job as <em>offline signed</em> (paper signature on-site) and the system still tracks it. Either way, you have a dated document they saw and the work starts on your terms.
              </p>
            </details>
            <details className="home-faq-item">
              <summary>How much does it cost?</summary>
              <p>
                Free to try — create and download real work orders and invoices, no credit card. Paid plans kick in when you start sending for e-signature and Stripe payment links in volume. No per-job fees on the work order itself.
              </p>
            </details>
            <details className="home-faq-item">
              <summary>Do I need a lawyer to customize it?</summary>
              <p>
                No. Your exclusions, warranty terms, payment methods, and tax rules are saved to your business profile once and pre-fill every new agreement. Change a word on a specific job — the original template is untouched.
              </p>
            </details>
            <details className="home-faq-item">
              <summary>What about change orders mid-job?</summary>
              <p>
                Exactly what the app is built for. Generate a standalone change order with new scope, new price, new deposit — client e-signs it, and it prints on the final invoice and combined agreement PDF. No more "we talked about it" arguments.
              </p>
            </details>
            <details className="home-faq-item">
              <summary>Does it work on my phone?</summary>
              <p>
                Yes — mobile-first. Fill out the job from the truck, preview the PDF, send for signature. Installable on iOS and Android home screens if you want it to feel like a native app.
              </p>
            </details>
          </div>
        </section>

        <section className="home-updates" aria-labelledby="home-updates-heading">
          <h2 id="home-updates-heading" className="home-section-heading home-updates-heading">
            The contractor scope-creep checklist
          </h2>
          <p className="home-updates-copy">
            Five clauses that save you from the three most common client disputes. Free. One email a month. No sales pitch.
          </p>
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
                {updatesSubmitting ? 'Sending…' : 'Send me the checklist'}
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
          <h2 className="home-section-heading">Built for contractors who are tired of getting burned.</h2>
          <p className="home-cta-footer-copy">Your next job deserves a signed agreement, not a handshake.</p>
          <button type="button" className="btn-primary btn-large home-hero-cta" onClick={onCreateAgreement}>
            Start — it's free
          </button>
        </section>

        <footer className="home-landing-footer">
          <p className="home-landing-tagline">Send the invoice. Cash the check. Move on.</p>
          <nav className="home-landing-footer-nav" aria-label="Legal and contact">
            <a className="home-landing-footer-link" href="/contact.html">
              Contact
            </a>
            <a className="home-landing-footer-link" href="/terms.html">
              Terms
            </a>
            <a className="home-landing-footer-link" href="/privacy.html">
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
              ? LANDING_INVOICE_PREVIEW_HTML
              : LANDING_WO_PREVIEW_HTML
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
            aria-label="Work order count and invoice totals"
          >
            <div className="home-stat-card home-stat-card--spark">
              <div className="home-stat-num">{jobCount}</div>
              <div className="home-stat-label">Work orders</div>
            </div>
            <div className="home-stat-card home-stat-card--signed">
              <div className="home-stat-num">{summary?.completedJobCount ?? 0}</div>
              <div className="home-stat-label">WO&apos;s completed</div>
            </div>
            <div className="home-stat-card home-stat-card--outstanding">
              <div className="home-stat-num">{formatUsd(invoiceSummary?.invoicedTotal)}</div>
              <div className="home-stat-label">Pending</div>
            </div>
            <div className="home-stat-card home-stat-card--paid">
              <div className="home-stat-num">{formatUsd(invoiceSummary?.paidTotal)}</div>
              <div className="home-stat-label">Paid</div>
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
                const statusChip = getHomeRecentStatusChip(job);
                const isPaidCard = isWorkOrderDashboardJobComplete(job);

                return (
                  <li key={job.id}>
                    <div
                      role="button"
                      tabIndex={0}
                      className={`home-dash-card${isPaidCard ? ' home-dash-card--paid' : ''}`}
                      aria-label={`Open work order ${formatWorkOrderDashboardWoLabel(job)}`}
                      onClick={() => onOpenWorkOrderDetail(job.id)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' || e.key === ' ') {
                          e.preventDefault();
                          onOpenWorkOrderDetail(job.id);
                        }
                      }}
                    >
                      <div className="home-dash-card-body">
                        <div className="home-dash-card-left">
                          <span className="home-dash-card-wo">{formatWorkOrderDashboardWoLabel(job)}</span>
                          <span className="home-dash-card-client">{job.customer_name}</span>
                          <span className="home-dash-card-title">
                            {formatWorkOrderDashboardJobType(job)}
                          </span>
                          <span className="home-dash-card-amount">{formatUsdContract(job.price)}</span>
                        </div>
                        <div className="home-dash-card-right">
                          <div className="home-dash-card-status-slot">
                            {statusChip ? (
                              <span className={statusChip.className}>{statusChip.label}</span>
                            ) : null}
                          </div>
                        </div>
                      </div>
                      <div className="home-dash-card-footer">
                        <span className="home-dash-card-date">
                          {formatWorkOrderDashboardRowDate(job)}
                        </span>
                      </div>
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
