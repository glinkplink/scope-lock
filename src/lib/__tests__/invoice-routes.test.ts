/**
 * @vitest-environment node
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const createClientMock = vi.fn();

vi.mock('@supabase/supabase-js', () => ({
  createClient: (...args: unknown[]) => createClientMock(...args),
}));

vi.mock('@scope-server/lib/stripe.mjs', () => ({
  assertStripeInvoicePaymentsReady: vi.fn(),
  createOrReuseInvoicePaymentLink: vi.fn(),
}));

import { countPendingChangeOrders, tryHandleInvoiceRoute } from '@scope-server/invoice-routes.mjs';

const USER_UUID = '660e8400-e29b-41d4-a716-446655440001';
const INVOICE_UUID = '770e8400-e29b-41d4-a716-446655440002';

function captureRes() {
  let status = 0;
  let body = '';
  return {
    get status() {
      return status;
    },
    get body() {
      return body;
    },
    writeHead(code: number) {
      status = code;
    },
    end(chunk: string) {
      body = chunk;
    },
  };
}

function helpers() {
  return {
    readJsonBody: async () => ({}),
    sendJson(res: unknown, code: number, payload: unknown) {
      const r = res as ReturnType<typeof captureRes>;
      r.writeHead(code);
      r.end(JSON.stringify(payload));
    },
    sendText(res: unknown, code: number, message: string) {
      const r = res as ReturnType<typeof captureRes>;
      r.writeHead(code);
      r.end(message);
    },
  };
}

function invoiceRow(paymentStatus: 'unpaid' | 'paid' | 'offline') {
  return {
    id: INVOICE_UUID,
    user_id: USER_UUID,
    payment_status: paymentStatus,
  };
}

function fullUpdatedInvoice() {
  return {
    id: INVOICE_UUID,
    user_id: USER_UUID,
    job_id: 'job-1',
    invoice_number: 1,
    invoice_date: '2025-01-01',
    due_date: '2025-01-15',
    status: 'draft',
    issued_at: '2025-01-02T00:00:00Z',
    line_items: [],
    subtotal: 100,
    tax_rate: 0,
    tax_amount: 0,
    total: 100,
    payment_methods: [],
    notes: null,
    stripe_payment_link_id: null,
    stripe_payment_url: null,
    payment_status: 'unpaid',
    paid_at: null,
    created_at: '2025-01-01T00:00:00Z',
    updated_at: '2025-01-03T00:00:00Z',
  };
}

function mockSupabase(options: {
  authUserId?: string | null;
  invoice?: Record<string, unknown> | null;
  loadError?: { message: string } | null;
  updateError?: { message: string } | null;
}) {
  const updated = fullUpdatedInvoice();
  const maybeSingle = vi.fn(async () => ({
    data: options.invoice ?? null,
    error: options.loadError ?? null,
  }));
  const single = vi.fn(async () => ({
    data: updated,
    error: options.updateError ?? null,
  }));
  const loadEqUser = vi.fn(() => ({ maybeSingle }));
  const loadEqId = vi.fn(() => ({ eq: loadEqUser }));
  const updateEqUser = vi.fn(() => ({ select: vi.fn(() => ({ single })) }));
  const updateEqId = vi.fn(() => ({ eq: updateEqUser }));
  const update = vi.fn(() => ({ eq: updateEqId }));

  const supabase = {
    auth: {
      getUser: vi.fn(async () => ({
        data:
          options.authUserId === null
            ? { user: null }
            : { user: { id: options.authUserId ?? USER_UUID } },
        error: options.authUserId === null ? { message: 'Invalid session' } : null,
      })),
    },
    from: vi.fn(() => ({
      select: vi.fn(() => ({ eq: loadEqId })),
      update,
    })),
  };

  createClientMock.mockReturnValue(supabase);
  return { supabase, update, single };
}

describe('tryHandleInvoiceRoute offline paid undo', () => {
  const prevEnv: Record<string, string | undefined> = {};

  beforeEach(() => {
    prevEnv.SUPABASE_URL = process.env.SUPABASE_URL;
    prevEnv.SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
    createClientMock.mockReset();
    process.env.SUPABASE_URL = 'http://localhost:54321';
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-service-role';
  });

  afterEach(() => {
    process.env.SUPABASE_URL = prevEnv.SUPABASE_URL;
    process.env.SUPABASE_SERVICE_ROLE_KEY = prevEnv.SUPABASE_SERVICE_ROLE_KEY;
  });

  it('returns 401 without authorization', async () => {
    const res = captureRes();

    const handled = await tryHandleInvoiceRoute(
      {
        method: 'POST',
        url: `/api/invoices/${INVOICE_UUID}/unmark-paid-offline`,
        headers: {},
      },
      res,
      helpers()
    );

    expect(handled).toBe(true);
    expect(res.status).toBe(401);
  });

  it('returns 404 when the invoice is not owned by the user', async () => {
    mockSupabase({ invoice: null });
    const res = captureRes();

    await tryHandleInvoiceRoute(
      {
        method: 'POST',
        url: `/api/invoices/${INVOICE_UUID}/unmark-paid-offline`,
        headers: { authorization: 'Bearer token' },
      },
      res,
      helpers()
    );

    expect(res.status).toBe(404);
  });

  it('resets offline-paid invoices to unpaid and clears paid_at', async () => {
    const { update } = mockSupabase({ invoice: invoiceRow('offline') });
    const res = captureRes();

    await tryHandleInvoiceRoute(
      {
        method: 'POST',
        url: `/api/invoices/${INVOICE_UUID}/unmark-paid-offline`,
        headers: { authorization: 'Bearer token' },
      },
      res,
      helpers()
    );

    expect(res.status).toBe(200);
    expect(update).toHaveBeenCalledWith({ payment_status: 'unpaid', paid_at: null });
    expect(JSON.parse(res.body)).toEqual({ invoice: fullUpdatedInvoice() });
  });

  it('returns 409 for Stripe-paid invoices', async () => {
    mockSupabase({ invoice: invoiceRow('paid') });
    const res = captureRes();

    await tryHandleInvoiceRoute(
      {
        method: 'POST',
        url: `/api/invoices/${INVOICE_UUID}/unmark-paid-offline`,
        headers: { authorization: 'Bearer token' },
      },
      res,
      helpers()
    );

    expect(res.status).toBe(409);
    expect(JSON.parse(res.body).error).toMatch(/Stripe-paid/i);
  });

  it('returns 409 for unpaid invoices', async () => {
    mockSupabase({ invoice: invoiceRow('unpaid') });
    const res = captureRes();

    await tryHandleInvoiceRoute(
      {
        method: 'POST',
        url: `/api/invoices/${INVOICE_UUID}/unmark-paid-offline`,
        headers: { authorization: 'Bearer token' },
      },
      res,
      helpers()
    );

    expect(res.status).toBe(409);
    expect(JSON.parse(res.body).error).toMatch(/Only offline-paid/i);
  });
});

describe('countPendingChangeOrders', () => {
  type COStub = { esign_status: string | null; offline_signed_at: string | null };

  function stubSupabase(rows: COStub[] | null, error: { message: string } | null = null) {
    const eqUser = vi.fn(async () => ({ data: rows, error }));
    const eqJob = vi.fn(() => ({ eq: eqUser }));
    const select = vi.fn(() => ({ eq: eqJob }));
    const from = vi.fn(() => ({ select }));
    return { from } as unknown as Parameters<typeof countPendingChangeOrders>[0];
  }

  it('returns 0 when the job has no change orders', async () => {
    const supabase = stubSupabase([]);
    expect(await countPendingChangeOrders(supabase, 'job-1', USER_UUID)).toBe(0);
  });

  it('counts COs that are not signed and not marked signed offline', async () => {
    const supabase = stubSupabase([
      { esign_status: 'completed', offline_signed_at: null },
      { esign_status: 'not_sent', offline_signed_at: null },
      { esign_status: 'sent', offline_signed_at: null },
      { esign_status: null, offline_signed_at: '2025-01-01T00:00:00Z' },
      { esign_status: 'declined', offline_signed_at: null },
    ]);
    expect(await countPendingChangeOrders(supabase, 'job-1', USER_UUID)).toBe(3);
  });

  it('treats a null data response as zero pending', async () => {
    const supabase = stubSupabase(null);
    expect(await countPendingChangeOrders(supabase, 'job-1', USER_UUID)).toBe(0);
  });

  it('propagates query errors so callers can return 500', async () => {
    const supabase = stubSupabase(null, { message: 'boom' });
    await expect(countPendingChangeOrders(supabase, 'job-1', USER_UUID)).rejects.toMatchObject({
      message: 'boom',
    });
  });
});
