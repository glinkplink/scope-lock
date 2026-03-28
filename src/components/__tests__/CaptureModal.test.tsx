// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { CaptureModal } from '../CaptureModal';

afterEach(() => {
  cleanup();
});

describe('CaptureModal', () => {
  it('submits with saveAsDefaults=true by default', async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn();
    render(
      <CaptureModal onSubmit={onSubmit} onClose={() => {}} error="" submitting={false} />
    );

    await user.type(screen.getByLabelText(/business name/i), 'Acme Welding');
    await user.type(screen.getByLabelText(/^email$/i), 'test@example.com');
    await user.type(screen.getByLabelText(/password/i), 'hunter2');
    await user.click(screen.getByRole('button', { name: /create account & download/i }));

    expect(onSubmit).toHaveBeenCalledWith(
      'Acme Welding',
      'test@example.com',
      'hunter2',
      true
    );
  });

  it('submits with saveAsDefaults=false when unchecked and associates the checkbox with the help text', async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn();
    render(
      <CaptureModal onSubmit={onSubmit} onClose={() => {}} error="" submitting={false} />
    );

    const checkbox = screen.getByLabelText(/save defaults\?/i);
    expect(checkbox).toHaveAccessibleDescription(
      /optionally save the scope and payment settings from this work order/i
    );

    await user.click(checkbox);
    await user.type(screen.getByLabelText(/business name/i), 'Acme Welding');
    await user.type(screen.getByLabelText(/^email$/i), 'test@example.com');
    await user.type(screen.getByLabelText(/password/i), 'hunter2');
    await user.click(screen.getByRole('button', { name: /create account & download/i }));

    expect(onSubmit).toHaveBeenCalledWith(
      'Acme Welding',
      'test@example.com',
      'hunter2',
      false
    );
  });
});
