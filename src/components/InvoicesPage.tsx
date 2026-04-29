import { useEffect, useState } from 'react';
import type { Job, Invoice } from '../types/db';
import type { InvoiceWithCustomerName } from '../lib/db/invoices';
import {
  listInvoicesWithCustomerName,
  getInvoiceBusinessStatus,
  summarizeInvoiceDashboardRows,
} from '../lib/db/invoices';
import { getJobById } from '../lib/db/jobs';
import { formatUsd, formatUsdContract } from '../lib/work-order-dashboard-display';
import './WorkOrdersPage.css';
import './InvoicesPage.css';

interface InvoicesPageProps {
  userId: string;
  onOpenInvoice: (job: Job, invoice: Invoice) => void;
  onOpenCoInvoice?: () => void;
  onPrefetchInvoiceFinal?: () => void;
}

const INVOICE_FILTER_OPTIONS = [
  'all',
  'draft',
  'pending',
  'paid_stripe',
  'paid_offline',
] as const;

type InvoiceFilterOption = (typeof INVOICE_FILTER_OPTIONS)[number];

const INVOICE_FILTER_LABELS: Record<InvoiceFilterOption, string> = {
  all: 'All',
  draft: 'Unsent',
  pending: 'Pending',
  paid_stripe: 'Paid via Stripe',
  paid_offline: 'Paid offline',
};

function matchesInvoiceFilter(invoice: InvoiceWithCustomerName, filter: InvoiceFilterOption): boolean {
  if (filter === 'all') return true;
  const businessStatus = getInvoiceBusinessStatus(invoice);
  switch (filter) {
    case 'draft':
      return businessStatus === 'draft' && invoice.payment_status !== 'paid' && invoice.payment_status !== 'offline';
    case 'pending':
      return (
        businessStatus === 'invoiced' &&
        invoice.payment_status !== 'paid' &&
        invoice.payment_status !== 'offline'
      );
    case 'paid_stripe':
      return invoice.payment_status === 'paid';
    case 'paid_offline':
      return invoice.payment_status === 'offline';
    default:
      return true;
  }
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

/** Matches `formatWorkOrderDashboardJobType` in `work-order-dashboard-display.ts`. */
function formatJobType(
  jobType: string | null,
  otherClassification: string | null
): string {
  const other = otherClassification?.trim();
  return other || jobType || '—';
}

function invoiceRowStatusPill(invoice: InvoiceWithCustomerName): { className: string; label: string } | null {
  const businessStatus = getInvoiceBusinessStatus(invoice);
  if (invoice.payment_status === 'paid') {
    return { className: 'iw-status-chip iw-status-chip--paid', label: 'Paid' };
  }
  if (invoice.payment_status === 'offline') {
    return { className: 'iw-status-chip iw-status-chip--paid', label: 'Paid' };
  }
  if (invoice.downloaded_at && !invoice.issued_at) {
    return { className: 'iw-status-chip iw-status-chip--draft', label: 'Downloaded' };
  }
  if (businessStatus === 'draft') {
    return null;
  }
  return { className: 'iw-status-chip iw-status-chip--outstanding', label: 'Pending' };
}

function invoiceRowAccentClass(invoice: InvoiceWithCustomerName): string {
  if (invoice.payment_status === 'paid' || invoice.payment_status === 'offline') {
    return 'invoices-row--accent-paid';
  }
  const pill = invoiceRowStatusPill(invoice);
  if (!pill) {
    return 'invoices-row--accent-draft';
  }
  if (pill.label === 'Downloaded') {
    return 'invoices-row--accent-draft';
  }
  if (pill.label === 'Pending') {
    return 'invoices-row--accent-pending';
  }
  return 'invoices-row--accent-draft';
}

function invoiceSearchStatusLabel(invoice: InvoiceWithCustomerName): string {
  const pill = invoiceRowStatusPill(invoice);
  if (pill) return pill.label;
  return getInvoiceBusinessStatus(invoice) === 'draft' ? 'Unsent' : '';
}

function matchesInvoiceSearch(invoice: InvoiceWithCustomerName, searchTerm: string): boolean {
  const trimmed = searchTerm.trim().toLowerCase();
  if (!trimmed) return true;

  const statusLabel = invoiceSearchStatusLabel(invoice);
  const haystack = [
    formatInvoiceLabel(invoice.invoice_number),
    `Invoice #${String(invoice.invoice_number).padStart(4, '0')}`,
    formatWoLabel(invoice.wo_number),
    formatJobType(invoice.job_type, invoice.other_classification),
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
  onPrefetchInvoiceFinal?: () => void;
}

/** Row uses shared work-orders list classes so `WorkOrdersPage.css` applies. */
function InvoiceRow({ invoice, busy, onOpen, onPrefetchInvoiceFinal }: InvoiceRowProps) {
  const pill = invoiceRowStatusPill(invoice);
  const accentClass = invoiceRowAccentClass(invoice);
  const isPaidRow = invoice.payment_status === 'paid' || invoice.payment_status === 'offline';
  const activate = () => {
    if (!busy) onOpen(invoice);
  };

  return (
    <li
      className={`work-orders-row ${accentClass}${isPaidRow ? ' work-orders-row--paid' : ''}${
        busy ? ' work-orders-row--busy' : ''
      }`}
      role="button"
      tabIndex={busy ? -1 : 0}
      aria-label={`Open invoice ${formatInvoiceLabel(invoice.invoice_number)}`}
      onPointerEnter={onPrefetchInvoiceFinal}
      onFocus={onPrefetchInvoiceFinal}
      onClick={activate}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          activate();
        }
      }}
    >
      <div className="work-orders-row-shell">
        <div className="work-orders-row-body">
          <div className="work-orders-row-left">
            <span className="work-orders-row-kicker">
              <span className="work-orders-wo">{formatInvoiceLabel(invoice.invoice_number)}</span>
              {pill ? <span className={pill.className}>{pill.label}</span> : null}
            </span>
            <span className="work-orders-customer">{invoice.customer_name ?? '—'}</span>
            <span className="work-orders-job-type">
              {formatJobType(invoice.job_type, invoice.other_classification)}
            </span>
            <span className="work-orders-row-date-inline">{formatInvoiceDate(invoice.invoice_date)}</span>
          </div>
          <div className="work-orders-row-right">
            <span className="work-orders-row-amount">{formatUsdContract(invoice.total)}</span>
            <span className="invoices-row-wo-below-price">{formatWoLabel(invoice.wo_number)}</span>
          </div>
        </div>
      </div>
    </li>
  );
}

export function InvoicesPage({ userId, onOpenInvoice, onPrefetchInvoiceFinal }: InvoicesPageProps) {
  const [invoices, setInvoices] = useState<InvoiceWithCustomerName[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [activeFilter, setActiveFilter] = useState<InvoiceFilterOption>('all');

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

  const visibleInvoices = invoices.filter(
    (inv) => matchesInvoiceFilter(inv, activeFilter) && matchesInvoiceSearch(inv, searchTerm)
  );
  const totalsSummary = summarizeInvoiceDashboardRows(invoices);

  return (
    <div className="invoices-page work-orders-page work-orders-dashboard-page">
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
          aria-label="Pending and paid invoice totals"
        >
          <div className="work-orders-stat-card work-orders-stat-card--outstanding">
            <div className="work-orders-stat-num">{formatUsd(totalsSummary.invoicedTotal)}</div>
            <div className="work-orders-stat-label">Pending</div>
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
          <div className="work-orders-filter-chips" role="tablist" aria-label="Invoice status filters">
            {INVOICE_FILTER_OPTIONS.map((filter) => {
              const selected = filter === activeFilter;
              return (
                <button
                  key={filter}
                  type="button"
                  role="tab"
                  aria-selected={selected}
                  className={`work-orders-filter-chip${selected ? ' work-orders-filter-chip--active' : ''}`}
                  onClick={() => setActiveFilter(filter)}
                >
                  {INVOICE_FILTER_LABELS[filter]}
                </button>
              );
            })}
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
              onPrefetchInvoiceFinal={onPrefetchInvoiceFinal}
            />
          ))}
        </ul>
      )}
    </div>
  );
}
