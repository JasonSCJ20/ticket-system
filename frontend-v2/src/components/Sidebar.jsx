import { NavLink } from 'react-router-dom';
import Logo from './Logo.jsx';
import NavIcon from './NavIcon.jsx';
import { NAV_ITEMS, NAV_SECTION_MANAGE, isGovernanceUser } from '../nav.js';
import { useAuth } from '../auth/AuthContext.jsx';

// An asset owner gets a deliberately narrow nav — just their own dashboard
// and their own account settings. Every other tab is either internal
// tooling they have no reason to see, or already refuses their role
// server-side (see the analystOrAdmin gates in routes/security.js,
// routes/tickets.js, routes/users.js) — hiding the links here is about
// clarity, not the actual security boundary, which lives in the backend.
const OWNER_NAV_ITEMS = [{ key: 'my-assets', label: 'My assets', path: '/', icon: 'server' }];
const OWNER_MANAGE_ITEMS = [{ key: 'settings', label: 'Settings', path: '/settings', icon: 'settings' }];

export default function Sidebar() {
  const { role, audienceCode } = useAuth();
  const isOwner = role === 'owner';
  const canSeeGovernance = isGovernanceUser({ role, audienceCode });
  const navItems = isOwner ? OWNER_NAV_ITEMS : NAV_ITEMS;
  const manageItems = isOwner ? OWNER_MANAGE_ITEMS : NAV_SECTION_MANAGE.filter((item) => !item.governanceOnly || canSeeGovernance);

  return (
    <nav style={styles.sidebar} aria-label="Primary">
      <div style={styles.logoRow}>
        <Logo size={22} />
        <span style={styles.logoText}>CommandCentre</span>
      </div>
      {navItems.map((item) => (
        <NavLink
          key={item.key}
          to={item.path}
          end={item.path === '/'}
          style={({ isActive }) => ({ ...styles.navItem, ...(isActive ? styles.navItemActive : {}) })}
        >
          <NavIcon name={item.icon} />
          {item.label}
        </NavLink>
      ))}
      {!isOwner && <div style={styles.sectionLabel}>Manage</div>}
      {manageItems.map((item) => (
        <NavLink
          key={item.key}
          to={item.path}
          style={({ isActive }) => ({ ...styles.navItem, ...(isActive ? styles.navItemActive : {}) })}
        >
          <NavIcon name={item.icon} />
          {item.label}
        </NavLink>
      ))}
    </nav>
  );
}

const styles = {
  sidebar: {
    width: 208,
    background: 'var(--surface-2)',
    borderRight: '1px solid var(--border)',
    padding: '18px 12px',
    flexShrink: 0,
    display: 'flex',
    flexDirection: 'column',
  },
  logoRow: {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    padding: '0 6px 18px',
    borderBottom: '1px solid var(--border)',
    marginBottom: 14,
  },
  logoText: { fontWeight: 700, fontSize: 14.5 },
  navItem: {
    display: 'flex',
    alignItems: 'center',
    gap: 10,
    padding: '8px 10px',
    borderRadius: 8,
    color: 'var(--text-muted)',
    fontSize: 12.5,
    marginBottom: 2,
    textDecoration: 'none',
  },
  navItemActive: {
    background: 'var(--accent-soft)',
    color: 'var(--accent)',
    fontWeight: 600,
  },
  sectionLabel: {
    fontSize: 10,
    textTransform: 'uppercase',
    letterSpacing: 0.6,
    color: 'var(--text-muted)',
    padding: '14px 10px 4px',
    opacity: 0.7,
  },
};
