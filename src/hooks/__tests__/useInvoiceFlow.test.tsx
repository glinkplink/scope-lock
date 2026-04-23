// @vitest-environment jsdom
import { act, renderHook, waitFor } from '@testing-library/react';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import type { Invoice, Job } from '../../types/db';
import { useInvoiceFlow } from '../useInvoiceFlow';

const getInvoiceByJobId = vi.fn();

vi.mock('../../lib/db/invoices', () => ({
  getInvoiceByJobId: (...args: unknown[]) => getInvoiceByJobId(...args),
}));

function minimalJob(overrides: Partial<Job> = {}): Job {
  return {
    id: 'job-1',
    user_id: 'u1',
    client_id: null,
    customer_name: 'Customer',
    customer_phone: null,
    job_location: '123 Main',
    job_type: 'repair',
    other_classification: null,
    asset_or_item_description: 'Gate',
    requested_work: 'Repair hinge',
    materials_provided_by: null,
    installation_included: null,
    grinding_included: null,
    paint_or_coating_included: null,
    removal_or_disassembly_included: null,
    hidden_damage_possible: null,
    price_type: 'fixed',
    price: 100,
    deposit_required: null,
    payment_terms: null,
    target_completion_date: null,
    exclusions: [],
    assumptions: [],
    change_order_required: null,
    workmanship_warranty_days: null,
    status: 'active',
    wo_number: 1,
    agreement_date: null,
    contractor_phone: null,
    contractor_email: null,
    customer_email: null,
    governing_state: null,
    target_start: null,
    deposit_amount: null,
    late_payment_terms: null,
    payment_terms_days: null,
    late_fee_rate: null,
    negotiation_period: null,
    customer_obligations: null,
    created_at: '2025-01-01T00:00:00Z',
    updated_at: '2025-01-01T00:00:00Z',
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
    ...overrides,
  };
}

function minimalInvoice(overrides: Partial<Invoice> = {}): Invoice {
  return {
    id: 'inv-1',
    user_id: 'u1',
    job_id: 'job-1',
    invoice_number: 1,
    invoice_date: '2025-01-01',
    due_date: '2025-01-15',
    status: 'draft',
    issued_at: null,
    line_items: [],
    stripe_payment_link_id: null,
    stripe_payment_url: null,
    payment_status: 'unpaid',
    paid_at: null,
    subtotal: 100,
    tax_rate: 0,
    tax_amount: 0,
    total: 100,
    payment_methods: [],
    notes: null,
    created_at: '2025-01-01T00:00:00Z',
    updated_at: '2025-01-01T00:00:00Z',
    ...overrides,
  };
}

describe('useInvoiceFlow', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getInvoiceByJobId.mockResolvedValue(null);
  });

  it('starts a new job invoice when no job-level invoice exists', async () => {
    const navigateTo = vi.fn();
    const { result } = renderHook(() => useInvoiceFlow(navigateTo, vi.fn()));

    act(() => {
      result.current.actions.handleStartInvoice(minimalJob());
    });

    await waitFor(() => {
      expect(navigateTo).toHaveBeenCalledWith('invoice-wizard', { jobId: 'job-1' });
    });
    expect(result.current.state.invoiceFlowJob?.id).toBe('job-1');
    expect(result.current.state.activeInvoice).toBeNull();
  });

  it('opens an existing invoice instead of creating another for an offline-signed work order', async () => {
    const navigateTo = vi.fn();
    const existing = minimalInvoice({ id: 'inv-existing' });
    getInvoiceByJobId.mockResolvedValueOnce(existing);
    const { result } = renderHook(() => useInvoiceFlow(navigateTo, vi.fn()));

    act(() => {
      result.current.actions.handleStartInvoice(
        minimalJob({ offline_signed_at: '2025-01-02T00:00:00Z' })
      );
    });

    await waitFor(() => {
      expect(navigateTo).toHaveBeenCalledWith('invoice-final', { invoiceId: 'inv-existing' });
    });
    expect(result.current.state.activeInvoice?.id).toBe('inv-existing');
    expect(result.current.state.wizardExistingInvoice).toBeNull();
  });
});
