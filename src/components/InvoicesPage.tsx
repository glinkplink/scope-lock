import { useEffect, useState } from 'react';
import type { Job, Invoice } from '../types/db';
import type { InvoiceWithCustomerName } from '../lib/db/invoices';
import {
  listInvoicesWithCustomerName,
  getInvoiceBusinessStatus,
  summarizeInvoiceDashboardRows,
} from '../lib/db/invoices';
import { getJobById } from '../lib/db/jobs';
import { formatUsd } from '../lib/work-order-dashboard-display';
import './WorkOrdersPage.css';
import './InvoicesPage.css';

interface InvoicesPageProps {
  userId: string;
  onOpenInvoice: (job: Job, invoice: Invoice) => void;
  onOpenCoInvoice?: () => void;
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
    return { className: 'iw-status-chip iw-status-chip--paid', label: 'Paid' };
  }
  if (invoice.payment_status === 'offline') {
    return { className: 'iw-status-chip iw-status-chip--offline', label: 'Paid offline' };
  }
  if (businessStatus === 'draft') {
    return { className: 'iw-status-chip iw-status-chip--draft', label: 'Draft' };
  }
  return { className: 'iw-status-chip iw-status-chip--outstanding', label: 'Invoiced' };
}

function matchesInvoiceSearch(invoice: InvoiceWithCustomerName, searchTerm: string): boolean {
  const trimmed = searchTerm.trim().toLowerCase();
  if (!trimmed) return true;

  const statusLabel = invoiceRowStatusPill(invoice).label;
  const haystack = [
    formatInvoiceLabel(invoice.invoice_number),
    `Invoice #${String(invoice.invoice_number).padStart(4, '0')}`,
    formatWoLabel(invoice.wo_number),
    invoice.customer_name,
    statusLabel,
    formatUsd(invoice.total),
    invoice.total.toFixed(2),
    formatInvoiceDate(invoice.invoice_date),
    invoice.invoice_date,
  ]
    .filter((value): value is string => Boolean(value))
    .join(' ')
    .toLowerCase();

  return haystack.includes(trimmed);
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
      <button
        type="button"
        className="invoices-row-full-hit"
        disabled={busy}
        onClick={() => onOpen(invoice)}
      >
        <div className="work-orders-row-main">
          <span className="work-orders-row-heading">
            <span className="work-orders-wo">{formatInvoiceLabel(invoice.invoice_number)}</span>
            <span className="work-orders-wo-date">{`· ${formatInvoiceDate(invoice.invoice_date)}`}</span>
          </span>
          <span className="work-orders-customer">{invoice.customer_name ?? '—'}</span>
          <span className="invoices-row-wo-line">{formatWoLabel(invoice.wo_number)}</span>
        </div>
        <div className="work-orders-row-actions">
          <div className="invoices-row-actions-stack">
            <span className="invoices-row-amount">{formatUsd(invoice.total)}</span>
            <span className={pill.className}>{pill.label}</span>
          </div>
        </div>
      </button>
    </li>
  );
}

export function InvoicesPage({ userId, onOpenInvoice }: InvoicesPageProps) {
  const [invoices, setInvoices] = useState<InvoiceWithCustomerName[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [searchTerm, setSearchTerm] = useState('');

  useEffect(() => {
    let cancelled = false;
    /* eslint-disable react-hooks/set-state-in-effect -- reset state before async fetch when userId changes */
    setLoading(true);
    setError(null);
    setInvoices([]);
    /* eslint-enable react-hooks/set-state-in-effect */

    void listInvoicesWithCustomerName(userId)
      .then((listResult) => {
        if (cancelled) return;
        if (listResult.error) {
          setError('Failed to load invoices.');
          setInvoices([]);
          setLoading(false);
          return;
        }
        setInvoices(listResult.data);
        setLoading(false);
      })
      .catch(() => {
        if (cancelled) return;
        setError('Failed to load invoices.');
        setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [userId]);

  const handleRowOpen = async (invoice: InvoiceWithCustomerName) => {
    if (busyId) return;
    setBusyId(invoice.id);
    try {
      const job = await getJobById(invoice.job_id);
      if (!job) {
        setBusyId(null);
        return;
      }
      onOpenInvoice(job, invoice);
    } catch {
      setBusyId(null);
    }
  };

  const visibleInvoices = invoices.filter((inv) => matchesInvoiceSearch(inv, searchTerm));
  const totalsSummary = summarizeInvoiceDashboardRows(invoices);

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
        <div
          className="work-orders-stat-strip"
          role="group"
          aria-label="Outstanding and paid invoice totals"
        >
          <div className="work-orders-stat-card work-orders-stat-card--outstanding">
            <div className="work-orders-stat-num">{formatUsd(totalsSummary.invoicedTotal)}</div>
            <div className="work-orders-stat-label">Outstanding</div>
          </div>
          <div className="work-orders-stat-card work-orders-stat-card--paid">
            <div className="work-orders-stat-num">{formatUsd(totalsSummary.paidTotal)}</div>
            <div className="work-orders-stat-label">Paid</div>
          </div>
        </div>
      )}

      {!loading && !error && invoices.length > 0 && (
        <div className="work-orders-filters invoices-filters">
          <div className="form-group work-orders-search-group">
            <label htmlFor="invoices-search">Search invoices</label>
            <input
              id="invoices-search"
              type="search"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              placeholder="Search invoice, WO, customer, status, amount, or date"
              autoComplete="off"
            />
          </div>
        </div>
      )}

      {!loading && !error && invoices.length > 0 && visibleInvoices.length === 0 && (
        <div className="work-orders-filtered-empty-state">
          <p className="work-orders-empty-title">No invoices match</p>
          <p className="work-orders-empty-lead">Try a different invoice number, customer, amount, date, or status.</p>
        </div>
      )}

      {!loading && !error && visibleInvoices.length > 0 && (
        <ul className="work-orders-list">
          {visibleInvoices.map((inv) => (
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
