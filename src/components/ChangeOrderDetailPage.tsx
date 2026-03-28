import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { Job, BusinessProfile, ChangeOrder } from '../types/db';
import {
  fetchHtmlPdfBlob,
  getCoPdfFilename,
  getPdfFooterBusinessName,
  getPdfFooterPhone,
  downloadPdfBlobToFile,
} from '../lib/agreement-pdf';
import { generateChangeOrderHtml } from '../lib/change-order-generator';
import { buildChangeOrderEsignSendPayload } from '../lib/docuseal-change-order-html';
import '../lib/change-order-document.css';
import { deleteChangeOrder, getChangeOrderById } from '../lib/db/change-orders';
import { jobRowToWelderJob } from '../lib/job-to-welder-job';
import { shouldPollEsignStatus, formatEsignTimestamp } from '../lib/esign-live';
import { getEsignProgressModel } from '../lib/esign-progress';
import { useEsignPoller } from '../hooks/useEsignPoller';
import {
  sendChangeOrderForSignature,
  resendChangeOrderSignature,
  mergeEsignResponseIntoChangeOrder,
} from '../lib/esign-api';
import './ChangeOrderDetailPage.css';

interface ChangeOrderDetailPageProps {
  userId: string;
  co: ChangeOrder;
  job: Job;
  profile: BusinessProfile | null;
  onBack: () => void;
  onEdit: (co: ChangeOrder) => void;
  onDelete: () => void;
  onCoUpdated?: (co: ChangeOrder) => void;
}

export function ChangeOrderDetailPage({
  userId,
  co,
  job,
  profile,
  onBack,
  onEdit,
  onDelete,
  onCoUpdated,
}: ChangeOrderDetailPageProps) {
  const [pdfError, setPdfError] = useState('');
  const [downloading, setDownloading] = useState(false);

  const coLabel = `CO #${String(co.co_number).padStart(4, '0')}`;
  const customerTitle = job.customer_name.trim() || 'Customer';

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
      const woLabel = job.wo_number != null ? `WO #${String(job.wo_number).padStart(4, '0')}` : '';
      const blob = await fetchHtmlPdfBlob({
        filename,
        innerMarkup: inner,
        marginHeaderLeft: coLabel,
        workOrderNumber: woLabel,
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

  const [coEsignBusy, setCoEsignBusy] = useState(false);
  const [coSigningLinkCopied, setCoSigningLinkCopied] = useState(false);
  const copySigningLinkTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const esignProgress = useMemo(
    () => getEsignProgressModel(co.esign_status, 'change_order'),
    [co.esign_status]
  );

  const refreshCoRow = useCallback(async () => {
    const row = await getChangeOrderById(co.id);
    if (row && onCoUpdated) {
      onCoUpdated(row);
    }
    return row;
  }, [co.id, onCoUpdated]);

  useEsignPoller({
    enabled: Boolean(onCoUpdated) && shouldPollEsignStatus(co.esign_status),
    pollOnce: async () => {
      const row = await refreshCoRow();
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
    setCoSigningLinkCopied(false);
    if (copySigningLinkTimeoutRef.current !== null) {
      clearTimeout(copySigningLinkTimeoutRef.current);
      copySigningLinkTimeoutRef.current = null;
    }
  }, [co.id, co.esign_embed_src]);

  useLayoutEffect(() => {
    window.scrollTo(0, 0);
  }, [co.id]);

  const handleSendForSignature = async () => {
    setPdfError('');
    if (!(job.customer_email || '').trim()) {
      setPdfError('Customer email is missing on this work order. Edit the job to add it.');
      return;
    }
    setCoEsignBusy(true);
    try {
      const payload = buildChangeOrderEsignSendPayload(co, job, profile);
      const r = await sendChangeOrderForSignature(co.id, payload);
      onCoUpdated?.(mergeEsignResponseIntoChangeOrder(co, r));
      await refreshCoRow();
    } catch (e) {
      setPdfError(e instanceof Error ? e.message : 'Failed to send for signature');
    } finally {
      setCoEsignBusy(false);
    }
  };

  const handleResendSignature = async () => {
    setPdfError('');
    setCoEsignBusy(true);
    try {
      const message = buildChangeOrderEsignSendPayload(co, job, profile).message;
      const r = await resendChangeOrderSignature(co.id, message);
      onCoUpdated?.(mergeEsignResponseIntoChangeOrder(co, r));
      await refreshCoRow();
    } catch (e) {
      setPdfError(e instanceof Error ? e.message : 'Failed to resend signature request');
    } finally {
      setCoEsignBusy(false);
    }
  };

  const handleCopySigningLink = () => {
    const link = co.esign_embed_src;
    if (!link) return;
    navigator.clipboard.writeText(link).then(() => {
      setCoSigningLinkCopied(true);
      copySigningLinkTimeoutRef.current = setTimeout(() => {
        setCoSigningLinkCopied(false);
      }, 2000);
    });
  };

  const handleDelete = async () => {
    if (!window.confirm(`Delete ${coLabel}?`)) return;
    const { error } = await deleteChangeOrder(userId, co.id);
    if (error) {
      setPdfError(error.message);
      return;
    }
    onDelete();
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

      <section className="wo-esign-card" aria-labelledby="co-esign-heading">
        <h2 id="co-esign-heading" className="wo-esign-heading">
          Customer signature
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
        <p className="wo-esign-summary">{esignProgress.summary}</p>
        <dl className="wo-esign-meta">
          {co.esign_sent_at ? (
            <div className="wo-esign-meta-row">
              <dt>Sent</dt>
              <dd>{formatEsignTimestamp(co.esign_sent_at)}</dd>
            </div>
          ) : null}
          {co.esign_opened_at ? (
            <div className="wo-esign-meta-row">
              <dt>Opened</dt>
              <dd>{formatEsignTimestamp(co.esign_opened_at)}</dd>
            </div>
          ) : null}
          {co.esign_completed_at ? (
            <div className="wo-esign-meta-row">
              <dt>Signed</dt>
              <dd>{formatEsignTimestamp(co.esign_completed_at)}</dd>
            </div>
          ) : null}
          {co.esign_declined_at ? (
            <div className="wo-esign-meta-row">
              <dt>Declined</dt>
              <dd>{formatEsignTimestamp(co.esign_declined_at)}</dd>
            </div>
          ) : null}
          {co.esign_decline_reason ? (
            <div className="wo-esign-meta-row wo-esign-meta-row-reason">
              <dt>Decline reason</dt>
              <dd>{co.esign_decline_reason}</dd>
            </div>
          ) : null}
        </dl>
        <div className="wo-esign-actions">
          {!co.esign_submitter_id ? (
            <button
              type="button"
              className="btn-primary btn-action wo-esign-actions-primary"
              disabled={coEsignBusy || !job.customer_email?.trim()}
              title={
                !job.customer_email?.trim() ? 'Customer email is required to send for signature' : undefined
              }
              onClick={() => void handleSendForSignature()}
            >
              {coEsignBusy ? 'Sending…' : 'Send for signature'}
            </button>
          ) : co.esign_status !== 'completed' ? (
            <button
              type="button"
              className="btn-primary btn-action wo-esign-actions-primary"
              disabled={coEsignBusy}
              onClick={() => void handleResendSignature()}
            >
              {coEsignBusy ? 'Sending…' : 'Resend Change Order'}
            </button>
          ) : null}
          {co.esign_embed_src ? (
            <button
              type="button"
              className="btn-secondary btn-action wo-esign-actions-copy"
              disabled={coEsignBusy}
              onClick={() => void handleCopySigningLink()}
            >
              <span aria-live="polite">
                {coSigningLinkCopied ? 'Copied to clipboard' : 'Copy signing link'}
              </span>
            </button>
          ) : null}
          {co.esign_signed_document_url &&
          co.esign_signed_document_url.trim().startsWith('https://') ? (
            <a
              className="btn-secondary btn-action"
              href={co.esign_signed_document_url.trim()}
              target="_blank"
              rel="noreferrer noopener"
            >
              View signed PDF
            </a>
          ) : co.esign_signed_document_url ? (
            <span className="btn-secondary btn-action wo-esign-signed-link-fallback" title={co.esign_signed_document_url}>
              Signed PDF link unavailable
            </span>
          ) : null}
        </div>
      </section>

      <div className="work-order-detail-scroll">
        <div
          className="agreement-document work-order-detail-document"
          dangerouslySetInnerHTML={{ __html: innerHtml }}
        />
      </div>

      <div className="work-order-detail-footer">
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
          {downloading ? 'Downloading…' : 'Download Change Order'}
        </button>
        <button
          type="button"
          className="btn-secondary btn-large work-order-detail-download"
          onClick={() => void handleDelete()}
        >
          Delete
        </button>
      </div>
    </div>
  );
}
