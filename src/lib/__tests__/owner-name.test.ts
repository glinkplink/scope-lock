import { describe, it, expect } from 'vitest';
import { normalizeOwnerFullName } from '../owner-name';

describe('owner-name', () => {
  it('normalizeOwnerFullName trims and collapses internal spaces', () => {
    expect(normalizeOwnerFullName('  Jane  ', '  Doe ')).toBe('Jane Doe');
    expect(normalizeOwnerFullName('Mary', 'Ann')).toBe('Mary Ann');
  });

  it('returns empty string when both parts empty', () => {
    expect(normalizeOwnerFullName('', '')).toBe('');
  });
});
