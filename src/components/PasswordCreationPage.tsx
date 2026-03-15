import { useState } from 'react';

interface PasswordCreationPageProps {
  email: string;
  onCreateAccount: (password: string) => Promise<void>;
  onBack: () => void;
}

export function PasswordCreationPage({
  email,
  onCreateAccount,
  onBack,
}: PasswordCreationPageProps) {
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    if (password.length < 6) {
      setError('Password must be at least 6 characters');
      return;
    }

    if (password !== confirmPassword) {
      setError('Passwords do not match');
      return;
    }

    setLoading(true);
    try {
      await onCreateAccount(password);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create account');
      setLoading(false);
    }
  };

  return (
    <div className="password-creation-page">
      <div className="password-creation-content">
        <h1>Create Your Account</h1>
        <p className="email-display">
          Creating account for: <strong>{email}</strong>
        </p>

        <form onSubmit={handleSubmit}>
          <div className="form-group">
            <label htmlFor="password">Password</label>
            <input
              id="password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Enter password (min 6 characters)"
              required
              minLength={6}
            />
          </div>

          <div className="form-group">
            <label htmlFor="confirm-password">Confirm Password</label>
            <input
              id="confirm-password"
              type="password"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              placeholder="Confirm your password"
              required
              minLength={6}
            />
          </div>

          {error && <p className="error">{error}</p>}

          <div className="form-actions">
            <button type="submit" className="btn-primary" disabled={loading}>
              {loading ? 'Creating Account...' : 'Create Account'}
            </button>
            <button type="button" className="btn-secondary" onClick={onBack} disabled={loading}>
              Back
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
