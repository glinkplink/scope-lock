import { useMemo, useState } from 'react';
import type { Job, BusinessProfile, Invoice, InvoiceLineItem } from '../types/db';
import { createInvoice, updateInvoice } from '../lib/db/invoices';
import { PAYMENT_METHOD_OPTIONS, normalizePaymentMethods } from '../lib/payment-methods';
import { DEFAULT_TAX_RATE, normalizeTaxRate, percentValueToTaxRate, taxRateToPercentValue } from '../lib/tax';

type PricingSubStep = 'labor' | 'materials';

interface MaterialRow {
  description: string;
  qty: string;
  unit_price: string;
}

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

function parseExistingIntoState(job: Job, existing: Invoice, profile: BusinessProfile) {
  const laborItems = existing.line_items.filter((i) => i.kind === 'labor');
  const matItems = existing.line_items.filter((i) => i.kind === 'material');

  let fixedTotal = job.price;
  let laborHours = '';
  let laborRate = '';
  const materialsYes = matItems.length > 0;
  const materialRows: MaterialRow[] =
    matItems.length > 0
      ? matItems.map((m) => ({
          description: m.description,
          qty: String(m.qty),
          unit_price: String(m.unit_price),
        }))
      : [{ description: '', qty: '1', unit_price: '' }];

  if (job.price_type === 'fixed') {
    const sum = laborItems.reduce((s, i) => s + i.total, 0);
    fixedTotal = sum > 0 ? sum : job.price;
  } else {
    const first = laborItems[0];
    if (first) {
      laborHours = String(first.qty);
      laborRate = String(first.unit_price);
    }
  }

  return {
    fixedTotal,
    laborHours,
    laborRate,
    materialsYes,
    materialRows,
    due_date: existing.due_date,
    taxPercent: taxRateToPercentValue(existing.tax_rate ?? profile.default_tax_rate ?? DEFAULT_TAX_RATE),
    selectedPaymentMethods: defaultPaymentSelection(profile),
  };
}

function buildLineItemsAndTotals(
  job: Job,
  fixedTotal: number,
  laborHours: string,
  laborRate: string,
  materialsYes: boolean,
  materialRows: MaterialRow[]
): { line_items: InvoiceLineItem[]; subtotal: number } {
  const items: InvoiceLineItem[] = [];

  if (job.price_type === 'fixed') {
    const t = Math.max(0, Number(fixedTotal) || 0);
    items.push({
      kind: 'labor',
      description: 'Services (fixed price)',
      qty: 1,
      unit_price: t,
      total: Math.round(t * 100) / 100,
    });
  } else {
    const h = Number(laborHours);
    const r = Number(laborRate);
    if (Number.isFinite(h) && Number.isFinite(r) && h > 0 && r >= 0) {
      const total = Math.round(h * r * 100) / 100;
      items.push({
        kind: 'labor',
        description: 'Labor',
        qty: h,
        unit_price: r,
        total,
      });
    }
    if (materialsYes) {
      for (const row of materialRows) {
        const q = Number(row.qty);
        const up = Number(row.unit_price);
        if (!row.description.trim() || !Number.isFinite(q) || !Number.isFinite(up) || q <= 0) continue;
        const total = Math.round(q * up * 100) / 100;
        items.push({
          kind: 'material',
          description: row.description.trim(),
          qty: q,
          unit_price: up,
          total,
        });
      }
    }
  }

  const subtotal = Math.round(items.reduce((s, i) => s + i.total, 0) * 100) / 100;
  return { line_items: items, subtotal };
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
      return parseExistingIntoState(job, existingInvoice, profile);
    }
    return {
      fixedTotal: job.price,
      laborHours: '',
      laborRate: '',
      materialsYes: null as boolean | null,
      materialRows: [{ description: '', qty: '1', unit_price: '' }] as MaterialRow[],
      due_date: defaultDueDateYmd(),
      taxPercent: taxRateToPercentValue(profile.default_tax_rate ?? DEFAULT_TAX_RATE),
      selectedPaymentMethods: defaultPaymentSelection(profile),
    };
  }, [job, existingInvoice, profile]);

  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [pricingSubStep, setPricingSubStep] = useState<PricingSubStep | null>(() => {
    if (job.price_type === 'fixed') return null;
    return 'labor';
  });

  const [fixedTotal, setFixedTotal] = useState(initial.fixedTotal);
  const [laborHours, setLaborHours] = useState(initial.laborHours);
  const [laborRate, setLaborRate] = useState(initial.laborRate);
  const [materialsYes, setMaterialsYes] = useState<boolean | null>(initial.materialsYes);
  const [materialRows, setMaterialRows] = useState<MaterialRow[]>(initial.materialRows);
  const [dueDate, setDueDate] = useState(initial.due_date);
  const [taxPercent, setTaxPercent] = useState(initial.taxPercent);
  const [selectedPaymentMethods, setSelectedPaymentMethods] = useState<string[]>(
    initial.selectedPaymentMethods
  );

  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const togglePayment = (method: string) => {
    setSelectedPaymentMethods((prev) =>
      prev.includes(method) ? prev.filter((m) => m !== method) : [...prev, method]
    );
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

  const { subtotal } = buildLineItemsAndTotals(
    job,
    fixedTotal,
    laborHours,
    laborRate,
    materialsYes === true,
    materialRows
  );
  const taxRate = normalizeTaxRate(percentValueToTaxRate(taxPercent));
  const tax_amount = Math.round(subtotal * taxRate * 100) / 100;
  const total = Math.round((subtotal + tax_amount) * 100) / 100;

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
    const h = Number(laborHours);
    const r = Number(laborRate);
    if (!Number.isFinite(h) || !Number.isFinite(r) || h <= 0 || r < 0) {
      setError('Enter hours and rate.');
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
    const built = buildLineItemsAndTotals(
      job,
      fixedTotal,
      laborHours,
      laborRate,
      materialsYes === true,
      materialRows
    );
    if (built.subtotal <= 0) {
      setError('Subtotal must be greater than zero.');
      return;
    }
    if (selectedPaymentMethods.length === 0) {
      setError('Select at least one payment method.');
      return;
    }
    const normalizedTaxRate = normalizeTaxRate(percentValueToTaxRate(taxPercent));
    const ta = Math.round(built.subtotal * normalizedTaxRate * 100) / 100;
    const tot = Math.round((built.subtotal + ta) * 100) / 100;
    const invoice_date = new Date().toISOString().split('T')[0];

    setSubmitting(true);
    try {
      if (existingInvoice) {
        const next: Invoice = {
          ...existingInvoice,
          invoice_date: existingInvoice.invoice_date,
          due_date: dueDate,
          line_items: built.line_items,
          subtotal: built.subtotal,
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
          line_items: built.line_items,
          subtotal: built.subtotal,
          tax_rate: normalizedTaxRate,
          tax_amount: ta,
          total: tot,
          payment_methods: selectedPaymentMethods,
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
          <div className="form-group">
            <label htmlFor="fixed-total">Total amount</label>
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
          <div className="form-group">
            <label htmlFor="labor-hours">Hours</label>
            <input
              id="labor-hours"
              type="number"
              min={0}
              step="0.25"
              value={laborHours}
              onChange={(e) => setLaborHours(e.target.value)}
            />
          </div>
          <div className="form-group">
            <label htmlFor="labor-rate">Rate ($)</label>
            <input
              id="labor-rate"
              type="number"
              min={0}
              step="0.01"
              value={laborRate}
              onChange={(e) => setLaborRate(e.target.value)}
            />
          </div>
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
