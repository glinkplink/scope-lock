import { useState } from 'react';
import { upsertProfile } from '../lib/db/profile';
import type { BusinessProfile } from '../types/db';

interface BusinessProfileFormProps {
  userId: string;
  initialProfile?: BusinessProfile | null;
  onSave: () => void;
}

export function BusinessProfileForm({
  userId,
  initialProfile,
  onSave,
}: BusinessProfileFormProps) {
  const [businessName, setBusinessName] = useState(initialProfile?.business_name ?? '');
  const [ownerName, setOwnerName] = useState(initialProfile?.owner_name ?? '');
  const [phone, setPhone] = useState(initialProfile?.phone ?? '');
  const [email, setEmail] = useState(initialProfile?.email ?? '');
  const [address, setAddress] = useState(initialProfile?.address ?? '');
  const [googleUrl, setGoogleUrl] = useState(
    initialProfile?.google_business_profile_url ?? ''
  );
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    const { error } = await upsertProfile({
      user_id: userId,
      business_name: businessName,
      owner_name: ownerName || null,
      phone: phone || null,
      email: email || null,
      address: address || null,
      google_business_profile_url: googleUrl || null,
      default_exclusions: initialProfile?.default_exclusions ?? [],
      default_assumptions: initialProfile?.default_assumptions ?? [],
    });

    setLoading(false);

    if (error) {
      setError(error.message);
    } else {
      onSave();
    }
  };

  return (
    <div className="business-profile-form">
      <h1>{initialProfile ? 'Edit Business Profile' : 'Set Up Your Business Profile'}</h1>
      <form onSubmit={handleSubmit}>
        <label>
          Business Name *
          <input
            type="text"
            value={businessName}
            onChange={(e) => setBusinessName(e.target.value)}
            required
          />
        </label>

        <label>
          Owner Name
          <input
            type="text"
            value={ownerName}
            onChange={(e) => setOwnerName(e.target.value)}
          />
        </label>

        <label>
          Phone
          <input type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} />
        </label>

        <label>
          Email
          <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
        </label>

        <label>
          Address
          <textarea value={address} onChange={(e) => setAddress(e.target.value)} />
        </label>

        <label>
          Google Business Profile URL
          <input
            type="url"
            value={googleUrl}
            onChange={(e) => setGoogleUrl(e.target.value)}
          />
        </label>

        <button type="submit" disabled={loading}>
          {loading ? 'Saving...' : 'Save Profile'}
        </button>

        {error && <p className="error">{error}</p>}
      </form>
    </div>
  );
}
