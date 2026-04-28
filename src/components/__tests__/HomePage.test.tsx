// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { describe, expect, it, vi, afterEach, beforeEach } from 'vitest';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { BusinessProfile, WorkOrderDashboardJob, WorkOrdersDashboardSummary } from '../../types/db';
import { HomePage } from '../HomePage';

const listWorkOrdersDashboardPage = vi.fn();
const getWorkOrdersDashboardSummary = vi.fn();
const getInvoiceDashboardSummary = vi.fn();

vi.mock('../../lib/db/jobs', () => ({
  listWorkOrdersDashboardPage: (...args: unknown[]) => listWorkOrdersDashboardPage(...args),
  getWorkOrdersDashboardSummary: (...args: unknown[]) => getWorkOrdersDashboardSummary(...args),
}));

vi.mock('../../lib/db/invoices', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../lib/db/invoices')>();
  return {
    ...actual,
    getInvoiceDashboardSummary: (...args: unknown[]) => getInvoiceDashboardSummary(...args),
  };
});

const minimalProfile: BusinessProfile = {
  id: 'p1',
  user_id: 'u1',
  business_name: 'Acme Weld',
  owner_name: 'Jane Smith',
  phone: null,
  email: 'j@example.com',
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
};

const summaryOk: WorkOrdersDashboardSummary = {
  jobCount: 2,
  signedJobCount: 1,
  completedJobCount: 1,
  invoicedContractTotal: 100,
  pendingContractTotal: 200,
  paidContractTotal: 0,
};

const invoiceSummaryOk = {
  invoicedTotal: 100,
  pendingInvoiceTotal: 200,
  paidTotal: 0,
};

const listJob: WorkOrderDashboardJob = {
  id: 'job-1',
  wo_number: 1,
  customer_name: 'Customer Alpha',
  job_type: 'Railing repair',
  other_classification: null,
  agreement_date: '2025-06-01',
  created_at: '2025-06-01T12:00:00Z',
  price: 500,
  esign_status: 'sent',
  offline_signed_at: null,
  changeOrderCount: 0,
  changeOrderPreview: [],
  hasInFlightChangeOrders: false,
  latestInvoice: null,
};

function guestProps() {
  return {
    userId: null as string | null,
    profile: null as BusinessProfile | null,
    onCreateAgreement: vi.fn(),
    onOpenWorkOrders: vi.fn(),
    onOpenWorkOrderDetail: vi.fn(),
  };
}

function signedInProps() {
  return {
    userId: 'u1',
    profile: minimalProfile,
    onCreateAgreement: vi.fn(),
    onOpenWorkOrders: vi.fn(),
    onOpenWorkOrderDetail: vi.fn(),
  };
}

describe('HomePage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getInvoiceDashboardSummary.mockResolvedValue({ data: invoiceSummaryOk, error: null });
  });

  afterEach(() => {
    cleanup();
  });

  it('guest hero shows headline CTA and tagline', () => {
    render(<HomePage {...guestProps()} />);

    const heroHeading = screen.getByRole('heading', { level: 1 });
    expect(heroHeading).toHaveTextContent(/Pros don't work on a promise/i);
    expect(heroHeading).toHaveTextContent(/your terms/i);
    expect(screen.getByRole('button', { name: 'Create my first work order' })).toBeInTheDocument();
    expect(screen.getByText(/82%/)).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: /Client approves/i })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: /Questions you're about to ask/i })).toBeInTheDocument();
    expect(screen.getByText(/Will this hold up in my state/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Send me the checklist' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: "Start — it's free" })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Contact' })).toHaveAttribute('href', '/contact.html');
    expect(screen.getByRole('link', { name: 'Terms' })).toHaveAttribute('href', '/terms.html');
    expect(screen.getByRole('link', { name: 'Privacy' })).toHaveAttribute('href', '/privacy.html');
    expect(screen.queryByText(/Cover your ass/i)).not.toBeInTheDocument();
  });

  it('clears dashboard data when userId becomes null after signed-in load', async () => {
    listWorkOrdersDashboardPage.mockResolvedValue({
      data: [listJob],
      error: null,
      hasMore: false,
      nextCursor: null,
    });
    getWorkOrdersDashboardSummary.mockResolvedValue({ data: summaryOk, error: null });

    const { rerender } = render(<HomePage {...signedInProps()} />);

    await waitFor(() => {
      expect(screen.getByText('Customer Alpha')).toBeInTheDocument();
    });

    rerender(<HomePage {...guestProps()} />);

    expect(screen.queryByText('Customer Alpha')).not.toBeInTheDocument();
    expect(screen.queryByText(/You have \d+ work order/)).not.toBeInTheDocument();
    const heroHeading = screen.getByRole('heading', { level: 1 });
    expect(heroHeading).toHaveTextContent(/Pros don't work on a promise/i);
  });

  it('shows loading then dashboard when RPCs succeed', async () => {
    listWorkOrdersDashboardPage.mockImplementation(
      () =>
        new Promise((resolve) => {
          setTimeout(
            () =>
              resolve({
                data: [listJob],
                error: null,
                hasMore: false,
                nextCursor: null,
              }),
            20
          );
        })
    );
    getWorkOrdersDashboardSummary.mockImplementation(
      () =>
        new Promise((resolve) => {
          setTimeout(() => resolve({ data: summaryOk, error: null }), 20);
        })
    );
    getInvoiceDashboardSummary.mockImplementation(
      () =>
        new Promise((resolve) => {
          setTimeout(() => resolve({ data: invoiceSummaryOk, error: null }), 20);
        })
    );

    render(<HomePage {...signedInProps()} />);

    expect(screen.getByText('Loading…')).toBeInTheDocument();

    await waitFor(() => {
      expect(screen.getByText('Customer Alpha')).toBeInTheDocument();
    });
    expect(screen.queryByText('Loading…')).not.toBeInTheDocument();
  });

  it('shows error and Retry; Retry re-invokes both RPCs', async () => {
    const user = userEvent.setup();
    listWorkOrdersDashboardPage
      .mockResolvedValueOnce({
        data: null,
        error: new Error('page fail'),
        hasMore: false,
        nextCursor: null,
      })
      .mockResolvedValueOnce({
        data: [listJob],
        error: null,
        hasMore: false,
        nextCursor: null,
      });
    getWorkOrdersDashboardSummary
      .mockResolvedValueOnce({ data: null, error: new Error('ignored') })
      .mockResolvedValueOnce({ data: summaryOk, error: null });
    getInvoiceDashboardSummary
      .mockResolvedValueOnce({ data: null, error: new Error('ignored') })
      .mockResolvedValueOnce({ data: invoiceSummaryOk, error: null });

    render(<HomePage {...signedInProps()} />);

    await waitFor(() => {
      expect(screen.getByRole('alert')).toBeInTheDocument();
    });
    expect(screen.getByText(/Could not load dashboard/i)).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Retry' }));

    await waitFor(() => {
      expect(screen.getByText('Customer Alpha')).toBeInTheDocument();
    });
    expect(listWorkOrdersDashboardPage).toHaveBeenCalledTimes(2);
    expect(getWorkOrdersDashboardSummary).toHaveBeenCalledTimes(2);
    expect(getInvoiceDashboardSummary).toHaveBeenCalledTimes(2);
  });

  it('empty jobs shows zero subline and empty recent copy', async () => {
    listWorkOrdersDashboardPage.mockResolvedValue({
      data: [],
      error: null,
      hasMore: false,
      nextCursor: null,
    });
    getWorkOrdersDashboardSummary.mockResolvedValue({
      data: {
        jobCount: 0,
        signedJobCount: 0,
        completedJobCount: 0,
        invoicedContractTotal: 0,
        pendingContractTotal: 0,
        paidContractTotal: 0,
      },
      error: null,
    });
    getInvoiceDashboardSummary.mockResolvedValue({
      data: { invoicedTotal: 0, pendingInvoiceTotal: 0, paidTotal: 0 },
      error: null,
    });

    render(<HomePage {...signedInProps()} />);

    await waitFor(() => {
      expect(screen.getByText(/No work orders yet — tap \+ to create one/i)).toBeInTheDocument();
    });
    expect(screen.getByText('No work orders yet.')).toBeInTheDocument();
  });

  it('stat strip shows summary amounts', async () => {
    listWorkOrdersDashboardPage.mockResolvedValue({
      data: [],
      error: null,
      hasMore: false,
      nextCursor: null,
    });
    getWorkOrdersDashboardSummary.mockResolvedValue({ data: summaryOk, error: null });
    getInvoiceDashboardSummary.mockResolvedValue({
      data: { invoicedTotal: 100, pendingInvoiceTotal: 200, paidTotal: 300 },
      error: null,
    });

    render(<HomePage {...signedInProps()} />);

    await waitFor(() => {
      expect(screen.getByText('$100')).toBeInTheDocument();
    });
    expect(screen.getByText('$300')).toBeInTheDocument();

    const statGroup = screen.getByRole('group', { name: /Work order count and invoice totals/i });
    expect(within(statGroup).getByText('2')).toBeInTheDocument();
    expect(within(statGroup).getByText('1')).toBeInTheDocument();
  });

  it('recent row opens work order detail with job id', async () => {
    const user = userEvent.setup();
    const onOpenWorkOrderDetail = vi.fn();
    listWorkOrdersDashboardPage.mockResolvedValue({
      data: [listJob],
      error: null,
      hasMore: false,
      nextCursor: null,
    });
    getWorkOrdersDashboardSummary.mockResolvedValue({ data: summaryOk, error: null });

    render(<HomePage {...signedInProps()} onOpenWorkOrderDetail={onOpenWorkOrderDetail} />);

    await waitFor(() => {
      expect(screen.getByText('Customer Alpha')).toBeInTheDocument();
    });

    await user.click(screen.getByRole('button', { name: /WO #0001/i }));

    expect(onOpenWorkOrderDetail).toHaveBeenCalledWith('job-1');
  });

  it('home row uses rolled-up status chips and suppresses invoice-specific draft labels', async () => {
    const jobDraft: WorkOrderDashboardJob = {
      ...listJob,
      esign_status: 'opened',
      latestInvoice: {
        id: 'inv-draft',
        job_id: 'job-1',
        issued_at: null,
        invoice_number: 1,
        created_at: '2025-06-02T00:00:00Z',
        payment_status: 'unpaid',
      },
    };
    listWorkOrdersDashboardPage.mockResolvedValue({
      data: [jobDraft],
      error: null,
      hasMore: false,
      nextCursor: null,
    });
    getWorkOrdersDashboardSummary.mockResolvedValue({ data: summaryOk, error: null });

    render(<HomePage {...signedInProps()} />);

    await waitFor(() => {
      expect(screen.getByText('Customer Alpha')).toBeInTheDocument();
    });
    expect(screen.getByText('Opened')).toBeInTheDocument();
    expect(screen.queryByText('Draft')).toBeNull();
    expect(screen.queryByText('Invoice draft')).toBeNull();
  });

  it('paid invoice tints the dashboard card (100%-done visual anchor)', async () => {
    const jobPaid: WorkOrderDashboardJob = {
      ...listJob,
      latestInvoice: {
        id: 'inv-paid',
        job_id: 'job-1',
        issued_at: '2025-06-02T00:00:00Z',
        invoice_number: 1,
        created_at: '2025-06-02T00:00:00Z',
        payment_status: 'paid',
      },
    };
    listWorkOrdersDashboardPage.mockResolvedValue({
      data: [jobPaid],
      error: null,
      hasMore: false,
      nextCursor: null,
    });
    getWorkOrdersDashboardSummary.mockResolvedValue({ data: summaryOk, error: null });

    render(<HomePage {...signedInProps()} />);

    const card = await screen.findByRole('button', { name: /Open work order WO #0001/i });
    expect(card).toHaveClass('home-dash-card--paid');
    expect(within(card).getByText('Completed')).toBeInTheDocument();
  });

  it('offline-signed unpaid rows collapse to Signed on the homepage', async () => {
    const offlineSignedJob: WorkOrderDashboardJob = {
      ...listJob,
      esign_status: 'not_sent',
      offline_signed_at: '2025-06-02T00:00:00Z',
    };
    listWorkOrdersDashboardPage.mockResolvedValue({
      data: [offlineSignedJob],
      error: null,
      hasMore: false,
      nextCursor: null,
    });
    getWorkOrdersDashboardSummary.mockResolvedValue({ data: summaryOk, error: null });

    render(<HomePage {...signedInProps()} />);

    await waitFor(() => {
      expect(screen.getByText('Signed')).toBeInTheDocument();
    });
  });

  it('offline-paid jobs show Completed on the homepage', async () => {
    const jobCompletedOffline: WorkOrderDashboardJob = {
      ...listJob,
      latestInvoice: {
        id: 'inv-1',
        job_id: 'job-1',
        issued_at: '2025-06-02T00:00:00Z',
        invoice_number: 1,
        created_at: '2025-06-02T00:00:00Z',
        payment_status: 'offline',
      },
    };
    listWorkOrdersDashboardPage.mockResolvedValue({
      data: [jobCompletedOffline],
      error: null,
      hasMore: false,
      nextCursor: null,
    });
    getWorkOrdersDashboardSummary.mockResolvedValue({ data: summaryOk, error: null });

    render(<HomePage {...signedInProps()} />);

    await waitFor(() => {
      const recentRow = screen.getByRole('button', { name: /WO #0001/i });
      expect(within(recentRow).getByText('Completed')).toBeInTheDocument();
    });
  });

  it('opened work orders show Opened on the homepage', async () => {
    const openedJob: WorkOrderDashboardJob = {
      ...listJob,
      esign_status: 'opened',
    };
    listWorkOrdersDashboardPage.mockResolvedValue({
      data: [openedJob],
      error: null,
      hasMore: false,
      nextCursor: null,
    });
    getWorkOrdersDashboardSummary.mockResolvedValue({ data: summaryOk, error: null });

    render(<HomePage {...signedInProps()} />);

    await waitFor(() => {
      expect(screen.getByText('Opened')).toBeInTheDocument();
    });
  });

  it('declined work orders show a negative chip on the homepage', async () => {
    const declinedJob: WorkOrderDashboardJob = {
      ...listJob,
      esign_status: 'declined',
    };
    listWorkOrdersDashboardPage.mockResolvedValue({
      data: [declinedJob],
      error: null,
      hasMore: false,
      nextCursor: null,
    });
    getWorkOrdersDashboardSummary.mockResolvedValue({ data: summaryOk, error: null });

    render(<HomePage {...signedInProps()} />);

    const chip = await screen.findByText('Declined');
    expect(chip).toHaveClass('iw-status-chip', 'iw-status-chip--negative');
  });

  it('View all calls onOpenWorkOrders', async () => {
    const user = userEvent.setup();
    const onOpenWorkOrders = vi.fn();
    listWorkOrdersDashboardPage.mockResolvedValue({
      data: [],
      error: null,
      hasMore: false,
      nextCursor: null,
    });
    getWorkOrdersDashboardSummary.mockResolvedValue({
      data: {
        jobCount: 0,
        signedJobCount: 0,
        completedJobCount: 0,
        invoicedContractTotal: 0,
        pendingContractTotal: 0,
        paidContractTotal: 0,
      },
      error: null,
    });
    getInvoiceDashboardSummary.mockResolvedValue({
      data: { invoicedTotal: 0, pendingInvoiceTotal: 0, paidTotal: 0 },
      error: null,
    });

    render(<HomePage {...signedInProps()} onOpenWorkOrders={onOpenWorkOrders} />);

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'View all' })).toBeInTheDocument();
    });

    await user.click(screen.getByRole('button', { name: 'View all' }));

    expect(onOpenWorkOrders).toHaveBeenCalledTimes(1);
  });
});
