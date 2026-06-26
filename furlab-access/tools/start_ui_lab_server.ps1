$ErrorActionPreference = "Stop"

$port = 5500
$conn = Get-NetTCPConnection -State Listen -LocalPort $port -ErrorAction SilentlyContinue | Select-Object -First 1

if ($null -ne $conn) {
  $ownerPid = $conn.OwningProcess
  $proc = Get-Process -Id $ownerPid -ErrorAction SilentlyContinue

  if ($null -ne $proc -and $proc.ProcessName -ieq "node") {
    Stop-Process -Id $ownerPid -Force
    Write-Host "[ui-lab] stopped stale node on $port (PID $ownerPid)"
  } else {
    throw "Port $port is busy by non-node process"
  }
}

$env:UI_LAB_PORT = "$port"
$env:UI_LAB_HOST = "0.0.0.0"
Set-Location "f:\FURLAB\dev\furlab-access"
node tools/ui_lab_server.js
