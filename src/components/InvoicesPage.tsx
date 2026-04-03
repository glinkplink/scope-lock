import { useEffect, useState } from 'react';
import type { ChangeOrder, Job, Invoice, InvoiceLineItem } from '../types/db';
import type { InvoiceWithCustomerName } from '../lib/db/invoices';
import { listInvoicesWithCustomerName, getInvoiceBusinessStatus } from '../lib/db/invoices';
import { getJobById } from '../lib/db/jobs';
import { getChangeOrderById } from '../lib/db/change-orders';
import { formatUsd } from '../lib/work-order-dashboard-display';
import './WorkOrdersPage.css';
import './InvoicesPage.css';

interface InvoicesPageProps {
  userId: string;
  onOpenInvoice: (job: Job, invoice: Invoice) => void;
  onOpenCoInvoice: (job: Job, changeOrder: ChangeOrder, invoice: Invoice) => void;
}

/** Returns the single CO id if exactly one unique change_order_id exists across line items; otherwise null. */
function getSingleCoId(lineItems: InvoiceLineItem[]): string | null {
  const ids = new Set(
    lineItems.map((i) => i.change_order_id).filter((id): id is string => Boolean(id))
  );
  return ids.size === 1 ? [...ids][0] : null;
}

function formatInvoiceDate(dateStr: string): string {
  const d = new Date(dateStr + 'T00:00:00');
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

function formatInvoiceLabel(invoiceNumber: number): string {
  return `INV #${String(invoiceNumber).padStart(4, '0')}`;
}

/** Matches `formatWorkOrderDashboardWoLabel` in `work-order-dashboard-display.ts`. */
function formatWoLabel(woNumber: number | null): string {
  return woNumber != null ? `WO #${String(woNumber).padStart(4, '0')}` : 'WO (no #)';
}

function invoiceRowStatusPill(invoice: InvoiceWithCustomerName): { className: string; label: string } {
  const businessStatus = getInvoiceBusinessStatus(invoice);
  if (invoice.payment_status === 'paid') {
    return { className: 'wo-row-invoice-btn wo-row-invoice-btn--paid', label: 'Paid' };
  }
  if (invoice.payment_status === 'offline') {
    return { className: 'wo-row-invoice-btn wo-row-invoice-btn--offline', label: 'Paid Offline' };
  }
  if (businessStatus === 'draft') {
    return { className: 'wo-row-invoice-btn wo-row-invoice-btn--draft', label: 'Draft' };
  }
  return { className: 'wo-row-invoice-btn wo-row-invoice-btn--invoiced', label: 'Invoiced' };
}

interface InvoiceRowProps {
  invoice: InvoiceWithCustomerName;
  busy: boolean;
  onOpen: (invoice: InvoiceWithCustomerName) => void;
}

/** Row DOM mirrors `WorkOrderRow` in `WorkOrdersPage.tsx` so `WorkOrdersPage.css` applies. */
function InvoiceRow({ invoice, busy, onOpen }: InvoiceRowProps) {
  const pill = invoiceRowStatusPill(invoice);

  return (
    <li className={`work-orders-row${busy ? ' work-orders-row--busy' : ''}`}>
      <div className="work-orders-row-main">
        <button
          type="button"
          className="work-orders-row-detail-hit"
          onClick={() => onOpen(invoice)}
          disabled={busy}
        >
          <span className="work-orders-row-heading">
            <span className="work-orders-wo">{formatInvoiceLabel(invoice.invoice_number)}</span>
            <span className="work-orders-wo-date">{`· ${formatInvoiceDate(invoice.invoice_date)}`}</span>
          </span>
          <span className="work-orders-customer">{invoice.customer_name ?? '—'}</span>
          <span className="invoices-row-wo-line">{formatWoLabel(invoice.wo_number)}</span>
        </button>
      </div>
      <div className="work-orders-row-actions">
        <div className="invoices-row-actions-stack">
          <span className="invoices-row-amount">{formatUsd(invoice.total)}</span>
          <span className={pill.className}>{pill.label}</span>
        </div>
      </div>
    </li>
  );
}

export function InvoicesPage({ userId, onOpenInvoice, onOpenCoInvoice }: InvoicesPageProps) {
  const [invoices, setInvoices] = useState<InvoiceWithCustomerName[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    /* eslint-disable react-hooks/set-state-in-effect -- reset state before async fetch when userId changes */
    setLoading(true);
    setError(null);
    setInvoices([]);
    /* eslint-enable react-hooks/set-state-in-effect */

    void listInvoicesWithCustomerName(userId).then((result) => {
      if (cancelled) return;
      setInvoices(result);
      setLoading(false);
    }).catch(() => {
      if (cancelled) return;
      setError('Failed to load invoices.');
      setLoading(false);
    });

    return () => { cancelled = true; };
  }, [userId]);

  const handleRowOpen = async (invoice: InvoiceWithCustomerName) => {
    if (busyId) return;
    setBusyId(invoice.id);
    try {
      const coId = getSingleCoId(invoice.line_items);
      const job = await getJobById(invoice.job_id);
      if (!job) {
        setBusyId(null);
        return;
      }
      if (coId) {
        const changeOrder = await getChangeOrderById(coId);
        if (changeOrder) {
          onOpenCoInvoice(job, changeOrder, invoice);
          return;
        }
      }
      onOpenInvoice(job, invoice);
    } catch {
      setBusyId(null);
    }
  };

  return (
    <div className="invoices-page work-orders-page">
      <div className="work-orders-toolbar">
        <h1 className="work-orders-title">Invoices</h1>
      </div>

      {loading && (
        <div className="work-orders-loading">Loading…</div>
      )}

      {!loading && error && (
        <div className="invoices-page-status invoices-page-status--error">{error}</div>
      )}

      {!loading && !error && invoices.length === 0 && (
        <div className="work-orders-loading">No invoices yet.</div>
      )}

      {!loading && !error && invoices.length > 0 && (
        <ul className="work-orders-list">
          {invoices.map((inv) => (
            <InvoiceRow
              key={inv.id}
              invoice={inv}
              busy={busyId === inv.id}
              onOpen={handleRowOpen}
            />
          ))}
        </ul>
      )}
    </div>
  );
}
