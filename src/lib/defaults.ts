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
  return overrides && overrides.length > 0 ? [...overrides] : [...DEFAULT_EXCLUSIONS];
}

export function getDefaultCustomerObligations(overrides?: string[] | null) {
  return overrides && overrides.length > 0
    ? [...overrides]
    : [...DEFAULT_CUSTOMER_OBLIGATIONS];
}
