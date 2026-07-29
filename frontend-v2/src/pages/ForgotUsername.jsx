import { useState } from 'react';
import { Link } from 'react-router-dom';
import { forgotUsername } from '../api/auth.js';
import Logo from '../components/Logo.jsx';
import { authStyles as styles } from '../auth/authFormStyles.js';

export default function ForgotUsername() {
  const [email, setEmail] = useState('');
  const [error, setError] = useState(null);
  const [result, setResult] = useState(null);
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async (event) => {
    event.preventDefault();
    setError(null);
    setResult(null);
    setSubmitting(true);
    try {
      const data = await forgotUsername(email.trim());
      setResult(data);
    } catch (err) {
      if (err.status === 429) {
        setError('Too many attempts. Please wait a few minutes and try again.');
      } else if (!err.status) {
        setError(`Unable to reach CommandCentre. ${err.message || 'Check your connection and try again.'}`);
      } else {
        setError(err.message || 'Something went wrong. Please try again.');
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
        <p style={styles.subtitle}>Recover your username</p>

        {error && <div style={styles.error}>{error}</div>}
        {result && <div style={styles.success}>{result.message}</div>}

        <label style={styles.label} htmlFor="email">
          Account email
        </label>
        <input
          id="email"
          type="email"
          style={styles.input}
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          autoComplete="email"
          required
        />

        <button type="submit" style={styles.submitBtn} disabled={submitting}>
          {submitting ? 'Checking…' : 'Recover username'}
        </button>

        <div style={styles.linksRow}>
          <Link to="/login" style={styles.link}>
            Back to sign in
          </Link>
          <Link to="/forgot-password" style={styles.link}>
            Forgot password
          </Link>
        </div>
      </form>
    </div>
  );
}
