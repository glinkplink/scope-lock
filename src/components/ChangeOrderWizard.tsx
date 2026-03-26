import { useMemo, useState } from 'react';
import type { Job, BusinessProfile, ChangeOrder, ChangeOrderLineItem } from '../types/db';
import { createChangeOrder, updateChangeOrder, computeCOTotal } from '../lib/db/change-orders';

const REASON_PRESETS = [
  'Client requested',
  'Hidden damage found',
  'Site conditions changed',
  'Other',
] as const;

type ReasonPreset = (typeof REASON_PRESETS)[number];

function newLineItem(): ChangeOrderLineItem {
  return {
    id: crypto.randomUUID(),
    description: '',
    quantity: 1,
    unit_rate: 0,
  };
}

export interface ChangeOrderWizardProps {
  userId: string;
  job: Job;
  profile: BusinessProfile;
  existingCO?: ChangeOrder | null;
  onComplete: (co: ChangeOrder) => void;
  onCancel: () => void;
}

export function ChangeOrderWizard({
  userId,
  job,
  existingCO,
  onComplete,
  onCancel,
}: ChangeOrderWizardProps) {
  const isEdit = Boolean(existingCO);

  const initialReasonPreset = useMemo((): ReasonPreset => {
    if (!existingCO?.reason) return 'Client requested';
    const r = existingCO.reason.trim();
    if ((REASON_PRESETS as readonly string[]).includes(r)) return r as ReasonPreset;
    return 'Other';
  }, [existingCO]);

  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [description, setDescription] = useState(existingCO?.description ?? '');
  const [reasonPreset, setReasonPreset] = useState<ReasonPreset>(initialReasonPreset);
  const [reasonOther, setReasonOther] = useState(() => {
    if (!existingCO?.reason) return '';
    const r = existingCO.reason.trim();
    if ((REASON_PRESETS as readonly string[]).includes(r)) return '';
    return existingCO.reason;
  });
  const [lineItems, setLineItems] = useState<ChangeOrderLineItem[]>(() =>
    existingCO?.line_items?.length
      ? existingCO.line_items.map((li) => ({ ...li, id: li.id || crypto.randomUUID() }))
      : [newLineItem()]
  );
  const [timeAmount, setTimeAmount] = useState<number>(existingCO?.time_amount ?? 0);
  const [timeUnit, setTimeUnit] = useState<'hours' | 'days'>(existingCO?.time_unit ?? 'days');
  const [timeNote, setTimeNote] = useState(existingCO?.time_note ?? '');
  const [requiresApproval, setRequiresApproval] = useState(
    existingCO?.requires_approval ?? true
  );
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const reasonValue =
    reasonPreset === 'Other' ? reasonOther.trim() : reasonPreset;

  const coTotal = useMemo(() => computeCOTotal(lineItems), [lineItems]);

  const updateLine = (id: string, patch: Partial<ChangeOrderLineItem>) => {
    setLineItems((rows) => rows.map((r) => (r.id === id ? { ...r, ...patch } : r)));
  };

  const addLine = () => setLineItems((rows) => [...rows, newLineItem()]);
  const removeLine = (id: string) => {
    setLineItems((rows) => (rows.length <= 1 ? rows : rows.filter((r) => r.id !== id)));
  };

  const validateStep1 = () => {
    if (!description.trim()) {
      setError('Describe what changed.');
      return false;
    }
    if (reasonPreset === 'Other' && !reasonOther.trim()) {
      setError('Enter a reason or pick a preset.');
      return false;
    }
    setError('');
    return true;
  };

  const validateStep2 = () => {
    const valid = lineItems.some((row) => {
      const q = row.quantity;
      const ur = row.unit_rate;
      return (
        row.description.trim() !== '' &&
        Number.isFinite(q) &&
        q > 0 &&
        Number.isFinite(ur) &&
        ur >= 0
      );
    });
    if (!valid) {
      setError('Add at least one line item with description, quantity greater than 0, and rate.');
      return false;
    }
    if (timeAmount < 0) {
      setError('Additional time cannot be negative.');
      return false;
    }
    setError('');
    return true;
  };

  const handleSave = async () => {
    setError('');
    if (!validateStep2()) {
      setStep(2);
      return;
    }
    const fields = {
      description: description.trim(),
      reason: reasonValue,
      requires_approval: requiresApproval,
      line_items: lineItems.filter((row) => {
        const q = row.quantity;
        const ur = row.unit_rate;
        return (
          row.description.trim() !== '' &&
          Number.isFinite(q) &&
          q > 0 &&
          Number.isFinite(ur) &&
          ur >= 0
        );
      }),
      time_amount: Math.max(0, timeAmount),
      time_unit: timeUnit,
      time_note: timeNote.trim(),
    };

    setSubmitting(true);
    try {
      if (existingCO) {
        const nextStatus: ChangeOrder['status'] = requiresApproval ? 'pending_approval' : 'approved';
        const { data, error: upErr } = await updateChangeOrder(existingCO.id, {
          ...fields,
          status: nextStatus,
        });
        if (upErr || !data) {
          setError(upErr?.message || 'Could not save change order.');
          return;
        }
        onComplete(data);
      } else {
        const { data, error: cErr } = await createChangeOrder(userId, job.id, fields);
        if (cErr || !data) {
          setError(cErr?.message || 'Could not save change order.');
          return;
        }
        onComplete(data);
      }
    } finally {
      setSubmitting(false);
    }
  };

  const woLabel =
    job.wo_number != null ? `WO #${String(job.wo_number).padStart(4, '0')}` : 'WO (no #)';

  return (
    <div className="invoice-wizard co-wizard">
      <div className="invoice-wizard-toolbar">
        <button type="button" className="home-work-orders-link invoice-wizard-toolbar-cancel" onClick={onCancel}>
          Cancel
        </button>
        <span className="invoice-wizard-toolbar-title" aria-hidden="true" />
        <span className="invoice-wizard-toolbar-balance" aria-hidden="true" />
      </div>

      <p className="co-wizard-step-label">
        Step {step} of 3 —{' '}
        {step === 1 ? 'What changed' : step === 2 ? 'Cost adjustment' : 'Review & save'}
      </p>

      {error ? (
        <div className="error-banner" role="alert">
          {error}
        </div>
      ) : null}

      {step === 1 ? (
        <section className="invoice-wizard-step co-wizard-step">
          <h2 className="invoice-flow-section-title">What changed</h2>
          <p className="co-section-label">Description</p>
          <div className="form-group">
            <label htmlFor="co-desc">Describe the additional or modified work</label>
            <textarea
              id="co-desc"
              className="co-textarea"
              rows={5}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
            />
          </div>
          <p className="co-section-label">Reason</p>
          <div className="form-group">
            {REASON_PRESETS.map((p) => (
              <label key={p} className="co-reason-radio">
                <input
                  type="radio"
                  name="co-reason"
                  checked={reasonPreset === p}
                  onChange={() => setReasonPreset(p)}
                />
                {p}
              </label>
            ))}
          </div>
          {reasonPreset === 'Other' ? (
            <div className="form-group">
              <label htmlFor="co-reason-other">Describe reason</label>
              <input
                id="co-reason-other"
                type="text"
                value={reasonOther}
                onChange={(e) => setReasonOther(e.target.value)}
              />
            </div>
          ) : null}
          <div className="invoice-wizard-step-actions">
            <button
              type="button"
              className="btn-primary btn-large"
              onClick={() => {
                if (validateStep1()) setStep(2);
              }}
            >
              Next
            </button>
          </div>
        </section>
      ) : null}

      {step === 2 ? (
        <section className="invoice-wizard-step co-wizard-step">
          <h2 className="invoice-flow-section-title">Cost adjustment</h2>
          <button
            type="button"
            className="invoice-flow-back-link"
            onClick={() => {
              setError('');
              setStep(1);
            }}
          >
            Back
          </button>
          <p className="co-section-label">Line items</p>
          {lineItems.map((row) => (
            <div key={row.id} className="co-line-row">
              <div className="co-field co-field-desc">
                <label htmlFor={`d-${row.id}`}>Description</label>
                <input
                  id={`d-${row.id}`}
                  type="text"
                  placeholder="e.g. Extra welding — extend railing"
                  value={row.description}
                  onChange={(e) => updateLine(row.id, { description: e.target.value })}
                />
              </div>
              <div className="co-field co-field-qty">
                <label htmlFor={`q-${row.id}`}>Qty</label>
                <input
                  id={`q-${row.id}`}
                  type="number"
                  min={0}
                  step="0.01"
                  value={row.quantity || ''}
                  onChange={(e) => updateLine(row.id, { quantity: Number(e.target.value) })}
                />
              </div>
              <div className="co-field co-field-rate">
                <label htmlFor={`r-${row.id}`}>Rate</label>
                <div className="co-rate-wrap">
                  <span className="co-rate-prefix" aria-hidden="true">
                    $
                  </span>
                  <input
                    id={`r-${row.id}`}
                    type="number"
                    min={0}
                    step="0.01"
                    value={row.unit_rate || ''}
                    onChange={(e) => updateLine(row.id, { unit_rate: Number(e.target.value) })}
                  />
                </div>
              </div>
              <div className="co-field-total" aria-label="Line total">
                $
                {(row.quantity * row.unit_rate).toLocaleString('en-US', {
                  minimumFractionDigits: 2,
                  maximumFractionDigits: 2,
                })}
              </div>
              <button
                type="button"
                className="co-remove-btn"
                aria-label="Remove line"
                onClick={() => removeLine(row.id)}
              >
                ×
              </button>
            </div>
          ))}
          <button type="button" className="co-add-btn" onClick={addLine}>
            + Add line item
          </button>
          <hr className="co-divider" />
          <div className="co-total-row">
            <span className="co-total-label">Cost adjustment total</span>
            <span className="co-total-value">${coTotal.toFixed(2)}</span>
          </div>
          <hr className="co-divider" />
          <p className="co-section-label">Additional time (optional)</p>
          <div className="co-time-row">
            <div className="co-field co-field-time">
              <label htmlFor="co-time-amt">Amount</label>
              <input
                id="co-time-amt"
                type="number"
                min={0}
                step="0.25"
                value={timeAmount || ''}
                onChange={(e) => setTimeAmount(Number(e.target.value))}
              />
            </div>
            <div className="co-field co-field-unit">
              <label htmlFor="co-time-unit">Unit</label>
              <select
                id="co-time-unit"
                value={timeUnit}
                onChange={(e) => setTimeUnit(e.target.value as 'hours' | 'days')}
              >
                <option value="hours">Hours</option>
                <option value="days">Days</option>
              </select>
            </div>
            <div className="co-field" style={{ flex: 1, minWidth: 0 }}>
              <label htmlFor="co-time-note">Note</label>
              <input
                id="co-time-note"
                type="text"
                placeholder="e.g. weather delay"
                value={timeNote}
                onChange={(e) => setTimeNote(e.target.value)}
              />
            </div>
          </div>
          <div className="invoice-wizard-step-actions">
            <button
              type="button"
              className="btn-primary btn-large"
              onClick={() => {
                if (validateStep2()) setStep(3);
              }}
            >
              Next
            </button>
          </div>
        </section>
      ) : null}

      {step === 3 ? (
        <section className="invoice-wizard-step co-wizard-step">
          <h2 className="invoice-flow-section-title">Review & save</h2>
          <button
            type="button"
            className="invoice-flow-back-link"
            onClick={() => {
              setError('');
              setStep(2);
            }}
          >
            Back
          </button>
          <div className="co-review-card">
            <p className="co-section-label">Reference</p>
            <p className="content-paragraph">
              {isEdit && existingCO
                ? `Change Order #${String(existingCO.co_number).padStart(4, '0')} for ${woLabel}`
                : `New change order for ${woLabel}`}
            </p>
            <p className="co-section-label">Description</p>
            <p className="content-paragraph">{description.trim() || '—'}</p>
            <p className="co-section-label">Reason</p>
            <p className="content-paragraph">{reasonValue || '—'}</p>
            <p className="co-section-label">Line items</p>
            <ul className="content-bullets">
              {lineItems.map((li) => (
                <li key={li.id}>
                  {li.description || '(no description)'} — $
                  {(li.quantity * li.unit_rate).toFixed(2)}
                </li>
              ))}
            </ul>
            <p className="co-total-row">
              <span className="co-total-label">Total</span>
              <span className="co-total-value">${coTotal.toFixed(2)}</span>
            </p>
            {timeAmount > 0 ? (
              <>
                <p className="co-section-label">Schedule</p>
                <p className="content-paragraph">
                  +{timeAmount} {timeUnit}
                  {timeNote.trim() ? ` — ${timeNote.trim()}` : ''}
                </p>
              </>
            ) : null}
          </div>
          <label className="co-approval-check">
            <input
              type="checkbox"
              checked={requiresApproval}
              onChange={(e) => setRequiresApproval(e.target.checked)}
            />
            Requires client approval before invoicing
          </label>
          <div className="invoice-wizard-step-actions">
            <button
              type="button"
              className="btn-primary btn-large"
              disabled={submitting}
              onClick={() => void handleSave()}
            >
              {submitting ? 'Saving…' : 'Save Change Order'}
            </button>
          </div>
        </section>
      ) : null}
    </div>
  );
}
