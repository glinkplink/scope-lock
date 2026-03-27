import { useState } from 'react';
import { upsertProfile } from '../lib/db/profile';
import { signOut } from '../lib/auth';
import { getDefaultCustomerObligations, getDefaultExclusions } from '../lib/defaults';
import type { BusinessProfile } from '../types/db';
import { PAYMENT_METHOD_OPTIONS, normalizePaymentMethods } from '../lib/payment-methods';
import { DEFAULT_TAX_RATE, normalizeTaxRate, percentValueToTaxRate, taxRateToPercentValue } from '../lib/tax';
import { formatUsPhoneInput } from '../lib/us-phone-input';
import './EditProfilePage.css';

const PAYMENT_TERMS_PRESETS = [7, 14, 30] as const;

function paymentTermsPresetFromDays(days: number): string {
  return (PAYMENT_TERMS_PRESETS as readonly number[]).includes(days) ? `net_${days}` : 'custom';
}

interface EditProfilePageProps {
  profile: BusinessProfile;
  /** Called with the row returned from upsert so parent state updates before any refetch race. */
  onSave: (savedProfile: BusinessProfile | null) => void | Promise<void>;
  onCancel: () => void;
}

export function EditProfilePage({ profile, onSave, onCancel }: EditProfilePageProps) {
  const [businessName, setBusinessName] = useState(profile.business_name);
  const [ownerName, setOwnerName] = useState(profile.owner_name ?? '');
  const [phone, setPhone] = useState(() => formatUsPhoneInput(profile.phone ?? ''));
  const [email, setEmail] = useState(profile.email ?? '');
  const [address, setAddress] = useState(profile.address ?? '');
  const [googleUrl, setGoogleUrl] = useState(profile.google_business_profile_url ?? '');
  const [defaultExclusions, setDefaultExclusions] = useState<string[]>(
    getDefaultExclusions(profile.default_exclusions)
  );
  const [defaultCustomerObligations, setDefaultCustomerObligations] = useState<string[]>(
    getDefaultCustomerObligations(profile.default_assumptions)
  );
  const [defaultWarrantyPeriod, setDefaultWarrantyPeriod] = useState(
    profile.default_warranty_period ?? 30
  );
  const [defaultNegotiationPeriod, setDefaultNegotiationPeriod] = useState(
    profile.default_negotiation_period ?? 10
  );
  const [defaultPaymentMethods, setDefaultPaymentMethods] = useState<string[]>(
    normalizePaymentMethods(profile.default_payment_methods)
  );
  const [defaultTaxRate, setDefaultTaxRate] = useState(
    taxRateToPercentValue(profile.default_tax_rate ?? DEFAULT_TAX_RATE)
  );
  const [defaultPaymentTermsDays, setDefaultPaymentTermsDays] = useState(
    profile.default_payment_terms_days ?? 14
  );
  const [defaultLateFeeRate, setDefaultLateFeeRate] = useState(
    profile.default_late_fee_rate ?? 1.5
  );
  const [paymentTermsPreset, setPaymentTermsPreset] = useState(
    paymentTermsPresetFromDays(profile.default_payment_terms_days ?? 14)
  );
  const [defaultCardFeeNote, setDefaultCardFeeNote] = useState(
    profile.default_card_fee_note ?? false
  );

  const [error, setError] = useState('');
  const [success, setSuccess] = useState(false);
  const [loading, setLoading] = useState(false);

  const addExclusion = () => setDefaultExclusions([...defaultExclusions, '']);
  const updateExclusion = (index: number, value: string) => {
    const updated = [...defaultExclusions];
    updated[index] = value;
    setDefaultExclusions(updated);
  };
  const removeExclusion = (index: number) =>
    setDefaultExclusions(defaultExclusions.filter((_, i) => i !== index));

  const addObligation = () => setDefaultCustomerObligations([...defaultCustomerObligations, '']);
  const updateObligation = (index: number, value: string) => {
    const updated = [...defaultCustomerObligations];
    updated[index] = value;
    setDefaultCustomerObligations(updated);
  };
  const removeObligation = (index: number) =>
    setDefaultCustomerObligations(defaultCustomerObligations.filter((_, i) => i !== index));

  const togglePaymentMethod = (method: string) => {
    setDefaultPaymentMethods((prev) =>
      prev.includes(method) ? prev.filter((m) => m !== method) : [...prev, method]
    );
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setSuccess(false);
    setLoading(true);

    const exclusionsArray = defaultExclusions.filter((s) => s.trim().length > 0);
    const obligationsArray = defaultCustomerObligations.filter((s) => s.trim().length > 0);

    const { data: savedProfile, error } = await upsertProfile({
      user_id: profile.user_id,
      business_name: businessName,
      owner_name: ownerName || null,
      phone: phone.trim() || null,
      email: email || null,
      address: address || null,
      google_business_profile_url: googleUrl || null,
      default_exclusions: exclusionsArray,
      default_assumptions: obligationsArray,
      default_warranty_period: defaultWarrantyPeriod,
      default_negotiation_period: defaultNegotiationPeriod,
      default_payment_methods: normalizePaymentMethods(defaultPaymentMethods),
      default_tax_rate: normalizeTaxRate(percentValueToTaxRate(defaultTaxRate)),
      default_payment_terms_days: defaultPaymentTermsDays,
      default_late_fee_rate: defaultLateFeeRate,
      default_card_fee_note: defaultCardFeeNote,
    });

    setLoading(false);

    if (error) {
      setError(error.message);
    } else {
      setSuccess(true);
      await Promise.resolve(onSave(savedProfile ?? null));
    }
  };

  return (
    <div className="edit-profile-page">
          {success && (
            <div className="success-banner">
              Profile saved successfully!
            </div>
          )}

          <div className="page-header">
            <h1>Edit Profile</h1>
            <p>Update your business details and default settings used in your work orders and invoices.</p>
          </div>

          <form onSubmit={handleSubmit}>
            <section className="form-section">
              <h2>Business Information</h2>

              <div className="form-group">
                <label htmlFor="businessName">Business Name *</label>
                <input
                  id="businessName"
                  type="text"
                  value={businessName}
                  onChange={(e) => setBusinessName(e.target.value)}
                  required
                />
              </div>

              <div className="form-group">
                <label htmlFor="ownerName">Owner / Welder Name</label>
                <input
                  id="ownerName"
                  type="text"
                  value={ownerName}
                  onChange={(e) => setOwnerName(e.target.value)}
                />
              </div>

              <div className="form-group">
                <label htmlFor="phone">Phone Number</label>
                <input
                  id="phone"
                  type="tel"
                  inputMode="numeric"
                  autoComplete="tel"
                  value={phone}
                  onChange={(e) => setPhone(formatUsPhoneInput(e.target.value))}
                  placeholder="(571) 473-1291"
                />
              </div>

              <div className="form-group">
                <label htmlFor="email">Email</label>
                <input
                  id="email"
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                />
              </div>

              <div className="form-group">
                <label htmlFor="address">Business Address</label>
                <textarea
                  id="address"
                  value={address}
                  onChange={(e) => setAddress(e.target.value)}
                  rows={2}
                />
              </div>

              <div className="form-group">
                <label htmlFor="googleUrl">Google Business Profile Link</label>
                <input
                  id="googleUrl"
                  type="url"
                  value={googleUrl}
                  onChange={(e) => setGoogleUrl(e.target.value)}
                  placeholder="https://maps.google.com/..."
                />
              </div>
            </section>

            <section className="form-section">
              <h2>Work Order Defaults</h2>

              <div className="form-group">
                <label>Exclusions</label>
                {defaultExclusions.map((exclusion, index) => (
                  <div key={index} className="list-item-row">
                    <input
                      type="text"
                      value={exclusion}
                      onChange={(e) => updateExclusion(index, e.target.value)}
                      placeholder="e.g., Painting or powder coating"
                    />
                    <button
                      type="button"
                      className="btn-remove"
                      onClick={() => removeExclusion(index)}
                    >
                      ×
                    </button>
                  </div>
                ))}
                <button type="button" className="btn-add" onClick={addExclusion}>
                  + Add Exclusion
                </button>
              </div>

              <div className="form-group">
                <label>Customer Obligations &amp; Site Conditions</label>
                {defaultCustomerObligations.map((obligation, index) => (
                  <div key={index} className="list-item-row">
                    <input
                      type="text"
                      value={obligation}
                      onChange={(e) => updateObligation(index, e.target.value)}
                      placeholder="e.g., Customer will provide clear access to work area"
                    />
                    <button
                      type="button"
                      className="btn-remove"
                      onClick={() => removeObligation(index)}
                    >
                      ×
                    </button>
                  </div>
                ))}
                <button type="button" className="btn-add" onClick={addObligation}>
                  + Add Obligation
                </button>
              </div>

              <div className="form-row">
                <div className="form-group">
                  <label htmlFor="defaultWarrantyPeriod">Warranty Period (Days)</label>
                  <input
                    id="defaultWarrantyPeriod"
                    type="number"
                    value={defaultWarrantyPeriod}
                    onChange={(e) => setDefaultWarrantyPeriod(parseInt(e.target.value) || 0)}
                    min="0"
                    placeholder="30"
                  />
                </div>
                <div className="form-group">
                  <label htmlFor="defaultNegotiationPeriod">Negotiation Period (Days)</label>
                  <input
                    id="defaultNegotiationPeriod"
                    type="number"
                    value={defaultNegotiationPeriod}
                    onChange={(e) => setDefaultNegotiationPeriod(parseInt(e.target.value) || 0)}
                    min="1"
                    placeholder="10"
                  />
                </div>
              </div>

              <div className="form-row">
                <div className="form-group">
                  <label htmlFor="defaultPaymentTerms">Payment Terms</label>
                  <select
                    id="defaultPaymentTerms"
                    value={paymentTermsPreset}
                    onChange={(e) => {
                      const preset = e.target.value;
                      setPaymentTermsPreset(preset);
                      if (preset !== 'custom') {
                        setDefaultPaymentTermsDays(parseInt(preset.replace('net_', ''), 10));
                      }
                    }}
                  >
                    <option value="net_7">Net 7</option>
                    <option value="net_14">Net 14</option>
                    <option value="net_30">Net 30</option>
                    <option value="custom">Custom</option>
                  </select>
                </div>
                {paymentTermsPreset === 'custom' && (
                  <div className="form-group">
                    <label htmlFor="defaultPaymentTermsDays">Days</label>
                    <input
                      id="defaultPaymentTermsDays"
                      type="number"
                      value={defaultPaymentTermsDays}
                      onChange={(e) => setDefaultPaymentTermsDays(parseInt(e.target.value) || 0)}
                      min="1"
                      placeholder="14"
                    />
                  </div>
                )}
                <div className="form-group">
                  <label htmlFor="defaultLateFeeRate">Late Fee (%/month)</label>
                  <input
                    id="defaultLateFeeRate"
                    type="number"
                    value={defaultLateFeeRate}
                    onChange={(e) => setDefaultLateFeeRate(parseFloat(e.target.value) || 0)}
                    min="0"
                    step="0.1"
                    placeholder="1.5"
                  />
                </div>
              </div>
            </section>

            <section className="form-section">
              <h2>Invoice Defaults</h2>

              <div className="form-group">
                <label htmlFor="defaultTaxRate">Tax (%)</label>
                <input
                  id="defaultTaxRate"
                  type="number"
                  min="0"
                  step="0.01"
                  value={defaultTaxRate}
                  onChange={(e) => setDefaultTaxRate(e.target.value)}
                />
              </div>

              <div className="form-group form-group--default-payment-methods">
                <p className="edit-profile-payment-methods-heading" id="edit-profile-payment-methods-heading">
                  Payment Methods
                </p>
                <div
                  className="payment-method-chip-grid"
                  role="group"
                  aria-labelledby="edit-profile-payment-methods-heading"
                >
                  {PAYMENT_METHOD_OPTIONS.map((method) => (
                    <label key={method} className="payment-method-chip">
                      <input
                        type="checkbox"
                        className="payment-method-chip-input"
                        checked={defaultPaymentMethods.includes(method)}
                        onChange={() => togglePaymentMethod(method)}
                      />
                      <span className="payment-method-chip-text">{method}</span>
                    </label>
                  ))}
                </div>
              </div>

              <div className="checkbox-group checkbox-group--inline-row">
                <label className="checkbox-label">
                  <input
                    type="checkbox"
                    checked={defaultCardFeeNote}
                    onChange={(e) => setDefaultCardFeeNote(e.target.checked)}
                  />
                  <span>Include credit card processing fee note (up to 3.5%)</span>
                </label>
              </div>
            </section>

            {error && <div className="error-banner">{error}</div>}

            <div className="form-actions">
              <div className="form-actions-row">
                <button type="submit" className="btn-primary" disabled={loading}>
                  {loading ? 'Saving...' : 'Save Changes'}
                </button>
                <button type="button" className="btn-secondary" onClick={onCancel}>
                  Home
                </button>
              </div>
              <button type="button" className="btn-danger" onClick={() => signOut()}>
                Sign Out
              </button>
            </div>
          </form>

          {success && (
            <div className="success-banner success-bottom">
              Profile saved successfully!
            </div>
          )}
    </div>
  );
}
