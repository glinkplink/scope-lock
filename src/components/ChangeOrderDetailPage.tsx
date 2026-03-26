import { useMemo, useState } from 'react';
import type { Job, BusinessProfile, ChangeOrder, Invoice } from '../types/db';
import {
  fetchHtmlPdfBlob,
  getCoPdfFilename,
  getPdfFooterBusinessName,
  getPdfFooterPhone,
  downloadPdfBlobToFile,
} from '../lib/agreement-pdf';
import { generateChangeOrderHtml } from '../lib/change-order-generator';
import { computeCOTotal, deleteChangeOrder, updateChangeOrder } from '../lib/db/change-orders';
import { jobRowToWelderJob } from '../lib/job-to-welder-job';
import './ChangeOrderDetailPage.css';

function statusBadgeClass(status: ChangeOrder['status']): string {
  if (status === 'pending_approval') return 'pending';
  return status;
}

interface ChangeOrderDetailPageProps {
  co: ChangeOrder;
  job: Job;
  profile: BusinessProfile | null;
  invoice: Invoice | null;
  onBack: () => void;
  onEdit: (co: ChangeOrder) => void;
  onDelete: () => void;
  onStartInvoice: () => void;
  onOpenPendingInvoice: (inv: Invoice) => void;
}

export function ChangeOrderDetailPage({
  co,
  job,
  profile,
  invoice,
  onBack,
  onEdit,
  onDelete,
  onStartInvoice,
  onOpenPendingInvoice,
}: ChangeOrderDetailPageProps) {
  const [pdfError, setPdfError] = useState('');
  const [downloading, setDownloading] = useState(false);

  const coLabel = `CO #${String(co.co_number).padStart(4, '0')}`;
  const customerTitle = job.customer_name.trim() || 'Customer';
  const total = computeCOTotal(co.line_items);

  const welderJob = useMemo(() => jobRowToWelderJob(job, profile), [job, profile]);
  const footerMeta = useMemo(() => ({
    providerName: getPdfFooterBusinessName(profile, welderJob),
    providerPhone: getPdfFooterPhone(profile, welderJob),
  }), [profile, welderJob]);

  const handleDownload = async () => {
    setPdfError('');
    setDownloading(true);
    try {
      const inner = generateChangeOrderHtml(co, job, profile);
      const filename = getCoPdfFilename(co.co_number, job.customer_name);
      const blob = await fetchHtmlPdfBlob({
        filename,
        innerMarkup: inner,
        marginHeaderLeft: coLabel,
        providerName: footerMeta.providerName,
        providerPhone: footerMeta.providerPhone,
      });
      downloadPdfBlobToFile(blob, filename);
    } catch (e) {
      setPdfError(e instanceof Error ? e.message : 'PDF download failed.');
    } finally {
      setDownloading(false);
    }
  };

  const handleDelete = async () => {
    if (!window.confirm(`Delete ${coLabel}?`)) return;
    const { error } = await deleteChangeOrder(co.id);
    if (error) {
      setPdfError(error.message);
      return;
    }
    onDelete();
  };

  const handleApprove = async () => {
    const { error } = await updateChangeOrder(co.id, { status: 'approved' });
    if (error) { setPdfError(error.message); return; }
    onBack();
  };

  const handleReject = async () => {
    const { error } = await updateChangeOrder(co.id, { status: 'rejected' });
    if (error) { setPdfError(error.message); return; }
    onBack();
  };

  const innerHtml = generateChangeOrderHtml(co, job, profile);

  return (
    <div className="work-order-detail-page">
      <div className="invoice-final-nav">
        <button type="button" className="invoice-final-nav-plain" onClick={onBack}>
          Go Back
        </button>
      </div>
      <hgroup>
        <h1 className="invoice-final-heading">{customerTitle}</h1>
        <p className="invoice-final-heading-sub">{coLabel}</p>
      </hgroup>

      {pdfError ? (
        <div className="error-banner" role="alert">
          {pdfError}
        </div>
      ) : null}

      <div className="co-detail-meta-row">
        <span className={`co-status-badge ${statusBadgeClass(co.status)}`}>
          {co.status.replace('_', ' ')}
        </span>
        <span className="co-detail-total">${total.toFixed(2)}</span>
        <div className="work-orders-row-actions">
          {!invoice ? (
            <button type="button" className="wo-row-create-invoice-outline" onClick={onStartInvoice}>
              Invoice
            </button>
          ) : invoice.status === 'draft' ? (
            <button type="button" className="badge-pending" onClick={() => onOpenPendingInvoice(invoice)}>
              Pending
            </button>
          ) : (
            <button type="button" className="badge-invoiced" onClick={() => onOpenPendingInvoice(invoice)}>
              Invoiced
            </button>
          )}
        </div>
      </div>

      <div className="work-order-detail-scroll">
        <div
          className="agreement-document work-order-detail-document"
          dangerouslySetInnerHTML={{ __html: innerHtml }}
        />
      </div>

      <div className="work-order-detail-footer">
        {co.requires_approval && co.status === 'pending_approval' ? (
          <>
            <button
              type="button"
              className="btn-secondary btn-large work-order-detail-download"
              onClick={() => void handleApprove()}
            >
              Approve
            </button>
            <button
              type="button"
              className="btn-secondary btn-large work-order-detail-download"
              onClick={() => void handleReject()}
            >
              Reject
            </button>
          </>
        ) : null}
        <button
          type="button"
          className="btn-secondary btn-large work-order-detail-download"
          onClick={() => onEdit(co)}
        >
          Edit
        </button>
        <button
          type="button"
          className="btn-primary btn-large work-order-detail-download"
          disabled={downloading}
          onClick={() => void handleDownload()}
        >
          {downloading ? 'Downloading…' : 'Download CO'}
        </button>
        <button
          type="button"
          className="btn-text co-detail-delete"
          onClick={() => void handleDelete()}
        >
          Delete
        </button>
      </div>
    </div>
  );
}
