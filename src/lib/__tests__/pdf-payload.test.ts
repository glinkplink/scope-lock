import { describe, it, expect, vi } from 'vitest';

// agreement-pdf.ts imports App.css with Vite's ?raw suffix, which is not
// available in the Node/Vitest environment. Stub it out before importing.
vi.mock('../../App.css?raw', () => ({ default: '/* stubbed */' }));
vi.mock('../change-order-document.css?raw', () => ({
  default: '.change-order-document .parties-layout.co-doc-parties { padding-top: 5px; }',
}));

import {
  getPdfFilename,
  getCoPdfFilename,
  getWorkOrderHeaderLabel,
  getPdfFooterBusinessName,
  getPdfFooterPhone,
  buildPdfHtml,
} from '../agreement-pdf';
import { agreementSectionsToHtml } from '../agreement-sections-html';
import {
  generateChangeOrderHtml,
  buildCombinedWorkOrderAndChangeOrdersHtml,
} from '../change-order-generator';
import { generateAgreement } from '../agreement-generator';

import type { WelderJob } from '../../types';
import type { BusinessProfile, Job, ChangeOrder } from '../../types/db';
import { generateInvoiceHtml, type InvoiceDraft } from '../invoice-generator';

// ── Fixtures ─────────────────────────────────────────────────────────────────

const baseProfile: BusinessProfile = {
  id: 'prof-1',
  user_id: 'user-1',
  business_name: 'Iron & Arc Welding',
  owner_name: 'Bob Welder',
  phone: '555-999-0000',
  email: 'bob@ironarc.com',
  address: '',
  google_business_profile_url: '',
  default_exclusions: [],
  default_assumptions: [],
  default_tax_rate: 0,
  default_payment_methods: [],
  default_warranty_period: 90,
  default_negotiation_period: 30,
  default_late_payment_terms: '',
  default_payment_terms_days: 14,
  default_late_fee_rate: 1.5,
  default_card_fee_note: false,
  next_wo_number: 2,
  next_invoice_number: 1,
  created_at: '2024-01-01T00:00:00Z',
  updated_at: '2024-01-01T00:00:00Z',
};

const baseWelderJob: WelderJob = {
  wo_number: 7,
  agreement_date: '2024-06-01',
  customer_name: 'Jane Smith',
  customer_phone: '555-111-2222',
  customer_email: 'jane@example.com',
  job_location: '123 Main St, Austin, TX 78701',
  job_site_street: '123 Main St',
  job_site_city: 'Austin',
  job_site_state: 'TX',
  job_site_zip: '78701',
  governing_state: 'TX',
  job_type: 'repair',
  asset_or_item_description: 'Steel trailer hitch',
  requested_work: 'Weld cracked hitch receiver',
  materials_provided_by: 'welder',
  installation_included: false,
  grinding_included: false,
  paint_or_coating_included: false,
  removal_or_disassembly_included: false,
  hidden_damage_possible: false,
  target_start: '2024-06-10',
  target_completion_date: '2024-06-11',
  price_type: 'fixed',
  price: 350,
  deposit_amount: 0,
  payment_terms_days: 14,
  late_fee_rate: 1.5,
  exclusions: [],
  customer_obligations: [],
  change_order_required: false,
  workmanship_warranty_days: 90,
  negotiation_period: 30,
};

const baseDbJob: Job = {
  id: 'job-1',
  user_id: 'user-1',
  client_id: null,
  customer_name: 'Jane Smith',
  customer_phone: '555-111-2222',
  customer_email: 'jane@example.com',
  job_location: '123 Main St, Austin, TX 78701',
  job_type: 'repair',
  other_classification: null,
  asset_or_item_description: 'Steel trailer hitch',
  requested_work: 'Weld cracked hitch receiver',
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
  target_completion_date: '2024-06-11',
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
  co_number: 1,
  description: 'Additional brace required',
  reason: 'Hidden crack found',
  status: 'approved',
  requires_approval: true,
  line_items: [
    { id: 'li-1', description: 'Extra steel brace', quantity: 2, unit_rate: 75 },
  ],
  time_amount: 1,
  time_unit: 'days',
  time_note: 'Extra day for cure',
  created_at: '2024-06-05T00:00:00Z',
  updated_at: '2024-06-05T00:00:00Z',
};

const baseInvoiceDraft: InvoiceDraft = {
  invoice_number: 1,
  invoice_date: '2024-06-15',
  due_date: '2024-06-30',
  line_items: [
    { kind: 'labor', description: 'Welding labor', qty: 1, unit_price: 100, total: 100 },
  ],
  subtotal: 100,
  tax_rate: 0,
  tax_amount: 0,
  total: 100,
  payment_methods: ['Cash'],
  notes: null,
};

// ── A. Filename helpers ───────────────────────────────────────────────────────

describe('getPdfFilename', () => {
  it('pads WO number to 4 digits', () => {
    expect(getPdfFilename(7, 'Jane Smith')).toBe('WO-0007_Jane_Smith.pdf');
  });

  it('replaces spaces in customer name with underscores', () => {
    expect(getPdfFilename(1, 'Bob Van Dike')).toBe('WO-0001_Bob_Van_Dike.pdf');
  });

  it('falls back to "customer" when name is empty', () => {
    expect(getPdfFilename(1, '')).toBe('WO-0001_customer.pdf');
  });
});

describe('getCoPdfFilename', () => {
  it('uses CO prefix and pads number', () => {
    expect(getCoPdfFilename(3, 'Jane Smith')).toBe('CO-0003_Jane_Smith.pdf');
  });
});

// ── B. Work Order payload fields ──────────────────────────────────────────────

describe('work order payload fields', () => {
  it('getWorkOrderHeaderLabel formats WO number correctly', () => {
    expect(getWorkOrderHeaderLabel(baseWelderJob)).toBe('Work Order #0007');
  });

  it('getPdfFooterBusinessName returns profile business name', () => {
    expect(getPdfFooterBusinessName(baseProfile, baseWelderJob)).toBe('Iron & Arc Welding');
  });

  it('getPdfFooterBusinessName falls back to contractor_name when no profile', () => {
    const job = { ...baseWelderJob, contractor_name: 'Solo Welder' };
    expect(getPdfFooterBusinessName(null, job)).toBe('Solo Welder');
  });

  it('getPdfFooterPhone returns profile phone', () => {
    expect(getPdfFooterPhone(baseProfile, baseWelderJob)).toBe('555-999-0000');
  });
});

// ── C. buildPdfHtml wrapper ───────────────────────────────────────────────────

describe('buildPdfHtml', () => {
  it('returns a non-empty string', () => {
    const html = buildPdfHtml('<p>test</p>');
    expect(typeof html).toBe('string');
    expect(html.length).toBeGreaterThan(0);
  });

  it('includes the inner markup verbatim', () => {
    const inner = '<div class="agreement-document">body content</div>';
    expect(buildPdfHtml(inner)).toContain(inner);
  });

  it('wraps with valid HTML boilerplate', () => {
    const html = buildPdfHtml('<p>x</p>');
    expect(html).toContain('<!doctype html>');
    expect(html).toContain('<html');
    expect(html).toContain('</html>');
  });

  it('inlines change-order document CSS for CO PDF layout', () => {
    expect(buildPdfHtml('')).toContain('.change-order-document .parties-layout.co-doc-parties');
  });

  it('includes Barlow font link', () => {
    expect(buildPdfHtml('')).toContain('Barlow');
  });

  it('includes Dancing Script font link (for signature)', () => {
    expect(buildPdfHtml('')).toContain('Dancing+Script');
  });

  it('is deterministic — same input produces same output', () => {
    const inner = '<p>hello</p>';
    expect(buildPdfHtml(inner)).toBe(buildPdfHtml(inner));
  });

  it('does NOT contain workOrderNumber or marginHeaderLeft fields', () => {
    // Those fields live in the JSON body sent to /api/pdf, not in the HTML string itself.
    const html = buildPdfHtml('<p>content</p>');
    expect(html).not.toContain('workOrderNumber');
    expect(html).not.toContain('marginHeaderLeft');
  });
});

// ── D. agreementSectionsToHtml ────────────────────────────────────────────────

describe('agreementSectionsToHtml', () => {
  const sections = generateAgreement(baseWelderJob, baseProfile);
  const html = agreementSectionsToHtml(sections);

  it('returns a non-empty string', () => {
    expect(html.length).toBeGreaterThan(0);
  });

  it('contains one .agreement-section per section', () => {
    const count = (html.match(/class="agreement-section/g) ?? []).length;
    expect(count).toBe(sections.length);
  });

  it('numbered sections include their number in the heading', () => {
    expect(html).toContain('1. Parties');
    expect(html).toContain('2. Project Overview');
  });

  it('signature section is not numbered', () => {
    expect(html).toContain('Signatures &amp; Acceptance');
    expect(html).not.toContain('0. Signatures');
  });

  it('escapes HTML special characters in user data', () => {
    const job = { ...baseWelderJob, customer_name: '<script>alert(1)</script>' };
    const out = agreementSectionsToHtml(generateAgreement(job, baseProfile));
    expect(out).not.toContain('<script>');
    expect(out).toContain('&lt;script&gt;');
  });

  it('is deterministic', () => {
    expect(agreementSectionsToHtml(sections)).toBe(agreementSectionsToHtml(sections));
  });
});

// ── E. Change Order HTML ──────────────────────────────────────────────────────

describe('generateChangeOrderHtml', () => {
  const html = generateChangeOrderHtml(baseCo, baseDbJob, baseProfile);

  it('returns a non-empty string', () => {
    expect(html.length).toBeGreaterThan(0);
  });

  it('wraps parties, main body, and approval for PDF layout', () => {
    expect(html).toContain('parties-layout co-doc-parties');
    expect(html).toContain('class="co-doc-main"');
    expect(html).toContain('class="co-doc-approval"');
  });

  it('contains the CO number', () => {
    expect(html).toContain('Change Order #0001');
  });

  it('contains the WO reference', () => {
    expect(html).toContain('WO #0007');
  });

  it('contains the description', () => {
    expect(html).toContain('Additional brace required');
  });

  it('contains schedule impact when time_amount > 0', () => {
    expect(html).toContain('Schedule impact');
    expect(html).toContain('1 days');
  });

  it('omits schedule impact when time_amount = 0', () => {
    const co = { ...baseCo, time_amount: 0 };
    const out = generateChangeOrderHtml(co, baseDbJob, baseProfile);
    expect(out).not.toContain('Schedule impact');
  });

  it('includes approval signature block when requires_approval = true', () => {
    expect(html).toContain('signature-blocks');
  });

  it('omits signature block when requires_approval = false', () => {
    const co = { ...baseCo, requires_approval: false };
    const out = generateChangeOrderHtml(co, baseDbJob, baseProfile);
    expect(out).not.toContain('signature-blocks');
    expect(out).toContain('does not require separate approval');
  });

  it('escapes HTML in description', () => {
    const co = { ...baseCo, description: '<b>bold & dangerous</b>' };
    const out = generateChangeOrderHtml(co, baseDbJob, baseProfile);
    expect(out).not.toContain('<b>bold');
    expect(out).toContain('&lt;b&gt;');
  });
});

// ── E2. Invoice HTML ──────────────────────────────────────────────────────────

describe('generateInvoiceHtml', () => {
  const html = generateInvoiceHtml(baseInvoiceDraft, baseDbJob, baseProfile);

  it('returns a non-empty string', () => {
    expect(html.length).toBeGreaterThan(0);
  });

  it('contains the invoice title', () => {
    expect(html).toContain('INVOICE');
  });

  it('escapes HTML in line item description', () => {
    const invoice: InvoiceDraft = {
      ...baseInvoiceDraft,
      line_items: [
        {
          kind: 'labor',
          description: '<img src=x onerror=alert(1)>',
          qty: 1,
          unit_price: 10,
          total: 10,
        },
      ],
      subtotal: 10,
      total: 10,
    };
    const out = generateInvoiceHtml(invoice, baseDbJob, baseProfile);
    expect(out).not.toContain('<img ');
    expect(out).toContain('&lt;img');
  });

  it('escapes HTML in notes and preserves newlines as br', () => {
    const invoice: InvoiceDraft = {
      ...baseInvoiceDraft,
      notes: '<script>x</script>\nSecond line',
    };
    const out = generateInvoiceHtml(invoice, baseDbJob, baseProfile);
    expect(out).not.toContain('<script>');
    expect(out).toContain('&lt;script&gt;');
    expect(out).toContain('<br />');
  });

  it('escapes HTML in payment method labels', () => {
    const invoice: InvoiceDraft = {
      ...baseInvoiceDraft,
      payment_methods: ['Pay <online> & "now"'],
    };
    const out = generateInvoiceHtml(invoice, baseDbJob, baseProfile);
    expect(out).not.toContain('<online>');
    expect(out).toContain('&lt;online&gt;');
    expect(out).toContain('&amp;');
    expect(out).toContain('&quot;now&quot;');
  });

  it('is deterministic', () => {
    expect(generateInvoiceHtml(baseInvoiceDraft, baseDbJob, baseProfile)).toBe(
      generateInvoiceHtml(baseInvoiceDraft, baseDbJob, baseProfile)
    );
  });
});

// ── F. Combined WO + CO HTML ──────────────────────────────────────────────────

describe('buildCombinedWorkOrderAndChangeOrdersHtml', () => {
  const woHtml = '<div class="agreement-document">WO content</div>';

  it('starts with the work order HTML', () => {
    const out = buildCombinedWorkOrderAndChangeOrdersHtml(woHtml, [baseCo], baseDbJob, baseProfile);
    expect(out.trimStart().startsWith(woHtml));
  });

  it('includes change order content', () => {
    const out = buildCombinedWorkOrderAndChangeOrdersHtml(woHtml, [baseCo], baseDbJob, baseProfile);
    expect(out).toContain('Change Order #0001');
    expect(out).toContain('Additional brace required');
  });

  it('inserts a page break before each CO', () => {
    const out = buildCombinedWorkOrderAndChangeOrdersHtml(woHtml, [baseCo], baseDbJob, baseProfile);
    expect(out).toContain('page-break-before:always');
  });

  it('includes each change order in the list regardless of status', () => {
    const pending = { ...baseCo, co_number: 2, status: 'pending_approval' as const, description: 'Pending work' };
    const out = buildCombinedWorkOrderAndChangeOrdersHtml(woHtml, [pending], baseDbJob, baseProfile);
    expect(out).toContain('Pending work');
    expect(out).toContain('page-break-before:always');
  });

  it('returns WO-only HTML when there are no change orders', () => {
    const out = buildCombinedWorkOrderAndChangeOrdersHtml(woHtml, [], baseDbJob, baseProfile);
    expect(out.trim()).toBe(woHtml);
  });

  it('handles multiple change orders', () => {
    const co2 = { ...baseCo, co_number: 2, description: 'Second change order' };
    const out = buildCombinedWorkOrderAndChangeOrdersHtml(woHtml, [baseCo, co2], baseDbJob, baseProfile);
    expect(out).toContain('Change Order #0001');
    expect(out).toContain('Change Order #0002');
    const pageBreaks = (out.match(/page-break-before:always/g) ?? []).length;
    expect(pageBreaks).toBe(2);
  });
});
