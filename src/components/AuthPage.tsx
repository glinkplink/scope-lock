import { useState } from 'react';
import { signIn } from '../lib/auth';

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
      <h1>Sign In</h1>
      <form onSubmit={handleSubmit}>
        <input
          type="email"
          placeholder="Email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          required
        />
        <input
          type="password"
          placeholder="Password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          required
          minLength={6}
        />
        <button type="submit" disabled={loading}>
          {loading ? 'Loading...' : 'Sign In'}
        </button>
        {error && <p className="error">{error}</p>}
      </form>
    </div>
  );
}
