// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ClientListItem } from '../../types/db';
import { ClientsPage } from '../ClientsPage';

const listClientItems = vi.fn();
const upsertClient = vi.fn();

vi.mock('../../lib/db/clients', () => ({
  listClientItems: (...args: unknown[]) => listClientItems(...args),
  upsertClient: (...args: unknown[]) => upsertClient(...args),
}));

function buildClient(overrides: Partial<ClientListItem> = {}): ClientListItem {
  return {
    id: 'client-1',
    user_id: 'u1',
    name: 'Acme Fabrication',
    name_normalized: 'acme fabrication',
    phone: '5551231234',
    email: 'hello@acme.com',
    address: '123 Forge St',
    notes: 'Prefers morning appointments.',
    created_at: '2025-01-01T00:00:00Z',
    updated_at: '2025-01-01T00:00:00Z',
    jobCount: 3,
    latestActivityAt: '2025-02-15T00:00:00Z',
    ...overrides,
  };
}

describe('ClientsPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    cleanup();
  });

  it('renders loading then client cards from enriched rows', async () => {
    listClientItems.mockResolvedValue({
      data: [buildClient()],
      error: null,
    });

    render(<ClientsPage userId="u1" />);

    expect(screen.getByText('Loading…')).toBeInTheDocument();

    await waitFor(() => {
      expect(screen.getByText('Acme Fabrication')).toBeInTheDocument();
    });

    expect(screen.getByText('3 work orders')).toBeInTheDocument();
    expect(screen.getByText(/Last activity Feb/i)).toBeInTheDocument();
    expect(screen.getByText('Prefers morning appointments.')).toBeInTheDocument();
  });

  it('renders error and empty states', async () => {
    listClientItems.mockResolvedValueOnce({
      data: null,
      error: new Error('boom'),
    });

    const { rerender } = render(<ClientsPage userId="u1" />);

    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent('Failed to load clients.');
    });

    listClientItems.mockResolvedValueOnce({
      data: [],
      error: null,
    });

    rerender(<ClientsPage userId="u2" />);

    await waitFor(() => {
      expect(screen.getByText('No clients yet.')).toBeInTheDocument();
    });
  });

  it('filters in real time by name, phone, email, and address only', async () => {
    const alpha = buildClient({
      id: 'client-a',
      name: 'Alpha Iron',
      name_normalized: 'alpha iron',
      phone: '111-1111',
      email: 'alpha@example.com',
      address: '12 River Rd',
      notes: 'Alpha-only note',
    });
    const bravo = buildClient({
      id: 'client-b',
      name: 'Bravo Steel',
      name_normalized: 'bravo steel',
      phone: '222-2222',
      email: 'bravo@example.com',
      address: '98 Market St',
      notes: 'Unique bravo note',
    });
    listClientItems.mockResolvedValue({
      data: [alpha, bravo],
      error: null,
    });

    const user = userEvent.setup();
    render(<ClientsPage userId="u1" />);

    await waitFor(() => {
      expect(screen.getByText('Alpha Iron')).toBeInTheDocument();
    });

    await user.type(screen.getByLabelText('Search clients'), '222-2222');
    expect(screen.queryByText('Alpha Iron')).not.toBeInTheDocument();
    expect(screen.getByText('Bravo Steel')).toBeInTheDocument();

    await user.clear(screen.getByLabelText('Search clients'));
    await user.type(screen.getByLabelText('Search clients'), 'Unique bravo note');

    expect(screen.getByText('No clients match that search.')).toBeInTheDocument();
  });

  it('opens inline editing from missing field prompts and saves the client record', async () => {
    const missingClient = buildClient({
      id: 'client-missing',
      name: 'Missing Fields Co',
      name_normalized: 'missing fields co',
      phone: null,
      email: null,
      address: null,
    });
    const savedClient = {
      ...missingClient,
      phone: '(555) 999-0000',
      email: 'client@example.com',
      address: '5 Main St',
    };

    listClientItems.mockResolvedValue({
      data: [missingClient],
      error: null,
    });
    upsertClient.mockResolvedValue({
      data: savedClient,
      error: null,
    });

    const user = userEvent.setup();
    render(<ClientsPage userId="u1" />);

    await waitFor(() => {
      expect(screen.getByText('Missing Fields Co')).toBeInTheDocument();
    });

    await user.click(screen.getByRole('button', { name: /PhoneAdd phone/i }));

    await user.type(screen.getByLabelText('Phone'), '5559990000');
    await user.type(screen.getByLabelText('Email'), 'client@example.com');
    await user.type(screen.getByLabelText('Address'), '5 Main St');
    await user.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => {
      expect(upsertClient).toHaveBeenCalledWith(
        expect.objectContaining({
          id: 'client-missing',
          phone: '(555) 999-0000',
          email: 'client@example.com',
          address: '5 Main St',
        })
      );
    });

    await waitFor(() => {
      expect(screen.getByText('(555) 999-0000')).toBeInTheDocument();
    });
    expect(screen.getByText('client@example.com')).toBeInTheDocument();
    expect(screen.getByText('5 Main St')).toBeInTheDocument();
  });

  it('lets existing values enter edit mode and cancel without mutating', async () => {
    listClientItems.mockResolvedValue({
      data: [buildClient()],
      error: null,
    });

    const user = userEvent.setup();
    render(<ClientsPage userId="u1" />);

    await waitFor(() => {
      expect(screen.getByText('Acme Fabrication')).toBeInTheDocument();
    });

    await user.click(screen.getByRole('button', { name: 'Edit' }));
    await user.clear(screen.getByLabelText('Phone'));
    await user.type(screen.getByLabelText('Phone'), '000');
    await user.click(screen.getByRole('button', { name: 'Cancel' }));

    expect(upsertClient).not.toHaveBeenCalled();
    expect(screen.getByText('5551231234')).toBeInTheDocument();
    expect(screen.queryByDisplayValue('000')).not.toBeInTheDocument();
  });
});
