import { describe, it, expect } from 'vitest';
import { buildGuestPreviewProfile } from '../guest-agreement-profile';

describe('buildGuestPreviewProfile', () => {
  it('maps owner name, email, and phone from form strings', () => {
    const p = buildGuestPreviewProfile({
      ownerFirstName: '  Pat  ',
      ownerLastName: 'Smith',
      ownerBusinessEmail: '  biz@example.com ',
      ownerBusinessPhone: ' 5551234567 ',
    });
    expect(p.business_name).toBe('');
    expect(p.owner_name).toBe('Pat Smith');
    expect(p.email).toBe('biz@example.com');
    expect(p.phone).toBe('5551234567');
  });

  it('uses null for empty owner, email, and phone', () => {
    const p = buildGuestPreviewProfile({
      ownerFirstName: '',
      ownerLastName: '',
      ownerBusinessEmail: '',
      ownerBusinessPhone: '',
    });
    expect(p.owner_name).toBeNull();
    expect(p.email).toBeNull();
    expect(p.phone).toBeNull();
  });
});
