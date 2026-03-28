import type { WelderJob } from '../types';

export const DEFAULT_EXCLUSIONS = [
  'Painting, powder coating, or any surface finishing',
  'Replacement of rusted sections beyond the defined repair area',
  'Permit acquisition or code compliance inspections',
  'Any structural engineering assessment or certification',
  'Work not specified in Section 3 above',
];

export const DEFAULT_CUSTOMER_OBLIGATIONS = [
  'Provide clear, unobstructed access to the work area at the scheduled time',
  'Ensure weather conditions are suitable for outdoor welding (no precipitation, wind below 25 mph)',
  'Confirm no hazardous materials (asbestos, lead paint, pressurized lines) are present in or adjacent to the work area',
  'Designate a point of contact who is reachable during the work period',
];

export function getDefaultExclusions(overrides?: string[] | null) {
  if (overrides == null) return [...DEFAULT_EXCLUSIONS];
  return [...overrides];
}

export function getDefaultCustomerObligations(overrides?: string[] | null) {
  if (overrides == null) return [...DEFAULT_CUSTOMER_OBLIGATIONS];
  return [...overrides];
}

export function buildInitialProfileDefaults(job: WelderJob, saveAsDefaults: boolean) {
  if (!saveAsDefaults) {
    return {
      default_exclusions: getDefaultExclusions(),
      default_assumptions: getDefaultCustomerObligations(),
    };
  }

  return {
    default_exclusions: [...job.exclusions],
    default_assumptions: [...job.customer_obligations],
    default_warranty_period: job.workmanship_warranty_days,
    default_negotiation_period: job.negotiation_period,
    default_payment_terms_days: job.payment_terms_days,
    default_late_fee_rate: job.late_fee_rate,
  };
}
