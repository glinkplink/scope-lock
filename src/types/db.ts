// TypeScript interfaces matching the Supabase database schema

export interface BusinessProfile {
  id: string;
  user_id: string;
  business_name: string;
  owner_name: string | null;
  phone: string | null;
  email: string | null;
  address: string | null;
  google_business_profile_url: string | null;
  default_exclusions: string[];
  default_assumptions: string[];
  next_wo_number: number;
  default_warranty_period: number;
  default_negotiation_period: number;
  default_payment_methods: string[];
  default_late_payment_terms: string;
  default_card_fee_note: boolean;
  created_at: string;
  updated_at: string;
}

export interface Client {
  id: string;
  user_id: string;
  name: string;
  /** lower(trim(name)) — used for dedup per user */
  name_normalized: string;
  phone: string | null;
  email: string | null;
  address: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

export interface Job {
  id: string;
  user_id: string;
  client_id: string | null;
  customer_name: string;
  customer_phone: string | null;
  job_location: string;
  job_type: string;
  asset_or_item_description: string;
  requested_work: string;
  materials_provided_by: 'welder' | 'customer' | 'mixed' | null;
  installation_included: boolean | null;
  grinding_included: boolean | null;
  paint_or_coating_included: boolean | null;
  removal_or_disassembly_included: boolean | null;
  hidden_damage_possible: boolean | null;
  price_type: 'fixed' | 'estimate' | 'time_and_materials';
  price: number;
  deposit_required: boolean | null;
  payment_terms: string | null;
  target_completion_date: string | null;
  exclusions: string[];
  assumptions: string[];
  change_order_required: boolean | null;
  workmanship_warranty_days: number | null;
  status: string;
  // New WO columns
  wo_number: number | null;
  agreement_date: string | null;
  contractor_phone: string | null;
  contractor_email: string | null;
  customer_email: string | null;
  target_start: string | null;
  deposit_amount: number | null;
  late_payment_terms: string | null;
  negotiation_period: number | null;
  customer_obligations: string[] | null;
  created_at: string;
  updated_at: string;
}

export interface ChangeOrder {
  id: string;
  user_id: string;
  job_id: string;
  description: string;
  price_delta: number | null;
  time_delta: number | null;
  approved: boolean | null;
  created_at: string;
  updated_at: string;
}

export interface CompletionSignoff {
  id: string;
  user_id: string;
  job_id: string;
  client_name: string;
  signed_at: string;
  notes: string | null;
  created_at: string;
  updated_at: string;
}
