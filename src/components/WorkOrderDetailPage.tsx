import { useMemo, useRef, useState } from 'react';
import type { Job } from '../types/db';
import type { BusinessProfile } from '../types/db';
import { generateAgreement } from '../lib/agreement-generator';
import { jobRowToWelderJob } from '../lib/job-to-welder-job';
import {
  downloadAgreementPdfBlob,
  fetchAgreementPdfBlob,
} from '../lib/agreement-pdf';
import { AgreementDocumentSections } from './AgreementDocumentSections';

interface WorkOrderDetailPageProps {
  job: Job;
  profile: BusinessProfile | null;
  onBack: () => void;
}

export function WorkOrderDetailPage({ job, profile, onBack }: WorkOrderDetailPageProps) {
  const documentRef = useRef<HTMLDivElement | null>(null);
  const [pdfError, setPdfError] = useState('');
  const [downloading, setDownloading] = useState(false);

  const welderJob = useMemo(() => jobRowToWelderJob(job, profile), [job, profile]);
  const sections = useMemo(() => generateAgreement(welderJob, profile), [welderJob, profile]);

  const woLabel =
    job.wo_number != null ? `WO #${String(job.wo_number).padStart(4, '0')}` : 'WO (no #)';
  const customerTitle = job.customer_name.trim() || 'Customer';

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

      <div className="work-order-detail-footer">
        <button
          type="button"
          className="btn-primary btn-large work-order-detail-download"
          disabled={downloading}
          onClick={() => void handleDownloadPdf()}
        >
          {downloading ? 'Downloading…' : 'Download PDF'}
        </button>
      </div>
    </div>
  );
}
