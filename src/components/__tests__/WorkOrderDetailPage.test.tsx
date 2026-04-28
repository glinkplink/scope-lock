// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { cleanup, render, screen, waitFor, within, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import type { Job, BusinessProfile, ChangeOrder } from '../../types/db';
import { WorkOrderDetailPage } from '../WorkOrderDetailPage';

vi.mock('../../hooks/useScaledPreview', () => ({
  useScaledPreview: () => ({
    viewportRef: { current: null },
    sheetRef: { current: null },
    scale: 1,
    spacerHeight: 400,
    spacerWidth: 816,
    letterWidthPx: 816,
  }),
}));

const mockFns = vi.hoisted(() => {
  const listChangeOrders = vi.fn();
  const listInvoiceStatusByChangeOrder = vi.fn();
  const getJobById = vi.fn();
  const updateJob = vi.fn();
  const sendWorkOrderForSignature = vi.fn();
  const resendWorkOrderSignature = vi.fn();
  const pollWorkOrderEsignStatus = vi.fn();
  const coBlockState = { blocks: false, error: null as Error | null };
  const getBlocksNewChangeOrdersForJob: ReturnType<typeof vi.fn<(userId: string, jobId: string) => Promise<{ blocks: boolean; error: Error | null }>>> = vi.fn(async () => ({
    blocks: coBlockState.blocks,
    error: coBlockState.error,
  }));
  return {
    listChangeOrders,
    listInvoiceStatusByChangeOrder,
    getJobById,
    updateJob,
    sendWorkOrderForSignature,
    resendWorkOrderSignature,
    pollWorkOrderEsignStatus,
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
    updateJob: (id: string, patch: Partial<Job>) => mockFns.updateJob(id, patch),
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
    pollWorkOrderEsignStatus: (jobId: string) => mockFns.pollWorkOrderEsignStatus(jobId),
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
    esign_resent_at: null,
    offline_signed_at: null,
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
    stripe_account_id: null,
    stripe_onboarding_complete: false,
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
    offline_signed_at: null,
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

function renderDetail(job: Job = minimalJob()) {
  return render(
    <WorkOrderDetailPage
      userId="u1"
      jobId={job.id}
      job={job}
      profile={minimalProfile()}
      onBack={() => {}}
      onStartChangeOrder={() => {}}
      onStartChangeOrderInvoice={() => {}}
      onOpenCODetail={() => {}}
    />
  );
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
    mockFns.updateJob.mockReset();
    mockFns.sendWorkOrderForSignature.mockReset();
    mockFns.resendWorkOrderSignature.mockReset();
    mockFns.pollWorkOrderEsignStatus.mockReset();
    mockFns.listInvoiceStatusByChangeOrder.mockResolvedValue({ data: [], error: null, warning: null });
    mockFns.listChangeOrders.mockResolvedValue([makeCO(1, 'First'), makeCO(2, 'Second')]);
    mockFns.getJobById.mockResolvedValue(minimalJob());
    mockFns.updateJob.mockResolvedValue({ data: minimalJob(), error: null });
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
    const defaultPoll = {
      jobId: 'job-1',
      esign_submission_id: null,
      esign_submitter_id: null,
      esign_embed_src: null,
      esign_status: 'not_sent' as const,
      esign_submission_state: null,
      esign_submitter_state: null,
      esign_sent_at: null,
      esign_resent_at: null,
      esign_opened_at: null,
      esign_completed_at: null,
      esign_declined_at: null,
      esign_decline_reason: null,
      esign_signed_document_url: null,
    };
    mockFns.pollWorkOrderEsignStatus.mockResolvedValue(defaultPoll);
    mockFns.setCoBlockResult({ blocks: false, error: null });
  });

  it('renders work-order detail status chips for downloaded and signature states', async () => {
    mockFns.pollWorkOrderEsignStatus.mockRejectedValue(new Error('status refresh skipped'));
    renderDetail(minimalJob());
    await screen.findByRole('heading', { name: /^Preview$/i });
    expect(screen.queryByText('Downloaded')).not.toBeInTheDocument();
    cleanup();

    const cases = [
      {
        job: { ...minimalJob(), last_downloaded_at: '2025-01-01T12:00:00Z' },
        label: 'Downloaded',
        className: 'iw-status-chip--draft',
      },
      { job: jobWithEsign('sent'), label: 'Sent', className: 'iw-status-chip--draft' },
      { job: jobWithEsign('opened'), label: 'Opened', className: 'iw-status-chip--draft' },
      { job: jobWithEsign('completed'), label: 'E-signed', className: 'iw-status-chip--paid' },
      {
        job: { ...minimalJob(), offline_signed_at: '2025-01-01T12:00:00Z' },
        label: 'Signed offline',
        className: 'iw-status-chip--offline',
      },
    ];

    for (const testCase of cases) {
      mockFns.getJobById.mockResolvedValue(testCase.job);
      renderDetail(testCase.job);
      const preview = await screen.findByRole('region', { name: /^Preview$/i });
      expect(within(preview).getByText(testCase.label)).toHaveClass(
        'iw-status-chip',
        testCase.className
      );
      cleanup();
    }
  });

  it('shows change-order rows without standalone invoice controls', async () => {
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
    expect(screen.queryByRole('button', { name: /^Invoice$/i })).toBeNull();

    // WO detail page no longer surfaces invoice status — that lives on the Invoices page.
    expect(screen.queryByText(/^Invoice #/i)).toBeNull();

    const coList = document.querySelector('ul.work-orders-list');
    expect(coList).toBeTruthy();
    await waitFor(() => {
      expect(within(coList as HTMLElement).getAllByRole('listitem')).toHaveLength(2);
    });
    expect(within(coList as HTMLElement).queryByRole('button', { name: /^Invoice$/i })).toBeNull();
  });

  it('opens full document preview lightbox from mini preview', async () => {
    const user = userEvent.setup();
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
    await user.click(screen.getByRole('button', { name: /open full work order preview/i }));
    expect(screen.getByRole('dialog', { name: /work order preview/i })).toBeInTheDocument();
  });

it('renders change-order rows with date, amount, description, and shared e-sign strip order', async () => {
    mockFns.listChangeOrders.mockResolvedValue([
      {
        ...makeCO(1, 'Opened change order'),
        created_at: '2025-01-01T12:00:00Z',
        esign_status: 'opened',
      },
      {
        ...makeCO(2, 'Draft change order'),
        created_at: '2025-01-02T12:00:00Z',
        esign_status: 'not_sent',
      },
    ]);

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

    const openedRowText = await screen.findByText('Opened change order');
    const openedRow = openedRowText.closest('li');
    expect(openedRow).toBeTruthy();
    const openedRowEl = openedRow as HTMLElement;

    const heading = within(openedRowEl).getByText('CO #0001');
    const description = within(openedRowEl).getByText('Opened change order');
    const amount = within(openedRowEl).getByText('$0.00');
    const strip = within(openedRowEl).getByLabelText('E-signature status: Opened');

    expect(heading).toBeInTheDocument();
    expect(within(openedRowEl).getByText(/Jan 1, 2025/i)).toBeInTheDocument();
    expect(
      heading.compareDocumentPosition(description) & Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy();
    expect(
      description.compareDocumentPosition(amount) & Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy();
    expect(
      amount.compareDocumentPosition(strip) & Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy();

    const draftRowText = screen.getByText('Draft change order');
    const draftRow = draftRowText.closest('li');
    expect(draftRow).toBeTruthy();
    expect(within(draftRow as HTMLElement).queryByLabelText(/E-signature status:/i)).toBeNull();
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

  it('refreshes e-sign timeline after send when the status endpoint returns opened', async () => {
    const base = { ...minimalJob(), customer_email: 'customer@example.com' };
    mockFns.getJobById.mockResolvedValue(base);
    const notSentPoll = {
      jobId: 'job-1',
      esign_submission_id: null,
      esign_submitter_id: null,
      esign_embed_src: null,
      esign_status: 'not_sent' as const,
      esign_submission_state: null,
      esign_submitter_state: null,
      esign_sent_at: null,
      esign_resent_at: null,
      esign_opened_at: null,
      esign_completed_at: null,
      esign_declined_at: null,
      esign_decline_reason: null,
      esign_signed_document_url: null,
    };
    const openedPoll = {
      jobId: 'job-1',
      esign_submission_id: 'sub-1',
      esign_submitter_id: 'submitter-1',
      esign_embed_src: 'https://example.com/sign',
      esign_status: 'opened' as const,
      esign_submission_state: 'opened',
      esign_submitter_state: 'opened',
      esign_sent_at: '2025-01-01T08:00:00Z',
      esign_resent_at: null,
      esign_opened_at: '2025-01-01T09:00:00Z',
      esign_completed_at: null,
      esign_declined_at: null,
      esign_decline_reason: null,
      esign_signed_document_url: null,
    };
    mockFns.pollWorkOrderEsignStatus.mockResolvedValueOnce(notSentPoll).mockResolvedValueOnce(openedPoll);

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

    await waitFor(() => {
      expect(screen.getByLabelText('Customer signature status: Opened')).toBeInTheDocument();
    });
    expect(mockFns.pollWorkOrderEsignStatus).toHaveBeenCalledTimes(2);
  });

  it('runs enter status sync once when onJobUpdated is an unstable inline callback (App.tsx pattern)', async () => {
    const base = { ...minimalJob(), customer_email: 'customer@example.com' };
    mockFns.getJobById.mockResolvedValue(base);
    mockFns.pollWorkOrderEsignStatus.mockClear();
    mockFns.pollWorkOrderEsignStatus.mockResolvedValue({
      jobId: 'job-1',
      esign_submission_id: null,
      esign_submitter_id: null,
      esign_embed_src: null,
      esign_status: 'not_sent',
      esign_submission_state: null,
      esign_submitter_state: null,
      esign_sent_at: null,
      esign_resent_at: null,
      esign_opened_at: null,
      esign_completed_at: null,
      esign_declined_at: null,
      esign_decline_reason: null,
      esign_signed_document_url: null,
    });

    function UnstableParent() {
      const [job, setJob] = useState<Job>(base);
      return (
        <WorkOrderDetailPage
          userId="u1"
          jobId={job.id}
          job={job}
          profile={minimalProfile()}
          onJobUpdated={(j) => setJob(j)}
          onBack={() => {}}
          onStartChangeOrder={() => {}}
          onStartChangeOrderInvoice={() => {}}
          onOpenCODetail={() => {}}
        />
      );
    }

    render(<UnstableParent />);
    await flushAsync();

    expect(mockFns.pollWorkOrderEsignStatus).toHaveBeenCalledTimes(1);
  });

  it('passes the custom DocuSeal message on work-order resend', async () => {
    render(
      <WorkOrderDetailPage
        userId="u1"
        jobId="job-1"
        job={{
          ...jobWithEsign('sent'),
          customer_email: 'customer@example.com',
          esign_submitter_id: 'submitter-1',
        }}
        profile={minimalProfile()}
        onBack={() => {}}
        onStartChangeOrder={() => {}}
        onStartChangeOrderInvoice={() => {}}
        onOpenCODetail={() => {}}
      />
    );

    await act(async () => {
      screen.getByRole('button', { name: /resend work order/i }).click();
    });

    await waitFor(() => {
      expect(mockFns.resendWorkOrderSignature).toHaveBeenCalledWith(
        'job-1',
        expect.objectContaining({
          subject: expect.stringContaining('Work Order to sign'),
          body: expect.stringContaining('{{submitter.link}}'),
        })
      );
    });
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

  it('updates the signature timeline immediately after marking signed offline', async () => {
    const user = userEvent.setup();
    const offlineSignedAt = '2025-01-02T12:00:00Z';
    mockFns.updateJob.mockResolvedValueOnce({
      data: { ...minimalJob(), offline_signed_at: offlineSignedAt },
      error: null,
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

    await user.click(screen.getByRole('button', { name: /mark signed offline/i }));

    await waitFor(() => {
      expect(mockFns.updateJob).toHaveBeenCalledWith(
        'job-1',
        expect.objectContaining({ offline_signed_at: expect.any(String) })
      );
      expect(screen.getByRole('group', { name: /customer signature status: signed/i })).toBeInTheDocument();
      expect(screen.getByText('Signature recorded manually (not verified through DocuSeal).')).toBeInTheDocument();
    });

    const timeline = screen.getByRole('group', { name: /customer signature status: signed/i });
    const signedStep = within(timeline).getByText('Signed').closest('.wo-esign-step');
    expect(signedStep?.querySelector('.wo-esign-step-dot-filled')).toBeTruthy();
    expect(screen.getByTestId('wo-esign-meta-offline-signed')).toHaveTextContent('Signed offline');
  });

  it('scrolls to the change-order section when opened from the overflow link', async () => {
    const scrollIntoView = vi.fn();
    Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', {
      configurable: true,
      value: scrollIntoView,
    });

    render(
      <WorkOrderDetailPage
        userId="u1"
        jobId="job-1"
        job={minimalJob()}
        profile={minimalProfile()}
        initialScrollTarget="change-orders"
        onBack={() => {}}
        onStartChangeOrder={() => {}}
        onStartChangeOrderInvoice={() => {}}
        onOpenCODetail={() => {}}
      />
    );

    await screen.findByText('CO #0001');

    await waitFor(() => {
      expect(scrollIntoView).toHaveBeenCalled();
    });
  });

  it('hides copy signing link once the work order is signed', () => {
    render(
      <WorkOrderDetailPage
        userId="u1"
        jobId="job-1"
        job={{
          ...jobWithEsign('completed'),
          esign_submitter_id: 'submitter-1',
          esign_embed_src: 'https://example.com/sign',
        }}
        profile={minimalProfile()}
        onBack={() => {}}
        onStartChangeOrder={() => {}}
        onStartChangeOrderInvoice={() => {}}
        onOpenCODetail={() => {}}
      />
    );

    expect(screen.queryByRole('button', { name: /copy signing link/i })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /download signed pdf/i })).toBeInTheDocument();
  });

  it('disables Create Change Order when an issued job-level invoice blocks', async () => {
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
