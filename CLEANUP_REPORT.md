# Cybersecurity Command Centre - Code Cleanup Report
**Generated**: April 5, 2026

## Executive Summary
The codebase is **functional but requires significant refactoring** before the next major upgrade. The application has accumulated technical debt through rapid feature development. This report outlines specific issues and remediation priorities.

---

## 1. CRITICAL ISSUES (Must Fix Before Next Release)

### 1.1 Frontend: App.jsx - Component Size & Complexity
**File**: [frontend/src/App.jsx](frontend/src/App.jsx)
**Current Size**: 3,128 lines (TOO LARGE)
**Issues**:
- **100+ useState hooks** - Unmanageable state complexity
- **Mixed responsibilities** - Auth, UI, data fetching, forms all in one component
- **Hard to test** - No unit tests for individual features
- **Performance risk** - Re-renders on any state change affecting entire app
- **Maintenance nightmare** - Future developers will struggle to navigate

**Specific Problems**:
```javascript
// Lines 85-196: Authentication state (good)
const [username, setUsername] = useState('')
const [password, setPassword] = useState('')
// ... 12 auth-related states

// Lines 118-124: Ticket creation form state (could be isolated)
const [title, setTitle] = useState('')
const [description, setDescription] = useState('')
// ... 7 ticket states

// Lines 126-156: Device/Database/App registration forms (could be isolated)
const [staffName, setStaffName] = useState('')
const [appName, setAppName] = useState('')
const [deviceName, setDeviceName] = useState('')
const [dbName, setDbName] = useState('')
// ... duplicated form patterns

// Lines 157-167: Patch form state (could be isolated)
const [patchAssetType, setPatchAssetType] = useState('application')
// ... 11 more patch states

// Lines 183-189: Assistant form states (could be isolated)
const [assistantTitle, setAssistantTitle] = useState('')
```

**Recommendation**: 
- Extract UI forms into separate components: `TicketForm`, `DeviceRegistrationForm`, `DatabaseRegistrationForm`, `AppRegistrationForm`, `PatchForm`, `AssistantForm`
- Use Context API or state management library (Redux/Zustand) for shared data
- Implement custom hooks for common patterns (useForm, useAsync, etc.)
- Target: **Reduce App.jsx to < 800 lines**

---

### 1.2 Frontend: CSS - Missing Organization & Documentation
**File**: [frontend/src/App.css](frontend/src/App.css)
**Current Size**: 1,974 lines
**Issues**:
- **No CSS sectioning comments** - Hard to find related styles
- **Color variable naming inconsistent** - --danger, --accent, --panel are vague
- **Dark theme overrides scattered** - Should be consolidated
- **Responsive breakpoints hardcoded** - Should be at top as variables
- **No documented component styles** - Which classes are for which features?
- **Duplicate style blocks** - Multiple font definitions

**Specific Problems**:
```css
/* Color vars exist but are not semantic */
--bg-1: #f5f5f5;
--bg-2: #fff;
--panel: #e8e8e8;
--danger: #d32f2f;

/* Better would be */
--color-background-primary: #f5f5f5;
--color-background-secondary: #fff;
--color-panel-background: #e8e8e8;
--color-status-critical: #d32f2f;
--color-status-warning: #fbc02d;
--color-status-success: #388e3c;

/* Hardcoded breakpoints scattered throughout */
@media (min-width: 1100px) { ... }
@media (max-width: 700px) { ... }
@media (max-width: 500px) { ... }
```

**Recommendation**:
- Add CSS variables for responsive breakpoints at top
- Organize CSS into sections with clear comments (Layout, Typography, Components, Animations, Dark Theme, Responsive)
- Rename color variables to be semantic
- Extract reusable component styles into utility classes

---

### 1.3 Frontend: API Client - Missing Error Handling & Documentation
**File**: [frontend/src/api.js](frontend/src/api.js)
**Current Size**: 444 lines
**Issues**:
- **No JSDoc comments** - Functions lack purpose/parameter documentation
- **Error responses not standardized** - Some throw, some return null  
- **No request timeout handling** - Long-running requests could hang
- **No retry logic** - Failed requests aren't retried
- **No request deduplication** - Duplicate concurrent requests possible
- **Magic strings for URLs** - No validation that endpoints exist
- **No TypeScript** - Type safety missing (optional but recommended)

**Specific Problems**:
```javascript
// No documentation
export const fetchTickets = async () => {
  const response = await fetch(`${API_URL}/tickets`, {
    headers: getAuthHeaders(),
  })
  if (response.status === 401) return null
  if (!response.ok) throw new Error(`Failed to fetch tickets: ${response.status}`)
  return response.json()
}

// Better would be
/**
 * Fetch all tickets assigned to the current user
 * @returns {Promise<Ticket[]|null>} Array of tickets, or null if unauthorized
 * @throws {Error} If request fails (non-401)
 */
export const fetchTickets = async () => {
  // implementation
}

// No timeout on fetch
const response = await fetch(url, { headers: getAuthHeaders() })

// Better
const controller = new AbortController()
const timeoutId = setTimeout(() => controller.abort(), 30000) // 30 sec timeout
try {
  const response = await fetch(url, { 
    headers: getAuthHeaders(),
    signal: controller.signal 
  })
} finally {
  clearTimeout(timeoutId)
}
```

**Recommendation**:
- Add JSDoc comments to all exported functions
- Implement timeout handling (30 seconds default)
- Add request deduplication for concurrent calls
- Create error standardization (all errors follow same structure)
- Add simple retry logic for failed requests (exponential backoff)

---

### 1.4 Backend: app.js - Mixed Responsibilities & Code Duplication
**File**: [node-backend/src/app.js](node-backend/src/app.js)  
**Current Size**: 1,600+ lines
**Issues**:
- **Route handlers mixed with business logic** - No separation of concerns
- **Duplicated notification code** (notify, sendAssignmentGuidance, sendResolutionReport)
- **Duplicated automation patterns** (runDevicePassiveAutomation, runDeviceIdsAutomation, runDatabaseReviewAutomation)
- **No middleware re-use** - Auth checks repeated in some handlers
- **Magic strings for events** (ticket types, finding types, etc.)
- **No input validation helper** - Validation logic varies

**Specific Problems**:
```javascript
// Lines 187-210: notify function
const notify = async (ticket, type) => {
  const assignee = await userModel.findOne({ where: { scjId: ticket.assigneeId } })
  // ... 20+ lines

// Lines 210-230: sendAssignmentGuidance - similar but different
const sendAssignmentGuidance = async (ticket) => {
  const assignee = await userModel.findOne({ where: { scjId: ticket.assigneeId } })
  // ... 18+ lines

// Lines 237-300: sendResolutionReport - similar pattern again
const sendResolutionReport = async ({ ticket, actorName, ...data }) => {
  const assignee = await userModel.findOne({ where: { scjId: ticket.assigneeId } })
  // ... duplicated logic
```

**Recommendation**:
- Extract route handlers to `/routes` directory (already exists - consolidate)
- Create `/services` directory for business logic (getAssignee, sendNotification, etc.)
- Create `/constants` file for magic strings (EVENT_TYPES, FINDING_TYPES, AUTOMATION_INTERVALS, etc.)
- Create `/utils` for common helpers (validateInput, buildMessage, assigneeQuery, etc.)
- Use middleware for auth/validation instead of repeating in handlers

---

### 1.5 Backend: Security - CORS Dynamic but Overly Permissive
**File**: [node-backend/src/app.js](node-backend/src/app.js) - Lines 82-99
**Issue**: Recently fixed CORS to accept any localhost port, but pattern is too loose
```javascript
const allowLocalhost = /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/i.test(origin)
const allowPrivateLan = /^http:\/\/(10\.\d{1,3}\...|192\.168\...|172\....)$/i.test(origin)
// If match, allow ALL origins matching pattern with no filtering
```

**Risk**: 
- Allows local security holes if a developer machine is compromised
- No validation of origin header authenticity
- For production, should whitelist specific URLs only

**Recommendation**:
- Move CORS config to `.env.example` with specific allowed origins
- Add validation that origin matches expected development pattern (only in development mode)
- Add comments about security implications

---

## 2. HIGH PRIORITY ISSUES (Address in Next Sprint)

### 2.1 Missing Error Handling
- Frontend: No global error boundary for React errors
- Frontend: Network timeout errors not handled
- Backend: Unhandled promise rejections in automation tasks
- Backend: Database query errors sometimes not logged

**Action**: Add error boundaries, clarify error hierarchy, add logging

### 2.2 Code Organization  
- Backend `/routes` directory not fully utilized (routes in app.js instead)
- Backend `/services` directory exists but sparse
- Backend `/models` directory incomplete (some models defined inline)
- No `/utils` directory for shared logic

**Action**: Consolidate routes, expand services, create utils

### 2.3 Testing  
- Frontend: Only `App.test.jsx` exists, needs comprehensive test suite
- Backend: Tests in `/tests/api.test.js` but coverage < 50%
- No integration tests for auth flow
- No E2E tests for critical user journeys

**Action**: Add >80% test coverage, create E2E tests

### 2.4 Documentation  
- No API documentation (Swagger/OpenAPI)
- No component documentation (Storybook)
- No architecture documentation beyond diagrams
- README files minimal

**Action**: Add API docs, component docs, runbook

---

## 3. MEDIUM PRIORITY ISSUES (Nice to Have)

### 3.1 Performance
- Frontend: 100+ useState's cause unnecessary re-renders
- Frontend: No memoization of expensive computations
- Frontend: Assets not lazy-loaded
- Backend: No pagination on large dataset endpoints

**Action**: Implement React.memo, useMemo, lazy-load routes, add pagination

### 3.2 Dependencies  
- Frontend: React 18.3.1 is current  ✓
- Frontend: Vite 5.3.0 is current ✓
- Backend: Express 4.18.2 is current ✓
- Backend: Sequelize 6.33.0 is current ✓  
- Some dev dependencies outdated (nodemon 3.0.1, jest 29.5.0)

**Action**: Update dev dependencies, add npm audit fix to CI/CD

### 3.3 Code Style  
- Inconsistent use of `async/await` vs Promise chains
- Inconsistent error handling (throw vs return null)
- Inconsistent naming (camelCase mostly but some snake_case from Sequelize)

**Action**: Add ESLint config, run formatter, document style guide

---

## 4. CLEANUP CHECKLIST (Implementation Plan)

### Phase 1: Critical Cleanup (1-2 weeks)
- [ ] Extract forms from App.jsx into separate components
- [ ] Document api.js with JSDoc
- [ ] Add CSS variables organization
- [ ] Consolidate backend routes from app.js to /routes

### Phase 2: High Priority (2-3 weeks)
- [ ] Add global error handling (frontend & backend)
- [ ] Expand /services directory for business logic
- [ ] Add comprehensive unit tests
- [ ] Add API documentation (Swagger)

### Phase 3: Medium Priority (1-2 weeks)
- [ ] Implement React.memo and useMemo optimizations
- [ ] Update outdated dependencies
- [ ] Add ESLint and Prettier config
- [ ] Add Storybook for components

---

## 5. RECOMMENDED FOLDER STRUCTURE AFTER CLEANUP

```
frontend/
  src/
    components/        # NEW: Extracted UI components
      Forms/
        TicketForm.jsx
        DeviceForm.jsx
        DatabaseForm.jsx
        ApplicationForm.jsx
      Panels/
        SettingsPanel.jsx
        AuditPanel.jsx
      Tiles/
        SituationTile.jsx
        HealthCheckTile.jsx
    hooks/             # NEW: Reusable hooks
      useForm.js
      useAsync.js
      useLocalStorage.js
    context/           # NEW: Shared state if needed
      AppContext.jsx
    styles/            # NEW: Organized CSS
      base.css
      variables.css
      components.css
      dark-theme.css
      responsive.css
    App.jsx            # REFACTORED: < 800 lines
    api.js             # ENHANCED: Better error handling
    main.jsx

node-backend/
  src/
    app.js             # REFACTORED: Only server setup
    config.js
    constants.js       # NEW: Magic strings
    models/            # EXPANDED
    routes/            # CONSOLIDATED: All routes here
      index.js         # Route aggregator
    services/          # EXPANDED: Business logic
      notificationService.js
      automationService.js
      reportService.js
      userService.js
    middleware/        # NEW: Reusable middleware
      auth.js
      validation.js
      errorHandler.js
    utils/             # NEW: Shared helpers
      logger.js
      emailBuilder.js
      validators.js
    tests/
      unit/            # NEW: Organized tests
        services/
        utils/
      integration/     # NEW: Integration tests
      e2e/             # NEW: E2E tests
```

---

## 6. APPROXIMATE EFFORT ESTIMATE

| Phase | Task | Effort | Priority |
|-------|------|--------|----------|
| Phase 1 | Extract React components | 5 days | Critical |
| Phase 1 | Refactor API with docs | 3 days | Critical |
| Phase 1 | Organize CSS | 2 days | Critical |
| Phase 1 | Consolidate backend routes | 3 days | Critical |
| **Phase 1 Total** | | **13 days** | |
| Phase 2 | Add error handling | 4 days | High |
| Phase 2 | Expand services | 5 days | High |
| Phase 2 | Add tests | 6 days | High |
| Phase 2 | API documentation | 3 days | High |
| **Phase 2 Total** | | **18 days** | |
| Phase 3 | Performance optimization | 3 days | Medium |
| Phase 3 | Dependency updates | 2 days | Medium |
| Phase 3 | Linting/formatting | 2 days | Medium |
| **Phase 3 Total** | | **7 days** | |
| **GRAND TOTAL** | | **38 days** | |

---

## 7. NEXT STEPS

1. **Review this report** with team
2. **Prioritize** which cleanup items block next release
3. **Create migration branch** for refactoring (don't break main)
4. **Start with Phase 1 Critical items**
5. **Set up linting/formatting** before Phase 2
6. **Run cleanup on feature branch** before merging to main
7. **Document improvements** in project wiki

---

## 8. POSITIVE NOTES

✅ **Well Done**:
- Database models well-organized
- Auth/JWT flow is clean
- Notification system is robust
- Dashboard UI is polished
- Security practices solid (bcrypt, helmet)
- Good separation of concerns in general structure

✅ **Ready for Next Upgrade**:
- Once Phase 1 cleanup complete, codebase will support:
  - New features without spaghetti code
  - Team collaboration without conflicts
  - Testing without workarounds
  - Performance improvements with isolation
  - Clear documentation for new developers

