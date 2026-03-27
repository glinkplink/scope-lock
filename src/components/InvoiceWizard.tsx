import { useEffect, useMemo, useRef, useState } from 'react';
import type {
  Job,
  BusinessProfile,
  Invoice,
  ChangeOrder,
} from '../types/db';
import { createInvoice, updateInvoice } from '../lib/db/invoices';
import { listChangeOrders } from '../lib/db/change-orders';
import {
  buildInvoiceLineItems,
  formatChangeOrderPickerAmount,
  parseExistingIntoInvoiceState,
} from '../lib/invoice-line-items';
import type { MaterialRow, LaborRow } from '../lib/invoice-line-items';
import { PAYMENT_METHOD_OPTIONS, normalizePaymentMethods } from '../lib/payment-methods';
import { DEFAULT_TAX_RATE, normalizeTaxRate, percentValueToTaxRate, taxRateToPercentValue } from '../lib/tax';
import './InvoiceWizard.css';

type PricingSubStep = 'labor' | 'materials';

function defaultDueDateYmd(): string {
  const d = new Date();
  d.setDate(d.getDate() + 14);
  return d.toISOString().split('T')[0];
}

function defaultPaymentSelection(profile: BusinessProfile): string[] {
  const fromProfile = normalizePaymentMethods(profile.default_payment_methods);
  if (fromProfile.length > 0) return [...fromProfile];
  return [...PAYMENT_METHOD_OPTIONS];
}


function formatTaxPercent(rate: number): string {
  return `${(rate * 100).toLocaleString('en-US', { maximumFractionDigits: 2 })}%`;
}

function InvoicePreviewSummary({
  subtotal,
  tax_amount,
  total,
  tax_rate,
}: {
  subtotal: number;
  tax_amount: number;
  total: number;
  tax_rate: number;
}) {
  return (
    <div className="invoice-wizard-summary" role="region" aria-label="Amount preview">
      <div className="invoice-wizard-summary-row">
        <span>Subtotal</span>
        <span className="invoice-wizard-summary-value">${subtotal.toFixed(2)}</span>
      </div>
      <div className="invoice-wizard-summary-row">
        <span>{`Tax (${formatTaxPercent(tax_rate)})`}</span>
        <span className="invoice-wizard-summary-value">${tax_amount.toFixed(2)}</span>
      </div>
      <div className="invoice-wizard-summary-row invoice-wizard-summary-total">
        <span>Total</span>
        <span className="invoice-wizard-summary-value">${total.toFixed(2)}</span>
      </div>
    </div>
  );
}

interface InvoiceWizardProps {
  userId: string;
  job: Job;
  profile: BusinessProfile;
  existingInvoice: Invoice | null;
  onCancel: () => void;
  onSuccess: (invoice: Invoice) => void;
}

export function InvoiceWizard({
  userId,
  job,
  profile,
  existingInvoice,
  onCancel,
  onSuccess,
}: InvoiceWizardProps) {
  const initial = useMemo(() => {
    if (existingInvoice) {
      return {
        ...parseExistingIntoInvoiceState(job, existingInvoice, profile),
        selectedPaymentMethods: defaultPaymentSelection(profile),
      };
    }
    return {
      fixedTotal: job.price,
      laborRows: [{ description: 'Labor', qty: '', rate: '' }] as LaborRow[],
      materialsYes: null as boolean | null,
      materialRows: [{ description: '', qty: '1', unit_price: '' }] as MaterialRow[],
      due_date: defaultDueDateYmd(),
      taxPercent: taxRateToPercentValue(profile.default_tax_rate ?? DEFAULT_TAX_RATE),
      selectedPaymentMethods: defaultPaymentSelection(profile),
      structuredLineMetadata: false,
    };
  }, [job, existingInvoice, profile]);

  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [pricingSubStep, setPricingSubStep] = useState<PricingSubStep | null>(() => {
    if (job.price_type === 'fixed') return null;
    return 'labor';
  });

  const [fixedTotal, setFixedTotal] = useState(initial.fixedTotal);
  const [laborRows, setLaborRows] = useState<LaborRow[]>(initial.laborRows);
  const [materialsYes, setMaterialsYes] = useState<boolean | null>(initial.materialsYes);
  const [materialRows, setMaterialRows] = useState<MaterialRow[]>(initial.materialRows);
  const [dueDate, setDueDate] = useState(initial.due_date);
  const [taxPercent, setTaxPercent] = useState(initial.taxPercent);
  const [selectedPaymentMethods, setSelectedPaymentMethods] = useState<string[]>(
    initial.selectedPaymentMethods
  );

  const [changeOrdersOnJob, setChangeOrdersOnJob] = useState<ChangeOrder[]>([]);
  const [selectedCoIds, setSelectedCoIds] = useState<Set<string>>(() => new Set());
  // Ref avoids rerendering while preventing async CO load from reapplying defaults.
  const coSelectionInitialized = useRef(false);

  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    coSelectionInitialized.current = false;
  }, [job.id]);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const rows = await listChangeOrders(job.id);
      if (!cancelled) setChangeOrdersOnJob(rows);
    })();
    return () => {
      cancelled = true;
    };
  }, [job.id]);

  useEffect(() => {
    if (existingInvoice) return;
    if (coSelectionInitialized.current) return;
    if (changeOrdersOnJob.length === 0) return;
    const approved = changeOrdersOnJob.filter((c) => c.status === 'approved').map((c) => c.id);
    setSelectedCoIds(new Set(approved));
    coSelectionInitialized.current = true;
  }, [changeOrdersOnJob, existingInvoice]);

  const selectedCOs = existingInvoice
    ? []
    : changeOrdersOnJob.filter((c) => selectedCoIds.has(c.id));

  const mergedLineItems = buildInvoiceLineItems({
    job,
    fixedTotal,
    laborRows,
    materialsYes: materialsYes === true,
    materialRows,
    selectedCOs,
    existingLineItems: existingInvoice?.line_items,
  });

  const subtotal = Math.round(mergedLineItems.reduce((s, i) => s + i.total, 0) * 100) / 100;
  const taxRate = normalizeTaxRate(percentValueToTaxRate(taxPercent));
  const tax_amount = Math.round(subtotal * taxRate * 100) / 100;
  const total = Math.round((subtotal + tax_amount) * 100) / 100;

  const togglePayment = (method: string) => {
    setSelectedPaymentMethods((prev) =>
      prev.includes(method) ? prev.filter((m) => m !== method) : [...prev, method]
    );
  };

  const toggleCoSelected = (id: string) => {
    setSelectedCoIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const addMaterialRow = () => {
    setMaterialRows((rows) => [...rows, { description: '', qty: '1', unit_price: '' }]);
  };

  const updateMaterialRow = (index: number, patch: Partial<MaterialRow>) => {
    setMaterialRows((rows) => {
      const next = [...rows];
      next[index] = { ...next[index], ...patch };
      return next;
    });
  };

  const removeMaterialRow = (index: number) => {
    setMaterialRows((rows) => rows.filter((_, i) => i !== index));
  };

  const addLaborRow = () => {
    setLaborRows((rows) => [...rows, { description: 'Labor', qty: '', rate: '' }]);
  };

  const updateLaborRow = (index: number, patch: Partial<LaborRow>) => {
    setLaborRows((rows) => {
      const next = [...rows];
      next[index] = { ...next[index], ...patch };
      return next;
    });
  };

  const removeLaborRow = (index: number) => {
    setLaborRows((rows) => (rows.length <= 1 ? rows : rows.filter((_, i) => i !== index)));
  };

  const goStep2 = () => {
    if (subtotal <= 0) {
      setError('Enter pricing so the subtotal is greater than zero.');
      return;
    }
    setError('');
    setStep(2);
  };

  const handleFixedConfirm = () => {
    goStep2();
  };

  const handleLaborContinue = () => {
    const hasValid = laborRows.some((row) => {
      const h = Number(row.qty);
      const r = Number(row.rate);
      return (
        row.description.trim() !== '' &&
        Number.isFinite(h) &&
        h > 0 &&
        Number.isFinite(r) &&
        r >= 0
      );
    });
    if (!hasValid) {
      setError('Enter at least one labor line with description, hours, and rate.');
      return;
    }
    setError('');
    setPricingSubStep('materials');
  };

  const handleMaterialsContinue = () => {
    setError('');
    if (materialsYes === null) {
      setError('Choose whether to add materials.');
      return;
    }
    if (materialsYes) {
      const hasValidRow = materialRows.some((row) => {
        const q = Number(row.qty);
        const up = Number(row.unit_price);
        return (
          row.description.trim() !== '' &&
          Number.isFinite(q) &&
          Number.isFinite(up) &&
          q > 0 &&
          up >= 0
        );
      });
      if (!hasValidRow) {
        setError('Add at least one material line with description, quantity, and unit price.');
        return;
      }
    }
    goStep2();
  };

  const handleDueDateContinue = () => {
    if (!dueDate || !String(dueDate).trim()) {
      setError('Choose a due date.');
      return;
    }
    setError('');
    setStep(3);
  };

  const handleGenerate = async () => {
    setError('');
    if (mergedLineItems.length === 0 || subtotal <= 0) {
      setError('Subtotal must be greater than zero.');
      return;
    }
    if (selectedPaymentMethods.length === 0) {
      setError('Select at least one payment method.');
      return;
    }
    const normalizedTaxRate = normalizeTaxRate(percentValueToTaxRate(taxPercent));
    const ta = Math.round(subtotal * normalizedTaxRate * 100) / 100;
    const tot = Math.round((subtotal + ta) * 100) / 100;
    const invoice_date = new Date().toISOString().split('T')[0];

    setSubmitting(true);
    try {
      if (existingInvoice) {
        const next: Invoice = {
          ...existingInvoice,
          invoice_date: existingInvoice.invoice_date,
          due_date: dueDate,
          line_items: mergedLineItems,
          subtotal,
          tax_rate: normalizedTaxRate,
          tax_amount: ta,
          total: tot,
          payment_methods: normalizePaymentMethods(selectedPaymentMethods),
        };
        const { data, error: upErr } = await updateInvoice(next);
        if (upErr || !data) {
          setError(upErr?.message || 'Could not save invoice.');
          return;
        }
        onSuccess(data);
      } else {
        const { data, error: cErr } = await createInvoice({
          user_id: userId,
          job_id: job.id,
          invoice_date,
          due_date: dueDate,
          line_items: mergedLineItems,
          subtotal,
          tax_rate: normalizedTaxRate,
          tax_amount: ta,
          total: tot,
          payment_methods: normalizePaymentMethods(selectedPaymentMethods),
          notes: null,
        });
        if (cErr || !data) {
          setError(cErr?.message || 'Could not create invoice.');
          return;
        }
        onSuccess(data);
      }
    } finally {
      setSubmitting(false);
    }
  };

  const coPickerSection =
    !existingInvoice && changeOrdersOnJob.length > 0 ? (
      <div className="invoice-co-picker">
        <h3 className="invoice-flow-section-title" style={{ fontSize: '1rem' }}>
          Change orders on this job
        </h3>
        <p className="content-note" style={{ marginBottom: 12 }}>
          Include approved change orders as invoice lines. Uncheck any you do not bill on this invoice.
        </p>
        <ul className="invoice-co-picker-list">
          {changeOrdersOnJob.map((co) => (
            <li key={co.id} className="invoice-co-picker-row">
              <label className="invoice-co-picker-label">
                <input
                  type="checkbox"
                  checked={selectedCoIds.has(co.id)}
                  onChange={() => toggleCoSelected(co.id)}
                />
                <span>
                  CO #{String(co.co_number).padStart(4, '0')}: {co.description.slice(0, 56)}
                  {co.description.length > 56 ? '…' : ''}
                </span>
              </label>
              <span className="invoice-co-picker-amt">${formatChangeOrderPickerAmount(co)}</span>
              <span className={`co-status-badge ${co.status === 'pending_approval' ? 'pending' : co.status}`}>
                {co.status.replace(/_/g, ' ')}
              </span>
            </li>
          ))}
        </ul>
      </div>
    ) : null;

  const editCoNote = existingInvoice ? (
    <p className="content-note" style={{ marginBottom: 16 }}>
      Change order lines on this invoice are fixed. Edit due date, tax, or other amounts below; original and
      labor lines update from this screen.
    </p>
  ) : null;

  return (
    <div className="invoice-wizard">
      <div className="invoice-wizard-toolbar">
        <button type="button" className="home-work-orders-link invoice-wizard-toolbar-cancel" onClick={onCancel}>
          Cancel
        </button>
        <span className="invoice-wizard-toolbar-title" aria-hidden="true" />
        <span className="invoice-wizard-toolbar-balance" aria-hidden="true" />
      </div>

      {error ? (
        <div className="error-banner" role="alert">
          {error}
        </div>
      ) : null}

      {step === 1 && job.price_type === 'fixed' ? (
        <section className="invoice-wizard-step">
          <h2 className="invoice-flow-section-title">Pricing</h2>
          {editCoNote}
          {coPickerSection}
          <div className="form-group">
            <label htmlFor="fixed-total">Original scope total</label>
            <input
              id="fixed-total"
              type="number"
              min={0}
              step="0.01"
              value={fixedTotal}
              onChange={(e) => setFixedTotal(Number(e.target.value))}
            />
          </div>
          <div className="form-group">
            <label htmlFor="fixed-tax">Tax (%)</label>
            <input
              id="fixed-tax"
              type="number"
              min={0}
              step="0.01"
              value={taxPercent}
              onChange={(e) => setTaxPercent(e.target.value)}
            />
          </div>
          <InvoicePreviewSummary
            subtotal={subtotal}
            tax_amount={tax_amount}
            total={total}
            tax_rate={taxRate}
          />
          <div className="invoice-wizard-step-actions">
            <button type="button" className="btn-primary btn-large" onClick={handleFixedConfirm}>
              Confirm
            </button>
          </div>
        </section>
      ) : null}

      {step === 1 && job.price_type !== 'fixed' && pricingSubStep === 'labor' ? (
        <section className="invoice-wizard-step">
          <h2 className="invoice-flow-section-title">Labor</h2>
          {editCoNote}
          {coPickerSection}
          {laborRows.map((row, index) => (
            <div key={index} className="invoice-material-row">
              <div className="form-group">
                <label htmlFor={`lab-desc-${index}`}>Description</label>
                <input
                  id={`lab-desc-${index}`}
                  type="text"
                  value={row.description}
                  onChange={(e) => updateLaborRow(index, { description: e.target.value })}
                />
              </div>
              <div className="form-group invoice-material-row-grid">
                <div className="form-group">
                  <label htmlFor={`lab-qty-${index}`}>Hours / qty</label>
                  <input
                    id={`lab-qty-${index}`}
                    type="number"
                    min={0}
                    step="0.25"
                    value={row.qty}
                    onChange={(e) => updateLaborRow(index, { qty: e.target.value })}
                  />
                </div>
                <div className="form-group">
                  <label htmlFor={`lab-rate-${index}`}>Rate ($)</label>
                  <input
                    id={`lab-rate-${index}`}
                    type="number"
                    min={0}
                    step="0.01"
                    value={row.rate}
                    onChange={(e) => updateLaborRow(index, { rate: e.target.value })}
                  />
                </div>
              </div>
              {laborRows.length > 1 ? (
                <button
                  type="button"
                  className="btn-text invoice-material-remove"
                  onClick={() => removeLaborRow(index)}
                >
                  Remove
                </button>
              ) : null}
            </div>
          ))}
          <button type="button" className="btn-text invoice-add-row-btn" onClick={addLaborRow}>
            Add labor line
          </button>
          <div className="form-group">
            <label htmlFor="labor-tax">Tax (%)</label>
            <input
              id="labor-tax"
              type="number"
              min={0}
              step="0.01"
              value={taxPercent}
              onChange={(e) => setTaxPercent(e.target.value)}
            />
          </div>
          <InvoicePreviewSummary
            subtotal={subtotal}
            tax_amount={tax_amount}
            total={total}
            tax_rate={taxRate}
          />
          <div className="invoice-wizard-step-actions">
            <button type="button" className="btn-primary btn-large" onClick={handleLaborContinue}>
              Continue
            </button>
          </div>
        </section>
      ) : null}

      {step === 1 && job.price_type !== 'fixed' && pricingSubStep === 'materials' ? (
        <section className="invoice-wizard-step">
          <h2 className="invoice-flow-section-title">Materials</h2>
          <button
            type="button"
            className="invoice-flow-back-link"
            onClick={() => {
              setError('');
              setPricingSubStep('labor');
            }}
          >
            Back
          </button>
          <fieldset className="invoice-wizard-yesno">
            <legend className="invoice-wizard-yesno-legend">Add materials?</legend>
            <div className="invoice-wizard-yesno-radios">
              <label className="invoice-wizard-radio">
                <input
                  type="radio"
                  name="mat-yesno"
                  checked={materialsYes === true}
                  onChange={() => setMaterialsYes(true)}
                />
                Yes
              </label>
              <label className="invoice-wizard-radio">
                <input
                  type="radio"
                  name="mat-yesno"
                  checked={materialsYes === false}
                  onChange={() => setMaterialsYes(false)}
                />
                No
              </label>
            </div>
          </fieldset>
          {materialsYes === true ? (
            <div className="invoice-material-rows">
              {materialRows.map((row, index) => (
                <div key={index} className="invoice-material-row">
                  <div className="form-group">
                    <label htmlFor={`mat-desc-${index}`}>Description</label>
                    <input
                      id={`mat-desc-${index}`}
                      type="text"
                      placeholder="Description"
                      value={row.description}
                      onChange={(e) => updateMaterialRow(index, { description: e.target.value })}
                    />
                  </div>
                  <div className="form-group invoice-material-row-grid">
                    <div className="form-group">
                      <label htmlFor={`mat-qty-${index}`}>Qty</label>
                      <input
                        id={`mat-qty-${index}`}
                        type="number"
                        placeholder="Qty"
                        min={0}
                        step="0.01"
                        value={row.qty}
                        onChange={(e) => updateMaterialRow(index, { qty: e.target.value })}
                      />
                    </div>
                    <div className="form-group">
                      <label htmlFor={`mat-up-${index}`}>Unit price</label>
                      <input
                        id={`mat-up-${index}`}
                        type="number"
                        placeholder="Unit price"
                        min={0}
                        step="0.01"
                        value={row.unit_price}
                        onChange={(e) => updateMaterialRow(index, { unit_price: e.target.value })}
                      />
                    </div>
                  </div>
                  {materialRows.length > 1 ? (
                    <button
                      type="button"
                      className="btn-text invoice-material-remove"
                      onClick={() => removeMaterialRow(index)}
                    >
                      Remove
                    </button>
                  ) : null}
                </div>
              ))}
              <button type="button" className="btn-text invoice-add-row-btn" onClick={addMaterialRow}>
                Add row
              </button>
            </div>
          ) : null}
          <InvoicePreviewSummary
            subtotal={subtotal}
            tax_amount={tax_amount}
            total={total}
            tax_rate={taxRate}
          />
          <div className="invoice-wizard-step-actions">
            <button type="button" className="btn-primary btn-large" onClick={handleMaterialsContinue}>
              Continue
            </button>
          </div>
        </section>
      ) : null}

      {step === 2 ? (
        <section className="invoice-wizard-step">
          <h2 className="invoice-flow-section-title">Due date</h2>
          <button
            type="button"
            className="invoice-flow-back-link"
            onClick={() => {
              setError('');
              setStep(1);
              if (job.price_type !== 'fixed') {
                setPricingSubStep('materials');
              }
            }}
          >
            Back
          </button>
          <div className="form-group">
            <label htmlFor="due-date">Due date</label>
            <input
              id="due-date"
              type="date"
              value={dueDate}
              onChange={(e) => setDueDate(e.target.value)}
            />
          </div>
          <div className="invoice-wizard-step-actions">
            <button type="button" className="btn-primary btn-large" onClick={handleDueDateContinue}>
              Continue
            </button>
          </div>
        </section>
      ) : null}

      {step === 3 ? (
        <section className="invoice-wizard-step">
          <h2 className="invoice-flow-section-title">Payment methods</h2>
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
          <div className="invoice-payment-methods-group" role="group" aria-label="Payment methods">
            <div className="payment-method-chip-grid">
              {PAYMENT_METHOD_OPTIONS.map((method) => (
                <label key={method} className="payment-method-chip">
                  <input
                    type="checkbox"
                    className="payment-method-chip-input"
                    checked={selectedPaymentMethods.includes(method)}
                    onChange={() => togglePayment(method)}
                  />
                  <span className="payment-method-chip-text">{method}</span>
                </label>
              ))}
            </div>
          </div>
          <div className="invoice-wizard-step-actions">
            <button
              type="button"
              className="btn-primary btn-large"
              disabled={submitting}
              onClick={() => void handleGenerate()}
            >
              {existingInvoice ? 'Save Invoice' : 'Generate Invoice'}
            </button>
          </div>
        </section>
      ) : null}
    </div>
  );
}
