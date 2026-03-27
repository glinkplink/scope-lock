import type { Job, BusinessProfile, Invoice, InvoiceLineItem } from '../types/db';
import { normalizePaymentMethods } from './payment-methods';
import { jobLocationSingleLine } from './job-site-address';
import { esc } from './html-escape';
import { sortInvoiceLineItems } from './invoice-line-items';

/** Fields required to render invoice HTML (persisted row or equivalent draft). */
export type InvoiceDraft = Pick<
  Invoice,
  | 'invoice_number'
  | 'invoice_date'
  | 'due_date'
  | 'line_items'
  | 'subtotal'
  | 'tax_rate'
  | 'tax_amount'
  | 'total'
  | 'payment_methods'
  | 'notes'
>;

function formatDate(iso: string): string {
  if (!iso) return '';
  const [year, month, day] = iso.split('-').map(Number);
  return new Date(year, month - 1, day).toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });
}

function formatPrice(n: number): string {
  return (
    '$' +
    n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
  );
}

function formatTaxPercent(rate: number): string {
  return (rate * 100).toLocaleString('en-US', { maximumFractionDigits: 2 }) + '%';
}

function partiesMarkup(
  invoiceDateLabel: string,
  profile: BusinessProfile | null,
  job: Job
): string {
  const spName = esc(profile?.business_name ?? '');
  const spPhone = esc(profile?.phone ?? '');
  const spEmail = esc(profile?.email ?? '');
  const cuName = esc(job.customer_name);
  const cuPhone = esc(job.customer_phone ?? '');
  const cuEmail = esc(job.customer_email ?? '');
  const jobSite = esc(jobLocationSingleLine(job.job_location));

  return `
    <div class="parties-layout">
      <div class="parties-plain">
        <div class="parties-plain-row">
          <span class="parties-plain-label">Invoice Date:</span>
          <span class="parties-plain-value">${esc(invoiceDateLabel)}</span>
        </div>
      </div>
      <table class="content-table parties-party-table">
        <tbody>
          <tr class="party-table-header-row">
            <th class="party-header-cell party-header-spacer" scope="col" aria-hidden="true">&nbsp;</th>
            <th scope="col" class="party-header-cell">Service Provider</th>
            <th scope="col" class="party-header-cell">Customer</th>
          </tr>
          <tr>
            <td class="table-label">Name</td>
            <td class="table-value">${spName}</td>
            <td class="table-value">${cuName}</td>
          </tr>
          <tr>
            <td class="table-label">Phone</td>
            <td class="table-value">${spPhone}</td>
            <td class="table-value">${cuPhone}</td>
          </tr>
          <tr>
            <td class="table-label">Email</td>
            <td class="table-value">${spEmail}</td>
            <td class="table-value">${cuEmail}</td>
          </tr>
        </tbody>
      </table>
      <div class="parties-plain">
        <div class="parties-plain-row">
          <span class="parties-plain-label">Job Site Address:</span>
          <span class="parties-plain-value">${jobSite}</span>
        </div>
      </div>
    </div>
  `;
}

function lineItemsRows(items: InvoiceLineItem[]): string {
  const ordered = sortInvoiceLineItems(items);

  return ordered
    .map(
      (row) => `
    <tr>
      <td class="table-value">${esc(row.description)}</td>
      <td class="table-value" style="text-align:right">${esc(String(row.qty))}</td>
      <td class="table-value" style="text-align:right">${esc(formatPrice(row.unit_price))}</td>
      <td class="table-value" style="text-align:right">${esc(formatPrice(row.total))}</td>
    </tr>
  `
    )
    .join('');
}

export function generateInvoiceHtml(
  invoice: Invoice | InvoiceDraft,
  job: Job,
  profile: BusinessProfile | null
): string {
  const invoiceDateStr = formatDate(invoice.invoice_date);
  const dueDateStr = formatDate(invoice.due_date);
  const rows = lineItemsRows(invoice.line_items);

  const paymentMethods = normalizePaymentMethods(invoice.payment_methods);
  const paymentList =
    paymentMethods.length > 0
      ? `<ul class="content-bullets invoice-payment-list">${paymentMethods
          .map((m) => `<li>${esc(m)}</li>`)
          .join('')}</ul>`
      : '<p class="content-note">No payment methods listed.</p>';

  const notesBlock =
    invoice.notes?.trim()
      ? `<div class="invoice-notes-section">
          <h3 class="section-title">Notes</h3>
          <p class="content-paragraph">${esc(invoice.notes.trim()).replaceAll('\n', '<br />')}</p>
        </div>`
      : '';

  return `
    <div class="agreement-document invoice-document">
      <h2 class="invoice-title">INVOICE</h2>
      ${partiesMarkup(invoiceDateStr, profile, job)}
      <div class="invoice-details-block">
        <table class="content-table">
          <tbody>
            <tr>
              <td class="table-label">Invoice date</td>
              <td class="table-value">${esc(invoiceDateStr)}</td>
            </tr>
            <tr>
              <td class="table-label">Due date</td>
              <td class="table-value invoice-due-date">${esc(dueDateStr)}</td>
            </tr>
          </tbody>
        </table>
      </div>
      <h3 class="section-title">Line items</h3>
      <table class="content-table invoice-line-table">
        <thead>
          <tr>
            <th class="table-label" scope="col">Description</th>
            <th class="table-label" scope="col" style="text-align:right">Qty</th>
            <th class="table-label" scope="col" style="text-align:right">Unit price</th>
            <th class="table-label" scope="col" style="text-align:right">Total</th>
          </tr>
        </thead>
        <tbody>
          ${rows || `<tr><td colspan="4" class="table-value">No line items</td></tr>`}
        </tbody>
      </table>
      <div class="invoice-totals-block">
        <table class="invoice-totals-table">
          <tbody>
            <tr>
              <td class="table-label">Subtotal</td>
              <td class="table-value" style="text-align:right">${esc(formatPrice(invoice.subtotal))}</td>
            </tr>
            <tr>
              <td class="table-label">Tax (${esc(formatTaxPercent(invoice.tax_rate))})</td>
              <td class="table-value" style="text-align:right">${esc(formatPrice(invoice.tax_amount))}</td>
            </tr>
            <tr class="invoice-total-row">
              <td class="table-label"><strong>Total</strong></td>
              <td class="table-value" style="text-align:right"><strong>${esc(formatPrice(invoice.total))}</strong></td>
            </tr>
          </tbody>
        </table>
      </div>
      <h3 class="section-title">Payment methods</h3>
      ${paymentList}
      ${notesBlock}
    </div>
  `;
}
