// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import type { BusinessProfile } from '../../types/db';
import { useWorkOrderDraft } from '../useWorkOrderDraft';

const getSession = vi.fn();

vi.mock('../../lib/supabase', () => ({
  supabase: {
    auth: {
      getSession: () => getSession(),
    },
  },
}));

const getProfile = vi.fn();
const updateNextWoNumber = vi.fn();

vi.mock('../../lib/db/profile', () => ({
  getProfile: (...args: unknown[]) => getProfile(...args),
  updateNextWoNumber: (...args: unknown[]) => updateNextWoNumber(...args),
}));

function baseProfile(over: Partial<BusinessProfile> = {}): BusinessProfile {
  return {
    id: 'p1',
    user_id: 'u1',
    business_name: 'B',
    owner_name: null,
    phone: null,
    email: null,
    address: null,
    google_business_profile_url: null,
    default_exclusions: [],
    default_assumptions: [],
    next_wo_number: 3,
    next_invoice_number: 1,
    default_warranty_period: 30,
    default_negotiation_period: 10,
    default_payment_methods: [],
    default_tax_rate: 0,
    default_late_payment_terms: '',
    default_payment_terms_days: 30,
    default_late_fee_rate: 0,
    default_card_fee_note: false,
    created_at: '2025-01-01T00:00:00Z',
    updated_at: '2025-01-01T00:00:00Z',
    ...over,
  };
}

describe('useWorkOrderDraft', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getSession.mockResolvedValue({
      data: { session: { user: { id: 'u1' } } },
    });
  });

  it('calls loadProfile after next_wo_number is persisted on first save', async () => {
    getProfile.mockResolvedValue(baseProfile());
    updateNextWoNumber.mockResolvedValue({ error: null });
    const loadProfile = vi.fn();

    const { result } = renderHook(() =>
      useWorkOrderDraft(null, null, vi.fn(), loadProfile)
    );

    await act(async () => {
      await result.current.actions.handleSaveSuccess('job-new', true);
    });

    expect(updateNextWoNumber).toHaveBeenCalledWith('u1', 4);
    expect(loadProfile).toHaveBeenCalledWith({ silent: true });
    expect(result.current.state.woCounterPersistError).toBeNull();
  });

  it('does not persist or loadProfile when fetched profile user_id mismatches session', async () => {
    getProfile.mockResolvedValue(baseProfile({ user_id: 'other-user' }));
    const loadProfile = vi.fn();

    const { result } = renderHook(() =>
      useWorkOrderDraft(null, null, vi.fn(), loadProfile)
    );

    await act(async () => {
      await result.current.actions.handleSaveSuccess('job-new', true);
    });

    expect(updateNextWoNumber).not.toHaveBeenCalled();
    expect(loadProfile).not.toHaveBeenCalled();
  });

  it('sets woCounterPersistError when updateNextWoNumber fails', async () => {
    getProfile.mockResolvedValue(baseProfile());
    updateNextWoNumber.mockResolvedValue({ error: new Error('db down') });
    const loadProfile = vi.fn();

    const { result } = renderHook(() =>
      useWorkOrderDraft(null, null, vi.fn(), loadProfile)
    );

    await act(async () => {
      await result.current.actions.handleSaveSuccess('job-new', true);
    });

    expect(loadProfile).not.toHaveBeenCalled();
    await waitFor(() => {
      expect(result.current.state.woCounterPersistError).toMatch(/could not be updated/i);
    });
  });

  it('skips counter path when not a new save', async () => {
    const loadProfile = vi.fn();
    const { result } = renderHook(() =>
      useWorkOrderDraft(null, null, vi.fn(), loadProfile)
    );

    await act(async () => {
      await result.current.actions.handleSaveSuccess('job-existing', false);
    });

    expect(getProfile).not.toHaveBeenCalled();
    expect(loadProfile).not.toHaveBeenCalled();
  });

  it('clears unsaved draft on sign-out so createNewAgreement does not open the modal', async () => {
    const navigateTo = vi.fn();
    const loadProfile = vi.fn();
    const p = baseProfile();
    let userId: string | null = 'u1';

    const { result, rerender } = renderHook(() =>
      useWorkOrderDraft(p, userId, navigateTo, loadProfile)
    );

    act(() => {
      result.current.actions.doCreateNewAgreement(p);
    });
    act(() => {
      result.current.actions.setJob((j) => ({ ...j, requested_work: 'Dirty scope' }));
    });

    userId = null;
    rerender();

    await waitFor(() => {
      expect(navigateTo).toHaveBeenCalledWith('home');
    });

    expect(result.current.state.showUnsavedModal).toBe(false);
    expect(result.current.state.woIsOpen).toBe(false);

    navigateTo.mockClear();
    act(() => {
      result.current.actions.createNewAgreement();
    });

    expect(result.current.state.showUnsavedModal).toBe(false);
    expect(navigateTo).toHaveBeenCalledWith('form');
  });

  it('calls onNewDraft when doCreateNewAgreement creates a new draft', () => {
    const onNewDraft = vi.fn();
    const navigateTo = vi.fn();
    const { result } = renderHook(() =>
      useWorkOrderDraft(null, null, navigateTo, vi.fn(), onNewDraft)
    );

    act(() => {
      result.current.actions.doCreateNewAgreement(null);
    });

    expect(onNewDraft).toHaveBeenCalledTimes(1);
    expect(navigateTo).toHaveBeenCalledWith('form');
  });

  it('does not reset draft when userId goes from null to signed-in', () => {
    const navigateTo = vi.fn();
    const loadProfile = vi.fn();
    const p = baseProfile();
    let userId: string | null = null;

    const { result, rerender } = renderHook(() =>
      useWorkOrderDraft(p, userId, navigateTo, loadProfile)
    );

    act(() => {
      result.current.actions.doCreateNewAgreement(null);
    });
    act(() => {
      result.current.actions.setJob((j) => ({ ...j, requested_work: 'Guest work' }));
    });

    userId = 'u-new';
    rerender();

    expect(result.current.state.woIsOpen).toBe(true);
    expect(result.current.state.job.requested_work).toBe('Guest work');
    expect(navigateTo).not.toHaveBeenCalledWith('home');
  });

  it('preserves intentional empty exclusions and customer obligations from the profile', () => {
    const navigateTo = vi.fn();
    const loadProfile = vi.fn();
    const profile = baseProfile({
      default_exclusions: [],
      default_assumptions: [],
    });

    const { result } = renderHook(() =>
      useWorkOrderDraft(profile, 'u1', navigateTo, loadProfile)
    );

    act(() => {
      result.current.actions.doCreateNewAgreement(profile);
    });

    expect(result.current.state.job.exclusions).toEqual([]);
    expect(result.current.state.job.customer_obligations).toEqual([]);
  });
});
