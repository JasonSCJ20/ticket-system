@echo off
setlocal EnableDelayedExpansion
REM Run core services for ticket-system (Node backend + React frontend)
REM Usage: run-all.bat
REM Optional legacy backend: run-all.bat --include-python

set "ROOT=%~dp0"
if "%ROOT:~-1%"=="\" set "ROOT=%ROOT:~0,-1%"
if not exist "%ROOT%\logs" mkdir "%ROOT%\logs" >nul 2>nul

set INCLUDE_PYTHON=0
if /I "%~1"=="--include-python" set INCLUDE_PYTHON=1

echo Killing any stale processes on ports 8001 and 5173...
for /f "tokens=5" %%a in ('netstat -ano 2^>nul ^| findstr ":8001 "') do (
    if not "%%a"=="0" taskkill /PID %%a /F >nul 2>nul
)
for /f "tokens=5" %%a in ('netstat -ano 2^>nul ^| findstr ":5173 "') do (
    if not "%%a"=="0" taskkill /PID %%a /F >nul 2>nul
)
timeout /t 2 /nobreak >nul

echo Checking for required tools...
where node >nul 2>nul
if %errorlevel% neq 0 (
    echo ERROR: Node.js not found. Install from https://nodejs.org
    pause
    exit /b 1
)

where npm >nul 2>nul
if %errorlevel% neq 0 (
    echo ERROR: npm not found. Reinstall Node.js
    pause
    exit /b 1
)

echo Starting Node backend on :8001...
cd /d "%ROOT%\node-backend"
if not exist node_modules npm install
powershell -NoProfile -ExecutionPolicy Bypass -Command "Start-Process -WindowStyle Hidden -FilePath 'npm.cmd' -WorkingDirectory '%ROOT%\node-backend' -ArgumentList 'run','dev' -RedirectStandardOutput '%ROOT%\logs\node-backend.log' -RedirectStandardError '%ROOT%\logs\node-backend.err.log'" >nul 2>nul

echo Starting React frontend on :5173...
cd /d "%ROOT%\frontend"
if not exist node_modules npm install
if not exist .env copy .env.example .env >nul 2>nul
powershell -NoProfile -ExecutionPolicy Bypass -Command "Start-Process -WindowStyle Hidden -FilePath 'npm.cmd' -WorkingDirectory '%ROOT%\frontend' -ArgumentList 'run','dev' -RedirectStandardOutput '%ROOT%\logs\frontend.log' -RedirectStandardError '%ROOT%\logs\frontend.err.log'" >nul 2>nul

if %INCLUDE_PYTHON%==1 (
    where python >nul 2>nul
    if %errorlevel% neq 0 (
        echo Python not found. Skipping optional FastAPI backend.
    ) else (
        echo Starting optional FastAPI backend on :8000...
        cd /d "%ROOT%\backend"
        if not exist venv python -m venv venv
        call venv\Scripts\activate.bat
        pip install -r requirements.txt >nul
        powershell -NoProfile -ExecutionPolicy Bypass -Command "Start-Process -WindowStyle Hidden -FilePath 'python' -WorkingDirectory '%ROOT%\backend' -ArgumentList '-m','uvicorn','app.main:app','--reload','--host','0.0.0.0','--port','8000' -RedirectStandardOutput '%ROOT%\logs\fastapi.log' -RedirectStandardError '%ROOT%\logs\fastapi.err.log'" >nul 2>nul
    )
)

echo Waiting for services to become ready (up to 30 seconds)...
set BACKEND_OK=0
set FRONTEND_OK=0
for /l %%i in (1,1,15) do (
    timeout /t 2 /nobreak >nul
    if !BACKEND_OK!==0 (
        curl -s http://localhost:8001/api/tickets >nul 2>nul
        if not errorlevel 1 set BACKEND_OK=1
    )
    if !FRONTEND_OK!==0 (
        curl -s http://localhost:5173 >nul 2>nul
        if not errorlevel 1 set FRONTEND_OK=1
    )
    if !BACKEND_OK!==1 if !FRONTEND_OK!==1 goto :ready
)

:ready
if !BACKEND_OK!==1 (
    echo Node API endpoint reachable.
) else (
    echo WARNING: Node API not reachable. Check the "Node Backend" window for errors.
)
if !FRONTEND_OK!==1 (
    echo Frontend endpoint reachable.
) else (
    echo WARNING: Frontend not reachable. Check the "React Frontend" window for errors.
)

echo.
echo Frontend: http://localhost:5173
echo Node API: http://localhost:8001
if %INCLUDE_PYTHON%==1 echo FastAPI: http://localhost:8000
echo Logs: %ROOT%\logs
echo.
echo Startup check complete. Closing launcher window...
exit /b 0