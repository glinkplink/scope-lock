import type { Job, BusinessProfile, ChangeOrder, ChangeOrderLineItem } from '../types/db';
import type { WelderJob } from '../types';
import type { EsignSendDocumentsPayload } from './esign-api';
import { esc } from './html-escape';
import { jobLocationSingleLine } from './job-site-address';
import { buildDocusealHtmlHeader, buildDocusealHtmlFooter, buildDocusealEsignFooterLine } from './docuseal-header-footer';
import {
  docusealGoogleFontLinks,
  docusealAgreementEmbeddedStyles,
  docusealUsDateToday,
} from './docuseal-agreement-html';
import { DOCUSEAL_CUSTOMER_ROLE } from './docuseal-constants';
import { jobRowToWelderJob } from './job-to-welder-job';

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
  return '$' + n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
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
    <div class="parties-layout co-doc-parties">
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
          <span class="parties-plain-label">Job Site:</span>
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

const FIELD_STYLE_INLINE =
  'width: 220px; height: 22px; display: inline-block; margin-bottom: -4px; vertical-align: middle;';
const FIELD_STYLE_SIG =
  'width: 200px; height: 56px; max-height: 56px; overflow: hidden; display: inline-block; margin-top: 4px; vertical-align: top;';
const FIELD_STYLE_DATE =
  'width: 140px; height: 22px; display: inline-block; margin-bottom: -4px; vertical-align: middle;';

export interface ChangeOrderDocusealEsignOptions {
  providerSignatureDataUrl?: string | null;
}

/**
 * DocuSeal submission parts for a change order: full `documents[].html` plus repeating
 * `html_header` / `html_footer` (matches work order e-sign payload shape).
 */
export function buildDocusealChangeOrderEsignParts(
  co: ChangeOrder,
  job: Job,
  profile: BusinessProfile | null,
  options: ChangeOrderDocusealEsignOptions = {}
): { html: string; html_header: string; html_footer: string } {
  const woNum = job.wo_number != null ? `WO #${String(job.wo_number).padStart(4, '0')}` : 'WO (no #)';
  const coNum = `Change Order #${String(co.co_number).padStart(4, '0')}`;
  const coLabel = coNum;
  const dateStr = formatDate(co.created_at);
  const total = coLineItemsTotal(co.line_items);

  const scheduleBlock = co.time_amount > 0
    ? `
      <h3 class="section-title">Schedule impact</h3>
      <p class="content-paragraph">
        Additional ${esc(String(co.time_amount))} ${esc(co.time_unit)}${co.time_note.trim() ? `. ${esc(co.time_note.trim())}` : ''}.
      </p>`
    : '';

  // Build signature blocks with DocuSeal field tags
  // Customer signs; provider is pre-filled
  const ownerName = profile?.owner_name || profile?.business_name || '';
  const customerName = job.customer_name || '';
  const customerRole = DOCUSEAL_CUSTOMER_ROLE;
  const providerSignatureDataUrl = options.providerSignatureDataUrl;
  const providerSignatureMarkup = providerSignatureDataUrl
    ? `<img class="signature-autofill-image" src="${esc(providerSignatureDataUrl)}" alt="Service provider signature" />`
    : `<div class="signature-autofill-name">${esc(ownerName)}</div>`;

  const signatureSection = co.requires_approval
    ? `
      <div class="signature-blocks">
        <div class="signature-block">
          <div class="signature-block-identifier">Customer</div>
          <div class="signature-field">
            <span class="signature-field-label">Name</span>
            <text-field name="customer_printed_name" role="${esc(customerRole)}" default_value="${esc(customerName)}" style="${FIELD_STYLE_INLINE}"></text-field>
          </div>
          <div class="signature-field">
            <span class="signature-field-label">Signature</span>
            <signature-field name="customer_signature" role="${esc(customerRole)}" format="drawn_or_typed" required="true" style="${FIELD_STYLE_SIG}"></signature-field>
          </div>
          <div class="signature-field">
            <span class="signature-field-label">Date</span>
            <date-field name="customer_signed_date" role="${esc(customerRole)}" required="true" readonly="true" default_value="${esc(docusealUsDateToday())}" style="${FIELD_STYLE_DATE}"></date-field>
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
            <div class="signature-field-value">${providerSignatureMarkup}</div>
          </div>
          <div class="signature-field">
            <span class="signature-field-label">Date</span>
            <div class="signature-field-value">${esc(formatDate(new Date().toISOString()))}</div>
          </div>
        </div>
      </div>`
    : `
      <div class="signature-blocks">
        <div class="signature-block">
          <div class="signature-block-identifier">Approval</div>
          <p class="content-paragraph">This change order has been documented and does not require separate approval per the agreement terms.</p>
        </div>
      </div>`;

  const bodyContent = `
    <div class="agreement-document change-order-document">
      <h2 class="invoice-title">${coNum}</h2>
      <p class="co-doc-wo-ref">Applies to ${esc(woNum)}</p>
      ${partiesMarkup(dateStr, profile, job)}
      <div class="co-doc-main">
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
      </div>
      ${signatureSection}
    </div>
  `;

  const welderJob: WelderJob = jobRowToWelderJob(job, profile);
  const footerLine = buildDocusealEsignFooterLine(profile, welderJob);
  const html_header = buildDocusealHtmlHeader(coLabel);
  const html_footer = buildDocusealHtmlFooter(footerLine);

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8"/>
  ${docusealGoogleFontLinks()}
  ${docusealAgreementEmbeddedStyles()}
</head>
<body>
${bodyContent}
</body>
</html>`;

  return { html, html_header, html_footer };
}

/** DocuSeal `message` for change-order send/resend (no HTML document build). */
export function buildChangeOrderEsignNotificationMessage(
  co: ChangeOrder,
  job: Job,
  profile: BusinessProfile | null
): { subject: string; body: string } {
  const coLabelNum = String(co.co_number).padStart(4, '0');
  const contractorName = profile?.business_name ?? 'Your Contractor';
  const signerName = profile?.owner_name ?? contractorName;
  const customerFirst = job.customer_name.split(' ')[0] || job.customer_name;
  const woRef = job.wo_number != null
    ? `Work Order #${String(job.wo_number).padStart(4, '0')}`
    : 'your project';
  const woParenthetical = job.wo_number != null
    ? ` (WO #${String(job.wo_number).padStart(4, '0')})`
    : '';
  const location = jobLocationSingleLine(job.job_location);
  const descriptionSnippet = co.description.trim().length > 0
    ? `\nChange: ${co.description.trim().split('\n')[0]}`
    : '';
  return {
    subject: `${contractorName} sent you a Change Order to sign — CO #${coLabelNum}${woParenthetical}`,
    body: `Hi ${customerFirst},\n\n${contractorName} has issued a Change Order against ${woRef}${location ? ` at ${location}` : ''} that requires your review and signature.\n\nReference: Change Order #${coLabelNum}${descriptionSnippet}\n\nPlease review and sign using the link below:\n\n{{submitter.link}}\n\nThank you,\n${signerName}\n${contractorName}`,
  };
}

export function buildChangeOrderEsignSendPayload(
  co: ChangeOrder,
  job: Job,
  profile: BusinessProfile | null,
  options: ChangeOrderDocusealEsignOptions = {}
): EsignSendDocumentsPayload {
  const coLabelNum = String(co.co_number).padStart(4, '0');
  const { html, html_header, html_footer } = buildDocusealChangeOrderEsignParts(co, job, profile, options);
  return {
    name: `Change Order #${coLabelNum}`,
    send_email: true,
    documents: [
      {
        name: `Change Order #${coLabelNum}`,
        html,
        html_header,
        html_footer,
      },
    ],
    message: buildChangeOrderEsignNotificationMessage(co, job, profile),
  };
}
