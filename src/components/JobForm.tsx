import type { WelderJob, JobType, MaterialsProvider, PriceType } from '../types';

interface JobFormProps {
  job: WelderJob;
  onChange: (job: WelderJob) => void;
}

export function JobForm({ job, onChange }: JobFormProps) {
  const updateField = <K extends keyof WelderJob>(field: K, value: WelderJob[K]) => {
    onChange({ ...job, [field]: value });
  };

  const addExclusion = () => {
    updateField('exclusions', [...job.exclusions, '']);
  };

  const updateExclusion = (index: number, value: string) => {
    const newExclusions = [...job.exclusions];
    newExclusions[index] = value;
    updateField('exclusions', newExclusions);
  };

  const removeExclusion = (index: number) => {
    updateField('exclusions', job.exclusions.filter((_, i) => i !== index));
  };

  const addAssumption = () => {
    updateField('assumptions', [...job.assumptions, '']);
  };

  const updateAssumption = (index: number, value: string) => {
    const newAssumptions = [...job.assumptions];
    newAssumptions[index] = value;
    updateField('assumptions', newAssumptions);
  };

  const removeAssumption = (index: number) => {
    updateField('assumptions', job.assumptions.filter((_, i) => i !== index));
  };

  return (
    <form className="job-form" onSubmit={(e) => e.preventDefault()}>
      <section className="form-section">
        <h2>Customer Information</h2>

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
          <label htmlFor="job_location">Job Location *</label>
          <textarea
            id="job_location"
            value={job.job_location}
            onChange={(e) => updateField('job_location', e.target.value)}
            required
            placeholder="123 Main Street, Austin, TX 78701"
            rows={2}
          />
        </div>
      </section>

      <section className="form-section">
        <h2>Job Details</h2>

        <div className="form-group">
          <label htmlFor="job_type">Job Type *</label>
          <select
            id="job_type"
            value={job.job_type}
            onChange={(e) => updateField('job_type', e.target.value as JobType)}
            required
          >
            <option value="repair">Repair</option>
            <option value="fabrication">Fabrication</option>
            <option value="mobile repair">Mobile Repair</option>
          </select>
        </div>

        <div className="form-group">
          <label htmlFor="asset_or_item_description">Item/Asset Description *</label>
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

        <div className="form-group">
          <label htmlFor="materials_provided_by">Materials Provided By *</label>
          <select
            id="materials_provided_by"
            value={job.materials_provided_by}
            onChange={(e) =>
              updateField('materials_provided_by', e.target.value as MaterialsProvider)
            }
            required
          >
            <option value="welder">Welder (You)</option>
            <option value="customer">Customer</option>
            <option value="mixed">Mixed</option>
          </select>
        </div>
      </section>

      <section className="form-section">
        <h2>Included Services</h2>

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
            <span>Paint/Coating Included</span>
          </label>

          <label className="checkbox-label">
            <input
              type="checkbox"
              checked={job.removal_or_disassembly_included}
              onChange={(e) =>
                updateField('removal_or_disassembly_included', e.target.checked)
              }
            />
            <span>Removal/Disassembly Included</span>
          </label>
        </div>
      </section>

      <section className="form-section">
        <h2>Risk Assessment</h2>

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

      <section className="form-section">
        <h2>Pricing</h2>

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
          </select>
        </div>

        <div className="form-group">
          <label htmlFor="price">Price ($) *</label>
          <input
            id="price"
            type="number"
            value={job.price}
            onChange={(e) => updateField('price', parseFloat(e.target.value) || 0)}
            required
            min="0"
            step="0.01"
            placeholder="450"
          />
        </div>

        <div className="checkbox-group">
          <label className="checkbox-label">
            <input
              type="checkbox"
              checked={job.deposit_required}
              onChange={(e) => updateField('deposit_required', e.target.checked)}
            />
            <span>Deposit Required</span>
          </label>
        </div>

        <div className="form-group">
          <label htmlFor="payment_terms">Payment Terms *</label>
          <textarea
            id="payment_terms"
            value={job.payment_terms}
            onChange={(e) => updateField('payment_terms', e.target.value)}
            required
            placeholder="50% deposit required, balance due upon completion"
            rows={2}
          />
        </div>

        <div className="form-group">
          <label htmlFor="target_completion_date">Target Completion Date *</label>
          <input
            id="target_completion_date"
            type="date"
            value={job.target_completion_date}
            onChange={(e) => updateField('target_completion_date', e.target.value)}
            required
          />
        </div>
      </section>

      <section className="form-section">
        <h2>Exclusions</h2>
        <p className="help-text">List what is NOT included in this job</p>

        {job.exclusions.map((exclusion, index) => (
          <div key={`exclusion-${index}-${exclusion}`} className="list-item">
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

      <section className="form-section">
        <h2>Assumptions</h2>
        <p className="help-text">List assumptions about the job conditions</p>

        {job.assumptions.map((assumption, index) => (
          <div key={`assumption-${index}-${assumption}`} className="list-item">
            <input
              type="text"
              value={assumption}
              onChange={(e) => updateAssumption(index, e.target.value)}
              placeholder="e.g., Customer will provide clear access to work area"
            />
            <button
              type="button"
              className="btn-remove"
              onClick={() => removeAssumption(index)}
              aria-label="Remove assumption"
            >
              ×
            </button>
          </div>
        ))}

        <button type="button" className="btn-add" onClick={addAssumption}>
          + Add Assumption
        </button>
      </section>

      <section className="form-section">
        <h2>Scope Control</h2>

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

      <section className="form-section">
        <h2>Warranty</h2>

        <div className="form-group">
          <label htmlFor="workmanship_warranty_days">
            Workmanship Warranty (Days) *
          </label>
          <input
            id="workmanship_warranty_days"
            type="number"
            value={job.workmanship_warranty_days}
            onChange={(e) =>
              updateField('workmanship_warranty_days', parseInt(e.target.value) || 0)
            }
            required
            min="0"
            placeholder="30"
          />
        </div>
      </section>
    </form>
  );
}
