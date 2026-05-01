import { useEffect, useMemo, useState } from 'react';
import type { ClientListItem } from '../types/db';
import { listClientItems, upsertClient } from '../lib/db/clients';
import { propagateClientContactToUnsignedJobs } from '../lib/db/jobs';
import { formatUsPhoneInput } from '../lib/us-phone-input';
import './ClientsPage.css';

interface ClientsPageProps {
  userId: string;
}

type EditableField = 'phone' | 'email' | 'address';

type ClientEditDraft = {
  phone: string;
  email: string;
  address: string;
};

function buildEditDraft(client: ClientListItem): ClientEditDraft {
  return {
    phone: formatUsPhoneInput(client.phone ?? ''),
    email: client.email ?? '',
    address: client.address ?? '',
  };
}

function formatLatestActivity(dateValue: string | null): string {
  if (!dateValue) return 'No work orders yet';

  const parsed = new Date(dateValue);
  if (Number.isNaN(parsed.getTime())) return 'No recent activity';

  return parsed.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

function matchClientSearch(client: ClientListItem, searchTerm: string): boolean {
  const query = searchTerm.trim().toLowerCase();
  if (!query) return true;

  return [client.name, client.phone, client.email, client.address]
    .filter((value): value is string => typeof value === 'string' && value.trim().length > 0)
    .some((value) => value.toLowerCase().includes(query));
}

function fieldValueLabel(value: string | null | undefined, fallback: string): string {
  return value?.trim() ? value.trim() : fallback;
}

export function ClientsPage({ userId }: ClientsPageProps) {
  const [clients, setClients] = useState<ClientListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [editingClientId, setEditingClientId] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState<ClientEditDraft | null>(null);
  const [editError, setEditError] = useState<string | null>(null);
  const [savingClientId, setSavingClientId] = useState<string | null>(null);
  /** Which inline-edit field should receive autofocus when the form opens (not read from a ref during render). */
  const [focusField, setFocusField] = useState<EditableField | null>(null);

  useEffect(() => {
    let cancelled = false;

    void (async () => {
      setLoading(true);
      setError(null);
      setClients([]);

      try {
        const result = await listClientItems(userId);
        if (cancelled) return;
        if (result.error || !result.data) {
          setError('Failed to load clients.');
          setClients([]);
          setLoading(false);
          return;
        }

        setClients(result.data);
        setLoading(false);
      } catch {
        if (cancelled) return;
        setError('Failed to load clients.');
        setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [userId]);

  const visibleClients = useMemo(
    () => clients.filter((client) => matchClientSearch(client, searchTerm)),
    [clients, searchTerm]
  );

  const beginEdit = (client: ClientListItem, field?: EditableField) => {
    setEditingClientId(client.id);
    setEditDraft(buildEditDraft(client));
    setEditError(null);
    setFocusField(field ?? null);
  };

  const cancelEdit = () => {
    setEditingClientId(null);
    setEditDraft(null);
    setEditError(null);
    setFocusField(null);
  };

  const saveEdit = async (client: ClientListItem) => {
    if (!editDraft) return;

    setSavingClientId(client.id);
    setEditError(null);

    const trimmedPhone = editDraft.phone.trim();
    const trimmedEmail = editDraft.email.trim();
    const trimmedAddress = editDraft.address.trim();

    const emailChanged = (trimmedEmail || null) !== (client.email?.trim() || null);
    const phoneChanged = (trimmedPhone || null) !== (client.phone?.trim() || null);

    const result = await upsertClient({
      id: client.id,
      user_id: client.user_id,
      name: client.name,
      name_normalized: client.name_normalized,
      notes: client.notes,
      phone: trimmedPhone || null,
      email: trimmedEmail || null,
      address: trimmedAddress || null,
    });

    setSavingClientId(null);

    if (result.error || !result.data) {
      setEditError(result.error?.message || 'Failed to save client.');
      return;
    }

    if (emailChanged || phoneChanged) {
      await propagateClientContactToUnsignedJobs(
        client.id,
        emailChanged ? (trimmedEmail || null) : undefined,
        phoneChanged ? (trimmedPhone || null) : undefined
      );
    }

    setClients((current) =>
      current.map((entry) =>
        entry.id === client.id
          ? {
              ...entry,
              ...result.data,
            }
          : entry
      )
    );
    cancelEdit();
  };

  return (
    <div className="clients-page" aria-busy={loading}>
      <div className="clients-toolbar">
        <h1 className="clients-title">Clients</h1>
        <p className="clients-subtitle">Keep customer details clean so the next work order is faster.</p>
      </div>

      <div className="clients-search-group form-group">
        <label htmlFor="clients-search">Search clients</label>
        <input
          id="clients-search"
          type="search"
          value={searchTerm}
          onChange={(event) => setSearchTerm(event.target.value)}
          placeholder="Search by name, phone, email, or address"
        />
      </div>

      {loading ? <div className="clients-status">Loading…</div> : null}

      {!loading && error ? (
        <div className="clients-status clients-status--error" role="alert">
          {error}
        </div>
      ) : null}

      {!loading && !error && clients.length === 0 ? (
        <div className="clients-status">No clients yet.</div>
      ) : null}

      {!loading && !error && clients.length > 0 && visibleClients.length === 0 ? (
        <div className="clients-status">No clients match that search.</div>
      ) : null}

      {!loading && !error && visibleClients.length > 0 ? (
        <ul className="clients-list">
          {visibleClients.map((client) => {
            const isEditing = editingClientId === client.id && editDraft !== null;
            const isSaving = savingClientId === client.id;

            return (
              <li key={client.id} className={`clients-card${isSaving ? ' clients-card--saving' : ''}`}>
                <div className="clients-card-top">
                  <div>
                    <h2 className="clients-card-title">{client.name}</h2>
                    <div className="clients-card-meta">
                      <span>{client.jobCount} work order{client.jobCount === 1 ? '' : 's'}</span>
                      <span>Last activity {formatLatestActivity(client.latestActivityAt)}</span>
                    </div>
                  </div>
                  {!isEditing ? (
                    <button
                      type="button"
                      className="clients-card-edit"
                      onClick={() => beginEdit(client)}
                    >
                      Edit
                    </button>
                  ) : null}
                </div>

                {!isEditing ? (
                  <>
                    <div className="clients-contact-grid">
                      <button
                        type="button"
                        className={`clients-field-chip${client.phone ? '' : ' clients-field-chip--missing'}`}
                        onClick={() => beginEdit(client, 'phone')}
                      >
                        <span className="clients-field-label">Phone</span>
                        <span className="clients-field-value">
                          {fieldValueLabel(client.phone, 'Add phone')}
                        </span>
                      </button>
                      <button
                        type="button"
                        className={`clients-field-chip${client.email ? '' : ' clients-field-chip--missing'}`}
                        onClick={() => beginEdit(client, 'email')}
                      >
                        <span className="clients-field-label">Email</span>
                        <span className="clients-field-value">
                          {fieldValueLabel(client.email, 'Add email')}
                        </span>
                      </button>
                      <button
                        type="button"
                        className={`clients-field-chip clients-field-chip--address${client.address ? '' : ' clients-field-chip--missing'}`}
                        onClick={() => beginEdit(client, 'address')}
                      >
                        <span className="clients-field-label">Address</span>
                        <span className="clients-field-value">
                          {fieldValueLabel(client.address, 'Add address')}
                        </span>
                      </button>
                    </div>

                    {client.notes?.trim() ? (
                      <p className="clients-card-notes">{client.notes.trim()}</p>
                    ) : null}
                  </>
                ) : (
                  <form
                    className="clients-inline-form"
                    onSubmit={(event) => {
                      event.preventDefault();
                      void saveEdit(client);
                    }}
                  >
                    <div className="form-group">
                      <label htmlFor={`client-phone-${client.id}`}>Phone</label>
                      <input
                        id={`client-phone-${client.id}`}
                        type="text"
                        value={editDraft.phone}
                        autoFocus={focusField === 'phone'}
                        onChange={(event) =>
                          setEditDraft((current) =>
                            current
                              ? {
                                  ...current,
                                  phone: formatUsPhoneInput(event.target.value),
                                }
                              : current
                          )
                        }
                      />
                    </div>
                    <div className="form-group">
                      <label htmlFor={`client-email-${client.id}`}>Email</label>
                      <input
                        id={`client-email-${client.id}`}
                        type="email"
                        value={editDraft.email}
                        autoFocus={focusField === 'email'}
                        onChange={(event) =>
                          setEditDraft((current) =>
                            current
                              ? {
                                  ...current,
                                  email: event.target.value,
                                }
                              : current
                          )
                        }
                      />
                    </div>
                    <div className="form-group">
                      <label htmlFor={`client-address-${client.id}`}>Address</label>
                      <textarea
                        id={`client-address-${client.id}`}
                        rows={3}
                        autoFocus={focusField === 'address'}
                        value={editDraft.address}
                        onChange={(event) =>
                          setEditDraft((current) =>
                            current
                              ? {
                                  ...current,
                                  address: event.target.value,
                                }
                              : current
                          )
                        }
                      />
                    </div>

                    {editError ? (
                      <p className="clients-inline-error" role="alert">
                        {editError}
                      </p>
                    ) : null}

                    <div className="clients-inline-actions">
                      <button type="submit" className="btn-primary" disabled={isSaving}>
                        {isSaving ? 'Saving…' : 'Save'}
                      </button>
                      <button type="button" className="btn-secondary" onClick={cancelEdit} disabled={isSaving}>
                        Cancel
                      </button>
                    </div>
                  </form>
                )}
              </li>
            );
          })}
        </ul>
      ) : null}
    </div>
  );
}
