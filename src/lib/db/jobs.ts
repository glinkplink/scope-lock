import { supabase } from '../supabase';
import type { EsignJobStatus, Job, WorkOrderListJob } from '../../types/db';
import type { WelderJob } from '../../types';

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
  };
}

export const listJobsForWorkOrders = async (userId: string): Promise<WorkOrderListJob[]> => {
  const { data, error } = await supabase
    .from('jobs')
    .select(
      'id, wo_number, customer_name, job_type, other_classification, agreement_date, created_at, price, esign_status'
    )
    .eq('user_id', userId)
    .order('created_at', { ascending: false });

  if (error) {
    console.error('Error listing jobs for work orders:', error);
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
