$ErrorActionPreference = "Stop"

$root = Resolve-Path (Join-Path $PSScriptRoot "..")
$shellDir = Join-Path $root "tools\electron-shell"

if (-not (Test-Path $shellDir)) {
  throw "Electron shell folder not found: $shellDir"
}

Push-Location $shellDir
try {
  if (-not (Test-Path (Join-Path $shellDir "node_modules"))) {
    Write-Host "[ui-lab-electron] Installing dependencies..."
    npm install
  }

  Write-Host "[ui-lab-electron] Building portable Electron EXE..."
  npm run dist
} finally {
  Pop-Location
}

Write-Host "[ui-lab-electron] Done."
Write-Host "[ui-lab-electron] Output folder:"
Write-Host "  $shellDir\dist"

