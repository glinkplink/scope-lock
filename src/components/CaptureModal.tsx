import { useState, type FormEvent } from 'react';

interface CaptureModalProps {
  onSubmit: (businessName: string, email: string, password: string) => void | Promise<void>;
  onClose: () => void;
  error: string;
  submitting: boolean;
}

export function CaptureModal({ onSubmit, onClose, error, submitting }: CaptureModalProps) {
  const [businessName, setBusinessName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
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
    await onSubmit(businessName.trim(), email.trim(), password);
  };

  const displayError = error || localError;

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h3>Create your account to save & download</h3>
        <p className="capture-modal-subtitle">
          Your work order is ready. Set up your account to save it and download the PDF.
        </p>
        <form onSubmit={(e) => void handleSubmit(e)}>
          <div className="form-group">
            <label htmlFor="capture-business-name">Business Name</label>
            <input
              id="capture-business-name"
              type="text"
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
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              minLength={6}
              required
              disabled={submitting}
            />
          </div>
          {displayError && <p className="form-error">{displayError}</p>}
          <div className="modal-actions">
            <button type="button" className="btn-secondary" onClick={onClose} disabled={submitting}>
              Cancel
            </button>
            <button type="submit" className="btn-action btn-primary" disabled={submitting}>
              {submitting ? 'Creating Account...' : 'Create Account & Download'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
