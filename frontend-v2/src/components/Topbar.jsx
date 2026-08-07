import { Link } from 'react-router-dom';
import ThemeToggle from './ThemeToggle.jsx';
import { useAuth } from '../auth/AuthContext.jsx';

function initials(username) {
  if (!username) return '?';
  return username.slice(0, 2).toUpperCase();
}

export default function Topbar({ title }) {
  const { username, logout } = useAuth();

  return (
    <header style={styles.topbar}>
      <div style={styles.title}>{title}</div>
      <div style={styles.right}>
        <ThemeToggle />
        <button onClick={logout} style={styles.signOut}>
          Sign out
        </button>
        {/* Was a plain non-interactive div — looked clickable (round avatar,
            top-right corner) but did nothing, which read as broken. Now
            actually opens Settings, the one place profile/Telegram details
            live. */}
        <Link to="/settings" style={styles.avatar} title={`${username || ''} — Settings`}>
          {initials(username)}
        </Link>
      </div>
    </header>
  );
}

const styles = {
  topbar: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: '12px 20px',
    borderBottom: '1px solid var(--border)',
    background: 'var(--surface)',
  },
  title: { fontSize: 15, fontWeight: 700 },
  right: { display: 'flex', alignItems: 'center', gap: 12, color: 'var(--text-muted)', fontSize: 12 },
  signOut: {
    background: 'transparent',
    border: '1px solid var(--border)',
    color: 'var(--text-muted)',
    borderRadius: 8,
    padding: '5px 10px',
    fontSize: 11.5,
    cursor: 'pointer',
  },
  avatar: {
    width: 26,
    height: 26,
    borderRadius: '50%',
    background: 'var(--accent-soft)',
    color: 'var(--accent)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontSize: 11,
    fontWeight: 700,
    textDecoration: 'none',
    cursor: 'pointer',
  },
};
