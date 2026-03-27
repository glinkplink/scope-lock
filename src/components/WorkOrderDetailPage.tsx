import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Job, BusinessProfile, ChangeOrder, Invoice } from '../types/db';
import { generateAgreement } from '../lib/agreement-generator';
import { jobRowToWelderJob } from '../lib/job-to-welder-job';
import {
  downloadAgreementPdfBlob,
  fetchAgreementPdfBlob,
  fetchHtmlPdfBlob,
  getPdfFilename,
  getPdfFooterBusinessName,
  getPdfFooterPhone,
  getWorkOrderHeaderLabel,
  downloadPdfBlobToFile,
} from '../lib/agreement-pdf';
import { agreementSectionsToHtml } from '../lib/agreement-sections-html';
import { buildCombinedWorkOrderAndChangeOrdersHtml } from '../lib/change-order-generator';
import { AgreementDocumentSections } from './AgreementDocumentSections';
import { listChangeOrders, computeCOTotal } from '../lib/db/change-orders';
import { getInvoiceByJobId } from '../lib/db/invoices';
import './WorkOrderDetailPage.css';

interface WorkOrderDetailPageProps {
  job: Job;
  profile: BusinessProfile | null;
  changeOrderListVersion?: number;
  onBack: () => void;
  onStartChangeOrder: () => void;
  onStartInvoice: (inv: Invoice | null) => void;
  onOpenCODetail: (co: ChangeOrder) => void;
}

export function WorkOrderDetailPage({
  job,
  profile,
  changeOrderListVersion = 0,
  onBack,
  onStartChangeOrder,
  onStartInvoice,
  onOpenCODetail,
}: WorkOrderDetailPageProps) {
  const documentRef = useRef<HTMLDivElement | null>(null);

  const [pdfError, setPdfError] = useState('');
  const [downloading, setDownloading] = useState(false);
  const [changeOrders, setChangeOrders] = useState<ChangeOrder[]>([]);
  const [coLoading, setCoLoading] = useState(true);
  const [coError, setCoError] = useState('');
  const [invoice, setInvoice] = useState<Invoice | null>(null);

  const welderJob = useMemo(() => jobRowToWelderJob(job, profile), [job, profile]);
  const sections = useMemo(() => generateAgreement(welderJob, profile), [welderJob, profile]);

  const woLabel =
    job.wo_number != null ? `WO #${String(job.wo_number).padStart(4, '0')}` : 'WO (no #)';
  const customerTitle = job.customer_name.trim() || 'Customer';

  const loadCOs = useCallback(async () => {
    setCoLoading(true);
    setCoError('');
    try {
      const rows = await listChangeOrders(job.id);
      setChangeOrders(rows);
    } catch {
      setCoError('Could not load change orders.');
      setChangeOrders([]);
    } finally {
      setCoLoading(false);
    }
  }, [job.id]);

  useEffect(() => {
    void loadCOs();
  }, [loadCOs, changeOrderListVersion]);

  useEffect(() => {
    void getInvoiceByJobId(job.id).then(setInvoice);
  }, [job.id]);

  const handleDownloadPdf = async () => {
    setPdfError('');
    if (!documentRef.current) {
      setPdfError('Document is not ready. Try again.');
      return;
    }
    setDownloading(true);
    try {
      const blob = await fetchAgreementPdfBlob(welderJob, profile, documentRef.current);
      downloadAgreementPdfBlob(blob, welderJob);
    } catch (e) {
      setPdfError(e instanceof Error ? e.message : 'PDF download failed.');
    } finally {
      setDownloading(false);
    }
  };

  const footerMeta = useMemo(() => {
    return {
      providerName: getPdfFooterBusinessName(profile, welderJob),
      providerPhone: getPdfFooterPhone(profile, welderJob),
    };
  }, [profile, welderJob]);

  const downloadCombinedPdf = async () => {
    setPdfError('');
    setDownloading(true);
    try {
      const innerWo = `<div class="agreement-document">${agreementSectionsToHtml(sections)}</div>`;
      const approved = changeOrders.filter((c) => c.status === 'approved');
      const combined = buildCombinedWorkOrderAndChangeOrdersHtml(
        innerWo,
        approved,
        job,
        profile
      );
      const blob = await fetchHtmlPdfBlob({
        filename: getPdfFilename(welderJob.wo_number, job.customer_name),
        innerMarkup: combined,
        workOrderNumber: getWorkOrderHeaderLabel(welderJob),
        providerName: footerMeta.providerName,
        providerPhone: footerMeta.providerPhone,
      });
      downloadPdfBlobToFile(blob, getPdfFilename(welderJob.wo_number, job.customer_name));
    } catch (e) {
      setPdfError(e instanceof Error ? e.message : 'PDF download failed.');
    } finally {
      setDownloading(false);
    }
  };

  const approvedCount = changeOrders.filter((c) => c.status === 'approved').length;

  return (
    <div className="work-order-detail-page">
      <div className="invoice-final-nav">
        <button type="button" className="invoice-final-nav-plain" onClick={onBack}>
          Go Back
        </button>
      </div>
      <hgroup>
        <h1 className="invoice-final-heading">{customerTitle}</h1>
        <p className="invoice-final-heading-sub">{woLabel}</p>
      </hgroup>

      {pdfError ? (
        <div className="error-banner" role="alert">
          {pdfError}
        </div>
      ) : null}

      <div className="work-order-detail-scroll">
        <div ref={documentRef} className="agreement-document work-order-detail-document">
          <AgreementDocumentSections sections={sections} />
        </div>
      </div>

      <p className="co-section-label" style={{ marginTop: 'var(--space-lg)' }}>
        Invoice
      </p>
      <div className="work-orders-row wo-detail-invoice-strip">
        <div className="work-orders-row-main">
          <span className="work-orders-meta wo-detail-invoice-meta">
            {invoice
              ? `Invoice #${String(invoice.invoice_number).padStart(4, '0')}`
              : 'No invoice yet for this work order.'}
          </span>
        </div>
        <div className="work-orders-row-actions">
          {!invoice ? (
            <button type="button" className="wo-row-create-invoice-outline" onClick={() => onStartInvoice(null)}>
              Invoice
            </button>
          ) : invoice.status === 'draft' ? (
            <button type="button" className="badge-pending" onClick={() => onStartInvoice(invoice)}>
              Pending
            </button>
          ) : (
            <button type="button" className="badge-invoiced" onClick={() => onStartInvoice(invoice)}>
              Invoiced
            </button>
          )}
        </div>
      </div>

      <p className="co-section-label" style={{ marginTop: 'var(--space-lg)' }}>
        Change orders
      </p>
      {coError ? (
        <p className="work-orders-empty" role="alert">
          {coError}
        </p>
      ) : coLoading ? (
        <p className="work-orders-loading">Loading change orders…</p>
      ) : changeOrders.length === 0 ? (
        <p className="work-orders-empty">No change orders yet.</p>
      ) : (
        <ul className="work-orders-list" style={{ listStyle: 'none', margin: '0 0 var(--space-lg)', padding: 0 }}>
          {changeOrders.map((co) => (
            <li key={co.id} className="co-list-item">
              <div className="work-orders-row-main">
                <button
                  type="button"
                  className="work-orders-row-detail-hit"
                  onClick={() => onOpenCODetail(co)}
                >
                  <span className="co-list-number">CO #{String(co.co_number).padStart(4, '0')}</span>
                  <span className="co-list-desc">{co.description || '—'}</span>
                </button>
                <span className="work-orders-meta">
                  <span className={`co-status-badge ${co.status === 'pending_approval' ? 'pending' : co.status}`}>{co.status.replace('_', ' ')}</span>
                  {' '}${computeCOTotal(co.line_items).toFixed(2)}
                </span>
              </div>
            </li>
          ))}
        </ul>
      )}

      <div className="work-order-detail-footer">
        <button
          type="button"
          className="btn-secondary btn-large work-order-detail-download"
          disabled={downloading}
          onClick={() => onStartChangeOrder()}
        >
          Create Change Order
        </button>
        <button
          type="button"
          className="btn-primary btn-large work-order-detail-download"
          disabled={downloading}
          onClick={() => void handleDownloadPdf()}
        >
          {downloading ? 'Downloading…' : 'Download Work Order'}
        </button>
        <button
          type="button"
          className="btn-secondary btn-large work-order-detail-download"
          disabled={downloading || approvedCount === 0}
          onClick={() => void downloadCombinedPdf()}
          title={approvedCount === 0 ? 'No approved change orders' : undefined}
        >
          Download WO + Changes
        </button>
      </div>
    </div>
  );
}
