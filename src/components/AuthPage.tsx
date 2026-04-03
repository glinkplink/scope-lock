import { useState } from 'react';
import { signIn } from '../lib/auth';
import './AuthPage.css';

interface AuthPageProps {
  /** Called after successful sign-in (e.g. leave auth view). */
  onSignInSuccess?: () => void;
}

export function AuthPage({ onSignInSuccess }: AuthPageProps) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    const result = await signIn(email, password);

    if (result.error) {
      setError(result.error.message);
      setLoading(false);
    } else {
      setLoading(false);
      onSignInSuccess?.();
    }
  };

  return (
    <div className="auth-page">
      <section className="auth-page-card" aria-labelledby="auth-page-heading">
        <p className="auth-page-eyebrow">IronWork</p>
        <h1 id="auth-page-heading">Sign In</h1>
        <p className="auth-page-copy">
          Open your saved work orders, invoices, and profile defaults.
        </p>

        {error ? (
          <div className="error-banner auth-page-error" role="alert">
            {error}
          </div>
        ) : null}

        <form className="auth-page-form" onSubmit={handleSubmit}>
          <div className="form-group auth-page-field">
            <label htmlFor="auth-email">Email</label>
            <input
              id="auth-email"
              type="email"
              placeholder="Email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
            />
          </div>
          <div className="form-group auth-page-field">
            <label htmlFor="auth-password">Password</label>
            <input
              id="auth-password"
              type="password"
              placeholder="Password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              minLength={6}
            />
          </div>
          <button
            type="submit"
            className="btn-primary btn-large auth-page-submit"
            disabled={loading}
          >
            {loading ? 'Loading...' : 'Sign In'}
          </button>
        </form>
      </section>
    </div>
  );
}
