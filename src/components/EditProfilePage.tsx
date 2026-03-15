import { useState } from 'react';
import { upsertProfile } from '../lib/db/profile';
import type { BusinessProfile } from '../types/db';

interface EditProfilePageProps {
  profile: BusinessProfile;
  onSave: () => void;
  onCancel: () => void;
}

export function EditProfilePage({ profile, onSave, onCancel }: EditProfilePageProps) {
  const [businessName, setBusinessName] = useState(profile.business_name);
  const [ownerName, setOwnerName] = useState(profile.owner_name ?? '');
  const [phone, setPhone] = useState(profile.phone ?? '');
  const [email, setEmail] = useState(profile.email ?? '');
  const [address, setAddress] = useState(profile.address ?? '');
  const [googleUrl, setGoogleUrl] = useState(profile.google_business_profile_url ?? '');
  const [defaultExclusions, setDefaultExclusions] = useState<string[]>(
    profile.default_exclusions ?? []
  );
  const [defaultAssumptions, setDefaultAssumptions] = useState<string[]>(
    profile.default_assumptions ?? []
  );

  const [error, setError] = useState('');
  const [success, setSuccess] = useState(false);
  const [loading, setLoading] = useState(false);

  const addExclusion = () => {
    setDefaultExclusions([...defaultExclusions, '']);
  };

  const updateExclusion = (index: number, value: string) => {
    const updated = [...defaultExclusions];
    updated[index] = value;
    setDefaultExclusions(updated);
  };

  const removeExclusion = (index: number) => {
    setDefaultExclusions(defaultExclusions.filter((_, i) => i !== index));
  };

  const addAssumption = () => {
    setDefaultAssumptions([...defaultAssumptions, '']);
  };

  const updateAssumption = (index: number, value: string) => {
    const updated = [...defaultAssumptions];
    updated[index] = value;
    setDefaultAssumptions(updated);
  };

  const removeAssumption = (index: number) => {
    setDefaultAssumptions(defaultAssumptions.filter((_, i) => i !== index));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setSuccess(false);
    setLoading(true);

    // Filter out empty strings
    const exclusionsArray = defaultExclusions.filter((s) => s.trim().length > 0);
    const assumptionsArray = defaultAssumptions.filter((s) => s.trim().length > 0);

    const { error } = await upsertProfile({
      user_id: profile.user_id,
      business_name: businessName,
      owner_name: ownerName || null,
      phone: phone || null,
      email: email || null,
      address: address || null,
      google_business_profile_url: googleUrl || null,
      default_exclusions: exclusionsArray,
      default_assumptions: assumptionsArray,
    });

    setLoading(false);

    if (error) {
      setError(error.message);
    } else {
      setSuccess(true);
      onSave();
    }
  };

  return (
    <div className="app">
      <header className="app-header">
        <h1 className="app-title" onClick={onCancel}>
          ScopeLock
        </h1>
        <div className="header-actions">
          <button type="button" className="btn-sign-out" onClick={onCancel}>
            Home
          </button>
        </div>
      </header>

      <main className="app-main">
        <div className="edit-profile-page">
          {success && (
            <div className="success-banner">
              Profile saved successfully!
            </div>
          )}

          <div className="page-header">
            <h1>Edit Profile</h1>
            <p>Update your business details and default agreement language used in your Work Agreements.</p>
          </div>

          <form onSubmit={handleSubmit}>
            <section className="form-section">
              <h2>Business Information</h2>

              <div className="form-group">
                <label htmlFor="businessName">Business Name *</label>
                <input
                  id="businessName"
                  type="text"
                  value={businessName}
                  onChange={(e) => setBusinessName(e.target.value)}
                  required
                />
              </div>

              <div className="form-group">
                <label htmlFor="ownerName">Owner / Welder Name</label>
                <input
                  id="ownerName"
                  type="text"
                  value={ownerName}
                  onChange={(e) => setOwnerName(e.target.value)}
                />
              </div>

              <div className="form-group">
                <label htmlFor="phone">Phone Number</label>
                <input
                  id="phone"
                  type="tel"
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                />
              </div>

              <div className="form-group">
                <label htmlFor="email">Email</label>
                <input
                  id="email"
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                />
              </div>

              <div className="form-group">
                <label htmlFor="address">Business Address</label>
                <textarea
                  id="address"
                  value={address}
                  onChange={(e) => setAddress(e.target.value)}
                  rows={2}
                />
              </div>

              <div className="form-group">
                <label htmlFor="googleUrl">Google Business Profile Link</label>
                <input
                  id="googleUrl"
                  type="url"
                  value={googleUrl}
                  onChange={(e) => setGoogleUrl(e.target.value)}
                  placeholder="https://maps.google.com/..."
                />
              </div>
            </section>

            <section className="form-section">
              <h2>Agreement Defaults</h2>

              <div className="form-group">
                <label>Default Exclusions</label>
                {defaultExclusions.map((exclusion, index) => (
                  <div key={index} className="list-item-row">
                    <input
                      type="text"
                      value={exclusion}
                      onChange={(e) => updateExclusion(index, e.target.value)}
                      placeholder="e.g., Painting or powder coating"
                    />
                    <button
                      type="button"
                      className="btn-remove"
                      onClick={() => removeExclusion(index)}
                    >
                      ×
                    </button>
                  </div>
                ))}
                <button type="button" className="btn-add" onClick={addExclusion}>
                  + Add Exclusion
                </button>
              </div>

              <div className="form-group">
                <label>Default Assumptions</label>
                {defaultAssumptions.map((assumption, index) => (
                  <div key={index} className="list-item-row">
                    <input
                      type="text"
                      value={assumption}
                      onChange={(e) => updateAssumption(index, e.target.value)}
                      placeholder="e.g., Customer will provide clear access to work area"
                    />
                    <button
                      type="button"
                      className="btn-remove"
                      onClick={() => removeAssumption(index)}
                    >
                      ×
                    </button>
                  </div>
                ))}
                <button type="button" className="btn-add" onClick={addAssumption}>
                  + Add Assumption
                </button>
              </div>
            </section>

            {error && <div className="error-banner">{error}</div>}

            <div className="form-actions">
              <button type="submit" className="btn-primary" disabled={loading}>
                {loading ? 'Saving...' : 'Save Changes'}
              </button>
              <button type="button" className="btn-secondary" onClick={onCancel}>
                Home
              </button>
            </div>
          </form>

          {success && (
            <div className="success-banner success-bottom">
              Profile saved successfully!
            </div>
          )}
        </div>
      </main>

      <footer className="app-footer">
        <p>ScopeLock - Protect Your Work</p>
      </footer>
    </div>
  );
}