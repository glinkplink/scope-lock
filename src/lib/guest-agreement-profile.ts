import type { BusinessProfile } from '../types/db';
import { normalizeOwnerFullName } from './owner-name';

/**
 * Minimal `BusinessProfile` used only for agreement preview/PDF when the user has no DB profile yet.
 * Mirrors safe defaults from `buildCapturedProfileStub` in AgreementPreview.
 */
export function buildGuestPreviewProfile(input: {
  ownerFirstName: string;
  ownerLastName: string;
  ownerBusinessEmail: string;
  ownerBusinessPhone: string;
}): BusinessProfile {
  const ownerFull = normalizeOwnerFullName(input.ownerFirstName, input.ownerLastName);
  const emailTrim = input.ownerBusinessEmail.trim();
  const phoneTrim = input.ownerBusinessPhone.trim();

  return {
    id: '',
    user_id: '',
    business_name: '',
    owner_name: ownerFull || null,
    phone: phoneTrim || null,
    email: emailTrim || null,
    address: null,
    google_business_profile_url: null,
    default_exclusions: [],
    default_assumptions: [],
    next_wo_number: 1,
    next_invoice_number: 1,
    default_warranty_period: 30,
    default_negotiation_period: 10,
    default_payment_methods: [],
    default_tax_rate: 0,
    default_late_payment_terms: '',
    default_payment_terms_days: 14,
    default_late_fee_rate: 1.5,
    default_card_fee_note: false,
    created_at: '',
    updated_at: '',
  };
}
