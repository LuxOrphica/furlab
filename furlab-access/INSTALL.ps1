# FurLab Demo — Install Script
# Run once on a new machine: powershell -ExecutionPolicy Bypass -File INSTALL.ps1
# Clones both repos, installs Node deps, checks Node.js version.

param(
    [string]$InstallDir = "C:\FurLab"
)

$ErrorActionPreference = "Stop"

function Write-Step($msg) { Write-Host "`n==> $msg" -ForegroundColor Cyan }
function Write-Ok($msg)   { Write-Host "    OK: $msg" -ForegroundColor Green }
function Write-Fail($msg) { Write-Host "    ERROR: $msg" -ForegroundColor Red; exit 1 }

# --- Check Node.js ---
Write-Step "Checking Node.js"
$node = Get-Command node -ErrorAction SilentlyContinue
if (-not $node) { Write-Fail "Node.js not found. Install from https://nodejs.org (LTS)" }
$nodeVer = (node --version) -replace "v", "" -split "\."
if ([int]$nodeVer[0] -lt 18) { Write-Fail "Node.js 18+ required. Found: $(node --version)" }
Write-Ok "Node.js $(node --version)"

# --- Create install dir ---
Write-Step "Creating $InstallDir"
New-Item -ItemType Directory -Force -Path $InstallDir | Out-Null
Write-Ok $InstallDir

# --- Clone repos ---
$repos = @(
    @{ Name = "furlab-access";     Url = "https://github.com/LuxOrphica/FurLab.git" },
    @{ Name = "furlab-web-plugin"; Url = "https://github.com/LuxOrphica/furlab-web-plugin.git" }
)

foreach ($r in $repos) {
    $dest = Join-Path $InstallDir $r.Name
    Write-Step "Cloning $($r.Name)"
    if (Test-Path $dest) {
        Write-Host "    Already exists — pulling latest..." -ForegroundColor Yellow
        git -C $dest pull
    } else {
        git clone $r.Url $dest
    }
    Write-Ok $dest
}

# --- npm install ---
foreach ($r in $repos) {
    $dest = Join-Path $InstallDir $r.Name
    $pkg  = Join-Path $dest "package.json"
    if (Test-Path $pkg) {
        Write-Step "npm install — $($r.Name)"
        Push-Location $dest
        npm install --prefer-offline 2>&1 | Select-Object -Last 3
        Pop-Location
        Write-Ok "dependencies installed"
    }
}

# --- Copy START_DEMO.ps1 shortcut ---
$demoSrc = Join-Path $InstallDir "furlab-access\START_DEMO.ps1"
$demoLink = Join-Path $InstallDir "START_DEMO.ps1"
if ((Test-Path $demoSrc) -and -not (Test-Path $demoLink)) {
    Copy-Item $demoSrc $demoLink
}

Write-Host ""
Write-Host "=====================================" -ForegroundColor Green
Write-Host "  Installation complete!" -ForegroundColor Green
Write-Host "=====================================" -ForegroundColor Green
Write-Host ""
Write-Host "  To start the demo:"
Write-Host "  cd $InstallDir"
Write-Host "  powershell -ExecutionPolicy Bypass -File START_DEMO.ps1"
Write-Host ""
