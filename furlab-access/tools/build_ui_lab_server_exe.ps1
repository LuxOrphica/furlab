$ErrorActionPreference = "Stop"

$root = Resolve-Path (Join-Path $PSScriptRoot "..")
$launcher = Join-Path $root "tools\ui_lab_server_launcher.js"
$outDir = Join-Path $root "dist\exe"
$outExe = Join-Path $outDir "furlab_ui_lab_server.exe"

if (-not (Test-Path $launcher)) {
  throw "Launcher not found: $launcher"
}

if (-not (Get-Command npx -ErrorAction SilentlyContinue)) {
  throw "npx not found. Install Node.js first."
}

New-Item -ItemType Directory -Force -Path $outDir | Out-Null

Push-Location $root
try {
  Write-Host "[ui-lab-exe] Building $outExe"
  npx --yes pkg $launcher --targets node18-win-x64 --output $outExe
} finally {
  Pop-Location
}

if (-not (Test-Path $outExe)) {
  throw "Build failed: output file not found: $outExe"
}

Write-Host "[ui-lab-exe] Done: $outExe"
Write-Host "[ui-lab-exe] Run from project root to keep relative paths stable:"
Write-Host "  cd $root"
Write-Host "  .\dist\exe\furlab_ui_lab_server.exe"
