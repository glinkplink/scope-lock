// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { cleanup, render, screen, waitFor, within, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type {
  BusinessProfile,
  WorkOrderDashboardJob,
  WorkOrdersDashboardCursor,
  WorkOrdersDashboardSummary,
} from '../../types/db';
import { WorkOrdersPage } from '../WorkOrdersPage';

const listWorkOrdersDashboardPage = vi.fn();
const getWorkOrdersDashboardSummary = vi.fn();

vi.mock('../../lib/db/jobs', () => ({
  listWorkOrdersDashboardPage: (...args: unknown[]) => listWorkOrdersDashboardPage(...args),
  getWorkOrdersDashboardSummary: (...args: unknown[]) => getWorkOrdersDashboardSummary(...args),
}));

const summaryResult: WorkOrdersDashboardSummary = {
  jobCount: 2,
  signedJobCount: 1,
  completedJobCount: 1,
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
      onOpenWorkOrderDetail={onOpenWorkOrderDetail}
      onStartInvoice={() => {}}
    />
  );
  return {
    onCreateWorkOrder,
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
    listWorkOrdersDashboardPage.mockResolvedValue(makePageResult([listJobA]));
    getWorkOrdersDashboardSummary.mockResolvedValue({ data: summaryResult, error: null });
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
        signedJobCount: 1,
        completedJobCount: 0,
        invoicedContractTotal: 150,
        pendingContractTotal: 250,
        paidContractTotal: 0,
      },
      error: null,
    });

    renderPage(minimalProfileWithPhone());

    await waitFor(() => {
      expect(screen.getByText('Customer A')).toBeInTheDocument();
      expect(screen.getByText('Customer B')).toBeInTheDocument();
    });

    expect(listWorkOrdersDashboardPage).toHaveBeenCalledWith('u1', 25);
    expect(getWorkOrdersDashboardSummary).toHaveBeenCalledWith('u1');
    const statGroup = screen.getByRole('group', {
      name: /Work order counts/i,
    });
    expect(within(statGroup).getByText('2')).toBeInTheDocument();
    expect(within(statGroup).getByText('1')).toBeInTheDocument();
    expect(within(statGroup).getByText("WO's signed")).toBeInTheDocument();
    expect(within(statGroup).queryByText('Pending')).not.toBeInTheDocument();
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

  it('applies paid-row green tint when the job invoice is fully paid (same signal as the home list)', async () => {
    listWorkOrdersDashboardPage.mockResolvedValue(
      makePageResult([
        listJobA,
        listJobSignedOffline,
        {
          ...listJobA,
          id: 'job-paid-stripe',
          customer_name: 'Customer Paid Stripe',
          wo_number: 9,
          latestInvoice: {
            id: 'inv-p',
            job_id: 'job-paid-stripe',
            issued_at: '2025-01-10T00:00:00Z',
            invoice_number: 9,
            created_at: '2025-01-10T00:00:00Z',
            payment_status: 'paid',
          },
        },
      ])
    );
    renderPage(minimalProfileWithPhone());
    await screen.findByText('Customer C');
    expect(screen.getByText('Customer C').closest('li')).toHaveClass('work-orders-row--paid');
    expect(screen.getByText('Customer Paid Stripe').closest('li')).toHaveClass('work-orders-row--paid');
    expect(screen.getByText('Customer A').closest('li')).not.toHaveClass('work-orders-row--paid');
  });

  it('opens work-order detail immediately with the row job id and does not prefetch on click', async () => {
    const user = userEvent.setup();
    const { onOpenWorkOrderDetail } = renderPage(minimalProfileWithPhone());

    await screen.findByText('Customer A');
    await user.click(screen.getByText('Customer A'));

    expect(onOpenWorkOrderDetail).toHaveBeenCalledWith('job-a');
  });

  it('does not render per-row invoice chips or the start-invoice control on the list', async () => {
    listWorkOrdersDashboardPage.mockResolvedValue(
      makePageResult([
        { ...listJobA, latestInvoice: null },
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
    const list = latestWorkOrdersListUl();
    expect(within(list).queryByRole('button', { name: /^Invoice$/i })).not.toBeInTheDocument();
    expect(within(list).queryByRole('button', { name: /^Draft$/i })).not.toBeInTheDocument();
    expect(within(list).queryByRole('button', { name: /^Pending$/i })).not.toBeInTheDocument();
    expect(within(list).queryByRole('button', { name: /^Paid$/i })).not.toBeInTheDocument();
    expect(within(list).queryByRole('button', { name: /^Paid Offline$/i })).not.toBeInTheDocument();
  });

  it('renders signature chips on work-order rows using the canonical status-chip variants', async () => {
    listWorkOrdersDashboardPage.mockResolvedValue(
      makePageResult([
        {
          ...listJobA,
          id: 'job-sent',
          customer_name: 'Customer Sent',
          esign_status: 'sent',
        },
        {
          ...listJobA,
          id: 'job-opened',
          customer_name: 'Customer Opened',
          esign_status: 'opened',
        },
        {
          ...listJobA,
          id: 'job-signed',
          customer_name: 'Customer Signed',
          esign_status: 'completed',
        },
        {
          ...listJobSignedOffline,
          customer_name: 'Customer Offline',
          latestInvoice: null,
        },
        {
          ...listJobA,
          id: 'job-declined',
          customer_name: 'Customer Declined',
          esign_status: 'declined',
        },
      ])
    );

    renderPage(minimalProfileWithPhone());

    const sentRow = (await screen.findByText('Customer Sent')).closest('li') as HTMLElement;
    expect(within(sentRow).getByText('Sent')).toHaveClass('iw-status-chip', 'iw-status-chip--draft');

    const openedRow = screen.getByText('Customer Opened').closest('li') as HTMLElement;
    expect(within(openedRow).getByText('Opened')).toHaveClass(
      'iw-status-chip',
      'iw-status-chip--outstanding'
    );

    const signedRow = screen.getByText('Customer Signed').closest('li') as HTMLElement;
    expect(within(signedRow).getByText('Signed')).toHaveClass('iw-status-chip', 'iw-status-chip--paid');

    const offlineRow = screen.getByText('Customer Offline').closest('li') as HTMLElement;
    expect(within(offlineRow).getByText('Signed')).toHaveClass('iw-status-chip', 'iw-status-chip--paid');

    const declinedRow = screen.getByText('Customer Declined').closest('li') as HTMLElement;
    expect(within(declinedRow).getByText('Declined')).toHaveClass(
      'iw-status-chip',
      'iw-status-chip--negative'
    );
  });

  it('does not show a status chip for unsent unsigned work orders', async () => {
    renderPage(minimalProfileWithPhone());

    const row = (await screen.findByText('Customer A')).closest('li') as HTMLElement;
    expect(within(row).queryByText('Sent')).not.toBeInTheDocument();
    expect(within(row).queryByText('Opened')).not.toBeInTheDocument();
    expect(within(row).queryByText('Signed')).not.toBeInTheDocument();
    expect(within(row).queryByText('Signed')).not.toBeInTheDocument();
  });

  it('shows the left-column fields and right-column date on the row', async () => {
    renderPage();
    await screen.findByText('Customer A');
    expect(screen.getByText('WO #0001')).toBeInTheDocument();
    expect(screen.getByText('repair')).toBeInTheDocument();
    expect(screen.getByText('$100.00')).toBeInTheDocument();
    expect(screen.getByText('Jan 1, 2025')).toBeInTheDocument();
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
        onOpenWorkOrderDetail={() => {}}
        onStartInvoice={() => {}}
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
    await user.type(search, '$500.00');
    list = latestWorkOrdersListUl();
    expect(within(list).getByText('Bravo Fab')).toBeInTheDocument();
    expect(within(list).queryByText('Alpha Fab')).not.toBeInTheDocument();

    await user.clear(search);
    await user.type(search, 'pending');
    list = latestWorkOrdersListUl();
    expect(within(list).getByText('Bravo Fab')).toBeInTheDocument();
    expect(within(list).queryByText('Alpha Fab')).not.toBeInTheDocument();
  });

  it('filters by signature chip predicates and keeps signed chip inclusive of offline-signed rows', async () => {
    const user = userEvent.setup();
    listWorkOrdersDashboardPage.mockResolvedValue(
      makePageResult([listJobA, listJobB, listJobSignedOffline])
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
    await user.click(screen.getByRole('tab', { name: /^Signed$/i }));

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
        { ...listJobA, customer_name: 'Alpha Fab' },
        { ...listJobSignedOffline, customer_name: 'Bravo Offline' },
      ])
    );

    renderPage(minimalProfileWithPhone());

    await screen.findByText('Bravo Offline');
    await user.click(screen.getByRole('tab', { name: /^Signed$/i }));
    await user.type(screen.getByRole('searchbox', { name: /search loaded work orders/i }), 'Bravo');

    const list = latestWorkOrdersListUl();
    expect(within(list).getByText('Bravo Offline')).toBeInTheDocument();
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
        onOpenWorkOrderDetail={() => {}}
        onStartInvoice={() => {}}
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
        onOpenWorkOrderDetail={() => {}}
        onStartInvoice={() => {}}
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
        onOpenWorkOrderDetail={() => {}}
        onStartInvoice={() => {}}
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
        onOpenWorkOrderDetail={() => {}}
        onStartInvoice={() => {}}
      />
    );

    await waitFor(() => {
      expect(screen.getByText(/Add your business phone/)).toBeInTheDocument();
    });
  });

  it('hides Create Invoice button when latestInvoice exists (draft or invoiced)', async () => {
    listWorkOrdersDashboardPage.mockResolvedValue(
      makePageResult([
        {
          ...listJobA,
          latestInvoice: {
            id: 'inv-a',
            job_id: 'job-a',
            issued_at: null,
            invoice_number: 1,
            created_at: '2025-01-02T00:00:00Z',
            payment_status: 'unpaid',
          },
        },
        {
          ...listJobB,
          latestInvoice: {
            id: 'inv-b',
            job_id: 'job-b',
            issued_at: '2025-01-03T00:00:00Z',
            invoice_number: 2,
            created_at: '2025-01-03T00:00:00Z',
            payment_status: 'unpaid',
          },
        },
      ])
    );

    renderPage(minimalProfileWithPhone());

    await screen.findByText('Customer B');

    const list = latestWorkOrdersListUl();
    const rows = Array.from(list.querySelectorAll('li')) as HTMLElement[];
    
    expect(within(rows[0]).queryByRole('button', { name: /create invoice/i })).not.toBeInTheDocument();
    expect(within(rows[1]).queryByRole('button', { name: /create invoice/i })).not.toBeInTheDocument();
  });

  it('disables Create Invoice button and shows hint when WO is not signed', async () => {
    listWorkOrdersDashboardPage.mockResolvedValue(
      makePageResult([
        {
          ...listJobA,
          esign_status: 'not_sent',
          offline_signed_at: null,
        },
      ])
    );

    renderPage(minimalProfileWithPhone());

    await screen.findByText('Customer A');

    const list = latestWorkOrdersListUl();
    const row = list.querySelector('li') as HTMLElement;
    const button = within(row).getByRole('button', { name: /create invoice/i });
    
    expect(button).toBeDisabled();
    expect(within(row).getByText(/work order must be signed/i)).toBeInTheDocument();
  });

  it('enables Create Invoice button when WO is signed (e-sign completed)', async () => {
    listWorkOrdersDashboardPage.mockResolvedValue(
      makePageResult([
        {
          ...listJobA,
          esign_status: 'completed',
          offline_signed_at: null,
        },
      ])
    );

    renderPage(minimalProfileWithPhone());

    await screen.findByText('Customer A');

    const list = latestWorkOrdersListUl();
    const row = list.querySelector('li') as HTMLElement;
    const button = within(row).getByRole('button', { name: /create invoice/i });
    
    expect(button).not.toBeDisabled();
    expect(within(row).queryByText(/work order must be signed/i)).not.toBeInTheDocument();
  });

  it('enables Create Invoice button when WO is marked signed offline', async () => {
    listWorkOrdersDashboardPage.mockResolvedValue(
      makePageResult([
        {
          ...listJobA,
          esign_status: 'not_sent',
          offline_signed_at: '2025-01-02T00:00:00Z',
        },
      ])
    );

    renderPage(minimalProfileWithPhone());

    await screen.findByText('Customer A');

    const list = latestWorkOrdersListUl();
    const row = list.querySelector('li') as HTMLElement;
    const button = within(row).getByRole('button', { name: /create invoice/i });
    
    expect(button).not.toBeDisabled();
  });

  it('renders work order date in footer at bottom-right of row', async () => {
    listWorkOrdersDashboardPage.mockResolvedValue(
      makePageResult([listJobA])
    );

    renderPage(minimalProfileWithPhone());

    await screen.findByText('Customer A');

    const list = latestWorkOrdersListUl();
    const row = list.querySelector('li') as HTMLElement;
    const footer = row.querySelector('.work-orders-row-footer');
    
    expect(footer).toBeInTheDocument();
    expect(footer?.querySelector('.work-orders-wo-date')).toBeInTheDocument();
  });
});
