import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import type { Job, BusinessProfile, Invoice } from '../types/db';
import { generateInvoiceHtml } from '../lib/invoice-generator';
import { getInvoice, getInvoiceBusinessStatus, updateInvoice } from '../lib/db/invoices';
import { fetchWithSupabaseAuth } from '../lib/fetch-with-supabase-auth';
import { sendInvoice } from '../lib/invoice-send';
import { getWorkOrderSignatureState } from '../lib/work-order-signature';
import { InvoicePreviewModal } from './InvoicePreviewModal';
import { useScaledPreview } from '../hooks/useScaledPreview';
import {
  downloadPdfBlobToFile,
  fetchInvoicePdfBlob,
  getInvoicePdfFilename,
} from '../lib/agreement-pdf';
import './InvoiceFinalPage.css';

interface InvoiceFinalPageProps {
  invoice: Invoice;
  job: Job;
  profile: BusinessProfile;
  onBack: () => void;
  onEditInvoice: () => void;
  onInvoiceUpdated: (invoice: Invoice) => void;
  /** Navigate to Edit Profile (Stripe Connect lives there). */
  onOpenStripeSetup: () => void;
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

  const documentRef = useRef<HTMLDivElement | null>(null);
  const paymentLinkCopiedTimeoutRef = useRef<number | null>(null);
  const onInvoiceUpdatedRef = useRef(onInvoiceUpdated);
  useEffect(() => {
    onInvoiceUpdatedRef.current = onInvoiceUpdated;
  }, [onInvoiceUpdated]);

  const previewHtml = generateInvoiceHtml(invoiceProp, job, profile);
  const businessStatus = getInvoiceBusinessStatus(invoiceProp);
  const isIssued = businessStatus === 'invoiced';
  const isReadOnly = isIssued;
  const signatureState = useMemo(
    () => getWorkOrderSignatureState(job.esign_status, job.offline_signed_at),
    [job.esign_status, job.offline_signed_at]
  );
  const canIssueInvoice = signatureState.isSignatureSatisfied;
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
    void getInvoice(invoiceProp.id).then((row) => {
      if (row) onInvoiceUpdatedRef.current(row);
    });
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
  const isPaid = invoiceProp.payment_status === 'paid' || isPaidOffline;
  const invoiceStatusLabel =
    isPaid ? 'Paid' : isReadOnly ? 'Invoiced' : 'Draft';
  const invoiceStatusClass =
    isPaid
      ? ' invoice-final-status-badge--paid'
      : isReadOnly
        ? ' invoice-final-status-badge--issued'
        : ' invoice-final-status-badge--draft';

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
      const json = (await res.json()) as { error?: string; invoice?: Invoice };
      if (!res.ok) {
        setMarkPaidError(json.error ?? 'Could not mark invoice as paid.');
        return;
      }
      if (json.invoice) onInvoiceUpdated(json.invoice);
    } catch (err) {
      setMarkPaidError(err instanceof Error ? err.message : 'Could not mark invoice as paid.');
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

      <section className="invoice-final-payment-card" aria-labelledby="invoice-payment-heading">
        <h2 id="invoice-payment-heading">Send Invoice</h2>
        {(invoiceProp.issued_at || isPaid) && (
          <div className="invoice-issued-metadata">
            {invoiceProp.issued_at && (
              <span>
                Issued: {new Date(invoiceProp.issued_at).toLocaleDateString('en-US', {
                  month: 'short',
                  day: 'numeric',
                  year: 'numeric'
                })}
              </span>
            )}
            {isPaid && (
              <span className="invoice-paid-indicator">
                <span className="badge-paid">Paid</span>
                {invoiceProp.paid_at && (
                  <span className="invoice-paid-date">
                    {new Date(invoiceProp.paid_at).toLocaleDateString('en-US', {
                      month: 'short',
                      day: 'numeric',
                      year: 'numeric'
                    })}
                  </span>
                )}
              </span>
            )}
          </div>
        )}
        {isPaid ? (
          <p className="invoice-final-payment-text">
            This invoice has been paid{isPaidOffline ? ' (recorded offline)' : ''}.
          </p>
        ) : (
          <>
            {!canIssueInvoice && (
              <p className="invoice-gate-message">
                Invoice drafts can be created before signature. To issue an invoice, the work order
                must be signed via DocuSeal or marked as signed offline.
              </p>
            )}
            {sendError ? <p className="invoice-final-payment-feedback">{sendError}</p> : null}
            <div className="invoice-final-payment-primary">
              <button
                type="button"
                className="btn-primary btn-large invoice-final-send-primary"
                disabled={sending || !canIssueInvoice}
                onClick={() => void handleSendInvoice()}
              >
                {sending ? 'Sending...' : invoiceProp.issued_at ? 'Resend Invoice' : 'Send Invoice'}
              </button>
              <p className="invoice-final-payment-primary-hint">
                Emails the PDF invoice to the customer.
              </p>
            </div>

            {invoiceProp.issued_at && (
              <div className="invoice-final-offline-payment">
                {markPaidError ? (
                  <p className="invoice-final-payment-feedback">{markPaidError}</p>
                ) : null}
                <button
                  type="button"
                  className="btn-secondary invoice-final-mark-paid-btn"
                  disabled={markingPaid}
                  onClick={() => void handleMarkPaidOffline()}
                >
                  {markingPaid ? 'Saving...' : 'Mark as paid (offline)'}
                </button>
                <p className="invoice-final-payment-primary-hint">
                  Received cash, check, or bank transfer? Record it here.
                </p>
              </div>
            )}

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
                    className="btn-secondary btn-action invoice-final-connect-cta"
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
          <p className="invoice-final-preview-copy">Tap the preview to open the full sheet.</p>
        </div>

        <div className="invoice-final-preview-meta">
          <div className="invoice-final-preview-status-row">
            <p className="invoice-final-preview-invoice-number">{invoiceSubline}</p>
            <span className={`invoice-final-status-badge${invoiceStatusClass}`}>
              {invoiceStatusLabel}
            </span>
          </div>
          {isPaid && invoiceProp.paid_at ? (
            <span className="invoice-final-status-date">
              Paid{' '}
              {new Date(invoiceProp.paid_at).toLocaleDateString('en-US', {
                month: 'short',
                day: 'numeric',
                year: 'numeric',
              })}
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

      <div className="invoice-final-actions">
        <button
          type="button"
          className="btn-primary btn-large invoice-final-download-btn"
          disabled={downloading}
          onClick={() => void handleDownload()}
        >
          {downloading ? 'Downloading…' : 'Download Invoice'}
        </button>
        {!isReadOnly ? (
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
