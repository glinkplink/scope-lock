import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import type { WelderJob, JobType, MaterialsProvider, PriceType } from '../types';
import type { Client } from '../types/db';
import { searchClients } from '../lib/db/clients';
import {
  formatJobSiteAddress,
  governingStateFromSiteState,
  parseStoredJobSiteAddress,
  tryParseUsAddressBlob,
} from '../lib/job-site-address';
import {
  fetchGeoapifyAddressSuggestions,
  type JobSiteAddressSuggestion,
} from '../lib/geoapify-autocomplete';
import { formatUsPhoneInput } from '../lib/us-phone-input';

function patchJobSite(
  base: WelderJob,
  p: Partial<Pick<WelderJob, 'job_site_street' | 'job_site_city' | 'job_site_state' | 'job_site_zip'>>
): WelderJob {
  const next = { ...base, ...p };
  const job_location = formatJobSiteAddress({
    street: next.job_site_street,
    city: next.job_site_city,
    state: next.job_site_state,
    zip: next.job_site_zip,
  });
  return {
    ...next,
    job_location,
    governing_state: governingStateFromSiteState(next.job_site_state),
  };
}

interface JobFormProps {
  userId?: string;
  job: WelderJob;
  onChange: (job: WelderJob) => void;
  /** Shown for the "materials provided by welder" option (profile business name). */
  businessName?: string | null;
  /** Opens agreement preview (e.g. switches to Preview tab and scrolls to top). */
  onGoToPreview?: () => void;
}

export function JobForm({ userId, job, onChange, businessName, onGoToPreview }: JobFormProps) {
  const materialsWelderLabel = businessName?.trim() || 'Service Provider';
  const [rawPrice, setRawPrice] = useState(() => (job.price === 0 ? '' : String(job.price)));
  const [rawDeposit, setRawDeposit] = useState(() => (job.deposit_amount === 0 ? '' : String(job.deposit_amount)));
  const [rawWarranty, setRawWarranty] = useState(() =>
    String(job.workmanship_warranty_days ?? 0)
  );
  const [rawNegotiation, setRawNegotiation] = useState(() =>
    String(job.negotiation_period ?? 0)
  );

  const skipSyncRef = useRef(false);

  const updateField = <K extends keyof WelderJob>(field: K, value: WelderJob[K]) => {
    onChange({ ...job, [field]: value });
  };

  const customerNameRef = useRef(job.customer_name);
  useLayoutEffect(() => {
    customerNameRef.current = job.customer_name;
  });

  const comboboxId = useId();
  const listboxId = `${comboboxId}-client-listbox`;
  const siteComboboxId = useId();
  const siteListboxId = `${siteComboboxId}-job-site-listbox`;
  const geoapifyApiKey = (import.meta.env.VITE_GEOAPIFY_API_KEY as string | undefined)?.trim() ?? '';

  const [clientMatches, setClientMatches] = useState<Client[]>([]);
  const [clientListOpen, setClientListOpen] = useState(false);
  const [clientHighlightIndex, setClientHighlightIndex] = useState(-1);
  const [clientSearchLoading, setClientSearchLoading] = useState(false);
  const [dropdownSuppressed, setDropdownSuppressed] = useState(false);

  const customerNameComboboxRef = useRef<HTMLDivElement>(null);
  const customerNameBlurCloseTimerRef = useRef<ReturnType<typeof window.setTimeout> | null>(null);
  const jobSiteStreetComboboxRef = useRef<HTMLDivElement>(null);
  const jobSiteStreetQueryRef = useRef(job.job_site_street);
  const jobSiteStreetBlurCloseTimerRef = useRef<ReturnType<typeof window.setTimeout> | null>(null);
  /** Only the latest autocomplete request may apply results (avoids stale short-query responses clearing longer-query UI). */
  const geoFetchSeqRef = useRef(0);

  const [userCoords, setUserCoords] = useState<{ lat: number; lng: number } | undefined>();
  const [geoMatches, setGeoMatches] = useState<JobSiteAddressSuggestion[]>([]);
  const [geoHighlightIndex, setGeoHighlightIndex] = useState(-1);
  const [geoSearchLoading, setGeoSearchLoading] = useState(false);
  const [geoDropdownSuppressed, setGeoDropdownSuppressed] = useState(false);

  useLayoutEffect(() => {
    jobSiteStreetQueryRef.current = job.job_site_street;
  });

  useEffect(() => {
    if (typeof navigator === 'undefined' || !navigator.geolocation) {
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (pos) => setUserCoords({ lat: pos.coords.latitude, lng: pos.coords.longitude }),
      () => {}
    );
  }, []);

  useEffect(() => {
    if (dropdownSuppressed) {
      const id = window.setTimeout(() => {
        setClientMatches([]);
        setClientListOpen(false);
        setClientHighlightIndex(-1);
        setClientSearchLoading(false);
      }, 0);
      return () => window.clearTimeout(id);
    }

    const trimmed = job.customer_name.trim();
    if (!trimmed) {
      const id = window.setTimeout(() => {
        setClientMatches([]);
        setClientListOpen(false);
        setClientHighlightIndex(-1);
        setClientSearchLoading(false);
      }, 0);
      return () => window.clearTimeout(id);
    }

    const id = window.setTimeout(() => {
      const q = customerNameRef.current.trim();
      if (!q) {
        setClientMatches([]);
        setClientListOpen(false);
        setClientHighlightIndex(-1);
        setClientSearchLoading(false);
        return;
      }

      if (!userId) {
        setClientMatches([]);
        setClientListOpen(false);
        setClientHighlightIndex(-1);
        setClientSearchLoading(false);
        return;
      }

      setClientSearchLoading(true);
      void searchClients(userId, q).then((rows) => {
        if (customerNameRef.current.trim() !== q) {
          setClientSearchLoading(false);
          return;
        }
        setClientSearchLoading(false);
        setClientMatches(rows);
        setClientListOpen(rows.length > 0);
        setClientHighlightIndex(rows.length > 0 ? 0 : -1);
      });
    }, 300);

    return () => window.clearTimeout(id);
  }, [job.customer_name, userId, dropdownSuppressed]);

  useEffect(() => {
    const onDocMouseDown = (e: MouseEvent) => {
      const t = e.target instanceof Node ? e.target : null;
      if (t && customerNameComboboxRef.current?.contains(t)) return;
      setClientListOpen(false);
      setClientMatches([]);
      setClientHighlightIndex(-1);
      if (t && jobSiteStreetComboboxRef.current?.contains(t)) return;
      setGeoMatches([]);
      setGeoHighlightIndex(-1);
    };
    document.addEventListener('mousedown', onDocMouseDown);
    return () => document.removeEventListener('mousedown', onDocMouseDown);
  }, []);

  useEffect(() => {
    return () => {
      if (customerNameBlurCloseTimerRef.current != null) {
        window.clearTimeout(customerNameBlurCloseTimerRef.current);
      }
      if (jobSiteStreetBlurCloseTimerRef.current != null) {
        window.clearTimeout(jobSiteStreetBlurCloseTimerRef.current);
      }
    };
  }, []);

  useEffect(() => {
    if (geoDropdownSuppressed) {
      const id = window.setTimeout(() => {
        geoFetchSeqRef.current += 1;
        setGeoMatches([]);
        setGeoHighlightIndex(-1);
        setGeoSearchLoading(false);
      }, 0);
      return () => window.clearTimeout(id);
    }

    const trimmed = job.job_site_street.trim();
    if (trimmed.length < 3 || !geoapifyApiKey) {
      const id = window.setTimeout(() => {
        geoFetchSeqRef.current += 1;
        setGeoMatches([]);
        setGeoHighlightIndex(-1);
        setGeoSearchLoading(false);
      }, 0);
      return () => window.clearTimeout(id);
    }

    const id = window.setTimeout(() => {
      const q = jobSiteStreetQueryRef.current.trim();
      if (q.length < 3) {
        geoFetchSeqRef.current += 1;
        setGeoMatches([]);
        setGeoHighlightIndex(-1);
        setGeoSearchLoading(false);
        return;
      }

      const fetchSeq = ++geoFetchSeqRef.current;
      setGeoSearchLoading(true);
      void fetchGeoapifyAddressSuggestions(q, geoapifyApiKey, userCoords)
        .then((rows) => {
          if (fetchSeq !== geoFetchSeqRef.current) {
            return;
          }
          setGeoSearchLoading(false);
          setGeoMatches(rows);
          setGeoHighlightIndex(rows.length > 0 ? 0 : -1);
        })
        .catch(() => {
          if (fetchSeq !== geoFetchSeqRef.current) {
            return;
          }
          setGeoSearchLoading(false);
          setGeoMatches([]);
          setGeoHighlightIndex(-1);
        });
    }, 300);

    return () => window.clearTimeout(id);
  }, [job.job_site_street, geoapifyApiKey, geoDropdownSuppressed, userCoords]);

  const applyGeoSuggestion = (s: JobSiteAddressSuggestion) => {
    onChange(
      patchJobSite(job, {
        job_site_street: s.street,
        job_site_city: s.city,
        job_site_state: s.state,
        job_site_zip: s.zip,
      })
    );
    setGeoMatches([]);
    setGeoHighlightIndex(-1);
    setGeoDropdownSuppressed(true);
    if (jobSiteStreetBlurCloseTimerRef.current != null) {
      window.clearTimeout(jobSiteStreetBlurCloseTimerRef.current);
      jobSiteStreetBlurCloseTimerRef.current = null;
    }
  };

  const handleJobSiteStreetChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setGeoDropdownSuppressed(false);
    onChange(patchJobSite(job, { job_site_street: e.target.value }));
  };

  const handleJobSiteStreetBlur = () => {
    const line = job.job_site_street.trim();
    const parsed = tryParseUsAddressBlob(line);
    if (parsed && parsed.state && parsed.zip) {
      onChange(
        patchJobSite(job, {
          job_site_street: parsed.street,
          job_site_city: parsed.city || job.job_site_city,
          job_site_state: parsed.state,
          job_site_zip: parsed.zip,
        })
      );
    }

    if (jobSiteStreetBlurCloseTimerRef.current != null) {
      window.clearTimeout(jobSiteStreetBlurCloseTimerRef.current);
    }
    jobSiteStreetBlurCloseTimerRef.current = window.setTimeout(() => {
      jobSiteStreetBlurCloseTimerRef.current = null;
      const root = jobSiteStreetComboboxRef.current;
      if (root?.contains(document.activeElement)) {
        return;
      }
      setGeoMatches([]);
      setGeoHighlightIndex(-1);
    }, 120);
  };

  const handleJobSiteStreetKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (geoMatches.length === 0) {
      return;
    }

    if (e.key === 'Escape') {
      e.preventDefault();
      setGeoMatches([]);
      setGeoHighlightIndex(-1);
      return;
    }

    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setGeoHighlightIndex((i) => {
        const next = i < 0 ? 0 : i + 1;
        return next >= geoMatches.length ? 0 : next;
      });
      return;
    }

    if (e.key === 'ArrowUp') {
      e.preventDefault();
      setGeoHighlightIndex((i) => {
        if (i <= 0) return geoMatches.length - 1;
        return i - 1;
      });
      return;
    }

    if (e.key === 'Enter') {
      const idx = geoHighlightIndex;
      if (idx >= 0 && idx < geoMatches.length) {
        e.preventDefault();
        applyGeoSuggestion(geoMatches[idx]);
      }
    }
  };

  const applyClient = (client: Client) => {
    const patches: Partial<WelderJob> = {};
    const name = client.name?.trim();
    if (name) patches.customer_name = name;
    const phone = client.phone?.trim();
    if (phone) patches.customer_phone = formatUsPhoneInput(phone);
    const email = client.email?.trim();
    if (email) patches.customer_email = email;
    let next: WelderJob = { ...job, ...patches };
    const address = client.address?.trim();
    if (address) {
      const parts = parseStoredJobSiteAddress(address);
      next = patchJobSite(next, {
        job_site_street: parts.street,
        job_site_city: parts.city,
        job_site_state: parts.state,
        job_site_zip: parts.zip,
      });
    }
    onChange(next);
    setClientListOpen(false);
    setClientMatches([]);
    setClientHighlightIndex(-1);
    setDropdownSuppressed(true);
    if (customerNameBlurCloseTimerRef.current != null) {
      window.clearTimeout(customerNameBlurCloseTimerRef.current);
      customerNameBlurCloseTimerRef.current = null;
    }
  };

  const handleCustomerNameChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setDropdownSuppressed(false);
    updateField('customer_name', e.target.value);
  };

  const handleCustomerNameBlur = () => {
    if (customerNameBlurCloseTimerRef.current != null) {
      window.clearTimeout(customerNameBlurCloseTimerRef.current);
    }
    customerNameBlurCloseTimerRef.current = window.setTimeout(() => {
      customerNameBlurCloseTimerRef.current = null;
      const root = customerNameComboboxRef.current;
      if (root?.contains(document.activeElement)) {
        return;
      }
      setClientListOpen(false);
      setClientMatches([]);
      setClientHighlightIndex(-1);
    }, 120);
  };

  const handleCustomerNameKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (!clientListOpen || clientMatches.length === 0) {
      return;
    }

    if (e.key === 'Escape') {
      e.preventDefault();
      setClientListOpen(false);
      setClientMatches([]);
      setClientHighlightIndex(-1);
      return;
    }

    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setClientHighlightIndex((i) => {
        const next = i < 0 ? 0 : i + 1;
        return next >= clientMatches.length ? 0 : next;
      });
      return;
    }

    if (e.key === 'ArrowUp') {
      e.preventDefault();
      setClientHighlightIndex((i) => {
        if (i <= 0) return clientMatches.length - 1;
        return i - 1;
      });
      return;
    }

    if (e.key === 'Enter') {
      const idx = clientHighlightIndex;
      if (idx >= 0 && idx < clientMatches.length) {
        e.preventDefault();
        applyClient(clientMatches[idx]);
      }
    }
  };

  useEffect(() => {
    if (skipSyncRef.current) {
      skipSyncRef.current = false;
      return;
    }
    const nextPrice = job.price === 0 ? '' : String(job.price);
    const nextDeposit = job.deposit_amount === 0 ? '' : String(job.deposit_amount);
    const nextWarranty = String(job.workmanship_warranty_days ?? 0);
    const nextNegotiation = String(job.negotiation_period ?? 0);
    Promise.resolve().then(() => {
      setRawPrice(nextPrice);
      setRawDeposit(nextDeposit);
      setRawWarranty(nextWarranty);
      setRawNegotiation(nextNegotiation);
    });
  }, [job.price, job.deposit_amount, job.workmanship_warranty_days, job.negotiation_period]);

  const handlePriceChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const raw = e.target.value;
    setRawPrice(raw);
    skipSyncRef.current = true;
    updateField('price', parseFloat(raw) || 0);
  };

  const handleDepositChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const raw = e.target.value;
    setRawDeposit(raw);
    skipSyncRef.current = true;
    updateField('deposit_amount', parseFloat(raw) || 0);
  };

  const handleWarrantyChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const raw = e.target.value;
    setRawWarranty(raw);
    skipSyncRef.current = true;
    updateField('workmanship_warranty_days', parseInt(raw) || 0);
  };

  const handleNegotiationChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const raw = e.target.value;
    setRawNegotiation(raw);
    skipSyncRef.current = true;
    updateField('negotiation_period', parseInt(raw) || 0);
  };

  const addExclusion = () => updateField('exclusions', [...job.exclusions, '']);
  const updateExclusion = (index: number, value: string) => {
    const next = [...job.exclusions];
    next[index] = value;
    updateField('exclusions', next);
  };
  const removeExclusion = (index: number) =>
    updateField('exclusions', job.exclusions.filter((_, i) => i !== index));

  const addObligation = () => updateField('customer_obligations', [...job.customer_obligations, '']);
  const updateObligation = (index: number, value: string) => {
    const next = [...job.customer_obligations];
    next[index] = value;
    updateField('customer_obligations', next);
  };
  const removeObligation = (index: number) =>
    updateField('customer_obligations', job.customer_obligations.filter((_, i) => i !== index));

  return (
    <form className="job-form" onSubmit={(e) => e.preventDefault()}>
      {/* Parties & Project Information */}
      <section className="form-section">
        <h2>Parties &amp; Project Information</h2>
        <div className="form-group">
          <label htmlFor="agreement_date">Agreement Date</label>
          <input
            id="agreement_date"
            type="date"
            value={job.agreement_date}
            onChange={(e) => updateField('agreement_date', e.target.value)}
          />
        </div>
        <div className="form-group form-group-combobox" ref={customerNameComboboxRef}>
          <label htmlFor="customer_name">Customer Name *</label>
          <div className="customer-name-combobox">
            <input
              id="customer_name"
              type="text"
              role="combobox"
              aria-expanded={clientListOpen}
              aria-controls={listboxId}
              aria-autocomplete="list"
              aria-activedescendant={
                clientListOpen && clientHighlightIndex >= 0 && clientMatches[clientHighlightIndex]
                  ? `${listboxId}-option-${clientMatches[clientHighlightIndex].id}`
                  : undefined
              }
              value={job.customer_name}
              onChange={handleCustomerNameChange}
              onBlur={handleCustomerNameBlur}
              onKeyDown={handleCustomerNameKeyDown}
              autoComplete="off"
              required
              placeholder="John Smith"
            />
            {clientSearchLoading && (
              <span className="customer-name-combobox-status" aria-live="polite">
                Searching…
              </span>
            )}
            {clientListOpen && clientMatches.length > 0 && (
              <ul id={listboxId} className="customer-name-listbox" role="listbox">
                {clientMatches.map((c, index) => (
                  <li
                    key={c.id}
                    id={`${listboxId}-option-${c.id}`}
                    role="option"
                    aria-selected={index === clientHighlightIndex}
                    className={
                      index === clientHighlightIndex
                        ? 'customer-name-option customer-name-option-active'
                        : 'customer-name-option'
                    }
                    onMouseDown={(e) => {
                      e.preventDefault();
                      applyClient(c);
                    }}
                    onMouseEnter={() => setClientHighlightIndex(index)}
                  >
                    <span className="customer-name-option-name">{c.name}</span>
                    {(c.phone || c.email) && (
                      <span className="customer-name-option-meta">
                        {[c.phone, c.email].filter(Boolean).join(' · ')}
                      </span>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
        <div className="form-group">
          <label htmlFor="customer_phone">Customer Phone</label>
          <input
            id="customer_phone"
            type="tel"
            inputMode="numeric"
            autoComplete="tel"
            value={formatUsPhoneInput(job.customer_phone ?? '')}
            onChange={(e) => updateField('customer_phone', formatUsPhoneInput(e.target.value))}
            placeholder="(571) 473-1291"
          />
        </div>
        <div className="form-group">
          <label htmlFor="customer_email">Customer Email</label>
          <input
            id="customer_email"
            type="email"
            value={job.customer_email}
            onChange={(e) => updateField('customer_email', e.target.value)}
            placeholder="customer@example.com"
          />
        </div>
        <div className="form-group form-group-combobox" ref={jobSiteStreetComboboxRef}>
          <label htmlFor="job_site_street">Job Site Address *</label>
          <div className="job-site-street-combobox">
            <input
              id="job_site_street"
              type="text"
              role="combobox"
              aria-expanded={geoMatches.length > 0}
              aria-controls={siteListboxId}
              aria-autocomplete="list"
              aria-activedescendant={
                geoMatches.length > 0 && geoHighlightIndex >= 0 && geoMatches[geoHighlightIndex]
                  ? `${siteListboxId}-option-${geoHighlightIndex}`
                  : undefined
              }
              value={job.job_site_street}
              onChange={handleJobSiteStreetChange}
              onBlur={handleJobSiteStreetBlur}
              onKeyDown={handleJobSiteStreetKeyDown}
              autoComplete="address-line1"
              required
              placeholder="123 Main Street"
            />
            {geoSearchLoading && (
              <span className="customer-name-combobox-status" aria-live="polite">
                Searching…
              </span>
            )}
            {geoMatches.length > 0 && (
              <ul id={siteListboxId} className="job-site-street-listbox" role="listbox">
                {geoMatches.map((s, index) => (
                  <li
                    key={s.id}
                    id={`${siteListboxId}-option-${index}`}
                    role="option"
                    aria-selected={index === geoHighlightIndex}
                    className={
                      index === geoHighlightIndex
                        ? 'job-site-street-option job-site-street-option-active'
                        : 'job-site-street-option'
                    }
                    onMouseDown={(e) => {
                      e.preventDefault();
                      applyGeoSuggestion(s);
                    }}
                    onMouseEnter={() => setGeoHighlightIndex(index)}
                  >
                    <span className="job-site-street-option-label">{s.label}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
        <div className="form-row form-row--job-site-locality">
          <div className="form-group">
            <label htmlFor="job_site_city">City</label>
            <input
              id="job_site_city"
              type="text"
              autoComplete="address-level2"
              value={job.job_site_city}
              onChange={(e) => onChange(patchJobSite(job, { job_site_city: e.target.value }))}
              placeholder="Austin"
            />
          </div>
          <div className="form-group">
            <label htmlFor="job_site_state">State</label>
            <input
              id="job_site_state"
              type="text"
              autoComplete="address-level1"
              value={job.job_site_state}
              onChange={(e) => onChange(patchJobSite(job, { job_site_state: e.target.value }))}
              placeholder="TX"
            />
          </div>
          <div className="form-group">
            <label htmlFor="job_site_zip">ZIP</label>
            <input
              id="job_site_zip"
              type="text"
              inputMode="numeric"
              autoComplete="postal-code"
              value={job.job_site_zip}
              onChange={(e) => onChange(patchJobSite(job, { job_site_zip: e.target.value }))}
              placeholder="78701"
            />
          </div>
        </div>
      </section>

      {/* Project Overview */}
      <section className="form-section">
        <h2>Project Overview</h2>
        <div className="form-group">
          <label htmlFor="job_type">Job type *</label>
          <select
            id="job_type"
            value={job.job_type}
            onChange={(e) => updateField('job_type', e.target.value as JobType)}
            required
          >
            <option value="repair">Repair</option>
            <option value="fabrication">Fabrication</option>
            <option value="installation">Installation</option>
            <option value="maintenance">Maintenance</option>
            <option value="other">Other</option>
          </select>
        </div>
        {job.job_type === 'other' && (
          <div className="form-group">
            <label htmlFor="other_classification">Specify</label>
            <input
              id="other_classification"
              type="text"
              value={job.other_classification ?? ''}
              onChange={(e) => updateField('other_classification', e.target.value)}
              placeholder="Enter custom classification"
            />
          </div>
        )}
        <div className="form-group">
          <label htmlFor="asset_or_item_description">Item / Structure *</label>
          <textarea
            id="asset_or_item_description"
            value={job.asset_or_item_description}
            onChange={(e) => updateField('asset_or_item_description', e.target.value)}
            required
            placeholder="Steel deck railing with loose connections"
            rows={2}
          />
        </div>
        <div className="form-group">
          <label htmlFor="requested_work">Work Requested *</label>
          <textarea
            id="requested_work"
            value={job.requested_work}
            onChange={(e) => updateField('requested_work', e.target.value)}
            required
            placeholder="Repair cracked weld joints and reinforce connections"
            rows={3}
          />
        </div>
        <div className="form-group">
          <label htmlFor="target_start">Target Start Date</label>
          <input
            id="target_start"
            type="date"
            value={job.target_start}
            onChange={(e) => updateField('target_start', e.target.value)}
          />
        </div>
        <div className="form-group">
          <label htmlFor="target_completion_date">Target Completion Date</label>
          <input
            id="target_completion_date"
            type="date"
            value={job.target_completion_date}
            onChange={(e) => updateField('target_completion_date', e.target.value)}
          />
        </div>
      </section>

      {/* Scope of Work */}
      <section className="form-section">
        <h2>Scope of Work</h2>
        <div className="form-group">
          <label htmlFor="materials_provided_by">Materials Provided By</label>
          <select
            id="materials_provided_by"
            value={job.materials_provided_by}
            onChange={(e) => updateField('materials_provided_by', e.target.value as MaterialsProvider)}
          >
            <option value="welder">{materialsWelderLabel}</option>
            <option value="customer">Customer</option>
          </select>
        </div>
        <div className="checkbox-group">
          <label className="checkbox-label">
            <input
              type="checkbox"
              checked={job.installation_included}
              onChange={(e) => updateField('installation_included', e.target.checked)}
            />
            <span>Installation Included</span>
          </label>
          <label className="checkbox-label">
            <input
              type="checkbox"
              checked={job.grinding_included}
              onChange={(e) => updateField('grinding_included', e.target.checked)}
            />
            <span>Grinding Included</span>
          </label>
          <label className="checkbox-label">
            <input
              type="checkbox"
              checked={job.paint_or_coating_included}
              onChange={(e) => updateField('paint_or_coating_included', e.target.checked)}
            />
            <span>Paint / Coating Included</span>
          </label>
          <label className="checkbox-label">
            <input
              type="checkbox"
              checked={job.removal_or_disassembly_included}
              onChange={(e) => updateField('removal_or_disassembly_included', e.target.checked)}
            />
            <span>Removal / Disassembly Included</span>
          </label>
        </div>
      </section>

      {/* Exclusions */}
      <section className="form-section">
        <h2>Exclusions</h2>
        <p className="help-text">List what is NOT included in this job</p>
        {job.exclusions.map((exclusion, index) => (
          <div key={`exclusion-${index}`} className="list-item">
            <textarea
              id={`exclusion-${index}`}
              rows={2}
              value={exclusion}
              onChange={(e) => updateExclusion(index, e.target.value)}
              placeholder="e.g., Painting or powder coating"
            />
            <button
              type="button"
              className="btn-remove"
              onClick={() => removeExclusion(index)}
              aria-label="Remove exclusion"
            >
              ×
            </button>
          </div>
        ))}
        <button type="button" className="btn-add" onClick={addExclusion}>
          + Add Exclusion
        </button>
      </section>

      {/* Customer Obligations & Site Conditions */}
      <section className="form-section">
        <h2>Customer Obligations &amp; Site Conditions</h2>
        <p className="help-text">What the customer must provide or ensure before work begins</p>
        {job.customer_obligations.map((obligation, index) => (
          <div key={`obligation-${index}`} className="list-item">
            <textarea
              id={`obligation-${index}`}
              rows={2}
              value={obligation}
              onChange={(e) => updateObligation(index, e.target.value)}
              placeholder="e.g., Customer will provide clear access to work area"
            />
            <button
              type="button"
              className="btn-remove"
              onClick={() => removeObligation(index)}
              aria-label="Remove obligation"
            >
              ×
            </button>
          </div>
        ))}
        <button type="button" className="btn-add" onClick={addObligation}>
          + Add Obligation
        </button>
      </section>

      {/* Pricing & Payment Terms */}
      <section className="form-section">
        <h2>Pricing &amp; Payment Terms</h2>
        <div className="form-group">
          <label htmlFor="price_type">Price Type *</label>
          <select
            id="price_type"
            value={job.price_type}
            onChange={(e) => updateField('price_type', e.target.value as PriceType)}
            required
          >
            <option value="fixed">Fixed Price</option>
            <option value="estimate">Estimate</option>
            <option value="time_and_materials">Time &amp; Materials</option>
          </select>
        </div>
        <div className="form-row">
          <div className="form-group">
            <label htmlFor="price">Total Price ($) *</label>
            <input
              id="price"
              type="number"
              value={rawPrice}
              onChange={handlePriceChange}
              required
              min="0.01"
              step="0.01"
              placeholder="0.00"
            />
          </div>
          <div className="form-group">
            <label htmlFor="deposit_amount">Deposit Amount ($)</label>
            <input
              id="deposit_amount"
              type="number"
              value={rawDeposit}
              onChange={handleDepositChange}
              min="0"
              step="0.01"
              placeholder="0.00"
            />
          </div>
        </div>
        <div className="form-group">
          <label htmlFor="late_payment_terms">Late Payment Terms</label>
          <textarea
            id="late_payment_terms"
            value={job.late_payment_terms}
            onChange={(e) => updateField('late_payment_terms', e.target.value)}
            rows={2}
              placeholder="Balances unpaid 7 days after completion accrue 1.5% per month."
          />
        </div>
      </section>

      {/* Change Orders & Hidden Damage — matches consolidated agreement section */}
      <section className="form-section">
        <h2>Change Orders &amp; Hidden Damage</h2>
        <div className="checkbox-group">
          <label className="checkbox-label checkbox-label-nowrap">
            <input
              type="checkbox"
              checked={job.change_order_required}
              onChange={(e) => updateField('change_order_required', e.target.checked)}
            />
            <span>Require Change Order for Extra Work</span>
          </label>
          <label className="checkbox-label">
            <input
              type="checkbox"
              checked={job.hidden_damage_possible}
              onChange={(e) => updateField('hidden_damage_possible', e.target.checked)}
            />
            <span>Hidden Damage Possible</span>
          </label>
        </div>
      </section>

      <section className="form-section">
        <h2>Workmanship Warranty &amp; Dispute Resolution</h2>
        <div className="form-group">
          <label htmlFor="workmanship_warranty_days">
            Workmanship Warranty (Days)
          </label>
          <p className="help-text help-text-italic help-text-below-label">
            If no warranty, enter 0 and the section will be omitted.
          </p>
          <input
            id="workmanship_warranty_days"
            type="number"
            value={rawWarranty}
            onChange={handleWarrantyChange}
            min="0"
            placeholder="30"
          />
        </div>
        <div className="form-group">
          <label htmlFor="negotiation_period">Negotiation Period (Days)</label>
          <p className="help-text help-text-italic help-text-below-label">
            If no negotiations, enter 0 and the section will be omitted.
          </p>
          <input
            id="negotiation_period"
            type="number"
            value={rawNegotiation}
            onChange={handleNegotiationChange}
            min="0"
            placeholder="10"
          />
          <p className="help-text help-text-below-input">
            Good-faith negotiation window before formal dispute process
          </p>
        </div>
      </section>

      {onGoToPreview && (
        <div className="job-form-preview-footer">
          <button type="button" className="btn-action btn-primary" onClick={onGoToPreview}>
            Preview
          </button>
        </div>
      )}
    </form>
  );
}
