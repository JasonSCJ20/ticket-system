@echo off
setlocal
REM Release sign-off prechecks (Windows CMD)
REM Usage: run-signoff-checks.bat

where node >nul 2>nul
if %errorlevel% neq 0 (
  echo ERROR: Node.js not found.
  exit /b 1
)
where npm >nul 2>nul
if %errorlevel% neq 0 (
  echo ERROR: npm not found.
  exit /b 1
)

echo [1/3] Running Node backend tests...
cd /d "%~dp0node-backend"
if not exist node_modules npm install
npm test
if %errorlevel% neq 0 exit /b 1

echo [2/3] Building frontend production bundle...
cd /d "%~dp0frontend"
if not exist node_modules npm install
npm run build
if %errorlevel% neq 0 exit /b 1

echo [3/3] Running dependency vulnerability gate (high+)...
cd /d "%~dp0node-backend"
npm audit --audit-level=high
if %errorlevel% neq 0 exit /b 1

echo Sign-off prechecks completed successfully.
exit /b 0
