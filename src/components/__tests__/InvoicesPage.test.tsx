// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { Invoice, Job } from '../../types/db';
import type { InvoiceWithCustomerName } from '../../lib/db/invoices';
import { InvoicesPage } from '../InvoicesPage';

const listInvoicesWithCustomerName = vi.fn();
const getJobById = vi.fn();

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
  wo_number: number | null,
  job_type: string | null = null,
  other_classification: string | null = null
): InvoiceWithCustomerName {
  return { ...inv, customer_name, wo_number, job_type, other_classification };
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

describe('InvoicesPage', () => {
  const onOpenInvoice = vi.fn();
  const onOpenCoInvoice = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    cleanup();
  });

  it('renders invoice row with invoice id, client, job type, amount, and date', async () => {
    const invA = withListFields(
      baseInvoice({ id: 'inv-a', invoice_number: 1, job_id: 'job-a' }),
      'Customer A',
      3,
      'structural welding',
      null
    );
    const invB = withListFields(
      baseInvoice({ id: 'inv-b', invoice_number: 2, job_id: 'job-b' }),
      'Customer B',
      null,
      null,
      null
    );
    listInvoicesWithCustomerName.mockResolvedValue({ data: [invA, invB], error: null });

    render(
      <InvoicesPage userId="u1" onOpenInvoice={onOpenInvoice} onOpenCoInvoice={onOpenCoInvoice} />
    );

    await waitFor(() => {
      expect(screen.getByText('structural welding')).toBeInTheDocument();
    });
    const firstRow = screen.getByText('Customer A').closest('li') as HTMLElement;
    expect(within(firstRow).getByText('INV #0001')).toBeInTheDocument();
    expect(within(firstRow).getByText('Customer A')).toBeInTheDocument();
    expect(within(firstRow).getByText('$100.00')).toBeInTheDocument();
    expect(within(firstRow).getByText('Jan 15, 2025')).toBeInTheDocument();
    expect(screen.getByText('—')).toBeInTheDocument();
  });

  it('renders paid stat and filters loaded invoices by search text', async () => {
    const user = userEvent.setup();
    listInvoicesWithCustomerName.mockResolvedValue({
      data: [
        withListFields(
          baseInvoice({ id: 'inv-a', invoice_number: 1, total: 125, payment_status: 'unpaid' }),
          'Alpha Rail',
          7
        ),
        withListFields(
          baseInvoice({ id: 'inv-b', invoice_number: 2, total: 900, payment_status: 'paid' }),
          'Bravo Gate',
          8
        ),
      ],
      error: null,
    });

    render(
      <InvoicesPage userId="u1" onOpenInvoice={onOpenInvoice} onOpenCoInvoice={onOpenCoInvoice} />
    );

    const statGroup = await screen.findByRole('group', {
      name: /^Pending and paid invoice totals$/i,
    });
    expect(within(statGroup).getByText('$900')).toBeInTheDocument();
    expect(within(statGroup).getByText('Paid')).toBeInTheDocument();

    expect(screen.getByText('Bravo Gate').closest('li')).toHaveClass('work-orders-row--paid');
    expect(screen.getByText('Alpha Rail').closest('li')).not.toHaveClass('work-orders-row--paid');

    await user.type(screen.getByRole('searchbox', { name: /search invoices/i }), 'Bravo');

    const list = screen.getByRole('list');
    expect(within(list).getByText('Bravo Gate')).toBeInTheDocument();
    expect(within(list).queryByText('Alpha Rail')).not.toBeInTheDocument();
  });

  it('derives stat totals from invoice row status, including offline paid invoices', async () => {
    listInvoicesWithCustomerName.mockResolvedValue({
      data: [
        withListFields(
          baseInvoice({
            id: 'inv-offline-a',
            invoice_number: 22,
            total: 23188,
            issued_at: '2026-04-23T00:00:00Z',
            payment_status: 'offline',
          }),
          'James FrancO',
          12
        ),
        withListFields(
          baseInvoice({
            id: 'inv-offline-b',
            invoice_number: 21,
            total: 23188,
            issued_at: '2026-04-23T00:00:00Z',
            payment_status: 'offline',
          }),
          'James FrancO',
          12
        ),
        withListFields(
          baseInvoice({
            id: 'inv-unpaid',
            invoice_number: 20,
            total: 11496,
            issued_at: '2026-04-23T00:00:00Z',
            payment_status: 'unpaid',
          }),
          'Unpaid Customer',
          13
        ),
        withListFields(
          baseInvoice({
            id: 'inv-draft',
            invoice_number: 19,
            total: 1000,
            issued_at: null,
            payment_status: 'unpaid',
          }),
          'Draft Customer',
          14
        ),
      ],
      error: null,
    });

    render(
      <InvoicesPage userId="u1" onOpenInvoice={onOpenInvoice} onOpenCoInvoice={onOpenCoInvoice} />
    );

    const statGroup = await screen.findByRole('group', {
      name: /^Pending and paid invoice totals$/i,
    });
    expect(within(statGroup).getByText('$46,376')).toBeInTheDocument();
    expect(within(statGroup).getByText('$11,496')).toBeInTheDocument();
    expect(within(screen.getByRole('list')).getByText('Draft Customer')).toBeInTheDocument();
    expect(within(screen.getByRole('list')).getAllByText(/^Paid$/i)).toHaveLength(2);
  });

  it('renders downloaded, invoiced, and paid status pills while leaving unsent rows unbadged', async () => {
    listInvoicesWithCustomerName.mockResolvedValue({
      data: [
      withListFields(
        baseInvoice({ id: 'inv-draft', invoice_number: 1, issued_at: null, payment_status: 'unpaid' }),
        'Draft Customer',
        1
      ),
      withListFields(
        baseInvoice({
          id: 'inv-downloaded',
          invoice_number: 5,
          issued_at: null,
          downloaded_at: '2025-01-18T00:00:00Z',
          payment_status: 'unpaid',
        }),
        'Downloaded Customer',
        5
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
      ],
      error: null,
    });

    render(
      <InvoicesPage userId="u1" onOpenInvoice={onOpenInvoice} onOpenCoInvoice={onOpenCoInvoice} />
    );

    const list = await screen.findByRole('list');

    expect(screen.getByRole('tab', { name: /^Unsent$/i })).toBeInTheDocument();
    const draftRow = within(list).getByText('Draft Customer').closest('li') as HTMLElement;
    expect(within(draftRow).queryByText('Draft')).not.toBeInTheDocument();
    expect(within(draftRow).queryByText('Unsent')).not.toBeInTheDocument();
    expect(within(list).getByText('Downloaded')).toHaveClass(
      'iw-status-chip',
      'iw-status-chip--draft'
    );
    expect(within(list).getByText('WO #0005')).toBeInTheDocument();
    expect(within(list).getByText('Pending')).toHaveClass(
      'iw-status-chip',
      'iw-status-chip--outstanding'
    );
    expect(within(list).getAllByText('Paid')).toHaveLength(2);
    within(list).getAllByText('Paid').forEach((el) =>
      expect(el).toHaveClass('iw-status-chip', 'iw-status-chip--paid')
    );
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
    listInvoicesWithCustomerName.mockResolvedValue({ data: [inv], error: null });
    const job = minimalJob('job-1');
    getJobById.mockResolvedValue(job);

    render(
      <InvoicesPage userId="u1" onOpenInvoice={onOpenInvoice} onOpenCoInvoice={onOpenCoInvoice} />
    );

    await waitFor(() => {
      expect(screen.getByText('INV #0001')).toBeInTheDocument();
    });

    const firstRow = screen.getByText('INV #0001').closest('li') as HTMLElement;
    await user.click(firstRow);

    await waitFor(() => {
      expect(onOpenInvoice).toHaveBeenCalledTimes(1);
    });
    expect(onOpenInvoice).toHaveBeenCalledWith(job, inv);
    expect(onOpenCoInvoice).not.toHaveBeenCalled();
  });

  it('opens the normal invoice path even if a legacy CO-only invoice row is present', async () => {
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
    listInvoicesWithCustomerName.mockResolvedValue({ data: [inv], error: null });
    const job = minimalJob('job-1');
    getJobById.mockResolvedValue(job);

    render(
      <InvoicesPage userId="u1" onOpenInvoice={onOpenInvoice} onOpenCoInvoice={onOpenCoInvoice} />
    );

    await waitFor(() => {
      expect(screen.getByText('INV #0001')).toBeInTheDocument();
    });

    const firstRow = screen.getByText('INV #0001').closest('li') as HTMLElement;
    await user.click(firstRow);

    await waitFor(() => {
      expect(onOpenInvoice).toHaveBeenCalledTimes(1);
    });
    expect(onOpenInvoice).toHaveBeenCalledWith(job, inv);
    expect(onOpenCoInvoice).not.toHaveBeenCalled();
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
    listInvoicesWithCustomerName.mockResolvedValue({ data: [inv1, inv2], error: null });

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
      expect(screen.getByText('INV #0001')).toBeInTheDocument();
      expect(screen.getByText('INV #0002')).toBeInTheDocument();
    });

    const row1 = screen.getByText('INV #0001').closest('li') as HTMLElement;
    const row2 = screen.getByText('INV #0002').closest('li') as HTMLElement;

    await user.click(row1);

    await waitFor(() => {
      expect(getJobById).toHaveBeenCalledTimes(1);
    });

    await user.click(row2);

    expect(getJobById).toHaveBeenCalledTimes(1);
    expect(onOpenInvoice).not.toHaveBeenCalled();

    release!(minimalJob('job-1'));

    await waitFor(() => {
      expect(onOpenInvoice).toHaveBeenCalledTimes(1);
    });
  });

  it('routes mixed base-scope + single-CO invoices to normal invoice flow', async () => {
    const user = userEvent.setup();
    const coId = 'co-99';
    const inv = withListFields(
      baseInvoice({
        id: 'inv-mixed',
        job_id: 'job-1',
        line_items: [
          {
            kind: 'labor',
            description: 'Original scope',
            qty: 1,
            unit_price: 100,
            total: 100,
            source: 'original_scope',
          },
          {
            kind: 'labor',
            description: 'Change Order #0001',
            qty: 1,
            unit_price: 50,
            total: 50,
            source: 'change_order',
            change_order_id: coId,
          },
        ],
      }),
      'Client',
      5
    );
    listInvoicesWithCustomerName.mockResolvedValue({ data: [inv], error: null });
    const job = minimalJob('job-1');
    getJobById.mockResolvedValue(job);

    render(
      <InvoicesPage userId="u1" onOpenInvoice={onOpenInvoice} onOpenCoInvoice={onOpenCoInvoice} />
    );

    await waitFor(() => {
      expect(screen.getByText('INV #0001')).toBeInTheDocument();
    });

    const firstRow = screen.getByText('INV #0001').closest('li') as HTMLElement;
    await user.click(firstRow);

    await waitFor(() => {
      expect(onOpenInvoice).toHaveBeenCalledTimes(1);
    });
    expect(onOpenInvoice).toHaveBeenCalledWith(job, inv);
    expect(onOpenCoInvoice).not.toHaveBeenCalled();
  });

  it('shows an error banner when invoice list query fails', async () => {
    listInvoicesWithCustomerName.mockResolvedValue({
      data: [],
      error: new Error('query failed'),
    });

    render(
      <InvoicesPage userId="u1" onOpenInvoice={onOpenInvoice} onOpenCoInvoice={onOpenCoInvoice} />
    );

    await waitFor(() => {
      expect(screen.getByText('Failed to load invoices.')).toBeInTheDocument();
    });
    expect(screen.queryByText('No invoices yet.')).not.toBeInTheDocument();
  });
});
