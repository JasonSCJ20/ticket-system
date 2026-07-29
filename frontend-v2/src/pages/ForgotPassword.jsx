import { useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { requestPasswordReset, resetPassword } from '../api/auth.js';
import Logo from '../components/Logo.jsx';
import { authStyles as styles } from '../auth/authFormStyles.js';

export default function ForgotPassword() {
  const navigate = useNavigate();
  const [email, setEmail] = useState('');
  const [resetCode, setResetCode] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [codeSent, setCodeSent] = useState(false);
  const [error, setError] = useState(null);
  const [info, setInfo] = useState(null);
  const [submitting, setSubmitting] = useState(false);

  const describeError = (err, fallback) => {
    if (err.status === 429) return 'Too many attempts. Please wait a few minutes and try again.';
    if (!err.status) return `Unable to reach CommandCentre. ${err.message || 'Check your connection and try again.'}`;
    return err.message || fallback;
  };

  const handleRequestCode = async (event) => {
    event.preventDefault();
    setError(null);
    setInfo(null);
    setSubmitting(true);
    try {
      const data = await requestPasswordReset(email.trim());
      setInfo(data.message || 'If that account exists, a reset code has been sent by email.');
      setCodeSent(true);
    } catch (err) {
      setError(describeError(err, 'Could not request a reset code. Please try again.'));
    } finally {
      setSubmitting(false);
    }
  };

  const handleResetPassword = async (event) => {
    event.preventDefault();
    setError(null);
    setInfo(null);
    setSubmitting(true);
    try {
      await resetPassword(email.trim(), resetCode.trim(), newPassword);
      navigate('/login', { replace: true, state: { passwordReset: true } });
    } catch (err) {
      setError(describeError(err, 'Could not reset your password. Please check the code and try again.'));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div style={styles.wrap}>
      <form style={styles.card} onSubmit={codeSent ? handleResetPassword : handleRequestCode}>
        <div style={styles.brandRow}>
          <Logo size={22} />
          <span style={styles.brandName}>CommandCentre</span>
        </div>
        <p style={styles.subtitle}>{codeSent ? 'Enter your reset code and new password' : 'Reset your password'}</p>

        {error && <div style={styles.error}>{error}</div>}
        {info && !error && <div style={styles.success}>{info}</div>}

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
          disabled={codeSent}
          required
        />

        {codeSent && (
          <>
            <label style={styles.label} htmlFor="resetCode">
              Reset code
            </label>
            <input
              id="resetCode"
              style={{ ...styles.input, letterSpacing: '2px' }}
              value={resetCode}
              onChange={(e) => setResetCode(e.target.value)}
              autoFocus
              required
            />

            <label style={styles.label} htmlFor="newPassword">
              New password
            </label>
            <input
              id="newPassword"
              type="password"
              style={styles.input}
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              autoComplete="new-password"
              minLength={12}
              required
            />
          </>
        )}

        <button type="submit" style={styles.submitBtn} disabled={submitting}>
          {submitting ? 'Please wait…' : codeSent ? 'Reset password' : 'Send reset code'}
        </button>

        <div style={styles.linksRow}>
          <Link to="/login" style={styles.link}>
            Back to sign in
          </Link>
          {codeSent && (
            <button
              type="button"
              onClick={() => setCodeSent(false)}
              style={{ ...styles.link, background: 'none', border: 'none', cursor: 'pointer', padding: 0, fontSize: 11.5 }}
            >
              Use a different email
            </button>
          )}
        </div>
      </form>
    </div>
  );
}
