import { useState, type FormEvent } from 'react';
import './CaptureModal.css';

interface CaptureModalProps {
  onSubmit: (
    businessName: string,
    email: string,
    password: string,
    saveAsDefaults: boolean
  ) => void | Promise<void>;
  onClose: () => void;
  error: string;
  submitting: boolean;
  submitLabel?: string;
  submittingLabel?: string;
}

export function CaptureModal({
  onSubmit,
  onClose,
  error,
  submitting,
  submitLabel = 'Create Account & Download',
  submittingLabel = 'Creating Account...',
}: CaptureModalProps) {
  const [businessName, setBusinessName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [saveAsDefaults, setSaveAsDefaults] = useState(true);
  const [localError, setLocalError] = useState('');

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setLocalError('');
    if (!businessName.trim()) {
      setLocalError('Business name is required.');
      return;
    }
    if (!email.trim()) {
      setLocalError('Email is required.');
      return;
    }
    if (password.length < 6) {
      setLocalError('Password must be at least 6 characters.');
      return;
    }
    await onSubmit(businessName.trim(), email.trim(), password, saveAsDefaults);
  };

  const displayError = error || localError;

  return (
    <div className="modal-overlay capture-modal-overlay" onClick={onClose}>
      <div className="modal capture-modal" onClick={(e) => e.stopPropagation()}>
        <h3>Create your account to save & download</h3>
        <p className="capture-modal-subtitle">
          Your work order is ready. Set up your account to download it or send it for signature.
        </p>
        <form onSubmit={(e) => void handleSubmit(e)}>
          <div className="form-group">
            <label htmlFor="capture-business-name">Business Name</label>
            <input
              id="capture-business-name"
              type="text"
              autoComplete="organization"
              value={businessName}
              onChange={(e) => setBusinessName(e.target.value)}
              required
              disabled={submitting}
            />
          </div>
          <div className="form-group">
            <label htmlFor="capture-email">Email</label>
            <input
              id="capture-email"
              type="email"
              autoComplete="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              disabled={submitting}
            />
          </div>
          <div className="form-group">
            <label htmlFor="capture-password">Password</label>
            <input
              id="capture-password"
              type="password"
              autoComplete="new-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              minLength={6}
              required
              disabled={submitting}
            />
          </div>
          <p id="capture-save-defaults-help" className="capture-modal-defaults-blurb">
            <span>
              You can optionally save the scope and payment settings from this work order as your
              defaults for new work orders.
            </span>
            <span className="capture-modal-defaults-blurb-followup">
              These can be edited anytime in your profile page.
            </span>
          </p>
          <div className="capture-modal-defaults-row">
            <input
              id="capture-save-defaults"
              type="checkbox"
              checked={saveAsDefaults}
              onChange={(e) => setSaveAsDefaults(e.target.checked)}
              aria-describedby="capture-save-defaults-help"
              disabled={submitting}
            />
            <label htmlFor="capture-save-defaults">Save defaults?</label>
          </div>
          {displayError && <p className="form-error">{displayError}</p>}
          <div className="modal-actions">
            <button type="button" className="btn-secondary" onClick={onClose} disabled={submitting}>
              Cancel
            </button>
            <button type="submit" className="btn-primary" disabled={submitting}>
              {submitting ? submittingLabel : submitLabel}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
