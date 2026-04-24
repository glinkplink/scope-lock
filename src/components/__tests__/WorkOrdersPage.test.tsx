// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { cleanup, render, screen, waitFor, within, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type {
  BusinessProfile,
  Invoice,
  Job,
  WorkOrderDashboardJob,
  WorkOrdersDashboardCursor,
  WorkOrdersDashboardSummary,
} from '../../types/db';
import { WorkOrdersPage } from '../WorkOrdersPage';

const listWorkOrdersDashboardPage = vi.fn();
const getWorkOrdersDashboardSummary = vi.fn();
const getSignedWorkOrdersCount = vi.fn();
const getJobById = vi.fn();
const getInvoice = vi.fn();

vi.mock('../../lib/db/jobs', () => ({
  listWorkOrdersDashboardPage: (...args: unknown[]) => listWorkOrdersDashboardPage(...args),
  getWorkOrdersDashboardSummary: (...args: unknown[]) => getWorkOrdersDashboardSummary(...args),
  getSignedWorkOrdersCount: (...args: unknown[]) => getSignedWorkOrdersCount(...args),
  getJobById: (...args: unknown[]) => getJobById(...args),
}));

vi.mock('../../lib/db/invoices', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../lib/db/invoices')>();
  return {
    ...actual,
    getInvoice: (...args: unknown[]) => getInvoice(...args),
  };
});

const summaryResult: WorkOrdersDashboardSummary = {
  jobCount: 2,
  invoicedContractTotal: 125,
  pendingContractTotal: 275,
  paidContractTotal: 0,
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
  offline_signed_at: null,
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
  offline_signed_at: null,
  changeOrderCount: 0,
  changeOrderPreview: [],
  hasInFlightChangeOrders: false,
  latestInvoice: null,
};

const listJobSignedOffline: WorkOrderDashboardJob = {
  id: 'job-c',
  wo_number: 3,
  customer_name: 'Customer C',
  job_type: 'repair',
  other_classification: null,
  agreement_date: '2025-01-03',
  created_at: '2025-01-03T12:00:00Z',
  price: 300,
  esign_status: 'not_sent',
  offline_signed_at: '2025-01-03T16:00:00Z',
  changeOrderCount: 0,
  changeOrderPreview: [],
  hasInFlightChangeOrders: false,
  latestInvoice: {
    id: 'inv-c',
    job_id: 'job-c',
    issued_at: '2025-01-04T00:00:00Z',
    invoice_number: 3,
    created_at: '2025-01-04T00:00:00Z',
    payment_status: 'offline',
  },
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
    esign_resent_at: null,
    offline_signed_at: null,
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

const PROFILE_NUDGE_STORAGE_PREFIX = 'scope-lock-hide-complete-profile-cta:';

function minimalProfileWithPhone(overrides: Partial<BusinessProfile> = {}): BusinessProfile {
  return {
    id: 'p1',
    user_id: 'u1',
    business_name: 'Biz',
    owner_name: 'Owner',
    phone: '5551234567',
    email: 'o@example.com',
    address: null,
    google_business_profile_url: null,
    default_exclusions: [],
    default_assumptions: [],
    next_wo_number: 1,
    next_invoice_number: 1,
    default_warranty_period: 0,
    default_negotiation_period: 0,
    default_payment_methods: [],
    default_tax_rate: 0,
    default_late_payment_terms: '',
    default_payment_terms_days: 0,
    default_late_fee_rate: 0,
    default_card_fee_note: false,
    stripe_account_id: null,
    stripe_onboarding_complete: false,
    created_at: '2025-01-01T00:00:00Z',
    updated_at: '2025-01-01T00:00:00Z',
    ...overrides,
  };
}

function minimalProfileNoPhone(): BusinessProfile {
  return minimalProfileWithPhone({ phone: null });
}

function renderPage(profile: BusinessProfile | null = null) {
  const onCreateWorkOrder = vi.fn();
  const onStartInvoice = vi.fn();
  const onOpenPendingInvoice = vi.fn();
  const onOpenWorkOrderDetail = vi.fn();
  const onClearSuccessBanner = vi.fn();
  render(
    <WorkOrdersPage
      userId="u1"
      profile={profile}
      successBanner={null}
      onClearSuccessBanner={onClearSuccessBanner}
      onCreateWorkOrder={onCreateWorkOrder}
      onCompleteProfileClick={() => {}}
      onStartInvoice={onStartInvoice}
      onOpenPendingInvoice={onOpenPendingInvoice}
      onOpenWorkOrderDetail={onOpenWorkOrderDetail}
    />
  );
  return {
    onCreateWorkOrder,
    onStartInvoice,
    onOpenPendingInvoice,
    onOpenWorkOrderDetail,
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
    localStorage.clear();
    listWorkOrdersDashboardPage.mockReset();
    getWorkOrdersDashboardSummary.mockReset();
    getSignedWorkOrdersCount.mockReset();
    getJobById.mockReset();
    getInvoice.mockReset();
    listWorkOrdersDashboardPage.mockResolvedValue(makePageResult([listJobA]));
    getWorkOrdersDashboardSummary.mockResolvedValue({ data: summaryResult, error: null });
    getSignedWorkOrdersCount.mockResolvedValue({ data: 1, error: null });
    getJobById.mockImplementation((id: string) => Promise.resolve(minimalFullJob(id, id)));
    getInvoice.mockImplementation((id: string) => Promise.resolve(minimalInvoice(id)));
  });

  it('renders the Create Work Order button and calls onCreateWorkOrder', async () => {
    const user = userEvent.setup();
    const { onCreateWorkOrder } = renderPage(minimalProfileWithPhone());

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
        paidContractTotal: 0,
      },
      error: null,
    });
    getSignedWorkOrdersCount.mockResolvedValue({ data: 1, error: null });

    renderPage(minimalProfileWithPhone());

    await waitFor(() => {
      expect(screen.getByText('Customer A')).toBeInTheDocument();
      expect(screen.getByText('Customer B')).toBeInTheDocument();
    });

    expect(listWorkOrdersDashboardPage).toHaveBeenCalledWith('u1', 25);
    expect(getWorkOrdersDashboardSummary).toHaveBeenCalledWith('u1');
    expect(getSignedWorkOrdersCount).toHaveBeenCalledWith('u1');
    const statGroup = screen.getByRole('group', {
      name: /Work order counts/i,
    });
    expect(within(statGroup).getByText('2')).toBeInTheDocument();
    expect(within(statGroup).getByText('1')).toBeInTheDocument();
    expect(within(statGroup).getByText("WO's signed")).toBeInTheDocument();
    expect(within(statGroup).queryByText('Invoiced')).not.toBeInTheDocument();
    expect(within(statGroup).queryByText('Paid')).not.toBeInTheDocument();
    expect(within(statGroup).queryByText('Pending invoice')).not.toBeInTheDocument();
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

  it('opens work-order detail immediately with the row job id and does not prefetch on click', async () => {
    const user = userEvent.setup();
    const { onOpenWorkOrderDetail } = renderPage(minimalProfileWithPhone());

    await screen.findByText('Customer A');
    await user.click(screen.getByText('Customer A'));

    expect(onOpenWorkOrderDetail).toHaveBeenCalledWith('job-a');
    expect(getJobById).not.toHaveBeenCalled();
  });

  it('hydrates a full job only when starting an invoice', async () => {
    const user = userEvent.setup();
    const { onStartInvoice } = renderPage(minimalProfileWithPhone());

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

  it('renders the mini e-sign strip below the change-orders link on the work-orders row', async () => {
    listWorkOrdersDashboardPage.mockResolvedValue(
      makePageResult([
        {
          ...listJobA,
          esign_status: 'completed',
          changeOrderCount: 2,
        },
      ])
    );

    renderPage(minimalProfileWithPhone());

    await screen.findByText('Customer A');
    const row = screen.getByText('Customer A').closest('li');
    expect(row).toBeTruthy();
    const rowEl = row as HTMLElement;
    const link = within(rowEl).getByRole('button', { name: /View & Create Change Orders/i });
    const strip = within(rowEl).getByLabelText('Signature status: Signed');

    expect(link.compareDocumentPosition(strip) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('renders Draft and Invoiced actions from dashboard invoice fields', async () => {
    listWorkOrdersDashboardPage.mockResolvedValue(
      makePageResult([
        {
          ...listJobA,
          latestInvoice: {
            id: 'inv-a',
            job_id: 'job-a',
            issued_at: null,
            invoice_number: 1,
            created_at: '2025-01-03T00:00:00Z',
            payment_status: 'unpaid',
          },
        },
        {
          ...listJobB,
          latestInvoice: {
            id: 'inv-b',
            job_id: 'job-b',
            issued_at: '2025-01-04T00:00:00Z',
            invoice_number: 2,
            created_at: '2025-01-04T00:00:00Z',
            payment_status: 'unpaid',
          },
        },
      ])
    );

    renderPage();

    await waitFor(() => {
      const list = latestWorkOrdersListUl();
      expect(within(list).getByRole('button', { name: /^Draft$/i })).toBeInTheDocument();
      expect(within(list).getByRole('button', { name: /^Invoiced$/i })).toBeInTheDocument();
    });
  });

  it('renders Paid Offline row action and opens invoice on click', async () => {
    listWorkOrdersDashboardPage.mockResolvedValue(
      makePageResult([
        {
          ...listJobA,
          latestInvoice: {
            id: 'inv-off',
            job_id: 'job-a',
            issued_at: '2025-01-05T00:00:00Z',
            invoice_number: 9,
            created_at: '2025-01-05T00:00:00Z',
            payment_status: 'offline',
          },
        },
      ])
    );

    const user = userEvent.setup();
    const { onOpenPendingInvoice } = renderPage(minimalProfileWithPhone());

    await waitFor(() => {
      const list = latestWorkOrdersListUl();
      expect(within(list).getByRole('button', { name: /^Paid Offline$/i })).toBeInTheDocument();
    });

    await user.click(screen.getByRole('button', { name: /^Paid Offline$/i }));

    await waitFor(() => {
      expect(onOpenPendingInvoice).toHaveBeenCalledTimes(1);
    });
    expect(getInvoice).toHaveBeenCalledWith('inv-off');
  });

  it('opens the pending invoice using the invoice id from the dashboard row', async () => {
    listWorkOrdersDashboardPage.mockResolvedValue(
      makePageResult([
        {
          ...listJobA,
          latestInvoice: {
            id: 'inv-a',
            job_id: 'job-a',
            issued_at: null,
            invoice_number: 1,
            created_at: '2025-01-03T00:00:00Z',
            payment_status: 'unpaid',
          },
        },
      ])
    );

    const user = userEvent.setup();
    const { onOpenPendingInvoice } = renderPage(minimalProfileWithPhone());

    await screen.findByRole('button', { name: /^Draft$/i });
    await user.click(screen.getByRole('button', { name: /^Draft$/i }));

    await waitFor(() => {
      expect(onOpenPendingInvoice).toHaveBeenCalledTimes(1);
    });
    expect(getInvoice).toHaveBeenCalledWith('inv-a');
  });

  it('shows the date on the row header', async () => {
    renderPage();
    await screen.findByText('Customer A');
    expect(screen.getByText((text) => text.includes('Jan 1, 2025'))).toBeInTheDocument();
  });

  it('clears the success banner after 10 seconds and not before', async () => {
    vi.useFakeTimers();
    const onClearSuccessBanner = vi.fn();

    render(
      <WorkOrdersPage
        userId="u1"
        profile={minimalProfileWithPhone()}
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

  it('shows Forge empty state when there are no work orders', async () => {
    listWorkOrdersDashboardPage.mockResolvedValue(makePageResult([]));
    renderPage(minimalProfileWithPhone());

    await waitFor(() => {
      expect(screen.getByText('No work orders yet')).toBeInTheDocument();
      expect(
        screen.getByText(/Create your first agreement and it will show up here/)
      ).toBeInTheDocument();
    });
  });

  it('filters loaded rows by search text only', async () => {
    const user = userEvent.setup();
    listWorkOrdersDashboardPage.mockResolvedValue(
      makePageResult([listJobA, listJobB, listJobSignedOffline])
    );

    renderPage(minimalProfileWithPhone());

    await screen.findByText('Customer C');
    await user.type(
      screen.getByRole('searchbox', { name: /search loaded work orders/i }),
      'Customer B'
    );

    const list = latestWorkOrdersListUl();
    expect(within(list).getByText('Customer B')).toBeInTheDocument();
    expect(within(list).queryByText('Customer A')).not.toBeInTheDocument();
    expect(within(list).queryByText('Customer C')).not.toBeInTheDocument();
  });

  it('searches loaded rows by job type, visible date, amount, and status', async () => {
    const user = userEvent.setup();
    listWorkOrdersDashboardPage.mockResolvedValue(
      makePageResult([
        {
          ...listJobA,
          customer_name: 'Alpha Fab',
          job_type: 'Custom stair rail',
          agreement_date: '2025-02-14',
          price: 1234,
        },
        {
          ...listJobB,
          customer_name: 'Bravo Fab',
          job_type: 'Gate repair',
          agreement_date: '2025-03-20',
          price: 500,
          latestInvoice: {
            id: 'inv-b',
            job_id: 'job-b',
            issued_at: '2025-03-21T00:00:00Z',
            invoice_number: 2,
            created_at: '2025-03-21T00:00:00Z',
            payment_status: 'unpaid',
          },
        },
      ])
    );

    renderPage(minimalProfileWithPhone());

    await screen.findByText('Bravo Fab');

    const search = screen.getByRole('searchbox', { name: /search loaded work orders/i });
    await user.type(search, 'stair');
    let list = latestWorkOrdersListUl();
    expect(within(list).getByText('Alpha Fab')).toBeInTheDocument();
    expect(within(list).queryByText('Bravo Fab')).not.toBeInTheDocument();

    await user.clear(search);
    await user.type(search, 'Mar 20');
    list = latestWorkOrdersListUl();
    expect(within(list).getByText('Bravo Fab')).toBeInTheDocument();
    expect(within(list).queryByText('Alpha Fab')).not.toBeInTheDocument();

    await user.clear(search);
    await user.type(search, '$500');
    list = latestWorkOrdersListUl();
    expect(within(list).getByText('Bravo Fab')).toBeInTheDocument();
    expect(within(list).queryByText('Alpha Fab')).not.toBeInTheDocument();

    await user.clear(search);
    await user.type(search, 'invoiced');
    list = latestWorkOrdersListUl();
    expect(within(list).getByText('Bravo Fab')).toBeInTheDocument();
    expect(within(list).queryByText('Alpha Fab')).not.toBeInTheDocument();
  });

  it('filters by each chip predicate and keeps signed chip inclusive of offline-signed rows', async () => {
    const user = userEvent.setup();
    listWorkOrdersDashboardPage.mockResolvedValue(
      makePageResult([
        listJobA,
        {
          ...listJobB,
          latestInvoice: {
            id: 'inv-b',
            job_id: 'job-b',
            issued_at: null,
            invoice_number: 2,
            created_at: '2025-01-02T00:00:00Z',
            payment_status: 'unpaid',
          },
        },
        listJobSignedOffline,
      ])
    );

    renderPage(minimalProfileWithPhone());

    await screen.findByText('Customer C');

    await user.click(screen.getByRole('tab', { name: /needs signature/i }));
    let list = latestWorkOrdersListUl();
    expect(within(list).getByText('Customer A')).toBeInTheDocument();
    expect(within(list).getByText('Customer B')).toBeInTheDocument();
    expect(within(list).queryByText('Customer C')).not.toBeInTheDocument();

    await user.click(screen.getByRole('tab', { name: /^Signed$/i }));
    list = latestWorkOrdersListUl();
    expect(within(list).getByText('Customer C')).toBeInTheDocument();
    expect(within(list).queryByText('Customer A')).not.toBeInTheDocument();

    await user.click(screen.getByRole('tab', { name: /draft invoice/i }));
    list = latestWorkOrdersListUl();
    expect(within(list).getByText('Customer B')).toBeInTheDocument();
    expect(within(list).queryByText('Customer A')).not.toBeInTheDocument();

    await user.click(screen.getByRole('tab', { name: /^Paid offline$/i }));
    list = latestWorkOrdersListUl();
    expect(within(list).getByText('Customer C')).toBeInTheDocument();
    expect(within(list).queryByText('Customer B')).not.toBeInTheDocument();
  });

  it('shows filtered-empty state and keeps Load More available when more rows can satisfy filters', async () => {
    const user = userEvent.setup();
    const nextCursor = { created_at: '2025-01-03T12:00:00Z', id: 'job-c' };
    listWorkOrdersDashboardPage
      .mockResolvedValueOnce(makePageResult([listJobA], { hasMore: true, nextCursor }))
      .mockResolvedValueOnce(makePageResult([listJobSignedOffline]));

    renderPage(minimalProfileWithPhone());

    await screen.findByText('Customer A');
    await user.click(screen.getByRole('tab', { name: /^Paid offline$/i }));

    expect(screen.getByText('No loaded work orders match')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /load more/i })).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /load more/i }));

    await waitFor(() => {
      const list = latestWorkOrdersListUl();
      expect(within(list).getByText('Customer C')).toBeInTheDocument();
    });
  });

  it('combines search and status chip filtering on the loaded dataset', async () => {
    const user = userEvent.setup();
    listWorkOrdersDashboardPage.mockResolvedValue(
      makePageResult([
        {
          ...listJobA,
          customer_name: 'Alpha Fab',
          latestInvoice: {
            id: 'inv-a',
            job_id: 'job-a',
            issued_at: '2025-01-02T00:00:00Z',
            invoice_number: 1,
            created_at: '2025-01-02T00:00:00Z',
            payment_status: 'paid',
          },
        },
        {
          ...listJobB,
          customer_name: 'Bravo Fab',
          latestInvoice: {
            id: 'inv-b',
            job_id: 'job-b',
            issued_at: '2025-01-02T00:00:00Z',
            invoice_number: 2,
            created_at: '2025-01-02T00:00:00Z',
            payment_status: 'paid',
          },
        },
      ])
    );

    renderPage(minimalProfileWithPhone());

    await screen.findByText('Bravo Fab');
    await user.click(screen.getByRole('tab', { name: /^Paid$/i }));
    await user.type(screen.getByRole('searchbox', { name: /search loaded work orders/i }), 'Bravo');

    const list = latestWorkOrdersListUl();
    expect(within(list).getByText('Bravo Fab')).toBeInTheDocument();
    expect(within(list).queryByText('Alpha Fab')).not.toBeInTheDocument();
  });

  it('hides the entire profile nudge after Not now', async () => {
    localStorage.clear();
    const user = userEvent.setup();
    const onCompleteProfileClick = vi.fn();
    render(
      <WorkOrdersPage
        userId="u1"
        profile={minimalProfileNoPhone()}
        successBanner={null}
        onClearSuccessBanner={() => {}}
        onCreateWorkOrder={() => {}}
        onCompleteProfileClick={onCompleteProfileClick}
        onStartInvoice={() => {}}
        onOpenPendingInvoice={() => {}}
        onOpenWorkOrderDetail={() => {}}
      />
    );

    await screen.findByText(/Add your business phone/);
    await user.click(screen.getByRole('button', { name: /not now/i }));

    expect(screen.queryByText(/Add your business phone/)).not.toBeInTheDocument();
    expect(localStorage.getItem(`${PROFILE_NUDGE_STORAGE_PREFIX}u1`)).toBeTruthy();
  });

  it('shows profile nudge again when dismissal is older than 48 hours', async () => {
    localStorage.setItem(
      `${PROFILE_NUDGE_STORAGE_PREFIX}u1`,
      String(Date.now() - 49 * 60 * 60 * 1000)
    );

    render(
      <WorkOrdersPage
        userId="u1"
        profile={minimalProfileNoPhone()}
        successBanner={null}
        onClearSuccessBanner={() => {}}
        onCreateWorkOrder={() => {}}
        onCompleteProfileClick={() => {}}
        onStartInvoice={() => {}}
        onOpenPendingInvoice={() => {}}
        onOpenWorkOrderDetail={() => {}}
      />
    );

    await screen.findByText(/Add your business phone/);
  });

  it('does not apply user A dismissal to user B profile nudge', async () => {
    localStorage.setItem(`${PROFILE_NUDGE_STORAGE_PREFIX}u1`, String(Date.now()));

    const { rerender } = render(
      <WorkOrdersPage
        userId="u1"
        profile={minimalProfileNoPhone()}
        successBanner={null}
        onClearSuccessBanner={() => {}}
        onCreateWorkOrder={() => {}}
        onCompleteProfileClick={() => {}}
        onStartInvoice={() => {}}
        onOpenPendingInvoice={() => {}}
        onOpenWorkOrderDetail={() => {}}
      />
    );

    await screen.findByText('Customer A');
    expect(screen.queryByText(/Add your business phone/)).not.toBeInTheDocument();

    listWorkOrdersDashboardPage.mockResolvedValue(
      makePageResult([{ ...listJobA, id: 'job-u2' }])
    );

    rerender(
      <WorkOrdersPage
        userId="u2"
        profile={minimalProfileNoPhone()}
        successBanner={null}
        onClearSuccessBanner={() => {}}
        onCreateWorkOrder={() => {}}
        onCompleteProfileClick={() => {}}
        onStartInvoice={() => {}}
        onOpenPendingInvoice={() => {}}
        onOpenWorkOrderDetail={() => {}}
      />
    );

    await waitFor(() => {
      expect(screen.getByText(/Add your business phone/)).toBeInTheDocument();
    });
  });
});
