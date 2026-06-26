param(
  [Parameter(Mandatory = $true)]
  [string]$BackupFile,
  [string]$DbPath = ""
)

$ErrorActionPreference = "Stop"

function Resolve-DefaultDbPath {
  $repo = (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path
  $preferred = Get-ChildItem -Path $repo -Recurse -Filter "Furlab 1.accdb" -File -ErrorAction SilentlyContinue | Select-Object -First 1
  if ($preferred) { return $preferred.FullName }
  $fallback = Get-ChildItem -Path $repo -Recurse -Filter "*.accdb" -File -ErrorAction SilentlyContinue | Select-Object -First 1
  if ($fallback) { return $fallback.FullName }
  throw "No .accdb file found under repo: $repo"
}

if (-not (Test-Path $BackupFile)) {
  throw "Backup file not found: $BackupFile"
}

$backupFull = (Resolve-Path $BackupFile).Path
$DbPath = if ($DbPath) { $DbPath } else { Resolve-DefaultDbPath }
$dbDir = Split-Path $DbPath -Parent
if (-not (Test-Path $dbDir)) {
  New-Item -ItemType Directory -Force -Path $dbDir | Out-Null
}
$dbFull = Join-Path $dbDir (Split-Path $DbPath -Leaf)

$serverProc = Get-CimInstance Win32_Process -Filter "Name='node.exe'" | Where-Object {
  $_.CommandLine -like "*tools/ui_lab_server.js*"
}
if ($serverProc) {
  throw "ui_lab_server.js is running. Stop API task before restore."
}

$dbName = Split-Path $dbFull -LeafBase
$lockFile = Join-Path (Split-Path $dbFull -Parent) ($dbName + ".laccdb")
if (Test-Path $lockFile) {
  throw "DB lock file exists: $lockFile. Close all DB users before restore."
}

$preRestore = $null
if (Test-Path $dbFull) {
  $stamp = Get-Date -Format "yyyyMMdd_HHmmss"
  $preRestore = Join-Path (Split-Path $dbFull -Parent) ("{0}.pre_restore_{1}.accdb" -f $dbName, $stamp)
  Copy-Item -Path $dbFull -Destination $preRestore -Force
}

Copy-Item -Path $backupFull -Destination $dbFull -Force

[pscustomobject]@{
  ok = $true
  restoredTo = $dbFull
  sourceBackup = $backupFull
  preRestoreBackup = $preRestore
  timestamp = (Get-Date).ToString("s")
} | ConvertTo-Json -Depth 4
