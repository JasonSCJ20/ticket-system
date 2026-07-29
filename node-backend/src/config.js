// Import dotenv for environment variable loading
import dotenv from 'dotenv';
// Load environment variables from .env file
dotenv.config();

// Obviously-fake placeholders — local/dev convenience only, never a real
// credential. Production must override both via real env vars or the
// process refuses to start (see enforceProductionSecrets below).
const DEFAULT_ADMIN_USERNAME = 'local-dev-admin';
const DEFAULT_ADMIN_PASSWORD = 'change-me-local-dev-only';

// Refuse to start in production with insecure default secrets.
// Set NODE_ENV=production to activate this guard.
function enforceProductionSecrets() {
  if (process.env.NODE_ENV !== 'production') return;
  const fatal = [];
  if (!process.env.SECRET_KEY || process.env.SECRET_KEY === 'PLEASE_CHANGE_ME') {
    fatal.push('SECRET_KEY must be set to a strong random value in production.');
  }
  if (!process.env.ADMIN_PASSWORD || process.env.ADMIN_PASSWORD === DEFAULT_ADMIN_PASSWORD) {
    fatal.push('ADMIN_PASSWORD must be changed from the default in production.');
  }
  if (!process.env.ADMIN_USERNAME || process.env.ADMIN_USERNAME === DEFAULT_ADMIN_USERNAME) {
    fatal.push('ADMIN_USERNAME must be changed from the default in production.');
  }
  if (!process.env.DATABASE_URL || process.env.DATABASE_URL.startsWith('sqlite')) {
    fatal.push('DATABASE_URL must point to a PostgreSQL or MySQL instance in production (not SQLite).');
  }
  if (!process.env.ASSET_CREDENTIAL_ENCRYPTION_KEY || process.env.ASSET_CREDENTIAL_ENCRYPTION_KEY.length < 32) {
    fatal.push('ASSET_CREDENTIAL_ENCRYPTION_KEY must be set to a 32+ byte value in production — without it, storing an edge credential for any asset throws an uncaught error instead of returning a clean response.');
  }
  if (fatal.length > 0) {
    console.error('\n[FATAL] Refusing to start: production configuration is insecure or incomplete:\n');
    fatal.forEach((msg) => console.error(`  • ${msg}`));
    console.error('');
    process.exit(1);
  }
}

enforceProductionSecrets();

// Export configuration object
export const CONFIG = {
  // Database URL with fallback to SQLite
  DATABASE_URL: process.env.DATABASE_URL || 'sqlite://./ticket_system_node.db',
  // Telegram bot token from environment
  TELEGRAM_BOT_TOKEN: process.env.TELEGRAM_BOT_TOKEN || '',
  // Chat ID for monthly reports from environment
  MONTHLY_REPORT_CHAT_ID: process.env.MONTHLY_REPORT_CHAT_ID || '',
  // Server port with default 8001
  PORT: Number(process.env.PORT || 8001),
  // Secret key for JWT signing (change in production)
  SECRET_KEY: process.env.SECRET_KEY || 'PLEASE_CHANGE_ME',
  ACCESS_TOKEN_TTL: process.env.ACCESS_TOKEN_TTL || '15m',
  MFA_ISSUER: process.env.MFA_ISSUER || 'CommandCentre',
  SSO_ENABLED: String(process.env.SSO_ENABLED || 'false').toLowerCase() === 'true',
  SSO_PROVIDER: process.env.SSO_PROVIDER || 'oidc',
  SSO_ISSUER: process.env.SSO_ISSUER || '',
  SSO_CLIENT_ID: process.env.SSO_CLIENT_ID || '',
  SSO_CALLBACK_URL: process.env.SSO_CALLBACK_URL || '',
  TRUST_PROXY: process.env.TRUST_PROXY || 'false',
  API_AUTH_RATE_LIMIT_WINDOW_MS: Number(process.env.API_AUTH_RATE_LIMIT_WINDOW_MS || 60_000),
  API_AUTH_RATE_LIMIT_MAX: Number(process.env.API_AUTH_RATE_LIMIT_MAX || 1200),
  API_PROTECTED_RATE_LIMIT_WINDOW_MS: Number(process.env.API_PROTECTED_RATE_LIMIT_WINDOW_MS || 60_000),
  API_PROTECTED_RATE_LIMIT_MAX: Number(process.env.API_PROTECTED_RATE_LIMIT_MAX || 250000),
  NOTIFICATION_LEDGER_RETENTION_DAYS: Number(process.env.NOTIFICATION_LEDGER_RETENTION_DAYS || 90),
  CORS_ALLOWED_ORIGINS: String(process.env.CORS_ALLOWED_ORIGINS || 'http://localhost:5173,http://localhost:4173,https://ticket-system-frontend-f77.pages.dev'),
  // SMTP settings for email notifications
  SMTP_HOST: process.env.SMTP_HOST || '',
  SMTP_PORT: Number(process.env.SMTP_PORT || 587),
  SMTP_SECURE: String(process.env.SMTP_SECURE || 'false').toLowerCase() === 'true',
  SMTP_USER: process.env.SMTP_USER || '',
  SMTP_PASS: process.env.SMTP_PASS || '',
  NOTIFY_FROM_EMAIL: process.env.NOTIFY_FROM_EMAIL || 'no-reply@cybersecurity-command-center.local',
  ADMIN_USERNAME: process.env.ADMIN_USERNAME || DEFAULT_ADMIN_USERNAME,
  ADMIN_PASSWORD: process.env.ADMIN_PASSWORD || DEFAULT_ADMIN_PASSWORD,
  MANAGER_EMAIL: process.env.MANAGER_EMAIL || '',
  MANAGER_TELEGRAM_NUMBER: process.env.MANAGER_TELEGRAM_NUMBER || '',
  CONNECTOR_SHARED_SECRET: process.env.CONNECTOR_SHARED_SECRET || '',
  WAZUH_API_URL: process.env.WAZUH_API_URL || '',
  WAZUH_API_USERNAME: process.env.WAZUH_API_USERNAME || '',
  WAZUH_API_PASSWORD: process.env.WAZUH_API_PASSWORD || '',
  WAZUH_ALERTS_PATH: process.env.WAZUH_ALERTS_PATH || '/security/alerts?limit=50',
  WAZUH_VERIFY_TLS: String(process.env.WAZUH_VERIFY_TLS || 'true').toLowerCase() === 'true',
  CONNECTOR_ALLOWED_IPS: String(process.env.CONNECTOR_ALLOWED_IPS || ''),
  CONNECTOR_MAX_SKEW_SECONDS: Number(process.env.CONNECTOR_MAX_SKEW_SECONDS || 300),
  CONNECTOR_REPLAY_TTL_SECONDS: Number(process.env.CONNECTOR_REPLAY_TTL_SECONDS || 900),
  CONNECTOR_ENFORCE_SIGNATURE: String(process.env.CONNECTOR_ENFORCE_SIGNATURE || 'true').toLowerCase() === 'true',
  CONNECTOR_REQUIRE_CONTENT_TYPE_JSON: String(process.env.CONNECTOR_REQUIRE_CONTENT_TYPE_JSON || 'true').toLowerCase() === 'true',
  CONNECTOR_MAX_PAYLOAD_BYTES: Number(process.env.CONNECTOR_MAX_PAYLOAD_BYTES || 524288),
  CONNECTOR_WAZUH_RATE_LIMIT_MAX: Number(process.env.CONNECTOR_WAZUH_RATE_LIMIT_MAX || 120),
  CONNECTOR_SURICATA_RATE_LIMIT_MAX: Number(process.env.CONNECTOR_SURICATA_RATE_LIMIT_MAX || 20000),
  CONNECTOR_PROMETHEUS_RATE_LIMIT_MAX: Number(process.env.CONNECTOR_PROMETHEUS_RATE_LIMIT_MAX || 20000),
  AUTOMATION_NETWORK_ENABLED: String(process.env.AUTOMATION_NETWORK_ENABLED || 'true').toLowerCase() === 'true',
  AUTOMATION_DATABASE_ENABLED: String(process.env.AUTOMATION_DATABASE_ENABLED || 'true').toLowerCase() === 'true',
  AUTOMATION_AUTO_CREATE_TICKETS: String(process.env.AUTOMATION_AUTO_CREATE_TICKETS || 'true').toLowerCase() === 'true',
  AUTOMATION_DEVICE_PASSIVE_CRON: process.env.AUTOMATION_DEVICE_PASSIVE_CRON || '*/10 * * * *',
  AUTOMATION_DEVICE_IDS_CRON: process.env.AUTOMATION_DEVICE_IDS_CRON || '*/12 * * * *',
  AUTOMATION_DATABASE_REVIEW_CRON: process.env.AUTOMATION_DATABASE_REVIEW_CRON || '*/20 * * * *',
  AUTOMATION_DEVICE_RISK_ALERT_THRESHOLD: Number(process.env.AUTOMATION_DEVICE_RISK_ALERT_THRESHOLD || 70),
  AUTOMATION_DATABASE_RISK_ALERT_THRESHOLD: Number(process.env.AUTOMATION_DATABASE_RISK_ALERT_THRESHOLD || 75),
  AUTOMATION_DEVICE_PASSIVE_INTERVAL_MINUTES: Number(process.env.AUTOMATION_DEVICE_PASSIVE_INTERVAL_MINUTES || 20),
  AUTOMATION_DEVICE_IDS_INTERVAL_MINUTES: Number(process.env.AUTOMATION_DEVICE_IDS_INTERVAL_MINUTES || 20),
  AUTOMATION_DATABASE_REVIEW_INTERVAL_MINUTES: Number(process.env.AUTOMATION_DATABASE_REVIEW_INTERVAL_MINUTES || 60),
  // Encrypts client-granted edge-enforcement credentials (e.g. a Cloudflare
  // token) at rest. Only required once an asset actually uses the edge model.
  ASSET_CREDENTIAL_ENCRYPTION_KEY: process.env.ASSET_CREDENTIAL_ENCRYPTION_KEY || '',
};
