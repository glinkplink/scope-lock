import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import type {
  BusinessProfile,
  ChangeOrder,
  Client,
  Job,
} from '../types/db';
import { generateAgreement } from '../lib/agreement-generator';
import { jobRowToWelderJob } from '../lib/job-to-welder-job';
import {
  downloadAgreementPdfBlob,
  fetchHtmlPdfBlob,
  getPdfFilename,
  getPdfFooterBusinessName,
  getPdfFooterPhone,
  getWorkOrderHeaderLabel,
  downloadPdfBlobToFile,
} from '../lib/agreement-pdf';
import {
  buildDocusealWorkOrderHtmlDocument,
  buildWorkOrderEsignNotificationMessage,
} from '../lib/docuseal-agreement-html';
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
import { getClientById } from '../lib/db/clients';
import { formatEsignTimestamp } from '../lib/esign-live';
import { getEsignProgressModel } from '../lib/esign-progress';
import { getWorkOrderSignatureState } from '../lib/work-order-signature';
import { agreementSectionsToHtml } from '../lib/agreement-sections-html';
import { buildCombinedWorkOrderAndChangeOrdersHtml } from '../lib/change-order-generator';
import { buildDocusealProviderSignatureImage } from '../lib/docuseal-signature-image';
import '../lib/change-order-document.css';
import { computeCOTotal, listChangeOrders } from '../lib/db/change-orders';
import { getBlocksNewChangeOrdersForJob } from '../lib/db/invoices';
import { markJobDownloaded } from '../lib/job-mark-downloaded';
import { getChangeOrderSignatureState } from '../lib/change-order-signature';
import { PREVIEW_LETTER_HEIGHT_PX, useScaledPreview } from '../hooks/useScaledPreview';
import { InvoicePreviewModal } from './InvoicePreviewModal';
import { StaleContactBanner } from './StaleContactBanner';
import './EsignTimeline.css';
import './ScaledPreview.css';
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

function renderEsignStrip(status: ChangeOrder['esign_status'], offlineSignedAt: string | null) {
  const signatureState = getChangeOrderSignatureState(status, offlineSignedAt);
  const progress = getEsignProgressModel(
    signatureState.isSignatureSatisfied ? 'completed' : status,
    'change_order'
  );
  if (status === 'not_sent' && offlineSignedAt === null) return null;

  return (
    <span
      className="esign-strip"
      title={`E-signature: ${signatureState.displayLabel}`}
      aria-label={`E-signature status: ${signatureState.displayLabel}`}
    >
      {progress.steps.map((step) => (
        <span
          key={step.key}
          className={`esign-strip-segment esign-strip-segment-${step.tone}`}
          aria-hidden="true"
        />
      ))}
      <span className="esign-strip-text">{signatureState.displayLabel}</span>
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
  onEditClient?: () => void;
  onPrefetchEditClient?: () => void;
  onPrefetchChangeOrderDetail?: () => void;
  onPrefetchChangeOrderWizard?: () => void;
  onStartChangeOrder: () => void;
  onStartChangeOrderInvoice?: () => void;
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
  onEditClient = () => {},
  onPrefetchEditClient,
  onPrefetchChangeOrderDetail,
  onPrefetchChangeOrderWizard,
  onStartChangeOrder,
  onOpenCODetail,
}: WorkOrderDetailPageProps) {
  const changeOrdersSectionRef = useRef<HTMLElement | null>(null);
  const copySigningLinkTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const initialScrollHandledRef = useRef(false);
  /** App passes inline `onJobUpdated` lambdas; keep latest without re-running enter-sync when identity changes. */
  const onJobUpdatedRef = useRef(onJobUpdated);
  useEffect(() => {
    onJobUpdatedRef.current = onJobUpdated;
  }, [onJobUpdated]);

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
  const [linkedClient, setLinkedClient] = useState<Client | null>(null);
  const [linkedClientLoading, setLinkedClientLoading] = useState(false);
  const [changeOrders, setChangeOrders] = useState<ChangeOrder[]>([]);
  const [coLoading, setCoLoading] = useState(true);
  const [coError, setCoError] = useState('');
  const [coNewCoBlockLoading, setCoNewCoBlockLoading] = useState(true);
  const [coNewCoBlockError, setCoNewCoBlockError] = useState<string | null>(null);
  const [coNewCoBlockedByInvoice, setCoNewCoBlockedByInvoice] = useState(false);

  const [woPreviewModalOpen, setWoPreviewModalOpen] = useState(false);

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

  const job = hydratedJob ?? (initialJob && initialJob.id === jobId ? initialJob : null);

  useEffect(() => {
    const clientId = job?.client_id;
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
  }, [job?.client_id]);

  const handleJobBackfilled = useCallback(
    (updated: Job) => {
      setHydratedJob(updated);
      onJobUpdatedRef.current?.(updated);
    },
    []
  );

  const welderJob = useMemo(
    () => (job ? jobRowToWelderJob(job, profile) : null),
    [job, profile]
  );
  const sections = useMemo(
    () => (welderJob ? generateAgreement(welderJob, profile) : null),
    [welderJob, profile]
  );

  const {
    viewportRef: woPreviewViewportRef,
    sheetRef: woPreviewSheetRef,
    scale: woPreviewScale,
    spacerHeight: woPreviewSpacerHeight,
    spacerWidth: woPreviewSpacerWidth,
    letterWidthPx: woLetterWidthPx,
  } = useScaledPreview({ fitPageHeightPx: 280 }, sections);

  const woPreviewHtml = useMemo(
    () =>
      sections
        ? `<div class="agreement-document">${agreementSectionsToHtml(sections)}</div>`
        : '',
    [sections]
  );


  const woLabel =
    job?.wo_number != null ? `WO #${String(job.wo_number).padStart(4, '0')}` : 'WO (no #)';
  const customerTitle = job?.customer_name.trim() || 'Customer';
  const signatureState = useMemo(
    () => getWorkOrderSignatureState(job?.esign_status ?? null, job?.offline_signed_at ?? null),
    [job?.esign_status, job?.offline_signed_at]
  );
  const woPreviewSignatureChip = useMemo(() => {
    const d = signatureState.displayLabel;
    if (d === 'Not sent') {
      return job?.last_downloaded_at
        ? { label: 'Downloaded', className: ' iw-status-chip--draft' }
        : null;
    }
    if (d === 'Signed') return { label: 'E-signed', className: ' iw-status-chip--paid' };
    if (d === 'Signed offline') return { label: d, className: ' iw-status-chip--offline' };
    if (d === 'Declined' || d === 'Expired') {
      return { label: d, className: ' iw-status-chip--negative' };
    }
    return { label: d, className: ' iw-status-chip--draft' };
  }, [job?.last_downloaded_at, signatureState.displayLabel]);
  const esignWasResent = Boolean(job?.esign_resent_at);
  const esignProgress = useMemo(
    () =>
      getEsignProgressModel(
        signatureState.isSignatureSatisfied ? 'completed' : job?.esign_status ?? 'not_sent',
        'work_order',
        esignWasResent
      ),
    [job?.esign_status, esignWasResent, signatureState.isSignatureSatisfied]
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

  const createChangeOrderDisabled =
    downloading || coNewCoBlockLoading || coNewCoBlockError !== null || coNewCoBlockedByInvoice;

  const handleDownloadPdf = async () => {
    setPdfError('');
    if (!job || !welderJob || !woPreviewHtml) {
      setPdfError('Document is not ready. Try again.');
      return;
    }
    setDownloading(true);
    try {
      const blob = await fetchHtmlPdfBlob({
        filename: getPdfFilename(welderJob.wo_number, welderJob.customer_name),
        innerMarkup: woPreviewHtml,
        headerLeft: getWorkOrderHeaderLabel(welderJob),
        headerRight: '',
        providerName: footerMeta.providerName,
        providerPhone: footerMeta.providerPhone,
      });
      downloadAgreementPdfBlob(blob, welderJob);
      const { data, error } = await markJobDownloaded(job.id);
      if (error) {
        setPdfError(`PDF downloaded, but could not update status: ${error.message}.`);
      } else if (data) {
        setHydratedJob(data);
        onJobUpdatedRef.current?.(data);
      }
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

  /** One-shot DocuSeal/DB sync when the detail surface loads or `jobId` changes (no interval polling). */
  useEffect(() => {
    if (jobLoading) return;
    void (async () => {
      const row = await getJobById(jobId);
      if (!row) return;
      try {
        const r = await pollWorkOrderEsignStatus(jobId);
        const updatedJob = mergeEsignResponseIntoJob(row, r);
        setHydratedJob(updatedJob);
        onJobUpdatedRef.current?.(updatedJob);
      } catch {
        const dbRow = await getJobById(jobId);
        if (dbRow) {
          setHydratedJob(dbRow);
          onJobUpdatedRef.current?.(dbRow);
        }
      }
    })();
  }, [jobLoading, jobId]);

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
      message: buildWorkOrderEsignNotificationMessage(welderJob, profile),
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
      const welderJob = jobRowToWelderJob(job, profile);
      const r = await resendWorkOrderSignature(
        job.id,
        buildWorkOrderEsignNotificationMessage(welderJob, profile)
      );
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
        headerLeft: getWorkOrderHeaderLabel(welderJob),
        headerRight: '',
        providerName: footerMeta.providerName,
        providerPhone: footerMeta.providerPhone,
      });
      downloadPdfBlobToFile(blob, getPdfFilename(welderJob.wo_number, job.customer_name));
      const { data, error } = await markJobDownloaded(job.id);
      if (error) {
        setPdfError(`PDF downloaded, but could not update status: ${error.message}.`);
      } else if (data) {
        setHydratedJob(data);
        onJobUpdatedRef.current?.(data);
      }
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
      <hgroup className="work-order-detail-header">
        <h1 className="invoice-final-heading">{customerTitle}</h1>
        <p className="invoice-final-heading-sub">{woLabel}</p>
      </hgroup>

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

      {job ? (
        <StaleContactBanner
          job={job}
          client={linkedClient}
          clientLoading={linkedClientLoading}
          onJobBackfilled={handleJobBackfilled}
          onEditClient={onEditClient}
          onPrefetchEditClient={onPrefetchEditClient}
        />
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
          {!coNewCoBlockLoading && !coNewCoBlockedByInvoice && (isOfflineMarked ? (
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
          ) : null)}
        </div>
      </section>

      <section className="wo-detail-preview-card" aria-labelledby="wo-preview-heading">
        <div className="wo-detail-preview-header">
          <div className="wo-detail-preview-header-titles">
            <h2 id="wo-preview-heading" className="wo-detail-preview-title">
              Preview
            </h2>
            <p className="wo-detail-preview-copy">Tap the preview to open the full sheet.</p>
          </div>
          {woPreviewSignatureChip ? (
            <span className={`iw-status-chip${woPreviewSignatureChip.className}`}>
              {woPreviewSignatureChip.label}
            </span>
          ) : null}
        </div>
        <div
          ref={woPreviewViewportRef}
          className="agreement-preview-scale-viewport wo-detail-mini-viewport"
        >
          <div
            role="button"
            tabIndex={0}
            className="wo-detail-mini-preview-hitbox"
            aria-label="Open full work order preview"
            onClick={() => setWoPreviewModalOpen(true)}
            onKeyDown={(e: KeyboardEvent<HTMLDivElement>) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                setWoPreviewModalOpen(true);
              }
            }}
          >
            <div
              className="agreement-preview-scale-spacer"
              style={{
                width: woPreviewSpacerWidth,
                height: Math.min(woPreviewSpacerHeight, PREVIEW_LETTER_HEIGHT_PX * woPreviewScale),
              }}
            >
              <div
                ref={woPreviewSheetRef}
                className="agreement-preview-scale-sheet"
                style={{
                  width: woLetterWidthPx,
                  transform: woPreviewScale !== 1 ? `scale(${woPreviewScale})` : undefined,
                  transformOrigin: 'top left',
                  willChange: woPreviewScale !== 1 ? 'transform' : undefined,
                }}
              >
                <div dangerouslySetInnerHTML={{ __html: woPreviewHtml }} />
              </div>
            </div>
          </div>
        </div>
      </section>

      <InvoicePreviewModal
        open={woPreviewModalOpen}
        onClose={() => setWoPreviewModalOpen(false)}
        htmlMarkup={woPreviewHtml}
        kicker="Work order preview"
        ariaLabel="Work order preview"
      />

      <section
        ref={changeOrdersSectionRef}
        className="work-order-detail-change-orders"
        aria-labelledby="change-orders-heading"
      >
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
        {coError ? (
          <p className="work-orders-empty" role="alert">
            {coError}
          </p>
        ) : coLoading ? (
          <p className="work-orders-loading">Loading change orders…</p>
        ) : changeOrders.length > 0 ? (
          <ul className="work-orders-list" style={{ listStyle: 'none', margin: '0 0 var(--space-lg)', padding: 0 }}>
            {changeOrders.map((co) => {
              return (
                <li key={co.id} className="co-list-item">
                  <div className="work-orders-row-main">
                    <button
                      type="button"
                      className="work-orders-row-detail-hit"
                      onPointerEnter={onPrefetchChangeOrderDetail}
                      onFocus={onPrefetchChangeOrderDetail}
                      onClick={() => onOpenCODetail(co)}
                    >
                      <span className="co-list-heading-line">
                        <span className="co-list-number">CO #{String(co.co_number).padStart(4, '0')}</span>
                        <span className="co-list-date">{`· ${formatRowDate(co.created_at)}`}</span>
                      </span>
                      <span className="work-orders-customer co-list-desc">{co.description || '—'}</span>
                      <span className="co-list-amount">${computeCOTotal(co.line_items).toFixed(2)}</span>
                      {renderEsignStrip(co.esign_status, co.offline_signed_at)}
                    </button>
                  </div>
                </li>
              );
            })}
          </ul>
        ) : !coNewCoBlockedByInvoice ? (
          <p className="work-orders-empty wo-co-no-change-orders">No change orders yet.</p>
        ) : null}
      </section>

      <div className="work-order-detail-footer">
        <button
          type="button"
          className="btn-secondary btn-large work-order-detail-download"
          data-testid="wo-detail-create-change-order"
          disabled={createChangeOrderDisabled}
          onPointerEnter={onPrefetchChangeOrderWizard}
          onFocus={onPrefetchChangeOrderWizard}
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
