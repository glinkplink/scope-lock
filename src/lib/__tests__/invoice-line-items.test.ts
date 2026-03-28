import { describe, expect, it } from 'vitest';

import type { BusinessProfile, ChangeOrder, Invoice, Job } from '../../types/db';
import { mapInvoiceRow } from '../db/invoices';
import {
  buildInvoiceLineItems,
  formatChangeOrderPickerAmount,
  formatChangeOrderInvoiceDescription,
  originalScopeDescription,
  parseExistingIntoInvoiceState,
} from '../invoice-line-items';
import { generateInvoiceHtml } from '../invoice-generator';

const profile: BusinessProfile = {
  id: 'prof-1',
  user_id: 'user-1',
  business_name: 'Iron & Arc',
  owner_name: 'Bob',
  phone: '555-111-2222',
  email: 'bob@example.com',
  address: '',
  google_business_profile_url: '',
  default_exclusions: [],
  default_assumptions: [],
  default_tax_rate: 0,
  default_payment_methods: ['Cash'],
  default_warranty_period: 90,
  default_negotiation_period: 30,
  default_late_payment_terms: '',
  default_payment_terms_days: 14,
  default_late_fee_rate: 1.5,
  default_card_fee_note: false,
  next_wo_number: 1,
  next_invoice_number: 1,
  created_at: '2024-01-01T00:00:00Z',
  updated_at: '2024-01-01T00:00:00Z',
};

const baseJob: Job = {
  id: 'job-1',
  user_id: 'user-1',
  client_id: null,
  customer_name: 'Jane Smith',
  customer_phone: '555-111-2222',
  customer_email: 'jane@example.com',
  job_location: '123 Main St',
  job_type: 'repair',
  other_classification: null,
  asset_or_item_description: 'Steel trailer hitch',
  requested_work: 'Weld cracked hitch receiver and reinforce bracket',
  materials_provided_by: 'welder',
  installation_included: false,
  grinding_included: false,
  paint_or_coating_included: false,
  removal_or_disassembly_included: false,
  hidden_damage_possible: false,
  price_type: 'fixed',
  price: 350,
  deposit_required: false,
  payment_terms: null,
  target_completion_date: null,
  exclusions: [],
  assumptions: [],
  change_order_required: false,
  workmanship_warranty_days: 90,
  status: 'active',
  wo_number: 7,
  agreement_date: '2024-06-01',
  contractor_phone: null,
  contractor_email: null,
  governing_state: 'TX',
  target_start: '2024-06-10',
  deposit_amount: 0,
  late_payment_terms: null,
  payment_terms_days: null,
  late_fee_rate: null,
  negotiation_period: 30,
  customer_obligations: [],
  created_at: '2024-06-01T00:00:00Z',
  updated_at: '2024-06-01T00:00:00Z',
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

const baseCo: ChangeOrder = {
  id: 'co-1',
  user_id: 'user-1',
  job_id: 'job-1',
  co_number: 2,
  description:
    'Install additional support bracket and clean up the surrounding welds for a safer handoff',
  reason: 'Hidden damage found',
  status: 'approved',
  requires_approval: true,
  line_items: [{ id: 'li-1', description: 'Bracket', quantity: 2, unit_rate: 75 }],
  time_amount: 0,
  time_unit: 'days',
  time_note: '',
  created_at: '2024-06-05T00:00:00Z',
  updated_at: '2024-06-05T00:00:00Z',
};

function baseInvoice(line_items: Invoice['line_items']): Invoice {
  return {
    id: 'inv-1',
    user_id: 'user-1',
    job_id: 'job-1',
    invoice_number: 1,
    invoice_date: '2024-06-15',
    due_date: '2024-06-30',
    status: 'draft',
    line_items,
    subtotal: 100,
    tax_rate: 0,
    tax_amount: 0,
    total: 100,
    payment_methods: ['Cash'],
    notes: null,
    created_at: '2024-06-15T00:00:00Z',
    updated_at: '2024-06-15T00:00:00Z',
  };
}

describe('mapInvoiceRow', () => {
  it('preserves structured line metadata', () => {
    const invoice = mapInvoiceRow({
      id: 'inv-1',
      user_id: 'user-1',
      job_id: 'job-1',
      invoice_number: 4,
      invoice_date: '2024-06-15',
      due_date: '2024-06-30',
      status: 'draft',
      line_items: [
        {
          id: 'line-1',
          position: 3,
          change_order_id: 'co-9',
          kind: 'labor',
          description: 'CO line',
          qty: 1,
          unit_price: 50,
          total: 50,
          source: 'change_order',
        },
      ],
      subtotal: 50,
      tax_rate: 0,
      tax_amount: 0,
      total: 50,
      payment_methods: ['Cash'],
      notes: null,
      created_at: '2024-06-15T00:00:00Z',
      updated_at: '2024-06-15T00:00:00Z',
    });

    expect(invoice.line_items[0]).toMatchObject({
      id: 'line-1',
      position: 3,
      change_order_id: 'co-9',
      source: 'change_order',
    });
  });
});

describe('buildInvoiceLineItems', () => {
  it('writes structured metadata for new invoices and tags CO rows', () => {
    const items = buildInvoiceLineItems({
      job: { ...baseJob, price_type: 'fixed' },
      fixedTotal: 350,
      laborRows: [],
      materialsYes: false,
      materialRows: [],
      selectedCOs: [baseCo],
    });

    expect(items).toHaveLength(2);
    expect(items[0]).toMatchObject({
      source: 'original_scope',
      position: 0,
    });
    expect(items[1]).toMatchObject({
      source: 'change_order',
      change_order_id: 'co-1',
      position: 1,
    });
    expect(items.every((item) => typeof item.id === 'string' && item.id)).toBe(true);
  });

  it('preserves CO anchor order when editing a structured invoice after price type changes', () => {
    const existing = [
      {
        id: 'scope-1',
        position: 0,
        kind: 'labor' as const,
        description: 'Original scope',
        qty: 1,
        unit_price: 350,
        total: 350,
        source: 'original_scope' as const,
      },
      {
        id: 'co-line-1',
        position: 1,
        kind: 'labor' as const,
        description: 'Change Order #0002: Existing',
        qty: 1,
        unit_price: 150,
        total: 150,
        source: 'change_order' as const,
        change_order_id: 'co-1',
      },
    ];

    const items = buildInvoiceLineItems({
      job: { ...baseJob, price_type: 'time_and_materials' },
      fixedTotal: 0,
      laborRows: [{ description: 'Shop labor', qty: '2', rate: '100' }],
      materialsYes: true,
      materialRows: [{ description: 'Steel', qty: '1', unit_price: '25' }],
      selectedCOs: [],
      existingLineItems: existing,
    });

    expect(items.map((item) => item.source)).toEqual(['labor', 'change_order', 'material']);
    expect(items[1]).toMatchObject({
      id: 'co-line-1',
      change_order_id: 'co-1',
      position: 1,
    });
  });

  it('upgrades legacy invoice edits into structured metadata', () => {
    const legacy = [
      {
        kind: 'labor' as const,
        description: 'Labor',
        qty: 1,
        unit_price: 100,
        total: 100,
      },
      {
        kind: 'labor' as const,
        description: 'Change Order #0003: Legacy snapshot',
        qty: 1,
        unit_price: 50,
        total: 50,
      },
    ];

    const items = buildInvoiceLineItems({
      job: { ...baseJob, price_type: 'fixed' },
      fixedTotal: 425,
      laborRows: [],
      materialsYes: false,
      materialRows: [],
      selectedCOs: [],
      existingLineItems: legacy,
    });

    expect(items).toHaveLength(2);
    expect(items[0]).toMatchObject({
      source: 'original_scope',
      position: 0,
    });
    expect(items[1]).toMatchObject({
      description: 'Change Order #0003: Legacy snapshot',
      position: 1,
    });
    expect(items.every((item) => typeof item.id === 'string' && item.position != null)).toBe(true);
  });

  it('skips malformed CO totals instead of producing NaN rows', () => {
    const badCo = {
      ...baseCo,
      id: 'co-bad',
      line_items: null,
    } as unknown as ChangeOrder;

    const items = buildInvoiceLineItems({
      job: { ...baseJob, price_type: 'time_and_materials' },
      fixedTotal: 0,
      laborRows: [{ description: 'Labor', qty: '1', rate: '80' }],
      materialsYes: false,
      materialRows: [],
      selectedCOs: [badCo],
    });

    expect(items).toHaveLength(1);
    expect(items[0].total).toBe(80);
    expect(items.some((item) => Number.isNaN(item.total))).toBe(false);
  });
});

describe('legacy and metadata-aware parsing', () => {
  it('does not strip hand-typed lines that look like COs once metadata exists', () => {
    const invoice = baseInvoice([
      {
        id: 'manual-1',
        position: 0,
        kind: 'labor',
        description: 'Change Order # custom fabrication note',
        qty: 1,
        unit_price: 125,
        total: 125,
        source: 'labor',
      },
    ]);

    const parsed = parseExistingIntoInvoiceState(
      { ...baseJob, price_type: 'time_and_materials' },
      invoice,
      profile
    );

    expect(parsed.structuredLineMetadata).toBe(true);
    expect(parsed.laborRows[0].description).toBe('Change Order # custom fabrication note');
  });
});

describe('description helpers', () => {
  it('formats original scope with deterministic ellipsis behavior', () => {
    const longJob = {
      ...baseJob,
      asset_or_item_description: 'A'.repeat(499),
      requested_work: 'Requested work that should be clipped',
    };

    const out = originalScopeDescription(longJob);
    expect(out.length).toBeLessThanOrEqual(500);
    expect(out.endsWith('…')).toBe(true);
  });

  it('adds ellipsis to truncated CO invoice descriptions', () => {
    expect(formatChangeOrderInvoiceDescription(baseCo)).toContain('…');
  });

  it('shows a safe picker amount for malformed CO payloads', () => {
    const badCo = { ...baseCo, line_items: null } as unknown as ChangeOrder;
    expect(formatChangeOrderPickerAmount(badCo)).toBe('0.00');
  });
});

describe('generateInvoiceHtml', () => {
  it('renders line items in persisted position order', () => {
    const html = generateInvoiceHtml(
      {
        invoice_number: 1,
        invoice_date: '2024-06-15',
        due_date: '2024-06-30',
        line_items: [
          {
            id: 'labor-1',
            position: 1,
            kind: 'labor',
            description: 'Labor second',
            qty: 1,
            unit_price: 100,
            total: 100,
            source: 'labor',
          },
          {
            id: 'mat-1',
            position: 0,
            kind: 'material',
            description: 'Material first',
            qty: 1,
            unit_price: 25,
            total: 25,
            source: 'material',
          },
        ],
        subtotal: 125,
        tax_rate: 0,
        tax_amount: 0,
        total: 125,
        payment_methods: ['Cash'],
        notes: null,
      },
      baseJob,
      profile
    );

    expect(html.indexOf('Material first')).toBeLessThan(html.indexOf('Labor second'));
  });

  it('shows a pricing reference block for estimate invoices', () => {
    const html = generateInvoiceHtml(
      baseInvoice([
        {
          kind: 'labor',
          description: 'Labor',
          qty: 40,
          unit_price: 90,
          total: 3600,
        },
      ]),
      { ...baseJob, price_type: 'estimate', price: 1250 },
      profile
    );

    expect(html).toContain('Work order pricing reference');
    expect(html).toContain('Pricing type');
    expect(html).toContain('Estimate');
    expect(html).toContain('Original quoted amount');
    expect(html).toContain('$1,250.00');
    expect(html).toContain('Final billed charges');
    expect(html).toContain('final billed labor, materials, and approved change-order charges');
  });

  it('shows time and materials wording in the pricing reference block', () => {
    const html = generateInvoiceHtml(
      baseInvoice([
        {
          kind: 'labor',
          description: 'Shop labor',
          qty: 12,
          unit_price: 110,
          total: 1320,
        },
      ]),
      { ...baseJob, price_type: 'time_and_materials', price: 900 },
      profile
    );

    expect(html).toContain('Work order pricing reference');
    expect(html).toContain('Time &amp; Materials');
    expect(html).toContain('$900.00');
    expect(html).toContain('Final billed charges');
  });

  it('keeps fixed-price invoices on the original line items presentation', () => {
    const html = generateInvoiceHtml(
      baseInvoice([
        {
          kind: 'labor',
          description: 'Original scope',
          qty: 1,
          unit_price: 350,
          total: 350,
        },
      ]),
      { ...baseJob, price_type: 'fixed', price: 350 },
      profile
    );

    expect(html).not.toContain('Work order pricing reference');
    expect(html).toContain('Line items');
    expect(html).not.toContain('Final billed charges');
  });
});
