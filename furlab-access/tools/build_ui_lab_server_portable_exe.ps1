$ErrorActionPreference = "Stop"

$root = Resolve-Path (Join-Path $PSScriptRoot "..")
$toolsDir = Join-Path $root "tools"
$launcher = Join-Path $toolsDir "ui_lab_server_portable_launcher.js"
$bundleZip = Join-Path $toolsDir "runtime_bundle.zip"
$distDir = Join-Path $root "dist\exe"
$payloadDir = Join-Path $distDir "runtime_payload"
$outExe = Join-Path $distDir "furlab_ui_lab_server_portable.exe"

function Copy-TreeStrict {
  param(
    [Parameter(Mandatory = $true)][string]$Source,
    [Parameter(Mandatory = $true)][string]$Destination
  )
  if (-not (Test-Path $Source)) {
    throw "Missing path: $Source"
  }
  New-Item -ItemType Directory -Force -Path $Destination | Out-Null
  Copy-Item -Path (Join-Path $Source "*") -Destination $Destination -Recurse -Force
}

if (-not (Test-Path $launcher)) {
  throw "Launcher not found: $launcher"
}
if (-not (Get-Command npx -ErrorAction SilentlyContinue)) {
  throw "npx not found. Install Node.js first."
}

New-Item -ItemType Directory -Force -Path $distDir | Out-Null
Remove-Item -Recurse -Force $payloadDir -ErrorAction SilentlyContinue
New-Item -ItemType Directory -Force -Path $payloadDir | Out-Null

Write-Host "[portable-exe] Preparing runtime payload..."
Copy-TreeStrict -Source (Join-Path $root "scripts") -Destination (Join-Path $payloadDir "scripts")
Copy-TreeStrict -Source (Join-Path $root "sql") -Destination (Join-Path $payloadDir "sql")
Copy-TreeStrict -Source (Join-Path $root "ui-lab") -Destination (Join-Path $payloadDir "ui-lab")
Copy-TreeStrict -Source (Join-Path $root "tools\server") -Destination (Join-Path $payloadDir "tools\server")

New-Item -ItemType Directory -Force -Path (Join-Path $payloadDir "tools") | Out-Null
Copy-Item -Path (Join-Path $root "tools\ui_lab_server.js") -Destination (Join-Path $payloadDir "tools\ui_lab_server.js") -Force

$dbCandidate = Get-ChildItem -Path $root -Filter "Furlab 1.accdb" -File -Recurse -Depth 2 -ErrorAction SilentlyContinue | Select-Object -First 1
if ($null -ne $dbCandidate) {
  $targetDbDir = Join-Path $payloadDir $dbCandidate.Directory.Name
  New-Item -ItemType Directory -Force -Path $targetDbDir | Out-Null
  Copy-Item -Path $dbCandidate.FullName -Destination (Join-Path $targetDbDir "Furlab 1.accdb") -Force
}

Write-Host "[portable-exe] Packing runtime bundle..."
Remove-Item -Force $bundleZip -ErrorAction SilentlyContinue
Compress-Archive -Path (Join-Path $payloadDir "*") -DestinationPath $bundleZip -CompressionLevel Optimal -Force

Push-Location $root
try {
  Write-Host "[portable-exe] Building $outExe"
  npx --yes pkg $launcher --targets node18-win-x64 --output $outExe
} finally {
  Pop-Location
}

if (-not (Test-Path $outExe)) {
  throw "Build failed: output file not found: $outExe"
}

Write-Host "[portable-exe] Done: $outExe"
Write-Host "[portable-exe] This EXE works without local Node.js."
Write-Host "[portable-exe] Runtime is extracted to %LOCALAPPDATA%\\FurLabUiLab\\portable-runtime\\runtime-<hash>."
