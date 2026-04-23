// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { BusinessProfile, ChangeOrder, Invoice, Job } from '../../types/db';
import { InvoiceWizard } from '../InvoiceWizard';

const createInvoice = vi.fn();
const updateInvoice = vi.fn();
const getInvoiceByJobId = vi.fn();
const listChangeOrders = vi.fn();

vi.mock('../../lib/db/invoices', () => ({
  createInvoice: (...args: unknown[]) => createInvoice(...args),
  getInvoiceByJobId: (...args: unknown[]) => getInvoiceByJobId(...args),
  updateInvoice: (...args: unknown[]) => updateInvoice(...args),
}));

vi.mock('../../lib/db/change-orders', () => ({
  listChangeOrders: (...args: unknown[]) => listChangeOrders(...args),
}));

function minimalJob(): Job {
  return {
    id: 'job-1',
    user_id: 'u1',
    client_id: null,
    customer_name: 'Customer A',
    customer_phone: null,
    job_location: 'Here',
    job_type: 'repair',
    other_classification: null,
    asset_or_item_description: 'Thing',
    requested_work: 'Weld',
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
  };
}

function minimalProfile(): BusinessProfile {
  return {
    id: 'prof-1',
    user_id: 'u1',
    business_name: 'Welder Co',
    owner_name: null,
    phone: null,
    email: null,
    address: null,
    google_business_profile_url: null,
    default_exclusions: [],
    default_assumptions: [],
    next_wo_number: 2,
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
    created_at: '2025-01-01T00:00:00Z',
    updated_at: '2025-01-01T00:00:00Z',
  };
}

function makeCO(n: number, description: string): ChangeOrder {
  return {
    id: `co-${n}`,
    user_id: 'u1',
    job_id: 'job-1',
    co_number: n,
    description,
    reason: 'reason',
    status: 'approved',
    requires_approval: true,
    line_items: [{ id: `li-${n}`, description: 'Extra', quantity: 2, unit_rate: 50 }],
    time_amount: 0,
    time_unit: 'hours',
    time_note: '',
    created_at: '2025-01-01T00:00:00Z',
    updated_at: '2025-01-01T00:00:00Z',
    esign_status: 'not_sent',
  };
}

function minimalInvoice(overrides: Partial<Invoice> = {}): Invoice {
  return {
    id: 'inv-existing',
    user_id: 'u1',
    job_id: 'job-1',
    invoice_number: 7,
    invoice_date: '2025-01-01',
    due_date: '2025-01-15',
    status: 'draft',
    issued_at: null,
    line_items: [
      {
        id: 'l1',
        position: 0,
        kind: 'labor',
        description: 'Original scope',
        qty: 1,
        unit_price: 100,
        total: 100,
        source: 'original_scope',
      },
    ],
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

function renderWizard(opts?: { changeOrder?: ChangeOrder | null; existingInvoice?: Invoice | null }) {
  const onSuccess = vi.fn();
  render(
    <InvoiceWizard
      userId="u1"
      job={minimalJob()}
      changeOrder={opts?.changeOrder ?? null}
      profile={minimalProfile()}
      existingInvoice={opts?.existingInvoice ?? null}
      onCancel={() => {}}
      onSuccess={onSuccess}
    />
  );
  return { onSuccess };
}

describe('InvoiceWizard', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    listChangeOrders.mockResolvedValue([makeCO(1, 'First'), makeCO(2, 'Second')]);
    createInvoice.mockResolvedValue({
      data: { id: 'inv-1', invoice_number: 1 },
      error: null,
    });
    getInvoiceByJobId.mockResolvedValue(null);
    updateInvoice.mockResolvedValue({ data: null, error: null });
  });

  afterEach(() => {
    cleanup();
  });

  it('creates a CO-scoped invoice without showing the multi-CO picker', async () => {
    const user = userEvent.setup();
    renderWizard({ changeOrder: makeCO(2, 'Second') });

    await waitFor(() => {
      expect(screen.getByText(/CO #0002 only/i)).toBeInTheDocument();
    });
    expect(screen.queryByText(/Change orders on this job/i)).toBeNull();
    expect(screen.getByText('CO #0002').parentElement).toHaveTextContent('$100.00');

    const summary = screen.getByRole('region', { name: /amount preview/i });
    expect(within(summary).getByText((_, node) => node?.textContent === 'Original Total$0.00')).toBeInTheDocument();
    expect(within(summary).getByText((_, node) => node?.textContent === 'Change Order Total$100.00')).toBeInTheDocument();
    expect(within(summary).getByText((_, node) => node?.textContent === 'Total$100.00')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /confirm/i }));
    await user.click(screen.getByRole('button', { name: /continue/i }));
    await user.click(screen.getByRole('button', { name: /generate invoice/i }));

    await waitFor(() => {
      expect(createInvoice).toHaveBeenCalledTimes(1);
    });
    const payload = createInvoice.mock.calls[0][0];
    expect(payload.line_items).toHaveLength(1);
    expect(payload.line_items[0].change_order_id).toBe('co-2');
    expect(payload.line_items[0].source).toBe('change_order');
  });

  it('keeps the job invoice flow showing the change-order picker', async () => {
    renderWizard();

    await waitFor(() => {
      expect(screen.getByText(/Change orders on this job/i)).toBeInTheDocument();
    });
    expect(screen.getByText(/step 1 of 3/i)).toBeInTheDocument();
  });

  it('opens the existing job invoice when duplicate creation is rejected', async () => {
    const user = userEvent.setup();
    const existing = minimalInvoice();
    createInvoice.mockResolvedValueOnce({
      data: null,
      error: new Error('A work order invoice already exists for this work order.'),
    });
    getInvoiceByJobId.mockResolvedValueOnce(existing);
    const { onSuccess } = renderWizard();

    await waitFor(() => {
      expect(screen.getByText(/Change orders on this job/i)).toBeInTheDocument();
    });

    await user.click(screen.getByRole('button', { name: /confirm/i }));
    await user.click(screen.getByRole('button', { name: /continue/i }));
    await user.click(screen.getByRole('button', { name: /generate invoice/i }));

    await waitFor(() => {
      expect(onSuccess).toHaveBeenCalledWith(existing);
    });
    expect(getInvoiceByJobId).toHaveBeenCalledWith('job-1');
  });

  it('shows separate original and combined change-order totals in fixed pricing step one', async () => {
    renderWizard();

    await waitFor(() => {
      expect(screen.getByText('CO #0001')).toBeInTheDocument();
    });

    expect(screen.getByText('Original scope total').parentElement).toHaveTextContent('$100.00');
    expect(screen.getByText('CO #0001').parentElement).toHaveTextContent('$100.00');
    expect(screen.getByText('CO #0002').parentElement).toHaveTextContent('$100.00');

    const summary = screen.getByRole('region', { name: /amount preview/i });
    expect(within(summary).getByText((_, node) => node?.textContent === 'Original Total$100.00')).toBeInTheDocument();
    expect(within(summary).getByText((_, node) => node?.textContent === 'Change Order Total$200.00')).toBeInTheDocument();
    expect(within(summary).getByText((_, node) => node?.textContent === 'Total$300.00')).toBeInTheDocument();
  });

  it('does not force CO-only edit mode when existing invoice includes base-scope lines', async () => {
    const existingInvoice = minimalInvoice({
      id: 'inv-1',
      invoice_number: 1,
      line_items: [
        {
          id: 'l1',
          position: 0,
          kind: 'labor',
          description: 'Original scope',
          qty: 1,
          unit_price: 100,
          total: 100,
          source: 'original_scope',
        },
        {
          id: 'l2',
          position: 1,
          kind: 'labor',
          description: 'Change Order #0002: extra',
          qty: 1,
          unit_price: 50,
          total: 50,
          source: 'change_order',
          change_order_id: 'co-2',
        },
      ],
      subtotal: 150,
      total: 150,
    });

    renderWizard({ changeOrder: makeCO(2, 'Second'), existingInvoice });

    await waitFor(() => {
      expect(screen.getByText(/Original scope total/i)).toBeInTheDocument();
    });
    expect(screen.queryByText(/CO #0002 only/i)).toBeNull();
  });
});
