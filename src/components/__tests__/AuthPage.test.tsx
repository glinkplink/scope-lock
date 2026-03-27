// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { AuthPage } from '../AuthPage';

vi.mock('../../lib/auth', () => ({
  signIn: vi.fn().mockResolvedValue({ error: null }),
}));

afterEach(() => {
  cleanup();
});

describe('AuthPage', () => {
  it('associates email and password inputs with visible labels', () => {
    render(<AuthPage />);

    expect(screen.getByLabelText(/^Email$/i)).toHaveAttribute('type', 'email');
    expect(screen.getByLabelText(/^Password$/i)).toHaveAttribute('type', 'password');
  });
});
