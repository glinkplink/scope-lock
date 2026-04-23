import { useMemo, useState } from 'react';
import type { Job, BusinessProfile, ChangeOrder, ChangeOrderLineItem } from '../types/db';
import { createChangeOrder, updateChangeOrder, computeCOTotal } from '../lib/db/change-orders';
import { buildChangeOrderEsignSendPayload } from '../lib/docuseal-change-order-html';
import { buildDocusealProviderSignatureImage } from '../lib/docuseal-signature-image';
import { mergeEsignResponseIntoChangeOrder, sendChangeOrderForSignature } from '../lib/esign-api';
import './InvoiceWizard.css';
import './ChangeOrderWizard.css';

const REASON_PRESETS = [
  'Client requested',
  'Hidden damage found',
  'Site conditions changed',
  'Other',
] as const;

const CHANGE_ORDER_WIZARD_STEPS = ['What Changed', 'Cost Adjustment', 'Review & Send'] as const;

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
  profile,
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
    const hasIncompleteRows = lineItems.some((row) => {
      const q = row.quantity;
      const ur = row.unit_rate;
      return !(
        row.description.trim() !== '' &&
        Number.isFinite(q) &&
        q > 0 &&
        Number.isFinite(ur) &&
        ur > 0
      );
    });
    if (hasIncompleteRows) {
      setError('Complete each line item or remove any blank ones before continuing.');
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
      requires_approval: true,
      line_items: lineItems.filter((row) => {
        const q = row.quantity;
        const ur = row.unit_rate;
        return (
          row.description.trim() !== '' &&
          Number.isFinite(q) &&
          q > 0 &&
          Number.isFinite(ur) &&
          ur > 0
        );
      }),
      time_amount: Math.max(0, timeAmount),
      time_unit: timeUnit,
      time_note: timeNote.trim(),
    };

    setSubmitting(true);
    try {
      let savedCo: ChangeOrder | null = null;
      if (existingCO) {
        const { data, error: upErr } = await updateChangeOrder(userId, existingCO.id, {
          ...fields,
          status: fields.requires_approval ? 'pending_approval' : 'approved',
        });
        if (upErr || !data) {
          setError(upErr?.message || 'Could not save change order.');
          return;
        }
        savedCo = data;
      } else {
        const { data, error: cErr } = await createChangeOrder(userId, job.id, fields);
        if (cErr || !data) {
          setError(cErr?.message || 'Could not save change order.');
          return;
        }
        savedCo = data;
      }

      if (!savedCo) {
        setError('Could not save change order.');
        return;
      }

      if (!(job.customer_email || '').trim()) {
        setError('Customer email is missing on this work order. Edit the job to add it.');
        return;
      }

      const providerSignatureDataUrl = await buildDocusealProviderSignatureImage(
        profile?.owner_name?.trim() || ''
      );
      const payload = buildChangeOrderEsignSendPayload(savedCo, job, profile, {
        providerSignatureDataUrl,
      });
      const response = await sendChangeOrderForSignature(savedCo.id, payload);
      onComplete(mergeEsignResponseIntoChangeOrder(savedCo, response));
    } finally {
      setSubmitting(false);
    }
  };

  const woLabel =
    job.wo_number != null ? `WO #${String(job.wo_number).padStart(4, '0')}` : 'WO (no #)';
  const customerTitle = job.customer_name.trim() || 'Customer';
  const shellTitle =
    isEdit && existingCO
      ? `Edit Change Order #${String(existingCO.co_number).padStart(4, '0')}`
      : 'New Change Order';

  const goBack = () => {
    setError('');
    if (step === 2) setStep(1);
    else if (step === 3) setStep(2);
  };

  return (
    <div className="invoice-wizard co-wizard">
      <div className="invoice-wizard-toolbar">
        <button type="button" className="home-work-orders-link invoice-wizard-toolbar-cancel" onClick={onCancel}>
          Cancel
        </button>
        <span className="invoice-wizard-toolbar-title" aria-hidden="true" />
        <span className="invoice-wizard-toolbar-balance" aria-hidden="true" />
      </div>

      <header className="co-wizard-intro">
        <p className="co-wizard-kicker">Change order</p>
        <h1 className="co-wizard-shell-title">{shellTitle}</h1>
        <p className="co-wizard-shell-subtitle">
          {woLabel} for {customerTitle}
        </p>
      </header>

      <div className="invoice-wizard-stepper co-wizard-stepper" role="list" aria-label="Change order progress">
        {CHANGE_ORDER_WIZARD_STEPS.map((label, index) => {
          const stepNumber = (index + 1) as 1 | 2 | 3;
          const stateClass =
            stepNumber === step
              ? ' invoice-wizard-stepper-item--current'
              : stepNumber < step
                ? ' invoice-wizard-stepper-item--complete'
                : '';

          return (
            <div
              key={label}
              role="listitem"
              aria-current={stepNumber === step ? 'step' : undefined}
              className={`invoice-wizard-stepper-item${stateClass}`}
            >
              <span className="invoice-wizard-stepper-index" aria-hidden="true">
                {stepNumber}
              </span>
              <span className="invoice-wizard-stepper-copy">
                <span className="invoice-wizard-stepper-kicker">{`Step ${stepNumber}`}</span>
                <span className="invoice-wizard-stepper-label">{label}</span>
              </span>
            </div>
          );
        })}
      </div>

      {error ? (
        <div className="error-banner" role="alert">
          {error}
        </div>
      ) : null}

      {step === 1 ? (
        <section className="invoice-wizard-step co-wizard-step">
          <header className="co-wizard-step-header">
            <p className="invoice-wizard-step-count">Step 1 of 3</p>
            <h2 className="invoice-flow-section-title co-wizard-title">What Changed</h2>
          </header>

          <div className="co-wizard-block">
            <p className="co-section-label" id="co-desc-label">
              Description
            </p>
            <textarea
              id="co-desc"
              className="co-textarea"
              rows={5}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Describe the additional or modified work…"
              aria-labelledby="co-desc-label"
            />
          </div>

          <div className="co-wizard-block-divider" aria-hidden="true" />

          <div className="co-wizard-block">
            <p className="co-section-label">Reason</p>
            <div className="co-reason-group" role="group" aria-label="Reason for change">
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
              <div className="form-group co-wizard-field-tight">
                <label htmlFor="co-reason-other">Describe reason</label>
                <input
                  id="co-reason-other"
                  type="text"
                  value={reasonOther}
                  onChange={(e) => setReasonOther(e.target.value)}
                />
              </div>
            ) : null}
          </div>

          <div className="co-wizard-footer">
            <span className="co-wizard-footer-spacer" aria-hidden="true" />
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
          <header className="co-wizard-step-header">
            <p className="invoice-wizard-step-count">Step 2 of 3</p>
            <h2 className="invoice-flow-section-title co-wizard-title">Cost Adjustment</h2>
          </header>

          <p className="co-section-label">Line items</p>
          <div className="co-line-items-stack">
            {lineItems.map((row, index) => (
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
                  <div className="co-rate-row">
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
                    {index > 0 ? (
                      <button
                        type="button"
                        className="co-remove-btn"
                        aria-label="Remove line"
                        onClick={() => removeLine(row.id)}
                      >
                        x
                      </button>
                    ) : (
                      <span className="co-remove-slot" aria-hidden="true" />
                    )}
                  </div>
                </div>
              </div>
            ))}
            <button type="button" className="co-add-btn" onClick={addLine}>
              + Add line item
            </button>
            <div className="co-line-items-total-wrap">
              <div className="co-total-row co-total-row--stack">
                <span className="co-total-label">Cost adjustment total</span>
                <span className="co-total-value">${coTotal.toFixed(2)}</span>
              </div>
            </div>
          </div>

          <p className="co-section-label co-section-label--time">Additional time (optional)</p>
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
            <div className="co-field co-field-time-note">
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

          <div className="co-wizard-footer">
            <button type="button" className="btn-secondary btn-large co-wizard-back" onClick={goBack}>
              Back
            </button>
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
          <header className="co-wizard-step-header">
            <p className="invoice-wizard-step-count">Step 3 of 3</p>
            <h2 className="invoice-flow-section-title co-wizard-title">Review & Save</h2>
          </header>

          <div className="co-review-card">
            <div className="co-review-field">
              <span className="co-review-label">Reference</span>
              <span className="co-review-value">
                {isEdit && existingCO
                  ? `Change Order #${String(existingCO.co_number).padStart(4, '0')} for ${woLabel}`
                  : `New change order for ${woLabel}`}
              </span>
            </div>
            <div className="co-review-field">
              <span className="co-review-label">Description</span>
              <span className="co-review-value">{description.trim() || '—'}</span>
            </div>
            <div className="co-review-field">
              <span className="co-review-label">Reason</span>
              <span className="co-review-value">{reasonValue || '—'}</span>
            </div>
            <div className="co-review-field co-review-field--list">
              <span className="co-review-label">Line items</span>
              <ul className="co-review-lines">
                {lineItems.map((li) => (
                  <li key={li.id}>
                    {li.description || '(no description)'} — $
                    {(li.quantity * li.unit_rate).toFixed(2)}
                  </li>
                ))}
              </ul>
            </div>
            <div className="co-total-row co-review-total">
              <span className="co-total-label">Total</span>
              <span className="co-total-value">${coTotal.toFixed(2)}</span>
            </div>
            {timeAmount > 0 ? (
              <div className="co-review-field">
                <span className="co-review-label">Schedule</span>
                <span className="co-review-value">
                  +{timeAmount} {timeUnit}
                  {timeNote.trim() ? ` — ${timeNote.trim()}` : ''}
                </span>
              </div>
            ) : null}
          </div>

          <div className="co-wizard-footer">
            <button type="button" className="btn-secondary btn-large co-wizard-back" onClick={goBack}>
              Back
            </button>
            <button
              type="button"
              className="btn-primary btn-large"
              disabled={submitting}
              onClick={() => void handleSave()}
            >
              {submitting ? 'Saving and sending…' : 'Save and Send Change Order'}
            </button>
          </div>
        </section>
      ) : null}
    </div>
  );
}
