$ErrorActionPreference = "Stop"

$port = 5600
$conn = Get-NetTCPConnection -State Listen -LocalPort $port -ErrorAction SilentlyContinue | Select-Object -First 1

if ($null -ne $conn) {
  $ownerPid = $conn.OwningProcess
  $proc = Get-Process -Id $ownerPid -ErrorAction SilentlyContinue

  if ($null -ne $proc -and $proc.ProcessName -ieq "node") {
    Stop-Process -Id $ownerPid -Force
    Write-Host "[furlab-web-plugin] stopped stale node on $port (PID $ownerPid)"
  } else {
    throw "Port $port is busy by non-node process"
  }
}

$env:HOST = "0.0.0.0"
$env:PORT = "$port"
Set-Location "f:\FURLAB\dev\furlab-access"
node ..\furlab-web-plugin\src\server.js
