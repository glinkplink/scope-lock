// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { JobForm } from '../JobForm';
import type { WelderJob } from '../../types';
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
});

async function clickAgreementPreview(
  user: ReturnType<typeof userEvent.setup>,
  container: HTMLElement
) {
  const btn = container.querySelector('.job-form-preview-footer button');
  if (!btn) throw new Error('Preview button not found');
  await user.click(btn);
}

describe('JobForm payment terms', () => {
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
