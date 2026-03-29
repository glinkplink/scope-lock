// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { cleanup, render, screen, waitFor, within, act } from '@testing-library/react';
import { useState } from 'react';
import type { Job, BusinessProfile, ChangeOrder } from '../../types/db';
import { WorkOrderDetailPage } from '../WorkOrderDetailPage';
import { ESIGN_POLL_INTERVAL_MS } from '../../lib/esign-live';

const mockFns = vi.hoisted(() => {
  const listChangeOrders = vi.fn();
  const listInvoiceStatusByChangeOrder = vi.fn();
  const getJobById = vi.fn();
  const sendWorkOrderForSignature = vi.fn();
  const resendWorkOrderSignature = vi.fn();
  const coBlockState = { blocks: false, error: null as Error | null };
  const getBlocksNewChangeOrdersForJob: ReturnType<typeof vi.fn<(userId: string, jobId: string) => Promise<{ blocks: boolean; error: Error | null }>>> = vi.fn(async () => ({
    blocks: coBlockState.blocks,
    error: coBlockState.error,
  }));
  return {
    listChangeOrders,
    listInvoiceStatusByChangeOrder,
    getJobById,
    sendWorkOrderForSignature,
    resendWorkOrderSignature,
    getBlocksNewChangeOrdersForJob,
    setCoBlockResult(next: { blocks: boolean; error: Error | null }) {
      coBlockState.blocks = next.blocks;
      coBlockState.error = next.error;
    },
  };
});

vi.mock('../../lib/db/change-orders', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../lib/db/change-orders')>();
  return {
    ...actual,
    listChangeOrders: (jobId: string) => mockFns.listChangeOrders(jobId),
  };
});

vi.mock('../../lib/db/invoices', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../lib/db/invoices')>();
  return {
    ...actual,
    listInvoiceStatusByChangeOrder: (jobId: string) => mockFns.listInvoiceStatusByChangeOrder(jobId),
    getBlocksNewChangeOrdersForJob: (userId: string, jobId: string) => mockFns.getBlocksNewChangeOrdersForJob(userId, jobId),
  };
});

vi.mock('../../lib/db/jobs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../lib/db/jobs')>();
  return {
    ...actual,
    getJobById: (id: string) => mockFns.getJobById(id),
  };
});

vi.mock('../../lib/esign-api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../lib/esign-api')>();
  return {
    ...actual,
    sendWorkOrderForSignature: (jobId: string, payload: unknown) =>
      mockFns.sendWorkOrderForSignature(jobId, payload),
    resendWorkOrderSignature: (jobId: string, message?: unknown) =>
      mockFns.resendWorkOrderSignature(jobId, message),
  };
});

function minimalJob(): Job {
  return {
    id: 'job-1',
    user_id: 'u1',
    client_id: null,
    customer_name: 'Customer A',
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
    esign_status: 'not_sent',
  };
}

function jobWithEsign(status: Job['esign_status']): Job {
  const job = minimalJob();
  if (status === 'sent') {
    return { ...job, esign_status: status, esign_sent_at: '2025-01-01T08:00:00Z' };
  }
  if (status === 'opened') {
    return {
      ...job,
      esign_status: status,
      esign_sent_at: '2025-01-01T08:00:00Z',
      esign_opened_at: '2025-01-01T09:00:00Z',
    };
  }
  if (status === 'completed') {
    return {
      ...job,
      esign_status: status,
      esign_sent_at: '2025-01-01T08:00:00Z',
      esign_opened_at: '2025-01-01T09:00:00Z',
      esign_completed_at: '2025-01-01T10:00:00Z',
      esign_signed_document_url: 'https://example.com/signed.pdf',
    };
  }
  if (status === 'declined') {
    return {
      ...job,
      esign_status: status,
      esign_sent_at: '2025-01-01T08:00:00Z',
      esign_opened_at: '2025-01-01T09:00:00Z',
      esign_declined_at: '2025-01-01T10:00:00Z',
      esign_decline_reason: 'Needs revisions',
    };
  }
  if (status === 'expired') {
    return { ...job, esign_status: status, esign_sent_at: '2025-01-01T08:00:00Z' };
  }
  return job;
}

async function flushAsync() {
  await act(async () => {
    await Promise.resolve();
  });
}

describe('WorkOrderDetailPage', () => {
  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  beforeEach(() => {
    mockFns.listInvoiceStatusByChangeOrder.mockReset();
    mockFns.listChangeOrders.mockReset();
    mockFns.getJobById.mockReset();
    mockFns.sendWorkOrderForSignature.mockReset();
    mockFns.resendWorkOrderSignature.mockReset();
    mockFns.listInvoiceStatusByChangeOrder.mockResolvedValue({ data: [], error: null, warning: null });
    mockFns.listChangeOrders.mockResolvedValue([makeCO(1, 'First'), makeCO(2, 'Second')]);
    mockFns.getJobById.mockResolvedValue(minimalJob());
    mockFns.sendWorkOrderForSignature.mockResolvedValue({
      jobId: 'job-1',
      esign_submission_id: 'sub-1',
      esign_submitter_id: 'submitter-1',
      esign_embed_src: 'https://example.com/sign',
      esign_status: 'sent',
      esign_submission_state: 'sent',
      esign_submitter_state: 'sent',
      esign_sent_at: '2025-01-01T08:00:00Z',
      esign_opened_at: null,
      esign_completed_at: null,
      esign_declined_at: null,
      esign_decline_reason: null,
      esign_signed_document_url: null,
    });
    mockFns.resendWorkOrderSignature.mockResolvedValue({
      jobId: 'job-1',
      esign_submission_id: 'sub-1',
      esign_submitter_id: 'submitter-1',
      esign_embed_src: 'https://example.com/sign',
      esign_status: 'sent',
      esign_submission_state: 'sent',
      esign_submitter_state: 'sent',
      esign_sent_at: '2025-01-01T08:00:00Z',
      esign_opened_at: null,
      esign_completed_at: null,
      esign_declined_at: null,
      esign_decline_reason: null,
      esign_signed_document_url: null,
    });
    mockFns.setCoBlockResult({ blocks: false, error: null });
  });

  it('shows one invoice control per change-order row and no job-level invoice strip', async () => {
    render(
      <WorkOrderDetailPage
        userId="u1"
        jobId="job-1"
        job={minimalJob()}
        profile={minimalProfile()}
        onBack={() => {}}
        onStartChangeOrder={() => {}}
        onStartChangeOrderInvoice={() => {}}
        onOpenCODetail={() => {}}
      />
    );

    await screen.findByText('CO #0001');
    await waitFor(() => {
      expect(screen.getAllByRole('button', { name: /^Invoice$/i })).toHaveLength(2);
    });

    expect(screen.queryByText(/^Invoice #/i)).toBeNull();

    const coList = document.querySelector('ul.work-orders-list');
    expect(coList).toBeTruthy();
    await waitFor(() => {
      expect(within(coList as HTMLElement).getAllByRole('listitem')).toHaveLength(2);
    });
    expect(within(coList as HTMLElement).getAllByRole('button', { name: /^Invoice$/i })).toHaveLength(2);
  });

  it.each([
    ['not_sent', ['Sent', 'Opened', 'Signed'], 'Ready to send for signature.'],
    ['sent', ['Sent', 'Opened', 'Signed'], 'Signature request sent to customer.'],
    ['opened', ['Sent', 'Opened', 'Signed'], 'Customer has opened the signing link.'],
    ['completed', ['Sent', 'Opened', 'Signed'], 'Work order has been signed.'],
    ['declined', ['Sent', 'Opened', 'Declined'], 'Customer declined the work order.'],
    ['expired', ['Sent', 'Opened', 'Expired'], 'Signature request expired before completion.'],
  ] as const)(
    'renders e-sign timeline for %s status',
    async (status, labels, summary) => {
      render(
        <WorkOrderDetailPage
          userId="u1"
          jobId="job-1"
          job={jobWithEsign(status)}
          profile={minimalProfile()}
          onBack={() => {}}
          onStartChangeOrder={() => {}}
          onStartChangeOrderInvoice={() => {}}
          onOpenCODetail={() => {}}
        />
      );

      const timeline = screen.getByRole('group', {
        name: new RegExp(`Customer signature status`, 'i'),
      });

      labels.forEach((label) => {
        expect(within(timeline).getByText(label)).toBeInTheDocument();
      });
      expect(screen.getByText(summary)).toBeInTheDocument();
    }
  );

  it('polls the job row after send and updates the timeline from webhook-backed data', async () => {
    vi.useFakeTimers();
    const sentJob = {
      ...jobWithEsign('sent'),
      customer_email: 'customer@example.com',
      esign_submitter_id: 'submitter-1',
      esign_embed_src: 'https://example.com/sign',
    };
    const openedJob = {
      ...jobWithEsign('opened'),
      customer_email: 'customer@example.com',
      esign_submitter_id: 'submitter-1',
      esign_embed_src: 'https://example.com/sign',
    };
    mockFns.getJobById.mockResolvedValueOnce(sentJob).mockResolvedValueOnce(openedJob);

    function Harness() {
      const [job, setJob] = useState<Job>({ ...minimalJob(), customer_email: 'customer@example.com' });
      return (
        <WorkOrderDetailPage
          userId="u1"
          jobId={job.id}
          job={job}
          profile={minimalProfile()}
          onJobUpdated={setJob}
          onBack={() => {}}
          onStartChangeOrder={() => {}}
          onStartChangeOrderInvoice={() => {}}
          onOpenCODetail={() => {}}
        />
      );
    }

    render(<Harness />);
    await flushAsync();

    await act(async () => {
      screen.getByRole('button', { name: /send for signature/i }).click();
    });
    await flushAsync();

    expect(screen.getByLabelText('Customer signature status: Sent')).toBeInTheDocument();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(ESIGN_POLL_INTERVAL_MS);
    });
    await flushAsync();

    expect(screen.getByLabelText('Customer signature status: Opened')).toBeInTheDocument();
  });

  it('renders filled active bubbles and timestamp rows without seconds', async () => {
    render(
      <WorkOrderDetailPage
        userId="u1"
        jobId="job-1"
        job={jobWithEsign('sent')}
        profile={minimalProfile()}
        onBack={() => {}}
        onStartChangeOrder={() => {}}
        onStartChangeOrderInvoice={() => {}}
        onOpenCODetail={() => {}}
      />
    );

    const timeline = screen.getByRole('group', { name: /customer signature status: sent/i });
    const sentStep = within(timeline).getByText('Sent').closest('.wo-esign-step');
    expect(sentStep).toBeTruthy();
    expect(sentStep?.querySelector('.wo-esign-step-dot-filled')).toBeTruthy();

    const sentMeta = screen.getByTestId('wo-esign-meta-sent');
    expect(sentMeta.textContent).toContain('Sent');
    expect(sentMeta.textContent).not.toMatch(/:\d{2}:\d{2}/);
  });

  it('disables Create Change Order when a downloaded job-level invoice blocks', async () => {
    mockFns.setCoBlockResult({ blocks: true, error: null });
    render(
      <WorkOrderDetailPage
        userId="u1"
        jobId="job-1"
        job={minimalJob()}
        profile={minimalProfile()}
        onBack={() => {}}
        onStartChangeOrder={() => {}}
        onStartChangeOrderInvoice={() => {}}
        onOpenCODetail={() => {}}
      />
    );

    await waitFor(() => {
      expect(mockFns.getBlocksNewChangeOrdersForJob).toHaveBeenCalledWith('u1', 'job-1');
      const btns = screen.getAllByTestId('wo-detail-create-change-order');
      expect(btns.length).toBeGreaterThan(0);
      expect(btns.at(-1) as HTMLButtonElement).toBeDisabled();
    });
    expect(
      await screen.findByText(/Work order invoice has been finalized\. New change orders cannot be added\./i)
    ).toBeInTheDocument();
  });

  it('disables Create Change Order and shows error when block query fails (fail-closed)', async () => {
    mockFns.setCoBlockResult({
      blocks: true,
      error: new Error('network'),
    });
    render(
      <WorkOrderDetailPage
        userId="u1"
        jobId="job-1"
        job={minimalJob()}
        profile={minimalProfile()}
        onBack={() => {}}
        onStartChangeOrder={() => {}}
        onStartChangeOrderInvoice={() => {}}
        onOpenCODetail={() => {}}
      />
    );

    await waitFor(() => {
      const btns = screen.getAllByTestId('wo-detail-create-change-order');
      expect(btns.length).toBeGreaterThan(0);
      expect(btns.at(-1) as HTMLButtonElement).toBeDisabled();
    });
    expect(
      screen.getByText(/Could not verify whether new change orders are allowed \(network\)/i)
    ).toBeInTheDocument();
  });
});
