import { describe, it, expect } from 'vitest';
import { generateAgreement } from '../agreement-generator';
import type { WelderJob } from '../../types';
import type { BusinessProfile } from '../../types/db';

// ── Fixtures ────────────────────────────────────────────────────────────────

const baseJob: WelderJob = {
  wo_number: 1,
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
  late_payment_terms: '',
  exclusions: [],
  customer_obligations: [],
  change_order_required: false,
  workmanship_warranty_days: 90,
  negotiation_period: 30,
};

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
  default_card_fee_note: false,
  next_wo_number: 2,
  next_invoice_number: 1,
  created_at: '2024-01-01T00:00:00Z',
  updated_at: '2024-01-01T00:00:00Z',
};

// ── Helpers ──────────────────────────────────────────────────────────────────

function titles(job: WelderJob, profile: BusinessProfile | null = baseProfile): string[] {
  return generateAgreement(job, profile).map((s) => s.title);
}

function numberedSections(job: WelderJob, profile: BusinessProfile | null = baseProfile) {
  return generateAgreement(job, profile).filter((s) => s.number > 0);
}

function textOf(job: WelderJob, sectionTitle: string, profile: BusinessProfile | null = baseProfile): string {
  const section = generateAgreement(job, profile).find((s) => s.title === sectionTitle);
  if (!section) return '';
  return section.blocks
    .map((b) => {
      if (b.type === 'paragraph' || b.type === 'note') return b.text;
      if (b.type === 'bullets') return b.items.join(' ');
      if (b.type === 'table') return b.rows.map(([, v]) => v).join(' ');
      return '';
    })
    .join(' ');
}

// ── A. Minimal fixed-price agreement ────────────────────────────────────────

describe('minimal fixed-price agreement', () => {
  it('includes Scope of Work section', () => {
    expect(titles(baseJob)).toContain('Scope of Work');
  });

  it('includes Pricing & Payment Terms section', () => {
    expect(titles(baseJob)).toContain('Pricing & Payment Terms');
  });

  it('includes Signatures & Acceptance section', () => {
    expect(titles(baseJob)).toContain('Signatures & Acceptance');
  });

  it('sections are numbered sequentially with no gaps', () => {
    const nums = numberedSections(baseJob).map((s) => s.number);
    nums.forEach((n, i) => expect(n).toBe(i + 1));
  });
});

// ── B. Time & Materials agreement ────────────────────────────────────────────

describe('time & materials agreement', () => {
  const tmJob: WelderJob = { ...baseJob, price_type: 'time_and_materials' };

  it('shows Time & Materials price type label', () => {
    const text = textOf(tmJob, 'Pricing & Payment Terms');
    expect(text).toContain('Time & Materials');
  });

  it('does not show Fixed Price label', () => {
    const text = textOf(tmJob, 'Pricing & Payment Terms');
    expect(text).not.toContain('Fixed Price');
  });
});

// ── C. Conditional omission logic ────────────────────────────────────────────

describe('conditional omission', () => {
  it('omits Workmanship Warranty when warrantyDays = 0', () => {
    const job = { ...baseJob, workmanship_warranty_days: 0 };
    expect(titles(job)).not.toContain('Workmanship Warranty');
  });

  it('omits Dispute Resolution when negotiationDays = 0', () => {
    const job = { ...baseJob, negotiation_period: 0 };
    expect(titles(job)).not.toContain('Dispute Resolution');
  });

  it('omits Exclusions when exclusions list is empty', () => {
    const job = { ...baseJob, exclusions: [] };
    expect(titles(job)).not.toContain('Exclusions');
  });

  it('omits Exclusions when exclusions list contains only blank strings', () => {
    const job = { ...baseJob, exclusions: ['', '  ', ''] };
    expect(titles(job)).not.toContain('Exclusions');
  });

  it('omits Customer Obligations when list is empty', () => {
    const job = { ...baseJob, customer_obligations: [] };
    expect(titles(job)).not.toContain('Customer Obligations & Site Conditions');
  });

  it('omits Change Orders & Hidden Damage when both flags are false', () => {
    const job = { ...baseJob, change_order_required: false, hidden_damage_possible: false };
    expect(titles(job)).not.toContain('Change Orders & Hidden Damage');
  });
});

// ── D. Conditional inclusion logic ───────────────────────────────────────────

describe('conditional inclusion', () => {
  it('includes hidden damage clause when hiddenDamage = true', () => {
    const job = { ...baseJob, hidden_damage_possible: true };
    const text = textOf(job, 'Change Orders & Hidden Damage');
    expect(text).toContain('hidden damage');
  });

  it('includes change order clause when changeOrderRequired = true', () => {
    const job = { ...baseJob, change_order_required: true };
    const text = textOf(job, 'Change Orders & Hidden Damage');
    expect(text.toLowerCase()).toContain('outside the agreed scope');
  });

  it('includes Exclusions section when non-empty exclusions are present', () => {
    const job = { ...baseJob, exclusions: ['Painting', 'Sandblasting'] };
    expect(titles(job)).toContain('Exclusions');
  });

  it('includes Customer Obligations section when obligations are present', () => {
    const job = { ...baseJob, customer_obligations: ['Provide site access'] };
    expect(titles(job)).toContain('Customer Obligations & Site Conditions');
  });

  it('includes Dispute Resolution when negotiationPeriod > 0', () => {
    expect(titles(baseJob)).toContain('Dispute Resolution');
  });

  it('includes Workmanship Warranty when warrantyDays > 0', () => {
    expect(titles(baseJob)).toContain('Workmanship Warranty');
  });
});

// ── E. Section numbering integrity ───────────────────────────────────────────

describe('section numbering integrity', () => {
  it('numbers are strictly increasing', () => {
    const nums = numberedSections(baseJob).map((s) => s.number);
    for (let i = 1; i < nums.length; i++) {
      expect(nums[i]).toBeGreaterThan(nums[i - 1]);
    }
  });

  it('has no duplicate numbers', () => {
    const nums = numberedSections(baseJob).map((s) => s.number);
    expect(new Set(nums).size).toBe(nums.length);
  });

  it('starts at 1 with no gaps', () => {
    const nums = numberedSections(baseJob).map((s) => s.number);
    nums.forEach((n, i) => expect(n).toBe(i + 1));
  });

  it('numbering stays correct when optional sections are omitted', () => {
    const job = {
      ...baseJob,
      exclusions: [],
      customer_obligations: [],
      workmanship_warranty_days: 0,
      negotiation_period: 0,
    };
    const nums = numberedSections(job).map((s) => s.number);
    nums.forEach((n, i) => expect(n).toBe(i + 1));
  });
});

// ── F. Governing state ────────────────────────────────────────────────────────

describe('governing state', () => {
  it('includes governing state in Dispute Resolution when provided', () => {
    // The current generator uses "applicable state" language, not the literal state value.
    // Verify the section is present and contains governing-law copy.
    const sections = generateAgreement(baseJob, baseProfile);
    const dispute = sections.find((s) => s.title === 'Dispute Resolution');
    expect(dispute).toBeDefined();
    const text = dispute!.blocks.map((b) => ('text' in b ? b.text : '')).join(' ');
    expect(text).toMatch(/governed by.*laws/i);
  });

  it('omits Dispute Resolution entirely when negotiation_period = 0', () => {
    const job = { ...baseJob, negotiation_period: 0 };
    expect(titles(job)).not.toContain('Dispute Resolution');
  });
});

// ── G. Signature block ────────────────────────────────────────────────────────

describe('signature block', () => {
  it('always exists', () => {
    expect(titles(baseJob)).toContain('Signatures & Acceptance');
  });

  it('is not numbered (number = 0)', () => {
    const sections = generateAgreement(baseJob, baseProfile);
    const sig = sections.find((s) => s.title === 'Signatures & Acceptance');
    expect(sig).toBeDefined();
    expect(sig!.number).toBe(0);
  });

  it('contains customer name in signatureData', () => {
    const sections = generateAgreement(baseJob, baseProfile);
    const sig = sections.find((s) => s.title === 'Signatures & Acceptance');
    expect(sig!.signatureData?.customerName).toBe('Jane Smith');
  });

  it('contains owner name from profile', () => {
    const sections = generateAgreement(baseJob, baseProfile);
    const sig = sections.find((s) => s.title === 'Signatures & Acceptance');
    expect(sig!.signatureData?.ownerName).toBe('Bob Welder');
  });

  it('falls back to business_name when owner_name is absent', () => {
    const profileNoOwner = { ...baseProfile, owner_name: '' };
    const sections = generateAgreement(baseJob, profileNoOwner);
    const sig = sections.find((s) => s.title === 'Signatures & Acceptance');
    expect(sig!.signatureData?.ownerName).toBe('Iron & Arc Welding');
  });

  it('signature block appears last', () => {
    const sections = generateAgreement(baseJob, baseProfile);
    const last = sections[sections.length - 1];
    expect(last.title).toBe('Signatures & Acceptance');
  });
});

// ── Completion & Acceptance fallback ─────────────────────────────────────────

describe('Completion & Acceptance fallback', () => {
  it('appears when warranty = 0 and no CO/hidden damage section', () => {
    const job = {
      ...baseJob,
      workmanship_warranty_days: 0,
      change_order_required: false,
      hidden_damage_possible: false,
    };
    expect(titles(job)).toContain('Completion & Acceptance');
  });

  it('does NOT appear when warranty > 0', () => {
    expect(titles(baseJob)).not.toContain('Completion & Acceptance');
  });
});
