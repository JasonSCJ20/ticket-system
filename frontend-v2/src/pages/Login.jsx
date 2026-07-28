import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext.jsx';
import Logo from '../components/Logo.jsx';

export default function Login() {
  const { login } = useAuth();
  const navigate = useNavigate();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [mfaCode, setMfaCode] = useState('');
  const [needsMfa, setNeedsMfa] = useState(false);
  const [error, setError] = useState(null);
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async (event) => {
    event.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      const result = await login(username, password, mfaCode);
      if (result.mfaRequired) {
        setNeedsMfa(true);
      } else {
        navigate('/', { replace: true });
      }
    } catch (err) {
      setError(err.message || 'Sign in failed.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div style={styles.wrap}>
      <form style={styles.card} onSubmit={handleSubmit}>
        <div style={styles.brandRow}>
          <Logo size={22} />
          <span style={styles.brandName}>CommandCentre</span>
        </div>
        <p style={styles.subtitle}>Sign in to your workspace</p>

        {error && <div style={styles.error}>{error}</div>}

        {!needsMfa && (
          <>
            <label style={styles.label} htmlFor="username">
              Username or email
            </label>
            <input
              id="username"
              style={styles.input}
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              autoComplete="username"
              required
            />
            <label style={styles.label} htmlFor="password">
              Password
            </label>
            <input
              id="password"
              type="password"
              style={styles.input}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="current-password"
              required
            />
          </>
        )}

        {needsMfa && (
          <>
            <label style={styles.label} htmlFor="mfa">
              Authenticator code
            </label>
            <input
              id="mfa"
              style={{ ...styles.input, letterSpacing: '3px', textAlign: 'center' }}
              value={mfaCode}
              onChange={(e) => setMfaCode(e.target.value)}
              inputMode="numeric"
              maxLength={6}
              autoFocus
              required
            />
          </>
        )}

        <button type="submit" style={styles.submitBtn} disabled={submitting}>
          {submitting ? 'Signing in…' : needsMfa ? 'Verify' : 'Sign in'}
        </button>

        {!needsMfa && (
          <div style={styles.linksRow}>
            <a href="/forgot-username" style={styles.link}>
              Forgot username
            </a>
            <a href="/forgot-password" style={styles.link}>
              Forgot password
            </a>
          </div>
        )}
      </form>
    </div>
  );
}

const styles = {
  wrap: {
    minHeight: '100vh',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    background: 'var(--bg)',
  },
  card: {
    width: 340,
    background: 'var(--surface)',
    border: '1px solid var(--border)',
    borderRadius: 'var(--radius)',
    padding: '32px 28px',
  },
  brandRow: { display: 'flex', alignItems: 'center', gap: 8, marginBottom: 22 },
  brandName: { fontWeight: 600, fontSize: 16 },
  subtitle: { fontSize: 12.5, color: 'var(--text-muted)', margin: '0 0 20px' },
  error: {
    background: 'var(--danger-soft)',
    color: 'var(--danger)',
    fontSize: 12.5,
    padding: '8px 10px',
    borderRadius: 8,
    marginBottom: 14,
  },
  label: { fontSize: 11, color: 'var(--text-muted)', display: 'block', marginBottom: 4 },
  input: {
    width: '100%',
    padding: '9px 11px',
    borderRadius: 8,
    border: '1px solid var(--border)',
    background: 'var(--surface-2)',
    color: 'var(--text)',
    marginBottom: 14,
  },
  submitBtn: {
    width: '100%',
    padding: '10px',
    borderRadius: 8,
    border: '1px solid var(--accent)',
    background: 'var(--accent)',
    color: 'var(--bg)',
    fontWeight: 600,
    cursor: 'pointer',
  },
  linksRow: { display: 'flex', justifyContent: 'space-between', marginTop: 16, fontSize: 11.5 },
  link: { color: 'var(--accent)', textDecoration: 'none' },
};
