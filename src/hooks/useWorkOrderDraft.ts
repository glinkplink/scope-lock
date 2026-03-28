import { useState, useCallback, useRef, useEffect } from 'react';
import type { WelderJob } from '../types';
import type { BusinessProfile } from '../types/db';
import { supabase } from '../lib/supabase';
import { getProfile, updateNextWoNumber } from '../lib/db/profile';
import { getDefaultCustomerObligations, getDefaultExclusions } from '../lib/defaults';
import sampleJob from '../data/sample-job.json';
import {
  DEFAULT_LATE_FEE_RATE,
  DEFAULT_PAYMENT_TERMS_DAYS,
} from '../lib/payment-terms';
import type { AppView } from './useAppNavigation';

export type LoadProfileFn = (options?: { silent?: boolean }) => void | Promise<void>;

export type WorkOrderDraftState = {
  job: WelderJob;
  draftBaseline: WelderJob | null;
  currentJobId: string | null;
  woIsOpen: boolean;
  showUnsavedModal: boolean;
  woCounterPersistError: string | null;
};

const initialDraftJob: WelderJob = {
  ...(sampleJob as WelderJob),
  contractor_name: '',
};

const draftInitialState: WorkOrderDraftState = {
  job: initialDraftJob,
  draftBaseline: null,
  currentJobId: null,
  woIsOpen: false,
  showUnsavedModal: false,
  woCounterPersistError: null,
};

function buildNewAgreementDraft(currentProfile: BusinessProfile | null): WelderJob {
  const today = new Date().toISOString().split('T')[0];
  const p = currentProfile;
  const defaults: Partial<WelderJob> = p
    ? {
        contractor_name: p.business_name,
        contractor_phone: p.phone ?? '',
        contractor_email: p.email ?? '',
        wo_number: p.next_wo_number ?? 1,
        agreement_date: today,
        exclusions: getDefaultExclusions(p.default_exclusions),
        customer_obligations: getDefaultCustomerObligations(p.default_assumptions),
        payment_terms_days: p.default_payment_terms_days ?? DEFAULT_PAYMENT_TERMS_DAYS,
        late_fee_rate: p.default_late_fee_rate ?? DEFAULT_LATE_FEE_RATE,
        workmanship_warranty_days: p.default_warranty_period ?? 30,
        negotiation_period: p.default_negotiation_period ?? 10,
      }
    : { agreement_date: today };

  return {
    ...(sampleJob as WelderJob),
    contractor_name: '',
    exclusions: getDefaultExclusions(),
    customer_obligations: getDefaultCustomerObligations(),
    ...defaults,
  };
}

export function useWorkOrderDraft(
  profile: BusinessProfile | null,
  userId: string | null,
  navigateTo: (view: AppView) => void,
  loadProfile: LoadProfileFn,
  /** Called when a fresh work order draft is created (new agreement or after discard). */
  onNewDraft?: () => void
) {
  const [draft, setDraft] = useState<WorkOrderDraftState>(() => ({
    ...draftInitialState,
  }));

  const draftRef = useRef(draft);
  useEffect(() => {
    draftRef.current = draft;
  }, [draft]);

  const prevUserIdRef = useRef<string | null | undefined>(undefined);
  useEffect(() => {
    const next = userId ?? null;
    const prev = prevUserIdRef.current;

    if (prev === undefined) {
      prevUserIdRef.current = next;
      return;
    }

    if (prev !== next) {
      const loggedOut = prev != null && next == null;
      const switchedAccount = prev != null && next != null && prev !== next;
      if (loggedOut || switchedAccount) {
        // eslint-disable-next-line react-hooks/set-state-in-effect -- draft must clear when auth identity changes; batches with navigate in React 18
        setDraft({ ...draftInitialState });
        navigateTo('home');
      }
    }

    prevUserIdRef.current = next;
  }, [userId, navigateTo]);

  const setJob = useCallback((next: WelderJob | ((prev: WelderJob) => WelderJob)) => {
    setDraft((d) => ({
      ...d,
      job: typeof next === 'function' ? next(d.job) : next,
    }));
  }, []);

  const doCreateNewAgreement = useCallback(
    (currentProfile: BusinessProfile | null) => {
      onNewDraft?.();
      const nextDraft = buildNewAgreementDraft(currentProfile);
      setDraft((d) => ({
        ...d,
        job: nextDraft,
        draftBaseline: nextDraft,
        currentJobId: null,
        woIsOpen: true,
      }));
      navigateTo('form');
    },
    [navigateTo, onNewDraft]
  );

  const createNewAgreement = useCallback(() => {
    const d = draftRef.current;
    const hasUnsavedChanges =
      d.woIsOpen &&
      d.currentJobId === null &&
      d.draftBaseline !== null &&
      JSON.stringify(d.job) !== JSON.stringify(d.draftBaseline);

    if (hasUnsavedChanges) {
      setDraft((prev) => ({ ...prev, showUnsavedModal: true }));
      return;
    }
    doCreateNewAgreement(profile);
  }, [profile, doCreateNewAgreement]);

  const closeUnsavedModal = useCallback(() => {
    setDraft((d) => ({ ...d, showUnsavedModal: false }));
  }, []);

  const continueEditingWorkOrder = useCallback(() => {
    navigateTo('form');
    closeUnsavedModal();
  }, [navigateTo, closeUnsavedModal]);

  const handleSaveSuccess = useCallback(
    async (savedJobId: string, isNewSave: boolean) => {
      setDraft((d) => ({
        ...d,
        currentJobId: savedJobId,
        woCounterPersistError: null,
      }));
      if (!isNewSave) return;

      const {
        data: { session },
      } = await supabase.auth.getSession();
      const uid = session?.user?.id;
      if (!uid) return;

      const fresh = await getProfile(uid);
      if (!fresh || fresh.user_id !== uid) return;

      const newCount = (fresh.next_wo_number ?? 1) + 1;
      const { error } = await updateNextWoNumber(uid, newCount);
      if (error) {
        console.error('Failed to persist next work order number:', error);
        setDraft((d) => ({
          ...d,
          woCounterPersistError: `Work order saved, but the next WO number could not be updated (${error.message}). Refresh the page before creating another work order, or the same number may be suggested again.`,
        }));
        return;
      }
      void loadProfile({ silent: true });
    },
    [loadProfile]
  );

  const dismissWoCounterError = useCallback(() => {
    setDraft((d) => ({ ...d, woCounterPersistError: null }));
  }, []);

  return {
    state: draft,
    actions: {
      setJob,
      doCreateNewAgreement,
      createNewAgreement,
      closeUnsavedModal,
      continueEditingWorkOrder,
      handleSaveSuccess,
      dismissWoCounterError,
    },
  };
}
