import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type {
  BusinessProfile,
  ChangeOrder,
  ChangeOrderInvoiceStatus,
  Job,
} from '../types/db';
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
import { computeCOTotal, listChangeOrders } from '../lib/db/change-orders';
import {
  changeOrderInvoiceStatusMapFromRows,
  getBlocksNewChangeOrdersForJob,
  listInvoiceStatusByChangeOrder,
} from '../lib/db/invoices';
import './WorkOrderDetailPage.css';

interface WorkOrderDetailPageProps {
  userId: string;
  job: Job;
  profile: BusinessProfile | null;
  changeOrderListVersion?: number;
  onBack: () => void;
  onStartChangeOrder: () => void;
  onStartChangeOrderInvoice: (co: ChangeOrder, invoiceId: string | null) => void;
  onOpenCODetail: (co: ChangeOrder) => void;
}

export function WorkOrderDetailPage({
  userId,
  job,
  profile,
  changeOrderListVersion = 0,
  onBack,
  onStartChangeOrder,
  onStartChangeOrderInvoice,
  onOpenCODetail,
}: WorkOrderDetailPageProps) {
  const documentRef = useRef<HTMLDivElement | null>(null);

  const [pdfError, setPdfError] = useState('');
  const [downloading, setDownloading] = useState(false);
  const [changeOrders, setChangeOrders] = useState<ChangeOrder[]>([]);
  const [coLoading, setCoLoading] = useState(true);
  const [coError, setCoError] = useState('');
  const [coInvoiceStatusLoading, setCoInvoiceStatusLoading] = useState(true);
  const [coInvoiceStatusError, setCoInvoiceStatusError] = useState<string | null>(null);
  const [coInvoiceStatusRows, setCoInvoiceStatusRows] = useState<ChangeOrderInvoiceStatus[] | null>(
    null
  );
  const [coNewCoBlockLoading, setCoNewCoBlockLoading] = useState(true);
  const [coNewCoBlockError, setCoNewCoBlockError] = useState<string | null>(null);
  const [coNewCoBlockedByInvoice, setCoNewCoBlockedByInvoice] = useState(false);

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
    let cancelled = false;
    setCoInvoiceStatusLoading(true);
    setCoInvoiceStatusError(null);
    setCoInvoiceStatusRows(null);

    void (async () => {
      const result = await listInvoiceStatusByChangeOrder(userId, job.id);
      if (cancelled) return;
      setCoInvoiceStatusLoading(false);
      if (result.error) {
        setCoInvoiceStatusError(
          `Could not load invoice status (${result.error.message}). Invoice actions are unavailable.`
        );
        setCoInvoiceStatusRows(null);
      } else {
        setCoInvoiceStatusError(null);
        setCoInvoiceStatusRows(result.data);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [job.id, userId, changeOrderListVersion]);

  useEffect(() => {
    let cancelled = false;
    setCoNewCoBlockLoading(true);
    setCoNewCoBlockError(null);
    setCoNewCoBlockedByInvoice(false);

    void (async () => {
      const result = await getBlocksNewChangeOrdersForJob(userId, job.id);
      if (cancelled) return;
      setCoNewCoBlockLoading(false);
      if (result.error) {
        setCoNewCoBlockedByInvoice(false);
        setCoNewCoBlockError(
          `Could not verify whether new change orders are allowed (${result.error.message}). Create Change Order is disabled.`
        );
      } else {
        setCoNewCoBlockError(null);
        setCoNewCoBlockedByInvoice(result.blocks);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [job.id, userId, changeOrderListVersion]);

  const createChangeOrderDisabled =
    downloading || coNewCoBlockLoading || coNewCoBlockError !== null || coNewCoBlockedByInvoice;

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

  const coInvoiceById = useMemo(() => {
    if (coInvoiceStatusRows === null) return null;
    return changeOrderInvoiceStatusMapFromRows(coInvoiceStatusRows);
  }, [coInvoiceStatusRows]);

  const downloadCombinedPdf = async () => {
    setPdfError('');
    setDownloading(true);
    try {
      const innerWo = `<div class="agreement-document">${agreementSectionsToHtml(sections)}</div>`;
      const combined = buildCombinedWorkOrderAndChangeOrdersHtml(innerWo, changeOrders, job, profile);
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

      <h2 className="co-list-heading"><span>Change Orders</span></h2>
      {coNewCoBlockError ? (
        <p className="work-orders-empty" role="alert">
          {coNewCoBlockError}
        </p>
      ) : null}
      {!coNewCoBlockLoading && !coNewCoBlockError && coNewCoBlockedByInvoice ? (
        <p className="work-orders-empty">Work order invoice has been finalized. New change orders cannot be added.</p>
      ) : null}
      {coInvoiceStatusError ? (
        <p className="work-orders-empty" role="alert">
          {coInvoiceStatusError}
        </p>
      ) : null}
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
          {changeOrders.map((co) => {
            const inv = coInvoiceById?.get(co.id) ?? null;
            return (
              <li key={co.id} className="co-list-item">
                <div className="work-orders-row-main">
                  <button
                    type="button"
                    className="work-orders-row-detail-hit"
                    onClick={() => onOpenCODetail(co)}
                  >
                    <span className="co-list-desc">{co.description || '—'}</span>
                    <span className="co-list-amount">${computeCOTotal(co.line_items).toFixed(2)}</span>
                    <span className="co-list-number">CO #{String(co.co_number).padStart(4, '0')}</span>
                  </button>
                </div>
                <div className="work-orders-row-actions">
                  {coInvoiceStatusLoading ? (
                    <button
                      type="button"
                      className="wo-row-create-invoice-outline work-orders-invoice-status-loading"
                      disabled
                      aria-busy="true"
                    >
                      Loading…
                    </button>
                  ) : coInvoiceStatusError ? (
                    <button
                      type="button"
                      className="wo-row-create-invoice-outline work-orders-invoice-status-unavailable"
                      disabled
                    >
                      Unavailable
                    </button>
                  ) : !inv ? (
                    <button
                      type="button"
                      className="wo-row-create-invoice-outline"
                      onClick={() => onStartChangeOrderInvoice(co, null)}
                    >
                      Invoice
                    </button>
                  ) : inv.status === 'draft' ? (
                    <button
                      type="button"
                      className="badge-pending"
                      onClick={() => onStartChangeOrderInvoice(co, inv.id)}
                    >
                      Pending
                    </button>
                  ) : (
                    <button
                      type="button"
                      className="badge-invoiced"
                      onClick={() => onStartChangeOrderInvoice(co, inv.id)}
                    >
                      Invoiced
                    </button>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}

      <div className="work-order-detail-footer">
        <button
          type="button"
          className="btn-secondary btn-large work-order-detail-download"
          data-testid="wo-detail-create-change-order"
          disabled={createChangeOrderDisabled}
          title={
            coNewCoBlockLoading
              ? 'Loading…'
              : coNewCoBlockError
                ? 'Could not verify billing state'
                : coNewCoBlockedByInvoice
                  ? 'Work order invoice finalized'
                  : undefined
          }
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
          disabled={downloading || changeOrders.length === 0}
          onClick={() => void downloadCombinedPdf()}
          title={changeOrders.length === 0 ? 'No change orders' : undefined}
        >
          Download WO + Changes
        </button>
      </div>
    </div>
  );
}
