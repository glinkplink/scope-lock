import type { WelderJob, AgreementSection, SectionContentBlock, SignatureBlockData } from '../types';
import type { BusinessProfile } from '../types/db';

const SERVICE_PROVIDER = 'the Service Provider';
const SERVICE_PROVIDER_CAP = 'The Service Provider';
const CUSTOMER = 'the Customer';

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
  return '$' + n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function capitalizeFirst(str: string): string {
  return str.charAt(0).toUpperCase() + str.slice(1);
}

/** Trim and drop blanks so profile/job lists with only empty strings count as empty. */
function normalizeBulletList(items: string[]): string[] {
  return items.map((s) => s.trim()).filter(Boolean);
}

function getSignatureBlockData(job: WelderJob, profile: BusinessProfile | null): SignatureBlockData {
  const d = new Date();
  const ownerDate = `${d.getMonth() + 1}/${d.getDate()}/${d.getFullYear()}`;
  return {
    customerName: job.customer_name,
    ownerName: profile?.owner_name || profile?.business_name || '',
    ownerDate,
  };
}

export function generateAgreement(job: WelderJob, profile: BusinessProfile | null): AgreementSection[] {
  const sections: AgreementSection[] = [];

  const priceTypeLabel =
    job.price_type === 'fixed' ? 'Fixed Price' :
    job.price_type === 'estimate' ? 'Estimate' :
    'Time & Materials';

  const balanceDue = Math.max(0, job.price - job.deposit_amount);

  // 1. Parties & Project Information — Service Provider from profile (not editable on WO form)
  const partiesRows: [string, string][] = [
    ['Agreement Date', formatDate(job.agreement_date)],
    ['Service Provider', profile?.business_name ?? ''],
    ['SP Phone', profile?.phone ?? ''],
    ['SP Email', profile?.email ?? ''],
    ['Customer Name', job.customer_name],
    ['Customer Phone', job.customer_phone],
    ['Customer Email', job.customer_email || ''],
    ['Job Site Address', job.job_location],
  ];
  sections.push({
    title: 'Parties & Project Information',
    number: 1,
    blocks: [{ type: 'table', rows: partiesRows }],
  });

  // 2. Project Overview
  const jobClassification = job.job_classification === 'other' && job.other_classification
    ? job.other_classification
    : capitalizeFirst(job.job_classification);
  const overviewRows: [string, string][] = [
    ['Item / Structure', job.asset_or_item_description],
    ['Work Requested', job.requested_work],
    ['Job Classification', jobClassification],
    ['Target Start', formatDate(job.target_start)],
    ['Target Completion', formatDate(job.target_completion_date)],
  ];
  sections.push({
    title: 'Project Overview',
    number: 2,
    blocks: [{ type: 'table', rows: overviewRows }],
  });

  // 3. Scope of Work
  const scopeItems: string[] = [];
  if (job.requested_work) scopeItems.push(job.requested_work);
  if (job.installation_included) scopeItems.push('Installation of repaired/fabricated components');
  if (job.grinding_included) scopeItems.push('Grinding welds smooth');
  if (job.paint_or_coating_included) scopeItems.push('Paint or coating application');
  if (job.removal_or_disassembly_included) scopeItems.push('Removal and/or disassembly of existing components');

  const materialsText =
    job.materials_provided_by === 'welder'
      ? `All materials will be provided by ${SERVICE_PROVIDER}.`
      : job.materials_provided_by === 'customer'
      ? `All materials will be provided by ${CUSTOMER}.`
      : 'Materials will be provided by both parties as agreed.';

  const scopeBlocks: SectionContentBlock[] = [];
  if (scopeItems.length > 0) {
    scopeBlocks.push({ type: 'bullets', items: scopeItems });
  }
  scopeBlocks.push({ type: 'paragraph', text: materialsText });
  sections.push({ title: 'Scope of Work', number: 3, blocks: scopeBlocks });

  // 4. Exclusions — omit entire section if no non-empty items (stable section numbers: still "4." when present)
  const rawExclusions =
    job.exclusions.length > 0 ? job.exclusions : (profile?.default_exclusions ?? []);
  const effectiveExclusions = normalizeBulletList(rawExclusions);
  if (effectiveExclusions.length > 0) {
    sections.push({
      title: 'Exclusions',
      number: 4,
      blocks: [{ type: 'bullets', items: effectiveExclusions }],
    });
  }

  // 5. Customer Obligations — omit entire section (including mobilization note) if no bullets
  const rawObligations =
    job.customer_obligations.length > 0
      ? job.customer_obligations
      : (profile?.default_assumptions ?? []);
  const effectiveObligations = normalizeBulletList(rawObligations);
  if (effectiveObligations.length > 0) {
    sections.push({
      title: 'Customer Obligations & Site Conditions',
      number: 5,
      blocks: [
        { type: 'bullets', items: effectiveObligations },
        {
          type: 'note',
          text: 'Failure to meet site conditions may result in rescheduling and/or a mobilization fee.',
        },
      ],
    });
  }

  // 6. Pricing & Payment Terms
  const pricingRows: [string, string][] = [
    ['Price Type', priceTypeLabel],
    ['Total Contract Price', formatPrice(job.price)],
    ['Deposit Required', job.deposit_amount > 0 ? formatPrice(job.deposit_amount) : 'None'],
    ['Balance Due', formatPrice(balanceDue)],
  ];
  const pricingBlocks: SectionContentBlock[] = [{ type: 'table', rows: pricingRows }];
  const salesTaxNote =
    'Note: Customers are subject to applicable state and local sales tax on labor and materials as required by law. Service Provider will include applicable taxes on the final invoice.';
  pricingBlocks.push({ type: 'note', text: salesTaxNote });
  const lateTerms = job.late_payment_terms?.trim();
  if (lateTerms) {
    pricingBlocks.push({ type: 'note', text: lateTerms });
  }
  sections.push({ title: 'Pricing & Payment Terms', number: 6, blocks: pricingBlocks });

  // 7. Change Orders
  sections.push({
    title: 'Change Orders',
    number: 7,
    blocks: [{
      type: 'paragraph',
      text: `Any work outside the agreed scope requires written or verbal approval from ${CUSTOMER} before proceeding. Change orders may result in additional charges and timeline adjustments. ${SERVICE_PROVIDER_CAP} will provide an estimate for any additional work before proceeding.`,
    }],
  });

  // 8. Hidden Damage
  sections.push({
    title: 'Hidden Damage',
    number: 8,
    blocks: [{
      type: 'paragraph',
      text: `If hidden damage is discovered during repair work that was not visible during initial inspection, ${SERVICE_PROVIDER} will notify ${CUSTOMER} before proceeding. Additional work required to address hidden damage may result in additional charges and will require ${CUSTOMER} approval.`,
    }],
  });

  // 9. Completion & Acceptance
  const completionText =
    job.workmanship_warranty_days > 0
      ? `Upon completion of the work and ${CUSTOMER} approval, responsibility for the repaired/fabricated item transfers back to ${CUSTOMER}. ${SERVICE_PROVIDER_CAP} is only responsible for workmanship defects as outlined in the Workmanship Warranty section.`
      : `Upon completion of the work and ${CUSTOMER} approval, responsibility for the repaired/fabricated item transfers back to ${CUSTOMER}.`;
  sections.push({
    title: 'Completion & Acceptance',
    number: 9,
    blocks: [{ type: 'paragraph', text: completionText }],
  });

  // 10. Workmanship Warranty (omitted if warranty days is 0)
  if (job.workmanship_warranty_days > 0) {
    sections.push({
      title: 'Workmanship Warranty',
      number: 10,
      blocks: [
        {
          type: 'paragraph',
          text: `${SERVICE_PROVIDER_CAP} guarantees the welding workmanship for ${job.workmanship_warranty_days} days from the completion date.`,
        },
        {
          type: 'bullets',
          items: [
            'Covers: Defects in welding workmanship',
            'Covers: Failure of weld joints under normal use',
            'Does NOT cover: Misuse or abuse of the repaired item',
            'Does NOT cover: Modifications made after completion',
            'Does NOT cover: Damage from accidents, impacts, or overloading',
            'Does NOT cover: Normal wear and tear',
            'Does NOT cover: Rust or corrosion (unless specifically coated)',
            'Does NOT cover: Structural failures unrelated to the weld repair',
          ],
        },
      ],
    });
  }

  // 11. Liability & Indemnification
  const priceText = job.price > 0 ? formatPrice(job.price) : 'the Total Contract Price';
  sections.push({
    title: 'Liability & Indemnification',
    number: 11,
    blocks: [{
      type: 'paragraph',
      text: `${SERVICE_PROVIDER_CAP}'s total liability under this agreement shall not exceed ${priceText}. ${SERVICE_PROVIDER_CAP} shall not be liable for indirect, incidental, or consequential damages. ${CUSTOMER.charAt(0).toUpperCase() + CUSTOMER.slice(1)} agrees to indemnify and hold ${SERVICE_PROVIDER} harmless from claims arising from ${CUSTOMER}'s misuse or modification of the work after completion.`,
    }],
  });

  // 12. Third-Party Work
  sections.push({
    title: 'Third-Party Work',
    number: 12,
    blocks: [{
      type: 'paragraph',
      text: `${SERVICE_PROVIDER_CAP} is not responsible for work performed by other contractors, modifications made after completion of this agreement, issues arising from prior repairs or work by others, or damage caused by misuse after work completion.`,
    }],
  });

  // 13. Cancellation & Rescheduling
  sections.push({
    title: 'Cancellation & Rescheduling',
    number: 13,
    blocks: [{
      type: 'paragraph',
      text: `Either party may cancel this Agreement before work commences with 24 hours written notice. If ${CUSTOMER} cancels after work has commenced, ${CUSTOMER} shall pay for work completed to date plus any materials purchased. The deposit is non-refundable if the Service Provider has mobilized to the job site.`,
    }],
  });

  // 14. Dispute Resolution (omitted if negotiation period is 0)
  if (job.negotiation_period > 0) {
    sections.push({
      title: 'Dispute Resolution',
      number: 14,
      blocks: [{
        type: 'paragraph',
        text: `The parties agree to attempt to resolve any dispute arising under this Agreement through good-faith negotiation first. If negotiation fails within ${job.negotiation_period} days, the parties agree to non-binding mediation before pursuing litigation. This Agreement shall be governed by and construed under the laws of the applicable state.`,
      }],
    });
  }

  // 15. Entire Agreement
  sections.push({
    title: 'Entire Agreement',
    number: 15,
    blocks: [{
      type: 'paragraph',
      text: `This document constitutes the entire agreement between the parties and supersedes all prior discussions, representations, or agreements. Any modifications to this agreement must be made in writing and signed by both parties.`,
    }],
  });

  // Signature page
  sections.push({
    title: 'Signatures & Acceptance',
    number: 0,
    blocks: [{ type: 'signature' }],
    signatureData: getSignatureBlockData(job, profile),
  });

  return sections;
}

export function formatAgreementAsText(sections: AgreementSection[]): string {
  return sections
    .map((section) => {
      const header = section.number > 0
        ? `${section.number}. ${section.title}`
        : section.title;

      const body = section.blocks
        .map((block) => {
          if (block.type === 'paragraph') return block.text;
          if (block.type === 'note') return block.text;
          if (block.type === 'bullets') return block.items.map((i) => `• ${i}`).join('\n');
          if (block.type === 'table') return block.rows.map(([k, v]) => `${k}: ${v}`).join('\n');
          if (block.type === 'signature') {
            const s = section.signatureData;
            if (!s) return '';
            return `Customer\nName: ${s.customerName}\nSignature: _________________________\nDate: _________________________\n\nService Provider\nName: ${s.ownerName}\nSignature: ${s.ownerName}\nDate: ${s.ownerDate}`;
          }
          return '';
        })
        .join('\n\n');

      return `${header}\n\n${body}`;
    })
    .join('\n\n\n');
}
