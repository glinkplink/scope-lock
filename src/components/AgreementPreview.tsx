import { useLayoutEffect, useRef, useState } from 'react';
import type { PriceType, WelderJob } from '../types';
import type { BusinessProfile } from '../types/db';
import { generateAgreement } from '../lib/agreement-generator';
import { saveWorkOrder } from '../lib/db/jobs';
import {
  downloadAgreementPdfBlob,
  fetchAgreementPdfBlob,
} from '../lib/agreement-pdf';
import { AgreementDocumentSections } from './AgreementDocumentSections';

/** Letter width at 96dpi — preview layout matches PDF viewport. */
const PREVIEW_LETTER_WIDTH_PX = 816;

/** Preview upscale only applies at this breakpoint and when measure width > 816px. */
const PREVIEW_DESKTOP_UPSCALE_MQ = '(min-width: 1024px)';

const VALID_PRICE_TYPES: readonly PriceType[] = ['fixed', 'estimate', 'time_and_materials'];

/** Labels for missing/invalid fields — used only in Download & Save gate. */
function getRequiredFieldIssues(job: WelderJob): string[] {
  const issues: string[] = [];
  if (!job.customer_name?.trim()) issues.push('Customer name');
  if (!job.job_location?.trim()) issues.push('Job site / address');
  if (!job.asset_or_item_description?.trim()) issues.push('Item / structure');
  if (!job.requested_work?.trim()) issues.push('Work requested');
  if (!job.job_type?.trim()) issues.push('Job type');
  if (typeof job.price !== 'number' || !Number.isFinite(job.price) || job.price <= 0) {
    issues.push('Total contract price (must be greater than 0)');
  }
  if (!job.price_type || !VALID_PRICE_TYPES.includes(job.price_type)) {
    issues.push('Price type');
  }
  return issues;
}

interface AgreementPreviewProps {
  job: WelderJob;
  profile: BusinessProfile | null;
  existingJobId?: string;
  onSaveSuccess: (savedJobId: string, isNewSave: boolean) => void | Promise<void>;
}

export function AgreementPreview({ job, profile, existingJobId, onSaveSuccess }: AgreementPreviewProps) {
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState('');
  const [confirmationMessage, setConfirmationMessage] = useState('');
  /** True after the user has completed one successful Download & Save (or Download PDF) this mount — further clicks skip DB. */
  const [hasPersistedViaDownloadOnce, setHasPersistedViaDownloadOnce] = useState(false);
  const documentRef = useRef<HTMLDivElement | null>(null);
  const previewViewportRef = useRef<HTMLDivElement | null>(null);
  const previewSheetRef = useRef<HTMLDivElement | null>(null);
  const [previewContentHeight, setPreviewContentHeight] = useState(0);
  /**
   * Screen preview only: scales the native 816px sheet to fit smaller containers,
   * and may upscale modestly on desktop. PDF markup stays 816px.
   */
  const [previewScale, setPreviewScale] = useState(1);

  const sections = generateAgreement(job, profile);

  useLayoutEffect(() => {
    window.scrollTo(0, 0);
  }, []);

  useLayoutEffect(() => {
    const viewport = previewViewportRef.current;
    if (!viewport) return;

    const computeScale = () => {
      const w = viewport.getBoundingClientRect().width;
      if (w <= 0) return 1;

      const maxScale = window.matchMedia(PREVIEW_DESKTOP_UPSCALE_MQ).matches ? 1.5 : 1;
      return Math.min(w / PREVIEW_LETTER_WIDTH_PX, maxScale);
    };

    const updateScale = () => {
      setPreviewScale(computeScale());
    };

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

  /* Spacer height: sheet content only — ResizeObserver here does not track scroll container size. */
  useLayoutEffect(() => {
    const sheet = previewSheetRef.current;
    if (!sheet) return;

    const updateHeight = () => {
      setPreviewContentHeight(sheet.scrollHeight);
    };

    updateHeight();
    const ro = new ResizeObserver(updateHeight);
    ro.observe(sheet);
    return () => ro.disconnect();
  }, [job, profile]);

  const handleDownloadAndSave = async () => {
    setSaving(true);
    setSaveError('');
    setConfirmationMessage('');

    if (!documentRef.current) {
      setSaving(false);
      setSaveError('Preview is not ready yet. Please try again.');
      return;
    }

    if (!profile) {
      setSaving(false);
      setSaveError('No profile found — cannot save work order.');
      return;
    }

    const fieldIssues = getRequiredFieldIssues(job);
    if (fieldIssues.length > 0) {
      setSaving(false);
      setSaveError(`Please complete the following before saving: ${fieldIssues.join('; ')}.`);
      return;
    }

    let wroteToDb = false;

    if (!hasPersistedViaDownloadOnce) {
      const { data, error } = await saveWorkOrder(profile.user_id, job, existingJobId);

      if (error || !data) {
        setSaving(false);
        setSaveError(error?.message || 'Failed to save work order.');
        return;
      }

      setHasPersistedViaDownloadOnce(true);
      wroteToDb = true;
      const isNewInsert = !existingJobId;
      await Promise.resolve(onSaveSuccess(data.id, isNewInsert));
    }

    try {
      const blob = await fetchAgreementPdfBlob(job, profile, documentRef.current);
      downloadAgreementPdfBlob(blob, job);
      setConfirmationMessage(
        wroteToDb
          ? `WO #${String(job.wo_number).padStart(4, '0')} saved. PDF downloaded.`
          : `WO #${String(job.wo_number).padStart(4, '0')} downloaded.`
      );
    } catch (pdfErr) {
      if (wroteToDb) {
        setSaveError(
          pdfErr instanceof Error
            ? `Work order saved, but PDF failed: ${pdfErr.message}`
            : 'Work order saved, but PDF download failed.'
        );
        setConfirmationMessage(`WO #${String(job.wo_number).padStart(4, '0')} saved.`);
      } else {
        setSaveError(
          pdfErr instanceof Error
            ? `PDF download failed: ${pdfErr.message}`
            : 'PDF download failed.'
        );
      }
    } finally {
      setSaving(false);
    }
  };

  const renderDownloadButton = () => (
    <button
      type="button"
      onClick={handleDownloadAndSave}
      className="btn-action btn-primary"
      disabled={saving}
    >
      {saving
        ? hasPersistedViaDownloadOnce
          ? 'Downloading...'
          : 'Saving...'
        : hasPersistedViaDownloadOnce
          ? 'Download PDF'
          : 'Download & Save'}
    </button>
  );

  return (
    <div className="agreement-preview">
      <div className="preview-actions">
        {confirmationMessage && (
          <div className="success-banner">{confirmationMessage}</div>
        )}
        {saveError && <div className="error-banner">{saveError}</div>}
        {renderDownloadButton()}
      </div>

      <div ref={previewViewportRef} className="agreement-preview-scale-viewport">
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
                <div ref={documentRef} className="agreement-document">
                  <AgreementDocumentSections sections={sections} />
                </div>
          </div>
        </div>
      </div>

      <div className="preview-actions preview-actions-bottom">
        {renderDownloadButton()}
      </div>
    </div>
  );
}
