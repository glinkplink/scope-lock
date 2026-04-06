import {
  parseUsCityStateZipFromLine2,
  tryParseUsAddressBlob,
} from './job-site-address';

export interface JobSiteAddressSuggestion {
  id: string;
  label: string;
  street: string;
  city: string;
  state: string;
  zip: string;
}

/** One row from Geoapify autocomplete `format=json` — flat object on `data.results`. */
type GeoapifyJsonResult = {
  address_line1?: string;
  address_line2?: string;
  city?: string;
  state_code?: string;
  postcode?: string;
  formatted?: string;
  housenumber?: string;
  street?: string;
};

function resultToSuggestion(r: GeoapifyJsonResult, index: number): JobSiteAddressSuggestion | null {
  const formatted = (r.formatted ?? '').trim();
  const line1 = (r.address_line1 ?? '').trim();
  const house = (r.housenumber ?? '').trim();
  const st = (r.street ?? '').trim();
  const fromParts = [house, st].filter(Boolean).join(' ').trim();

  let street =
    line1 ||
    fromParts ||
    (formatted.includes(',') ? formatted.split(',')[0]?.trim() ?? '' : formatted) ||
    '';
  if (!street) return null;

  let city = (r.city ?? '').trim();
  let state = (r.state_code ?? '').trim();
  let zip = (r.postcode ?? '').trim();

  const line2 = (r.address_line2 ?? '').trim();
  if ((!city || !state || !zip) && line2) {
    const p = parseUsCityStateZipFromLine2(line2);
    if (!city) city = p.city;
    if (!state) state = p.state;
    if (!zip) zip = p.zip;
  }

  if ((!city || !state || !zip) && formatted) {
    const blob = tryParseUsAddressBlob(formatted);
    if (blob) {
      if (!city) city = blob.city;
      if (!state) state = blob.state;
      if (!zip) zip = blob.zip;
      if ((!line1 && !fromParts && blob.street) || street === formatted) {
        street = blob.street;
      }
    }
  }

  const label = [street, city, state, zip].filter(Boolean).join(', ');
  return {
    id: `geoapify-${index}-${label.slice(0, 48)}`,
    label,
    street,
    city,
    state,
    zip,
  };
}

/** Geoapify Geocoder Autocomplete (US street); `format=json` returns `{ results: [...] }`. */
export async function fetchGeoapifyAddressSuggestions(
  text: string,
  apiKey: string,
  coords?: { lat: number; lng: number }
): Promise<JobSiteAddressSuggestion[]> {
  const trimmed = text.trim();
  if (trimmed.length < 3 || !apiKey) return [];

  const url = new URL('https://api.geoapify.com/v1/geocode/autocomplete');
  url.searchParams.set('text', trimmed);
  if (
    coords &&
    Number.isFinite(coords.lat) &&
    Number.isFinite(coords.lng)
  ) {
    url.searchParams.set('bias', `proximity:${coords.lng},${coords.lat}`);
  }
  // Omit bias when coords missing — REST API rejects `proximity:auto` (400).
  url.searchParams.set('filter', 'countrycode:us');
  url.searchParams.set('format', 'json');
  url.searchParams.set('apiKey', apiKey);

  let res: Response;
  try {
    res = await fetch(url.toString());
  } catch {
    return [];
  }
  if (!res.ok) return [];

  const data = (await res.json()) as { results?: GeoapifyJsonResult[] };

  const raw = Array.isArray(data.results) ? data.results : [];
  const out: JobSiteAddressSuggestion[] = [];
  for (let i = 0; i < raw.length && out.length < 5; i++) {
    const s = resultToSuggestion(raw[i], i);
    if (s) out.push(s);
  }
  return out;
}
