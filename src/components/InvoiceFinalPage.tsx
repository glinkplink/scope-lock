import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import type { Job, BusinessProfile, Client, Invoice } from '../types/db';
import { getClientById } from '../lib/db/clients';
import { generateInvoiceHtml } from '../lib/invoice-generator';
import { getInvoice, getInvoiceBusinessStatus, updateInvoice } from '../lib/db/invoices';
import { fetchWithSupabaseAuth } from '../lib/fetch-with-supabase-auth';
import { sendInvoice } from '../lib/invoice-send';
import { markInvoiceDownloaded } from '../lib/invoice-mark-downloaded';
import { getWorkOrderSignatureState } from '../lib/work-order-signature';
import { listChangeOrders } from '../lib/db/change-orders';
import { computeSignedCOLines } from '../lib/invoice-line-items';
import { isChangeOrderSignatureSatisfied } from '../lib/change-order-signature';
import { InvoicePreviewModal } from './InvoicePreviewModal';
import { StaleContactBanner } from './StaleContactBanner';
import { useScaledPreview } from '../hooks/useScaledPreview';
import {
  downloadPdfBlobToFile,
  fetchInvoicePdfBlob,
  getInvoicePdfFilename,
} from '../lib/agreement-pdf';
import './EsignTimeline.css';
import './ScaledPreview.css';
import './InvoiceFinalPage.css';

function formatTimestampDate(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

interface InvoiceFinalPageProps {
  invoice: Invoice;
  job: Job;
  profile: BusinessProfile;
  onBack: () => void;
  onEditInvoice: () => void;
  onInvoiceUpdated: (invoice: Invoice) => void;
  onJobUpdated?: (job: Job) => void;
  onEditClient?: () => void;
  /** Navigate to the WO detail page, scrolled to the Change Orders section. */
  onOpenChangeOrdersSection: () => void;
  /** Navigate to Edit Profile (Stripe Connect lives there). */
  onOpenStripeSetup: () => void;
}

type InvoiceMutationResponse = {
  error?: string;
  invoice?: Invoice;
};

async function readInvoiceMutationResponse(
  res: Response,
  fallbackError: string
): Promise<InvoiceMutationResponse> {
  const text = await res.text();
  if (!text.trim()) return {};
  try {
    return JSON.parse(text) as InvoiceMutationResponse;
  } catch {
    return { error: fallbackError };
  }
}

// NOTE: payment_status and paid_at come from Postgres (Stripe webhook updates the row).
// On mount we refetch the invoice once so opening this page picks up webhook-updated state
// without requiring a full navigation away and back.
export function InvoiceFinalPage({
  invoice: invoiceProp,
  job,
  profile,
  onBack,
  onEditInvoice,
  onInvoiceUpdated,
  onJobUpdated,
  onEditClient = () => {},
  onOpenChangeOrdersSection,
  onOpenStripeSetup,
}: InvoiceFinalPageProps) {
  const [modalOpen, setModalOpen] = useState(false);
  const [notesOpen, setNotesOpen] = useState(false);
  const [notesDraft, setNotesDraft] = useState(() => invoiceProp.notes ?? '');
  const [downloadError, setDownloadError] = useState('');
  const [notesError, setNotesError] = useState('');
  const [downloading, setDownloading] = useState(false);
  const [savingNotes, setSavingNotes] = useState(false);
  const [paymentLinkLoading, setPaymentLinkLoading] = useState(false);
  const [sending, setSending] = useState(false);
  const [sendingStripe, setSendingStripe] = useState(false);
  const [markingPaid, setMarkingPaid] = useState(false);
  const [sendError, setSendError] = useState('');
  const [sendWithLinkError, setSendWithLinkError] = useState('');
  const [paymentLinkError, setPaymentLinkError] = useState('');
  const [markPaidError, setMarkPaidError] = useState('');
  const [paymentLinkCopied, setPaymentLinkCopied] = useState(false);
  const [pendingCOCount, setPendingCOCount] = useState(0);
  const [linkedClient, setLinkedClient] = useState<Client | null>(null);
  const [linkedClientLoading, setLinkedClientLoading] = useState(false);

  const documentRef = useRef<HTMLDivElement | null>(null);
  const paymentLinkCopiedTimeoutRef = useRef<number | null>(null);
  const onInvoiceUpdatedRef = useRef(onInvoiceUpdated);
  useEffect(() => {
    onInvoiceUpdatedRef.current = onInvoiceUpdated;
  }, [onInvoiceUpdated]);
  const onJobUpdatedRef = useRef(onJobUpdated);
  useEffect(() => {
    onJobUpdatedRef.current = onJobUpdated;
  }, [onJobUpdated]);

  useEffect(() => {
    const clientId = job.client_id;
    if (!clientId) {
      setLinkedClient(null);
      setLinkedClientLoading(false);
      return;
    }
    let cancelled = false;
    setLinkedClient(null);
    setLinkedClientLoading(true);
    void (async () => {
      const c = await getClientById(clientId);
      if (!cancelled) {
        setLinkedClient(c);
        setLinkedClientLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [job.client_id]);

  const handleJobBackfilled = useCallback((updated: Job) => {
    onJobUpdatedRef.current?.(updated);
  }, []);

  const previewHtml = generateInvoiceHtml(invoiceProp, job, profile);
  const businessStatus = getInvoiceBusinessStatus(invoiceProp);
  const isIssued = businessStatus === 'invoiced';
  const isReadOnly = isIssued;
  const signatureState = useMemo(
    () => getWorkOrderSignatureState(job.esign_status, job.offline_signed_at),
    [job.esign_status, job.offline_signed_at]
  );
  const hasPendingCOs = pendingCOCount > 0;
  const canIssueInvoice = signatureState.isSignatureSatisfied && !hasPendingCOs;
  const gateReason = !signatureState.isSignatureSatisfied
    ? 'Work order must be e-signed or marked signed offline'
    : hasPendingCOs
      ? `Resolve ${pendingCOCount} pending change order${pendingCOCount === 1 ? '' : 's'} (sign, mark signed offline, or delete) before invoicing`
      : undefined;
  const stripeReady = Boolean(
    profile.stripe_account_id && profile.stripe_onboarding_complete
  );
  const invoiceSubline = `Invoice #${String(invoiceProp.invoice_number).padStart(4, '0')}`;

  const {
    viewportRef: previewViewportRef,
    sheetRef: previewSheetRef,
    scale: previewScale,
    spacerHeight,
    spacerWidth,
    letterWidthPx,
  } = useScaledPreview(invoiceProp, job, profile);

  useEffect(() => {
    setNotesDraft(invoiceProp.notes ?? '');
  }, [invoiceProp.id, invoiceProp.notes]);

  useEffect(() => {
    let cancelled = false;
    void getInvoice(invoiceProp.id)
      .then((row) => {
        if (!cancelled && row) onInvoiceUpdatedRef.current(row);
      })
      .catch(() => {
        // Best-effort refresh only; ignore transient errors here.
      });
    return () => {
      cancelled = true;
    };
  }, [invoiceProp.id]);

  // Recompute CO lines on open for drafts — keeps invoice current if COs were signed after draft was created.
  // Also tracks unsigned COs so we can block invoice send/download until they're resolved.
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const allCOs = await listChangeOrders(invoiceProp.job_id);
        if (cancelled) return;

        const unsigned = allCOs.filter(
          (co) => !isChangeOrderSignatureSatisfied(co.esign_status, co.offline_signed_at)
        );
        setPendingCOCount(unsigned.length);

        if (invoiceProp.issued_at) return;
        const signedCOs = allCOs.filter((co) =>
          isChangeOrderSignatureSatisfied(co.esign_status, co.offline_signed_at)
        );
        const { lines, changed } = computeSignedCOLines(invoiceProp, signedCOs);
        if (!changed) return;
        const subtotal = lines.reduce((s, l) => s + l.total, 0);
        const tax_amount =
          Math.round((subtotal * invoiceProp.tax_rate + Number.EPSILON) * 100) / 100;
        const total = Math.round((subtotal + tax_amount + Number.EPSILON) * 100) / 100;
        const updated = { ...invoiceProp, line_items: lines, subtotal, tax_amount, total };
        const { data } = await updateInvoice(updated);
        if (!cancelled && data) onInvoiceUpdatedRef.current(data);
      } catch {
        if (!cancelled) setPendingCOCount(0);
      }
    })();
    return () => {
      cancelled = true;
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [invoiceProp.id]);

  useEffect(() => {
    return () => {
      if (paymentLinkCopiedTimeoutRef.current !== null) {
        window.clearTimeout(paymentLinkCopiedTimeoutRef.current);
      }
    };
  }, []);

  const paymentUrl = invoiceProp.stripe_payment_url;
  const paymentLinkButtonLabel = paymentLinkCopied
    ? 'Copied!'
    : paymentUrl
      ? 'Copy Payment Link'
      : paymentLinkLoading
        ? 'Creating...'
        : 'Create Payment Link';
  const isPaidOffline = invoiceProp.payment_status === 'offline';
  const isPaidStripe = invoiceProp.payment_status === 'paid';
  const isPaid = isPaidStripe || isPaidOffline;
  const showEditInvoiceButton = !isPaid && !isReadOnly;
  const invoiceStatusChip = (() => {
    if (isPaidOffline) {
      return { label: 'Paid offline', className: ' iw-status-chip--offline' };
    }
    if (isPaidStripe) {
      return { label: 'Paid via Stripe', className: ' iw-status-chip--paid' };
    }
    if (isReadOnly) {
      return {
        label: invoiceProp.stripe_payment_link_id ? 'Sent via Stripe' : 'Sent',
        className: ' iw-status-chip--outstanding',
      };
    }
    if (invoiceProp.downloaded_at) {
      return { label: 'Downloaded', className: ' iw-status-chip--draft' };
    }
    return null;
  })();
  const invoiceTimelineStatusLabel = invoiceStatusChip?.label ?? 'Unsent';

  const flashPaymentLinkCopied = () => {
    if (paymentLinkCopiedTimeoutRef.current !== null) {
      window.clearTimeout(paymentLinkCopiedTimeoutRef.current);
    }
    setPaymentLinkCopied(true);
    paymentLinkCopiedTimeoutRef.current = window.setTimeout(() => {
      paymentLinkCopiedTimeoutRef.current = null;
      setPaymentLinkCopied(false);
    }, 1500);
  };

  const handleCopyPaymentLink = async () => {
    setPaymentLinkError('');

    if (paymentUrl) {
      try {
        await navigator.clipboard.writeText(paymentUrl);
        flashPaymentLinkCopied();
      } catch {
        setPaymentLinkError('Could not copy payment link.');
      }
      return;
    }

    setPaymentLinkLoading(true);
    try {
      const res = await fetchWithSupabaseAuth(`/api/stripe/invoices/${invoiceProp.id}/payment-link`, {
        method: 'POST',
      });
      const json = (await res.json()) as {
        error?: string;
        payment_link_id?: string | null;
        url?: string;
      };
      if (!res.ok || !json.url) {
        setPaymentLinkError(json.error ?? 'Could not create payment link.');
        return;
      }

      const updated: Invoice = {
        ...invoiceProp,
        stripe_payment_link_id: json.payment_link_id ?? invoiceProp.stripe_payment_link_id,
        stripe_payment_url: json.url,
      };
      onInvoiceUpdated(updated);

      try {
        await navigator.clipboard.writeText(json.url);
        flashPaymentLinkCopied();
      } catch {
        setPaymentLinkError('Payment link created, but copying it failed.');
      }
    } catch (error) {
      setPaymentLinkError(
        error instanceof Error ? error.message : 'Could not create payment link.'
      );
    } finally {
      setPaymentLinkLoading(false);
    }
  };

  const handleSendInvoice = async () => {
    setSendError('');
    setSending(true);

    try {
      const html = generateInvoiceHtml(invoiceProp, job, profile);
      const { data, error } = await sendInvoice(invoiceProp.id, html, false);

      if (error) {
        setSendError(error.message);
        return;
      }

      if (data) {
        onInvoiceUpdated(data);
      }
    } catch (err) {
      setSendError(err instanceof Error ? err.message : 'Could not send invoice');
    } finally {
      setSending(false);
    }
  };

  const handleSendWithPaymentLink = async () => {
    setSendWithLinkError('');
    setSendingStripe(true);

    try {
      const html = generateInvoiceHtml(invoiceProp, job, profile);
      const { data, error } = await sendInvoice(invoiceProp.id, html, true);

      if (error) {
        setSendWithLinkError(error.message);
        return;
      }

      if (data) {
        onInvoiceUpdated(data);
      }
    } catch (err) {
      setSendWithLinkError(
        err instanceof Error ? err.message : 'Could not send invoice with payment link'
      );
    } finally {
      setSendingStripe(false);
    }
  };

  const handleDownload = async () => {
    setDownloadError('');
    if (!documentRef.current) {
      setDownloadError('Preview is not ready. Try again.');
      return;
    }
    setDownloading(true);
    try {
      const blob = await fetchInvoicePdfBlob(invoiceProp, job, profile, documentRef.current);
      downloadPdfBlobToFile(
        blob,
        getInvoicePdfFilename(invoiceProp.invoice_number, job.customer_name)
      );

      if (!invoiceProp.downloaded_at) {
        const { data: downloaded, error: downloadMarkErr } = await markInvoiceDownloaded(
          invoiceProp.id
        );
        if (downloadMarkErr) {
          setDownloadError(
            `Invoice downloaded, but could not update status: ${downloadMarkErr.message}.`
          );
          return;
        }
        if (downloaded) {
          onInvoiceUpdated(downloaded);
        }
      }
    } catch (e) {
      setDownloadError(e instanceof Error ? e.message : 'Download failed.');
    } finally {
      setDownloading(false);
    }
  };

  const handleMarkPaidOffline = async () => {
    setMarkPaidError('');
    setMarkingPaid(true);
    try {
      const res = await fetchWithSupabaseAuth(
        `/api/invoices/${invoiceProp.id}/mark-paid-offline`,
        { method: 'POST' }
      );
      const json = await readInvoiceMutationResponse(res, 'Could not mark invoice as paid.');
      if (!res.ok || json.error) {
        setMarkPaidError(json.error ?? 'Could not mark invoice as paid.');
        return;
      }
      if (json.invoice) {
        onInvoiceUpdated(json.invoice);
        return;
      }
      const refreshed = await getInvoice(invoiceProp.id);
      if (refreshed) {
        onInvoiceUpdated(refreshed);
      } else {
        setMarkPaidError('Paid status was saved, but the invoice could not be refreshed.');
      }
    } catch (err) {
      setMarkPaidError(err instanceof Error ? err.message : 'Could not mark invoice as paid.');
    } finally {
      setMarkingPaid(false);
    }
  };

  const handleUnmarkPaidOffline = async () => {
    setMarkPaidError('');
    setMarkingPaid(true);
    try {
      const res = await fetchWithSupabaseAuth(
        `/api/invoices/${invoiceProp.id}/unmark-paid-offline`,
        { method: 'POST' }
      );
      const json = await readInvoiceMutationResponse(res, 'Could not undo offline paid status.');
      if (!res.ok || json.error) {
        setMarkPaidError(json.error ?? 'Could not undo offline paid status.');
        return;
      }
      if (json.invoice) {
        onInvoiceUpdated(json.invoice);
        return;
      }
      const refreshed = await getInvoice(invoiceProp.id);
      if (refreshed) {
        onInvoiceUpdated(refreshed);
      } else {
        setMarkPaidError('Offline paid status was undone, but the invoice could not be refreshed.');
      }
    } catch (err) {
      setMarkPaidError(
        err instanceof Error ? err.message : 'Could not undo offline paid status.'
      );
    } finally {
      setMarkingPaid(false);
    }
  };

  const handleSaveNotes = async () => {
    setNotesError('');
    setSavingNotes(true);
    try {
      const next: Invoice = {
        ...invoiceProp,
        notes: notesDraft.trim() || null,
      };
      const { data, error } = await updateInvoice(next);
      if (error || !data) {
        setNotesError(error?.message || 'Could not save notes.');
        return;
      }
      onInvoiceUpdated(data);
    } finally {
      setSavingNotes(false);
    }
  };

  return (
    <div className={`invoice-final-page${!isReadOnly ? ' invoice-final-page--draft' : ''}`}>
      <div className="invoice-final-nav">
        <button type="button" className="invoice-final-nav-plain" onClick={onBack}>
          Go Back
        </button>
      </div>

      {downloadError ? (
        <div className="error-banner" role="alert">
          {downloadError}
        </div>
      ) : null}

      <StaleContactBanner
        job={job}
        client={linkedClient}
        clientLoading={linkedClientLoading}
        onJobBackfilled={handleJobBackfilled}
        onEditClient={onEditClient}
      />

      <section className="invoice-final-payment-card" aria-labelledby="invoice-payment-heading">
        <h2 id="invoice-payment-heading" className="wo-esign-heading">Send Invoice</h2>
        <div
          className="wo-esign-timeline"
          role="group"
          aria-label={`Invoice status: ${invoiceTimelineStatusLabel}`}
        >
          {[
            {
              key: 'sent',
              label: 'Sent',
              tone: invoiceProp.issued_at ? 'active' : 'inactive',
            },
            {
              key: 'paid',
              label: 'Paid',
              tone: isPaid ? 'success' : 'inactive',
            },
          ].map((step, index, arr) => (
            <div
              key={step.key}
              className={`wo-esign-step wo-esign-step-${step.tone}`}
              aria-current={step.tone !== 'inactive' ? 'step' : undefined}
            >
              <span
                className={`wo-esign-step-dot${step.tone !== 'inactive' ? ' wo-esign-step-dot-filled' : ''}`}
                aria-hidden="true"
              />
              <span className="wo-esign-step-label">{step.label}</span>
              {index < arr.length - 1 ? (
                <span className="wo-esign-step-line" aria-hidden="true" />
              ) : null}
            </div>
          ))}
        </div>

        {(invoiceProp.issued_at || invoiceProp.paid_at) ? (
          <dl className="wo-esign-meta">
            {isPaidOffline && invoiceProp.paid_at ? (
              <div className="wo-esign-meta-row">
                <dt>Paid offline</dt>
                <dd>{formatTimestampDate(invoiceProp.paid_at)}</dd>
              </div>
            ) : null}
            {invoiceProp.issued_at ? (
              <div className="wo-esign-meta-row">
                <dt>Sent</dt>
                <dd>{formatTimestampDate(invoiceProp.issued_at)}</dd>
              </div>
            ) : null}
            {isPaidStripe && invoiceProp.paid_at ? (
              <div className="wo-esign-meta-row">
                <dt>Paid</dt>
                <dd>{formatTimestampDate(invoiceProp.paid_at)}</dd>
              </div>
            ) : null}
          </dl>
        ) : null}

        {isPaid ? (
          <>
            <p className="wo-esign-summary">
              {isPaidOffline ? 'Payment recorded offline.' : 'Payment received via Stripe.'}
            </p>
            {markPaidError ? (
              <p className="invoice-final-payment-feedback">{markPaidError}</p>
            ) : null}
            {isPaidOffline ? (
              <div className="wo-esign-actions">
                <button
                  type="button"
                  className="btn-secondary btn-action wo-esign-actions-primary"
                  disabled={markingPaid}
                  onClick={() => void handleUnmarkPaidOffline()}
                >
                  {markingPaid ? 'Saving...' : 'Undo offline paid'}
                </button>
              </div>
            ) : null}
          </>
        ) : (
          <>
            <p className="wo-esign-summary">
              {invoiceProp.issued_at ? 'Invoice sent. Awaiting payment.' : 'Ready to send invoice.'}
            </p>
            {sendError ? <p className="invoice-final-payment-feedback">{sendError}</p> : null}
            <div className="wo-esign-actions">
              <button
                type="button"
                className="btn-primary btn-action wo-esign-actions-primary"
                disabled={sending || !canIssueInvoice}
                title={gateReason}
                onClick={() => void handleSendInvoice()}
              >
                {sending ? 'Sending...' : invoiceProp.issued_at ? 'Resend Invoice' : 'Send Invoice'}
              </button>
              {!canIssueInvoice ? (
                <p className="invoice-final-gate-hint">
                  {hasPendingCOs ? (
                    <>
                      <button
                        type="button"
                        className="btn-text invoice-final-gate-link"
                        onClick={onOpenChangeOrdersSection}
                      >
                        Resolve {pendingCOCount} pending change order{pendingCOCount === 1 ? '' : 's'}
                      </button>
                      <br />(sign, mark signed offline, or delete).
                    </>
                  ) : (
                    <>
                      Requires work order signature<br />(e-signed or marked signed offline).
                    </>
                  )}
                </p>
              ) : null}
              {markPaidError ? (
                <p className="invoice-final-payment-feedback">{markPaidError}</p>
              ) : null}
              {canIssueInvoice ? (
                <button
                  type="button"
                  className="btn-secondary btn-action wo-esign-actions-primary"
                  disabled={markingPaid}
                  onClick={() => void handleMarkPaidOffline()}
                >
                  {markingPaid ? 'Saving...' : 'Mark as paid (offline)'}
                </button>
              ) : null}
            </div>

            <div className="invoice-final-online-payment">
              <h3 className="invoice-final-online-heading">Online payment</h3>
              {stripeReady ? (
                <>
                  {sendWithLinkError ? (
                    <p className="invoice-final-payment-feedback">{sendWithLinkError}</p>
                  ) : null}
                  {paymentLinkError ? (
                    <p className="invoice-final-payment-feedback">{paymentLinkError}</p>
                  ) : null}
                  <div className="invoice-final-online-actions">
                    <button
                      type="button"
                      className="btn-primary invoice-final-online-btn"
                      disabled={sendingStripe || paymentLinkLoading || !canIssueInvoice}
                      title={gateReason}
                      onClick={() => void handleSendWithPaymentLink()}
                    >
                      {sendingStripe
                        ? 'Sending...'
                        : invoiceProp.issued_at
                          ? 'Resend with payment link'
                          : 'Send with payment link'}
                    </button>
                    <button
                      type="button"
                      className="btn-primary invoice-final-online-btn"
                      disabled={sendingStripe || paymentLinkLoading || !canIssueInvoice}
                      title={gateReason}
                      onClick={() => void handleCopyPaymentLink()}
                    >
                      {paymentLinkButtonLabel}
                    </button>
                  </div>
                </>
              ) : (
                <div className="invoice-final-connect-block">
                  <p className="invoice-final-connect-prompt">
                    Want to accept online payments? Connect Stripe to send invoices with payment
                    links.
                  </p>
                  <button
                    type="button"
                    className="btn-primary btn-action invoice-final-connect-cta"
                    onClick={onOpenStripeSetup}
                  >
                    Connect Stripe Account
                  </button>
                </div>
              )}
            </div>
          </>
        )}
      </section>

      <section className="invoice-final-preview-card" aria-labelledby="invoice-preview-heading">
        <div className="invoice-final-preview-header">
          <h2 id="invoice-preview-heading" className="invoice-final-preview-title">
            Preview
          </h2>
          <div className="invoice-final-preview-header-aside">
            <p className="invoice-final-preview-copy">Tap the preview to open the full sheet.</p>
          </div>
        </div>

        <div className="invoice-final-preview-meta">
          <div className="invoice-final-preview-status-row">
            <p className="invoice-final-preview-invoice-number">{invoiceSubline}</p>
            {invoiceStatusChip ? (
              <span className={`iw-status-chip${invoiceStatusChip.className}`}>
                {invoiceStatusChip.label}
              </span>
            ) : null}
          </div>
          {isPaid && invoiceProp.paid_at ? (
            <span className="invoice-final-status-date">
              Paid {formatTimestampDate(invoiceProp.paid_at)}
            </span>
          ) : null}

          {!isReadOnly ? (
            <div className="invoice-final-notes-heading-slot">
              {!notesOpen ? (
                <button
                  type="button"
                  className="btn-text invoice-final-notes-toggle"
                  onClick={() => setNotesOpen(true)}
                >
                  Add Notes
                </button>
              ) : (
                <div className="invoice-final-notes-panel">
                  <div className="form-group">
                    <label htmlFor="invoice-notes">Notes</label>
                    <textarea
                      id="invoice-notes"
                      className="invoice-final-notes-input"
                      rows={3}
                      value={notesDraft}
                      onChange={(e) => setNotesDraft(e.target.value)}
                      autoComplete="off"
                    />
                  </div>
                  {notesError ? <p className="invoice-notes-error">{notesError}</p> : null}
                  <button
                    type="button"
                    className="btn-primary btn-large invoice-final-notes-save"
                    disabled={savingNotes}
                    onClick={() => void handleSaveNotes()}
                  >
                    {savingNotes ? 'Saving…' : 'Save Notes'}
                  </button>
                </div>
              )}
            </div>
          ) : null}
        </div>

        <div
          ref={previewViewportRef}
          className="agreement-preview-scale-viewport invoice-final-mini-viewport"
        >
          <div
            role="button"
            tabIndex={0}
            className="invoice-final-mini-preview-hitbox"
            aria-label="Open full invoice preview"
            onClick={() => setModalOpen(true)}
            onKeyDown={(e: KeyboardEvent<HTMLDivElement>) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                setModalOpen(true);
              }
            }}
          >
            <div
              className="agreement-preview-scale-spacer"
              style={{
                width: spacerWidth,
                height: spacerHeight,
              }}
            >
              <div
                ref={previewSheetRef}
                className="agreement-preview-scale-sheet"
                style={{
                  width: letterWidthPx,
                  transform: previewScale !== 1 ? `scale(${previewScale})` : undefined,
                  transformOrigin: 'top left',
                  willChange: previewScale !== 1 ? 'transform' : undefined,
                }}
              >
                <div
                  ref={documentRef}
                  dangerouslySetInnerHTML={{ __html: previewHtml }}
                />
              </div>
            </div>
          </div>
        </div>
      </section>

      <div className={`invoice-final-actions${showEditInvoiceButton ? '' : ' invoice-final-actions--single'}`}>
        <div className="invoice-final-download-slot">
          <button
            type="button"
            className="btn-primary btn-large invoice-final-download-btn"
            disabled={downloading || !canIssueInvoice}
            title={gateReason}
            onClick={() => void handleDownload()}
          >
            {downloading ? 'Downloading…' : 'Download Invoice'}
          </button>
        </div>
        {showEditInvoiceButton ? (
          <button
            type="button"
            className="btn-primary btn-large invoice-final-download-btn"
            onClick={onEditInvoice}
          >
            Edit Invoice
          </button>
        ) : null}
      </div>

      <InvoicePreviewModal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        htmlMarkup={previewHtml}
      />
    </div>
  );
}
