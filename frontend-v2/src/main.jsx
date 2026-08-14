import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './theme/theme.css';
import App from './App.jsx';
import ErrorBoundary from './components/ErrorBoundary.jsx';

// Last-resort catch for anything outside the authenticated shell (login
// page, theme/auth providers) — AppShell has its own, page-scoped boundary
// for everything inside it. Full reload is the only reliable recovery
// here since there's no known-good sibling UI (Sidebar/Topbar) left
// standing to navigate away with.
function FullPageCrashed({ error }) {
  return (
    <div style={{ maxWidth: 440, margin: '15vh auto', textAlign: 'center', fontFamily: 'system-ui, sans-serif' }}>
      <p style={{ fontSize: 16, fontWeight: 600, margin: '0 0 8px' }}>CommandCentre hit a problem and couldn't load.</p>
      <p style={{ fontSize: 13, color: '#8b93a3', margin: '0 0 16px' }}>Reloading the page usually fixes this. If it keeps happening, let your support contact know.</p>
      <button onClick={() => window.location.reload()} style={{ padding: '8px 18px', borderRadius: 6, border: '1px solid #444', background: 'transparent', color: 'inherit', cursor: 'pointer' }}>Reload</button>
      {error?.message && <p style={{ fontSize: 11, color: '#8b93a3', marginTop: 14, fontFamily: 'monospace' }}>{error.message}</p>}
    </div>
  );
}

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <ErrorBoundary fallback={(error) => <FullPageCrashed error={error} />}>
      <App />
    </ErrorBoundary>
  </StrictMode>,
);
