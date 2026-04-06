export const OPERATIONAL_TEAM_VALUES = ['Network', 'Developer', 'Hardware'];

export const AUDIENCE_CODE_LABELS = {
  STAFF: 'Operational Staff',
  TJN: 'CCC Manager',
  GJN: 'Operational Manager',
  BJN: 'Executive',
  DGSN: 'Stakeholder',
};

const TEAM_ALIASES = {
  network: 'Network',
  networks: 'Network',
  developer: 'Developer',
  developers: 'Developer',
  dev: 'Developer',
  hardware: 'Hardware',
};

export function normalizeOperationalTeam(value) {
  const key = String(value || '').trim().toLowerCase();
  return TEAM_ALIASES[key] || null;
}

export function normalizeOperationalTeams(values = []) {
  const normalized = Array.isArray(values)
    ? values.map(normalizeOperationalTeam).filter(Boolean)
    : [];
  return Array.from(new Set(normalized));
}

export function derivePrimaryDepartment(teams = []) {
  const normalized = normalizeOperationalTeams(teams);
  if (normalized.includes('Network')) return 'Networks';
  if (normalized.includes('Developer')) return 'Dev';
  if (normalized.includes('Hardware')) return 'Hardware';
  return null;
}

export function readUserOperationalTeams(user) {
  const direct = normalizeOperationalTeams(user?.operationalTeams || []);
  if (direct.length > 0) return direct;

  const department = String(user?.department || '').trim().toLowerCase();
  if (department === 'networks') return ['Network'];
  if (department === 'dev') return ['Developer'];
  if (department === 'hardware') return ['Hardware'];
  return [];
}

export function getAudienceLabel(code) {
  return AUDIENCE_CODE_LABELS[code] || 'CCC Staff';
}

export function isLeadershipAudience(code) {
  return ['TJN', 'GJN', 'BJN', 'DGSN'].includes(String(code || '').trim().toUpperCase());
}

export function isOperationalStaffAudience(code) {
  return String(code || '').trim().toUpperCase() === 'STAFF';
}

export function getProfileCompletionState(user) {
  const issues = [];
  const teams = readUserOperationalTeams(user);
  const audienceCode = String(user?.audienceCode || '').trim().toUpperCase();
  const telegramPhone = String(user?.telegramNumber || '').trim();
  const telegramChatId = String(user?.telegramChatId || user?.telegramId || '').trim();

  if (!AUDIENCE_CODE_LABELS[audienceCode]) issues.push('audienceCode');

  if (isOperationalStaffAudience(audienceCode)) {
    if (!telegramPhone) issues.push('telegramNumber');
    if (!telegramChatId) issues.push('telegramChatId');
    if (teams.length < 1 || teams.length > 2) issues.push('operationalTeams');
  }

  return {
    isComplete: issues.length === 0,
    issues,
    operationalTeams: teams,
    audienceCode: audienceCode || null,
    audienceLabel: getAudienceLabel(audienceCode),
  };
}

export function findingImpactedTeams(finding = {}) {
  const category = String(finding.category || '').trim().toLowerCase();
  const affectedAssetType = String(finding.affectedAssetType || '').trim().toLowerCase();
  const affectedAssetRef = String(finding.affectedAssetRef || '').trim().toLowerCase();
  const title = String(finding.title || '').trim().toLowerCase();
  const description = String(finding.description || '').trim().toLowerCase();
  const corpus = `${title} ${description} ${affectedAssetRef}`;

  const impacted = new Set();
  if (['network', 'intrusion', 'availability'].includes(category) || affectedAssetType === 'network_device') {
    impacted.add('Network');
  }
  if (['application', 'runtime', 'secrets'].includes(category) || ['application', 'database_asset', 'database'].includes(affectedAssetType)) {
    impacted.add('Developer');
  }
  if (affectedAssetType === 'device' || affectedAssetType === 'endpoint' || affectedAssetType === 'hardware') {
    impacted.add('Hardware');
  }
  if (/database|sql|postgres|mysql|oracle|mongodb|schema|query/.test(corpus)) {
    impacted.add('Developer');
  }
  if (/hardware|device|endpoint|server|firmware|disk|memory|cpu|workstation/.test(corpus)) {
    impacted.add('Hardware');
  }
  if (impacted.size === 0) {
    impacted.add('Developer');
  }
  return Array.from(impacted);
}