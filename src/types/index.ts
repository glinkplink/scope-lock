export type JobType = 'repair' | 'fabrication' | 'mobile repair';

export type PriceType = 'fixed' | 'estimate';

export type MaterialsProvider = 'welder' | 'customer' | 'mixed';

export interface WelderJob {
  // Customer Information
  customer_name: string;
  customer_phone: string;
  job_location: string;

  // Job Details
  job_type: JobType;
  asset_or_item_description: string;
  requested_work: string;

  // Materials
  materials_provided_by: MaterialsProvider;

  // Included Services
  installation_included: boolean;
  grinding_included: boolean;
  paint_or_coating_included: boolean;
  removal_or_disassembly_included: boolean;

  // Risk Assessment
  hidden_damage_possible: boolean;

  // Pricing
  price_type: PriceType;
  price: number;
  deposit_required: boolean;
  payment_terms: string;

  // Scheduling
  target_completion_date: string;

  // Scope Control
  exclusions: string[];
  assumptions: string[];
  change_order_required: boolean;

  // Warranty
  workmanship_warranty_days: number;
}

export interface AgreementSection {
  title: string;
  content: string;
}
