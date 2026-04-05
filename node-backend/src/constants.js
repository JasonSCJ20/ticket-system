/**
 * Centralized constants for application logic
 * Prevents magic strings scattered throughout codebase
 */

// ============================================================================
// LIFECYCLE STAGES
// ============================================================================
export const TICKET_LIFECYCLE_STAGES = {
  IDENTIFIED: 'identified',
  TRIAGED: 'triaged',
  CONTAINED: 'contained',
  ERADICATED: 'eradicated',
  RECOVERED: 'recovered',
  POSTMORTEM: 'postmortem',
  CLOSED: 'closed',
};

export const TICKET_LIFECYCLE_STAGE_ARRAY = Object.values(TICKET_LIFECYCLE_STAGES);

// ============================================================================
// PRIORITY LEVELS
// ============================================================================
export const PRIORITIES = {
  LOW: 'low',
  MEDIUM: 'medium',
  HIGH: 'high',
  CRITICAL: 'critical',
};

export const PRIORITY_ARRAY = Object.values(PRIORITIES);

// ============================================================================
// ROLES
// ============================================================================
export const ROLES = {
  ANALYST: 'analyst',
  ADMIN: 'admin',
  VIEWER: 'viewer',
};

export const ROLE_ARRAY = Object.values(ROLES);

// ============================================================================
// FINDING STATUSES & TYPES
// ============================================================================
export const FINDING_STATUSES = {
  NEW: 'new',
  ACKNOWLEDGED: 'acknowledged',
  MITIGATING: 'mitigating',
  RESOLVED: 'resolved',
  FALSE_POSITIVE: 'false_positive',
  RISK_ACCEPTED: 'risk_accepted',
};

export const FINDING_TYPES = {
  VULNERABILITY: 'vulnerability',
  MISCONFIGURATION: 'misconfiguration',
  INTRUSION_ATTEMPT: 'intrusion_attempt',
  MALWARE_DETECTED: 'malware_detected',
  DATA_EXFILTRATION: 'data_exfiltration',
  POLICY_VIOLATION: 'policy_violation',
};

export const SEVERITY_LEVELS = {
  CRITICAL: 'critical',
  HIGH: 'high',
  MEDIUM: 'medium',
  LOW: 'low',
  INFO: 'info',
};

// ============================================================================
// ASSET TYPES & STATUSES
// ============================================================================
export const ASSET_TYPES = {
  APPLICATION: 'application',
  NETWORK_DEVICE: 'network_device',
  DATABASE: 'database',
};

export const ASSET_STATUSES = {
  HEALTHY: 'healthy',
  DEGRADED: 'degraded',
  OFFLINE: 'offline',
  UNKNOWN: 'unknown',
};

export const DEVICE_TYPES = {
  FIREWALL: 'firewall',
  ROUTER: 'router',
  SWITCH: 'switch',
  INTRUSION_DETECTION: 'intrusion_detection',
  INTRUSION_PREVENTION: 'intrusion_prevention',
  WAF: 'waf',
  LOAD_BALANCER: 'load_balancer',
  OTHER: 'other',
};

export const DB_ENGINES = {
  POSTGRESQL: 'postgresql',
  MYSQL: 'mysql',
  MARIADB: 'mariadb',
  ORACLE: 'oracle',
  MSSQL: 'mssql',
  MONGODB: 'mongodb',
};

export const DB_ENVIRONMENTS = {
  ON_PREM: 'on_prem',
  CLOUD: 'cloud',
  HYBRID: 'hybrid',
};

export const DB_CRITICALITY = {
  CRITICAL: 'critical',
  HIGH: 'high',
  MEDIUM: 'medium',
  LOW: 'low',
};

// ============================================================================
// PATCH STATUSES
// ============================================================================
export const PATCH_STATUSES = {
  PENDING: 'pending',
  IN_PROGRESS: 'in_progress',
  COMPLETED: 'completed',
  FAILED: 'failed',
  DEFERRED: 'deferred',
};

// ============================================================================
// AUDIT LOG CATEGORIES
// ============================================================================
export const AUDIT_CATEGORIES = {
  USER_ACTIVITY: 'user_activity',
  SECURITY_EVENTS: 'security_events',
  DATA_ACCESS: 'data_access',
  VULNERABILITY_MANAGEMENT: 'vulnerability_management',
  MALICIOUS_ACTIVITY: 'malicious_activity',
  SYSTEM_EVENTS: 'system_events',
};

// ============================================================================
// NOTIFICATION TYPES
// ============================================================================
export const NOTIFICATION_TYPES = {
  TICKET_CREATED: 'ticket_created',
  TICKET_ASSIGNED: 'ticket_assigned',
  TICKET_UPDATED: 'ticket_updated',
  TICKET_RESOLVED: 'ticket_resolved',
  FINDING_DETECTED: 'finding_detected',
  FINDING_CRITICAL: 'finding_critical',
  ASSET_UNHEALTHY: 'asset_unhealthy',
  SCAN_COMPLETE: 'scan_complete',
};

// ============================================================================
// AUTOMATION TASKS
// ============================================================================
export const AUTOMATION_TYPES = {
  DEVICE_PASSIVE_SCAN: 'device_passive_scan',
  DEVICE_IDS_IPS_CHECK: 'device_ids_ips_check',
  DATABASE_SECURITY_REVIEW: 'database_security_review',
  APPLICATION_SCAN: 'application_scan',
};

// ============================================================================
// HTTP STATUS CODES
// ============================================================================
export const HTTP_STATUS = {
  OK: 200,
  CREATED: 201,
  NO_CONTENT: 204,
  BAD_REQUEST: 400,
  UNAUTHORIZED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  CONFLICT: 409,
  INTERNAL_SERVER_ERROR: 500,
  SERVICE_UNAVAILABLE: 503,
};

// ============================================================================
// ERROR MESSAGES
// ============================================================================
export const ERROR_MESSAGES = {
  UNAUTHORIZED: 'Unauthorized access',
  FORBIDDEN: 'Access forbidden',
  INVALID_TOKEN: 'Invalid or expired token',
  NOT_FOUND: 'Resource not found',
  VALIDATION_ERROR: 'Validation error',
  DATABASE_ERROR: 'Database operation failed',
  DUPLICATE_ENTRY: 'Duplicate entry',
  INTERNAL_ERROR: 'Internal server error',
};

// ============================================================================
// VALIDATION CONSTANTS
// ============================================================================
export const VALIDATION = {
  MIN_PASSWORD_LENGTH: 6,
  MIN_USERNAME_LENGTH: 3,
  MAX_USERNAME_LENGTH: 50,
  MIN_DESCRIPTION_LENGTH: 10,
  MAX_DESCRIPTION_LENGTH: 5000,
  EMAIL_REGEX: /^[^\s@]+@[^\s@]+\.[^\s@]+$/,
  SCJ_ID_REGEX: /^\d{8}-\d{5}$/,
};

// ============================================================================
// PAGINATION
// ============================================================================
export const PAGINATION = {
  DEFAULT_PAGE_SIZE: 100,
  MAX_PAGE_SIZE: 1000,
  MIN_PAGE_SIZE: 1,
};

// ============================================================================
// RISK SCORES
// ============================================================================
export const RISK_THRESHOLDS = {
  CRITICAL_THRESHOLD: 80,
  HIGH_THRESHOLD: 60,
  MEDIUM_THRESHOLD: 40,
  LOW_THRESHOLD: 20,
};

// ============================================================================
// TIME CONSTANTS (in milliseconds)
// ============================================================================
export const TIME = {
  ONE_SECOND: 1000,
  ONE_MINUTE: 60 * 1000,
  FIVE_MINUTES: 5 * 60 * 1000,
  FIFTEEN_MINUTES: 15 * 60 * 1000,
  ONE_HOUR: 60 * 60 * 1000,
  ONE_DAY: 24 * 60 * 60 * 1000,
  THIRTY_DAYS: 30 * 24 * 60 * 60 * 1000,
};

// ============================================================================
// API ENDPOINTS
// ============================================================================
export const API_ENDPOINTS = {
  // Auth
  AUTH_LOGIN: '/api/token',
  AUTH_REGISTER: '/api/auth/register',
  AUTH_ME: '/api/me',
  
  // Tickets
  TICKETS: '/api/tickets',
  TICKETS_HISTORY: '/api/tickets/:ticketId/history',
  TICKETS_COMMENTS: '/api/tickets/:ticketId/comments',
  TICKETS_ACTION_ITEMS: '/api/tickets/:ticketId/action-items',
  TICKETS_RESOLUTION: '/api/tickets/:ticketId/resolution-report',
  
  // Users
  USERS: '/api/users',
  USERS_PRELOAD: '/api/users/preload',
  
  // Security
  SECURITY_HEALTH: '/api/security/health-summary',
  SECURITY_APPLICATIONS: '/api/security/applications',
  SECURITY_FINDINGS: '/api/security/findings',
  SECURITY_IMPACT: '/api/security/executive-impact',
  SECURITY_THREAT_INTEL: '/api/security/threat-intel/overview',
  
  // Network
  NETWORK_DEVICES: '/api/security/network/devices',
  NETWORK_VISIBILITY: '/api/security/network-visibility/overview',
  
  // Database
  DATABASE_ASSETS: '/api/security/database-assets',
  
  // Reports
  REPORTS_MONTHLY: '/api/reports/monthly',
  REPORTS_EXECUTIVE: '/api/reports/executive',
  REPORTS_TECHNICAL: '/api/reports/technical',
  
  // Audit
  AUDIT_LOGS: '/api/governance/audit-logs',
};

export default {
  TICKET_LIFECYCLE_STAGES,
  TICKET_LIFECYCLE_STAGE_ARRAY,
  PRIORITIES,
  PRIORITY_ARRAY,
  ROLES,
  ROLE_ARRAY,
  FINDING_STATUSES,
  FINDING_TYPES,
  SEVERITY_LEVELS,
  ASSET_TYPES,
  ASSET_STATUSES,
  DEVICE_TYPES,
  DB_ENGINES,
  DB_ENVIRONMENTS,
  DB_CRITICALITY,
  PATCH_STATUSES,
  AUDIT_CATEGORIES,
  NOTIFICATION_TYPES,
  AUTOMATION_TYPES,
  HTTP_STATUS,
  ERROR_MESSAGES,
  VALIDATION,
  PAGINATION,
  RISK_THRESHOLDS,
  TIME,
  API_ENDPOINTS,
};
