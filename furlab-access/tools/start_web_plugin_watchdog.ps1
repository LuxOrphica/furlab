param(
  [int]$IntervalSec = 10
)

$serverDir  = "F:\FURLAB\dev\furlab-web-plugin"
$serverScript = Join-Path $serverDir "src\server.js"
$port = 5600
$healthUrl = "http://127.0.0.1:$port/api/projects"

Write-Host "[web-plugin-watchdog] monitoring port $port every ${IntervalSec}s"
Write-Host "[web-plugin-watchdog] Ctrl+C to stop"

function Get-NodeOnPort {
  $conn = Get-NetTCPConnection -State Listen -LocalPort $port -ErrorAction SilentlyContinue | Select-Object -First 1
  if ($null -eq $conn) { return $null }
  return Get-Process -Id $conn.OwningProcess -ErrorAction SilentlyContinue
}

function Start-WebPlugin {
  # Kill any stale node on this port first
  $proc = Get-NodeOnPort
  if ($null -ne $proc) {
    Stop-Process -Id $proc.Id -Force -ErrorAction SilentlyContinue
    Start-Sleep -Seconds 1
  }
  $psi = New-Object System.Diagnostics.ProcessStartInfo
  $psi.FileName = "node"
  $psi.Arguments = $serverScript
  $psi.WorkingDirectory = $serverDir
  $psi.UseShellExecute = $false
  $psi.RedirectStandardOutput = $false
  $psi.RedirectStandardError = $false
  $psi.WindowStyle = [System.Diagnostics.ProcessWindowStyle]::Hidden
  $p = [System.Diagnostics.Process]::Start($psi)
  Write-Host "[web-plugin-watchdog] started PID $($p.Id)"
  return $p
}

# Initial start
$proc = Start-WebPlugin
Start-Sleep -Seconds 3

while ($true) {
  Start-Sleep -Seconds $IntervalSec

  $alive = $false
  try {
    $r = Invoke-WebRequest -Uri $healthUrl -UseBasicParsing -TimeoutSec 5 -ErrorAction Stop
    if ($r.StatusCode -lt 500) { $alive = $true }
  } catch {}

  if (-not $alive) {
    Write-Host "[web-plugin-watchdog] server not responding — restarting..."
    $proc = Start-WebPlugin
    Start-Sleep -Seconds 3
  }
}
