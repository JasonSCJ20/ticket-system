@echo off
setlocal
REM Run core services for ticket-system (Node backend + React frontend)
REM Usage: run-all.bat
REM Optional legacy backend: run-all.bat --include-python

set INCLUDE_PYTHON=0
if /I "%~1"=="--include-python" set INCLUDE_PYTHON=1

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
cd /d "%~dp0node-backend"
if not exist node_modules npm install
start "Node Backend" cmd /k "npm run dev"

echo Starting React frontend on :5173...
cd /d "%~dp0frontend"
if not exist node_modules npm install
if not exist .env copy .env.example .env >nul 2>nul
start "React Frontend" cmd /k "npm run dev"

if %INCLUDE_PYTHON%==1 (
    where python >nul 2>nul
    if %errorlevel% neq 0 (
        echo Python not found. Skipping optional FastAPI backend.
    ) else (
        echo Starting optional FastAPI backend on :8000...
        cd /d "%~dp0backend"
        if not exist venv python -m venv venv
        call venv\Scripts\activate.bat
        pip install -r requirements.txt >nul
        start "FastAPI Backend" cmd /k "python -m uvicorn app.main:app --reload --host 0.0.0.0 --port 8000"
    )
)

echo Waiting 12 seconds for services to start...
timeout /t 12 /nobreak >nul

echo Checking core service health...
curl -s http://localhost:8001/api/tickets >nul 2>nul
if %errorlevel% equ 0 (
    echo Node API endpoint reachable.
) else (
    echo Node API endpoint not reachable yet.
)

curl -s http://localhost:5173 >nul 2>nul
if %errorlevel% equ 0 (
    echo Frontend endpoint reachable.
) else (
    echo Frontend endpoint not reachable yet.
)

echo.
echo Frontend: http://localhost:5173
echo Node API: http://localhost:8001
if %INCLUDE_PYTHON%==1 echo FastAPI: http://localhost:8000
echo.
echo Press any key to close...
pause >nul