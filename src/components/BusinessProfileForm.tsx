import { useState } from 'react';
import { upsertProfile } from '../lib/db/profile';
import { getDefaultCustomerObligations, getDefaultExclusions } from '../lib/defaults';
import type { BusinessProfile } from '../types/db';
import './BusinessProfileForm.css';

interface BusinessProfileFormProps {
  userId?: string;
  initialProfile?: BusinessProfile | null;
  onSave?: () => void;
  onContinue?: (profileData: {
    businessName: string;
    ownerName: string;
    phone: string;
    email: string;
    address: string;
    googleUrl: string;
  }) => void;
  onSignInClick?: () => void;
  isNewUser?: boolean;
}

export function BusinessProfileForm({
  userId,
  initialProfile,
  onSave,
  onContinue,
  onSignInClick,
  isNewUser = false,
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

    // New user flow - advance to password creation
    if (isNewUser && onContinue) {
      onContinue({
        businessName,
        ownerName,
        phone,
        email,
        address,
        googleUrl,
      });
      setLoading(false);
      return;
    }

    // Existing user flow - save profile
    if (!userId) {
      setError('User ID is required');
      setLoading(false);
      return;
    }

    const { error } = await upsertProfile({
      user_id: userId,
      business_name: businessName,
      owner_name: ownerName || null,
      phone: phone || null,
      email: email || null,
      address: address || null,
      google_business_profile_url: googleUrl || null,
      default_exclusions: getDefaultExclusions(initialProfile?.default_exclusions),
      default_assumptions: getDefaultCustomerObligations(initialProfile?.default_assumptions),
    });

    setLoading(false);

    if (error) {
      setError(error.message);
    } else {
      onSave?.();
    }
  };

  return (
    <div className="business-profile-form">
      <h1>{initialProfile ? 'Edit Business Profile' : 'Set Up Your Business Profile'}</h1>

      {isNewUser && onSignInClick && (
        <div className="sign-in-prompt">
          <span>Already have an account?</span>
          <button type="button" className="btn-sign-in" onClick={onSignInClick}>
            Sign In
          </button>
        </div>
      )}

      <form onSubmit={handleSubmit}>
        <label>
          Business Name (Your name if Sole Proprietor)
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
          Phone (Optional)
          <input type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} />
        </label>

        <label>
          Email
          <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
        </label>

        <label>
          Address (Optional)
          <textarea value={address} onChange={(e) => setAddress(e.target.value)} />
        </label>

        <label>
          Google Business Profile URL (Optional)
          <input
            type="url"
            value={googleUrl}
            onChange={(e) => setGoogleUrl(e.target.value)}
          />
        </label>

        <button type="submit" className="btn-primary btn-full-width" disabled={loading}>
          {loading ? 'Loading...' : isNewUser ? 'Continue' : 'Save Profile'}
        </button>

        {error && <p className="error">{error}</p>}
      </form>
    </div>
  );
}
