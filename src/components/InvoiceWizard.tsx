import { useMemo, useState } from 'react';
import type { Job, BusinessProfile, Invoice, InvoiceLineItem } from '../types/db';
import { createInvoice, updateInvoice } from '../lib/db/invoices';

const PAYMENT_METHOD_OPTIONS = ['Cash', 'Check', 'Zelle', 'Venmo', 'Card'] as const;

const TAX_RATE = 0.06;

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
  const fromProfile = profile.default_payment_methods?.filter(Boolean) ?? [];
  if (fromProfile.length > 0) return [...fromProfile];
  return [...PAYMENT_METHOD_OPTIONS];
}

function parseExistingIntoState(job: Job, existing: Invoice) {
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
    selectedPaymentMethods: [...existing.payment_methods],
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
      return parseExistingIntoState(job, existingInvoice);
    }
    return {
      fixedTotal: job.price,
      laborHours: '',
      laborRate: '',
      materialsYes: null as boolean | null,
      materialRows: [{ description: '', qty: '1', unit_price: '' }] as MaterialRow[],
      due_date: defaultDueDateYmd(),
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
  const tax_amount = Math.round(subtotal * TAX_RATE * 100) / 100;
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
    const ta = Math.round(built.subtotal * TAX_RATE * 100) / 100;
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
          tax_rate: TAX_RATE,
          tax_amount: ta,
          total: tot,
          payment_methods: selectedPaymentMethods,
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
          tax_rate: TAX_RATE,
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
        <button type="button" className="btn-secondary" onClick={onCancel}>
          Cancel
        </button>
      </div>

      {error ? (
        <div className="error-banner" role="alert">
          {error}
        </div>
      ) : null}

      {step === 1 && job.price_type === 'fixed' ? (
        <section className="invoice-wizard-step">
          <h2 className="invoice-wizard-step-title">Pricing</h2>
          <p className="invoice-wizard-hint">
            Work order:{' '}
            {job.wo_number != null ? `WO #${String(job.wo_number).padStart(4, '0')}` : 'No WO #'}
          </p>
          <label className="field-label" htmlFor="fixed-total">
            Total amount
          </label>
          <input
            id="fixed-total"
            type="number"
            min={0}
            step="0.01"
            className="field-input"
            value={fixedTotal}
            onChange={(e) => setFixedTotal(Number(e.target.value))}
          />
          <p className="invoice-wizard-live-total">
            Subtotal (preview): ${subtotal.toFixed(2)} · Tax: ${tax_amount.toFixed(2)} · Total: $
            {total.toFixed(2)}
          </p>
          <button type="button" className="btn-primary" onClick={handleFixedConfirm}>
            Confirm
          </button>
        </section>
      ) : null}

      {step === 1 && job.price_type !== 'fixed' && pricingSubStep === 'labor' ? (
        <section className="invoice-wizard-step">
          <h2 className="invoice-wizard-step-title">Pricing — Labor</h2>
          <div className="invoice-wizard-field-row">
            <label className="field-label" htmlFor="labor-hours">
              Hours
            </label>
            <input
              id="labor-hours"
              type="number"
              min={0}
              step="0.25"
              className="field-input"
              value={laborHours}
              onChange={(e) => setLaborHours(e.target.value)}
            />
          </div>
          <div className="invoice-wizard-field-row">
            <label className="field-label" htmlFor="labor-rate">
              Rate ($)
            </label>
            <input
              id="labor-rate"
              type="number"
              min={0}
              step="0.01"
              className="field-input"
              value={laborRate}
              onChange={(e) => setLaborRate(e.target.value)}
            />
          </div>
          <p className="invoice-wizard-live-total">
            Subtotal (preview): ${subtotal.toFixed(2)} · Tax: ${tax_amount.toFixed(2)} · Total: $
            {total.toFixed(2)}
          </p>
          <button type="button" className="btn-primary" onClick={handleLaborContinue}>
            Continue
          </button>
        </section>
      ) : null}

      {step === 1 && job.price_type !== 'fixed' && pricingSubStep === 'materials' ? (
        <section className="invoice-wizard-step">
          <h2 className="invoice-wizard-step-title">Pricing — Materials</h2>
          <fieldset className="invoice-wizard-yesno">
            <legend className="field-label">Add materials?</legend>
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
          </fieldset>
          {materialsYes === true ? (
            <div className="invoice-material-rows">
              {materialRows.map((row, index) => (
                <div key={index} className="invoice-material-row">
                  <input
                    type="text"
                    className="field-input"
                    placeholder="Description"
                    value={row.description}
                    onChange={(e) => updateMaterialRow(index, { description: e.target.value })}
                  />
                  <input
                    type="number"
                    className="field-input"
                    placeholder="Qty"
                    min={0}
                    step="0.01"
                    value={row.qty}
                    onChange={(e) => updateMaterialRow(index, { qty: e.target.value })}
                  />
                  <input
                    type="number"
                    className="field-input"
                    placeholder="Unit price"
                    min={0}
                    step="0.01"
                    value={row.unit_price}
                    onChange={(e) => updateMaterialRow(index, { unit_price: e.target.value })}
                  />
                  {materialRows.length > 1 ? (
                    <button
                      type="button"
                      className="btn-text"
                      onClick={() => removeMaterialRow(index)}
                    >
                      Remove
                    </button>
                  ) : null}
                </div>
              ))}
              <button type="button" className="btn-secondary" onClick={addMaterialRow}>
                Add row
              </button>
            </div>
          ) : null}
          <p className="invoice-wizard-live-total">
            Subtotal (preview): ${subtotal.toFixed(2)} · Tax: ${tax_amount.toFixed(2)} · Total: $
            {total.toFixed(2)}
          </p>
          <button type="button" className="btn-primary" onClick={handleMaterialsContinue}>
            Continue
          </button>
        </section>
      ) : null}

      {step === 2 ? (
        <section className="invoice-wizard-step">
          <h2 className="invoice-wizard-step-title">Due Date</h2>
          <label className="field-label" htmlFor="due-date">
            Due date
          </label>
          <input
            id="due-date"
            type="date"
            className="field-input"
            value={dueDate}
            onChange={(e) => setDueDate(e.target.value)}
          />
          <button type="button" className="btn-primary" onClick={handleDueDateContinue}>
            Continue
          </button>
        </section>
      ) : null}

      {step === 3 ? (
        <section className="invoice-wizard-step">
          <h2 className="invoice-wizard-step-title">Payment Methods</h2>
          <p className="invoice-wizard-hint">Choose methods to show on this invoice.</p>
          <div className="invoice-payment-checkboxes">
            {PAYMENT_METHOD_OPTIONS.map((method) => (
              <label key={method} className="invoice-wizard-check">
                <input
                  type="checkbox"
                  checked={selectedPaymentMethods.includes(method)}
                  onChange={() => togglePayment(method)}
                />
                {method}
              </label>
            ))}
          </div>
          <button
            type="button"
            className="btn-primary btn-large"
            disabled={submitting}
            onClick={() => void handleGenerate()}
          >
            {existingInvoice ? 'Save Invoice' : 'Generate Invoice'}
          </button>
        </section>
      ) : null}
    </div>
  );
}
