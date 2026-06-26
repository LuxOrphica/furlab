param(
  [string]$DbPath = "",
  [string]$BackupDir = "F:\FURLAB\dev\furlab-access\backups\access",
  [string]$Label = ""
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

if (-not $DbPath) {
  $DbPath = Resolve-DefaultDbPath
}

if (-not (Test-Path $DbPath)) {
  throw "DB file not found: $DbPath"
}

$dbFull = (Resolve-Path $DbPath).Path
$dbDir = Split-Path $dbFull -Parent
$dbName = [System.IO.Path]::GetFileNameWithoutExtension($dbFull)

$lockFile = Join-Path $dbDir ($dbName + ".laccdb")
if (Test-Path $lockFile) {
  Write-Warning "Lock file exists: $lockFile"
  Write-Warning "Backup may be inconsistent if DB is actively written."
}

New-Item -ItemType Directory -Force -Path $BackupDir | Out-Null

$stamp = Get-Date -Format "yyyyMMdd_HHmmss"
$safeLabel = ($Label -replace "[^A-Za-z0-9._-]", "_")
if ($safeLabel) { $safeLabel = "_" + $safeLabel }
$outFile = Join-Path $BackupDir ("{0}_{1}{2}.accdb" -f $dbName, $stamp, $safeLabel)

Copy-Item -Path $dbFull -Destination $outFile -Force
$hash = (Get-FileHash -Path $outFile -Algorithm SHA256).Hash

[pscustomobject]@{
  ok = $true
  dbPath = $dbFull
  backupFile = $outFile
  sha256 = $hash
  timestamp = (Get-Date).ToString("s")
} | ConvertTo-Json -Depth 4
