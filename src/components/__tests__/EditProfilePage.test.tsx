// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { EditProfilePage } from '../EditProfilePage';
import type { BusinessProfile } from '../../types/db';

const upsertProfile = vi.fn();
const startStripeConnect = vi.fn();
const redirectToStripeConnect = vi.fn();

vi.mock('../../lib/db/profile', () => ({
  upsertProfile: (...args: unknown[]) => upsertProfile(...args),
}));

vi.mock('../../lib/stripe-connect', () => ({
  startStripeConnect: (...args: unknown[]) => startStripeConnect(...args),
  redirectToStripeConnect: (...args: unknown[]) => redirectToStripeConnect(...args),
}));

vi.mock('../../lib/auth', () => ({
  signOut: vi.fn(),
}));

function profileFixture(overrides: Partial<BusinessProfile> = {}): BusinessProfile {
  return {
    id: 'p1',
    user_id: 'u1',
    business_name: 'Test Co',
    owner_name: null,
    phone: null,
    email: null,
    address: null,
    google_business_profile_url: null,
    default_exclusions: [],
    default_assumptions: [],
    next_wo_number: 1,
    next_invoice_number: 1,
    default_warranty_period: 30,
    default_negotiation_period: 10,
    default_payment_methods: [],
    default_tax_rate: 0,
    default_late_payment_terms: '',
    default_payment_terms_days: 14,
    default_late_fee_rate: 1.5,
    default_card_fee_note: false,
    stripe_account_id: null,
    stripe_onboarding_complete: false,
    created_at: '',
    updated_at: '',
    ...overrides,
  };
}

afterEach(() => {
  cleanup();
});

describe('EditProfilePage payment validation', () => {
  beforeEach(() => {
    upsertProfile.mockReset();
    startStripeConnect.mockReset();
    redirectToStripeConnect.mockReset();
  });

  it('shows error banner and does not call upsert when payment terms days are invalid', async () => {
    const user = userEvent.setup();
    upsertProfile.mockResolvedValue({ data: null, error: null });
    render(
      <EditProfilePage
        profile={profileFixture()}
        onSave={vi.fn()}
        onCancel={vi.fn()}
      />
    );

    await user.selectOptions(screen.getByLabelText(/Payment Terms/i), 'custom');
    const daysInput = screen.getByLabelText(/^Days$/i);
    await user.clear(daysInput);
    await user.type(daysInput, '0');

    const form = document.querySelector('form');
    expect(form).toBeTruthy();
    fireEvent.submit(form!);

    expect(upsertProfile).not.toHaveBeenCalled();
    await waitFor(() => {
      expect(
        screen.getByText(/Payment terms must be between 1 and 365 days/i)
      ).toBeInTheDocument();
    });
  });

  it('calls upsert when payment settings are valid', async () => {
    upsertProfile.mockResolvedValue({
      data: profileFixture(),
      error: null,
    });
    render(
      <EditProfilePage
        profile={profileFixture()}
        onSave={vi.fn()}
        onCancel={vi.fn()}
      />
    );

    const form = document.querySelector('form');
    expect(form).toBeTruthy();
    fireEvent.submit(form!);

    await waitFor(() => {
      expect(upsertProfile).toHaveBeenCalledTimes(1);
    });
  });

  it('renders Stripe status states from the profile', () => {
    const { rerender } = render(
      <EditProfilePage
        profile={profileFixture()}
        onSave={vi.fn()}
        onCancel={vi.fn()}
      />
    );

    expect(
      screen.getByText(/existing Stripe users may be able to sign in and reuse details during setup/i)
    ).toBeInTheDocument();
    expect(screen.getByText('Not connected')).toBeInTheDocument();
    expect(
      screen.getByText(/Stripe may let you sign in and reuse existing business details/i)
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Connect Stripe/i })).toHaveAttribute('type', 'button');

    rerender(
      <EditProfilePage
        profile={profileFixture({ stripe_account_id: 'acct_123', stripe_onboarding_complete: false })}
        onSave={vi.fn()}
        onCancel={vi.fn()}
      />
    );
    expect(screen.getByText('Setup in progress')).toBeInTheDocument();
    expect(
      screen.getByText(/continue setup to finish connecting your account and enable invoice payments/i)
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Continue Stripe Setup/i })).toBeInTheDocument();

    rerender(
      <EditProfilePage
        profile={profileFixture({ stripe_account_id: 'acct_123', stripe_onboarding_complete: true })}
        onSave={vi.fn()}
        onCancel={vi.fn()}
      />
    );
    expect(screen.getByText('Connected')).toBeInTheDocument();
    expect(
      screen.getByText(/Stripe is connected and ready for invoice payment links/i)
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Update Stripe Setup/i })).toBeInTheDocument();
  });

  it('saves first, then starts Stripe onboarding from the separate CTA', async () => {
    const user = userEvent.setup();
    const savedProfile = profileFixture({ business_name: 'Updated Co' });
    const onSave = vi.fn();

    upsertProfile.mockResolvedValue({
      data: savedProfile,
      error: null,
    });
    startStripeConnect.mockResolvedValue({
      accountId: 'acct_123',
      url: 'https://connect.stripe.test/onboarding',
    });
    render(
      <EditProfilePage
        profile={profileFixture()}
        onSave={onSave}
        onCancel={vi.fn()}
      />
    );

    await user.clear(screen.getByLabelText(/Business Name/i));
    await user.type(screen.getByLabelText(/Business Name/i), 'Updated Co');
    await user.click(screen.getByRole('button', { name: /Connect Stripe/i }));

    await waitFor(() => {
      expect(upsertProfile).toHaveBeenCalledTimes(1);
      expect(startStripeConnect).toHaveBeenCalledTimes(1);
      expect(onSave).toHaveBeenCalledWith(savedProfile);
      expect(redirectToStripeConnect).toHaveBeenCalledWith('https://connect.stripe.test/onboarding');
    });
  });

  it('does not start Stripe onboarding when save fails', async () => {
    const user = userEvent.setup();
    upsertProfile.mockResolvedValue({
      data: null,
      error: { message: 'Save failed' },
    });

    render(
      <EditProfilePage
        profile={profileFixture()}
        onSave={vi.fn()}
        onCancel={vi.fn()}
      />
    );

    await user.click(screen.getByRole('button', { name: /Connect Stripe/i }));

    await waitFor(() => {
      expect(startStripeConnect).not.toHaveBeenCalled();
      expect(screen.getByText(/Save failed/i)).toBeInTheDocument();
    });
  });
});
