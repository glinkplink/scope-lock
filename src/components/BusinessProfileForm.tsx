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
      <div className="page-header business-profile-form-header">
        <p className="business-profile-form-kicker">
          {initialProfile ? 'Business settings' : 'Business setup'}
        </p>
        <h1>{initialProfile ? 'Edit Business Profile' : 'Set Up Your Business Profile'}</h1>
        <p>
          Save the business details IronWork should use on your work orders, invoices, and agreement previews.
        </p>
      </div>

      {isNewUser && onSignInClick && (
        <div className="sign-in-prompt">
          <span>Already have an account?</span>
          <button type="button" className="btn-sign-in" onClick={onSignInClick}>
            Sign In
          </button>
        </div>
      )}

      <form className="business-profile-form-card" onSubmit={handleSubmit}>
        <section className="form-section business-profile-form-section">
          <h2>Business Information</h2>

          <div className="form-group">
            <label htmlFor="business-profile-name">Business Name (Your name if Sole Proprietor)</label>
            <input
              id="business-profile-name"
              type="text"
              value={businessName}
              onChange={(e) => setBusinessName(e.target.value)}
              required
            />
          </div>

          <div className="form-group">
            <label htmlFor="business-profile-owner">Owner Name</label>
            <input
              id="business-profile-owner"
              type="text"
              value={ownerName}
              onChange={(e) => setOwnerName(e.target.value)}
            />
          </div>

          <div className="form-group">
            <label htmlFor="business-profile-phone">Phone (Optional)</label>
            <input
              id="business-profile-phone"
              type="tel"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
            />
          </div>

          <div className="form-group">
            <label htmlFor="business-profile-email">Email</label>
            <input
              id="business-profile-email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
            />
          </div>

          <div className="form-group">
            <label htmlFor="business-profile-address">Address (Optional)</label>
            <textarea
              id="business-profile-address"
              value={address}
              onChange={(e) => setAddress(e.target.value)}
              rows={3}
            />
          </div>

          <div className="form-group">
            <label htmlFor="business-profile-google-url">Google Business Profile URL (Optional)</label>
            <input
              id="business-profile-google-url"
              type="url"
              value={googleUrl}
              onChange={(e) => setGoogleUrl(e.target.value)}
            />
          </div>
        </section>

        {error ? <div className="error-banner business-profile-form-error">{error}</div> : null}

        <div className="business-profile-form-actions">
          <button type="submit" className="btn-primary btn-full-width" disabled={loading}>
            {loading ? 'Loading...' : isNewUser ? 'Continue' : 'Save Profile'}
          </button>
        </div>
      </form>
    </div>
  );
}
