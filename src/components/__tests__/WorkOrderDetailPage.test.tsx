// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import type { Job, BusinessProfile, ChangeOrder } from '../../types/db';
import { WorkOrderDetailPage } from '../WorkOrderDetailPage';

const listChangeOrders = vi.fn();
const getInvoiceByJobId = vi.fn();

vi.mock('../../lib/db/change-orders', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../lib/db/change-orders')>();
  return {
    ...actual,
    listChangeOrders: (...args: unknown[]) => listChangeOrders(...args),
  };
});

vi.mock('../../lib/db/invoices', () => ({
  getInvoiceByJobId: (...args: unknown[]) => getInvoiceByJobId(...args),
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
    requires_approval: false,
    line_items: [],
    time_amount: 0,
    time_unit: 'hours',
    time_note: '',
    created_at: '2025-01-01T00:00:00Z',
    updated_at: '2025-01-01T00:00:00Z',
  };
}

describe('WorkOrderDetailPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getInvoiceByJobId.mockResolvedValue(null);
    listChangeOrders.mockResolvedValue([makeCO(1, 'First'), makeCO(2, 'Second')]);
  });

  it('shows one job-level Invoice control and none on change-order rows', async () => {
    render(
      <WorkOrderDetailPage
        job={minimalJob()}
        profile={minimalProfile()}
        onBack={() => {}}
        onStartChangeOrder={() => {}}
        onStartInvoice={() => {}}
        onOpenCODetail={() => {}}
      />
    );

    await screen.findByText('CO #0001');

    expect(screen.getAllByRole('button', { name: /^Invoice$/i })).toHaveLength(1);

    const coList = document.querySelector('ul.work-orders-list');
    expect(coList).toBeTruthy();
    await waitFor(() => {
      expect(within(coList as HTMLElement).getAllByRole('listitem')).toHaveLength(2);
    });
    expect(
      within(coList as HTMLElement).queryByRole('button', { name: /^Invoice$/i })
    ).toBeNull();
  });
});
