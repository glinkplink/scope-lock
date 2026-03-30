import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import type { Job, BusinessProfile, Invoice } from '../types/db';
import { generateInvoiceHtml } from '../lib/invoice-generator';
import { getInvoiceBusinessStatus, updateInvoice } from '../lib/db/invoices';
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
  onWorkOrders: () => void;
  onEditInvoice: () => void;
  onInvoiceUpdated: (invoice: Invoice) => void;
}

export function InvoiceFinalPage({
  invoice: invoiceProp,
  job,
  profile,
  onWorkOrders,
  onEditInvoice,
  onInvoiceUpdated,
}: InvoiceFinalPageProps) {
  const [modalOpen, setModalOpen] = useState(false);
  const [notesOpen, setNotesOpen] = useState(false);
  const [notesDraft, setNotesDraft] = useState(() => invoiceProp.notes ?? '');
  const [downloadError, setDownloadError] = useState('');
  const [notesError, setNotesError] = useState('');
  const [downloading, setDownloading] = useState(false);
  const [savingNotes, setSavingNotes] = useState(false);

  const documentRef = useRef<HTMLDivElement | null>(null);

  const previewHtml = generateInvoiceHtml(invoiceProp, job, profile);
  const businessStatus = getInvoiceBusinessStatus(invoiceProp);
  const isIssued = businessStatus === 'invoiced';
  const isReadOnly = isIssued;
  const customerTitle = job.customer_name.trim() || 'Customer';
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
        <button type="button" className="invoice-final-nav-plain" onClick={onWorkOrders}>
          Go Back
        </button>
      </div>

      <hgroup>
        <h1 className="invoice-final-heading">{customerTitle}</h1>
        <p className="invoice-final-heading-sub">{invoiceSubline}</p>
      </hgroup>

      {!isReadOnly ? (
        <div className="invoice-final-notes-heading-slot">
          {!notesOpen ? (
            <button type="button" className="btn-text invoice-final-notes-toggle" onClick={() => setNotesOpen(true)}>
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

      {downloadError ? (
        <div className="error-banner" role="alert">
          {downloadError}
        </div>
      ) : null}

      <section className="invoice-final-payment-card" aria-labelledby="invoice-payment-heading">
        <h2 id="invoice-payment-heading">
          Send Invoice
        </h2>
        {invoiceProp.issued_at && (
          <div className="invoice-issued-metadata">
            Issued: {new Date(invoiceProp.issued_at).toLocaleDateString('en-US', {
              month: 'short',
              day: 'numeric',
              year: 'numeric'
            })}
          </div>
        )}
        <p className="invoice-final-payment-text">
          Payment links coming soon. Download the PDF to share manually in the meantime.
        </p>
        <div className="invoice-final-payment-actions">
          <button disabled className="btn-secondary btn-action">Send Invoice (Coming Soon)</button>
          <button disabled className="btn-primary btn-action" title="Stripe payment links coming soon">Copy Payment Link</button>
        </div>
      </section>

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
