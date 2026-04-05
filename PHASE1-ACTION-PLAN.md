# Phase 1: CRITICAL CLEANUP - ACTION PLAN
**For**: Cybersecurity Command Centre
**Date**: April 5, 2026
**Status**: Ready for Implementation

---

## Overview

Phase 1 focuses on the 4 critical cleanup items that block next release and cause maintainability issues. This plan is **implementation-ready** with specific file locations, line numbers, and refactoring approaches.

---

## ITEM 1: Refactor Frontend App.jsx (Large Component Problem)

### Current State
- **File**: `frontend/src/App.jsx`
- **Size**: 3,128 lines (TOO LARGE)
- **Issues**: 100+ useState hooks, mixed responsibilities
- **Impact**: Unmaintainable, hard to test, performance at risk

### Solution: Extract Components

#### Step 1.1: Create TicketForm Component
**File**: `frontend/src/components/Forms/TicketForm.jsx`

Extract lines 118-124 + related handlers from App.jsx:
```javascript
// States to extract:
[title, setTitle], [description, setDescription], [priority, setPriority],
[assigneeId, setAssigneeId], [businessImpactScore, setBusinessImpactScore],
[impactedServices, setImpactedServices], [executiveSummary, setExecutiveSummary]

// Handlers to extract:
onCreateTicket()

// Props to receive:
{users, error, setError, onSuccess}

// Returns:
function TicketForm({users, error, setError, onSuccess}) { ... }
```

**Time**: 2 hours
**Tests**: Create TicketForm.test.jsx

#### Step 1.2: Create DeviceRegistrationForm Component
**File**: `frontend/src/components/Forms/DeviceRegistrationForm.jsx`

Extract lines 139-145 (deviceName, deviceType, deviceIp, deviceLocation, deviceVendor, deviceModel, deviceFirmware):
```javascript
function DeviceRegistrationForm({error, setError, onSuccess}) { ... }
```

**Time**: 1.5 hours

#### Step 1.3: Create DatabaseRegistrationForm Component
**File**: `frontend/src/components/Forms/DatabaseRegistrationForm.jsx`

Extract lines 147-156 (dbName, dbEngine, dbEnvironment, dbHost, dbPort, dbOwner, dbCriticality, dbPatchLevel, dbEncryptionAtRest, dbTlsInTransit):
```javascript
function DatabaseRegistrationForm({error, setError, onSuccess}) { ... }
```

**Time**: 1.5 hours

#### Step 1.4: Create ApplicationRegistrationForm Component
**File**: `frontend/src/components/Forms/ApplicationRegistrationForm.jsx`

Extract lines 134-137 (appName, appBaseUrl, appEnvironment, appOwnerEmail):
```javascript
function ApplicationRegistrationForm({error, setError, onSuccess}) { ... }
```

**Time**: 1 hour

#### Step 1.5: Create PatchManagementForm Component
**File**: `frontend/src/components/Forms/PatchManagementForm.jsx`

Extract lines 157-167 (patchAssetType through patchActionId):
```javascript
function PatchManagementForm({assets, error, setError, onSuccess}) { ... }
```

**Time**: 2 hours

#### Step 1.6: Create SettingsPanel Component
**File**: `frontend/src/components/Panels/SettingsPanel.jsx`

Extract lines that handle settings:
- settingsPanelOpen, setSettingsPanelOpen
- userTheme, setUserTheme
- userNotifications, setUserNotifications
- showPasswordChange, setShowPasswordChange
- newPassword, confirmPassword

**Time**: 2 hours

#### Step 1.7: Create AuditPanel Component
**File**: `frontend/src/components/Panels/AuditPanel.jsx`

Extract audit-related state and handlers:
- auditPanelOpen, setAuditPanelOpen
- auditLogFilter, setAuditLogFilter
- auditLogSearchTerm, setAuditLogSearchTerm
- filteredAuditLogs useMemo
- All audit log handlers

**Time**: 2 hours

#### Step 1.8: Create SituationTile Component
**File**: `frontend/src/components/Tiles/SituationTile.jsx`

Extract floating tile logic:
- situationExpanded, situationPosition, isDraggingSituation
- snapSituationToCorner, criticalPulse
- All drag handlers, position persistence, snap logic
- moveSituationToCorner function

**Time**: 2.5 hours

#### Step 1.9: Extract Custom Hooks
**File**: `frontend/src/hooks/`

1. **useForm.js** - Consolidate form state patterns
   ```javascript
   const [values, errors, isDirty, setValues, setError, resetForm] = useForm({
     name: '', email: '', password: ''
   })
   ```

2. **useAsync.js** - Handle async operations
   ```javascript
   const [data, isLoading, error, execute] = useAsync(asyncFn)
   ```

3. **useLocalStorage.js** - Persist state in localStorage
   ```javascript
   const [value, setValue] = useLocalStorage(key, defaultValue)
   ```

4. **useBusyAction.js** - Track action busy states
   ```javascript
   const [isLoading, execute] = useBusyAction()
   ```

**Time**: 3 hours

**Result**: App.jsx reduced from 3,128 lines → **~600 lines**

---

## ITEM 2: Document Frontend API Client

### Current State
- **File**: `frontend/src/api.js`
- **Size**: 444 lines
- **Issues**: No JSDoc comments, inconsistent error handling, no timeout logic

### Solution

#### Step 2.1: Add JSDoc to All Functions
**Files**: Modify `frontend/src/api.js` + Create `frontend/src/API-DOCUMENTATION.md`

For each exported function, add JSDoc:
```javascript
/**
 * Fetch all tickets assigned to current user
 * @async
 * @returns {Promise<Ticket[]|null>} Array of tickets or null if unauthorized
 * @throws {Error} If request fails (non-401)
 * @example
 * const tickets = await fetchTickets();
 * if (tickets === null) handleLogout(); // 401 unauthorized
 */
export async function fetchTickets() { ... }
```

Add to all 50+ functions in api.js

**Time**: 4 hours

#### Step 2.2: Add Error Handling Helper
Add to top of api.js:
```javascript
/**
 * Execute fetch with timeout
 * @param {string} url - URL to fetch
 * @param {object} options - Fetch options
 * @param {number} timeoutMs - Timeout in milliseconds (default: 30000)
 * @returns {Promise<Response>}
 */
async function fetchWithTimeout(url, options = {}, timeoutMs = 30000) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timeoutId);
  }
}
```

**Time**: 1 hour

#### Step 2.3: Standardize Error Handling
Create helper for consistent errors:
```javascript
/**
 * Standard API error response
 * @typedef {object} ApiError
 * @property {number} code - HTTP status or error code
 * @property {string} message - Human-readable message
 * @property {*} details - Additional error context
 */

export class ApiError extends Error {
  constructor(code, message, details = null) {
    super(message);
    this.code = code;
    this.details = details;
  }
}
```

**Time**: 1 hour

**Total Time for Item 2**: 6 hours
**Result**: Fully documented, production-ready API client

---

## ITEM 3: Organize Frontend CSS

### Current State
- **File**: `frontend/src/App.css`
- **Size**: 1,974 lines
- **Issues**: No sectioning comments, color naming vague, breakpoints scattered, dark theme scattered

### Solution: Restructure CSS

#### Step 3.1: Extract CSS into Modular Files
Create `frontend/src/styles/` directory:

1. **variables.css** (200 lines)
   ```css
   :root {
     /* Colors - Semantic naming */
     --color-primary: #004687;
     --color-primary-dark: #003050;
     --color-background: #f5f5f5;
     --color-surface: #ffffff;
     --color-surface-variant: #e8e8e8;
     
     /* Status colors */
     --color-status-critical: #d32f2f;
     --color-status-warning: #fbc02d;
     --color-status-info: #1976d2;
     --color-status-success: #388e3c;
     
     /* Responsive breakpoints */
     --breakpoint-sm: 500px;
     --breakpoint-md: 700px;
     --breakpoint-lg: 1100px;
     --breakpoint-xl: 1400px;
   }
   ```

2. **base.css** (150 lines)
   - Reset styles
   - Typography
   - Body defaults

3. **layout.css** (300 lines)
   - Grid systems
   - Flexbox utilities
   - Containers

4. **components.css** (800 lines)
   - Tab styles
   - Panel styles
   - Form styles
   - Table styles
   - Button styles

5. **animations.css** (100 lines)
   - All @keyframes
   - Transitions
   - Hover effects

6. **dark-theme.css** (300 lines)
   - All dark-theme overrides (consolidated)

7. **responsive.css** (200 lines)
   - All media queries together
   - Mobile-first overrides

8. **legacy-compat.css** (100 lines if needed)
   - Old styles to deprecate

**Import order in App.css**:
```css
@import 'styles/variables.css';
@import 'styles/base.css';
@import 'styles/layout.css';
@import 'styles/components.css';
@import 'styles/animations.css';
@import 'styles/responsive.css';
@import 'styles/dark-theme.css';
```

#### Step 3.2: Rename Color Variables
Search and replace throughout App.css:
```javascript
--bg-1 → --color-background
--bg-2 → --color-surface
--panel → --color-surface-variant
--ink → --color-text-primary
--muted → --color-text-secondary
--danger → --color-status-critical
--accent → --color-primary
```

**Time**: 2 hours

#### Step 3.3: Consolidate Media Queries
Move all `@media` to single responsive.css file and reference breakpoint variables.

**Time**: 1 hour

**Total Time for Item 3**: 6 hours
**Result**: Organized, maintainable CSS with clear structure

---

## ITEM 4: Consolidate Backend Routes

### Current State
- **File**: `node-backend/src/app.js` (1,600+ lines)
- **Issues**: Route handlers mixed with business logic, scattered throughout file

### Solution: Centralize Route Registration

The routes already exist in `/routes/` directory:
- `users.js`
- `tickets.js`
- `security.js`
- `securityConnectors.js`
- `assistant.js`

But some routes are defined inline in `app.js` (auth, reports, webhooks).

#### Step 4.1: Move Auth Routes
**Create**: `node-backend/src/routes/auth.js`

Move these endpoints from app.js:
- POST /api/auth/register (line 562)
- POST /api/auth/forgot-username (line 599)
- POST /api/auth/forgot-password/request (line 615)
- POST /api/auth/forgot-password/reset (line 684)
- POST /api/token (line 761)

Create route factory:
```javascript
export default function authRouteFactory(options) {
  const { express, CONFIG, models, validators } = options;
  const router = express.Router();
  
  router.post('/register', validators.registration, async (req, res) => {
    // implementation
  });
  
  return router;
}
```

**Time**: 2 hours

#### Step 4.2: Move Report Routes
**Create**: `node-backend/src/routes/reports.js`

Move these endpoints from app.js:
- GET /api/reports/monthly (line 1065)
- GET /api/reports/executive (line 1072)
- GET /api/reports/technical (line 1080)

Create report route factory and register.

**Time**: 1.5 hours

#### Step 4.3: Move Webhook Routes
**Create**: `node-backend/src/routes/webhooks.js`

Move:
- POST /webhook/telegram (line 857)
- Any future webhook routes

**Time**: 1 hour

#### Step 4.4: Move Automation Routes
**Create**: `node-backend/src/routes/automation.js`

Move:
- GET /api/automation/status (line 1025)
- Future automation control endpoints

**Time**: 1 hour

#### Step 4.5: Create Route Aggregator
**File**: `node-backend/src/routes/index.js`

Centralized registration point:
```javascript
export function registerAllRoutes(app, options) {
  const authRoutes = authRouteFactory(options);
  const userRoutes = usersRouteFactory(options);
  const ticketRoutes = ticketsRouteFactory(options);
  const securityRoutes = securityRouteFactory(options);
  // ... etc
  
  app.use('/api/auth', authRoutes);
  app.use('/api/users', userRoutes);
  app.use('/api/tickets', ticketRoutes);
  app.use('/api/security', securityRoutes);
  // ... etc
}
```

Then in app.js, single line:
```javascript
import { registerAllRoutes } from './routes/index.js';
registerAllRoutes(app, { express, CONFIG, models: db, validators, ... });
```

**Time**: 2 hours

#### Step 4.6: Clean Up app.js
Remove all inline route handlers (reduce from 1,600 → ~400 lines).

**Time**: 1 hour

**Total Time for Item 4**: 8.5 hours
**Result**: Clean, modular, maintainable route structure

---

## Implementation Timeline

| Item | Task | Effort | Start | End |
|------|------|--------|-------|-----|
| 1 | Extract React components | 16 hours | Day 1 | Day 3 |
| 2 | Document API client | 6 hours | Day 3 | Day 4 |
| 3 | Organize CSS | 6 hours | Day 4 | Day 4 |
| 4 | Consolidate routes | 8.5 hours | Day 5 | Day 6 |
| | **TOTAL PHASE 1** | **~36.5 hours** | | |

**Calendar** (assuming 8-hour developer days):
- **Monday-Tuesday**: Component extraction
- **Wednesday**: CSS organization + API docs
- **Thursday-Friday**: Backend route consolidation

---

## Validation Checklist

After each item, verify:

### Item 1 Validation
- [ ] All components render correctly in isolation
- [ ] State flows properly between App and child components
- [ ] No console errors or warnings
- [ ] App.jsx <= 600 lines
- [ ] All 8 new components have proper prop documentation
- [ ] Tests pass for all extracted components

### Item 2 Validation
- [ ] All 50+ functions have JSDoc comments
- [ ] API-DOCUMENTATION.md is comprehensive
- [ ] Timeout logic works (test with slow network)
- [ ] Error messages are consistent
- [ ] No breaking API changes

### Item 3 Validation
- [ ] All color variables use semantic naming
- [ ] Dark theme works correctly
- [ ] Responsive layout works on mobile/tablet/desktop
- [ ] CSS file size hasn't increased
- [ ] No style regressions (visual comparison)

### Item 4 Validation
- [ ] All routes work as before (no functionality change)
- [ ] app.js reduced to ~400 lines
- [ ] routes/index.js correctly aggregates all routes
- [ ] No 404 errors on API endpoints
- [ ] Tests still pass (8/8)

---

## Risk Mitigation

### Risk 1: Breaking Changes During Refactoring
**Mitigation**: 
- Create feature branch `cleanup/phase1`
- Test each component in isolation with unit tests
- Use git bisect if issues arise
- Have rollback plan ready

### Risk 2: State Management Confusion
**Mitigation**:
- Document prop flow in each component  
- Use React DevTools to inspect component tree
- Add console logging during development

### Risk 3: CSS Regression
**Mitigation**:
- Side-by-side comparison during reorganization
- Use CSS minification tool before/after
- Test dark theme thoroughly
- Check responsive breakpoints

### Risk 4: API Changes Break Client
**Mitigation**:
- Don't change API endpoints during refactoring
- Only improve documentation, not implementation
- Verify with backend test suite after changes

---

## Success Criteria

✅ **Phase 1 Complete When**:
1. App.jsx < 600 lines, 8 components extracted
2. All functions have JSDoc documentation
3. CSS organized into 8 semantic files
4. All routes consolidated to /routes directory
5. All existing tests pass (8/8)
6. No console errors or warnings
7. Functionality identical to pre-cleanup state
8. Code is more maintainable for next developer

---

## Next Steps (Phase 2 & Beyond)

After Phase 1:
1. **Add comprehensive test coverage** (Phase 2)
2. **Implement error boundaries** (Phase 2)
3. **Add API documentation** (Phase 2)
4. **Performance optimization** (Phase 3)
5. **TypeScript migration** (Phase 3+)

---

## Questions & Decisions Needed

Before starting, confirm:
- [ ] Branch strategy: feature branch or development branch?
- [ ] Testing framework for React components? (vitest + testing-library already installed ✓)
- [ ] Deployment window: Can we take code offline during refactoring?
- [ ] Code review requirement: Mandatory before merging?

