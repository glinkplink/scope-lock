import { useLayoutEffect, useRef, useState } from 'react';
import type { Job, BusinessProfile, Invoice } from '../types/db';
import { generateInvoiceHtml } from '../lib/invoice-generator';
import { markInvoiceDownloaded, updateInvoice } from '../lib/db/invoices';
import { InvoicePreviewModal } from './InvoicePreviewModal';
import appCss from '../App.css?raw';

const PREVIEW_LETTER_WIDTH_PX = 816;
const PREVIEW_DESKTOP_UPSCALE_MQ = '(min-width: 1024px)';

function getInvoicePdfFilename(invoiceNumber: number, customerName: string): string {
  const sanitized = (customerName || 'customer').replace(/\s+/g, '_');
  return `Invoice_${String(invoiceNumber).padStart(4, '0')}_${sanitized}.pdf`;
}

function getMarginHeaderLeft(invoiceNumber: number): string {
  return `Invoice #${String(invoiceNumber).padStart(4, '0')}`;
}

function getPdfFooterBusinessName(profile: BusinessProfile | null): string {
  return profile?.business_name?.trim() ?? '';
}

function getPdfFooterPhone(profile: BusinessProfile | null): string {
  return profile?.phone ?? '';
}

function buildPdfHtml(previewMarkup: string): string {
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <link rel="preconnect" href="https://fonts.googleapis.com" />
    <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
    <link
      href="https://fonts.googleapis.com/css2?family=Barlow:wght@400;500;600;700&amp;family=Dancing+Script:wght@400;700&amp;display=swap"
      rel="stylesheet"
    />
    <style>
      ${appCss}

      :root {
        color-scheme: light;
      }

      html,
      body {
        margin: 0;
        padding: 0;
        background: #ffffff;
      }

      body {
        font-family: 'Barlow', 'DIN 2014', 'Bahnschrift', 'D-DIN', system-ui, sans-serif;
        letter-spacing: normal;
        word-spacing: normal;
        -webkit-font-smoothing: antialiased;
      }

      p {
        text-align: left;
        line-height: 1.4;
        word-break: normal;
        overflow-wrap: break-word;
      }

      .pdf-render-root {
        padding: 0;
        background: #ffffff;
      }

      .agreement-document {
        border: none;
        border-radius: 0;
        box-shadow: none;
        padding: 0;
      }

      .content-table {
        border: 1px solid #cccccc;
        border-collapse: collapse;
      }

      .content-table td {
        border: 1px solid #cccccc;
        padding: 0.7rem 0.8rem;
      }

      .content-table.parties-party-table th.party-header-cell {
        border: 1px solid #cccccc;
        padding: 0.7rem 0.8rem;
        -webkit-print-color-adjust: exact;
        print-color-adjust: exact;
      }

      .table-label {
        -webkit-print-color-adjust: exact;
        print-color-adjust: exact;
      }

      .content-bullets {
        list-style-type: disc;
        list-style-position: outside;
        padding-left: 1.35rem;
        margin-left: 0;
      }

      .content-bullets li {
        display: list-item;
      }
    </style>
  </head>
  <body>
    <div class="pdf-render-root">${previewMarkup}</div>
  </body>
</html>`;
}

async function fetchInvoicePdfBlob(
  invoice: Invoice,
  job: Job,
  profile: BusinessProfile | null,
  previewRoot: HTMLElement
): Promise<Blob> {
  const response = await fetch('/api/pdf', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      filename: getInvoicePdfFilename(invoice.invoice_number, job.customer_name),
      html: buildPdfHtml(previewRoot.outerHTML),
      marginHeaderLeft: getMarginHeaderLeft(invoice.invoice_number),
      providerName: getPdfFooterBusinessName(profile),
      providerPhone: getPdfFooterPhone(profile),
    }),
  });

  if (!response.ok) {
    const message = await response.text();
    throw new Error(message || 'Failed to generate PDF.');
  }

  return response.blob();
}

function downloadInvoicePdfBlob(blob: Blob, invoice: Invoice, job: Job): void {
  const objectUrl = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = objectUrl;
  link.download = getInvoicePdfFilename(invoice.invoice_number, job.customer_name);
  document.body.append(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(objectUrl);
}

interface InvoiceFinalPageProps {
  invoice: Invoice;
  job: Job;
  profile: BusinessProfile;
  onGoHome: () => void;
  onWorkOrders: () => void;
  onEditInvoice: () => void;
  onAfterDownload: (invoice: Invoice) => void;
  onInvoiceUpdated: (invoice: Invoice) => void;
}

export function InvoiceFinalPage({
  invoice: invoiceProp,
  job,
  profile,
  onGoHome,
  onWorkOrders,
  onEditInvoice,
  onAfterDownload,
  onInvoiceUpdated,
}: InvoiceFinalPageProps) {
  const [invoice, setInvoice] = useState(invoiceProp);
  const [modalOpen, setModalOpen] = useState(false);
  const [notesOpen, setNotesOpen] = useState(false);
  const [notesDraft, setNotesDraft] = useState(invoiceProp.notes ?? '');
  const [downloadError, setDownloadError] = useState('');
  const [notesError, setNotesError] = useState('');
  const [downloading, setDownloading] = useState(false);
  const [savingNotes, setSavingNotes] = useState(false);

  const documentRef = useRef<HTMLDivElement | null>(null);
  const previewViewportRef = useRef<HTMLDivElement | null>(null);
  const previewSheetRef = useRef<HTMLDivElement | null>(null);
  const [previewContentHeight, setPreviewContentHeight] = useState(0);
  const [previewScale, setPreviewScale] = useState(1);

  const previewHtml = generateInvoiceHtml(invoice, job, profile);

  useLayoutEffect(() => {
    setInvoice(invoiceProp);
    setNotesDraft(invoiceProp.notes ?? '');
  }, [invoiceProp]);

  useLayoutEffect(() => {
    const viewport = previewViewportRef.current;
    if (!viewport) return;

    const computeScale = () => {
      const w = viewport.getBoundingClientRect().width;
      if (w <= 0) return 1;
      const maxScale = window.matchMedia(PREVIEW_DESKTOP_UPSCALE_MQ).matches ? 1.5 : 1;
      return Math.min(w / PREVIEW_LETTER_WIDTH_PX, maxScale);
    };

    const updateScale = () => setPreviewScale(computeScale());
    updateScale();
    const ro = new ResizeObserver(updateScale);
    ro.observe(viewport);
    const mq = window.matchMedia(PREVIEW_DESKTOP_UPSCALE_MQ);
    mq.addEventListener('change', updateScale);
    window.addEventListener('resize', updateScale);
    return () => {
      ro.disconnect();
      mq.removeEventListener('change', updateScale);
      window.removeEventListener('resize', updateScale);
    };
  }, []);

  useLayoutEffect(() => {
    const sheet = previewSheetRef.current;
    if (!sheet) return;
    const updateHeight = () => setPreviewContentHeight(sheet.scrollHeight);
    updateHeight();
    const ro = new ResizeObserver(updateHeight);
    ro.observe(sheet);
    return () => ro.disconnect();
  }, [invoice, job, profile]);

  const handleDownload = async () => {
    setDownloadError('');
    if (!documentRef.current) {
      setDownloadError('Preview is not ready. Try again.');
      return;
    }
    setDownloading(true);
    try {
      const blob = await fetchInvoicePdfBlob(invoice, job, profile, documentRef.current);
      downloadInvoicePdfBlob(blob, invoice, job);
      const { error } = await markInvoiceDownloaded(invoice.id);
      if (error) {
        setDownloadError(`PDF downloaded, but status could not be updated: ${error.message}`);
      }
      const nextInv = { ...invoice, status: 'downloaded' as const };
      setInvoice(nextInv);
      onInvoiceUpdated(nextInv);
      onAfterDownload(nextInv);
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
        ...invoice,
        notes: notesDraft.trim() || null,
      };
      const { data, error } = await updateInvoice(next);
      if (error || !data) {
        setNotesError(error?.message || 'Could not save notes.');
        return;
      }
      setInvoice(data);
      onInvoiceUpdated(data);
    } finally {
      setSavingNotes(false);
    }
  };

  return (
    <div className="invoice-final-page">
      <div className="invoice-final-nav">
        <button type="button" className="btn-secondary" onClick={onGoHome}>
          Go Home
        </button>
        <button type="button" className="btn-secondary" onClick={onWorkOrders}>
          Work Orders
        </button>
      </div>

      <h1 className="invoice-final-heading">
        Invoice #{String(invoice.invoice_number).padStart(4, '0')} Ready
      </h1>

      {downloadError ? (
        <div className="error-banner" role="alert">
          {downloadError}
        </div>
      ) : null}

      <div
        ref={previewViewportRef}
        className="agreement-preview-scale-viewport invoice-final-mini-viewport"
      >
        <button
          type="button"
          className="invoice-final-mini-preview-hitbox"
          onClick={() => setModalOpen(true)}
          aria-label="Open full invoice preview"
        >
          <div
            className="agreement-preview-scale-spacer"
            style={{
              width: PREVIEW_LETTER_WIDTH_PX * previewScale,
              height: previewContentHeight * previewScale,
            }}
          >
            <div
              ref={previewSheetRef}
              className="agreement-preview-scale-sheet"
              style={{
                width: PREVIEW_LETTER_WIDTH_PX,
                transform: previewScale !== 1 ? `scale(${previewScale})` : undefined,
                transformOrigin: 'top left',
              }}
            >
              <div
                ref={documentRef}
                dangerouslySetInnerHTML={{ __html: previewHtml }}
              />
            </div>
          </div>
        </button>
      </div>

      <div className="invoice-final-actions">
        <button
          type="button"
          className="btn-action btn-primary"
          disabled={downloading}
          onClick={() => void handleDownload()}
        >
          {downloading ? 'Downloading…' : 'Download Invoice'}
        </button>
        <button type="button" className="btn-secondary invoice-final-edit-btn" onClick={onEditInvoice}>
          Edit Invoice
        </button>
      </div>

      <div className="invoice-final-notes">
        {!notesOpen ? (
          <button type="button" className="btn-text invoice-final-notes-toggle" onClick={() => setNotesOpen(true)}>
            Add Notes
          </button>
        ) : (
          <div className="invoice-final-notes-panel">
            <label className="field-label" htmlFor="invoice-notes">
              Notes
            </label>
            <textarea
              id="invoice-notes"
              className="field-input invoice-notes-textarea"
              rows={4}
              value={notesDraft}
              onChange={(e) => setNotesDraft(e.target.value)}
            />
            {notesError ? <p className="invoice-notes-error">{notesError}</p> : null}
            <button
              type="button"
              className="btn-primary"
              disabled={savingNotes}
              onClick={() => void handleSaveNotes()}
            >
              {savingNotes ? 'Saving…' : 'Save Notes'}
            </button>
          </div>
        )}
      </div>

      <InvoicePreviewModal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        htmlMarkup={previewHtml}
      />
    </div>
  );
}
