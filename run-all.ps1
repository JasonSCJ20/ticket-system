# Run all services for ticket-system (Node backend + React frontend)
# Usage: Open PowerShell and run: .\run-all.ps1
# Optional legacy backend: .\run-all.ps1 -IncludePythonBackend

param(
    [switch]$IncludePythonBackend,
    [int]$WaitSeconds = 12
)

$nodePath = "C:\Program Files\nodejs\node.exe"
$npmPath = "C:\Program Files\nodejs\npm.cmd"
$root = Split-Path -Parent $MyInvocation.MyCommand.Path

function Test-Port {
    param([int]$Port)
    try {
        $client = New-Object System.Net.Sockets.TcpClient
        $iar = $client.BeginConnect('127.0.0.1', $Port, $null, $null)
        $ok = $iar.AsyncWaitHandle.WaitOne(1500, $false)
        if ($ok) {
            $client.EndConnect($iar)
            $client.Close()
            return $true
        }
        $client.Close()
        return $false
    } catch {
        return $false
    }
}

function Start-ServiceWindow {
    param(
        [Parameter(Mandatory = $true)][string]$Name,
        [Parameter(Mandatory = $true)][string]$WorkingDirectory,
        [Parameter(Mandatory = $true)][string]$Command,
        [Parameter(Mandatory = $true)][int]$Port
    )

    if (Test-Port -Port $Port) {
        Write-Host "$Name already appears to be running on :$Port. Skipping startup."
        return
    }

    Start-Process -FilePath "powershell.exe" -WorkingDirectory $WorkingDirectory -ArgumentList @(
        '-NoExit',
        '-Command',
        $Command
    ) | Out-Null
}

if (-not (Test-Path $nodePath)) {
    Write-Error "Node.js not found at $nodePath. Please install Node.js from https://nodejs.org"
    exit 1
}

if (-not (Test-Path $npmPath)) {
    Write-Error "npm not found at $npmPath. Please reinstall Node.js"
    exit 1
}

Write-Host "Starting Node backend on :8001..."
Push-Location (Join-Path $root "node-backend")
if (-not (Test-Path "node_modules")) {
    & $npmPath install
}
Start-ServiceWindow -Name "Node backend" -WorkingDirectory "$PWD" -Port 8001 -Command "Set-Location '$PWD'; & '$npmPath' run dev"
Pop-Location

Write-Host "Starting React frontend on :5173..."
Push-Location (Join-Path $root "frontend")
if (-not (Test-Path "node_modules")) {
    & $npmPath install
}
if (-not (Test-Path ".env")) {
    Copy-Item ".env.example" ".env" -ErrorAction SilentlyContinue
}
Start-ServiceWindow -Name "React frontend" -WorkingDirectory "$PWD" -Port 5173 -Command "Set-Location '$PWD'; & '$npmPath' run dev"
Pop-Location

if ($IncludePythonBackend) {
    if (-not (Get-Command python -ErrorAction SilentlyContinue)) {
        Write-Warning "Python not found. Skipping optional FastAPI backend startup."
    } else {
        Write-Host "Starting optional FastAPI backend on :8000..."
        Push-Location (Join-Path $root "backend")
        if (-not (Test-Path "venv")) {
            python -m venv venv
        }
        .\venv\Scripts\Activate.ps1
        pip install -r requirements.txt | Out-Null
        Start-ServiceWindow -Name "FastAPI backend" -WorkingDirectory "$PWD" -Port 8000 -Command "Set-Location '$PWD'; .\venv\Scripts\Activate.ps1; python -m uvicorn app.main:app --reload --host 0.0.0.0 --port 8000"
        Pop-Location
    }
}

Write-Host "Waiting $WaitSeconds seconds, then checking local service ports..."
Start-Sleep -Seconds $WaitSeconds

$nodeOk = Test-Port -Port 8001
$frontendOk = Test-Port -Port 5173
$pythonOk = if ($IncludePythonBackend) { Test-Port -Port 8000 } else { $null }

Write-Host "Node backend (:8001): $nodeOk"
Write-Host "Frontend (:5173): $frontendOk"
if ($IncludePythonBackend) {
    Write-Host "FastAPI backend (:8000): $pythonOk"
}

if ($nodeOk -and $frontendOk) {
    Write-Host "SUCCESS: Core services are running."
    Write-Host "Frontend: http://localhost:5173"
    Write-Host "Node API: http://localhost:8001"
} else {
    Write-Warning "One or more core services did not start correctly."
    Write-Host "Manual run commands:"
    Write-Host "  Node API: cd node-backend; npm install; npm run dev"
    Write-Host "  Frontend: cd frontend; npm install; npm run dev"
}
