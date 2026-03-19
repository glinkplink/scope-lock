import { supabase } from '../supabase';
import type { Job } from '../../types/db';
import type { WelderJob } from '../../types';

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

export const saveWorkOrder = async (
  userId: string,
  job: WelderJob,
  existingJobId?: string
): Promise<{ data: Job | null; error: Error | null }> => {
  const jobData: Partial<Job> = {
    customer_name: job.customer_name,
    customer_phone: job.customer_phone,
    customer_email: job.customer_email,
    job_location: job.job_location,
    job_type: job.job_classification,
    job_classification: job.job_classification,
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
    exclusions: job.exclusions,
    change_order_required: job.change_order_required,
    workmanship_warranty_days: job.workmanship_warranty_days,
    wo_number: job.wo_number,
    agreement_date: job.agreement_date || null,
    contractor_phone: job.contractor_phone || null,
    contractor_email: job.contractor_email || null,
    deposit_amount: job.deposit_amount,
    late_payment_terms: job.late_payment_terms,
    negotiation_period: job.negotiation_period,
    customer_obligations: job.customer_obligations,
  };

  let result: { data: Job | null; error: { message: string } | null };
  if (existingJobId) {
    result = await updateJob(existingJobId, jobData);
  } else {
    result = await createJob({ user_id: userId, ...jobData, status: 'active' });
  }

  if (result.error) {
    return { data: null, error: new Error(result.error.message) };
  }

  // Match or create client by name (no unique constraint on user_id+name)
  if (job.customer_name) {
    const { data: existing } = await supabase
      .from('clients')
      .select('id')
      .eq('user_id', userId)
      .eq('name', job.customer_name)
      .maybeSingle();

    if (existing?.id) {
      await supabase
        .from('clients')
        .update({
          phone: job.customer_phone || null,
          email: job.customer_email || null,
        })
        .eq('id', existing.id);
    } else {
      await supabase.from('clients').insert({
        user_id: userId,
        name: job.customer_name,
        phone: job.customer_phone || null,
        email: job.customer_email || null,
      });
    }
  }

  return { data: result.data, error: null };
};
