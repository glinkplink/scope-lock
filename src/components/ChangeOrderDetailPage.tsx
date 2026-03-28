import { useMemo, useState } from 'react';
import type { Job, BusinessProfile, ChangeOrder } from '../types/db';
import {
  fetchHtmlPdfBlob,
  getCoPdfFilename,
  getPdfFooterBusinessName,
  getPdfFooterPhone,
  downloadPdfBlobToFile,
} from '../lib/agreement-pdf';
import { generateChangeOrderHtml } from '../lib/change-order-generator';
import '../lib/change-order-document.css';
import { deleteChangeOrder } from '../lib/db/change-orders';
import { jobRowToWelderJob } from '../lib/job-to-welder-job';
import './ChangeOrderDetailPage.css';

interface ChangeOrderDetailPageProps {
  userId: string;
  co: ChangeOrder;
  job: Job;
  profile: BusinessProfile | null;
  onBack: () => void;
  onEdit: (co: ChangeOrder) => void;
  onDelete: () => void;
}

export function ChangeOrderDetailPage({
  userId,
  co,
  job,
  profile,
  onBack,
  onEdit,
  onDelete,
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
