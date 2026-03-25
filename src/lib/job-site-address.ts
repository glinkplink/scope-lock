/** Combine structured job site fields into the persisted `job_location` string (multiline). */
export function formatJobSiteAddress(parts: {
  street: string;
  city: string;
  state: string;
  zip: string;
}): string {
  const street = parts.street.trim();
  const city = parts.city.trim();
  const state = parts.state.trim();
  const zip = parts.zip.trim();
  const stateZip = [state, zip].filter(Boolean).join(' ').trim();
  const line2 = [city, stateZip].filter(Boolean).join(', ');
  if (!line2) return street;
  if (!street) return line2;
  return `${street}\n${line2}`;
}

/** Normalize state for `governing_state` (US: prefer 2-letter when available). */
export function governingStateFromSiteState(siteState: string): string {
  return siteState.trim().toUpperCase();
}
