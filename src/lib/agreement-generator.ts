import type { WelderJob, AgreementSection, SignatureBlockData } from '../types';
import type { BusinessProfile } from '../types/db';

// Section content uses plain text with \n line breaks and • bullets.
// A future structured content model would separate data from formatting,
// which would be necessary for proper HTML rendering or PDF generation.

// Role terminology constants for professional contract language
// Use capitalized versions at sentence start, lowercase mid-sentence
const SERVICE_PROVIDER = 'the Service Provider';
const SERVICE_PROVIDER_CAP = 'The Service Provider';
const CUSTOMER = 'the Customer';

export function generateAgreement(job: WelderJob, profile: BusinessProfile | null): AgreementSection[] {
  const sections: AgreementSection[] = [];

  const businessName = profile?.business_name || 'Contractor';
  const customerName = job.customer_name;

  // 1. Agreement Header
  sections.push({
    title: 'WELDING SERVICES AGREEMENT',
    content: generateHeader(job, businessName, customerName),
  });

  // 2. Project Overview
  sections.push({
    title: 'Project Overview',
    content: generateProjectOverview(job),
  });

  // 3. Scope of Work
  sections.push({
    title: 'Scope of Work',
    content: generateScopeOfWork(job),
  });

  // 4. Materials
  sections.push({
    title: 'Materials',
    content: generateMaterialsSection(job, businessName, customerName),
  });

  // 5. Exclusions
  sections.push({
    title: 'Exclusions',
    content: generateExclusions(job),
  });

  // 6. Assumptions
  if (job.assumptions.length > 0) {
    sections.push({
      title: 'Assumptions',
      content: generateAssumptions(job),
    });
  }

  // 8. Hidden Damage Clause
  if (job.hidden_damage_possible) {
    sections.push({
      title: 'Hidden Damage Clause',
      content: generateHiddenDamageClause(businessName, customerName),
    });
  }

  // 9. Third-Party Work Clause
  sections.push({
    title: 'Third-Party Work',
    content: generateThirdPartyClause(businessName),
  });

  // 10. Change Orders
  if (job.change_order_required) {
    sections.push({
      title: 'Change Orders',
      content: generateChangeOrderClause(businessName, customerName),
    });
  }

  // 11. Pricing and Payment Terms
  sections.push({
    title: 'Pricing and Payment',
    content: generatePricingSection(job),
  });

  // 12. Completion and Responsibility Transfer
  sections.push({
    title: 'Completion and Responsibility',
    content: generateCompletionClause(businessName, customerName),
  });

  // 13. Workmanship Warranty
  sections.push({
    title: 'Workmanship Warranty',
    content: generateWarrantySection(job, businessName),
  });

  // 14. Client Acknowledgment
  sections.push({
    title: 'Agreement and Acknowledgment',
    content: generateClientAcknowledgment(customerName),
    signatureData: getSignatureBlockData(job, profile),
  });

  return sections;
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

function generateHeader(job: WelderJob, businessName: string, customerName: string): string {
  const today = new Date().toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });

  return `Date: ${today}
Service Provider: ${businessName}
Customer: ${customerName}
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

function generateMaterialsSection(job: WelderJob, _businessName: string, _customerName: string): string {
  const providerText =
    job.materials_provided_by === 'welder'
      ? `All materials will be provided by ${SERVICE_PROVIDER}.`
      : job.materials_provided_by === 'customer'
        ? `All materials will be provided by ${CUSTOMER}.`
        : 'Materials will be provided by both parties as agreed.';

  return providerText;
}

function generateExclusions(job: WelderJob): string {
  if (job.exclusions.length === 0) {
    return 'None specified.';
  }

  return job.exclusions.map((exclusion) => `• ${exclusion}`).join('\n');
}

function generateAssumptions(job: WelderJob): string {
  return job.assumptions.map((assumption) => `• ${assumption}`).join('\n');
}

function generateHiddenDamageClause(_businessName: string, _customerName: string): string {
  return `If hidden damage is discovered during repair work that was not visible during initial inspection, ${SERVICE_PROVIDER} will notify ${CUSTOMER} before proceeding. Additional work required to address hidden damage may result in additional charges and will require ${CUSTOMER} approval.`;
}

function generateThirdPartyClause(_businessName: string): string {
  return `${SERVICE_PROVIDER_CAP} is not responsible for:
• Work performed by other contractors
• Modifications made after completion of this agreement
• Issues arising from prior repairs or work by others
• Damage caused by misuse after work completion`;
}

function generateChangeOrderClause(_businessName: string, _customerName: string): string {
  return `Any work outside the agreed scope requires written or verbal approval from ${CUSTOMER} before proceeding. Change orders may result in additional charges and timeline adjustments. ${SERVICE_PROVIDER_CAP} will provide an estimate for any additional work before proceeding.`;
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

function generateCompletionClause(_businessName: string, _customerName: string): string {
  return `Upon completion of the work and ${CUSTOMER} approval, responsibility for the repaired/fabricated item transfers back to ${CUSTOMER}. ${SERVICE_PROVIDER_CAP} is only responsible for workmanship defects as outlined in the Workmanship Warranty section.`;
}

function generateWarrantySection(job: WelderJob, _businessName: string): string {
  return `${SERVICE_PROVIDER_CAP} guarantees the welding workmanship for ${job.workmanship_warranty_days} days from completion date.

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

function generateClientAcknowledgment(_customerName: string): string {
  return `By signing below, ${CUSTOMER} confirms:

• Agreement to the scope of work outlined above
• Understanding of exclusions and limitations
• Approval of pricing and payment terms
• Acknowledgment that responsibility transfers upon completion
• Acceptance of workmanship warranty terms`;
}

function capitalizeFirst(str: string): string {
  return str.charAt(0).toUpperCase() + str.slice(1);
}

export function formatAgreementAsText(sections: AgreementSection[]): string {
  return sections
    .map((section, index) => {
      // Special formatting for the header section
      if (index === 0 && section.title === 'WELDING SERVICES AGREEMENT') {
        return `${section.title}\n\n${section.content}`;
      }

      // Regular sections with clean formatting (no ASCII dividers)
      let text = `${section.title}\n\n${section.content}`;

      // Format signature section
      if (section.signatureData) {
        const s = section.signatureData;
        text += `\n\n\n\n\nCustomer\n\nName: ${s.customerName}\nSignature: _________________________\nDate: _________________________\n\n\nService Provider\n\nName: ${s.ownerName}\nSignature: ${s.ownerName}\nDate: ${s.ownerDate}`;
      }

      return text;
    })
    .join('\n\n\n');
}
