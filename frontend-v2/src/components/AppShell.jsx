import { Outlet, useLocation } from 'react-router-dom';
import Sidebar from './Sidebar.jsx';
import Topbar from './Topbar.jsx';

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
          <Outlet />
        </div>
      </div>
    </div>
  );
}

const styles = {
  shell: { display: 'flex', minHeight: '100vh' },
  main: { flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column' },
  content: { padding: 20, flex: 1, overflow: 'auto' },
};
