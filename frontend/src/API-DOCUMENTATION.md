/**
 * API CLIENT DOCUMENTATION
 * ========================
 * 
 * This file documents the structure and patterns used in api.js
 * It serves as a reference for developers working with API endpoints.
 */

// ============================================================================
// OVERVIEW
// ============================================================================

/*
The api.js file exports ~50 functions that interact with the backend REST API.

All functions follow these patterns:

1. **Authentication**: All functions that require auth use getAuthHeaders()
2. **Authorization**: 401 returned as null (triggers logout in App.jsx)
3. **Error Handling**: Other errors throw exceptions with parseErrorResponse()
4. **Consistency**: All errors use fallback messages for clarity
5. **API_URL**: Base URL is configurable via VITE_API_URL environment variable
   - Default: '/api' (relative path, works on any host)
   - Dev: Can be overridden to specific localhost:port if needed

*/

// ============================================================================
// KEY FUNCTIONS
// ============================================================================

/*

AUTHENTICATION FUNCTIONS:
  - login(username, password)
    → Authenticate user and store JWT token
    → Token stored in localStorage as 'access_token'
    → Used by Bearer header in subsequent requests
    → Throws error if credentials invalid

  - createAccount(payload)
    → Register new user
    → Returns user object and initial token
    → Throws on validation errors or duplicate username/email

  - forgotUsername(email)
    → Recover forgotten username
    → Sends recovery email
    → Returns success message

  - requestPasswordReset(email)
    → Start password reset flow
    → Sends reset code to email
    → Returns success message

  - resetPassword(payload)
    → Complete password reset with provided code
    → Sets new password
    → Returns success message

  - fetchCurrentUser()
    → Get authenticated user's profile
    → Returns null if unauthorized (401)
    → Throws on other errors

TICKET FUNCTIONS:
  - fetchTickets()
    → Get all tickets for current user
    → Returns array of ticket objects
    → Returns null if unauthorized

  - createTicket(payload)
    → Create new incident ticket
    → Payload: {title, description, priority, assigneeId, businessImpactScore, etc}
    → Returns created ticket with ID

  - updateTicket(ticketId, payload)
    → Update existing ticket
    → Partial updates allowed
    → Returns updated ticket

  - fetchTicketHistory(ticketId)
    → Get audit history of ticket changes
    → Returns array of history entries with timestamps
    → Returns null if unauthorized

  - fetchExecutiveTicketMetrics()
    → Get dashboard statistics (open, closed, overdue counts)
    → Returns metrics object with aggregated data
    → Returns null if unauthorized

  - transitionTicketLifecycle(ticketId, payload)
    → Move ticket through defined lifecycle stages
    → Stages: identified → triaged → contained → eradicated → recovered → postmortem → closed
    → Payload: {nextStage: 'triaged', notes?: string, resolutionDetails?: {...}}
    → Returns updated ticket

USER MANAGEMENT:
  - fetchUsers()
    → Get list of all IT staff users
    → Returns array of user objects
    → Requires auth, returns null if 401

  - createUser(payload)
    → Register new IT staff member
    → Payload: {name, surname, email, department, jobTitle, scjId, telegramNumber}
    → Admin-only endpoint (enforced server-side)
    → Returns created user

  - preloadUsers()
    → Force pre-populate user cache
    → Used after bulk user import
    → Returns count of preloaded users

SECURITY - APPLICATIONS:
  - fetchSecurityApplications()
    → Get list of registered applications
    → Returns array with install date, owner, risk score

  - registerSecurityApplication(payload)
    → Register new application for monitoring
    → Payload: {name, baseUrl, environment, ownerEmail}
    → Returns registered application with ID

  - runPassiveSecurityScan()
    → Run background scan without service interruption
    → Queries public records, threat feeds, DNS

  - runActiveSecurityScan()
    → Run active penetration testing scan
    → CAUTION: Can cause service interruption
    → Requires admin approval before execution

SECURITY - NETWORK DEVICES:
  - fetchNetworkDevices()
    → Get list of registered network devices
    → Returns array with state, risk score, type, firmware

  - registerNetworkDevice(payload)
    → Register new network device for monitoring
    → Payload: {name, ip, type, vendor, model, firmware, location}
    → Returns registered device

  - runDevicePassiveScan(deviceId)
    → Run passive reconnaissance on device
    → Queries open ports, services, banners

  - runDeviceIdsIpsCheck(deviceId)
    → Check IDS/IPS logs for suspicious activity
    → Returns recent threat detections

SECURITY - DATABASE ASSETS:
  - fetchDatabaseOverview()
    → Get summary of all database assets
    → Returns array with state, engine, patch level, encryption status

  - registerDatabaseAsset(payload)
    → Register new database for monitoring
    → Payload: {name, engine, host, port, owner, criticality, tlsInTransit, encryptionAtRest}
    → Returns registered database

  - runDatabaseSecurityScan(assetId)
    → Scan database for security misconfigurations
    → Checks: weak credentials, open access, missing patches, unencrypted data
    → Returns findings list

SECURITY - FINDINGS & VULNERABILITIES:
  - fetchSecurityFindings(status?)
    → Get list of detected security findings
    → Optional filter by status (new, acknowledged, resolved, etc)
    → Returns array with severity, type, description, affected assets

  - updateFindingStatus(findingId, payload)
    → Update finding status and add remediation notes
    → Payload: {status: 'resolved', notes: 'Applied patch...'} 
    → Returns updated finding

  - confirmSecurityFinding(findingId)
    → Acknowledge finding and confirm detection accuracy
    → Marks finding as 'acknowledged'
    → Returns confirmed finding

  - createTicketFromFinding(findingId, payload?)
    → Auto-generate ticket from security finding
    → Payload: {priority?: 'high', assigneeId?: 'scj123'}
    → Returns created ticket

SECURITY - HEALTH & THREAT INTEL:
  - fetchSecurityHealthSummary()
    → Get overall security posture score
    → Returns: {criticalCount, highCount, riskScore, lastScanTime}

  - fetchExecutiveImpact()
    → Get executive-focused security metrics
    → Returns: {affectedServices, estimatedDowntime, riskToRevenue}

  - fetchThreatIntelOverview()
    → Get current threat landscape summary
    → Returns: {topThreats, regionThreatLevels, trendingVulnerabilities}

  - fetchNetworkVisibilityOverview()
    → Get network topology and device health overview
    → Returns: {deviceCount, healthyCount, suspiciousTraffic, bandwidthUsage}

PATCH MANAGEMENT:
  - fetchPatchTasks()
    → Get list of patch deployment tasks
    → Returns array with target assets, deadline, status, priority

  - createPatchTask(payload)
    → Create new patch deployment task
    → Payload: {assetType, assetId, title, severity, currentVersion, targetVersion, ownerEmail, dueDate}
    → Returns created patch task

  - updatePatchTaskStatus(taskId, payload)
    → Update patch task status (pending → in_progress → completed)
    → Payload: {status, completedAt?, notes?}
    → Returns updated task

REPORTS & AUDIT:
  - fetchExecutiveReport()
    → Get monthly executive summary report
    → Admin-only endpoint
    → Returns: {period, criticalIssueCount, resolvedIssueCount, recommendations}

  - fetchTechnicalReport()
    → Get detailed technical incident report
    → Returns: {findingsByType, topAffectedAssets, remediationProgress}

  - fetchAuditLogs(category?, searchTerm?)
    → Get audit trail of user actions
    → Admin-only endpoint
    → Returns array of audit entries with timestamp, user, action, details

ASSISTANT & AUTOMATION:
  - generateAssistantTriage(ticketId)
    → AI-powered ticket triage and prioritization
    → Returns: {suggestedPriority, relatedFindings, recommendedResolution}

  - fetchAssistantCommandCentre()
    → Get AI command centre recommendations
    → Returns: {criticalAlerts, suggestedActions, riskAnalysis}

  - analyzeAssistantTicket(ticketId)
    → Get AI analysis of specific ticket
    → Returns: {rootCauseAnalysis, relatedIncidents, mitigationSteps}

  - analyzeAssistantAlert(alertId)
    → Get AI analysis of specific alert
    → Returns: {severity, affectedAssets, immediateActions, longTermMitigation}

*/

// ============================================================================
// ERROR HANDLING PATTERN
// ============================================================================

/*

The API client uses a standardized error handling pattern:

1. Check HTTP status
   if (r.status === 401) return null;        // Trigger logout
   if (!r.ok) await parseErrorResponse(...); // Throw error

2. parseErrorResponse():
   - Attempts to parse response JSON
   - Looks for error.detail (backend validation)
   - Falls back to error.error (generic message)
   - Falls back to error.errors[0].msg (field validation)
   - Falls back to provided fallback message
   - Throws standardized Error object

3. Caller responsibility (App.jsx):
   - Catch thrown errors and display in error banner
   - Handle null returns as unauthorized → trigger logout
   - Trigger data refresh after successful operations

EXAMPLE:
--------
try {
  const ticket = await createTicket({title, description, priority});
  setTickets([...tickets, ticket]); // Add to local state
} catch (err) {
  setError(err.message); // Show error banner
}

*/

// ============================================================================
// AUTHENTICATION FLOW
// ============================================================================

/*

1. User submits login form → login(username, password)
2. Backend validates credentials, returns JWT token
3. Token stored in localStorage as 'access_token'
4. Subsequent requests include header: { Authorization: 'Bearer TOKEN' }
5. Server verifies JWT in every protected endpoint
6. If JWT expired or invalid → 401 response
7. Client returns null on 401 → App.jsx triggers logout
8. User redirected to login screen

Token structure:
- JWT format: header.payload.signature
- Payload decoded (without verification) in App.jsx:
  const payload = JSON.parse(atob(token.split('.')[1]))
  → Contains: {sub: userId, username, role, iat, exp}
- Token validity checked by backend on each request
- Token stored indefinitely in localStorage (optional: implement refresh token)

*/

// ============================================================================
// ENVIRONMENT CONFIGURATION
// ============================================================================

/*

API_URL Configuration:
  
  Default: API_URL = '/api'
    - Uses relative path
    - Fetches from same host/port browser accessed
    - Works on: localhost:5173, LAN IP, production domain
    - Handled by Vite dev server proxy (see vite.config.js)

  Override: Set VITE_API_URL environment variable
    - Frontend .env file: VITE_API_URL=http://localhost:8001/api
    - Useful for debugging with separate backend server
    - Or connecting to remote API during staging

  Example (frontend/.env):
    VITE_API_URL=http://192.168.1.100:8001/api

*/

// ============================================================================
// ADDING NEW API ENDPOINTS
// ============================================================================

/*

When adding a new API endpoint, follow this template:

export async function newFeatureFetch(param1, param2) {
  // 1. Build URL with any parameters
  const url = `${API_URL}/resource/${param1}`;
  
  // 2. Prepare fetch options
  const options = {
    method: 'GET', // or POST, PATCH, DELETE
    headers: { ...getAuthHeaders() }, // Include auth token
  };
  
  // If POST/PATCH, add body:
  if (options.method === 'POST') {
    options.headers['Content-Type'] = 'application/json';
    options.body = JSON.stringify({ ... });
  }
  
  // 3. Make the request
  const r = await fetch(url, options);
  
  // 4. Handle authorization (always check first)
  if (r.status === 401) return null;
  
  // 5. Handle other errors
  if (!r.ok) await parseErrorResponse(r, 'Failed to fetch new feature');
  
  // 6. Return parsed response
  return r.json();
}

Key Points:
  - Always include { ...getAuthHeaders() } in headers (even for GET)
  - Always check 401 first and return null (not throw)
  - Use consistent error message: 'Failed to [action] [resource]'
  - Document the function with JSDoc comment explaining:
    * What the endpoint does
    * What parameters it accepts
    * What it returns
    * When it throws errors
    * Whether it requires admin role

*/

// ============================================================================
// TESTING API FUNCTIONS
// ============================================================================

/*

To test API functions in browser console:

  import { login, fetchTickets } from './api.js';
  
  // Test login
  await login('admin_test', 'password123');
  
  // Test fetch
  const tickets = await fetchTickets();
  console.log(tickets);
  
  // Test error handling
  try {
    await fetchTickets(); // Will throw if unauthorized
  } catch (err) {
    console.error(err.message);
  }

*/
