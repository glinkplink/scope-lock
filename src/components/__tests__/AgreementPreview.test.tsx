// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { WelderJob } from '../../types';
import type { BusinessProfile } from '../../types/db';
import sampleJob from '../../data/sample-job.json';
import { AgreementPreview } from '../AgreementPreview';
import { buildWorkOrderEsignNotificationMessage } from '../../lib/docuseal-agreement-html';

const saveWorkOrder = vi.fn();
const sendWorkOrderForSignature = vi.fn();

vi.mock('../../lib/db/jobs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../lib/db/jobs')>();
  return {
    ...actual,
    saveWorkOrder: (...args: unknown[]) => saveWorkOrder(...args),
  };
});

vi.mock('../../lib/esign-api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../lib/esign-api')>();
  return {
    ...actual,
    sendWorkOrderForSignature: (jobId: string, payload: unknown) =>
      sendWorkOrderForSignature(jobId, payload),
  };
});

vi.mock('../../lib/docuseal-signature-image', () => ({
  buildDocusealProviderSignatureImage: vi.fn(() => Promise.resolve('data:image/png;base64,stub')),
}));

vi.mock('../../lib/docuseal-agreement-html', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../lib/docuseal-agreement-html')>();
  return {
    ...actual,
    buildDocusealWorkOrderHtmlDocument: vi.fn(() => '<html><body>DocuSeal work order</body></html>'),
  };
});

vi.mock('../../hooks/useScaledPreview', () => ({
  useScaledPreview: () => ({
    viewportRef: { current: null },
    sheetRef: { current: null },
    scale: 1,
    spacerHeight: 400,
    spacerWidth: 300,
    letterWidthPx: 300,
  }),
}));

function baseJob(): WelderJob {
  return {
    ...(sampleJob as WelderJob),
    wo_number: 12,
    agreement_date: '2026-04-02',
    customer_first_name: 'Jane',
    customer_last_name: 'Doe',
    customer_name: 'Jane Doe',
    customer_phone: '555-0100',
    customer_email: 'jane@example.com',
    job_location: '123 Main St, Columbus, OH',
    job_site_street: '123 Main St',
    job_site_city: 'Columbus',
    job_site_state: 'OH',
    job_site_zip: '43004',
    governing_state: 'OH',
    job_type: 'repair',
    asset_or_item_description: 'Steel gate',
    requested_work: 'Repair the hinge and reinforce the frame',
    price: 1200,
  };
}

function baseProfile(): BusinessProfile {
  return {
    id: 'profile-1',
    user_id: 'user-1',
    business_name: 'IronWork',
    owner_name: 'Billy Smith',
    phone: '555-0001',
    email: 'billy@ironwork.example',
    address: null,
    google_business_profile_url: null,
    default_exclusions: [],
    default_assumptions: [],
    next_wo_number: 13,
    next_invoice_number: 4,
    default_warranty_period: 30,
    default_negotiation_period: 10,
    default_payment_methods: [],
    default_tax_rate: 0,
    default_late_payment_terms: '',
    default_payment_terms_days: 14,
    default_late_fee_rate: 1.5,
    default_card_fee_note: false,
    stripe_account_id: null,
    stripe_onboarding_complete: false,
    created_at: '2026-04-02T00:00:00Z',
    updated_at: '2026-04-02T00:00:00Z',
  };
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('AgreementPreview', () => {
  it('uses the branded DocuSeal email message when sending from preview', async () => {
    const job = baseJob();
    const profile = baseProfile();

    saveWorkOrder.mockResolvedValue({
      data: { id: 'job-123' },
      error: null,
    });
    sendWorkOrderForSignature.mockResolvedValue({
      jobId: 'job-123',
      esign_submission_id: 'submission-1',
      esign_submitter_id: 'submitter-1',
      esign_embed_src: null,
      esign_status: 'sent',
      esign_submission_state: 'sent',
      esign_submitter_state: 'sent',
      esign_sent_at: '2026-04-02T12:00:00Z',
      esign_resent_at: null,
      esign_opened_at: null,
      esign_completed_at: null,
      esign_declined_at: null,
      esign_decline_reason: null,
      esign_signed_document_url: null,
    });

    const user = userEvent.setup();

    render(
      <AgreementPreview
        job={job}
        profile={profile}
        hasSession
        onSaveSuccess={vi.fn()}
      />
    );

    await user.click(screen.getAllByRole('button', { name: 'Save & Send for Signature' })[0]);

    await waitFor(() => {
      expect(sendWorkOrderForSignature).toHaveBeenCalledTimes(1);
    });

    expect(sendWorkOrderForSignature).toHaveBeenCalledWith(
      'job-123',
      expect.objectContaining({
        message: buildWorkOrderEsignNotificationMessage(job, profile),
      })
    );
  });

  it('waits for email confirmation instead of saving when signup returns no session', async () => {
    const job = baseJob();
    const user = userEvent.setup();
    const onCaptureAndSave = vi.fn().mockResolvedValue({
      status: 'confirmation_required',
      email: 'tester@example.com',
    });

    render(
      <AgreementPreview
        job={job}
        profile={null}
        hasSession={false}
        onSaveSuccess={vi.fn()}
        onCaptureAndSave={onCaptureAndSave}
      />
    );

    await user.click(screen.getAllByRole('button', { name: 'Download & Save' })[0]);
    await user.type(screen.getByLabelText(/business name/i), 'Acme Welding');
    await user.type(screen.getByLabelText(/^email$/i), 'tester@example.com');
    await user.type(screen.getByLabelText(/password/i), 'hunter2');
    await user.click(screen.getByRole('button', { name: /create account & download/i }));

    await waitFor(() => {
      expect(screen.getByText(/check tester@example\.com to confirm your email/i)).toBeInTheDocument();
    });

    expect(onCaptureAndSave).toHaveBeenCalledWith({
      businessName: 'Acme Welding',
      email: 'tester@example.com',
      password: 'hunter2',
      saveAsDefaults: true,
      intent: 'pdf',
    });
    expect(saveWorkOrder).not.toHaveBeenCalled();
  });
});
