# FurLab Demo Launcher
# Usage:
#   .\START_DEMO.ps1        -- local only (http://127.0.0.1:5600)
#   .\START_DEMO.ps1 -Zrok  -- + zrok public link for remote demo
#   .\START_DEMO.ps1 -Zrok -NoAC  -- skip furlab-access server

param(
  [switch]$Zrok,
  [switch]$NoAC
)

$ErrorActionPreference = "Stop"

$ROOT      = "F:\FURLAB\dev\furlab-access"
$WP_DIR    = "F:\FURLAB\dev\furlab-web-plugin"
$AC_UI_DIR = "$ROOT\ui-lab\line-direction-visualizer-react"
$ZROK_EXE  = (Get-Command zrok -ErrorAction SilentlyContinue).Source
if (-not $ZROK_EXE) { $ZROK_EXE = "C:\Users\$env:USERNAME\AppData\Local\zrok\zrok.exe" }
$TOKEN_AC  = "furlabac"
$TOKEN_WP  = "furlabwp"
$PORT_AC   = 5500
$PORT_WP   = 5600
$PORT_AC_UI = 5173

function Get-LanIPv4() {
  $ips = Get-NetIPAddress -AddressFamily IPv4 -ErrorAction SilentlyContinue |
    Where-Object {
      $_.IPAddress -notlike "127.*" -and
      $_.IPAddress -notlike "169.254.*" -and
      $_.InterfaceAlias -notlike "vEthernet*" -and
      $_.InterfaceAlias -notlike "*WSL*"
    }
  $preferred = $ips | Where-Object { $_.IPAddress -like "192.168.*" } | Select-Object -First 1 -ExpandProperty IPAddress
  if ($preferred) { return $preferred }
  return ($ips | Select-Object -First 1 -ExpandProperty IPAddress)
}

function Get-ListeningProcess([int]$port) {
  $conn = Get-NetTCPConnection -State Listen -LocalPort $port -ErrorAction SilentlyContinue | Select-Object -First 1
  if ($null -ne $conn) {
    return Get-Process -Id $conn.OwningProcess -ErrorAction SilentlyContinue
  }
  return $null
}

function Stop-NodeOnPort([int]$port) {
  $proc = Get-ListeningProcess $port
  if ($null -ne $proc -and $proc.ProcessName -ieq "node") {
    Stop-Process -Id $proc.Id -Force
    Start-Sleep -Milliseconds 500
    Write-Host "  [killed] node on :$port (PID $($proc.Id))"
  }
}

function Wait-Http([string]$url, [int]$timeoutSec = 20) {
  $deadline = (Get-Date).AddSeconds($timeoutSec)
  while ((Get-Date) -lt $deadline) {
    try {
      $r = Invoke-WebRequest -Uri $url -UseBasicParsing -TimeoutSec 3 -ErrorAction Stop
      if ($r.StatusCode -lt 500) { return $true }
    } catch {}
    Start-Sleep -Milliseconds 600
  }
  return $false
}

function Get-CommandLineProcesses([string]$name, [string]$pattern) {
  @(Get-CimInstance Win32_Process -Filter "Name='$name'" -ErrorAction SilentlyContinue |
    Where-Object { $_.ProcessId -ne $PID -and $_.CommandLine -like $pattern })
}

function Ensure-SingleCommandLineProcess([string]$name, [string]$pattern) {
  $procs = @(Get-CommandLineProcesses $name $pattern | Sort-Object ProcessId)
  if ($procs.Count -le 1) { return $procs }
  $keep = $procs[0]
  $procs | Select-Object -Skip 1 | ForEach-Object {
    Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue
    Write-Host "  [dedupe] stopped duplicate $name PID $($_.ProcessId)"
  }
  return @($keep)
}

function Ensure-ApiWatchdog() {
  $pattern = "*start_api_watchdog.ps1*"
  $procs = @(Ensure-SingleCommandLineProcess "powershell.exe" $pattern)
  if ($procs.Count -eq 0) {
    Start-Process powershell -ArgumentList "-NoProfile", "-ExecutionPolicy", "Bypass", "-File", "$ROOT\tools\start_api_watchdog.ps1" -WindowStyle Hidden
    Write-Host "  OK api-watchdog started"
  } else {
    Write-Host "  OK api-watchdog already running (PID $($procs[0].ProcessId))"
  }
}

function Start-ZrokWatchdog([string]$token) {
  $wdScript = "$ROOT\tools\start_zrok_watchdog.ps1"
  Start-Process powershell -ArgumentList "-NoProfile", "-ExecutionPolicy", "Bypass", "-File", $wdScript, "-Token", $token, "-IntervalSec", "10" -WindowStyle Hidden
}

function Ensure-ZrokWatchdog([string]$token) {
  $pattern = "*start_zrok_watchdog.ps1*Token*$token*"
  $procs = @(Ensure-SingleCommandLineProcess "powershell.exe" $pattern)
  if ($procs.Count -eq 0) {
    Start-ZrokWatchdog $token
    Write-Host "  OK zrok-watchdog:$token started"
  } else {
    Write-Host "  OK zrok-watchdog:$token already running (PID $($procs[0].ProcessId))"
  }
}

function Ensure-SingleZrokShare([string]$token) {
  $procs = @(Ensure-SingleCommandLineProcess "zrok.exe" "*share reserved $token*")
  if ($procs.Count -gt 0) {
    Write-Host "  OK zrok:$token already running (PID $($procs[0].ProcessId))"
  }
}

# --- 1. furlab-access (:5500) ---
if (-not $NoAC) {
  Write-Host ""
  Write-Host "[1/3] furlab-access server (port $PORT_AC)..."
  Ensure-ApiWatchdog
  if (Wait-Http "http://127.0.0.1:$PORT_AC/api/health") {
    Write-Host "  OK furlab-access already healthy"
  } else {
    Stop-NodeOnPort $PORT_AC
    Start-Process powershell -ArgumentList "-NoProfile", "-ExecutionPolicy", "Bypass", "-File", "$ROOT\tools\start_ui_lab_server.ps1" -WindowStyle Hidden
    if (Wait-Http "http://127.0.0.1:$PORT_AC/api/health") {
      Write-Host "  OK furlab-access started"
    } else {
      Write-Host "  WARN: furlab-access did not respond in 20s -- continuing without it"
    }
  }
} else {
  Write-Host "[1/3] furlab-access skipped (-NoAC)"
}

# --- 2. furlab-ac React UI (:5173) ---
if (-not $NoAC) {
  Write-Host ""
  Write-Host "[2/4] furlab-ac React UI (port $PORT_AC_UI)..."
  if (Wait-Http "http://127.0.0.1:$PORT_AC_UI/" 20) {
    Write-Host "  OK furlab-ac React UI already healthy"
  } else {
    $proc5173 = Get-ListeningProcess $PORT_AC_UI
    if ($null -ne $proc5173) {
      Stop-Process -Id $proc5173.Id -Force -ErrorAction SilentlyContinue
      Start-Sleep -Milliseconds 500
      Write-Host "  [killed] process on :$PORT_AC_UI (PID $($proc5173.Id))"
    }
    $acUiLog = "$AC_UI_DIR\vite-dev.log"
    Start-Process powershell -ArgumentList "-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", "cd '$AC_UI_DIR'; npm run dev" -WindowStyle Hidden -RedirectStandardOutput $acUiLog -RedirectStandardError "$AC_UI_DIR\vite-dev.err.log"
    if (Wait-Http "http://127.0.0.1:$PORT_AC_UI/" 20) {
      Write-Host "  OK furlab-ac React UI started"
    } else {
      Write-Host "  WARN: furlab-ac React UI did not respond in 20s"
    }
  }
} else {
  Write-Host "[2/4] furlab-ac React UI skipped (-NoAC)"
}

# --- 3. furlab-web-plugin (:5600) ---
Write-Host ""
Write-Host "[3/4] furlab-web-plugin server (port $PORT_WP)..."
if (Wait-Http "http://127.0.0.1:$PORT_WP/api/health") {
  Write-Host "  OK furlab-web-plugin already healthy"
} else {
  Stop-NodeOnPort $PORT_WP
  $wpLogFile = "$WP_DIR\furlab-web-plugin.log"
  Start-Process powershell -ArgumentList "-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", "`$env:HOST='0.0.0.0'; `$env:PORT='$PORT_WP'; cd '$WP_DIR'; node src\server.js" -WindowStyle Hidden -RedirectStandardOutput $wpLogFile -RedirectStandardError "$WP_DIR\furlab-web-plugin.err.log"
  if (Wait-Http "http://127.0.0.1:$PORT_WP/api/health") {
    Write-Host "  OK furlab-web-plugin started"
  } else {
    Write-Host "  ERROR: furlab-web-plugin did not start -- check Node.js and path $WP_DIR"
    exit 1
  }
}

# --- 3. zrok ---
$wpLocalUrl = "http://127.0.0.1:$PORT_WP"
$acLocalUrl  = "http://127.0.0.1:$PORT_AC"
$lanIp = Get-LanIPv4
$wpLanUrl = if ($lanIp) { "http://${lanIp}:$PORT_WP" } else { $null }
$acLanUrl = if ($lanIp) { "http://${lanIp}:$PORT_AC" } else { $null }
$acUiLanUrl = if ($lanIp) { "http://${lanIp}:$PORT_AC_UI/furlab-ac/inventory" } else { $null }
$wpZrokUrl   = $null
$acZrokUrl   = $null

if ($Zrok) {
  Write-Host ""
  Write-Host "[4/4] zrok (public access)..."
  if (-not (Test-Path $ZROK_EXE)) {
    Write-Host "  WARN: zrok not found at $ZROK_EXE -- opening local URL"
  } else {
    if (-not $NoAC) {
      Ensure-SingleZrokShare $TOKEN_AC
      Ensure-ZrokWatchdog $TOKEN_AC
      $acZrokUrl = "https://$TOKEN_AC.share.zrok.io"
    }
    Ensure-SingleZrokShare $TOKEN_WP
    Ensure-ZrokWatchdog $TOKEN_WP
    $wpZrokUrl = "https://$TOKEN_WP.share.zrok.io"

    Write-Host "  waiting for zrok..."
    Start-Sleep -Seconds 6
    Write-Host "  OK zrok"
  }
} else {
  Write-Host "[4/4] zrok skipped (use -Zrok for remote demo)"
}

# --- Result ---
Write-Host ""
Write-Host "======================================================"
Write-Host "  FurLab ready!"
Write-Host ""
if (-not $NoAC) {
  Write-Host "  furlab-access  (local): $acLocalUrl"
  if ($acLanUrl) { Write-Host "  furlab-access  (LAN):   $acLanUrl" }
  if ($acZrokUrl) { Write-Host "  furlab-access  (zrok):  $acZrokUrl" }
  Write-Host "  furlab-ac UI   (local): http://127.0.0.1:$PORT_AC_UI/furlab-ac/inventory"
  if ($acUiLanUrl) { Write-Host "  furlab-ac UI   (LAN):   $acUiLanUrl" }
}
Write-Host "  furlab-web-plugin (local): $wpLocalUrl"
if ($wpLanUrl) { Write-Host "  furlab-web-plugin (LAN):   $wpLanUrl" }
if ($wpZrokUrl)  { Write-Host "  furlab-web-plugin (zrok):  $wpZrokUrl" }
Write-Host "======================================================"
Write-Host ""

$openUrl = if ($wpZrokUrl) { $wpZrokUrl } else { $wpLocalUrl }
Start-Process $openUrl
