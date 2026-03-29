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
  next_invoice_number: number;
  default_warranty_period: number;
  default_negotiation_period: number;
  default_payment_methods: string[];
  default_tax_rate: number;
  default_late_payment_terms: string;
  default_payment_terms_days: number;
  default_late_fee_rate: number;
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
  /** Free-text when job_type is `other` (JobForm "Specify"). */
  other_classification: string | null;
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
  governing_state: string | null;
  target_start: string | null;
  deposit_amount: number | null;
  late_payment_terms: string | null;
  payment_terms_days: number | null;
  late_fee_rate: number | null;
  negotiation_period: number | null;
  customer_obligations: string[] | null;
  created_at: string;
  updated_at: string;
  /** DocuSeal e-sign (nullable until first send). */
  esign_submission_id: string | null;
  esign_submitter_id: string | null;
  esign_embed_src: string | null;
  esign_status: EsignJobStatus;
  esign_submission_state: string | null;
  esign_submitter_state: string | null;
  esign_sent_at: string | null;
  esign_opened_at: string | null;
  esign_completed_at: string | null;
  esign_declined_at: string | null;
  esign_decline_reason: string | null;
  esign_signed_document_url: string | null;
}

/** Normalized e-sign lifecycle for UI (stored on `jobs.esign_status`). */
export type EsignJobStatus =
  | 'not_sent'
  | 'sent'
  | 'opened'
  | 'completed'
  | 'declined'
  | 'expired';

export interface WorkOrderListChangeOrderPreview {
  id: string;
  job_id: string;
  co_number: number;
  esign_status: EsignJobStatus;
}

/** Narrow row for Work Orders list screen only (not full Job). */
export interface WorkOrderListJob {
  id: string;
  wo_number: number | null;
  customer_name: string;
  job_type: string;
  other_classification: string | null;
  agreement_date: string | null;
  created_at: string;
  price: number;
  esign_status: EsignJobStatus;
  changeOrders: WorkOrderListChangeOrderPreview[];
}

export interface WorkOrderDashboardJob {
  id: string;
  wo_number: number | null;
  customer_name: string;
  job_type: string;
  other_classification: string | null;
  agreement_date: string | null;
  created_at: string;
  price: number;
  esign_status: EsignJobStatus;
  changeOrderCount: number;
  changeOrderPreview: WorkOrderListChangeOrderPreview[];
  hasInFlightChangeOrders: boolean;
  latestInvoice: WorkOrderInvoiceStatus | null;
}

export interface WorkOrdersDashboardCursor {
  created_at: string;
  id: string;
}

export interface WorkOrdersDashboardSummary {
  jobCount: number;
  invoicedContractTotal: number;
  pendingContractTotal: number;
}

/** Invoice fields needed for Work Orders list actions / summary (no line_items). */
export interface WorkOrderInvoiceStatus {
  id: string;
  job_id: string;
  status: 'draft' | 'downloaded';
  invoice_number: number;
  created_at: string;
}

export interface ChangeOrderInvoiceStatus {
  id: string;
  job_id: string;
  change_order_id: string;
  status: 'draft' | 'downloaded';
  invoice_number: number;
  created_at: string;
}

export type InvoiceLineItemSource =
  | 'original_scope'
  | 'change_order'
  | 'labor'
  | 'material'
  | 'manual'
  | 'legacy';

export interface InvoiceLineItem {
  id?: string;
  kind: 'labor' | 'material';
  description: string;
  qty: number;
  unit_price: number;
  total: number;
  /** Partition for invoice edit: CO snapshot rows stay fixed; missing in DB JSON => legacy */
  source?: InvoiceLineItemSource;
  position?: number;
  change_order_id?: string;
}

export interface Invoice {
  id: string;
  user_id: string;
  job_id: string;
  invoice_number: number;
  invoice_date: string;
  due_date: string;
  status: 'draft' | 'downloaded';
  line_items: InvoiceLineItem[];
  subtotal: number;
  tax_rate: number;
  tax_amount: number;
  total: number;
  payment_methods: string[];
  notes: string | null;
  created_at: string;
  updated_at: string;
}

export interface ChangeOrderLineItem {
  id: string;
  description: string;
  quantity: number;
  unit_rate: number;
}

export interface ChangeOrder {
  id: string;
  user_id: string;
  job_id: string;
  co_number: number;
  description: string;
  reason: string;
  status: 'draft' | 'pending_approval' | 'approved' | 'rejected';
  requires_approval: boolean;
  line_items: ChangeOrderLineItem[];
  time_amount: number;
  time_unit: 'hours' | 'days';
  time_note: string;
  created_at: string;
  updated_at: string;
  /** DocuSeal e-sign fields */
  esign_submission_id?: string | null;
  esign_submitter_id?: string | null;
  esign_embed_src?: string | null;
  esign_status: EsignJobStatus;
  esign_submission_state?: string | null;
  esign_submitter_state?: string | null;
  esign_sent_at?: string | null;
  esign_opened_at?: string | null;
  esign_completed_at?: string | null;
  esign_declined_at?: string | null;
  esign_decline_reason?: string | null;
  esign_signed_document_url?: string | null;
}
