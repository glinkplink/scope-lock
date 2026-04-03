// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ChangeOrderWizard } from '../ChangeOrderWizard';
import type { BusinessProfile, ChangeOrder, Job } from '../../types/db';

const createChangeOrder = vi.fn();
const updateChangeOrder = vi.fn();
const sendChangeOrderForSignature = vi.fn();
const mergeEsignResponseIntoChangeOrder = vi.fn();

vi.mock('../../lib/db/change-orders', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../lib/db/change-orders')>();
  return {
    ...actual,
    createChangeOrder: (...args: unknown[]) => createChangeOrder(...args),
    updateChangeOrder: (...args: unknown[]) => updateChangeOrder(...args),
  };
});

vi.mock('../../lib/esign-api', () => ({
  sendChangeOrderForSignature: (...args: unknown[]) => sendChangeOrderForSignature(...args),
  mergeEsignResponseIntoChangeOrder: (...args: unknown[]) => mergeEsignResponseIntoChangeOrder(...args),
}));

vi.mock('../../lib/docuseal-signature-image', () => ({
  buildDocusealProviderSignatureImage: vi.fn(() => Promise.resolve('data:image/png;base64,abc')),
}));

function profileFixture(): BusinessProfile {
  return {
    id: 'profile-1',
    user_id: 'user-1',
    business_name: 'IronWork Test',
    owner_name: 'Owner Name',
    phone: null,
    email: null,
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
    default_payment_terms_days: 30,
    default_late_fee_rate: 0,
    default_card_fee_note: false,
    stripe_account_id: null,
    stripe_onboarding_complete: false,
    created_at: '',
    updated_at: '',
  };
}

function jobFixture(): Job {
  return {
    id: 'job-1',
    user_id: 'user-1',
    client_id: null,
    customer_name: 'Customer A',
    customer_phone: null,
    customer_email: 'customer@example.com',
    job_location: '123 Main St',
    job_type: 'repair',
    other_classification: null,
    asset_or_item_description: 'Gate',
    requested_work: 'Repair',
    materials_provided_by: null,
    installation_included: null,
    grinding_included: null,
    paint_or_coating_included: null,
    removal_or_disassembly_included: null,
    hidden_damage_possible: null,
    price_type: 'fixed',
    price: 250,
    deposit_required: null,
    payment_terms: null,
    target_completion_date: null,
    exclusions: [],
    assumptions: [],
    change_order_required: null,
    workmanship_warranty_days: null,
    status: 'active',
    wo_number: 12,
    agreement_date: null,
    contractor_phone: null,
    contractor_email: null,
    governing_state: null,
    target_start: null,
    deposit_amount: null,
    late_payment_terms: null,
    payment_terms_days: null,
    late_fee_rate: null,
    negotiation_period: null,
    customer_obligations: null,
    created_at: '',
    updated_at: '',
    esign_submission_id: null,
    esign_submitter_id: null,
    esign_embed_src: null,
    esign_status: 'not_sent',
    esign_submission_state: null,
    esign_submitter_state: null,
    esign_sent_at: null,
    esign_opened_at: null,
    esign_completed_at: null,
    esign_declined_at: null,
    esign_decline_reason: null,
    esign_signed_document_url: null,
    esign_resent_at: null,
    offline_signed_at: null,
  };
}

function changeOrderFixture(overrides: Partial<ChangeOrder> = {}): ChangeOrder {
  return {
    id: 'co-1',
    user_id: 'user-1',
    job_id: 'job-1',
    co_number: 3,
    description: 'Add support',
    reason: 'Unexpected substrate',
    status: 'pending_approval',
    requires_approval: true,
    line_items: [
      {
        id: 'line-1',
        description: 'Additional welding',
        quantity: 2,
        unit_rate: 75,
      },
    ],
    time_amount: 1,
    time_unit: 'days',
    time_note: 'Site access delay',
    created_at: '',
    updated_at: '',
    esign_submission_id: null,
    esign_submitter_id: null,
    esign_embed_src: null,
    esign_status: 'not_sent',
    esign_submission_state: null,
    esign_submitter_state: null,
    esign_sent_at: null,
    esign_opened_at: null,
    esign_completed_at: null,
    esign_declined_at: null,
    esign_decline_reason: null,
    esign_signed_document_url: null,
    ...overrides,
  };
}

function renderWizard(existingCO?: ChangeOrder | null) {
  const onComplete = vi.fn();
  render(
    <ChangeOrderWizard
      userId="user-1"
      job={jobFixture()}
      profile={profileFixture()}
      existingCO={existingCO}
      onComplete={onComplete}
      onCancel={vi.fn()}
    />
  );
  return { onComplete };
}

describe('ChangeOrderWizard', () => {
  beforeEach(() => {
    createChangeOrder.mockReset();
    updateChangeOrder.mockReset();
    sendChangeOrderForSignature.mockReset();
    mergeEsignResponseIntoChangeOrder.mockReset();
    mergeEsignResponseIntoChangeOrder.mockImplementation((co, response) => ({
      ...co,
      ...response,
    }));
  });

  afterEach(() => {
    cleanup();
  });

  it('keeps step validation before advancing', async () => {
    const user = userEvent.setup();
    renderWizard();

    await user.click(screen.getByRole('button', { name: /^Next$/i }));
    expect(screen.getByText(/describe what changed/i)).toBeInTheDocument();

    await user.type(screen.getByLabelText(/description/i), 'Need to add more support');
    await user.click(screen.getByRole('button', { name: /^Next$/i }));

    expect(screen.getByRole('heading', { name: /cost adjustment/i })).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /^Next$/i }));
    expect(
      screen.getByText(/complete each line item or remove any blank ones before continuing/i)
    ).toBeInTheDocument();

    await user.type(screen.getByLabelText(/^Description$/i), 'Extra weld pass');
    await user.type(screen.getByLabelText(/^Rate$/i), '125');
    await user.click(screen.getByRole('button', { name: /^Next$/i }));

    expect(screen.getByRole('heading', { name: /review & save/i })).toBeInTheDocument();
  });

  it('saves and sends a new change order from the final step', async () => {
    const user = userEvent.setup();
    const savedCo = changeOrderFixture({ id: 'co-new', description: 'Saved CO' });
    const onCompleteResponse = {
      esign_status: 'sent',
      esign_submitter_id: 'submitter-1',
    };
    createChangeOrder.mockResolvedValue({ data: savedCo, error: null });
    sendChangeOrderForSignature.mockResolvedValue(onCompleteResponse);

    const { onComplete } = renderWizard();

    await user.type(screen.getByLabelText(/description/i), 'Need to add more support');
    await user.click(screen.getByRole('button', { name: /^Next$/i }));
    await user.type(screen.getByLabelText(/^Description$/i), 'Extra weld pass');
    await user.type(screen.getByLabelText(/^Rate$/i), '125');
    await user.click(screen.getByRole('button', { name: /^Next$/i }));
    await user.click(screen.getByRole('button', { name: /save and send change order/i }));

    await waitFor(() => {
      expect(createChangeOrder).toHaveBeenCalledTimes(1);
      expect(sendChangeOrderForSignature).toHaveBeenCalledTimes(1);
      expect(onComplete).toHaveBeenCalledWith(
        expect.objectContaining({
          id: 'co-new',
          esign_status: 'sent',
        })
      );
    });
  });

  it('hydrates existing change order values in edit mode', () => {
    renderWizard(changeOrderFixture());

    expect(screen.getByDisplayValue('Add support')).toBeInTheDocument();
    expect(screen.getByDisplayValue('Unexpected substrate')).toBeInTheDocument();
    expect(screen.getByText(/edit change order #0003/i)).toBeInTheDocument();
  });
});
