// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { HomePage } from '../HomePage';

describe('HomePage', () => {
  it('renders the greeting, headline, and CTA without the old subheading', () => {
    render(<HomePage onCreateAgreement={vi.fn()} ownerName="Casey" />);

    expect(screen.getByText('Welcome back, Casey')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Cover your ass.' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Create Work Order' })).toBeInTheDocument();
    expect(screen.queryByText(/Work orders that keep your backend clean/i)).not.toBeInTheDocument();
  });
});
