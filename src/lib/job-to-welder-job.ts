import type { Job } from '../types/db';
import type { BusinessProfile } from '../types/db';
import type { JobType, MaterialsProvider, WelderJob } from '../types';

const JOB_TYPES: readonly JobType[] = [
  'repair',
  'fabrication',
  'installation',
  'maintenance',
  'other',
];

/** DB may still hold legacy `mixed` or null; form/agreement only allow welder | customer. */
function materialsProviderFromRow(value: Job['materials_provided_by']): MaterialsProvider {
  return value === 'customer' ? 'customer' : 'welder';
}

/** Map a persisted `jobs` row + profile into `WelderJob` for `generateAgreement` / PDF. */
export function jobRowToWelderJob(job: Job, profile: BusinessProfile | null): WelderJob {
  const rawType = job.job_type as JobType;
  const jobType = JOB_TYPES.includes(rawType) ? rawType : 'other';

  return {
    wo_number: job.wo_number ?? 0,
    agreement_date: job.agreement_date ?? '',
    contractor_name: profile?.business_name ?? '',
    contractor_phone: job.contractor_phone ?? profile?.phone ?? '',
    contractor_email: job.contractor_email ?? profile?.email ?? '',
    customer_name: job.customer_name,
    customer_phone: job.customer_phone ?? '',
    customer_email: job.customer_email ?? '',
    job_location: job.job_location,
    job_site_street: job.job_location,
    job_site_city: '',
    job_site_state: '',
    job_site_zip: '',
    governing_state: job.governing_state ?? '',
    job_type: jobType,
    other_classification: jobType === 'other' ? job.job_type : undefined,
    asset_or_item_description: job.asset_or_item_description,
    requested_work: job.requested_work,
    materials_provided_by: materialsProviderFromRow(job.materials_provided_by),
    installation_included: job.installation_included ?? false,
    grinding_included: job.grinding_included ?? false,
    paint_or_coating_included: job.paint_or_coating_included ?? false,
    removal_or_disassembly_included: job.removal_or_disassembly_included ?? false,
    hidden_damage_possible: job.hidden_damage_possible ?? false,
    target_start: job.target_start ?? '',
    target_completion_date: job.target_completion_date ?? '',
    price_type: job.price_type,
    price: Number(job.price) || 0,
    deposit_amount: job.deposit_amount ?? 0,
    payment_terms_days: job.payment_terms_days ?? profile?.default_payment_terms_days ?? 14,
    late_fee_rate: job.late_fee_rate ?? profile?.default_late_fee_rate ?? 1.5,
    exclusions: job.exclusions ?? [],
    customer_obligations: job.customer_obligations ?? [],
    change_order_required: job.change_order_required ?? false,
    workmanship_warranty_days: job.workmanship_warranty_days ?? 0,
    negotiation_period: job.negotiation_period ?? 0,
  };
}
