import { describe, it, expect } from 'vitest';
import {
  normalizeOwnerFullName,
  getOwnerNameCaptureBlockReason,
  isOwnerNameComplete,
} from '../owner-name';

describe('owner-name', () => {
  it('normalizeOwnerFullName trims and collapses internal spaces', () => {
    expect(normalizeOwnerFullName('  Jane  ', '  Doe ')).toBe('Jane Doe');
    expect(normalizeOwnerFullName('Mary', 'Ann')).toBe('Mary Ann');
  });

  it('isOwnerNameComplete requires both parts non-empty after trim', () => {
    expect(isOwnerNameComplete('A', 'B')).toBe(true);
    expect(isOwnerNameComplete('', 'B')).toBe(false);
    expect(isOwnerNameComplete('A', '')).toBe(false);
    expect(isOwnerNameComplete('  ', 'x')).toBe(false);
  });

  it('getOwnerNameCaptureBlockReason returns null or the shared message', () => {
    expect(getOwnerNameCaptureBlockReason('Pat', 'Smith')).toBeNull();
    expect(getOwnerNameCaptureBlockReason('', 'Smith')).toBeTruthy();
    expect(getOwnerNameCaptureBlockReason('Pat', '')).toBeTruthy();
  });
});
