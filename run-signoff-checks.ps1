# Release sign-off precheck runner
# Usage: .\run-signoff-checks.ps1

$ErrorActionPreference = 'Stop'

$nodePath = "C:\Program Files\nodejs\node.exe"
$npmPath = "C:\Program Files\nodejs\npm.cmd"
$root = Split-Path -Parent $MyInvocation.MyCommand.Path

if (-not (Test-Path $nodePath)) {
    Write-Error "Node.js not found at $nodePath"
    exit 1
}
if (-not (Test-Path $npmPath)) {
    Write-Error "npm not found at $npmPath"
    exit 1
}

function Run-Step {
    param(
        [string]$Title,
        [scriptblock]$Action
    )

    Write-Host ""
    Write-Host "=== $Title ===" -ForegroundColor Cyan
    & $Action
    Write-Host "PASS: $Title" -ForegroundColor Green
}

Run-Step "Node backend dependency check" {
    Push-Location (Join-Path $root "node-backend")
    if (-not (Test-Path "node_modules")) {
        & $npmPath install
    }
    Pop-Location
}

Run-Step "Node backend test suite" {
    Push-Location (Join-Path $root "node-backend")
    & $npmPath test
    Pop-Location
}

Run-Step "Frontend dependency check" {
    Push-Location (Join-Path $root "frontend")
    if (-not (Test-Path "node_modules")) {
        & $npmPath install
    }
    Pop-Location
}

Run-Step "Frontend production build" {
    Push-Location (Join-Path $root "frontend")
    & $npmPath run build
    Pop-Location
}

Run-Step "Node backend vulnerability gate (high+)" {
    Push-Location (Join-Path $root "node-backend")
    & $npmPath audit --audit-level=high
    Pop-Location
}

Write-Host ""
Write-Host "All sign-off prechecks completed successfully." -ForegroundColor Green
