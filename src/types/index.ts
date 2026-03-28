export type JobType = 'repair' | 'fabrication' | 'installation' | 'maintenance' | 'other';

export type PriceType = 'fixed' | 'estimate' | 'time_and_materials';

export type MaterialsProvider = 'welder' | 'customer';

export interface WelderJob {
  wo_number: number;
  agreement_date: string;

  // Contractor
  contractor_name?: string;
  contractor_phone?: string;
  contractor_email?: string;

  // Customer (customer_name is normalized first + last for DB / agreements)
  customer_first_name: string;
  customer_last_name: string;
  customer_name: string;
  customer_phone: string;
  customer_email: string;
  job_location: string;
  /** Structured job site (UI); combined into `job_location` for DB / PDF. */
  job_site_street: string;
  job_site_city: string;
  job_site_state: string;
  job_site_zip: string;
  /** Synced from `job_site_state` for DB `governing_state`. */
  governing_state: string;

  // Job Details
  job_type: JobType;
  other_classification?: string;
  asset_or_item_description: string;
  requested_work: string;

  // Materials
  materials_provided_by: MaterialsProvider;

  // Included Services
  installation_included: boolean;
  grinding_included: boolean;
  paint_or_coating_included: boolean;
  removal_or_disassembly_included: boolean;

  // Risk
  hidden_damage_possible: boolean;

  // Scheduling
  target_start: string;
  target_completion_date: string;

  // Pricing
  price_type: PriceType;
  price: number;
  deposit_amount: number;
  payment_terms_days: number;
  late_fee_rate: number;

  // Scope Control
  exclusions: string[];
  customer_obligations: string[];
  change_order_required: boolean;

  // Warranty & Dispute
  workmanship_warranty_days: number;
  negotiation_period: number;
}

export interface SignatureBlockData {
  customerName: string;
  ownerName: string;
  ownerDate: string;
}

export type SectionContentBlock =
  | { type: 'paragraph'; text: string }
  | { type: 'note'; text: string }
  | { type: 'bullets'; items: string[] }
  | { type: 'table'; rows: [string, string][] }
  | {
      type: 'partiesLayout';
      agreementDate: string;
      serviceProvider: { businessName: string; phone: string; email: string };
      customer: { name: string; phone: string; email: string };
      jobSiteAddress: string;
    }
  | { type: 'signature' };

export interface AgreementSection {
  title: string;
  number: number;
  blocks: SectionContentBlock[];
  signatureData?: SignatureBlockData;
}
