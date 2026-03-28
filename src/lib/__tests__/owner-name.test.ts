import { describe, it, expect } from 'vitest';
import { normalizeOwnerFullName, splitFullNameForForm } from '../owner-name';

describe('owner-name', () => {
  it('normalizeOwnerFullName trims and collapses internal spaces', () => {
    expect(normalizeOwnerFullName('  Jane  ', '  Doe ')).toBe('Jane Doe');
    expect(normalizeOwnerFullName('Mary', 'Ann')).toBe('Mary Ann');
  });

  it('returns empty string when both parts empty', () => {
    expect(normalizeOwnerFullName('', '')).toBe('');
  });

  it('splitFullNameForForm splits on first space; single token is first name only', () => {
    expect(splitFullNameForForm('Jane Smith')).toEqual({ first: 'Jane', last: 'Smith' });
    expect(splitFullNameForForm('  Acme  ')).toEqual({ first: 'Acme', last: '' });
    expect(splitFullNameForForm('')).toEqual({ first: '', last: '' });
  });

  it('round-trip split then normalize matches for typical two-word names', () => {
    const full = 'Pat Q. Smith';
    const { first, last } = splitFullNameForForm(full);
    expect(normalizeOwnerFullName(first, last)).toBe(full);
  });
});
