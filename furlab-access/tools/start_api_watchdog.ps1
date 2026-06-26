param(
  [int]$IntervalSec = 15,
  [int]$FailThreshold = 2
)

$serverScript = "f:\FURLAB\dev\furlab-access\tools\start_ui_lab_server.ps1"
$healthUrl = "http://127.0.0.1:5500/api/health"
$fails = 0

Write-Host "[api-watchdog] monitoring $healthUrl every ${IntervalSec}s (fail threshold: $FailThreshold)"

function Start-ApiServer {
  Start-Process powershell -ArgumentList "-NoProfile", "-ExecutionPolicy", "Bypass", "-File", $serverScript -WindowStyle Hidden
  Write-Host "[api-watchdog] started API server"
}

while ($true) {
  try {
    $r = Invoke-WebRequest -Uri $healthUrl -UseBasicParsing -TimeoutSec 8
    if ($r.StatusCode -ge 200 -and $r.StatusCode -lt 500) {
      $fails = 0
    } else {
      $fails++
      Write-Host "[api-watchdog] bad status $($r.StatusCode) ($fails/$FailThreshold)"
    }
  } catch {
    $fails++
    Write-Host "[api-watchdog] probe failed ($fails/$FailThreshold): $_"
  }

  if ($fails -ge $FailThreshold) {
    Write-Host "[api-watchdog] fail threshold reached, restarting API..."
    # Kill only the node process listening on port 5500, not all node processes
    $conn = Get-NetTCPConnection -State Listen -LocalPort 5500 -ErrorAction SilentlyContinue | Select-Object -First 1
    if ($null -ne $conn) {
      Stop-Process -Id $conn.OwningProcess -Force -ErrorAction SilentlyContinue
    }
    Start-Sleep -Seconds 2
    Start-ApiServer
    $fails = 0
  }

  Start-Sleep -Seconds $IntervalSec
}
