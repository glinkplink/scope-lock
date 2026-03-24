import { supabase } from '../supabase';
import type { BusinessProfile } from '../../types/db';
import { normalizePaymentMethods } from '../payment-methods';
import { normalizeTaxRate } from '../tax';

function normalizeProfile(profile: BusinessProfile): BusinessProfile {
  return {
    ...profile,
    default_payment_methods: normalizePaymentMethods(profile.default_payment_methods),
    default_tax_rate: normalizeTaxRate(profile.default_tax_rate),
  };
}

export const getProfile = async (userId: string): Promise<BusinessProfile | null> => {
  const { data, error } = await supabase
    .from('business_profiles')
    .select('*')
    .eq('user_id', userId)
    .single();

  if (error) {
    console.error('Error fetching profile:', error);
    return null;
  }

  return normalizeProfile(data);
};

/**
 * Patch-only update for `next_wo_number`. Use this instead of `upsertProfile` for counter bumps:
 * partial upserts are rejected by PostgREST because `business_name` is NOT NULL with no default
 * (the INSERT side of upsert would fail).
 */
export const updateNextWoNumber = async (
  userId: string,
  nextWoNumber: number
): Promise<{ error: Error | null }> => {
  const { error } = await supabase
    .from('business_profiles')
    .update({ next_wo_number: nextWoNumber })
    .eq('user_id', userId);

  if (error) {
    return { error: new Error(error.message) };
  }
  return { error: null };
};

/** Full profile create/update. Must include `business_name` (NOT NULL) on insert; partial bodies alone will 400 on upsert. */
export const upsertProfile = async (
  profile: Partial<BusinessProfile> & { user_id: string }
) => {
  const normalizedProfile = {
    ...profile,
    default_payment_methods:
      profile.default_payment_methods === undefined
        ? undefined
        : normalizePaymentMethods(profile.default_payment_methods),
    default_tax_rate:
      profile.default_tax_rate === undefined ? undefined : normalizeTaxRate(profile.default_tax_rate),
  };

  const { data, error } = await supabase
    .from('business_profiles')
    .upsert(normalizedProfile, { onConflict: 'user_id' })
    .select()
    .single();

  return { data: data ? normalizeProfile(data) : null, error };
};
