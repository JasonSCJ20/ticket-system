import { useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext.jsx';
import Logo from '../components/Logo.jsx';
import { authStyles as styles } from '../auth/authFormStyles.js';

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
      if (err.status === 429) {
        setError('Too many sign-in attempts. Please wait a few minutes and try again.');
      } else if (err.status === 401) {
        setError(needsMfa ? 'That authenticator code is not correct or has expired.' : 'That username or password is not correct.');
      } else if (!err.status) {
        setError(`Unable to reach CommandCentre. ${err.message || 'Check your connection and try again.'}`);
      } else {
        setError(err.message || 'Sign in failed. Please try again.');
      }
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
            <Link to="/forgot-username" style={styles.link}>
              Forgot username
            </Link>
            <Link to="/forgot-password" style={styles.link}>
              Forgot password
            </Link>
          </div>
        )}
      </form>
    </div>
  );
}
