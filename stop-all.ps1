# Stop Node backend and React frontend started by run-all.ps1
# Usage: .\stop-all.ps1

$nodeProcesses = Get-Process -Name node -ErrorAction SilentlyContinue
if ($nodeProcesses) {
    $nodeProcesses | ForEach-Object {
        if ($_.Path -like '*npm*' -or $_.Path -like '*node*') {
            Write-Host "Stopping process: $($_.Id) $($_.Path)"
            Stop-Process -Id $_.Id -Force
        }
    }
} else {
    Write-Host "No Node processes were running."
}

Start-Sleep -Seconds 2

$remaining = Get-Process -Name node -ErrorAction SilentlyContinue
if ($remaining) {
    Write-Warning "⚠️  Node processes still running:" 
    $remaining | Select-Object Id, ProcessName, Path | Format-Table
} else {
    Write-Host "✅ All Node processes stopped successfully."
}

