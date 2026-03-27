import type { Job, BusinessProfile, ChangeOrder, ChangeOrderLineItem } from '../types/db';
import { jobLocationSingleLine } from './job-site-address';
import { esc } from './html-escape';

function coLineItemsTotal(items: ChangeOrderLineItem[]): number {
  return Math.round(items.reduce((s, i) => s + i.quantity * i.unit_rate, 0) * 100) / 100;
}

function formatDate(iso: string): string {
  if (!iso) return '';
  const d = iso.includes('T') ? iso.split('T')[0] : iso;
  const [year, month, day] = d.split('-').map(Number);
  if (!year || !month || !day) return iso;
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

function partiesMarkup(
  dateLabel: string,
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
          <span class="parties-plain-label">Date:</span>
          <span class="parties-plain-value">${esc(dateLabel)}</span>
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

function lineItemsRows(items: ChangeOrderLineItem[]): string {
  return items
    .map(
      (row) => `
    <tr>
      <td class="table-value">${esc(row.description)}</td>
      <td class="table-value" style="text-align:right">${esc(String(row.quantity))}</td>
      <td class="table-value" style="text-align:right">${esc(formatPrice(row.unit_rate))}</td>
      <td class="table-value" style="text-align:right">${esc(formatPrice(row.quantity * row.unit_rate))}</td>
    </tr>
  `
    )
    .join('');
}

function signatureBlocks(job: Job, profile: BusinessProfile | null): string {
  const d = new Date();
  const ownerDate = `${d.getMonth() + 1}/${d.getDate()}/${d.getFullYear()}`;
  const ownerName = profile?.owner_name || profile?.business_name || '';
  return `
<div class="signature-blocks">
  <div class="signature-block">
    <div class="signature-block-identifier">Customer</div>
    <div class="signature-field">
      <span class="signature-field-label">Name</span>
      <div class="signature-field-value">${esc(job.customer_name)}</div>
    </div>
    <div class="signature-field">
      <span class="signature-field-label">Signature</span>
      <div class="signature-field-value"></div>
    </div>
    <div class="signature-field">
      <span class="signature-field-label">Date</span>
      <div class="signature-field-value"></div>
    </div>
  </div>
  <div class="signature-block">
    <div class="signature-block-identifier">Service Provider</div>
    <div class="signature-field">
      <span class="signature-field-label">Name</span>
      <div class="signature-field-value">${esc(ownerName)}</div>
    </div>
    <div class="signature-field">
      <span class="signature-field-label">Signature</span>
      <div class="signature-field-value">
        <div class="signature-autofill-name">${esc(ownerName)}</div>
      </div>
    </div>
    <div class="signature-field">
      <span class="signature-field-label">Date</span>
      <div class="signature-field-value">${esc(ownerDate)}</div>
    </div>
  </div>
</div>`;
}

/** Single change order addendum HTML (body only; wrap with buildPdfHtml for PDF). */
export function generateChangeOrderHtml(
  co: ChangeOrder,
  job: Job,
  profile: BusinessProfile | null
): string {
  const woNum =
    job.wo_number != null ? `WO #${String(job.wo_number).padStart(4, '0')}` : 'WO (no #)';
  const coNum = `Change Order #${String(co.co_number).padStart(4, '0')}`;
  const dateStr = formatDate(co.created_at);
  const total = coLineItemsTotal(co.line_items);
  const scheduleBlock =
    co.time_amount > 0
      ? `
      <h3 class="section-title">Schedule impact</h3>
      <p class="content-paragraph">
        Additional ${esc(String(co.time_amount))} ${esc(co.time_unit)}${co.time_note.trim() ? `. ${esc(co.time_note.trim())}` : ''}.
      </p>`
      : '';

  const approvalBlock = co.requires_approval
    ? `
      <h3 class="section-title">Approval</h3>
      <p class="content-paragraph">The Customer acknowledges and agrees to this change order by signing below.</p>
      ${signatureBlocks(job, profile)}`
    : `
      <h3 class="section-title">Approval</h3>
      <p class="content-paragraph">This change order has been documented and does not require separate approval per the agreement terms.</p>`;

  return `
    <div class="agreement-document change-order-document">
      <h2 class="invoice-title">${coNum}</h2>
      <p class="co-doc-wo-ref">Applies to ${esc(woNum)}</p>
      ${partiesMarkup(dateStr, profile, job)}
      <h3 class="section-title">Description of change</h3>
      <p class="content-paragraph">${esc(co.description).replaceAll('\n', '<br />')}</p>
      <h3 class="section-title">Reason</h3>
      <p class="content-paragraph">${esc(co.reason).replaceAll('\n', '<br />')}</p>
      <h3 class="section-title">Cost adjustment</h3>
      <table class="content-table invoice-line-table">
        <thead>
          <tr>
            <th class="table-label" scope="col">Description</th>
            <th class="table-label" scope="col" style="text-align:right">Qty</th>
            <th class="table-label" scope="col" style="text-align:right">Rate</th>
            <th class="table-label" scope="col" style="text-align:right">Total</th>
          </tr>
        </thead>
        <tbody>
          ${lineItemsRows(co.line_items) || `<tr><td colspan="4" class="table-value">No line items</td></tr>`}
        </tbody>
      </table>
      <p class="content-paragraph" style="text-align:right;font-weight:600;">Total: ${esc(formatPrice(total))}</p>
      ${scheduleBlock}
      ${approvalBlock}
    </div>
  `;
}

/**
 * Work order agreement inner HTML + page breaks + each saved change order.
 * `workOrderInnerHtml` should be `<div class="agreement-document">…sections…</div>`.
 */
export function buildCombinedWorkOrderAndChangeOrdersHtml(
  workOrderInnerHtml: string,
  changeOrders: ChangeOrder[],
  job: Job,
  profile: BusinessProfile | null
): string {
  const parts: string[] = [workOrderInnerHtml];
  for (const co of changeOrders) {
    parts.push(
      `<div class="pdf-page-break" style="page-break-before:always;break-before:page;"></div>${generateChangeOrderHtml(co, job, profile)}`
    );
  }
  return parts.join('\n');
}
