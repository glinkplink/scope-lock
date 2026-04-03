import { describe, it, expect } from 'vitest';
import { generateAgreement } from '../agreement-generator';
import {
  buildDocusealWorkOrderHtmlDocument,
  buildWorkOrderEsignNotificationMessage,
} from '../docuseal-agreement-html';
import { esc } from '../html-escape';
import type { WelderJob } from '../../types';
import type { BusinessProfile } from '../../types/db';

const profile: BusinessProfile = {
  id: 'p1',
  user_id: 'u1',
  business_name: 'Test Weld Co',
  owner_name: 'Pat Welder',
  phone: '555-000-1111',
  email: 'pat@test.com',
  address: '',
  google_business_profile_url: '',
  default_exclusions: [],
  default_assumptions: [],
  next_wo_number: 1,
  next_invoice_number: 1,
  default_warranty_period: 90,
  default_negotiation_period: 30,
  default_payment_methods: [],
  default_tax_rate: 0,
  default_late_payment_terms: '',
  default_payment_terms_days: 14,
  default_late_fee_rate: 1.5,
  default_card_fee_note: false,
  stripe_account_id: null,
  stripe_onboarding_complete: false,
  created_at: '2024-01-01T00:00:00Z',
  updated_at: '2024-01-01T00:00:00Z',
};

const welderJob: WelderJob = {
  wo_number: 3,
  agreement_date: '2024-06-01',
  customer_first_name: 'Jane',
  customer_last_name: '',
  customer_name: 'Jane',
  customer_phone: '',
  customer_email: 'jane@example.com',
  job_location: '123 St',
  job_site_street: '123 St',
  job_site_city: 'Austin',
  job_site_state: 'TX',
  job_site_zip: '78701',
  governing_state: 'TX',
  job_type: 'repair',
  asset_or_item_description: 'Item',
  requested_work: 'Fix it',
  materials_provided_by: 'welder',
  installation_included: false,
  grinding_included: false,
  paint_or_coating_included: false,
  removal_or_disassembly_included: false,
  hidden_damage_possible: false,
  target_start: '',
  target_completion_date: '',
  price_type: 'fixed',
  price: 100,
  exclusions: [],
  change_order_required: false,
  workmanship_warranty_days: 90,
  negotiation_period: 30,
  deposit_amount: 0,
  payment_terms_days: 0,
  late_fee_rate: 0,
  customer_obligations: [],
};

describe('docuseal-agreement-html', () => {
  it('includes embedded style and DocuSeal field tags for customer signature', () => {
    const sections = generateAgreement(welderJob, profile);
    const html = buildDocusealWorkOrderHtmlDocument(sections);
    expect(html).toContain('<style>');
    expect(html).toContain('agreement-document');
    expect(html).toContain('fonts.googleapis.com');
    expect(html).toContain('Dancing+Script');
    expect(html).toContain('box-decoration-break');
    expect(html).toContain('.agreement-section:not(:first-child)');
    expect(html).toContain('<signature-field');
    expect(html).toContain('role="Customer"');
  });

  it('embeds the provider signature image when provided', () => {
    const sections = generateAgreement(welderJob, profile);
    const html = buildDocusealWorkOrderHtmlDocument(sections, {
      providerSignatureDataUrl: 'data:image/png;base64,provider-signature',
    });

    expect(html).toContain('class="signature-autofill-image"');
    expect(html).toContain('data:image/png;base64,provider-signature');
    expect(html).not.toContain('<div class="signature-autofill-name">Pat Welder</div>');
  });

  it('keeps the text fallback when no provider signature image is available', () => {
    const sections = generateAgreement(welderJob, profile);
    const html = buildDocusealWorkOrderHtmlDocument(sections, {
      providerSignatureDataUrl: null,
    });

    expect(html).toContain('<div class="signature-autofill-name">Pat Welder</div>');
  });

  it('escapes XSS in user-controlled agreement text', () => {
    const evil: WelderJob = {
      ...welderJob,
      customer_first_name: '',
      customer_last_name: '',
      customer_name: '<script>alert(1)</script>',
      requested_work: 'Work & <img src=x onerror=alert(1)>',
    };
    const sections = generateAgreement(evil, profile);
    const html = buildDocusealWorkOrderHtmlDocument(sections);
    expect(html).not.toContain('<script>');
    expect(html).toContain('&lt;script&gt;');
    expect(html).toContain('&amp;');
  });

  it('keeps section order aligned with generateAgreement', () => {
    const sections = generateAgreement(welderJob, profile);
    const html = buildDocusealWorkOrderHtmlDocument(sections);
    const first = sections[0]?.title ?? '';
    const last = sections[sections.length - 1]?.title ?? '';
    expect(first && last).toBeTruthy();
    const firstEsc = esc(first);
    const lastEsc = esc(last);
    expect(html.indexOf(firstEsc)).toBeGreaterThanOrEqual(0);
    expect(html.indexOf(lastEsc)).toBeGreaterThan(html.indexOf(firstEsc));
  });

  it('includes work-order detail lines in the DocuSeal notification email', () => {
    const message = buildWorkOrderEsignNotificationMessage(
      {
        ...welderJob,
        target_start: '2024-06-10',
        target_completion_date: '2024-06-11',
      },
      profile
    );

    expect(message.body).toContain('Reference: Work Order #0003');
    expect(message.body).toContain('Item / Structure: Item');
    expect(message.body).toContain('Work Requested: Fix it');
    expect(message.body).toContain('Target Start Date: June 10, 2024');
    expect(message.body).toContain('Target Completion Date: June 11, 2024');
    expect(message.body.indexOf('Reference: Work Order #0003')).toBeLessThan(
      message.body.indexOf('Item / Structure: Item')
    );
    expect(message.body.indexOf('Item / Structure: Item')).toBeLessThan(
      message.body.indexOf('Please review and sign using the link below:')
    );
    expect(message.body.indexOf('Please review and sign using the link below:')).toBeLessThan(
      message.body.indexOf('{{submitter.link}}')
    );
    expect(message.body.indexOf('{{submitter.link}}')).toBeLessThan(
      message.body.indexOf('Target Start Date: June 10, 2024')
    );
  });

  it('omits target date lines when the work order has no dates', () => {
    const message = buildWorkOrderEsignNotificationMessage(welderJob, profile);

    expect(message.body).toContain('Reference: Work Order #0003');
    expect(message.body).toContain('Item / Structure: Item');
    expect(message.body).toContain('Work Requested: Fix it');
    expect(message.body).not.toContain('Target Start Date:');
    expect(message.body).not.toContain('Target Completion Date:');
    expect(message.body.indexOf('Reference: Work Order #0003')).toBeLessThan(
      message.body.indexOf('Item / Structure: Item')
    );
    expect(message.body.indexOf('{{submitter.link}}')).toBeLessThan(
      message.body.indexOf('Thank you,')
    );
    expect(message.body.indexOf('Work Requested: Fix it')).toBeLessThan(
      message.body.indexOf('Please review and sign using the link below:')
    );
    expect(message.body.indexOf('{{submitter.link}}')).toBeGreaterThan(
      message.body.indexOf('Please review and sign using the link below:')
    );
    expect(message.body.indexOf('Reference: Work Order #0003')).toBeLessThan(
      message.body.indexOf('Please review and sign using the link below:')
    );
  });
});
