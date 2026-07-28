// Central nav config. `governanceOnly` items only show for admin / TJN / GJN,
// matching the backend's governanceAccessMiddleware rule.
export const NAV_ITEMS = [
  { key: 'dashboard', label: 'Dashboard', path: '/', icon: 'grid' },
  { key: 'tickets', label: 'Tickets', path: '/tickets', icon: 'ticket' },
  { key: 'findings', label: 'Findings', path: '/findings', icon: 'shield' },
  { key: 'assets', label: 'Assets', path: '/assets', icon: 'server' },
  { key: 'soc', label: 'SOC feed', path: '/soc', icon: 'clock' },
  { key: 'fortress', label: 'Fortress', path: '/fortress', icon: 'shield' },
];

export const NAV_SECTION_MANAGE = [
  { key: 'patches', label: 'Patch tasks', path: '/patches', icon: 'list' },
  { key: 'reports', label: 'Reports', path: '/reports', icon: 'file', governanceOnly: false },
  { key: 'team', label: 'Team', path: '/team', icon: 'users', governanceOnly: false },
  { key: 'governance', label: 'Governance', path: '/governance', icon: 'lock', governanceOnly: true },
  { key: 'settings', label: 'Settings', path: '/settings', icon: 'settings' },
];

export function isGovernanceUser({ role, audienceCode }) {
  return role === 'admin' || audienceCode === 'TJN' || audienceCode === 'GJN';
}
