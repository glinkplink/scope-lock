// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { cleanup, render, screen, waitFor, within, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { Job, WorkOrderListJob } from '../../types/db';
import { WorkOrdersPage } from '../WorkOrdersPage';
import type { ListInvoiceStatusByJobResult } from '../../lib/db/invoices';
import { ESIGN_POLL_INTERVAL_MS } from '../../lib/esign-live';

const listJobsForWorkOrders = vi.fn();
const getJobById = vi.fn();
const listInvoiceStatusByJob = vi.fn();

vi.mock('../../lib/db/jobs', () => ({
  listJobsForWorkOrders: (...args: unknown[]) => listJobsForWorkOrders(...args),
  getJobById: (...args: unknown[]) => getJobById(...args),
}));

vi.mock('../../lib/db/invoices', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../lib/db/invoices')>();
  return {
    ...actual,
    listInvoiceStatusByJob: (...args: unknown[]) => listInvoiceStatusByJob(...args),
    getInvoice: vi.fn(),
  };
});

const listJobA: WorkOrderListJob = {
  id: 'job-a',
  wo_number: 1,
  customer_name: 'Customer A',
  job_type: 'repair',
  other_classification: null,
  agreement_date: '2025-01-01',
  created_at: '2025-01-01T12:00:00Z',
  price: 100,
  esign_status: 'not_sent',
};

const listJobB: WorkOrderListJob = {
  id: 'job-b',
  wo_number: 2,
  customer_name: 'Customer B',
  job_type: 'repair',
  other_classification: null,
  agreement_date: '2025-01-02',
  created_at: '2025-01-02T12:00:00Z',
  price: 200,
  esign_status: 'sent',
};

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

/** Strict Mode can leave multiple trees in the document; use the latest mounted list. */
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
  render(
    <WorkOrdersPage
      userId="u1"
      profile={null}
      successBanner={null}
      onClearSuccessBanner={() => {}}
      onCompleteProfileClick={() => {}}
      onStartInvoice={onStartInvoice}
      onOpenPendingInvoice={onOpenPendingInvoice}
      onOpenWorkOrderDetail={onOpenWorkOrderDetail}
    />
  );
  return { onStartInvoice, onOpenPendingInvoice, onOpenWorkOrderDetail };
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
    listJobsForWorkOrders.mockReset();
    getJobById.mockReset();
    listInvoiceStatusByJob.mockReset();
    listJobsForWorkOrders.mockResolvedValue([listJobA]);
    listInvoiceStatusByJob.mockResolvedValue({
      data: [],
      error: null,
      warning: null,
    } satisfies ListInvoiceStatusByJobResult);
    getJobById.mockImplementation((id: string) => Promise.resolve(minimalFullJob(id, id)));
  });

  it('shows compact e-sign progress strip when esign_status is not not_sent', async () => {
    listJobsForWorkOrders.mockResolvedValue([
      listJobA,
      listJobB,
      { ...listJobA, id: 'job-c', customer_name: 'Customer C', esign_status: 'completed' },
      { ...listJobA, id: 'job-d', customer_name: 'Customer D', esign_status: 'declined' },
      { ...listJobA, id: 'job-e', customer_name: 'Customer E', esign_status: 'expired' },
    ]);
    renderPage();
    await waitFor(() => {
      expect(screen.getByLabelText('E-signature status: Sent')).toBeInTheDocument();
      expect(screen.getByLabelText('E-signature status: Signed')).toBeInTheDocument();
      expect(screen.getByLabelText('E-signature status: Declined')).toBeInTheDocument();
      expect(screen.getByLabelText('E-signature status: Expired')).toBeInTheDocument();
    });
    expect(screen.queryByText('Sign sent')).not.toBeInTheDocument();
  });

  it('polls the jobs list while an e-sign is in flight and updates the row strip', async () => {
    vi.useFakeTimers();
    listJobsForWorkOrders
      .mockResolvedValueOnce([listJobB])
      .mockResolvedValueOnce([{ ...listJobB, esign_status: 'completed' }]);

    renderPage();
    await flushAsync();

    expect(screen.getByLabelText('E-signature status: Sent')).toBeInTheDocument();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(ESIGN_POLL_INTERVAL_MS);
    });
    await flushAsync();

    expect(screen.getByLabelText('E-signature status: Signed')).toBeInTheDocument();
    expect(listJobsForWorkOrders).toHaveBeenCalledTimes(2);
  });

  it('does not start polling when no e-sign rows are in flight', async () => {
    vi.useFakeTimers();
    listJobsForWorkOrders.mockResolvedValue([listJobA]);

    renderPage();
    await flushAsync();
    expect(screen.getByText('Customer A')).toBeInTheDocument();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(ESIGN_POLL_INTERVAL_MS * 2);
    });

    expect(listJobsForWorkOrders).toHaveBeenCalledTimes(1);
  });

  it('stops polling after the refreshed list reaches a terminal e-sign state', async () => {
    vi.useFakeTimers();
    listJobsForWorkOrders
      .mockResolvedValueOnce([listJobB])
      .mockResolvedValueOnce([{ ...listJobB, esign_status: 'completed' }]);

    renderPage();
    await flushAsync();

    expect(screen.getByLabelText('E-signature status: Sent')).toBeInTheDocument();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(ESIGN_POLL_INTERVAL_MS);
    });
    await flushAsync();

    expect(screen.getByLabelText('E-signature status: Signed')).toBeInTheDocument();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(ESIGN_POLL_INTERVAL_MS * 2);
    });

    expect(listJobsForWorkOrders).toHaveBeenCalledTimes(2);
  });

  it('shows date on first meta line and capitalized job type on second', async () => {
    renderPage();
    await waitFor(() => {
      expect(screen.getByText('Customer A')).toBeInTheDocument();
    });
    expect(screen.getByText('Jan 1, 2025')).toBeInTheDocument();
    expect(screen.getByText('Repair')).toBeInTheDocument();
  });

  it('shows Specify text for Other job type with first letter capitalized', async () => {
    listJobsForWorkOrders.mockResolvedValue([
      { ...listJobA, job_type: 'other', other_classification: 'body shop work' },
    ]);
    renderPage();
    await waitFor(() => {
      expect(screen.getByText('Body shop work')).toBeInTheDocument();
    });
  });

  it('shows invoice column loading while jobs are shown and invoice status is still loading', async () => {
    listJobsForWorkOrders.mockResolvedValue([listJobA]);
    listInvoiceStatusByJob.mockImplementation(
      () => new Promise<ListInvoiceStatusByJobResult>(() => {})
    );

    renderPage();

    await waitFor(() => {
      expect(screen.getByText('Customer A')).toBeInTheDocument();
    });

    const loadingBtn = screen.getByRole('button', { name: /loading/i });
    expect(loadingBtn).toBeDisabled();
  });

  it('shows Unavailable when invoice-status fetch fails', async () => {
    listInvoiceStatusByJob.mockResolvedValue({
      data: null,
      error: new Error('boom'),
      warning: null,
    });

    renderPage();

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /unavailable/i })).toBeDisabled();
    });
    expect(screen.getByRole('alert')).toBeInTheDocument();
  });

  it('does not block Invoice on another row while one row is hydrating', async () => {
    listJobsForWorkOrders.mockResolvedValue([listJobA, listJobB]);
    listInvoiceStatusByJob.mockResolvedValue({ data: [], error: null, warning: null });

    let releaseA: (job: Job | null) => void;
    const hangA = new Promise<Job | null>((resolve) => {
      releaseA = resolve;
    });

    getJobById.mockImplementation((id: string) => {
      if (id === 'job-a') return hangA;
      return Promise.resolve(minimalFullJob(id, id === 'job-b' ? 'Customer B' : id));
    });

    const user = userEvent.setup();
    const { onStartInvoice } = renderPage();

    await screen.findByText('Customer B');
    const list = await waitFor(() => {
      const l = latestWorkOrdersListUl();
      expect(within(l).getAllByRole('button', { name: /^Invoice$/i })).toHaveLength(2);
      return l;
    });

    const rows = within(list).getAllByRole('listitem');
    const rowA = rows.find((el) => within(el).queryByText('Customer A'));
    const rowB = rows.find((el) => within(el).queryByText('Customer B'));
    expect(rowA && rowB).toBeTruthy();

    await user.click(within(rowA!).getByRole('button', { name: /^Invoice$/i }));
    await user.click(within(rowB!).getByRole('button', { name: /^Invoice$/i }));

    await waitFor(() => {
      expect(onStartInvoice).toHaveBeenCalledTimes(1);
    });
    expect(onStartInvoice.mock.calls[0][0].id).toBe('job-b');

    releaseA!(minimalFullJob('job-a', 'Customer A'));
  });

  it('uses the latest invoice status per job when two rows share the same job_id', async () => {
    listInvoiceStatusByJob.mockResolvedValue({
      data: [
        {
          id: 'inv-latest',
          job_id: 'job-a',
          status: 'downloaded',
          invoice_number: 2,
          created_at: '2025-02-02T00:00:00Z',
        },
        {
          id: 'inv-older',
          job_id: 'job-a',
          status: 'draft',
          invoice_number: 1,
          created_at: '2025-01-01T00:00:00Z',
        },
      ],
      error: null,
      warning: null,
    });

    renderPage();

    await waitFor(() => {
      const list = latestWorkOrdersListUl();
      expect(
        within(list).getByRole('button', { name: /^Invoiced$/i })
      ).toBeInTheDocument();
    });
  });

  it('shows a warning banner when some invoice rows are skipped but keeps Invoice actions enabled', async () => {
    listInvoiceStatusByJob.mockResolvedValue({
      data: [
        {
          id: 'i1',
          job_id: 'job-a',
          status: 'draft',
          invoice_number: 1,
          created_at: '2025-01-02T00:00:00Z',
        },
      ],
      error: null,
      warning: '1 invoice row(s) could not be read and were skipped. Other invoices still work.',
    });

    renderPage();

    await waitFor(() => {
      expect(screen.getByRole('status')).toHaveTextContent(/skipped/i);
    });
    expect(screen.queryByText(/Could not load invoice status \(boom\)/)).not.toBeInTheDocument();

    const list = latestWorkOrdersListUl();
    const pendingBtn = within(list).getByRole('button', { name: /^Pending$/i });
    expect(pendingBtn).not.toBeDisabled();
  });
});
