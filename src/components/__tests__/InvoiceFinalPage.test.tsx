// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { BusinessProfile, Invoice, Job } from '../../types/db';
import { InvoiceFinalPage } from '../InvoiceFinalPage';

const fetchInvoicePdfBlob = vi.fn();
const downloadPdfBlobToFile = vi.fn();
const updateInvoice = vi.fn();
const getInvoice = vi.fn();

vi.mock('../../lib/agreement-pdf', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../lib/agreement-pdf')>();
  return {
    ...actual,
    fetchInvoicePdfBlob: (...args: unknown[]) => fetchInvoicePdfBlob(...args),
    downloadPdfBlobToFile: (...args: unknown[]) => downloadPdfBlobToFile(...args),
  };
});

vi.mock('../../lib/db/invoices', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../lib/db/invoices')>();
  return {
    ...actual,
    updateInvoice: (...args: unknown[]) => updateInvoice(...args),
    getInvoice: (...args: unknown[]) => getInvoice(...args),
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

function baseJob(): Job {
  return {
    id: 'job-1',
    user_id: 'u1',
    client_id: null,
    customer_name: 'Customer A',
    customer_phone: null,
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
    created_at: '2025-01-01T00:00:00Z',
    updated_at: '2025-01-01T00:00:00Z',
    customer_email: 'customer@example.com',
    deposit_amount: null,
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
    wo_number: null,
    agreement_date: null,
    contractor_phone: null,
    contractor_email: null,
    governing_state: null,
    target_start: null,
    late_payment_terms: null,
    payment_terms_days: null,
    late_fee_rate: null,
    negotiation_period: null,
    customer_obligations: null,
  };
}

function baseProfile(): BusinessProfile {
  return {
    id: 'p-1',
    user_id: 'u1',
    business_name: 'Test Shop',
    owner_name: 'Test Owner',
    phone: '555-1234',
    email: 'shop@example.com',
    address: null,
    google_business_profile_url: null,
    default_exclusions: [],
    default_assumptions: [],
    next_wo_number: 1,
    next_invoice_number: 1,
    default_warranty_period: 365,
    default_negotiation_period: 30,
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

function baseInvoice(overrides: Partial<Invoice> = {}): Invoice {
  const invoice: Invoice = {
    id: 'inv-1',
    user_id: 'u1',
    job_id: 'job-1',
    invoice_number: 1,
    invoice_date: '2025-01-01T00:00:00Z',
    due_date: '2025-01-31T00:00:00Z',
    status: 'draft',
    issued_at: null,
    line_items: [],
    stripe_payment_link_id: null,
    stripe_payment_url: null,
    payment_status: 'unpaid',
    paid_at: null,
    subtotal: 250,
    tax_rate: 0,
    tax_amount: 0,
    total: 250,
    payment_methods: [],
    notes: null,
    created_at: '2025-01-01T00:00:00Z',
    updated_at: '2025-01-01T00:00:00Z',
    ...overrides,
  };
  invoice.stripe_payment_link_id = overrides.stripe_payment_link_id ?? null;
  invoice.stripe_payment_url = overrides.stripe_payment_url ?? null;
  invoice.payment_status = overrides.payment_status ?? 'unpaid';
  invoice.paid_at = overrides.paid_at ?? null;
  return invoice;
}

describe('InvoiceFinalPage', () => {
  const onBack = vi.fn();
  const onEditInvoice = vi.fn();
  const onInvoiceUpdated = vi.fn();

  function renderPage(invoice = baseInvoice(), job = baseJob()) {
    return render(
      <InvoiceFinalPage
        invoice={invoice}
        job={job}
        profile={baseProfile()}
        onBack={onBack}
        onEditInvoice={onEditInvoice}
        onInvoiceUpdated={onInvoiceUpdated}
      />
    );
  }

  beforeEach(() => {
    vi.clearAllMocks();
    fetchInvoicePdfBlob.mockResolvedValue(new Blob(['pdf'], { type: 'application/pdf' }));
    downloadPdfBlobToFile.mockResolvedValue(undefined);
    updateInvoice.mockResolvedValue({ data: baseInvoice(), error: null });
    getInvoice.mockImplementation(async (id: string) => baseInvoice({ id }));
  });

  afterEach(() => {
    cleanup();
  });

  it('renders payment card with enabled send button for draft invoice', () => {
    const signedJob = { ...baseJob(), esign_status: 'completed' as const };
    renderPage(baseInvoice(), signedJob);

    expect(screen.getByRole('heading', { name: 'Send Invoice' })).toBeInTheDocument();
    expect(screen.getByText('Send the invoice email to the customer with the PDF attached and payment link.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^Send Invoice$/i })).not.toBeDisabled();
    expect(screen.getByRole('button', { name: /create payment link/i })).not.toBeDisabled();
    expect(screen.getByRole('button', { name: /download invoice/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /edit invoice/i })).toBeInTheDocument();
  });

  it('downloads the invoice PDF without navigating away', async () => {
    const user = userEvent.setup();
    renderPage();

    await user.click(screen.getByRole('button', { name: /^Download Invoice$/i }));

    await waitFor(() => {
      expect(fetchInvoicePdfBlob).toHaveBeenCalledTimes(1);
      expect(downloadPdfBlobToFile).toHaveBeenCalledTimes(1);
    });
    expect(onBack).not.toHaveBeenCalled();
  });

  it('hides edit button for issued invoice', () => {
    renderPage(baseInvoice({ issued_at: '2025-01-03T10:00:00Z' }));

    expect(screen.queryByRole('button', { name: /edit invoice/i })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^Download Invoice$/i })).toBeInTheDocument();
  });

  it('refetches invoice on mount and passes the row to onInvoiceUpdated', async () => {
    const fresh = baseInvoice({
      id: 'inv-1',
      payment_status: 'paid',
      paid_at: '2025-01-15T12:00:00Z',
    });
    getInvoice.mockResolvedValueOnce(fresh);
    renderPage(baseInvoice({ id: 'inv-1', payment_status: 'unpaid' }));

    await waitFor(() => {
      expect(getInvoice).toHaveBeenCalledWith('inv-1');
      expect(onInvoiceUpdated).toHaveBeenCalledWith(
        expect.objectContaining({
          id: 'inv-1',
          payment_status: 'paid',
          paid_at: '2025-01-15T12:00:00Z',
        })
      );
    });
  });

  it('disables issue actions and shows the gate message before the work order is signed', () => {
    renderPage(baseInvoice(), baseJob());

    expect(
      screen.getByText(/invoice drafts can be created before signature/i)
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^Send Invoice$/i })).toBeDisabled();
    expect(screen.getByRole('button', { name: /create payment link/i })).toBeDisabled();
  });
});
