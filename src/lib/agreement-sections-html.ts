import type { AgreementSection, SectionContentBlock, SignatureBlockData } from '../types';

function esc(value: string | number | null | undefined): string {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function blockHtml(block: SectionContentBlock, signatureData: SignatureBlockData | undefined): string {
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
    return `
<div class="signature-blocks">
  <div class="signature-block">
    <div class="signature-block-identifier">Customer</div>
    <div class="signature-field">
      <span class="signature-field-label">Name</span>
      <div class="signature-field-value">${esc(sig.customerName)}</div>
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

/** Serializes agreement sections to HTML matching AgreementDocumentSections (for PDF string path). */
export function agreementSectionsToHtml(sections: AgreementSection[]): string {
  return sections
    .map((section) => {
      const sigClass = section.signatureData ? ' signature-section' : '';
      const num =
        section.number > 0 ? `${section.number}. ${esc(section.title)}` : esc(section.title);
      const inner = section.blocks
        .map((b) => blockHtml(b, section.signatureData))
        .join('\n');
      return `<div class="agreement-section${sigClass}">
  <h3 class="section-title">${num}</h3>
  <div class="section-content">${inner}</div>
</div>`;
    })
    .join('\n');
}
