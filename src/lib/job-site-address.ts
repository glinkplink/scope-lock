const US_COUNTRY_TAIL = /,?\s*(United States of America|United States|USA)\s*$/i;

/**
 * Parse Geoapify-style `address_line2` (e.g. "Austin, TX 78703, United States of America").
 */
export function parseUsCityStateZipFromLine2(addressLine2: string): {
  city: string;
  state: string;
  zip: string;
} {
  const cleaned = addressLine2.replace(US_COUNTRY_TAIL, '').trim();
  const m = cleaned.match(/^(.+?),\s*([A-Za-z]{2})\s+(\d{5}(?:-\d{4})?)\s*$/);
  if (!m) return { city: '', state: '', zip: '' };
  return { city: m[1].trim(), state: m[2].toUpperCase(), zip: m[3] };
}

/**
 * If a single field contains a full US-style line ("Street, City, ST 12345"), split it for the form.
 * Returns null when no trailing ", ST ZIP" pattern is found.
 */
export function tryParseUsAddressBlob(raw: string): {
  street: string;
  city: string;
  state: string;
  zip: string;
} | null {
  let s = raw.replace(/\r\n/g, '\n').trim();
  s = s.replace(/\n/g, ', ');
  s = s.replace(US_COUNTRY_TAIL, '').trim();
  if (!s) return null;

  const m = s.match(/^(.+),\s*([A-Za-z]{2})\s+(\d{5}(?:-\d{4})?)\s*$/);
  if (!m) return null;

  const rest = m[1].trim();
  const state = m[2].toUpperCase();
  const zip = m[3];

  const lastComma = rest.lastIndexOf(',');
  if (lastComma === -1) {
    return { street: rest, city: '', state, zip };
  }
  const street = rest.slice(0, lastComma).trim();
  const city = rest.slice(lastComma + 1).trim();
  if (!street) return null;
  return { street, city, state, zip };
}

/**
 * Second line from `formatJobSiteAddress` — "City, ST ZIP", "City, ST", or "City" only.
 */
function parseJobSiteSecondLine(line2: string): {
  city: string;
  state: string;
  zip: string;
} {
  const t = line2.trim();
  if (!t) return { city: '', state: '', zip: '' };

  const fromZip = parseUsCityStateZipFromLine2(t);
  if (fromZip.zip) return fromZip;

  const mState = t.match(/^(.+?),\s*([A-Za-z]{2})\s*$/);
  if (mState) {
    return { city: mState[1].trim(), state: mState[2].toUpperCase(), zip: '' };
  }

  return { city: t, state: '', zip: '' };
}

/**
 * Split `clients.address` / stored `job_location` into structured fields (inverse of `formatJobSiteAddress` where possible).
 */
export function parseStoredJobSiteAddress(raw: string): {
  street: string;
  city: string;
  state: string;
  zip: string;
} {
  const normalized = raw.replace(/\r\n/g, '\n').trim();
  if (!normalized) {
    return { street: '', city: '', state: '', zip: '' };
  }

  const nl = normalized.indexOf('\n');
  if (nl !== -1) {
    const street = normalized.slice(0, nl).trim();
    const line2 = normalized.slice(nl + 1).replace(/\n/g, ' ').trim();
    const { city, state, zip } = parseJobSiteSecondLine(line2);
    return { street, city, state, zip };
  }

  const blob = tryParseUsAddressBlob(normalized);
  if (blob) {
    // Single line was only "City, ST ZIP" (no street) — blob mislabels city as street.
    if (!blob.city && blob.zip && !blob.street.includes(',')) {
      return {
        street: '',
        city: blob.street,
        state: blob.state,
        zip: blob.zip,
      };
    }
    return blob;
  }

  return { street: normalized, city: '', state: '', zip: '' };
}

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

/** Collapse newlines / runs of whitespace for agreement and PDF job site display (single line). */
export function jobLocationSingleLine(raw: string): string {
  return raw
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim();
}
