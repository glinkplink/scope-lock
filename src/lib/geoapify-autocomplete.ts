export interface JobSiteAddressSuggestion {
  id: string;
  label: string;
  street: string;
  city: string;
  state: string;
  zip: string;
}

type GeoapifyFeature = {
  properties?: Record<string, string | undefined>;
};

function featureToSuggestion(feature: GeoapifyFeature, index: number): JobSiteAddressSuggestion | null {
  const p = feature.properties;
  if (!p) return null;
  const housenumber = (p.housenumber ?? '').trim();
  const streetName = (p.street ?? '').trim();
  const line1 =
    [housenumber, streetName].filter(Boolean).join(' ').trim() ||
    (p.address_line1 ?? '').trim() ||
    (p.formatted ?? '').trim();
  if (!line1) return null;
  const city = (p.city ?? '').trim();
  const state = (p.state_code ?? p.state ?? '').trim();
  const zip = (p.postcode ?? '').trim();
  const label = (p.formatted ?? line1).trim() || line1;
  return {
    id: `geoapify-${index}-${label.slice(0, 48)}`,
    label,
    street: line1,
    city,
    state,
    zip,
  };
}

/** Geoapify Geocoder Autocomplete (US street), raw JSON FeatureCollection. */
export async function fetchGeoapifyAddressSuggestions(
  text: string,
  apiKey: string
): Promise<JobSiteAddressSuggestion[]> {
  const trimmed = text.trim();
  if (trimmed.length < 3 || !apiKey) return [];

  const url = new URL('https://api.geoapify.com/v1/geocode/autocomplete');
  url.searchParams.set('text', trimmed);
  url.searchParams.set('type', 'street');
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

  const data = (await res.json()) as { features?: GeoapifyFeature[] };
  const features = Array.isArray(data.features) ? data.features : [];
  const out: JobSiteAddressSuggestion[] = [];
  for (let i = 0; i < features.length && out.length < 5; i++) {
    const s = featureToSuggestion(features[i], i);
    if (s) out.push(s);
  }
  return out;
}
