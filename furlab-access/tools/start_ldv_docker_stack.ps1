param(
  [switch]$Rebuild
)

$ErrorActionPreference = "Stop"

function Stop-NodeOnPort([int]$Port) {
  $conns = Get-NetTCPConnection -State Listen -LocalPort $Port -ErrorAction SilentlyContinue
  if ($null -eq $conns) { return }
  $procIds = $conns | Select-Object -ExpandProperty OwningProcess -Unique
  foreach ($procId in $procIds) {
    $proc = Get-Process -Id $procId -ErrorAction SilentlyContinue
    if ($null -ne $proc -and $proc.ProcessName -ieq "node") {
      Stop-Process -Id $procId -Force
      Write-Host "[ldv-docker] stopped stale node on $Port (PID $procId)"
    }
  }
}

function Stop-DockerOnPort([int]$Port) {
  $rows = docker ps --format "{{.ID}} {{.Names}} {{.Ports}}"
  if (-not $rows) { return }
  foreach ($row in $rows) {
    if ($row -match "^\s*([a-z0-9]+)\s+(\S+)\s+(.+)$") {
      $id = $Matches[1]
      $name = $Matches[2]
      $ports = $Matches[3]
      if ($ports -match (":$Port->")) {
        docker stop $id | Out-Null
        Write-Host "[ldv-docker] stopped docker container '$name' on $Port"
      }
    }
  }
}

Stop-NodeOnPort -Port 5173
Stop-DockerOnPort -Port 5173

Write-Host "[ldv-docker] starting API (5500)"
Start-Process powershell -ArgumentList "-NoProfile", "-ExecutionPolicy", "Bypass", "-File", "f:\FURLAB\dev\furlab-access\tools\start_ui_lab_server.ps1" -WindowStyle Hidden | Out-Null

Write-Host "[ldv-docker] starting docker frontend (5173 -> nginx:80)"
if ($Rebuild) {
  docker compose -f "f:\FURLAB\dev\furlab-access\docker-compose.yml" up -d --build
} else {
  docker compose -f "f:\FURLAB\dev\furlab-access\docker-compose.yml" up -d
}

Start-Sleep -Seconds 2

try {
  $frontend = Invoke-WebRequest -Uri "http://127.0.0.1:5173" -UseBasicParsing -TimeoutSec 12
  Write-Host "[ldv-docker] frontend 5173: $($frontend.StatusCode)"
} catch {
  Write-Host "[ldv-docker] frontend 5173: FAIL"
}

try {
  $api = Invoke-WebRequest -Uri "http://127.0.0.1:5173/api/health" -UseBasicParsing -TimeoutSec 12
  Write-Host "[ldv-docker] frontend->api proxy: $($api.StatusCode)"
} catch {
  Write-Host "[ldv-docker] frontend->api proxy: FAIL"
}

