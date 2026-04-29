// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
const searchClients = vi.fn();
vi.mock('../../lib/db/clients', () => ({
  searchClients: (...args: unknown[]) => searchClients(...args),
}));
vi.mock('../../lib/geoapify-autocomplete', () => ({
  fetchGeoapifyAddressSuggestions: vi.fn().mockResolvedValue([]),
}));
import { JobForm } from '../JobForm';
import type { WelderJob } from '../../types';
import type { Client } from '../../types/db';
import sampleJob from '../../data/sample-job.json';

const baseJob: WelderJob = {
  ...(sampleJob as WelderJob),
  customer_first_name: 'Acme',
  customer_last_name: '',
  customer_name: 'Acme',
  customer_phone: '',
  customer_email: '',
  job_location: '123 Main St',
  job_site_street: '123 Main St',
  job_site_city: '',
  job_site_state: '',
  job_site_zip: '',
  governing_state: '',
  asset_or_item_description: 'Tank',
  requested_work: 'Weld',
  price: 100,
};

afterEach(() => {
  cleanup();
  searchClients.mockReset();
  vi.useRealTimers();
});

function buildClient(overrides: Partial<Client> & Pick<Client, 'id' | 'name'>): Client {
  return {
    id: overrides.id,
    user_id: 'u1',
    name: overrides.name,
    name_normalized: overrides.name.trim().toLowerCase(),
    phone: overrides.phone ?? null,
    email: overrides.email ?? null,
    address: overrides.address ?? null,
    notes: overrides.notes ?? null,
    created_at: overrides.created_at ?? '2026-03-28T00:00:00Z',
    updated_at: overrides.updated_at ?? '2026-03-28T00:00:00Z',
  };
}

function renderStatefulJobForm() {
  function StatefulJobForm() {
    const [job, setJob] = useState<WelderJob>({
      ...baseJob,
      customer_first_name: '',
      customer_last_name: '',
      customer_name: '',
    });
    return <JobForm job={job} onChange={setJob} userId="u1" />;
  }

  return render(<StatefulJobForm />);
}

async function clickAgreementPreview(
  user: ReturnType<typeof userEvent.setup>,
  container: HTMLElement
) {
  const btn = container.querySelector('.job-form-preview-footer button');
  if (!btn) throw new Error('Preview button not found');
  await user.click(btn);
}

describe('JobForm payment terms', () => {
  it('uses text currency fields so wheel scrolling cannot step the work-order price down a penny', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<JobForm job={{ ...baseJob, price: 0, deposit_amount: 0 }} onChange={onChange} />);

    const priceInput = screen.getByLabelText(/Total Price/i);
    const depositInput = screen.getByLabelText(/Deposit Amount/i);

    expect(priceInput).toHaveAttribute('type', 'text');
    expect(priceInput).toHaveAttribute('inputmode', 'decimal');
    expect(priceInput).not.toHaveAttribute('step');
    expect(depositInput).toHaveAttribute('type', 'text');
    expect(depositInput).not.toHaveAttribute('step');

    await user.type(priceInput, '$2,000.00');

    const last = onChange.mock.calls.at(-1)?.[0] as WelderJob;
    expect(last.price).toBe(2000);
  });

  it('uses the local calendar day for date input minimums', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-03-28T00:30:00.000Z'));

    render(<JobForm job={baseJob} onChange={vi.fn()} />);

    const today = new Date();
    const expectedMin = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(
      today.getDate()
    ).padStart(2, '0')}`;

    expect(screen.getByLabelText(/Agreement Date/i)).toHaveAttribute('min', expectedMin);
    expect(screen.getByLabelText(/Target Start Date/i)).toHaveAttribute('min', expectedMin);
  });

  it('sets payment_terms_days when selecting Net 30', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(
      <JobForm job={{ ...baseJob, payment_terms_days: 14 }} onChange={onChange} />
    );

    await user.selectOptions(screen.getByLabelText(/Payment Terms/i), 'net_30');
    expect(onChange).toHaveBeenCalled();
    const last = onChange.mock.calls.at(-1)?.[0] as WelderJob;
    expect(last.payment_terms_days).toBe(30);
  });

  it('blocks Preview when late fee field is empty', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    const onGoToPreview = vi.fn();
    const { container } = render(
      <JobForm
        job={{ ...baseJob, payment_terms_days: 14, late_fee_rate: 1.5 }}
        onChange={onChange}
        onGoToPreview={onGoToPreview}
      />
    );

    const lateInput = screen.getByLabelText(/Late Fee/i);
    await user.clear(lateInput);
    await clickAgreementPreview(user, container);

    expect(onGoToPreview).not.toHaveBeenCalled();
    expect(screen.getByRole('alert')).toHaveTextContent(/late fee/i);
  });

  it('calls onGoToPreview when payment and late fee are valid', async () => {
    const user = userEvent.setup();
    const onGoToPreview = vi.fn();
    const { container } = render(
      <JobForm
        job={{ ...baseJob, payment_terms_days: 14, late_fee_rate: 1.5 }}
        onChange={vi.fn()}
        onGoToPreview={onGoToPreview}
      />
    );

    await clickAgreementPreview(user, container);
    expect(onGoToPreview).toHaveBeenCalledTimes(1);
  });

  it('blocks Preview when custom days is empty', async () => {
    const user = userEvent.setup();
    const onGoToPreview = vi.fn();
    const { container } = render(
      <JobForm
        job={{ ...baseJob, payment_terms_days: 21, late_fee_rate: 1.5 }}
        onChange={vi.fn()}
        onGoToPreview={onGoToPreview}
      />
    );

    expect(screen.getByLabelText(/Payment Terms/i)).toHaveValue('custom');
    await user.clear(screen.getByPlaceholderText('14'));
    await clickAgreementPreview(user, container);

    expect(onGoToPreview).not.toHaveBeenCalled();
    expect(screen.getByRole('alert')).toHaveTextContent(/payment terms|days/i);
  });

  it('keeps error visible after re-focus; clears error when valid value entered', async () => {
    const user = userEvent.setup();
    render(
      <JobForm
        job={{ ...baseJob, payment_terms_days: 21, late_fee_rate: 1.5 }}
        onChange={vi.fn()}
      />
    );

    const daysInput = screen.getByPlaceholderText('14');

    // Type invalid value and blur — error should appear
    await user.clear(daysInput);
    await user.type(daysInput, 'abc');
    await user.tab(); // triggers blur → marks touched → validates → error
    expect(screen.getByRole('alert')).toBeInTheDocument();

    // Re-focus the field — error stays visible
    await user.click(daysInput);
    expect(screen.getByRole('alert')).toBeInTheDocument();

    // Fix the value — error clears immediately
    await user.clear(daysInput);
    await user.type(daysInput, '30');
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });
});

describe('JobForm Your Information (no profile)', () => {
  it('shows Your Information, autosign note, name fields, and Business Phone when showOwnerNameFields', () => {
    render(
      <JobForm
        job={{ ...baseJob, payment_terms_days: 14, late_fee_rate: 1.5 }}
        onChange={vi.fn()}
        showOwnerNameFields
        ownerFirstName=""
        ownerLastName=""
        ownerBusinessPhone=""
        onOwnerFirstNameChange={vi.fn()}
        onOwnerLastNameChange={vi.fn()}
        onOwnerBusinessPhoneChange={vi.fn()}
      />
    );
    expect(screen.getByRole('heading', { name: /your information/i })).toBeInTheDocument();
    expect(screen.getByText(/pre-fill the Service Provider printed name/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/^First Name$/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/^Last Name$/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/^Business Phone$/i)).toBeInTheDocument();
  });

  it('calls onGoToPreview when payment and late fee are valid even if owner names empty', async () => {
    const user = userEvent.setup();
    const onGoToPreview = vi.fn();
    const { container } = render(
      <JobForm
        job={{ ...baseJob, payment_terms_days: 14, late_fee_rate: 1.5 }}
        onChange={vi.fn()}
        onGoToPreview={onGoToPreview}
        showOwnerNameFields
        ownerFirstName=""
        ownerLastName=""
        ownerBusinessPhone=""
        onOwnerFirstNameChange={vi.fn()}
        onOwnerLastNameChange={vi.fn()}
        onOwnerBusinessPhoneChange={vi.fn()}
      />
    );

    await clickAgreementPreview(user, container);
    expect(onGoToPreview).toHaveBeenCalledTimes(1);
  });
});

describe('JobForm client autosuggest', () => {
  it('prioritizes first-name prefix matches ahead of substring-only matches', async () => {
    searchClients.mockResolvedValue([
      buildClient({ id: 'client-a', name: 'Jonny Apples', phone: '4845153545' }),
      buildClient({
        id: 'client-b',
        name: 'Lenny Hammers',
        phone: '8172819201',
        email: 'escrowloopy@pattycakes.gov',
      }),
    ]);

    const user = userEvent.setup();
    renderStatefulJobForm();

    await user.type(screen.getByLabelText(/Customer First Name/i), 'Le');

    await waitFor(() => {
      expect(searchClients).toHaveBeenCalledWith('u1', { firstName: 'Le', lastName: '' });
    });

    await waitFor(() => {
      expect(screen.getByRole('listbox')).toBeInTheDocument();
    });

    const options = within(screen.getByRole('listbox')).getAllByRole('option');
    expect(options[0]).toHaveTextContent('Lenny Hammers');
    expect(options[1]).toHaveTextContent('Jonny Apples');
  });

  it('hides shared-last-name suggestions when the first name does not match the same client', async () => {
    searchClients.mockResolvedValue([
      buildClient({ id: 'client-a', name: 'John Smith', phone: '4845153545' }),
      buildClient({ id: 'client-b', name: 'Jane Smith', phone: '8172819201' }),
    ]);

    const user = userEvent.setup();
    renderStatefulJobForm();

    await user.type(screen.getByLabelText(/Customer First Name/i), 'Lenny');
    await waitFor(() => {
      expect(searchClients).toHaveBeenLastCalledWith('u1', { firstName: 'Lenny', lastName: '' });
    });

    await user.type(screen.getByLabelText(/Customer Last Name/i), 'Smith');

    await waitFor(() => {
      expect(searchClients).toHaveBeenLastCalledWith('u1', {
        firstName: 'Lenny',
        lastName: 'Smith',
      });
    });

    await waitFor(() => {
      expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
    });
  });
});
