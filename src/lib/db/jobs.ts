import { supabase } from '../supabase';
import type {
  EsignJobStatus,
  Job,
  WorkOrderDashboardJob,
  WorkOrdersDashboardCursor,
  WorkOrdersDashboardSummary,
  WorkOrderListChangeOrderPreview,
  WorkOrderListJob,
  WorkOrderInvoiceStatus,
} from '../../types/db';
import type { WelderJob } from '../../types';

const WORK_ORDER_LIST_SELECT = `
  id,
  wo_number,
  customer_name,
  job_type,
  other_classification,
  agreement_date,
  created_at,
  price,
  esign_status,
  offline_signed_at,
  change_orders (
    id,
    job_id,
    co_number,
    esign_status
  )
`;

function mapWorkOrderListChangeOrderRow(
  row: Record<string, unknown>
): WorkOrderListChangeOrderPreview {
  const esignRaw = row.esign_status;
  const esign_status: EsignJobStatus =
    esignRaw === 'sent' ||
    esignRaw === 'opened' ||
    esignRaw === 'completed' ||
    esignRaw === 'declined' ||
    esignRaw === 'expired'
      ? esignRaw
      : 'not_sent';

  return {
    id: String(row.id),
    job_id: String(row.job_id ?? ''),
    co_number: Number(row.co_number) || 0,
    esign_status,
  };
}

function mapWorkOrderListRow(row: Record<string, unknown>): WorkOrderListJob {
  const priceRaw = row.price;
  const price =
    typeof priceRaw === 'number' && Number.isFinite(priceRaw)
      ? priceRaw
      : Number(priceRaw) || 0;
  const ocRaw = row.other_classification;
  const other_classification =
    ocRaw != null && String(ocRaw).trim() !== '' ? String(ocRaw).trim() : null;

  const esignRaw = row.esign_status;
  const esign_status: EsignJobStatus =
    esignRaw === 'sent' ||
    esignRaw === 'opened' ||
    esignRaw === 'completed' ||
    esignRaw === 'declined' ||
    esignRaw === 'expired'
      ? esignRaw
      : 'not_sent';
  const changeOrderRows = Array.isArray(row.change_orders) ? row.change_orders : [];
  const changeOrders = changeOrderRows
    .filter(
      (value): value is Record<string, unknown> => typeof value === 'object' && value !== null
    )
    .map((value) => mapWorkOrderListChangeOrderRow(value))
    .sort((a, b) => a.co_number - b.co_number);

  const offlineSignedAtRaw = row.offline_signed_at;
  const offline_signed_at =
    typeof offlineSignedAtRaw === 'string' && offlineSignedAtRaw.trim()
      ? offlineSignedAtRaw.trim()
      : null;

  return {
    id: String(row.id),
    wo_number: row.wo_number != null ? Number(row.wo_number) : null,
    customer_name: String(row.customer_name ?? ''),
    job_type: String(row.job_type ?? ''),
    other_classification,
    agreement_date: (row.agreement_date as string | null) ?? null,
    created_at: String(row.created_at ?? ''),
    price,
    esign_status,
    offline_signed_at,
    changeOrders,
  };
}

function mapWorkOrderInvoiceStatusRow(row: Record<string, unknown>): WorkOrderInvoiceStatus | null {
  const id = row.id;
  const job_id = row.job_id;
  const issued_at =
    typeof row.issued_at === 'string' && row.issued_at.trim() ? row.issued_at : null;
  const created_at = row.created_at;
  const invoice_number = row.invoice_number;
  const payment_status = (row.payment_status as WorkOrderInvoiceStatus['payment_status']) ?? 'unpaid';
  if (typeof id !== 'string' || typeof job_id !== 'string' || typeof created_at !== 'string') {
    return null;
  }
  const parsedInvoiceNumber =
    typeof invoice_number === 'number' ? invoice_number : Number(invoice_number);
  if (!Number.isFinite(parsedInvoiceNumber)) return null;

  return {
    id,
    job_id,
    issued_at,
    invoice_number: parsedInvoiceNumber,
    created_at,
    payment_status,
  };
}

function mapWorkOrderDashboardRow(row: Record<string, unknown>): WorkOrderDashboardJob {
  const priceRaw = row.price;
  const price =
    typeof priceRaw === 'number' && Number.isFinite(priceRaw)
      ? priceRaw
      : Number(priceRaw) || 0;
  const ocRaw = row.other_classification;
  const other_classification =
    ocRaw != null && String(ocRaw).trim() !== '' ? String(ocRaw).trim() : null;
  const esignRaw = row.esign_status;
  const esign_status: EsignJobStatus =
    esignRaw === 'sent' ||
    esignRaw === 'opened' ||
    esignRaw === 'completed' ||
    esignRaw === 'declined' ||
    esignRaw === 'expired'
      ? esignRaw
      : 'not_sent';
  const fullChangeOrders = mapDashboardChangeOrderPreviewRows(
    row.change_orders_preview ?? row.change_orders
  );
  const changeOrderCountRaw = row.change_order_count;
  const changeOrderCount =
    typeof changeOrderCountRaw === 'number' && Number.isFinite(changeOrderCountRaw)
      ? changeOrderCountRaw
      : Number(changeOrderCountRaw) || fullChangeOrders.length;
  const latestInvoice =
    row.latest_invoice && typeof row.latest_invoice === 'object'
      ? mapWorkOrderInvoiceStatusRow(row.latest_invoice as Record<string, unknown>)
      : null;
  const hasInFlightChangeOrdersRaw = row.has_in_flight_change_orders;
  const hasInFlightChangeOrders =
    typeof hasInFlightChangeOrdersRaw === 'boolean'
      ? hasInFlightChangeOrdersRaw
      : fullChangeOrders.some((changeOrder) =>
          changeOrder.esign_status === 'sent' || changeOrder.esign_status === 'opened'
        );

  const offlineSignedAtRaw = row.offline_signed_at;
  const offline_signed_at =
    typeof offlineSignedAtRaw === 'string' && offlineSignedAtRaw.trim()
      ? offlineSignedAtRaw.trim()
      : null;

  return {
    id: String(row.id),
    wo_number: row.wo_number != null ? Number(row.wo_number) : null,
    customer_name: String(row.customer_name ?? ''),
    job_type: String(row.job_type ?? ''),
    other_classification,
    agreement_date: (row.agreement_date as string | null) ?? null,
    created_at: String(row.created_at ?? ''),
    price,
    esign_status,
    offline_signed_at,
    changeOrderCount,
    changeOrderPreview: fullChangeOrders.slice(0, 2),
    hasInFlightChangeOrders,
    latestInvoice,
  };
}

function mapDashboardChangeOrderPreviewRows(raw: unknown): WorkOrderListChangeOrderPreview[] {
  const changeOrderRows = Array.isArray(raw) ? raw : [];
  return changeOrderRows
    .filter(
      (value): value is Record<string, unknown> => typeof value === 'object' && value !== null
    )
    .map((value) => mapWorkOrderListChangeOrderRow(value))
    .sort((a, b) => a.co_number - b.co_number);
}

function mapWorkOrdersDashboardSummaryRow(row: Record<string, unknown>): WorkOrdersDashboardSummary {
  const jobCountRaw = row.job_count;
  const signedJobCountRaw = row.signed_job_count;
  const completedJobCountRaw = row.completed_job_count;
  const invoicedContractTotalRaw = row.invoiced_contract_total;
  const pendingContractTotalRaw = row.pending_contract_total;
  const paidContractTotalRaw = row.paid_contract_total;

  return {
    jobCount:
      typeof jobCountRaw === 'number' && Number.isFinite(jobCountRaw)
        ? jobCountRaw
        : Number(jobCountRaw) || 0,
    signedJobCount:
      typeof signedJobCountRaw === 'number' && Number.isFinite(signedJobCountRaw)
        ? signedJobCountRaw
        : Number(signedJobCountRaw) || 0,
    completedJobCount:
      typeof completedJobCountRaw === 'number' && Number.isFinite(completedJobCountRaw)
        ? completedJobCountRaw
        : Number(completedJobCountRaw) || 0,
    invoicedContractTotal:
      typeof invoicedContractTotalRaw === 'number' && Number.isFinite(invoicedContractTotalRaw)
        ? invoicedContractTotalRaw
        : Number(invoicedContractTotalRaw) || 0,
    pendingContractTotal:
      typeof pendingContractTotalRaw === 'number' && Number.isFinite(pendingContractTotalRaw)
        ? pendingContractTotalRaw
        : Number(pendingContractTotalRaw) || 0,
    paidContractTotal:
      typeof paidContractTotalRaw === 'number' && Number.isFinite(paidContractTotalRaw)
        ? paidContractTotalRaw
        : Number(paidContractTotalRaw) || 0,
  };
}

export type ListWorkOrdersDashboardPageResult =
  | {
      data: WorkOrderDashboardJob[];
      error: null;
      hasMore: boolean;
      nextCursor: WorkOrdersDashboardCursor | null;
    }
  | {
      data: null;
      error: Error;
      hasMore: false;
      nextCursor: null;
    };

export type GetWorkOrdersDashboardSummaryResult =
  | { data: WorkOrdersDashboardSummary; error: null }
  | { data: null; error: Error };

export type GetSignedWorkOrdersCountResult =
  | { data: number; error: null }
  | { data: null; error: Error };

export const listJobsForWorkOrders = async (userId: string): Promise<WorkOrderListJob[]> => {
  const { data, error } = await supabase
    .from('jobs')
    .select(WORK_ORDER_LIST_SELECT)
    .eq('user_id', userId)
    .order('created_at', { ascending: false });

  if (error) {
    console.error('Error listing jobs for work orders:', error);
    return [];
  }

  return (data ?? []).map((row) => mapWorkOrderListRow(row as Record<string, unknown>));
};

export const listWorkOrdersDashboard = async (
  userId: string,
  jobIds?: string[]
): Promise<WorkOrderDashboardJob[]> => {
  const { data, error } = await supabase.rpc('list_work_orders_dashboard', {
    p_user_id: userId,
    p_job_ids: jobIds && jobIds.length > 0 ? jobIds : null,
  });

  if (error) {
    console.error('Error listing work orders dashboard:', error);
    return [];
  }

  return (data ?? []).map((row: unknown) => mapWorkOrderDashboardRow(row as Record<string, unknown>));
};

export const listWorkOrdersDashboardPage = async (
  userId: string,
  limit: number,
  cursor: WorkOrdersDashboardCursor | null = null
): Promise<ListWorkOrdersDashboardPageResult> => {
  const pageSize = Math.max(1, limit);
  const fetchLimit = pageSize + 1;

  const { data, error } = await supabase.rpc('list_work_orders_dashboard_page', {
    p_user_id: userId,
    p_limit: fetchLimit,
    p_cursor_created_at: cursor?.created_at ?? null,
    p_cursor_id: cursor?.id ?? null,
  });

  if (error) {
    console.error('Error listing paginated work orders dashboard:', error);
    return {
      data: null,
      error: new Error(error.message),
      hasMore: false,
      nextCursor: null,
    };
  }

  const mappedRows = (data ?? []).map((row: unknown) =>
    mapWorkOrderDashboardRow(row as Record<string, unknown>)
  );
  const hasMore = mappedRows.length > pageSize;
  const visibleRows = hasMore ? mappedRows.slice(0, pageSize) : mappedRows;
  const tailRow = visibleRows.length > 0 ? visibleRows[visibleRows.length - 1] : null;

  return {
    data: visibleRows,
    error: null,
    hasMore,
    nextCursor:
      hasMore && tailRow
        ? {
            created_at: tailRow.created_at,
            id: tailRow.id,
          }
        : null,
  };
};

export const getWorkOrdersDashboardSummary = async (
  userId: string
): Promise<GetWorkOrdersDashboardSummaryResult> => {
  const { data, error } = await supabase
    .rpc('get_work_orders_dashboard_summary', { p_user_id: userId })
    .single();

  if (error) {
    console.error('Error loading work orders dashboard summary:', error);
    return { data: null, error: new Error(error.message) };
  }

  return {
    data: mapWorkOrdersDashboardSummaryRow(data as Record<string, unknown>),
    error: null,
  };
};

export const getSignedWorkOrdersCount = async (
  userId: string
): Promise<GetSignedWorkOrdersCountResult> => {
  const { count, error } = await supabase
    .from('jobs')
    .select('id', { count: 'exact', head: true })
    .eq('user_id', userId)
    .or('esign_status.eq.completed,offline_signed_at.not.is.null');

  if (error) {
    console.error('Error loading signed work orders count:', error);
    return { data: null, error: new Error(error.message) };
  }

  return { data: count ?? 0, error: null };
};

export const listInFlightEsignJobs = async (userId: string): Promise<WorkOrderListJob[]> => {
  const { data, error } = await supabase
    .from('jobs')
    .select(WORK_ORDER_LIST_SELECT)
    .eq('user_id', userId)
    .in('esign_status', ['sent', 'opened'])
    .order('created_at', { ascending: false });

  if (error) {
    console.error('Error listing in-flight esign jobs:', error);
    return [];
  }

  return (data ?? []).map((row) => mapWorkOrderListRow(row as Record<string, unknown>));
};

export const refreshEsignStatuses = async (
  jobIds: string[],
  userId: string
): Promise<WorkOrderListJob[]> => {
  if (jobIds.length === 0) return [];

  const { data, error } = await supabase
    .from('jobs')
    .select(WORK_ORDER_LIST_SELECT)
    .eq('user_id', userId)
    .in('id', jobIds);

  if (error) {
    console.error('Error refreshing esign statuses:', error);
    return [];
  }

  return (data ?? []).map((row) => mapWorkOrderListRow(row as Record<string, unknown>));
};

export const getJobById = async (id: string): Promise<Job | null> => {
  const { data, error } = await supabase.from('jobs').select('*').eq('id', id).maybeSingle();

  if (error) {
    console.error('Error fetching job:', error);
    return null;
  }

  return data as Job | null;
};

export const listJobs = async (userId: string): Promise<Job[]> => {
  const { data, error } = await supabase
    .from('jobs')
    .select('*')
    .eq('user_id', userId)
    .order('created_at', { ascending: false });

  if (error) {
    console.error('Error listing jobs:', error);
    return [];
  }

  return data;
};

export const createJob = async (job: Partial<Job> & { user_id: string }) => {
  const { data, error } = await supabase
    .from('jobs')
    .insert(job)
    .select()
    .single();

  return { data, error };
};

export const updateJob = async (id: string, job: Partial<Job>) => {
  const { data, error } = await supabase
    .from('jobs')
    .update(job)
    .eq('id', id)
    .select()
    .single();

  return { data, error };
};

export const deleteJob = async (id: string) => {
  const { error } = await supabase.from('jobs').delete().eq('id', id);

  return { error };
};

function normalizeClientNameKey(name: string): string {
  return name.trim().toLowerCase();
}

export const saveWorkOrder = async (
  userId: string,
  job: WelderJob,
  existingJobId?: string
): Promise<{ data: Job | null; error: Error | null }> => {
  const displayName = job.customer_name?.trim() ?? '';
  const nameKey = displayName ? normalizeClientNameKey(displayName) : '';

  let clientId: string | null = null;

  if (displayName && nameKey) {
    const { data: existing, error: findErr } = await supabase
      .from('clients')
      .select('id')
      .eq('user_id', userId)
      .eq('name_normalized', nameKey)
      .maybeSingle();

    if (findErr) {
      return { data: null, error: new Error(findErr.message) };
    }

    if (existing?.id) {
      const { data: updated, error: upErr } = await supabase
        .from('clients')
        .update({
          name: displayName,
          name_normalized: nameKey,
          phone: job.customer_phone || null,
          email: job.customer_email || null,
          address: job.job_location?.trim() || null,
        })
        .eq('id', existing.id)
        .select('id')
        .single();

      if (upErr || !updated) {
        return {
          data: null,
          error: new Error(upErr?.message || 'Failed to update client'),
        };
      }
      clientId = updated.id;
    } else {
      const { data: inserted, error: insErr } = await supabase
        .from('clients')
        .insert({
          user_id: userId,
          name: displayName,
          name_normalized: nameKey,
          phone: job.customer_phone || null,
          email: job.customer_email || null,
          address: job.job_location?.trim() || null,
        })
        .select('id')
        .single();

      if (insErr || !inserted) {
        return {
          data: null,
          error: new Error(insErr?.message || 'Failed to create client'),
        };
      }
      clientId = inserted.id;
    }
  }

  const jobData: Partial<Job> = {
    customer_name: job.customer_name,
    customer_phone: job.customer_phone,
    customer_email: job.customer_email,
    job_location: job.job_location,
    governing_state: job.governing_state?.trim() || null,
    job_type: job.job_type,
    other_classification:
      job.job_type === 'other' ? (job.other_classification?.trim() || null) : null,
    asset_or_item_description: job.asset_or_item_description,
    requested_work: job.requested_work,
    materials_provided_by: job.materials_provided_by,
    installation_included: job.installation_included,
    grinding_included: job.grinding_included,
    paint_or_coating_included: job.paint_or_coating_included,
    removal_or_disassembly_included: job.removal_or_disassembly_included,
    hidden_damage_possible: job.hidden_damage_possible,
    price_type: job.price_type,
    price: job.price,
    target_completion_date: job.target_completion_date || null,
    target_start: job.target_start || null,
    exclusions: Array.isArray(job.exclusions) ? job.exclusions : [],
    change_order_required: job.change_order_required,
    workmanship_warranty_days: job.workmanship_warranty_days,
    agreement_date: job.agreement_date || null,
    contractor_phone: job.contractor_phone || null,
    contractor_email: job.contractor_email || null,
    deposit_amount: job.deposit_amount,
    payment_terms_days: job.payment_terms_days,
    late_fee_rate: job.late_fee_rate,
    negotiation_period: job.negotiation_period,
    customer_obligations: Array.isArray(job.customer_obligations) ? job.customer_obligations : [],
    client_id: clientId,
  };

  if (!existingJobId) {
    jobData.wo_number = job.wo_number;
  }

  let result: { data: Job | null; error: { message: string } | null };
  if (existingJobId) {
    result = await updateJob(existingJobId, jobData);
  } else {
    result = await createJob({ user_id: userId, ...jobData, status: 'active' });
  }

  if (result.error) {
    return { data: null, error: new Error(result.error.message) };
  }

  return { data: result.data, error: null };
};
