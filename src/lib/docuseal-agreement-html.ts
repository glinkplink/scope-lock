import type { AgreementSection, SectionContentBlock, SignatureBlockData } from '../types';
import { esc } from './html-escape';
import { DOCUSEAL_CUSTOMER_ROLE } from './docuseal-constants';

/**
 * Embedded print-oriented CSS for DocuSeal HTML submissions (no App.css in their renderer).
 * Mirrors agreement-document rules from App.css with literal colors.
 */
export function docusealAgreementEmbeddedStyles(): string {
  return `<style>
    /* DocuSeal (and similar paginated viewers) repeat the WO header on each page but do not repeat
       padding on a fragmenting root box — so only page 1 gets air below the chrome. Per-section top
       padding on sections 2+ restores ~the same gap when a section starts mid-document (incl. new pages).
       Tighter padding-bottom + no margin-bottom keeps same-page section spacing in line with PDF. */
    .agreement-document {
      position: relative; border: 1px solid #C8C4BC; border-radius: 4px; padding: 24px;
      -webkit-box-decoration-break: clone;
      box-decoration-break: clone;
      background: #fff; font-family: Barlow, system-ui, sans-serif;
    }
    .agreement-section {
      margin-bottom: 0; padding-bottom: 0.5rem; break-inside: avoid; page-break-inside: avoid;
    }
    .agreement-section:not(:first-child) { padding-top: 24px; }
    .agreement-section:last-child { padding-bottom: 0; }
    .section-title { font-size: 0.875rem; font-weight: 700; letter-spacing: 0.04em; color: #1C3A5E; margin: 0 0 1rem; padding-bottom: 0.5rem; border-bottom: 2px solid #1C3A5E; }
    .section-content { color: #1A1917; }
    .content-paragraph { margin: 0 0 1rem; font-size: 0.9375rem; line-height: 1.45; text-align: left; color: #1A1917; }
    .content-paragraph:last-child { margin-bottom: 0; }
    .content-note { margin: -0.2rem 0 1rem; font-size: 0.78rem; line-height: 1.5; font-style: italic; color: #8A8680; }
    .content-bullets { margin: 0 0 1rem; padding-left: 1.35rem; list-style-type: disc; color: #1A1917; }
    .content-bullets li + li { margin-top: 0.4rem; }
    .content-table { width: 100%; border-collapse: collapse; border: 1px solid #C8C4BC; margin-bottom: 1rem; table-layout: fixed; }
    .content-table td { padding: 0.7rem 0.8rem; vertical-align: top; border: 1px solid #C8C4BC; box-sizing: border-box; }
    .table-label { width: 34%; font-size: 0.78rem; font-weight: 700; letter-spacing: 0.08em; text-transform: uppercase; background: #E8EEF5; color: #1C3A5E; }
    .table-value { font-size: 0.95rem; line-height: 1.55; background: #fff; color: #1A1917; white-space: pre-wrap; overflow-wrap: break-word; }
    .parties-layout { margin-bottom: 1rem; }
    .parties-plain { margin-bottom: 1rem; }
    .parties-plain-row { display: flex; flex-wrap: wrap; align-items: baseline; column-gap: 1rem; row-gap: 0.25rem; }
    .parties-plain-label { font-size: 0.78rem; font-weight: 700; letter-spacing: 0.08em; text-transform: uppercase; color: #1C3A5E; flex-shrink: 0; }
    .parties-plain-value { flex: 1 1 0; font-size: 0.95rem; line-height: 1.55; color: #1A1917; overflow-wrap: break-word; }
    .content-table.parties-party-table td.table-label { width: 26%; }
    .content-table.parties-party-table td.table-value { width: 37%; overflow-wrap: anywhere; word-break: break-word; }
    .content-table.parties-party-table tr.party-table-header-row th.party-header-cell { width: 26%; font-size: 0.78rem; font-weight: 700; letter-spacing: 0.08em; text-transform: uppercase; text-align: left; background: #E8EEF5; color: #1C3A5E; padding: 0.7rem 0.8rem; border: 1px solid #C8C4BC; }
    .content-table.parties-party-table tr.party-table-header-row th.party-header-cell:nth-child(2),
    .content-table.parties-party-table tr.party-table-header-row th.party-header-cell:nth-child(3) { width: 37%; }
    .signature-blocks { margin-top: 1.75rem; padding-top: 1rem; }
    .signature-block { margin-bottom: 1.5rem; }
    .signature-block + .signature-block { margin-top: 1.5rem; padding-top: 1rem; }
    .signature-block-identifier { font-size: 0.825rem; font-weight: 700; letter-spacing: 0.02em; text-transform: uppercase; color: #1C3A5E; margin-bottom: 1rem; }
    .signature-field { margin-bottom: 1rem; }
    .signature-field-label { display: block; font-size: 0.75rem; font-weight: 600; text-transform: uppercase; color: #8A8680; margin-bottom: 2px; }
    .signature-field-value { min-height: 1.5em; border-bottom: 1px solid #1A1917; padding-bottom: 2px; font-size: 0.9375rem; color: #1A1917; }
    .signature-autofill-name { font-family: 'Dancing Script', cursive; font-size: 20pt; line-height: 1.15; font-weight: 400; color: #1A1917; margin-bottom: -4px; }
  </style>`;
}

const FIELD_STYLE_INLINE =
  'width: 220px; height: 22px; display: inline-block; margin-bottom: -4px; vertical-align: middle;';
const FIELD_STYLE_SIG =
  'width: 220px; height: 72px; display: inline-block; margin-top: 4px; vertical-align: top;';
const FIELD_STYLE_DATE =
  'width: 140px; height: 22px; display: inline-block; margin-bottom: -4px; vertical-align: middle;';

function docusealBlockHtml(block: SectionContentBlock, signatureData: SignatureBlockData | undefined): string {
  if (block.type === 'paragraph') {
    return `<p class="content-paragraph">${esc(block.text)}</p>`;
  }
  if (block.type === 'note') {
    return `<p class="content-note">${esc(block.text)}</p>`;
  }
  if (block.type === 'bullets') {
    const items = block.items.map((item) => `<li>${esc(item)}</li>`).join('');
    return `<ul class="content-bullets">${items}</ul>`;
  }
  if (block.type === 'table') {
    const rows = block.rows
      .map(
        ([label, value]) =>
          `<tr><td class="table-label">${esc(label)}</td><td class="table-value">${esc(value)}</td></tr>`
      )
      .join('');
    return `<table class="content-table"><tbody>${rows}</tbody></table>`;
  }
  if (block.type === 'partiesLayout') {
    const { agreementDate, serviceProvider: sp, customer: cu, jobSiteAddress } = block;
    return `
<div class="parties-layout">
  <div class="parties-plain">
    <div class="parties-plain-row">
      <span class="parties-plain-label">Agreement Date:</span>
      <span class="parties-plain-value">${esc(agreementDate)}</span>
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
        <td class="table-value">${esc(sp.businessName)}</td>
        <td class="table-value">${esc(cu.name)}</td>
      </tr>
      <tr>
        <td class="table-label">Phone</td>
        <td class="table-value">${esc(sp.phone)}</td>
        <td class="table-value">${esc(cu.phone)}</td>
      </tr>
      <tr>
        <td class="table-label">Email</td>
        <td class="table-value">${esc(sp.email)}</td>
        <td class="table-value">${esc(cu.email)}</td>
      </tr>
    </tbody>
  </table>
  <div class="parties-plain">
    <div class="parties-plain-row">
      <span class="parties-plain-label">Job Site Address:</span>
      <span class="parties-plain-value">${esc(jobSiteAddress)}</span>
    </div>
  </div>
</div>`;
  }
  if (block.type === 'signature') {
    const sig = signatureData;
    if (!sig) return '';
    const role = DOCUSEAL_CUSTOMER_ROLE;
    return `
<div class="signature-blocks">
  <div class="signature-block">
    <div class="signature-block-identifier">${esc('Customer')}</div>
    <div class="signature-field">
      <span class="signature-field-label">Name</span>
      <text-field name="Customer Name" role="${esc(role)}" required="true" style="${FIELD_STYLE_INLINE}"></text-field>
    </div>
    <div class="signature-field">
      <span class="signature-field-label">Signature</span>
      <div>
        <signature-field name="Customer Signature" role="${esc(role)}" format="drawn_or_typed" required="true" style="${FIELD_STYLE_SIG}"></signature-field>
      </div>
    </div>
    <div class="signature-field">
      <span class="signature-field-label">Date</span>
      <date-field name="Customer Date" role="${esc(role)}" required="true" style="${FIELD_STYLE_DATE}"></date-field>
    </div>
  </div>
  <div class="signature-block">
    <div class="signature-block-identifier">Service Provider</div>
    <div class="signature-field">
      <span class="signature-field-label">Name</span>
      <div class="signature-field-value">${esc(sig.ownerName)}</div>
    </div>
    <div class="signature-field">
      <span class="signature-field-label">Signature</span>
      <div class="signature-field-value">
        <div class="signature-autofill-name">${esc(sig.ownerName)}</div>
      </div>
    </div>
    <div class="signature-field">
      <span class="signature-field-label">Date</span>
      <div class="signature-field-value">${esc(sig.ownerDate)}</div>
    </div>
  </div>
</div>`;
  }
  return '';
}

/** Inner HTML for agreement sections (DocuSeal field tags + shared styles via wrapper). */
export function agreementSectionsToDocusealSectionsInnerHtml(sections: AgreementSection[]): string {
  return sections
    .map((section) => {
      const sigClass = section.signatureData ? ' signature-section' : '';
      const num =
        section.number > 0 ? `${section.number}. ${esc(section.title)}` : esc(section.title);
      const inner = section.blocks
        .map((b) => docusealBlockHtml(b, section.signatureData))
        .join('\n');
      return `<div class="agreement-section${sigClass}">
  <h3 class="section-title">${num}</h3>
  <div class="section-content">${inner}</div>
</div>`;
    })
    .join('\n');
}

/**
 * Full HTML document for `documents[].html` — includes embedded styles and `.agreement-document` root.
 */
export function buildDocusealWorkOrderHtmlDocument(sections: AgreementSection[]): string {
  const inner = agreementSectionsToDocusealSectionsInnerHtml(sections);
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8"/>
  ${docusealAgreementEmbeddedStyles()}
</head>
<body>
<div class="agreement-document">
${inner}
</div>
</body>
</html>`;
}
