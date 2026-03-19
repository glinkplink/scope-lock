import { useEffect, useRef, useState } from 'react';
import type { WelderJob, JobClassification, MaterialsProvider, PriceType } from '../types';

interface JobFormProps {
  job: WelderJob;
  onChange: (job: WelderJob) => void;
}

export function JobForm({ job, onChange }: JobFormProps) {
  const [rawPrice, setRawPrice] = useState(() => (job.price === 0 ? '' : String(job.price)));
  const [rawDeposit, setRawDeposit] = useState(() => (job.deposit_amount === 0 ? '' : String(job.deposit_amount)));
  const [rawWarranty, setRawWarranty] = useState(() =>
    job.workmanship_warranty_days === 0 ? '' : String(job.workmanship_warranty_days)
  );
  const [rawNegotiation, setRawNegotiation] = useState(() =>
    job.negotiation_period === 0 ? '' : String(job.negotiation_period)
  );

  const skipSyncRef = useRef(false);
  const wasStateAutoDetectedRef = useRef(true);

  useEffect(() => {
    if (skipSyncRef.current) {
      skipSyncRef.current = false;
      return;
    }
    const nextPrice = job.price === 0 ? '' : String(job.price);
    const nextDeposit = job.deposit_amount === 0 ? '' : String(job.deposit_amount);
    const nextWarranty = job.workmanship_warranty_days === 0 ? '' : String(job.workmanship_warranty_days);
    const nextNegotiation = job.negotiation_period === 0 ? '' : String(job.negotiation_period);
    Promise.resolve().then(() => {
      setRawPrice(nextPrice);
      setRawDeposit(nextDeposit);
      setRawWarranty(nextWarranty);
      setRawNegotiation(nextNegotiation);
    });
  }, [job.price, job.deposit_amount, job.workmanship_warranty_days, job.negotiation_period]);

  // Auto-detect governing state from job_location
  useEffect(() => {
    if (!wasStateAutoDetectedRef.current) return;
    const match = job.job_location.match(/,\s*([A-Z]{2})\s*\d{5}|,\s*([A-Z]{2})\s*$/);
    const detected = match ? (match[1] || match[2]) : null;
    if (detected && detected !== job.governing_state) {
      onChange({ ...job, governing_state: detected });
    }
  }, [job.job_location]); // eslint-disable-line react-hooks/exhaustive-deps

  const updateField = <K extends keyof WelderJob>(field: K, value: WelderJob[K]) => {
    onChange({ ...job, [field]: value });
  };

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

  const handleGoverningStateChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    wasStateAutoDetectedRef.current = false;
    updateField('governing_state', e.target.value.toUpperCase().slice(0, 2));
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
      {/* 1. Parties & Project Information */}
      <section className="form-section">
        <h2>1. Parties &amp; Project Information</h2>
        <div className="form-group">
          <label htmlFor="agreement_date">Agreement Date *</label>
          <input
            id="agreement_date"
            type="date"
            value={job.agreement_date}
            onChange={(e) => updateField('agreement_date', e.target.value)}
            required
          />
        </div>
        <div className="form-group">
          <label htmlFor="customer_name">Customer Name *</label>
          <input
            id="customer_name"
            type="text"
            value={job.customer_name}
            onChange={(e) => updateField('customer_name', e.target.value)}
            required
            placeholder="John Smith"
          />
        </div>
        <div className="form-group">
          <label htmlFor="customer_phone">Customer Phone *</label>
          <input
            id="customer_phone"
            type="tel"
            value={job.customer_phone}
            onChange={(e) => updateField('customer_phone', e.target.value)}
            required
            placeholder="(555) 123-4567"
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
        <div className="form-group">
          <label htmlFor="job_location">Job Site / Address *</label>
          <textarea
            id="job_location"
            value={job.job_location}
            onChange={(e) => updateField('job_location', e.target.value)}
            required
            placeholder="123 Main Street, Austin, TX 78701"
            rows={2}
          />
        </div>
        <div className="form-group">
          <label htmlFor="governing_state">Governing State</label>
          <input
            id="governing_state"
            type="text"
            value={job.governing_state}
            onChange={handleGoverningStateChange}
            placeholder="TX"
            maxLength={2}
            style={{ textTransform: 'uppercase', maxWidth: '80px' }}
          />
        </div>
      </section>

      {/* 2. Project Overview */}
      <section className="form-section">
        <h2>2. Project Overview</h2>
        <div className="form-group">
          <label htmlFor="job_classification">Job Classification *</label>
          <select
            id="job_classification"
            value={job.job_classification}
            onChange={(e) => updateField('job_classification', e.target.value as JobClassification)}
            required
          >
            <option value="repair">Repair</option>
            <option value="fabrication">Fabrication</option>
            <option value="installation">Installation</option>
            <option value="maintenance">Maintenance</option>
            <option value="other">Other</option>
          </select>
        </div>
        {job.job_classification === 'other' && (
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
          <label htmlFor="asset_or_item_description">Item / Asset Description *</label>
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
          <label htmlFor="requested_work">Requested Work *</label>
          <textarea
            id="requested_work"
            value={job.requested_work}
            onChange={(e) => updateField('requested_work', e.target.value)}
            required
            placeholder="Repair cracked weld joints and reinforce connections"
            rows={3}
          />
        </div>
        <div className="form-row">
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
        </div>
      </section>

      {/* 3. Scope of Work */}
      <section className="form-section">
        <h2>3. Scope of Work</h2>
        <div className="form-group">
          <label htmlFor="materials_provided_by">Materials Provided By *</label>
          <select
            id="materials_provided_by"
            value={job.materials_provided_by}
            onChange={(e) => updateField('materials_provided_by', e.target.value as MaterialsProvider)}
            required
          >
            <option value="welder">Service Provider (You)</option>
            <option value="customer">Customer</option>
            <option value="mixed">Mixed</option>
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

      {/* 4. Exclusions */}
      <section className="form-section">
        <h2>4. Exclusions</h2>
        <p className="help-text">List what is NOT included in this job</p>
        {job.exclusions.map((exclusion, index) => (
          <div key={`exclusion-${index}`} className="list-item">
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

      {/* 5. Customer Obligations & Site Conditions */}
      <section className="form-section">
        <h2>5. Customer Obligations &amp; Site Conditions</h2>
        <p className="help-text">What the customer must provide or ensure before work begins</p>
        {job.customer_obligations.map((obligation, index) => (
          <div key={`obligation-${index}`} className="list-item">
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

      {/* 6. Pricing & Payment Terms */}
      <section className="form-section">
        <h2>6. Pricing &amp; Payment Terms</h2>
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
              min="0"
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
            placeholder="Balances unpaid 7 days after completion accrue 1.5% per month"
          />
        </div>
      </section>

      {/* 7. Change Orders */}
      <section className="form-section">
        <h2>7. Change Orders</h2>
        <div className="checkbox-group">
          <label className="checkbox-label">
            <input
              type="checkbox"
              checked={job.change_order_required}
              onChange={(e) => updateField('change_order_required', e.target.checked)}
            />
            <span>Require Change Order for Extra Work</span>
          </label>
        </div>
      </section>

      {/* 8. Hidden Damage */}
      <section className="form-section">
        <h2>8. Hidden Damage</h2>
        <div className="checkbox-group">
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

      {/* 10 / 14 */}
      <section className="form-section">
        <h2>10. Workmanship Warranty / 14. Dispute Resolution</h2>
        <div className="form-row">
          <div className="form-group">
            <label htmlFor="workmanship_warranty_days">
              Workmanship Warranty (Days)
            </label>
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
            <label htmlFor="negotiation_period">
              Negotiation Period (Days)
            </label>
            <input
              id="negotiation_period"
              type="number"
              value={rawNegotiation}
              onChange={handleNegotiationChange}
              min="1"
              placeholder="10"
            />
            <p className="help-text">Good-faith negotiation window before formal dispute process</p>
          </div>
        </div>
      </section>
    </form>
  );
}
