// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { BusinessProfileForm } from '../BusinessProfileForm';
import type { BusinessProfile } from '../../types/db';

const upsertProfile = vi.fn();

vi.mock('../../lib/db/profile', () => ({
  upsertProfile: (...args: unknown[]) => upsertProfile(...args),
}));

function profileFixture(overrides: Partial<BusinessProfile> = {}): BusinessProfile {
  return {
    id: 'profile-1',
    user_id: 'user-1',
    business_name: 'IronWork Test',
    owner_name: 'Owner Name',
    phone: '555-111-2222',
    email: 'owner@example.com',
    address: '123 Test St',
    google_business_profile_url: 'https://example.com',
    default_exclusions: [],
    default_assumptions: [],
    next_wo_number: 1,
    next_invoice_number: 1,
    default_warranty_period: 30,
    default_negotiation_period: 10,
    default_payment_methods: [],
    default_tax_rate: 0,
    default_late_payment_terms: '',
    default_payment_terms_days: 30,
    default_late_fee_rate: 0,
    default_card_fee_note: false,
    stripe_account_id: null,
    stripe_onboarding_complete: false,
    created_at: '',
    updated_at: '',
    ...overrides,
  };
}

describe('BusinessProfileForm', () => {
  beforeEach(() => {
    upsertProfile.mockReset();
  });

  afterEach(() => {
    cleanup();
  });

  it('continues new-user setup without saving a profile row', async () => {
    const user = userEvent.setup();
    const onContinue = vi.fn();

    render(
      <BusinessProfileForm isNewUser onContinue={onContinue} onSignInClick={vi.fn()} />
    );

    await user.type(screen.getByLabelText(/business name/i), 'Forge Welding');
    await user.type(screen.getByLabelText(/^Email$/i), 'forge@example.com');
    await user.click(screen.getByRole('button', { name: /continue/i }));

    expect(upsertProfile).not.toHaveBeenCalled();
    expect(onContinue).toHaveBeenCalledWith(
      expect.objectContaining({
        businessName: 'Forge Welding',
        email: 'forge@example.com',
      })
    );
  });

  it('shows an error when signed-in save mode is missing userId', async () => {
    const user = userEvent.setup();

    render(<BusinessProfileForm initialProfile={profileFixture()} />);

    await user.click(screen.getByRole('button', { name: /save profile/i }));

    await waitFor(() => {
      expect(screen.getByText(/user id is required/i)).toBeInTheDocument();
    });
    expect(upsertProfile).not.toHaveBeenCalled();
  });

  it('saves the profile for signed-in users', async () => {
    const user = userEvent.setup();
    const onSave = vi.fn();
    upsertProfile.mockResolvedValue({ error: null });

    render(
      <BusinessProfileForm
        userId="user-1"
        initialProfile={profileFixture()}
        onSave={onSave}
      />
    );

    await user.click(screen.getByRole('button', { name: /save profile/i }));

    await waitFor(() => {
      expect(upsertProfile).toHaveBeenCalledTimes(1);
      expect(onSave).toHaveBeenCalledTimes(1);
    });
  });
});
