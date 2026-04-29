import { useState } from 'react';
import type { Client, Job } from '../types/db';
import { updateJob } from '../lib/db/jobs';
import './StaleContactBanner.css';

interface StaleContactBannerProps {
  job: Job;
  client: Client | null;
  clientLoading?: boolean;
  onJobBackfilled: (job: Job) => void;
  onEditClient: () => void;
  onPrefetchEditClient?: () => void;
}

/**
 * Detects stale customer contact info on a job (job has empty email/phone, client has populated value)
 * and offers a one-click backfill. When neither side has a value, prompts the user to edit either record.
 */
export function StaleContactBanner({
  job,
  client,
  clientLoading = false,
  onJobBackfilled,
  onEditClient,
  onPrefetchEditClient,
}: StaleContactBannerProps) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const jobEmail = job.customer_email?.trim() || '';
  const jobPhone = job.customer_phone?.trim() || '';
  const clientEmail = client?.email?.trim() || '';
  const clientPhone = client?.phone?.trim() || '';

  const emailMissingFromJob = !jobEmail;
  const phoneMissingFromJob = !jobPhone;
  const clientHasNewerEmail = emailMissingFromJob && Boolean(clientEmail);
  const clientHasNewerPhone = phoneMissingFromJob && Boolean(clientPhone);

  // Banner only shows when there is something to act on
  const hasBackfill = clientHasNewerEmail || clientHasNewerPhone;
  const hasNothingOnFile = emailMissingFromJob && !clientEmail && !clientLoading;

  if (!hasBackfill && !hasNothingOnFile) return null;

  const handleBackfill = async () => {
    const patch: Partial<Job> = {};
    if (clientHasNewerEmail) patch.customer_email = clientEmail;
    if (clientHasNewerPhone) patch.customer_phone = clientPhone;
    if (Object.keys(patch).length === 0) return;

    setBusy(true);
    setError('');
    const { data, error: updateError } = await updateJob(job.id, patch);
    setBusy(false);
    if (updateError) {
      setError(updateError.message || 'Could not update work order from client.');
      return;
    }
    if (data) {
      onJobBackfilled(data);
    }
  };

  if (hasBackfill) {
    const fields: string[] = [];
    if (clientHasNewerEmail) fields.push(`email (${clientEmail})`);
    if (clientHasNewerPhone) fields.push(`phone (${clientPhone})`);
    return (
      <div className="stale-contact-banner" role="status">
        <p className="stale-contact-banner-text">
          This work order is missing customer {fields.join(' and ')}. Use saved client info?
        </p>
        {error ? <p className="stale-contact-banner-error">{error}</p> : null}
        <button
          type="button"
          className="btn-primary btn-action stale-contact-banner-action"
          disabled={busy}
          onClick={() => void handleBackfill()}
        >
          {busy ? 'Updating…' : 'Use saved client info'}
        </button>
      </div>
    );
  }

  // hasNothingOnFile — neither job nor client has an email
  return (
    <div className="stale-contact-banner stale-contact-banner--empty" role="status">
      <p className="stale-contact-banner-text">
        No customer email on file. Add one to the client record so this work order or invoice can be sent.
      </p>
      <button
        type="button"
        className="btn-secondary btn-action stale-contact-banner-action"
        onPointerEnter={onPrefetchEditClient}
        onFocus={onPrefetchEditClient}
        onClick={onEditClient}
      >
        Edit client
      </button>
    </div>
  );
}
