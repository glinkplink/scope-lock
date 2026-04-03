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
import {
  buildChangeOrderEsignSendPayload,
  buildChangeOrderEsignNotificationMessage,
} from '../lib/docuseal-change-order-html';
import { buildDocusealProviderSignatureImage } from '../lib/docuseal-signature-image';
import '../lib/change-order-document.css';
import { computeCOTotal, deleteChangeOrder, getChangeOrderById } from '../lib/db/change-orders';
import { jobRowToWelderJob } from '../lib/job-to-welder-job';
import { formatEsignTimestamp } from '../lib/esign-live';
import { getEsignProgressModel } from '../lib/esign-progress';
import {
  sendChangeOrderForSignature,
  resendChangeOrderSignature,
  mergeEsignResponseIntoChangeOrder,
  pollChangeOrderEsignStatus,
  downloadSignedDocumentFile,
} from '../lib/esign-api';
import './ChangeOrderDetailPage.css';

const CHANGE_ORDER_STATUS_META: Record<
  ChangeOrder['status'],
  { label: string; description: string; tone: 'draft' | 'pending' | 'approved' | 'rejected' }
> = {
  draft: {
    label: 'Draft',
    description: 'Saved but not yet sent for approval.',
    tone: 'draft',
  },
  pending_approval: {
    label: 'Pending Approval',
    description: 'Awaiting customer review and signature.',
    tone: 'pending',
  },
  approved: {
    label: 'Approved',
    description: 'Customer approved and signed this change order.',
    tone: 'approved',
  },
  rejected: {
    label: 'Rejected',
    description: 'Customer declined this change order.',
    tone: 'rejected',
  },
};

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
  const workOrderLabel =
    job.wo_number != null ? `WO #${String(job.wo_number).padStart(4, '0')}` : 'Work order';
  const statusMeta = CHANGE_ORDER_STATUS_META[co.status];
  const coTotal = useMemo(() => computeCOTotal(co.line_items), [co.line_items]);
  const scheduleUnitLabel = co.time_amount === 1 ? co.time_unit.slice(0, -1) : co.time_unit;
  const scheduleImpact =
    co.time_amount > 0
      ? `+${co.time_amount} ${scheduleUnitLabel}${
          co.time_note.trim() ? ` - ${co.time_note.trim()}` : ''
        }`
      : 'No schedule change';

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
  const [signedDocBusy, setSignedDocBusy] = useState(false);
  const [coSigningLinkCopied, setCoSigningLinkCopied] = useState(false);
  const [coEsignResendNotice, setCoEsignResendNotice] = useState(false);
  const copySigningLinkTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const resendNoticeTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const onCoUpdatedRef = useRef(onCoUpdated);
  useEffect(() => {
    onCoUpdatedRef.current = onCoUpdated;
  }, [onCoUpdated]);

  const coEsignWasResent = Boolean(co?.esign_resent_at);
  const esignProgress = useMemo(
    () => getEsignProgressModel(co.esign_status, 'change_order', coEsignWasResent),
    [co.esign_status, coEsignWasResent]
  );
  const showCopySigningLink = Boolean(
    co.esign_embed_src &&
    co.esign_status !== 'not_sent' &&
    co.esign_status !== 'completed'
  );

  const refreshCoRow = useCallback(async () => {
    try {
      const r = await pollChangeOrderEsignStatus(co.id);
      const updatedCo = mergeEsignResponseIntoChangeOrder(co, r);
      onCoUpdated?.(updatedCo);
      return updatedCo;
    } catch {
      // Fallback to passive DB read if active poll fails
      const row = await getChangeOrderById(co.id);
      if (row && onCoUpdated) onCoUpdated(row);
      return row;
    }
  }, [co, onCoUpdated]);

  /** One-shot DocuSeal/DB sync when opening this change order (no interval polling). */
  useEffect(() => {
    void (async () => {
      const row = await getChangeOrderById(co.id);
      if (!row) return;
      try {
        const r = await pollChangeOrderEsignStatus(co.id);
        const updatedCo = mergeEsignResponseIntoChangeOrder(row, r);
        onCoUpdatedRef.current?.(updatedCo);
      } catch {
        const again = await getChangeOrderById(co.id);
        if (again) onCoUpdatedRef.current?.(again);
      }
    })();
  }, [co.id]);

  useEffect(() => {
    return () => {
      if (copySigningLinkTimeoutRef.current !== null) {
        clearTimeout(copySigningLinkTimeoutRef.current);
      }
      if (resendNoticeTimeoutRef.current !== null) {
        clearTimeout(resendNoticeTimeoutRef.current);
      }
    };
  }, []);

  useEffect(() => {
    setCoSigningLinkCopied(false);
    setCoEsignResendNotice(false);
    if (copySigningLinkTimeoutRef.current !== null) {
      clearTimeout(copySigningLinkTimeoutRef.current);
      copySigningLinkTimeoutRef.current = null;
    }
    if (resendNoticeTimeoutRef.current !== null) {
      clearTimeout(resendNoticeTimeoutRef.current);
      resendNoticeTimeoutRef.current = null;
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
      const providerSignatureDataUrl = await buildDocusealProviderSignatureImage(
        profile?.owner_name?.trim() || ''
      );
      const payload = buildChangeOrderEsignSendPayload(co, job, profile, {
        providerSignatureDataUrl,
      });
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
    setCoEsignResendNotice(false);
    if (resendNoticeTimeoutRef.current !== null) {
      clearTimeout(resendNoticeTimeoutRef.current);
      resendNoticeTimeoutRef.current = null;
    }
    setCoEsignBusy(true);
    try {
      const message = buildChangeOrderEsignNotificationMessage(co, job, profile);
      const r = await resendChangeOrderSignature(co.id, message);
      onCoUpdated?.(mergeEsignResponseIntoChangeOrder(co, r));
      await refreshCoRow();
      setCoEsignResendNotice(true);
      resendNoticeTimeoutRef.current = setTimeout(() => {
        setCoEsignResendNotice(false);
        resendNoticeTimeoutRef.current = null;
      }, 5000);
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

  const handleViewSignedDoc = async () => {
    if (!co.esign_signed_document_url) return;
    setPdfError('');
    setSignedDocBusy(true);
    try {
      await downloadSignedDocumentFile(co.esign_signed_document_url);
    } catch (e) {
      setPdfError(e instanceof Error ? e.message : 'Could not load signed document.');
    } finally {
      setSignedDocBusy(false);
    }
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
    <div className="work-order-detail-page co-detail-page">
      <div className="invoice-final-nav">
        <button type="button" className="invoice-final-nav-plain" onClick={onBack}>
          Go Back
        </button>
      </div>
      <header className="co-detail-header">
        <div className="co-detail-heading-copy">
          <p className="co-detail-kicker">Change order</p>
          <h1 className="invoice-final-heading">{customerTitle}</h1>
          <div className="co-detail-heading-row">
            <p className="invoice-final-heading-sub">{coLabel}</p>
            <span className={`co-detail-status-badge co-detail-status-badge--${statusMeta.tone}`}>
              {statusMeta.label}
            </span>
          </div>
          <p className="co-detail-status-description">{statusMeta.description}</p>
        </div>

        <div className="co-detail-summary-card" aria-label="Change order summary">
          <div className="co-detail-summary-row">
            <span className="co-detail-summary-label">Work order</span>
            <span className="co-detail-summary-value">{workOrderLabel}</span>
          </div>
          <div className="co-detail-summary-row">
            <span className="co-detail-summary-label">Cost adjustment</span>
            <span className="co-detail-summary-value">${coTotal.toFixed(2)}</span>
          </div>
          <div className="co-detail-summary-row">
            <span className="co-detail-summary-label">Schedule</span>
            <span className="co-detail-summary-value">{scheduleImpact}</span>
          </div>
        </div>
      </header>

      {pdfError ? (
        <div className="error-banner" role="alert">
          {pdfError}
        </div>
      ) : null}
      {coEsignResendNotice ? (
        <div className="success-banner" role="status">
          Change order signature request was resent. The customer should receive a new email shortly.
        </div>
      ) : null}

      <section className="co-detail-meta-card" aria-label="Change order details">
        <div className="co-detail-meta-item">
          <span className="co-detail-meta-label">Reason</span>
          <span className="co-detail-meta-value">{co.reason || 'Not specified'}</span>
        </div>
        <div className="co-detail-meta-item">
          <span className="co-detail-meta-label">Description</span>
          <span className="co-detail-meta-value">{co.description || 'Not specified'}</span>
        </div>
      </section>

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
              <dt>{coEsignWasResent && co.esign_status === 'sent' ? 'Resent' : 'Sent'}</dt>
              <dd>{formatEsignTimestamp(co.esign_resent_at || co.esign_sent_at)}</dd>
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
          {showCopySigningLink ? (
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
          {co.esign_signed_document_url ? (
            <button
              type="button"
              className="btn-primary btn-action"
              disabled={signedDocBusy}
              onClick={() => void handleViewSignedDoc()}
            >
              {signedDocBusy ? 'Loading…' : 'Download signed PDF'}
            </button>
          ) : null}
        </div>
      </section>

      <div className="work-order-detail-scroll co-detail-scroll">
        <div className="co-detail-document-frame">
          <div
            className="agreement-document work-order-detail-document"
            dangerouslySetInnerHTML={{ __html: innerHtml }}
          />
        </div>
      </div>

      <div className="work-order-detail-footer co-detail-footer">
        <button
          type="button"
          className="btn-secondary btn-large work-order-detail-download"
          disabled={coEsignBusy}
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
          className="btn-secondary btn-large work-order-detail-download co-detail-delete-btn"
          disabled={coEsignBusy}
          onClick={() => void handleDelete()}
        >
          Delete
        </button>
      </div>
    </div>
  );
}
