import { Outlet, useLocation } from 'react-router-dom';
import Sidebar from './Sidebar.jsx';
import Topbar from './Topbar.jsx';
import ErrorBoundary from './ErrorBoundary.jsx';

const TITLES = {
  '/': 'Command centre',
  '/tickets': 'Tickets',
  '/findings': 'Security findings',
  '/assets': 'Assets',
  '/soc': 'Live feed',
  '/fortress': 'Fortress posture',
  '/patches': 'Patch tasks',
  '/reports': 'Reports',
  '/team': 'Team',
  '/governance': 'Governance',
  '/settings': 'Settings',
};

function titleFor(pathname) {
  if (TITLES[pathname]) return TITLES[pathname];
  const base = '/' + pathname.split('/')[1];
  return TITLES[base] || 'CommandCentre';
}

export default function AppShell() {
  const location = useLocation();

  return (
    <div style={styles.shell}>
      <Sidebar />
      <div style={styles.main}>
        <Topbar title={titleFor(location.pathname)} />
        <div style={styles.content}>
          {/* Keyed on the path so navigating away from a crashed page
              always mounts a fresh boundary, rather than carrying a
              tripped error state into an unrelated page. */}
          <ErrorBoundary key={location.pathname} fallback={(error, reset) => (
            <PageCrashed error={error} onRetry={reset} />
          )}>
            <Outlet />
          </ErrorBoundary>
        </div>
      </div>
    </div>
  );
}

function PageCrashed({ error, onRetry }) {
  return (
    <div style={styles.crash}>
      <p style={styles.crashTitle}>This page hit a problem and couldn't load.</p>
      <p style={styles.crashBody}>Nothing else was affected — the rest of CommandCentre is still working. You can try again, or move on to another page from the sidebar.</p>
      <button onClick={onRetry} style={styles.crashBtn}>Try again</button>
      {error?.message && <p style={styles.crashDetail}>{error.message}</p>}
    </div>
  );
}

const styles = {
  shell: { display: 'flex', minHeight: '100vh' },
  main: { flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column' },
  content: { padding: 20, flex: 1, overflow: 'auto' },
  crash: { maxWidth: 480, margin: '48px auto', textAlign: 'center', background: 'var(--danger-soft)', border: '1px solid var(--danger)', borderRadius: 10, padding: '24px 28px' },
  crashTitle: { fontSize: 15, fontWeight: 600, color: 'var(--text)', margin: '0 0 6px' },
  crashBody: { fontSize: 13, color: 'var(--text-muted)', margin: '0 0 16px' },
  crashBtn: { padding: '7px 16px', borderRadius: 6, border: '1px solid var(--danger)', background: 'transparent', color: 'var(--danger)', fontSize: 12.5, fontWeight: 600, cursor: 'pointer' },
  crashDetail: { fontSize: 11, color: 'var(--text-faint, var(--text-muted))', marginTop: 14, fontFamily: 'monospace' },
};
