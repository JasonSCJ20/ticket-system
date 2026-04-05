# Run security scans for the ticket-system project
# Usage: .\run-security-scans.ps1 (run from project root)

# Check if we're in the right directory
if (-not (Test-Path "backend" -PathType Container) -or -not (Test-Path "node-backend" -PathType Container)) {
    Write-Host "Error: Please run this script from the ticket-system project root directory" -ForegroundColor Red
    Write-Host "Current directory: $(Get-Location)" -ForegroundColor Yellow
    exit 1
}

# Check for required tools
$missingTools = @()
if (-not (Get-Command python -ErrorAction SilentlyContinue)) { $missingTools += "Python" }
if (-not (Get-Command npm -ErrorAction SilentlyContinue)) { $missingTools += "Node.js/npm" }

if ($missingTools.Count -gt 0) {
    Write-Host "Error: Missing required tools: $($missingTools -join ', ')" -ForegroundColor Red
    Write-Host "Please install the missing tools and ensure they are in your PATH" -ForegroundColor Yellow
    exit 1
}

Write-Host "Running security scans..." -ForegroundColor Green

# Run Bandit (Python security scanner)
Write-Host "Running Bandit (Python security scan)..." -ForegroundColor Yellow
try {
    if (Get-Command bandit -ErrorAction SilentlyContinue) {
        & python -m bandit -r backend/app -f json -o security-report-bandit.json
        Write-Host "Bandit scan completed" -ForegroundColor Green
    } else {
        Write-Host "Bandit not installed. Install with: pip install bandit" -ForegroundColor Yellow
    }
} catch {
    Write-Host "Bandit scan failed: $($_.Exception.Message)" -ForegroundColor Red
}

# Run npm audit
Write-Host "Running npm audit..." -ForegroundColor Yellow
try {
    Push-Location node-backend
    & npm audit --audit-level moderate
    Pop-Location
    Write-Host "npm audit completed" -ForegroundColor Green
} catch {
    Write-Host "npm audit failed: $($_.Exception.Message)" -ForegroundColor Red
}

# Check for outdated packages
Write-Host "Checking for outdated packages..." -ForegroundColor Yellow
try {
    Push-Location node-backend
    & npm outdated
    Pop-Location
    Write-Host "Outdated packages check completed" -ForegroundColor Green
} catch {
    Write-Host "No outdated packages or could not fetch" -ForegroundColor Yellow
}

# Run npm audit fix (optional)
Write-Host "Running npm audit fix..." -ForegroundColor Yellow
try {
    Push-Location node-backend
    & npm audit fix
    Pop-Location
    Write-Host "npm audit fix completed" -ForegroundColor Green
} catch {
    Write-Host "npm audit fix failed: $($_.Exception.Message)" -ForegroundColor Red
}

Write-Host "Security scans completed!" -ForegroundColor Green