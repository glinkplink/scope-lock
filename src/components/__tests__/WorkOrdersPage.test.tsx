// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { cleanup, render, screen, waitFor, within, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ChangeOrder, Invoice, Job, WorkOrderDashboardJob } from '../../types/db';
import { WorkOrdersPage } from '../WorkOrdersPage';
import { ESIGN_POLL_INTERVAL_MS } from '../../lib/esign-live';

const listWorkOrdersDashboard = vi.fn();
const getJobById = vi.fn();
const getChangeOrderById = vi.fn();
const getInvoice = vi.fn();

vi.mock('../../lib/db/jobs', () => ({
  listWorkOrdersDashboard: (...args: unknown[]) => listWorkOrdersDashboard(...args),
  getJobById: (...args: unknown[]) => getJobById(...args),
}));

vi.mock('../../lib/db/change-orders', () => ({
  getChangeOrderById: (...args: unknown[]) => getChangeOrderById(...args),
}));

vi.mock('../../lib/db/invoices', () => ({
  getInvoice: (...args: unknown[]) => getInvoice(...args),
}));

const listJobA: WorkOrderDashboardJob = {
  id: 'job-a',
  wo_number: 1,
  customer_name: 'Customer A',
  job_type: 'repair',
  other_classification: null,
  agreement_date: '2025-01-01',
  created_at: '2025-01-01T12:00:00Z',
  price: 100,
  esign_status: 'not_sent',
  changeOrders: [],
  latestInvoice: null,
};

const listJobB: WorkOrderDashboardJob = {
  id: 'job-b',
  wo_number: 2,
  customer_name: 'Customer B',
  job_type: 'repair',
  other_classification: null,
  agreement_date: '2025-01-02',
  created_at: '2025-01-02T12:00:00Z',
  price: 200,
  esign_status: 'sent',
  changeOrders: [],
  latestInvoice: null,
};

function previewCO(
  id: string,
  coNumber: number,
  esignStatus: WorkOrderDashboardJob['changeOrders'][number]['esign_status']
) {
  return {
    id,
    job_id: 'job-a',
    co_number: coNumber,
    esign_status: esignStatus,
  };
}

function minimalFullChangeOrder(id: string, coNumber: number): ChangeOrder {
  return {
    id,
    user_id: 'u1',
    job_id: 'job-a',
    co_number: coNumber,
    description: `CO ${coNumber}`,
    reason: 'extra work',
    status: 'pending_approval',
    requires_approval: true,
    line_items: [],
    time_amount: 0,
    time_unit: 'hours',
    time_note: '',
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
  };
}

function minimalFullJob(id: string, customer: string): Job {
  return {
    id,
    user_id: 'u1',
    client_id: null,
    customer_name: customer,
    customer_phone: null,
    job_location: 'x',
    job_type: 'repair',
    other_classification: null,
    asset_or_item_description: 'x',
    requested_work: 'x',
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
  };
}

function minimalInvoice(id: string): Invoice {
  return {
    id,
    user_id: 'u1',
    job_id: 'job-a',
    invoice_number: 1,
    invoice_date: '2025-01-01',
    due_date: '2025-01-14',
    status: 'draft',
    line_items: [],
    subtotal: 100,
    tax_rate: 0,
    tax_amount: 0,
    total: 100,
    payment_methods: [],
    notes: null,
    created_at: '2025-01-01T00:00:00Z',
    updated_at: '2025-01-01T00:00:00Z',
  };
}

function latestWorkOrdersListUl(): HTMLElement {
  const lists = document.querySelectorAll('ul.work-orders-list');
  expect(lists.length).toBeGreaterThan(0);
  const last = lists.item(lists.length - 1);
  if (!(last instanceof HTMLElement)) {
    throw new Error('expected ul.work-orders-list to be an HTMLElement');
  }
  return last;
}

function renderPage() {
  const onStartInvoice = vi.fn();
  const onOpenPendingInvoice = vi.fn();
  const onOpenWorkOrderDetail = vi.fn();
  const onOpenChangeOrderDetail = vi.fn();
  const onClearSuccessBanner = vi.fn();
  render(
    <WorkOrdersPage
      userId="u1"
      profile={null}
      successBanner={null}
      onClearSuccessBanner={onClearSuccessBanner}
      onCreateWorkOrder={() => {}}
      onCompleteProfileClick={() => {}}
      onStartInvoice={onStartInvoice}
      onOpenPendingInvoice={onOpenPendingInvoice}
      onOpenWorkOrderDetail={onOpenWorkOrderDetail}
      onOpenChangeOrderDetail={onOpenChangeOrderDetail}
    />
  );
  return {
    onStartInvoice,
    onOpenPendingInvoice,
    onOpenWorkOrderDetail,
    onOpenChangeOrderDetail,
    onClearSuccessBanner,
  };
}

async function flushAsync() {
  await act(async () => {
    await Promise.resolve();
  });
}

describe('WorkOrdersPage', () => {
  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  beforeEach(() => {
    listWorkOrdersDashboard.mockReset();
    getJobById.mockReset();
    getChangeOrderById.mockReset();
    getInvoice.mockReset();
    listWorkOrdersDashboard.mockResolvedValue([listJobA]);
    getJobById.mockImplementation((id: string) => Promise.resolve(minimalFullJob(id, id)));
    getChangeOrderById.mockImplementation((id: string) =>
      Promise.resolve(minimalFullChangeOrder(id, Number(id.replace(/\D/g, '')) || 1))
    );
    getInvoice.mockImplementation((id: string) => Promise.resolve(minimalInvoice(id)));
  });

  it('loads the dashboard from a single query and shows summary totals', async () => {
    listWorkOrdersDashboard.mockResolvedValue([listJobA, listJobB]);

    renderPage();

    await waitFor(() => {
      expect(screen.getByText('Customer A')).toBeInTheDocument();
      expect(screen.getByText('Customer B')).toBeInTheDocument();
    });

    expect(listWorkOrdersDashboard).toHaveBeenCalledTimes(1);
    expect(listWorkOrdersDashboard).toHaveBeenCalledWith('u1', undefined);
    expect(screen.getByText('$0')).toBeInTheDocument();
    expect(screen.getByText('$300')).toBeInTheDocument();
  });

  it('polls only in-flight rows and merges the refreshed result', async () => {
    vi.useFakeTimers();
    listWorkOrdersDashboard
      .mockResolvedValueOnce([listJobA, listJobB])
      .mockResolvedValueOnce([{ ...listJobB, esign_status: 'completed' }]);

    renderPage();
    await flushAsync();

    expect(screen.getByLabelText('E-signature status: Sent')).toBeInTheDocument();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(ESIGN_POLL_INTERVAL_MS);
    });
    await flushAsync();

    expect(listWorkOrdersDashboard).toHaveBeenNthCalledWith(2, 'u1', ['job-b']);
    expect(screen.getByLabelText('E-signature status: Signed')).toBeInTheDocument();
    expect(screen.getByText('Customer A')).toBeInTheDocument();
  });

  it('opens work-order detail immediately with the row job id', async () => {
    const user = userEvent.setup();
    const { onOpenWorkOrderDetail } = renderPage();

    await screen.findByText('Customer A');
    await user.click(screen.getByRole('button', { name: /Customer A/i }));

    expect(onOpenWorkOrderDetail).toHaveBeenCalledWith('job-a');
    expect(getJobById).toHaveBeenCalledTimes(1);
  });

  it('prefetches a full job on hover and reuses it for invoice actions', async () => {
    const user = userEvent.setup();
    const { onStartInvoice } = renderPage();

    await screen.findByText('Customer A');
    await user.hover(screen.getByRole('button', { name: /Customer A/i }));

    await waitFor(() => {
      expect(getJobById).toHaveBeenCalledWith('job-a');
    });

    await user.click(screen.getByRole('button', { name: /^Invoice$/i }));

    await waitFor(() => {
      expect(onStartInvoice).toHaveBeenCalledTimes(1);
    });
    expect(onStartInvoice.mock.calls[0][0].id).toBe('job-a');
    expect(getJobById).toHaveBeenCalledTimes(1);
  });

  it('renders inline change order shortcuts in order and opens hydrated CO detail', async () => {
    listWorkOrdersDashboard.mockResolvedValue([
      {
        ...listJobA,
        changeOrders: [previewCO('co-2', 2, 'completed'), previewCO('co-1', 1, 'opened')],
      },
    ]);
    getJobById.mockResolvedValue(minimalFullJob('job-a', 'Customer A'));
    getChangeOrderById.mockImplementation((id: string) =>
      Promise.resolve(minimalFullChangeOrder(id, id === 'co-1' ? 1 : 2))
    );

    const user = userEvent.setup();
    const { onOpenChangeOrderDetail } = renderPage();

    await screen.findByText('Customer A');
    const shortcutButtons = screen.getAllByRole('button', { name: /Open CO #/i });
    expect(shortcutButtons).toHaveLength(2);
    expect(screen.getByText('CO #0001')).toBeInTheDocument();
    expect(screen.getByText('CO #0002')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Open CO #0001' }));

    await waitFor(() => {
      expect(onOpenChangeOrderDetail).toHaveBeenCalledTimes(1);
    });
    expect(onOpenChangeOrderDetail.mock.calls[0][0].id).toBe('job-a');
    expect(onOpenChangeOrderDetail.mock.calls[0][1].id).toBe('co-1');
  });

  it('shows date on first meta line and capitalized job type on second', async () => {
    renderPage();
    await waitFor(() => {
      expect(screen.getByText('Customer A')).toBeInTheDocument();
    });
    expect(screen.getByText('Jan 1, 2025')).toBeInTheDocument();
    expect(screen.getByText('Repair')).toBeInTheDocument();
  });

  it('renders Pending and Invoiced actions from the dashboard invoice fields', async () => {
    listWorkOrdersDashboard.mockResolvedValue([
      {
        ...listJobA,
        latestInvoice: {
          id: 'inv-a',
          job_id: 'job-a',
          status: 'draft',
          invoice_number: 1,
          created_at: '2025-01-03T00:00:00Z',
        },
      },
      {
        ...listJobB,
        latestInvoice: {
          id: 'inv-b',
          job_id: 'job-b',
          status: 'downloaded',
          invoice_number: 2,
          created_at: '2025-01-04T00:00:00Z',
        },
      },
    ]);

    renderPage();

    await waitFor(() => {
      const list = latestWorkOrdersListUl();
      expect(within(list).getByRole('button', { name: /^Pending$/i })).toBeInTheDocument();
      expect(within(list).getByRole('button', { name: /^Invoiced$/i })).toBeInTheDocument();
    });
  });

  it('opens the pending invoice using the invoice id from the dashboard row', async () => {
    listWorkOrdersDashboard.mockResolvedValue([
      {
        ...listJobA,
        latestInvoice: {
          id: 'inv-a',
          job_id: 'job-a',
          status: 'draft',
          invoice_number: 1,
          created_at: '2025-01-03T00:00:00Z',
        },
      },
    ]);

    const user = userEvent.setup();
    const { onOpenPendingInvoice } = renderPage();

    await screen.findByRole('button', { name: /^Pending$/i });
    await user.click(screen.getByRole('button', { name: /^Pending$/i }));

    await waitFor(() => {
      expect(onOpenPendingInvoice).toHaveBeenCalledTimes(1);
    });
    expect(getInvoice).toHaveBeenCalledWith('inv-a');
  });

  it('clears the success banner after 10 seconds and not before', async () => {
    vi.useFakeTimers();
    const onClearSuccessBanner = vi.fn();

    render(
      <WorkOrdersPage
        userId="u1"
        profile={null}
        successBanner="Work order saved. PDF downloaded."
        onClearSuccessBanner={onClearSuccessBanner}
        onCreateWorkOrder={() => {}}
        onCompleteProfileClick={() => {}}
        onStartInvoice={() => {}}
        onOpenPendingInvoice={() => {}}
        onOpenWorkOrderDetail={() => {}}
        onOpenChangeOrderDetail={() => {}}
      />
    );

    await flushAsync();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(9999);
    });
    expect(onClearSuccessBanner).not.toHaveBeenCalled();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1);
    });
    expect(onClearSuccessBanner).toHaveBeenCalledTimes(1);
  });
});
