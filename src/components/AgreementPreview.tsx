import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { flushSync } from 'react-dom';
import type { PriceType, WelderJob } from '../types';
import type { BusinessProfile } from '../types/db';
import type { CaptureFlowFinishedPayload } from '../types/capture-flow';
import { generateAgreement } from '../lib/agreement-generator';
import { saveWorkOrder } from '../lib/db/jobs';
import {
  downloadAgreementPdfBlob,
  fetchAgreementPdfBlob,
  getWorkOrderHeaderLabel,
} from '../lib/agreement-pdf';
import { buildDocusealWorkOrderHtmlDocument } from '../lib/docuseal-agreement-html';
import {
  buildDocusealEsignFooterLine,
  buildDocusealHtmlFooter,
  buildDocusealHtmlHeader,
} from '../lib/docuseal-header-footer';
import { sendWorkOrderForSignature } from '../lib/esign-api';
import { buildGuestPreviewProfile } from '../lib/guest-agreement-profile';
import { AgreementDocumentSections } from './AgreementDocumentSections';
import { CaptureModal } from './CaptureModal';
import { useScaledPreview } from '../hooks/useScaledPreview';
import './AgreementPreview.css';

const VALID_PRICE_TYPES: readonly PriceType[] = ['fixed', 'estimate', 'time_and_materials'];

type CaptureAfterIntent = 'pdf' | 'esign';

/** Labels for missing/invalid fields — used only in Download & Save gate. */
function getRequiredFieldIssues(job: WelderJob): string[] {
  const issues: string[] = [];
  if (!job.customer_name?.trim()) issues.push('Customer name');
  if (!job.job_location?.trim()) issues.push('Job site address');
  if (!job.asset_or_item_description?.trim()) issues.push('Item / structure');
  if (!job.requested_work?.trim()) issues.push('Work requested');
  if (!job.job_type?.trim()) issues.push('Job type');
  if (job.job_type === 'other' && !job.other_classification?.trim()) {
    issues.push('Specify (job type Other)');
  }
  if (typeof job.price !== 'number' || !Number.isFinite(job.price) || job.price <= 0) {
    issues.push('Total contract price (must be greater than 0)');
  }
  if (!job.price_type || !VALID_PRICE_TYPES.includes(job.price_type)) {
    issues.push('Price type');
  }
  return issues;
}

function buildCapturedProfileStub(result: {
  userId: string;
  businessName: string;
  email: string;
  phone: string | null;
  ownerName: string;
}): BusinessProfile {
  return {
    id: '',
    user_id: result.userId,
    business_name: result.businessName,
    owner_name: result.ownerName.trim() || null,
    phone: result.phone,
    email: result.email,
    address: null,
    google_business_profile_url: null,
    default_exclusions: [],
    default_assumptions: [],
    next_wo_number: 1,
    next_invoice_number: 1,
    default_warranty_period: 30,
    default_negotiation_period: 10,
    default_payment_methods: [],
    default_tax_rate: 0,
    default_late_payment_terms: '',
    default_payment_terms_days: 14,
    default_late_fee_rate: 1.5,
    default_card_fee_note: false,
    created_at: '',
    updated_at: '',
  };
}

interface AgreementPreviewProps {
  job: WelderJob;
  profile: BusinessProfile | null;
  existingJobId?: string;
  /** True when a Supabase session exists (required before calling e-sign API). */
  hasSession?: boolean;
  /** Guest contractor fields from App when no profile (preview + anonymous capture). */
  ownerFirstName?: string;
  ownerLastName?: string;
  ownerBusinessPhone?: string;
  onSaveSuccess: (savedJobId: string, isNewSave: boolean) => void | Promise<void>;
  onCaptureAndSave?: (capture: {
    businessName: string;
    email: string;
    password: string;
    saveAsDefaults: boolean;
  }) => Promise<{
    userId: string;
    businessName: string;
    email: string;
    phone: string | null;
    ownerName: string;
  }>;
  /** Called after PDF or e-sign attempt (account + save already done). Parent may redirect. */
  onCaptureFlowFinished?: (opts: CaptureFlowFinishedPayload) => void;
}

export function AgreementPreview({
  job,
  profile,
  existingJobId,
  hasSession = false,
  ownerFirstName = '',
  ownerLastName = '',
  ownerBusinessPhone = '',
  onSaveSuccess,
  onCaptureAndSave,
  onCaptureFlowFinished,
}: AgreementPreviewProps) {
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState('');
  const [confirmationMessage, setConfirmationMessage] = useState('');
  const [esignBusy, setEsignBusy] = useState(false);
  const [esignError, setEsignError] = useState('');
  /** True after the user has completed one successful Download & Save (or Download PDF) this mount — further clicks skip DB. */
  const [hasPersistedViaDownloadOnce, setHasPersistedViaDownloadOnce] = useState(false);
  const documentRef = useRef<HTMLDivElement | null>(null);
  const captureAfterIntentRef = useRef<CaptureAfterIntent>('pdf');

  const [showCaptureModal, setShowCaptureModal] = useState(false);
  const [captureError, setCaptureError] = useState('');
  const [captureSubmitting, setCaptureSubmitting] = useState(false);
  /** After capture, re-render agreement with contractor profile before PDF snapshot. */
  const [postCaptureProfile, setPostCaptureProfile] = useState<BusinessProfile | null>(null);

  const guestPreviewProfile = useMemo(
    () =>
      buildGuestPreviewProfile({
        ownerFirstName,
        ownerLastName,
        ownerBusinessPhone,
      }),
    [ownerFirstName, ownerLastName, ownerBusinessPhone]
  );

  const displayProfile = postCaptureProfile ?? profile ?? guestPreviewProfile;
  const sections = generateAgreement(job, displayProfile);

  const {
    viewportRef: previewViewportRef,
    sheetRef: previewSheetRef,
    scale: previewScale,
    spacerHeight,
    spacerWidth,
    letterWidthPx,
  } = useScaledPreview(job, displayProfile);

  useEffect(() => {
    if (profile) setPostCaptureProfile(null);
  }, [profile]);

  useLayoutEffect(() => {
    window.scrollTo(0, 0);
  }, []);

  const performEsignSend = async (jobId: string, welderJob: WelderJob, prof: BusinessProfile | null) => {
    const agreementSections = generateAgreement(welderJob, prof);
    const html = buildDocusealWorkOrderHtmlDocument(agreementSections);
    const header = buildDocusealHtmlHeader(getWorkOrderHeaderLabel(welderJob));
    const footer = buildDocusealHtmlFooter(buildDocusealEsignFooterLine(prof, welderJob));
    const wo = String(welderJob.wo_number).padStart(4, '0');
    await sendWorkOrderForSignature(jobId, {
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
        subject: `Please sign: Work Order #${wo}`,
        body: `Please review and sign the work order.\n\n{{submitter.link}}`,
      },
    });
  };

  const handleCaptureSubmit = async (
    businessName: string,
    email: string,
    password: string,
    saveAsDefaults: boolean
  ) => {
    if (!onCaptureAndSave) return;
    setCaptureSubmitting(true);
    setCaptureError('');

    try {
      const result = await onCaptureAndSave({ businessName, email, password, saveAsDefaults });
      const capturedProfile = buildCapturedProfileStub(result);

      flushSync(() => setPostCaptureProfile(capturedProfile));

      const { data, error } = await saveWorkOrder(result.userId, job, existingJobId);
      if (error || !data) {
        setCaptureSubmitting(false);
        setCaptureError(error?.message || 'Failed to save work order.');
        return;
      }

      setHasPersistedViaDownloadOnce(true);
      await Promise.resolve(onSaveSuccess(data.id, true));

      const intent = captureAfterIntentRef.current;

      if (intent === 'esign') {
        setEsignError('');
        try {
          await performEsignSend(data.id, job, capturedProfile);
          setConfirmationMessage(
            `Account created! WO #${String(job.wo_number).padStart(4, '0')} saved. Signature request emailed to the customer.`
          );
          onCaptureFlowFinished?.({ captureKind: 'esign', ok: true });
        } catch (e) {
          const msg = e instanceof Error ? e.message : 'Send for signature failed.';
          setSaveError(`Work order saved, but ${msg}`);
          setConfirmationMessage(
            `Account created! WO #${String(job.wo_number).padStart(4, '0')} saved.`
          );
          onCaptureFlowFinished?.({ captureKind: 'esign', ok: false });
        }
        setShowCaptureModal(false);
        setCaptureSubmitting(false);
        captureAfterIntentRef.current = 'pdf';
        return;
      }

      let pdfOk = false;
      if (documentRef.current) {
        try {
          const blob = await fetchAgreementPdfBlob(job, capturedProfile, documentRef.current);
          downloadAgreementPdfBlob(blob, job);
          pdfOk = true;
        } catch (pdfErr) {
          setSaveError(
            pdfErr instanceof Error
              ? `Work order saved, but PDF failed: ${pdfErr.message}`
              : 'Work order saved, but PDF download failed.'
          );
        }
      }

      onCaptureFlowFinished?.({ captureKind: 'pdf', ok: pdfOk });

      setShowCaptureModal(false);
      setCaptureSubmitting(false);
      setConfirmationMessage(
        pdfOk
          ? `Account created! WO #${String(job.wo_number).padStart(4, '0')} saved. PDF downloaded.`
          : `Account created! WO #${String(job.wo_number).padStart(4, '0')} saved.`
      );
    } catch (err) {
      setCaptureSubmitting(false);
      setCaptureError(err instanceof Error ? err.message : 'Something went wrong.');
    }
  };

  const openCaptureModal = (intent: CaptureAfterIntent) => {
    captureAfterIntentRef.current = intent;
    setShowCaptureModal(true);
  };

  const handleDownloadAndSave = async () => {
    setSaving(true);
    setSaveError('');
    setConfirmationMessage('');
    setEsignError('');

    if (!documentRef.current) {
      setSaving(false);
      setSaveError('Preview is not ready yet. Please try again.');
      return;
    }

    if (!profile && !onCaptureAndSave) {
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

    if (!profile && onCaptureAndSave) {
      setSaving(false);
      openCaptureModal('pdf');
      return;
    }

    if (!profile) {
      setSaving(false);
      setSaveError('No profile found — cannot save work order.');
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

  const handleSaveAndSend = async () => {
    setEsignError('');
    setSaveError('');
    setConfirmationMessage('');

    if (!job.customer_email?.trim()) {
      setEsignError('Add a customer email on the work order form — it is required to email the signature request.');
      return;
    }

    if (!profile && !onCaptureAndSave) {
      setEsignError('Sign in or use Download & Save to create an account first.');
      return;
    }

    const fieldIssues = getRequiredFieldIssues(job);
    if (fieldIssues.length > 0) {
      setEsignError(`Complete the following first: ${fieldIssues.join('; ')}.`);
      return;
    }

    if (!profile && onCaptureAndSave) {
      openCaptureModal('esign');
      return;
    }

    if (!profile) {
      setEsignError('No profile found — cannot send for signature.');
      return;
    }

    if (!hasSession) {
      setEsignError('You must be signed in to send for signature.');
      return;
    }

    setEsignBusy(true);

    try {
      let jobId = existingJobId;
      if (!hasPersistedViaDownloadOnce) {
        const { data, error } = await saveWorkOrder(profile.user_id, job, existingJobId);
        if (error || !data) {
          setEsignError(error?.message || 'Failed to save work order.');
          return;
        }
        jobId = data.id;
        setHasPersistedViaDownloadOnce(true);
        await Promise.resolve(onSaveSuccess(data.id, !existingJobId));
      } else if (!jobId) {
        setEsignError('Save the work order once before sending for signature.');
        return;
      }

      await performEsignSend(jobId, job, profile);
      setConfirmationMessage(
        `Signature request sent. WO #${String(job.wo_number).padStart(4, '0')} — customer will receive an email.`
      );
    } catch (e) {
      setEsignError(e instanceof Error ? e.message : 'Send for signature failed.');
    } finally {
      setEsignBusy(false);
    }
  };

  const renderDownloadButton = () => (
    <button
      type="button"
      onClick={() => void handleDownloadAndSave()}
      className="btn-action btn-primary"
      disabled={saving || esignBusy}
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

  const canOfferEsign = Boolean(profile || onCaptureAndSave);
  const esignDisabled =
    esignBusy ||
    saving ||
    !canOfferEsign ||
    !job.customer_email?.trim();

  return (
    <div className="agreement-preview">
      <div className="preview-actions">
        {confirmationMessage && (
          <div className="success-banner">{confirmationMessage}</div>
        )}
        {saveError && <div className="error-banner">{saveError}</div>}
        {esignError && <div className="error-banner">{esignError}</div>}
        <div className="preview-actions-row">
          {renderDownloadButton()}
          <button
            type="button"
            onClick={() => void handleSaveAndSend()}
            className="btn-action btn-secondary"
            disabled={esignDisabled}
            title={
              !job.customer_email?.trim()
                ? 'Customer email is required to send the signature request'
                : undefined
            }
          >
            {esignBusy ? 'Sending…' : 'Save & Send for Signature'}
          </button>
        </div>
        {!job.customer_email?.trim() && (
          <p className="preview-esign-hint">
            Customer email is required on the form to send for signature.
          </p>
        )}
      </div>

      <div ref={previewViewportRef} className="agreement-preview-scale-viewport">
        <div
          className="agreement-preview-scale-spacer"
          style={{
            width: spacerWidth,
            height: spacerHeight,
          }}
        >
          <div
            ref={previewSheetRef}
            className="agreement-preview-scale-sheet"
            style={{
              width: letterWidthPx,
              transform: previewScale !== 1 ? `scale(${previewScale})` : undefined,
              transformOrigin: 'top left',
              willChange: previewScale !== 1 ? 'transform' : undefined,
            }}
          >
            <div ref={documentRef} className="agreement-document">
              <AgreementDocumentSections sections={sections} />
            </div>
          </div>
        </div>
      </div>

      <div className="preview-actions preview-actions-bottom">
        <div className="preview-actions-row">
          {renderDownloadButton()}
          <button
            type="button"
            onClick={() => void handleSaveAndSend()}
            className="btn-action btn-secondary"
            disabled={esignDisabled}
            title={
              !job.customer_email?.trim()
                ? 'Customer email is required to send the signature request'
                : undefined
            }
          >
            {esignBusy ? 'Sending…' : 'Save & Send for Signature'}
          </button>
        </div>
      </div>

      {showCaptureModal && (
        <CaptureModal
          onSubmit={handleCaptureSubmit}
          onClose={() => {
            setShowCaptureModal(false);
            setCaptureError('');
            captureAfterIntentRef.current = 'pdf';
          }}
          error={captureError}
          submitting={captureSubmitting}
        />
      )}
    </div>
  );
}
