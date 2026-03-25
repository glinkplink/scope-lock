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

/** Built without numbers; `assignSequentialSectionNumbers` fills 1…n (signature block stays 0). */
interface AgreementSectionDraft {
  title: string;
  blocks: SectionContentBlock[];
  signatureData?: SignatureBlockData;
  isSignature?: boolean;
}

function assignSequentialSectionNumbers(drafts: AgreementSectionDraft[]): AgreementSection[] {
  let num = 1;
  return drafts.map((d) => {
    if (d.isSignature) {
      return {
        title: d.title,
        number: 0,
        blocks: d.blocks,
        signatureData: d.signatureData,
      };
    }
    return { title: d.title, number: num++, blocks: d.blocks };
  });
}

export function generateAgreement(job: WelderJob, profile: BusinessProfile | null): AgreementSection[] {
  const drafts: AgreementSectionDraft[] = [];

  const priceTypeLabel =
    job.price_type === 'fixed' ? 'Fixed Price' :
    job.price_type === 'estimate' ? 'Estimate' :
    'Time & Materials';

  const balanceDue = Math.max(0, job.price - job.deposit_amount);

  // 1. Parties & Project Information — two-column party grid + full-width date/address
  drafts.push({
    title: 'Parties & Project Information',
    blocks: [
      {
        type: 'partiesLayout',
        agreementDate: formatDate(job.agreement_date),
        serviceProvider: {
          businessName: profile?.business_name ?? '',
          phone: profile?.phone ?? '',
          email: profile?.email ?? '',
        },
        customer: {
          name: job.customer_name,
          phone: job.customer_phone,
          email: job.customer_email || '',
        },
        jobSiteAddress: job.job_location,
      },
    ],
  });

  // 2. Project Overview
  const jobTypeLabel =
    job.job_type === 'other' && job.other_classification
      ? job.other_classification
      : capitalizeFirst(job.job_type);
  const overviewRows: [string, string][] = [
    ['Job type', jobTypeLabel],
    ['Item / Structure', job.asset_or_item_description],
    ['Work Requested', job.requested_work],
    ['Target Start Date', formatDate(job.target_start)],
    ['Target Completion Date', formatDate(job.target_completion_date)],
  ];
  drafts.push({
    title: 'Project Overview',
    blocks: [{ type: 'table', rows: overviewRows }],
  });

  // 3. Scope of Work
  const scopeItems: string[] = [];
  if (job.requested_work) scopeItems.push(job.requested_work);
  if (job.installation_included) scopeItems.push('Installation of repaired/fabricated components');
  if (job.grinding_included) scopeItems.push('Grinding welds smooth');
  if (job.paint_or_coating_included) scopeItems.push('Paint or coating application');
  if (job.removal_or_disassembly_included) scopeItems.push('Removal and/or disassembly of existing components');

  const materialsProviderName = profile?.business_name?.trim() || 'Service Provider';
  const materialsText =
    job.materials_provided_by === 'welder'
      ? `All materials will be provided by ${materialsProviderName}.`
      : `All materials will be provided by ${CUSTOMER}.`;

  const scopeBlocks: SectionContentBlock[] = [];
  if (scopeItems.length > 0) {
    scopeBlocks.push({ type: 'bullets', items: scopeItems });
  }
  scopeBlocks.push({ type: 'paragraph', text: materialsText });
  drafts.push({ title: 'Scope of Work', blocks: scopeBlocks });

  // Exclusions — omit entire section if no non-empty items (job list only; profile defaults
  // are copied into new drafts in App, not substituted here — cleared lines stay omitted)
  const effectiveExclusions = normalizeBulletList(job.exclusions);
  if (effectiveExclusions.length > 0) {
    drafts.push({
      title: 'Exclusions',
      blocks: [{ type: 'bullets', items: effectiveExclusions }],
    });
  }

  // Customer Obligations — omit entire section (including mobilization note) if no bullets
  const effectiveObligations = normalizeBulletList(job.customer_obligations);
  if (effectiveObligations.length > 0) {
    drafts.push({
      title: 'Customer Obligations & Site Conditions',
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
  drafts.push({ title: 'Pricing & Payment Terms', blocks: pricingBlocks });

  const completionOpeningWithWarranty =
    `Upon completion of the work and ${CUSTOMER} approval, responsibility for the repaired/fabricated item transfers back to ${CUSTOMER}. ${SERVICE_PROVIDER_CAP} is only responsible for workmanship defects as outlined in the Workmanship Warranty section.`;
  const completionOpeningNoWarranty =
    `Upon completion of the work and ${CUSTOMER} approval, responsibility for the repaired/fabricated item transfers back to ${CUSTOMER}.`;

  const changeOrderClause =
    `Any work outside the agreed scope requires approval from ${CUSTOMER} before ${SERVICE_PROVIDER} proceeds. Extra work may cost more and take longer; ${SERVICE_PROVIDER_CAP} will give an estimate before starting that work.`;
  const hiddenDamageClause =
    `If hidden damage appears during the job that could not reasonably be seen during the initial inspection, ${SERVICE_PROVIDER} will notify ${CUSTOMER} before doing more work to address it. Any added work for hidden damage may cost more and requires ${CUSTOMER}'s approval.`;

  const hasChangeOrdersSection = job.change_order_required || job.hidden_damage_possible;
  if (hasChangeOrdersSection) {
    const changeOrdersHiddenDamageBlocks: SectionContentBlock[] = [];
    if (job.change_order_required) {
      changeOrdersHiddenDamageBlocks.push({ type: 'paragraph', text: changeOrderClause });
    }
    if (job.hidden_damage_possible) {
      changeOrdersHiddenDamageBlocks.push({ type: 'paragraph', text: hiddenDamageClause });
    }
    if (job.workmanship_warranty_days <= 0) {
      changeOrdersHiddenDamageBlocks.push({
        type: 'paragraph',
        text: completionOpeningNoWarranty,
      });
    }
    drafts.push({
      title: 'Change Orders & Hidden Damage',
      blocks: changeOrdersHiddenDamageBlocks,
    });
  } else if (job.workmanship_warranty_days <= 0) {
    // Completion opening lived in this section when warranty is off; keep it if the whole CO/Hidden block is omitted
    drafts.push({
      title: 'Completion & Acceptance',
      blocks: [{ type: 'paragraph', text: completionOpeningNoWarranty }],
    });
  }

  // Workmanship Warranty (omitted if warranty days is 0; completion opening folded in when present)
  if (job.workmanship_warranty_days > 0) {
    drafts.push({
      title: 'Workmanship Warranty',
      blocks: [
        { type: 'paragraph', text: completionOpeningWithWarranty },
        {
          type: 'paragraph',
          text: `${SERVICE_PROVIDER_CAP} guarantees the welding workmanship for ${job.workmanship_warranty_days} days from the completion date.`,
        },
        { type: 'paragraph', text: 'Covers:' },
        {
          type: 'bullets',
          items: [
            'Defects in welding workmanship',
            'Failure of weld joints under normal use',
          ],
        },
        { type: 'paragraph', text: 'Does NOT Cover:' },
        {
          type: 'bullets',
          items: [
            'Misuse or abuse of the repaired item',
            'Modifications made after completion',
            'Damage from accidents, impacts, or overloading',
            'Normal wear and tear',
            'Rust or corrosion (unless specifically coated)',
            'Structural failures unrelated to the weld repair',
          ],
        },
      ],
    });
  }

  // Liability & Indemnification (includes former Third-Party Work)
  const priceText = job.price > 0 ? formatPrice(job.price) : 'the Total Contract Price';
  const customerCap = CUSTOMER.charAt(0).toUpperCase() + CUSTOMER.slice(1);
  drafts.push({
    title: 'Liability & Indemnification',
    blocks: [{
      type: 'paragraph',
      text: `${SERVICE_PROVIDER_CAP}'s total liability under this agreement shall not exceed ${priceText}. ${SERVICE_PROVIDER_CAP} shall not be liable for indirect, incidental, or consequential damages. ${customerCap} agrees to indemnify and hold ${SERVICE_PROVIDER} harmless from claims arising from ${CUSTOMER}'s misuse or modification of the work after completion. Additionally, ${SERVICE_PROVIDER_CAP} is not responsible for work performed by other contractors, modifications made after completion of this agreement, issues arising from prior repairs or work by others, or damage caused by misuse after work completion.`,
    }],
  });

  // Cancellation & Rescheduling
  drafts.push({
    title: 'Cancellation & Rescheduling',
    blocks: [{
      type: 'paragraph',
      text: `Either party may cancel this Agreement before work commences with 24 hours written notice. If ${CUSTOMER} cancels after work has commenced, ${CUSTOMER} shall pay for work completed to date plus any materials purchased. The deposit is non-refundable if the Service Provider has mobilized to the job site.`,
    }],
  });

  // Dispute Resolution (omitted if negotiation period is 0)
  if (job.negotiation_period > 0) {
    drafts.push({
      title: 'Dispute Resolution',
      blocks: [{
        type: 'paragraph',
        text: `The parties agree to attempt to resolve any dispute arising under this Agreement through good-faith negotiation first. If negotiation fails within ${job.negotiation_period} days, the parties agree to non-binding mediation before pursuing litigation. This Agreement shall be governed by and construed under the laws of the applicable state.`,
      }],
    });
  }

  // Signature page (unnumbered in preview; `number` 0); entire-agreement line above signature lines
  drafts.push({
    title: 'Signatures & Acceptance',
    blocks: [
      {
        type: 'paragraph',
        text: 'This document constitutes the entire agreement and supersedes all prior discussions. Modifications must be in writing and signed by both parties.',
      },
      { type: 'signature' },
    ],
    signatureData: getSignatureBlockData(job, profile),
    isSignature: true,
  });

  return assignSequentialSectionNumbers(drafts);
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
          if (block.type === 'partiesLayout') {
            const { agreementDate, serviceProvider: sp, customer: cu, jobSiteAddress } = block;
            return [
              `AGREEMENT DATE: ${agreementDate}`,
              '',
              `SERVICE PROVIDER | CUSTOMER`,
              `NAME | ${sp.businessName} | ${cu.name}`,
              `PHONE | ${sp.phone} | ${cu.phone}`,
              `EMAIL | ${sp.email} | ${cu.email}`,
              '',
              `JOB SITE ADDRESS: ${jobSiteAddress}`,
            ].join('\n');
          }
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
