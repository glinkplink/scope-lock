// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ChangeOrder, Invoice, Job } from '../../types/db';
import type { InvoiceWithCustomerName } from '../../lib/db/invoices';
import { InvoicesPage } from '../InvoicesPage';

const listInvoicesWithCustomerName = vi.fn();
const getJobById = vi.fn();
const getChangeOrderById = vi.fn();

vi.mock('../../lib/db/invoices', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../lib/db/invoices')>();
  return {
    ...actual,
    listInvoicesWithCustomerName: (...args: unknown[]) =>
      listInvoicesWithCustomerName(...args),
  };
});

vi.mock('../../lib/db/jobs', () => ({
  getJobById: (...args: unknown[]) => getJobById(...args),
}));

vi.mock('../../lib/db/change-orders', () => ({
  getChangeOrderById: (...args: unknown[]) => getChangeOrderById(...args),
}));

function baseInvoice(overrides: Partial<Invoice> = {}): Invoice {
  return {
    id: 'inv-1',
    user_id: 'u1',
    job_id: 'job-1',
    invoice_number: 1,
    invoice_date: '2025-01-15',
    due_date: '2025-01-31',
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

function withListFields(
  inv: Invoice,
  customer_name: string | null,
  wo_number: number | null
): InvoiceWithCustomerName {
  return { ...inv, customer_name, wo_number };
}

function minimalJob(id: string): Job {
  return {
    id,
    user_id: 'u1',
    client_id: null,
    customer_name: 'Acme',
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

function minimalChangeOrder(id: string, jobId: string): ChangeOrder {
  return {
    id,
    user_id: 'u1',
    job_id: jobId,
    co_number: 1,
    description: 'Extra',
    reason: 'r',
    status: 'approved',
    requires_approval: true,
    line_items: [],
    time_amount: 0,
    time_unit: 'hours',
    time_note: '',
    created_at: '2025-01-01T00:00:00Z',
    updated_at: '2025-01-01T00:00:00Z',
    esign_status: 'not_sent',
  };
}

describe('InvoicesPage', () => {
  const onOpenInvoice = vi.fn();
  const onOpenCoInvoice = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    cleanup();
  });

  it('renders invoice row with wo number label and wo fallback copy', async () => {
    const invA = withListFields(
      baseInvoice({ id: 'inv-a', invoice_number: 1, job_id: 'job-a' }),
      'Customer A',
      3
    );
    const invB = withListFields(
      baseInvoice({ id: 'inv-b', invoice_number: 2, job_id: 'job-b' }),
      'Customer B',
      null
    );
    listInvoicesWithCustomerName.mockResolvedValue([invA, invB]);

    render(
      <InvoicesPage userId="u1" onOpenInvoice={onOpenInvoice} onOpenCoInvoice={onOpenCoInvoice} />
    );

    await waitFor(() => {
      expect(screen.getByText('WO #0003')).toBeInTheDocument();
    });
    expect(screen.getByText('WO (no #)')).toBeInTheDocument();
  });

  it('renders draft, invoiced, paid, and paid offline status pills (WO row invoice button styles)', async () => {
    listInvoicesWithCustomerName.mockResolvedValue([
      withListFields(
        baseInvoice({ id: 'inv-draft', invoice_number: 1, issued_at: null, payment_status: 'unpaid' }),
        'Draft Customer',
        1
      ),
      withListFields(
        baseInvoice({
          id: 'inv-issued',
          invoice_number: 2,
          issued_at: '2025-01-20T00:00:00Z',
          payment_status: 'unpaid',
        }),
        'Issued Customer',
        2
      ),
      withListFields(
        baseInvoice({ id: 'inv-paid', invoice_number: 3, payment_status: 'paid' }),
        'Paid Customer',
        3
      ),
      withListFields(
        baseInvoice({ id: 'inv-offline', invoice_number: 4, payment_status: 'offline' }),
        'Offline Customer',
        4
      ),
    ]);

    render(
      <InvoicesPage userId="u1" onOpenInvoice={onOpenInvoice} onOpenCoInvoice={onOpenCoInvoice} />
    );

    await waitFor(() => {
      expect(screen.getByText('Draft')).toBeInTheDocument();
    });

    expect(screen.getByText('Draft')).toHaveClass('wo-row-invoice-btn', 'wo-row-invoice-btn--draft');
    expect(screen.getByText('Invoiced')).toHaveClass('wo-row-invoice-btn', 'wo-row-invoice-btn--invoiced');
    expect(screen.getByText('Paid')).toHaveClass('wo-row-invoice-btn', 'wo-row-invoice-btn--paid');
    expect(screen.getByText('Paid Offline')).toHaveClass('wo-row-invoice-btn', 'wo-row-invoice-btn--offline');
  });

  it('opens normal invoice path when no single change order id is present', async () => {
    const user = userEvent.setup();
    const inv = withListFields(
      baseInvoice({
        id: 'inv-1',
        job_id: 'job-1',
        line_items: [
          {
            kind: 'labor',
            description: 'Work',
            qty: 1,
            unit_price: 100,
            total: 100,
            source: 'original_scope',
          },
        ],
      }),
      'Client',
      5
    );
    listInvoicesWithCustomerName.mockResolvedValue([inv]);
    const job = minimalJob('job-1');
    getJobById.mockResolvedValue(job);
    getChangeOrderById.mockResolvedValue(null);

    render(
      <InvoicesPage userId="u1" onOpenInvoice={onOpenInvoice} onOpenCoInvoice={onOpenCoInvoice} />
    );

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /INV #0001/i })).toBeInTheDocument();
    });

    await user.click(screen.getByRole('button', { name: /INV #0001/i }));

    await waitFor(() => {
      expect(onOpenInvoice).toHaveBeenCalledTimes(1);
    });
    expect(onOpenInvoice).toHaveBeenCalledWith(job, inv);
    expect(onOpenCoInvoice).not.toHaveBeenCalled();
    expect(getChangeOrderById).not.toHaveBeenCalled();
  });

  it('opens change-order invoice path when exactly one unique change order id is present', async () => {
    const user = userEvent.setup();
    const coId = 'co-99';
    const inv = withListFields(
      baseInvoice({
        id: 'inv-co',
        job_id: 'job-1',
        line_items: [
          {
            kind: 'labor',
            description: 'CO work',
            qty: 1,
            unit_price: 50,
            total: 50,
            source: 'change_order',
            change_order_id: coId,
          },
          {
            kind: 'material',
            description: 'Parts',
            qty: 1,
            unit_price: 25,
            total: 25,
            source: 'change_order',
            change_order_id: coId,
          },
        ],
      }),
      'Client',
      1
    );
    listInvoicesWithCustomerName.mockResolvedValue([inv]);
    const job = minimalJob('job-1');
    const co = minimalChangeOrder(coId, 'job-1');
    getJobById.mockResolvedValue(job);
    getChangeOrderById.mockResolvedValue(co);

    render(
      <InvoicesPage userId="u1" onOpenInvoice={onOpenInvoice} onOpenCoInvoice={onOpenCoInvoice} />
    );

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /INV #0001/i })).toBeInTheDocument();
    });

    await user.click(screen.getByRole('button', { name: /INV #0001/i }));

    await waitFor(() => {
      expect(onOpenCoInvoice).toHaveBeenCalledTimes(1);
    });
    expect(onOpenCoInvoice).toHaveBeenCalledWith(job, co, inv);
    expect(onOpenInvoice).not.toHaveBeenCalled();
    expect(getChangeOrderById).toHaveBeenCalledWith(coId);
  });

  it('prevents repeat open while row is busy/disabled', async () => {
    const user = userEvent.setup();
    const inv1 = withListFields(
      baseInvoice({ id: 'inv-1', job_id: 'job-1', invoice_number: 1 }),
      'A',
      1
    );
    const inv2 = withListFields(
      baseInvoice({ id: 'inv-2', job_id: 'job-2', invoice_number: 2 }),
      'B',
      2
    );
    listInvoicesWithCustomerName.mockResolvedValue([inv1, inv2]);

    let release!: (j: Job) => void;
    const hang = new Promise<Job>((resolve) => {
      release = resolve;
    });
    getJobById.mockImplementation((jobId: string) => {
      if (jobId === 'job-1') return hang;
      return Promise.resolve(minimalJob(jobId));
    });

    render(
      <InvoicesPage userId="u1" onOpenInvoice={onOpenInvoice} onOpenCoInvoice={onOpenCoInvoice} />
    );

    await waitFor(() => {
      expect(screen.getAllByRole('button', { name: /INV #/i })).toHaveLength(2);
    });

    const buttons = screen.getAllByRole('button', { name: /INV #/i });
    const btn1 = buttons.find((b) => within(b).queryByText(/INV #0001/));
    const btn2 = buttons.find((b) => within(b).queryByText(/INV #0002/));
    expect(btn1).toBeTruthy();
    expect(btn2).toBeTruthy();

    await user.click(btn1!);

    await waitFor(() => {
      expect(getJobById).toHaveBeenCalledTimes(1);
    });

    await user.click(btn2!);

    expect(getJobById).toHaveBeenCalledTimes(1);
    expect(onOpenInvoice).not.toHaveBeenCalled();

    release!(minimalJob('job-1'));

    await waitFor(() => {
      expect(onOpenInvoice).toHaveBeenCalledTimes(1);
    });
  });
});
