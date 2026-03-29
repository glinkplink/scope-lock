// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { cleanup, render, screen, waitFor, within, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type {
  Invoice,
  Job,
  WorkOrderDashboardJob,
  WorkOrdersDashboardCursor,
  WorkOrdersDashboardSummary,
} from '../../types/db';
import { WorkOrdersPage } from '../WorkOrdersPage';
import { ESIGN_POLL_INTERVAL_MS } from '../../lib/esign-live';

const listWorkOrdersDashboard = vi.fn();
const listWorkOrdersDashboardPage = vi.fn();
const getWorkOrdersDashboardSummary = vi.fn();
const getJobById = vi.fn();
const getChangeOrderById = vi.fn();
const getInvoice = vi.fn();

vi.mock('../../lib/db/jobs', () => ({
  listWorkOrdersDashboard: (...args: unknown[]) => listWorkOrdersDashboard(...args),
  listWorkOrdersDashboardPage: (...args: unknown[]) => listWorkOrdersDashboardPage(...args),
  getWorkOrdersDashboardSummary: (...args: unknown[]) => getWorkOrdersDashboardSummary(...args),
  getJobById: (...args: unknown[]) => getJobById(...args),
}));

vi.mock('../../lib/db/invoices', () => ({
  getInvoice: (...args: unknown[]) => getInvoice(...args),
}));

const summaryResult: WorkOrdersDashboardSummary = {
  jobCount: 2,
  invoicedContractTotal: 125,
  pendingContractTotal: 275,
};

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
  changeOrderCount: 0,
  changeOrderPreview: [],
  hasInFlightChangeOrders: false,
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
  changeOrderCount: 0,
  changeOrderPreview: [],
  hasInFlightChangeOrders: false,
  latestInvoice: null,
};

function previewCO(
  id: string,
  coNumber: number,
  esignStatus: WorkOrderDashboardJob['changeOrderPreview'][number]['esign_status']
) {
  return {
    id,
    job_id: 'job-a',
    co_number: coNumber,
    esign_status: esignStatus,
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

function makePageResult(
  data: WorkOrderDashboardJob[],
  opts?: { hasMore?: boolean; nextCursor?: WorkOrdersDashboardCursor | null }
) {
  return {
    data,
    error: null,
    hasMore: opts?.hasMore ?? false,
    nextCursor: opts?.nextCursor ?? null,
  } as const;
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
  const onCreateWorkOrder = vi.fn();
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
      onCreateWorkOrder={onCreateWorkOrder}
      onCompleteProfileClick={() => {}}
      onStartInvoice={onStartInvoice}
      onOpenPendingInvoice={onOpenPendingInvoice}
      onOpenWorkOrderDetail={onOpenWorkOrderDetail}
      onOpenChangeOrderDetail={onOpenChangeOrderDetail}
    />
  );
  return {
    onCreateWorkOrder,
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
    listWorkOrdersDashboardPage.mockReset();
    getWorkOrdersDashboardSummary.mockReset();
    getJobById.mockReset();
    getInvoice.mockReset();
    listWorkOrdersDashboardPage.mockResolvedValue(makePageResult([listJobA]));
    getWorkOrdersDashboardSummary.mockResolvedValue({ data: summaryResult, error: null });
    listWorkOrdersDashboard.mockResolvedValue([]);
    getJobById.mockImplementation((id: string) => Promise.resolve(minimalFullJob(id, id)));
    getChangeOrderById.mockImplementation((id: string) =>
      Promise.resolve(minimalFullChangeOrder(id, Number(id.replace(/\D/g, '')) || 1))
    );
    getInvoice.mockImplementation((id: string) => Promise.resolve(minimalInvoice(id)));
  });

  it('renders the Create Work Order button and calls onCreateWorkOrder', async () => {
    const user = userEvent.setup();
    const { onCreateWorkOrder } = renderPage();

    await screen.findByText('Customer A');
    await user.click(screen.getByRole('button', { name: /create work order/i }));

    expect(onCreateWorkOrder).toHaveBeenCalledTimes(1);
  });

  it('loads the first page and whole-dataset summary from separate queries', async () => {
    listWorkOrdersDashboardPage.mockResolvedValue(makePageResult([listJobA, listJobB]));
    getWorkOrdersDashboardSummary.mockResolvedValue({
      data: {
        jobCount: 2,
        invoicedContractTotal: 150,
        pendingContractTotal: 250,
      },
      error: null,
    });

    renderPage();

    await waitFor(() => {
      expect(screen.getByText('Customer A')).toBeInTheDocument();
      expect(screen.getByText('Customer B')).toBeInTheDocument();
    });

    expect(listWorkOrdersDashboardPage).toHaveBeenCalledWith('u1', 25);
    expect(getWorkOrdersDashboardSummary).toHaveBeenCalledWith('u1');
    expect(screen.getByText('$150')).toBeInTheDocument();
    expect(screen.getByText('$250')).toBeInTheDocument();
  });

  it('loads more rows with cursor pagination and appends without replacing earlier rows', async () => {
    const nextCursor = { created_at: '2025-01-02T12:00:00Z', id: 'job-b' };
    listWorkOrdersDashboardPage
      .mockResolvedValueOnce(makePageResult([listJobA, listJobB], { hasMore: true, nextCursor }))
      .mockResolvedValueOnce(
        makePageResult([
          {
            ...listJobA,
            id: 'job-c',
            customer_name: 'Customer C',
            wo_number: 3,
            created_at: '2025-01-03T12:00:00Z',
          },
        ])
      );

    const user = userEvent.setup();
    renderPage();

    await screen.findByText('Customer B');
    await user.click(screen.getByRole('button', { name: /load more/i }));

    await waitFor(() => {
      expect(screen.getByText('Customer C')).toBeInTheDocument();
    });

    expect(listWorkOrdersDashboardPage).toHaveBeenNthCalledWith(2, 'u1', 25, nextCursor);
    expect(screen.getByText('Customer A')).toBeInTheDocument();
    expect(screen.getByText('Customer B')).toBeInTheDocument();
  });

  it('polls loaded rows with in-flight work-order statuses and merges the refresh result', async () => {
    vi.useFakeTimers();
    listWorkOrdersDashboardPage.mockResolvedValue(makePageResult([listJobA, listJobB]));
    listWorkOrdersDashboard.mockResolvedValue([{ ...listJobB, esign_status: 'completed' }]);

    renderPage();
    await flushAsync();

    expect(screen.getByLabelText('E-signature status: Sent')).toBeInTheDocument();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(ESIGN_POLL_INTERVAL_MS);
    });
    await flushAsync();

    expect(listWorkOrdersDashboard).toHaveBeenCalledWith('u1', ['job-b']);
    expect(screen.getByLabelText('E-signature status: Signed')).toBeInTheDocument();
    expect(screen.getByText('Customer A')).toBeInTheDocument();
  });

  it('polls loaded rows when hidden change orders are in flight via hasInFlightChangeOrders', async () => {
    vi.useFakeTimers();
    listWorkOrdersDashboardPage.mockResolvedValue(
      makePageResult([
        {
          ...listJobA,
          changeOrderCount: 4,
          changeOrderPreview: [previewCO('co-1', 1, 'completed'), previewCO('co-2', 2, 'completed')],
          hasInFlightChangeOrders: true,
        },
      ])
    );
    listWorkOrdersDashboard.mockResolvedValue([
      {
        ...listJobA,
        changeOrderCount: 4,
        changeOrderPreview: [previewCO('co-1', 1, 'completed'), previewCO('co-2', 2, 'completed')],
        hasInFlightChangeOrders: false,
      },
    ]);

    renderPage();
    await flushAsync();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(ESIGN_POLL_INTERVAL_MS);
    });
    await flushAsync();

    expect(listWorkOrdersDashboard).toHaveBeenCalledWith('u1', ['job-a']);
  });

  it('opens work-order detail immediately with the row job id and does not prefetch on click', async () => {
    const user = userEvent.setup();
    const { onOpenWorkOrderDetail } = renderPage();

    await screen.findByText('Customer A');
    await user.click(screen.getByRole('button', { name: /Customer A/i }));

    expect(onOpenWorkOrderDetail).toHaveBeenCalledWith('job-a');
    expect(getJobById).not.toHaveBeenCalled();
  });

  it('hydrates a full job only when starting an invoice', async () => {
    const user = userEvent.setup();
    const { onStartInvoice } = renderPage();

    await screen.findByText('Customer A');
    await user.click(screen.getByRole('button', { name: /^Invoice$/i }));

    await waitFor(() => {
      expect(onStartInvoice).toHaveBeenCalledTimes(1);
    });
    expect(getJobById).toHaveBeenCalledWith('job-a');
  });

  it('shows View & Create Change Orders link when changeOrderCount > 0 and opens change-orders section', async () => {
    listWorkOrdersDashboardPage.mockResolvedValue(
      makePageResult([
        {
          ...listJobA,
          changeOrderCount: 4,
          changeOrderPreview: [previewCO('co-1', 1, 'opened'), previewCO('co-2', 2, 'completed')],
          hasInFlightChangeOrders: true,
        },
      ])
    );

    const user = userEvent.setup();
    const { onOpenWorkOrderDetail } = renderPage();

    await screen.findByText('Customer A');
    const link = screen.getByRole('button', { name: /View & Create Change Orders/i });
    expect(link).toHaveTextContent('View & Create Change Orders');

    await user.click(link);

    expect(onOpenWorkOrderDetail).toHaveBeenCalledWith('job-a', 'change-orders');
  });

  it('renders Pending and Invoiced actions from dashboard invoice fields', async () => {
    listWorkOrdersDashboardPage.mockResolvedValue(
      makePageResult([
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
      ])
    );

    renderPage();

    await waitFor(() => {
      const list = latestWorkOrdersListUl();
      expect(within(list).getByRole('button', { name: /^Pending$/i })).toBeInTheDocument();
      expect(within(list).getByRole('button', { name: /^Invoiced$/i })).toBeInTheDocument();
    });
  });

  it('opens the pending invoice using the invoice id from the dashboard row', async () => {
    listWorkOrdersDashboardPage.mockResolvedValue(
      makePageResult([
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
      ])
    );

    const user = userEvent.setup();
    const { onOpenPendingInvoice } = renderPage();

    await screen.findByRole('button', { name: /^Pending$/i });
    await user.click(screen.getByRole('button', { name: /^Pending$/i }));

    await waitFor(() => {
      expect(onOpenPendingInvoice).toHaveBeenCalledTimes(1);
    });
    expect(getInvoice).toHaveBeenCalledWith('inv-a');
  });

  it('shows the date on the row header', async () => {
    renderPage();
    await screen.findByText('Customer A');
    expect(screen.getByText('Jan 1, 2025')).toBeInTheDocument();
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
