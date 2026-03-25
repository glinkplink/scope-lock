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
  city?: string;
  state_code?: string;
  postcode?: string;
  formatted?: string;
};

function resultToSuggestion(r: GeoapifyJsonResult, index: number): JobSiteAddressSuggestion | null {
  const formatted = (r.formatted ?? '').trim();
  const line1 = (r.address_line1 ?? '').trim();
  const street =
    line1 ||
    (formatted.includes(',') ? formatted.split(',')[0]?.trim() ?? '' : formatted) ||
    '';
  if (!street) return null;
  const city = (r.city ?? '').trim();
  const state = (r.state_code ?? '').trim();
  const zip = (r.postcode ?? '').trim();
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
  apiKey: string
): Promise<JobSiteAddressSuggestion[]> {
  const trimmed = text.trim();
  if (trimmed.length < 3 || !apiKey) return [];

  const url = new URL('https://api.geoapify.com/v1/geocode/autocomplete');
  url.searchParams.set('text', trimmed);
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

  if (import.meta.env.DEV) {
    console.log('[Geoapify] autocomplete data.results', data.results);
  }

  const raw = Array.isArray(data.results) ? data.results : [];
  const out: JobSiteAddressSuggestion[] = [];
  for (let i = 0; i < raw.length && out.length < 5; i++) {
    const s = resultToSuggestion(raw[i], i);
    if (s) out.push(s);
  }
  return out;
}
