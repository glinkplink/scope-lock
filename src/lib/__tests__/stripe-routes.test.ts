/**
 * @vitest-environment node
 */
/// <reference types="node" />
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const createClientMock = vi.fn();
const createConnectedAccountMock = vi.fn();
const createAccountOnboardingLinkMock = vi.fn();
const createInvoicePaymentLinkMock = vi.fn();
const constructWebhookEventMock = vi.fn();
const getConnectedAccountMock = vi.fn();
const createOrReuseInvoicePaymentLinkMock = vi.fn();

async function assertStripeInvoicePaymentsReadyForTest(accountId: string) {
  const { data: connectedAccount, error: capErr } = await getConnectedAccountMock(accountId);
  if (capErr || !connectedAccount) {
    return { ok: false, status: 502, error: 'Could not verify Stripe account capabilities.' };
  }
  const cardStatus =
    'card_payments_status' in connectedAccount && connectedAccount.card_payments_status != null
      ? connectedAccount.card_payments_status
      : 'inactive';
  if (cardStatus !== 'active') {
    return {
      ok: false,
      status: 409,
      error:
        cardStatus === 'pending'
          ? 'Your Stripe account is still being verified. Complete onboarding and wait for Stripe approval before sending invoices.'
          : 'Your Stripe account is not approved to accept payments yet. Complete Stripe onboarding to enable card payments.',
    };
  }
  return { ok: true as const };
}

vi.mock('@supabase/supabase-js', () => ({
  createClient: (...args: unknown[]) => createClientMock(...args),
}));

vi.mock('@scope-server/lib/stripe.mjs', () => ({
  assertStripeInvoicePaymentsReady: (...args: unknown[]) =>
    assertStripeInvoicePaymentsReadyForTest(args[0] as string),
  createConnectedAccount: (...args: unknown[]) => createConnectedAccountMock(...args),
  createAccountOnboardingLink: (...args: unknown[]) => createAccountOnboardingLinkMock(...args),
  createInvoicePaymentLink: (...args: unknown[]) => createInvoicePaymentLinkMock(...args),
  constructWebhookEvent: (...args: unknown[]) => constructWebhookEventMock(...args),
  createOrReuseInvoicePaymentLink: (...args: unknown[]) =>
    createOrReuseInvoicePaymentLinkMock(...args),
  getConnectedAccount: (...args: unknown[]) => getConnectedAccountMock(...args),
}));

import {
  resetStripeServiceSupabaseSingleton,
  tryHandleStripeRoute,
} from '@scope-server/stripe-routes.mjs';

type ProcEnv = Record<string, string | undefined>;
function nodeEnv(): ProcEnv {
  return (globalThis as unknown as { process: { env: ProcEnv } }).process.env;
}

const USER_UUID = '660e8400-e29b-41d4-a716-446655440001';

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

function defaultHelpers() {
  return {
    readJsonBody: async () => ({}),
    readRawBody: async () => '',
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

function profileFixture(overrides: Record<string, unknown> = {}) {
  return {
    id: 'profile-1',
    user_id: USER_UUID,
    business_name: 'Test Co',
    email: 'owner@example.com',
    google_business_profile_url: 'https://example.com/profile',
    stripe_account_id: null,
    stripe_onboarding_complete: false,
    ...overrides,
  };
}

function mockStripeSupabase(options: {
  profile?: Record<string, unknown> | null;
  authUserId?: string | null;
  profileError?: { message: string } | null;
  updatedProfile?: Record<string, unknown> | null;
  updateError?: { message: string } | null;
}) {
  const profile = options.profile ?? null;
  const selectEqMock = vi.fn(() => ({
    maybeSingle: vi.fn(async () => ({
      data: profile,
      error: options.profileError ?? null,
    })),
  }));

  const updateSelectMaybeSingleMock = vi.fn(async () => ({
    data:
      options.updatedProfile ??
      (profile
        ? {
            ...profile,
            stripe_onboarding_complete: true,
          }
        : null),
    error: options.updateError ?? null,
  }));

  const updateEqMock = vi.fn(() => ({
    eq: vi.fn(() => ({
      select: vi.fn(() => ({
        maybeSingle: updateSelectMaybeSingleMock,
      })),
    })),
    select: vi.fn(() => ({
      maybeSingle: updateSelectMaybeSingleMock,
    })),
  }));

  const supabase = {
    auth: {
      getUser: vi.fn(async () => ({
        data: options.authUserId === null ? { user: null } : { user: { id: options.authUserId ?? USER_UUID } },
        error: options.authUserId === null ? { message: 'Invalid session' } : null,
      })),
    },
    from: vi.fn((table: string) => {
      if (table !== 'business_profiles') {
        return {
          select: vi.fn(() => ({
            eq: vi.fn(() => ({
              maybeSingle: vi.fn(async () => ({ data: null, error: null })),
            })),
          })),
          update: vi.fn(() => ({
            eq: vi.fn(() => ({
              eq: vi.fn(() => ({})),
            })),
          })),
        };
      }

      return {
        select: vi.fn(() => ({
          eq: selectEqMock,
        })),
        update: vi.fn(() => ({
          eq: updateEqMock,
        })),
      };
    }),
  };

  createClientMock.mockReturnValue(supabase);
  return { supabase, selectEqMock, updateEqMock, updateSelectMaybeSingleMock };
}

describe('tryHandleStripeRoute', () => {
  const prevEnv: Record<string, string | undefined> = {};

  beforeEach(() => {
    for (const key of [
      'SUPABASE_URL',
      'SUPABASE_SERVICE_ROLE_KEY',
      'APP_BASE_URL',
      'STRIPE_SECRET_KEY',
      'STRIPE_WEBHOOK_SECRET',
    ]) {
      prevEnv[key] = nodeEnv()[key];
    }
    nodeEnv().SUPABASE_URL = 'http://localhost:54321';
    nodeEnv().SUPABASE_SERVICE_ROLE_KEY = 'test-service-role';
    nodeEnv().APP_BASE_URL = 'https://app.example.com';
    nodeEnv().STRIPE_SECRET_KEY = 'sk_test_123';
    nodeEnv().STRIPE_WEBHOOK_SECRET = 'whsec_123';
    createClientMock.mockReset();
    createConnectedAccountMock.mockReset();
    createAccountOnboardingLinkMock.mockReset();
    createInvoicePaymentLinkMock.mockReset();
    constructWebhookEventMock.mockReset();
    getConnectedAccountMock.mockReset();
    createOrReuseInvoicePaymentLinkMock.mockReset();
    resetStripeServiceSupabaseSingleton();
  });

  afterEach(() => {
    for (const [key, value] of Object.entries(prevEnv)) {
      nodeEnv()[key] = value;
    }
    resetStripeServiceSupabaseSingleton();
  });

  it('returns 404 from connect status when the profile is missing', async () => {
    mockStripeSupabase({ profile: null });
    const res = captureRes();

    const handled = await tryHandleStripeRoute(
      {
        method: 'GET',
        url: '/api/stripe/connect/status',
        headers: { authorization: 'Bearer token' },
      } as never,
      res as never,
      defaultHelpers() as never
    );

    expect(handled).toBe(true);
    expect(res.status).toBe(404);
    expect(JSON.parse(res.body)).toEqual({ error: 'Business profile not found.' });
  });

  it('returns not_connected when the profile has no Stripe account yet', async () => {
    mockStripeSupabase({ profile: profileFixture() });
    const res = captureRes();

    await tryHandleStripeRoute(
      {
        method: 'GET',
        url: '/api/stripe/connect/status',
        headers: { authorization: 'Bearer token' },
      } as never,
      res as never,
      defaultHelpers() as never
    );

    expect(res.status).toBe(200);
    expect(JSON.parse(res.body)).toEqual({
      accountId: null,
      onboardingComplete: false,
      status: 'not_connected',
      detailsSubmitted: false,
      chargesEnabled: false,
      payoutsEnabled: false,
    });
    expect(getConnectedAccountMock).not.toHaveBeenCalled();
  });

  it('reconciles Stripe onboarding state and persists completion', async () => {
    const existingProfile = profileFixture({
      stripe_account_id: 'acct_123',
      stripe_onboarding_complete: false,
    });
    const updatedProfile = {
      ...existingProfile,
      stripe_onboarding_complete: true,
    };
    const { updateEqMock, updateSelectMaybeSingleMock } = mockStripeSupabase({
      profile: existingProfile,
      updatedProfile,
    });
    getConnectedAccountMock.mockResolvedValue({
      data: {
        id: 'acct_123',
        details_submitted: true,
        charges_enabled: true,
        payouts_enabled: true,
      },
      error: null,
    });
    const res = captureRes();

    await tryHandleStripeRoute(
      {
        method: 'GET',
        url: '/api/stripe/connect/status',
        headers: { authorization: 'Bearer token' },
      } as never,
      res as never,
      defaultHelpers() as never
    );

    expect(getConnectedAccountMock).toHaveBeenCalledWith('acct_123');
    expect(updateEqMock).toHaveBeenCalledWith('user_id', USER_UUID);
    expect(updateSelectMaybeSingleMock).toHaveBeenCalled();
    expect(JSON.parse(res.body)).toEqual({
      accountId: 'acct_123',
      onboardingComplete: true,
      status: 'connected',
      detailsSubmitted: true,
      chargesEnabled: true,
      payoutsEnabled: true,
    });
  });

  it('surfaces config errors from Stripe status reconciliation as 503', async () => {
    mockStripeSupabase({
      profile: profileFixture({ stripe_account_id: 'acct_123' }),
    });
    getConnectedAccountMock.mockResolvedValue({
      data: null,
      error: 'Stripe not configured',
    });
    const res = captureRes();

    await tryHandleStripeRoute(
      {
        method: 'GET',
        url: '/api/stripe/connect/status',
        headers: { authorization: 'Bearer token' },
      } as never,
      res as never,
      defaultHelpers() as never
    );

    expect(res.status).toBe(503);
    expect(JSON.parse(res.body)).toEqual({ error: 'Stripe not configured' });
  });

  it('reuses an existing Stripe account when connect onboarding starts', async () => {
    mockStripeSupabase({
      profile: profileFixture({
        stripe_account_id: 'acct_existing',
        stripe_onboarding_complete: false,
      }),
    });
    createAccountOnboardingLinkMock.mockResolvedValue({
      data: { url: 'https://connect.stripe.test/onboarding' },
      error: null,
    });
    getConnectedAccountMock.mockResolvedValue({
      data: {
        id: 'acct_existing',
        details_submitted: false,
        charges_enabled: false,
        payouts_enabled: false,
      },
      error: null,
    });
    const res = captureRes();

    await tryHandleStripeRoute(
      {
        method: 'POST',
        url: '/api/stripe/connect/start',
        headers: {
          authorization: 'Bearer token',
          host: '127.0.0.1:3000',
        },
      } as never,
      res as never,
      defaultHelpers() as never
    );

    expect(createConnectedAccountMock).not.toHaveBeenCalled();
    expect(getConnectedAccountMock).toHaveBeenCalledWith('acct_existing');
    expect(createAccountOnboardingLinkMock).toHaveBeenCalledWith(
      'acct_existing',
      'https://app.example.com/?stripe_connect=return',
      'https://app.example.com/?stripe_connect=refresh'
    );
    expect(JSON.parse(res.body)).toEqual({
      accountId: 'acct_existing',
      url: 'https://connect.stripe.test/onboarding',
    });
  });

  it('creates a first-time Stripe account with the approved profile prefill fields', async () => {
    mockStripeSupabase({
      profile: profileFixture({
        business_name: 'Forge & Weld',
        email: 'forge@example.com',
        google_business_profile_url: 'https://maps.example.com/forge',
      }),
    });
    createConnectedAccountMock.mockResolvedValue({
      data: { id: 'acct_new' },
      error: null,
    });
    createAccountOnboardingLinkMock.mockResolvedValue({
      data: { url: 'https://connect.stripe.test/onboarding' },
      error: null,
    });
    const res = captureRes();

    await tryHandleStripeRoute(
      {
        method: 'POST',
        url: '/api/stripe/connect/start',
        headers: {
          authorization: 'Bearer token',
          host: '127.0.0.1:3000',
        },
      } as never,
      res as never,
      defaultHelpers() as never
    );

    expect(createConnectedAccountMock).toHaveBeenCalledWith(
      expect.objectContaining({
        business_name: 'Forge & Weld',
        email: 'forge@example.com',
        google_business_profile_url: 'https://maps.example.com/forge',
      })
    );
    expect(getConnectedAccountMock).not.toHaveBeenCalled();
    expect(createAccountOnboardingLinkMock).toHaveBeenCalledWith(
      'acct_new',
      'https://app.example.com/?stripe_connect=return',
      'https://app.example.com/?stripe_connect=refresh'
    );
    expect(JSON.parse(res.body)).toEqual({
      accountId: 'acct_new',
      url: 'https://connect.stripe.test/onboarding',
    });
  });
});
