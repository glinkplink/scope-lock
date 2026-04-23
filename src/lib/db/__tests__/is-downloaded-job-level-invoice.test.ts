import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockState = vi.hoisted(() => ({
  rows: [] as unknown[],
  error: null as { message: string } | null,
}));

vi.mock('../../supabase', () => ({
  supabase: {
    from: () => ({
      select: () => ({
        eq: () => ({
          eq: () =>
            Promise.resolve({
              get data() {
                return mockState.rows;
              },
              get error() {
                return mockState.error;
              },
            }),
        }),
      }),
    }),
  },
}));

import {
  getBlocksNewChangeOrdersForJob,
  isIssuedJobLevelInvoiceRow,
  isJobLevelInvoiceLineItems,
} from '../invoices';

describe('isJobLevelInvoiceLineItems', () => {
  it('keeps empty, original-scope, and mixed invoices at job level', () => {
    expect(isJobLevelInvoiceLineItems([])).toBe(true);
    expect(isJobLevelInvoiceLineItems([{ description: 'Original scope' }])).toBe(true);
    expect(
      isJobLevelInvoiceLineItems([
        { description: 'Original scope', source: 'original_scope' },
        { description: 'Change Order #0001', source: 'change_order', change_order_id: 'co-1' },
      ])
    ).toBe(true);
  });

  it('treats CO-only invoices as separate from job-level invoices', () => {
    expect(
      isJobLevelInvoiceLineItems([
        { description: 'Change Order #0001', source: 'change_order', change_order_id: 'co-1' },
      ])
    ).toBe(false);
  });
});

describe('isIssuedJobLevelInvoiceRow', () => {
  it('is true for issued rows with no change_order_id on lines', () => {
    expect(
      isIssuedJobLevelInvoiceRow({
        issued_at: '2025-01-02T00:00:00Z',
        line_items: [{ description: 'Scope' }],
      })
    ).toBe(true);
    expect(
      isIssuedJobLevelInvoiceRow({ issued_at: '2025-01-02T00:00:00Z', line_items: [] })
    ).toBe(true);
  });

  it('is false for unissued job-level rows', () => {
    expect(
      isIssuedJobLevelInvoiceRow({
        issued_at: null,
        line_items: [{ description: 'Scope' }],
      })
    ).toBe(false);
  });

  it('is false for change-order-only invoices', () => {
    expect(
      isIssuedJobLevelInvoiceRow({
        issued_at: '2025-01-02T00:00:00Z',
        line_items: [{ change_order_id: 'co-1' }],
      })
    ).toBe(false);
  });

  it('is true for mixed base-scope plus change-order invoices', () => {
    expect(
      isIssuedJobLevelInvoiceRow({
        issued_at: '2025-01-02T00:00:00Z',
        line_items: [
          { description: 'Original scope', source: 'original_scope' },
          { description: 'Change Order #0001', source: 'change_order', change_order_id: 'co-1' },
        ],
      })
    ).toBe(true);
  });
});

describe('getBlocksNewChangeOrdersForJob', () => {
  beforeEach(() => {
    mockState.rows = [];
    mockState.error = null;
  });

  it('returns blocks true when an issued job-level row exists', async () => {
    mockState.rows = [{ issued_at: '2025-01-02T00:00:00Z', line_items: [] }];
    const result = await getBlocksNewChangeOrdersForJob('u1', 'j1');
    expect(result.error).toBeNull();
    expect(result.blocks).toBe(true);
  });

  it('returns blocks false when only CO-scoped issued rows exist', async () => {
    mockState.rows = [{ issued_at: '2025-01-02T00:00:00Z', line_items: [{ change_order_id: 'co-1' }] }];
    const result = await getBlocksNewChangeOrdersForJob('u1', 'j1');
    expect(result.error).toBeNull();
    expect(result.blocks).toBe(false);
  });

  it('returns blocks true when an issued mixed invoice exists', async () => {
    mockState.rows = [
      {
        issued_at: '2025-01-02T00:00:00Z',
        line_items: [
          { description: 'Original scope', source: 'original_scope' },
          { description: 'Change Order #0001', source: 'change_order', change_order_id: 'co-1' },
        ],
      },
    ];
    const result = await getBlocksNewChangeOrdersForJob('u1', 'j1');
    expect(result.error).toBeNull();
    expect(result.blocks).toBe(true);
  });

  it('returns blocks false for unissued job-level only', async () => {
    mockState.rows = [{ issued_at: null, line_items: [{ description: 'x' }] }];
    const result = await getBlocksNewChangeOrdersForJob('u1', 'j1');
    expect(result.error).toBeNull();
    expect(result.blocks).toBe(false);
  });

  it('fail-closes on query error', async () => {
    mockState.error = { message: 'network failed' };
    const result = await getBlocksNewChangeOrdersForJob('u1', 'j1');
    expect(result.blocks).toBe(true);
    expect(result.error?.message).toContain('network failed');
  });
});
