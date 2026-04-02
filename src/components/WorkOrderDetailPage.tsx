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
import { buildDocusealWorkOrderHtmlDocument } from '../lib/docuseal-agreement-html';
import {
  buildDocusealEsignFooterLine,
  buildDocusealHtmlFooter,
  buildDocusealHtmlHeader,
} from '../lib/docuseal-header-footer';
import {
  mergeEsignResponseIntoJob,
  pollWorkOrderEsignStatus,
  resendWorkOrderSignature,
  sendWorkOrderForSignature,
  downloadSignedDocumentFile,
} from '../lib/esign-api';
import { getJobById, updateJob } from '../lib/db/jobs';
import { jobLocationSingleLine } from '../lib/job-site-address';
import { formatEsignTimestamp, shouldPollEsignStatus } from '../lib/esign-live';
import { useEsignPoller } from '../hooks/useEsignPoller';
import { getEsignProgressModel } from '../lib/esign-progress';
import { getWorkOrderSignatureState } from '../lib/work-order-signature';
import { agreementSectionsToHtml } from '../lib/agreement-sections-html';
import { buildCombinedWorkOrderAndChangeOrdersHtml } from '../lib/change-order-generator';
import { buildDocusealProviderSignatureImage } from '../lib/docuseal-signature-image';
import '../lib/change-order-document.css';
import { AgreementDocumentSections } from './AgreementDocumentSections';
import { computeCOTotal, listChangeOrders } from '../lib/db/change-orders';
import {
  changeOrderInvoiceStatusMapFromRows,
  getInvoiceBusinessStatus,
  getBlocksNewChangeOrdersForJob,
  listInvoiceStatusByChangeOrder,
  listInvoiceStatusByJob,
} from '../lib/db/invoices';
import type { WorkOrderInvoiceStatus } from '../lib/db/invoices';
import './WorkOrderDetailPage.css';

const ROW_DATE_FORMATTER = new Intl.DateTimeFormat('en-US', {
  year: 'numeric',
  month: 'short',
  day: 'numeric',
});

function formatRowDate(raw: string | null | undefined): string {
  const dateOnly = raw?.split('T')[0] || '';
  if (!dateOnly) return '—';
  const [y, m, d] = dateOnly.split('-').map(Number);
  if (!y || !m || !d) return raw ?? '—';
  return ROW_DATE_FORMATTER.format(new Date(y, m - 1, d));
}

function renderEsignStrip(status: ChangeOrder['esign_status']) {
  const progress = getEsignProgressModel(status, 'change_order');
  if (status === 'not_sent') return null;

  return (
    <span
      className="esign-strip"
      title={`E-signature: ${progress.title}`}
      aria-label={`E-signature status: ${progress.title}`}
    >
      {progress.steps.map((step) => (
        <span
          key={step.key}
          className={`esign-strip-segment esign-strip-segment-${step.tone}`}
          aria-hidden="true"
        />
      ))}
      <span className="esign-strip-text">{progress.title}</span>
    </span>
  );
}

interface WorkOrderDetailPageProps {
  userId: string;
  jobId: string;
  job?: Job | null;
  profile: BusinessProfile | null;
  changeOrderListVersion?: number;
  initialScrollTarget?: 'top' | 'change-orders';
  onJobLoaded?: (job: Job) => void;
  onJobUpdated?: (job: Job) => void;
  onBack: () => void;
  onStartChangeOrder: () => void;
  onStartChangeOrderInvoice: (co: ChangeOrder, invoiceId: string | null) => void;
  onOpenCODetail: (co: ChangeOrder) => void;
}

export function WorkOrderDetailPage({
  userId,
  jobId,
  job: initialJob = null,
  profile,
  changeOrderListVersion = 0,
  initialScrollTarget = 'top',
  onJobLoaded,
  onJobUpdated,
  onBack,
  onStartChangeOrder,
  onStartChangeOrderInvoice,
  onOpenCODetail,
}: WorkOrderDetailPageProps) {
  const documentRef = useRef<HTMLDivElement | null>(null);
  const changeOrdersSectionRef = useRef<HTMLElement | null>(null);
  const copySigningLinkTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const initialScrollHandledRef = useRef(false);

  const [pdfError, setPdfError] = useState('');
  const [esignError, setEsignError] = useState('');
  const [esignBusy, setEsignBusy] = useState(false);
  const [saveError, setSaveError] = useState('');
  const [saveBusy, setSaveBusy] = useState(false);
  const [signedDocBusy, setSignedDocBusy] = useState(false);
  const [esignSigningLinkCopied, setEsignSigningLinkCopied] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [hydratedJob, setHydratedJob] = useState<Job | null>(initialJob);
  const [jobLoading, setJobLoading] = useState(() => initialJob === null);
  const [jobLoadError, setJobLoadError] = useState('');
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

  // Job-level invoice status
  const [jobInvoiceStatus, setJobInvoiceStatus] = useState<WorkOrderInvoiceStatus | null>(null);
  const [jobInvoiceLoading, setJobInvoiceLoading] = useState(true);
  const [jobInvoiceError, setJobInvoiceError] = useState<string | null>(null);

  useEffect(() => {
    if (!initialJob || initialJob.id !== jobId) return;
    setHydratedJob(initialJob);
    setJobLoading(false);
    setJobLoadError('');
  }, [initialJob, jobId]);

  useEffect(() => {
    initialScrollHandledRef.current = false;
  }, [jobId, initialScrollTarget]);

  useEffect(() => {
    if (initialJob && initialJob.id === jobId) return;

    let cancelled = false;
    setJobLoading(true);
    setJobLoadError('');
    setHydratedJob(null);

    void (async () => {
      const row = await getJobById(jobId);
      if (cancelled) return;
      if (!row) {
        setJobLoadError('Could not load work order.');
        setHydratedJob(null);
        setJobLoading(false);
        return;
      }
      setHydratedJob(row);
      setJobLoading(false);
      onJobLoaded?.(row);
    })();

    return () => {
      cancelled = true;
    };
  }, [initialJob, jobId, onJobLoaded]);

  const job = initialJob && initialJob.id === jobId ? initialJob : hydratedJob;

  const welderJob = useMemo(
    () => (job ? jobRowToWelderJob(job, profile) : null),
    [job, profile]
  );
  const sections = useMemo(
    () => (welderJob ? generateAgreement(welderJob, profile) : null),
    [welderJob, profile]
  );

  const woLabel =
    job?.wo_number != null ? `WO #${String(job.wo_number).padStart(4, '0')}` : 'WO (no #)';
  const customerTitle = job?.customer_name.trim() || 'Customer';
  const esignWasResent = Boolean(job?.esign_resent_at);
  const esignProgress = useMemo(
    () => getEsignProgressModel(job?.esign_status ?? 'not_sent', 'work_order', esignWasResent),
    [job?.esign_status, esignWasResent]
  );
  const signatureState = useMemo(
    () => getWorkOrderSignatureState(job?.esign_status ?? null, job?.offline_signed_at ?? null),
    [job?.esign_status, job?.offline_signed_at]
  );
  const isOfflineMarked = Boolean(job?.offline_signed_at && job?.esign_status !== 'completed');
  const showCopySigningLink = Boolean(
    job?.esign_embed_src &&
    job.esign_status !== 'not_sent' &&
    job.esign_status !== 'completed'
  );

  const loadCOs = useCallback(async () => {
    if (!job) {
      setChangeOrders([]);
      setCoLoading(false);
      return;
    }
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
  }, [job]);

  useEffect(() => {
    void loadCOs();
  }, [loadCOs, changeOrderListVersion]);

  useEffect(() => {
    if (initialScrollTarget !== 'change-orders') return;
    if (initialScrollHandledRef.current) return;
    if (coLoading) return;
    const section = changeOrdersSectionRef.current;
    if (!section) return;
    section.scrollIntoView({ block: 'start' });
    initialScrollHandledRef.current = true;
  }, [initialScrollTarget, coLoading]);

  useEffect(() => {
    if (!job) return;
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
  }, [job, userId, changeOrderListVersion]);

  useEffect(() => {
    if (!job) return;
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
  }, [job, userId, changeOrderListVersion]);

  // Load job-level invoice status
  useEffect(() => {
    if (!job) return;
    let cancelled = false;
    setJobInvoiceLoading(true);
    setJobInvoiceError(null);
    setJobInvoiceStatus(null);

    void (async () => {
      const result = await listInvoiceStatusByJob(userId);
      if (cancelled) return;
      setJobInvoiceLoading(false);
      if (result.error) {
        setJobInvoiceError(`Could not load invoice status (${result.error.message}).`);
      } else if (result.data) {
        // Find invoice for this job
        const jobInv = result.data.find(inv => inv.job_id === job.id);
        setJobInvoiceStatus(jobInv || null);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [job, userId]);

  const createChangeOrderDisabled =
    downloading || coNewCoBlockLoading || coNewCoBlockError !== null || coNewCoBlockedByInvoice;

  const handleDownloadPdf = async () => {
    setPdfError('');
    if (!welderJob || !documentRef.current) {
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
    if (!welderJob) {
      return {
        providerName: profile?.business_name ?? '',
        providerPhone: profile?.phone ?? '',
      };
    }
    return {
      providerName: getPdfFooterBusinessName(profile, welderJob),
      providerPhone: getPdfFooterPhone(profile, welderJob),
    };
  }, [profile, welderJob]);

  const coInvoiceById = useMemo(() => {
    if (coInvoiceStatusRows === null) return null;
    return changeOrderInvoiceStatusMapFromRows(coInvoiceStatusRows);
  }, [coInvoiceStatusRows]);

  const refreshJobRow = useCallback(async () => {
    if (!job) return null;
    try {
      const r = await pollWorkOrderEsignStatus(job.id);
      const updatedJob = mergeEsignResponseIntoJob(job, r);
      setHydratedJob(updatedJob);
      onJobUpdated?.(updatedJob);
      return updatedJob;
    } catch {
      // Fallback to passive DB read if active poll fails
      const row = await getJobById(job.id);
      if (row) {
        setHydratedJob(row);
        onJobUpdated?.(row);
      }
      return row;
    }
  }, [job, onJobUpdated]);

  useEsignPoller({
    enabled: Boolean(job && onJobUpdated) && shouldPollEsignStatus(job?.esign_status ?? 'not_sent'),
    pollOnce: async () => {
      const row = await refreshJobRow();
      if (!row) return false;
      return shouldPollEsignStatus(row.esign_status);
    },
  });

  useEffect(() => {
    return () => {
      if (copySigningLinkTimeoutRef.current !== null) {
        clearTimeout(copySigningLinkTimeoutRef.current);
      }
    };
  }, []);

  useEffect(() => {
    setEsignSigningLinkCopied(false);
    if (copySigningLinkTimeoutRef.current !== null) {
      clearTimeout(copySigningLinkTimeoutRef.current);
      copySigningLinkTimeoutRef.current = null;
    }
  }, [job?.id, job?.esign_embed_src]);

  const buildEsignPayload = async () => {
    if (!job || !welderJob) {
      throw new Error('Work order is not ready yet.');
    }
    const wo = String(welderJob.wo_number).padStart(4, '0');
    const agreementSections = generateAgreement(welderJob, profile);
    const providerSignatureDataUrl = await buildDocusealProviderSignatureImage(
      profile?.owner_name?.trim() || ''
    );
    const html = buildDocusealWorkOrderHtmlDocument(agreementSections, {
      providerSignatureDataUrl,
    });
    const header = buildDocusealHtmlHeader(getWorkOrderHeaderLabel(welderJob));
    const footer = buildDocusealHtmlFooter(buildDocusealEsignFooterLine(profile, welderJob));
    const contractorName = profile?.business_name ?? 'Your Contractor';
    const signerName = profile?.owner_name ?? contractorName;
    const customerFirst = welderJob.customer_name.split(' ')[0] || welderJob.customer_name;
    const rawType = (welderJob.job_type || '').trim().toLowerCase();
    const jobTypeLabel = rawType === 'other'
      ? ((welderJob.other_classification ?? '').trim() || 'work')
      : (rawType || 'work');
    const jobTypeCap = jobTypeLabel.charAt(0).toUpperCase() + jobTypeLabel.slice(1);
    const location = jobLocationSingleLine(welderJob.job_location);
    return {
      name: `Work Order #${wo}`,
      send_email: true,
      documents: [
        {
          name: `Work Order #${wo}`,
          html,
          html_header: header,
          html_footer: footer,
        },
      ],
      message: {
        subject: `${contractorName} sent you a Work Order to sign — WO #${wo}`,
        body: `Hi ${customerFirst},\n\n${contractorName} has prepared a Work Order for your ${jobTypeCap} project${location ? ` at ${location}` : ''} and is requesting your signature.\n\nReference: Work Order #${wo}\n\nPlease review and sign using the link below:\n\n{{submitter.link}}\n\nThank you,\n${signerName}\n${contractorName}`,
      },
    };
  };

  const handleEsignSend = async () => {
    if (!job) return;
    setEsignError('');
    if (!(job.customer_email || '').trim()) {
      setEsignError('Customer email is missing on this work order. Edit the job or agreement to add it.');
      return;
    }
    setEsignBusy(true);
    try {
      const r = await sendWorkOrderForSignature(job.id, await buildEsignPayload());
      onJobUpdated?.(mergeEsignResponseIntoJob(job, r));
      await refreshJobRow();
    } catch (e) {
      setEsignError(e instanceof Error ? e.message : 'Send for signature failed.');
    } finally {
      setEsignBusy(false);
    }
  };

  const handleEsignResend = async () => {
    if (!job) return;
    setEsignError('');
    setEsignBusy(true);
    try {
      const r = await resendWorkOrderSignature(job.id);
      onJobUpdated?.(mergeEsignResponseIntoJob(job, r));
      await refreshJobRow();
    } catch (e) {
      setEsignError(e instanceof Error ? e.message : 'Resend failed.');
    } finally {
      setEsignBusy(false);
    }
  };

  const handleCopySigningLink = async () => {
    if (!job) return;
    const url = job.esign_embed_src;
    if (!url) return;
    setEsignError('');
    if (copySigningLinkTimeoutRef.current !== null) {
      clearTimeout(copySigningLinkTimeoutRef.current);
      copySigningLinkTimeoutRef.current = null;
    }
    try {
      await navigator.clipboard.writeText(url);
      setEsignSigningLinkCopied(true);
      copySigningLinkTimeoutRef.current = setTimeout(() => {
        copySigningLinkTimeoutRef.current = null;
        setEsignSigningLinkCopied(false);
      }, 1000);
    } catch {
      setEsignError('Could not copy signing link.');
    }
  };

  const handleViewSignedDoc = async () => {
    if (!job?.esign_signed_document_url) return;
    setEsignError('');
    setSignedDocBusy(true);
    try {
      await downloadSignedDocumentFile(job.esign_signed_document_url);
    } catch (e) {
      setEsignError(e instanceof Error ? e.message : 'Could not load signed document.');
    } finally {
      setSignedDocBusy(false);
    }
  };

  const handleMarkSignedOffline = async () => {
    if (!job) return;
    setSaveError('');
    setSaveBusy(true);
    try {
      const { data, error } = await updateJob(job.id, { offline_signed_at: new Date().toISOString() });
      setSaveBusy(false);
      if (error) throw error;
      if (data && onJobUpdated) {
        onJobUpdated(data);
      }
      if (data) {
        setHydratedJob(data);
      }
    } catch (e) {
      setSaveBusy(false);
      setSaveError(e instanceof Error ? e.message : 'Could not mark as signed offline.');
    }
  };

  const handleUndoOfflineMark = async () => {
    if (!job) return;
    setSaveError('');
    setSaveBusy(true);
    try {
      const { data, error } = await updateJob(job.id, { offline_signed_at: null });
      setSaveBusy(false);
      if (error) throw error;
      if (data && onJobUpdated) {
        onJobUpdated(data);
      }
      if (data) {
        setHydratedJob(data);
      }
    } catch (e) {
      setSaveBusy(false);
      setSaveError(e instanceof Error ? e.message : 'Could not undo offline mark.');
    }
  };

  const downloadCombinedPdf = async () => {
    if (!job || !welderJob || !sections) return;
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

  if (jobLoading && !job) {
    return (
      <div className="work-order-detail-page">
        <div className="invoice-final-nav">
          <button type="button" className="invoice-final-nav-plain" onClick={onBack}>
            Go Back
          </button>
        </div>
        <p className="work-orders-loading">Loading work order…</p>
      </div>
    );
  }

  if (!job || !welderJob || !sections) {
    return (
      <div className="work-order-detail-page">
        <div className="invoice-final-nav">
          <button type="button" className="invoice-final-nav-plain" onClick={onBack}>
            Go Back
          </button>
        </div>
        <div className="error-banner" role="alert">
          {jobLoadError || 'Could not load work order.'}
        </div>
      </div>
    );
  }

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

      {/* Job-level invoice status */}
      {jobInvoiceStatus ? (
        <div className="wo-invoice-status">
          {jobInvoiceStatus.payment_status === 'paid' ? (
            <span className="badge-paid">Paid</span>
          ) : jobInvoiceStatus.payment_status === 'offline' ? (
            <span className="badge-offline">Paid Offline</span>
          ) : jobInvoiceStatus.issued_at ? (
            <span className="badge-invoiced">Invoiced</span>
          ) : (
            <span className="badge-draft">Draft</span>
          )}
          <span className="wo-invoice-number">Invoice #{String(jobInvoiceStatus.invoice_number).padStart(4, '0')}</span>
        </div>
      ) : jobInvoiceLoading ? (
        <div className="wo-invoice-status wo-invoice-status-loading">Loading invoice...</div>
      ) : jobInvoiceError ? (
        <div className="wo-invoice-status wo-invoice-status-error">{jobInvoiceError}</div>
      ) : null}

      {pdfError ? (
        <div className="error-banner" role="alert">
          {pdfError}
        </div>
      ) : null}
      {esignError ? (
        <div className="error-banner" role="alert">
          {esignError}
        </div>
      ) : null}
      {saveError ? (
        <div className="error-banner" role="alert">
          {saveError}
        </div>
      ) : null}

      <section className="wo-esign-card" aria-labelledby="wo-esign-heading">
        <h2 id="wo-esign-heading" className="wo-esign-heading">
          {signatureState.displayLabel === 'Signed offline' ? 'Signature (offline)' : 'Customer signature'}
        </h2>
        <div
          className="wo-esign-timeline"
          role="group"
          aria-label={`Customer signature status: ${esignProgress.title}`}
        >
          {esignProgress.steps.map((step, index) => (
            <div
              key={step.key}
              className={`wo-esign-step wo-esign-step-${step.tone}`}
              aria-current={step.tone !== 'inactive' ? 'step' : undefined}
            >
              <span
                className={`wo-esign-step-dot${step.tone === 'inactive' ? '' : ' wo-esign-step-dot-filled'}`}
                aria-hidden="true"
              />
              <span className="wo-esign-step-label">{step.label}</span>
              {index < esignProgress.steps.length - 1 ? (
                <span className="wo-esign-step-line" aria-hidden="true" />
              ) : null}
            </div>
          ))}
        </div>
        <p className="wo-esign-summary">{signatureState.summary}</p>
        <dl className="wo-esign-meta">
          {job.offline_signed_at ? (
            <div className="wo-esign-meta-row" data-testid="wo-esign-meta-offline-signed">
              <dt>Signed offline</dt>
              <dd>{formatEsignTimestamp(job.offline_signed_at)}</dd>
            </div>
          ) : null}
          {job.esign_sent_at ? (
            <div className="wo-esign-meta-row" data-testid="wo-esign-meta-sent">
              <dt>{esignWasResent && job.esign_status === 'sent' ? 'Resent' : 'Sent'}</dt>
              <dd>{formatEsignTimestamp(job.esign_resent_at || job.esign_sent_at)}</dd>
            </div>
          ) : null}
          {job.esign_opened_at ? (
            <div className="wo-esign-meta-row" data-testid="wo-esign-meta-opened">
              <dt>Opened</dt>
              <dd>{formatEsignTimestamp(job.esign_opened_at)}</dd>
            </div>
          ) : null}
          {job.esign_completed_at ? (
            <div className="wo-esign-meta-row" data-testid="wo-esign-meta-signed">
              <dt>Signed</dt>
              <dd>{formatEsignTimestamp(job.esign_completed_at)}</dd>
            </div>
          ) : null}
          {job.esign_declined_at ? (
            <div className="wo-esign-meta-row" data-testid="wo-esign-meta-declined">
              <dt>Declined</dt>
              <dd>{formatEsignTimestamp(job.esign_declined_at)}</dd>
            </div>
          ) : null}
          {job.esign_decline_reason ? (
            <div className="wo-esign-meta-row wo-esign-meta-row-reason">
              <dt>Decline reason</dt>
              <dd>{job.esign_decline_reason}</dd>
            </div>
          ) : null}
        </dl>
        <div className="wo-esign-actions">
          {!isOfflineMarked ? (
            <>
              {!job.esign_submitter_id ? (
                <button
                  type="button"
                  className="btn-primary btn-action wo-esign-actions-primary"
                  disabled={esignBusy || !job.customer_email?.trim()}
                  title={
                    !job.customer_email?.trim() ? 'Customer email is required to send for signature' : undefined
                  }
                  onClick={() => void handleEsignSend()}
                >
                  {esignBusy ? 'Sending…' : 'Send for signature'}
                </button>
              ) : job.esign_status !== 'completed' ? (
                <button
                  type="button"
                  className="btn-primary btn-action wo-esign-actions-primary"
                  disabled={esignBusy}
                  onClick={() => void handleEsignResend()}
                >
                  {esignBusy ? 'Sending…' : 'Resend Work Order'}
                </button>
              ) : null}
              {showCopySigningLink ? (
                <button
                  type="button"
                  className="btn-secondary btn-action wo-esign-actions-copy"
                  disabled={esignBusy}
                  onClick={() => void handleCopySigningLink()}
                >
                  <span aria-live="polite">
                    {esignSigningLinkCopied ? 'Copied to clipboard' : 'Copy signing link'}
                  </span>
                </button>
              ) : null}
            </>
          ) : null}
          {job.esign_signed_document_url ? (
            <button
              type="button"
              className="btn-primary btn-action"
              disabled={signedDocBusy}
              onClick={() => void handleViewSignedDoc()}
            >
              {signedDocBusy ? 'Loading…' : 'Download signed PDF'}
            </button>
          ) : null}
          {isOfflineMarked ? (
            <button
              type="button"
              className="btn-secondary btn-action"
              disabled={saveBusy}
              onClick={() => void handleUndoOfflineMark()}
            >
              {saveBusy ? 'Removing…' : 'Undo offline mark'}
            </button>
          ) : !signatureState.isSignatureSatisfied ? (
            <button
              type="button"
              className="btn-secondary btn-action"
              disabled={saveBusy}
              onClick={() => void handleMarkSignedOffline()}
            >
              {saveBusy ? 'Marking…' : 'Mark signed offline'}
            </button>
          ) : null}
        </div>
      </section>

      <div className="work-order-detail-scroll">
        <div ref={documentRef} className="agreement-document work-order-detail-document">
          <AgreementDocumentSections sections={sections} />
        </div>
      </div>

      <section ref={changeOrdersSectionRef} aria-labelledby="change-orders-heading">
        <h2 id="change-orders-heading" className="co-list-heading"><span>Change Orders</span></h2>
        {coNewCoBlockError ? (
          <p className="work-orders-empty" role="alert">
            {coNewCoBlockError}
          </p>
        ) : null}
        {!coNewCoBlockLoading && !coNewCoBlockError && coNewCoBlockedByInvoice ? (
          <p className="work-orders-empty wo-co-finalized-block">
            Work order invoice has been finalized. New change orders cannot be added.
          </p>
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
                      <span className="co-list-heading-line">
                        <span className="co-list-number">CO #{String(co.co_number).padStart(4, '0')}</span>
                        <span className="co-list-date">{`· ${formatRowDate(co.created_at)}`}</span>
                      </span>
                      <span className="work-orders-customer co-list-desc">{co.description || '—'}</span>
                      <span className="co-list-amount">${computeCOTotal(co.line_items).toFixed(2)}</span>
                      {renderEsignStrip(co.esign_status)}
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
                    ) : getInvoiceBusinessStatus(inv) === 'draft' ? (
                      <button
                        type="button"
                        className="badge-pending"
                        onClick={() => onStartChangeOrderInvoice(co, inv.id)}
                      >
                        Draft
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
      </section>

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
