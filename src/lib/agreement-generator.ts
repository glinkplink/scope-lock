import type { WelderJob, AgreementSection } from '../types';

// Section content uses plain text with \n line breaks and • bullets.
// A future structured content model would separate data from formatting,
// which would be necessary for proper HTML rendering or PDF generation.

export function generateAgreement(job: WelderJob): AgreementSection[] {
  const sections: AgreementSection[] = [];

  // 1. Agreement Header
  sections.push({
    title: 'WELDING SERVICES AGREEMENT',
    content: generateHeader(job),
  });

  // 2. Project Overview
  sections.push({
    title: 'PROJECT OVERVIEW',
    content: generateProjectOverview(job),
  });

  // 3. Scope of Work
  sections.push({
    title: 'SCOPE OF WORK',
    content: generateScopeOfWork(job),
  });

  // 4. Materials
  sections.push({
    title: 'MATERIALS',
    content: generateMaterialsSection(job),
  });

  // 5. Exclusions
  sections.push({
    title: 'EXCLUSIONS',
    content: generateExclusions(job),
  });

  // 6. Hidden Damage Clause
  if (job.hidden_damage_possible) {
    sections.push({
      title: 'HIDDEN DAMAGE CLAUSE',
      content: generateHiddenDamageClause(),
    });
  }

  // 7. Third-Party Work Clause
  sections.push({
    title: 'THIRD-PARTY WORK',
    content: generateThirdPartyClause(),
  });

  // 8. Change Orders
  if (job.change_order_required) {
    sections.push({
      title: 'CHANGE ORDERS',
      content: generateChangeOrderClause(),
    });
  }

  // 9. Pricing and Payment Terms
  sections.push({
    title: 'PRICING AND PAYMENT',
    content: generatePricingSection(job),
  });

  // 10. Completion and Responsibility Transfer
  sections.push({
    title: 'COMPLETION AND RESPONSIBILITY',
    content: generateCompletionClause(),
  });

  // 11. Workmanship Warranty
  sections.push({
    title: 'WORKMANSHIP WARRANTY',
    content: generateWarrantySection(job),
  });

  // 12. Client Acknowledgment
  sections.push({
    title: 'CLIENT ACKNOWLEDGMENT',
    content: generateClientAcknowledgment(job),
  });

  return sections;
}

function generateHeader(job: WelderJob): string {
  const today = new Date().toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });

  return `Date: ${today}

Contractor: [Your Business Name]
Client: ${job.customer_name}
Job Location: ${job.job_location}
Phone: ${job.customer_phone}`;
}

function generateProjectOverview(job: WelderJob): string {
  return `Item/Structure: ${job.asset_or_item_description}

Work Requested: ${job.requested_work}

Job Type: ${capitalizeFirst(job.job_type)}`;
}

function generateScopeOfWork(job: WelderJob): string {
  const items: string[] = [];

  if (job.installation_included) {
    items.push('Installation of repaired/fabricated components');
  }

  if (job.grinding_included) {
    items.push('Grinding welds smooth');
  }

  if (job.paint_or_coating_included) {
    items.push('Paint or coating application');
  }

  if (job.removal_or_disassembly_included) {
    items.push('Removal and/or disassembly of existing components');
  }

  if (items.length === 0) {
    return `• ${job.requested_work}`;
  }

  return items.map((item) => `• ${item}`).join('\n');
}

function generateMaterialsSection(job: WelderJob): string {
  const providerText =
    job.materials_provided_by === 'welder'
      ? 'All materials will be provided by the Contractor (welder).'
      : job.materials_provided_by === 'customer'
        ? 'All materials will be provided by the Client (customer).'
        : 'Materials will be provided by both parties as agreed.';

  return providerText;
}

function generateExclusions(job: WelderJob): string {
  if (job.exclusions.length === 0) {
    return 'None specified.';
  }

  return job.exclusions.map((exclusion) => `• ${exclusion}`).join('\n');
}

function generateHiddenDamageClause(): string {
  return `If hidden damage is discovered during repair work that was not visible during initial inspection, the Contractor will notify the Client before proceeding. Additional work required to address hidden damage may result in additional charges and will require Client approval.`;
}

function generateThirdPartyClause(): string {
  return `The Contractor is not responsible for:
• Work performed by other contractors
• Modifications made after completion of this agreement
• Issues arising from prior repairs or work by others
• Damage caused by misuse after work completion`;
}

function generateChangeOrderClause(): string {
  return `Any work outside the agreed scope requires written or verbal approval from the Client before proceeding. Change orders may result in additional charges and timeline adjustments. The Contractor will provide an estimate for any additional work before proceeding.`;
}

function generatePricingSection(job: WelderJob): string {
  const priceTypeText = job.price_type === 'fixed' ? 'Fixed Price' : 'Estimate';
  const depositText = job.deposit_required ? 'Deposit Required: Yes' : 'Deposit Required: No';

  // Parse date parts directly to avoid UTC midnight shifting the displayed day
  const [year, month, day] = job.target_completion_date.split('-').map(Number);
  const completionDate = new Date(year, month - 1, day).toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });

  return `Total Price: $${job.price.toLocaleString()}
Price Type: ${priceTypeText}
${depositText}
Payment Terms: ${job.payment_terms}
Target Completion: ${completionDate}`;
}

function generateCompletionClause(): string {
  return `Upon completion of the work and Client approval, responsibility for the repaired/fabricated item transfers back to the Client. The Contractor is only responsible for workmanship defects as outlined in the Workmanship Warranty section.`;
}

function generateWarrantySection(job: WelderJob): string {
  return `The Contractor guarantees the welding workmanship for ${job.workmanship_warranty_days} days from completion date.

This warranty covers:
• Defects in welding workmanship
• Failure of weld joints under normal use

This warranty DOES NOT cover:
• Misuse or abuse of the repaired item
• Modifications made after completion
• Damage from accidents, impacts, or overloading
• Normal wear and tear
• Rust or corrosion (unless specifically coated)
• Structural failures unrelated to the weld repair`;
}

function generateClientAcknowledgment(job: WelderJob): string {
  return `By signing below, the Client confirms:

✓ Agreement to the scope of work outlined above
✓ Understanding of exclusions and limitations
✓ Approval of pricing and payment terms
✓ Acknowledgment that responsibility transfers upon completion
✓ Acceptance of workmanship warranty terms

Client Name: ${job.customer_name}

Client Signature: _________________________

Date: _________________________`;
}

function capitalizeFirst(str: string): string {
  return str.charAt(0).toUpperCase() + str.slice(1);
}

export function formatAgreementAsText(sections: AgreementSection[]): string {
  return sections
    .map((section) => `${section.title}\n${'='.repeat(section.title.length)}\n\n${section.content}`)
    .join('\n\n');
}
