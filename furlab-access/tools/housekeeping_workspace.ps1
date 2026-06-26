param(
  [switch]$DryRun,
  [switch]$ArchiveGeneratedDocs,
  [switch]$ArchiveUiLabArtifacts
)

$ErrorActionPreference = 'Stop'
$root = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$stamp = Get-Date -Format 'yyyyMMdd_HHmmss'
$sessionArchive = Join-Path $root "tmp/session-archive/$stamp"
$reportPath = Join-Path $root "tmp/session-archive/$stamp-manifest.txt"
$moved = New-Object System.Collections.Generic.List[string]

function Add-Manifest {
  param([string]$line)
  $moved.Add($line) | Out-Null
  Write-Output $line
}

function Get-FileSizeMB {
  param([string]$path)
  if (-not (Test-Path $path)) { return 0 }
  if (Test-Path $path -PathType Leaf) {
    return [math]::Round(((Get-Item $path).Length / 1MB), 2)
  }
  $sum = (Get-ChildItem -Path $path -Recurse -File -ErrorAction SilentlyContinue | Measure-Object -Property Length -Sum).Sum
  if (-not $sum) { $sum = 0 }
  return [math]::Round(($sum / 1MB), 2)
}

function Move-Safely {
  param(
    [Parameter(Mandatory=$true)][string]$SourcePath,
    [Parameter(Mandatory=$true)][string]$ArchiveRoot,
    [switch]$PreserveRelative
  )

  if (-not (Test-Path $SourcePath)) { return }

  $sourceResolved = (Resolve-Path $SourcePath).Path
  if ($PreserveRelative) {
    $relative = $sourceResolved.Substring($root.Length).TrimStart('\\')
    $destination = Join-Path $ArchiveRoot $relative
  } else {
    $name = Split-Path $sourceResolved -Leaf
    $destination = Join-Path $ArchiveRoot $name
  }

  $destinationDir = Split-Path -Parent $destination
  $sizeMb = Get-FileSizeMB -path $sourceResolved

  if ($DryRun) {
    Add-Manifest "[DRY] MOVE $sourceResolved -> $destination (${sizeMb}MB)"
    return
  }

  if (-not (Test-Path $destinationDir)) {
    New-Item -ItemType Directory -Path $destinationDir -Force | Out-Null
  }

  Move-Item -Path $sourceResolved -Destination $destination -Force
  Add-Manifest "MOVE $sourceResolved -> $destination (${sizeMb}MB)"
}

# 1) Root temporary artifacts
$tmpFiles = Get-ChildItem -Path $root -File -Filter '_tmp_*' -ErrorAction SilentlyContinue
foreach ($file in $tmpFiles) {
  Move-Safely -SourcePath $file.FullName -ArchiveRoot $sessionArchive
}

# 2) Optional docs archive (generated duplicates)
if ($ArchiveGeneratedDocs) {
  $docsArchive = Join-Path $root "docs/archive/generated/$stamp"
  $filePatterns = @(
    'docs/FurLab_DB_Presentation_v2_clean_*.pptx',
    'docs/FurLab_DB_Presentation_Draft_*.pptx',
    'docs/segmentation_benchmark_v3_*.csv',
    'docs/segmentation_benchmark_v3_*.json'
  )

  foreach ($pattern in $filePatterns) {
    $matches = Get-ChildItem -Path (Join-Path $root $pattern) -File -ErrorAction SilentlyContinue
    foreach ($m in $matches) {
      Move-Safely -SourcePath $m.FullName -ArchiveRoot $docsArchive
    }
  }

  $dirPatterns = @(
    'docs/segmentation_overlays_v3_*'
  )

  foreach ($pattern in $dirPatterns) {
    $dirs = Get-ChildItem -Path (Join-Path $root $pattern) -Directory -ErrorAction SilentlyContinue
    foreach ($d in $dirs) {
      Move-Safely -SourcePath $d.FullName -ArchiveRoot $docsArchive
    }
  }
}

# 3) Optional ui-lab heavy generated artifacts
if ($ArchiveUiLabArtifacts) {
  $uiArchive = Join-Path $root "ui-lab/archive/generated/$stamp"
  $targets = @(
    'ui-lab/assets/uploads_real_only',
    'ui-lab/line-direction-visualizer-react/docs',
    'ui-lab/line-direction-visualizer-react/ml/preds',
    'ui-lab/line-direction-visualizer-react/ml/runs'
  )

  foreach ($target in $targets) {
    $full = Join-Path $root $target
    if (Test-Path $full) {
      Move-Safely -SourcePath $full -ArchiveRoot $uiArchive
    }
  }
}

if (-not $DryRun) {
  if ($moved.Count -eq 0) {
    "No files moved." | Set-Content -Path $reportPath -Encoding UTF8
  } else {
    $moved | Set-Content -Path $reportPath -Encoding UTF8
  }
}

Write-Output "Done. DryRun=$DryRun ArchiveGeneratedDocs=$ArchiveGeneratedDocs ArchiveUiLabArtifacts=$ArchiveUiLabArtifacts"
