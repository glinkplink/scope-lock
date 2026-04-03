/**
 * @vitest-environment node
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const {
  accountsCreateMock,
  accountsRetrieveMock,
  accountLinksCreateMock,
  paymentLinksCreateMock,
  constructEventMock,
} = vi.hoisted(() => ({
  accountsCreateMock: vi.fn(),
  accountsRetrieveMock: vi.fn(),
  accountLinksCreateMock: vi.fn(),
  paymentLinksCreateMock: vi.fn(),
  constructEventMock: vi.fn(),
}));

vi.mock('stripe', () => ({
  default: class StripeMock {
    constructor() {
      return {
        accounts: {
          create: accountsCreateMock,
          retrieve: accountsRetrieveMock,
        },
        accountLinks: {
          create: accountLinksCreateMock,
        },
        paymentLinks: {
          create: paymentLinksCreateMock,
        },
        webhooks: {
          constructEvent: constructEventMock,
        },
      };
    }
  },
}));

// @ts-expect-error Test imports a server-only JS module through the Vitest alias.
import { createConnectedAccount, resetStripeSingleton } from '@scope-server/lib/stripe.mjs';

type ProcEnv = Record<string, string | undefined>;
function nodeEnv(): ProcEnv {
  return (globalThis as unknown as { process: { env: ProcEnv } }).process.env;
}

describe('createConnectedAccount', () => {
  const prevStripeSecretKey = nodeEnv().STRIPE_SECRET_KEY;

  beforeEach(() => {
    nodeEnv().STRIPE_SECRET_KEY = 'sk_test_123';
    resetStripeSingleton();
    accountsCreateMock.mockReset();
    accountsRetrieveMock.mockReset();
    accountLinksCreateMock.mockReset();
    paymentLinksCreateMock.mockReset();
    constructEventMock.mockReset();
  });

  afterEach(() => {
    nodeEnv().STRIPE_SECRET_KEY = prevStripeSecretKey;
    resetStripeSingleton();
  });

  it('creates an Express account with the approved business-facing prefill fields', async () => {
    accountsCreateMock.mockResolvedValue({ id: 'acct_123' });

    const result = await createConnectedAccount({
      email: 'owner@example.com',
      business_name: 'Forge & Weld',
      google_business_profile_url: 'https://maps.example.com/forge',
    });

    expect(result).toEqual({
      data: { id: 'acct_123' },
      error: null,
    });
    expect(accountsCreateMock).toHaveBeenCalledWith({
      type: 'express',
      email: 'owner@example.com',
      capabilities: {
        card_payments: { requested: true },
        transfers: { requested: true },
      },
      business_profile: {
        mcc: '1799',
        name: 'Forge & Weld',
        url: 'https://maps.example.com/forge',
      },
    });
  });

  it('omits invalid URLs and forbidden identity fields from the account payload', async () => {
    accountsCreateMock.mockResolvedValue({ id: 'acct_456' });

    await createConnectedAccount({
      email: '   ',
      business_name: '',
      google_business_profile_url: 'http://example.com/profile',
      owner_name: 'Owner Name',
      address: '123 Main St',
      phone: '(555) 555-5555',
      country: 'US',
      individual: { first_name: 'Owner' },
      company: { address: { line1: '123 Main St' } },
      external_account: 'ba_123',
    });

    const payload = accountsCreateMock.mock.calls[0][0];
    expect(payload).toEqual({
      type: 'express',
      capabilities: {
        card_payments: { requested: true },
        transfers: { requested: true },
      },
      business_profile: {
        mcc: '1799',
      },
    });
    expect(payload).not.toHaveProperty('country');
    expect(payload).not.toHaveProperty('individual');
    expect(payload).not.toHaveProperty('company');
    expect(payload).not.toHaveProperty('external_account');
  });
});
