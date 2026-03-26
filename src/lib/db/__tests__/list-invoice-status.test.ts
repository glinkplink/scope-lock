import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const supabaseState: { rows: unknown[]; error: { message: string } | null } = {
  rows: [],
  error: null,
};

vi.mock('../../supabase', () => ({
  supabase: {
    from: () => ({
      select: () => ({
        eq: () => ({
          order: () =>
            Promise.resolve({
              get data() {
                return supabaseState.rows;
              },
              get error() {
                return supabaseState.error;
              },
            }),
        }),
      }),
    }),
  },
}));

import { invoiceStatusMapFromRows, listInvoiceStatusByJob } from '../invoices';

describe('invoiceStatusMapFromRows', () => {
  it('keeps the first row per job_id (latest when input is created_at desc)', () => {
    const map = invoiceStatusMapFromRows([
      {
        id: 'inv-new',
        job_id: 'j1',
        status: 'draft',
        invoice_number: 2,
        created_at: '2025-02-02T00:00:00Z',
      },
      {
        id: 'inv-old',
        job_id: 'j1',
        status: 'downloaded',
        invoice_number: 1,
        created_at: '2025-01-01T00:00:00Z',
      },
    ]);
    expect(map.get('j1')?.id).toBe('inv-new');
  });
});

describe('listInvoiceStatusByJob', () => {
  beforeEach(() => {
    supabaseState.rows = [];
    supabaseState.error = null;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('returns mapped rows when all rows are valid', async () => {
    supabaseState.rows = [
      {
        id: 'i1',
        job_id: 'j1',
        status: 'draft',
        invoice_number: 1,
        created_at: '2025-01-02T00:00:00Z',
      },
    ];
    const result = await listInvoiceStatusByJob('user-1');
    expect(result.error).toBeNull();
    expect(result.data).toEqual([
      {
        id: 'i1',
        job_id: 'j1',
        status: 'draft',
        invoice_number: 1,
        created_at: '2025-01-02T00:00:00Z',
      },
    ]);
  });

  it('returns query error when Supabase errors', async () => {
    supabaseState.error = { message: 'network' };
    const result = await listInvoiceStatusByJob('user-1');
    expect(result.data).toBeNull();
    expect(result.error?.message).toContain('network');
  });

  it('returns error and logs when any row is malformed', async () => {
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    supabaseState.rows = [
      {
        id: 'i-good',
        job_id: 'j1',
        status: 'draft',
        invoice_number: 1,
        created_at: '2025-01-02T00:00:00Z',
      },
      {
        id: 'i-bad',
        job_id: 'j2',
        status: 'draft',
        invoice_number: 'nope',
        created_at: '2025-01-01T00:00:00Z',
      },
    ];
    const result = await listInvoiceStatusByJob('user-1');
    expect(result.data).toBeNull();
    expect(result.error?.message).toMatch(/could not be read/i);
    expect(errSpy).toHaveBeenCalled();
    errSpy.mockRestore();
  });
});
