param(
  [string]$Root = ".",
  [string[]]$Include = @("*.bas", "*.cls", "*.frm", "*.sql", "*.js", "*.html", "*.css")
)

$ErrorActionPreference = "Stop"

$patternsRegex = @(
  "Ð.",
  "Ñ.",
  "�"
)

$patternsText = @(
  "Р°", "Рё", "Рѕ", "Рµ", "РЎ", "Рџ", "Рќ", "С‚", "СЊ", "СЏ"
)

$files = Get-ChildItem -Path $Root -Recurse -File | Where-Object {
  $name = $_.Name.ToLowerInvariant()
  foreach ($mask in $Include) {
    if ($name -like $mask.ToLowerInvariant()) { return $true }
  }
  return $false
}

$hits = @()
foreach ($f in $files) {
  $lineNo = 0
  Get-Content -Path $f.FullName -Encoding UTF8 | ForEach-Object {
    $lineNo++
    $line = $_
    $matched = $false
    foreach ($p in $patternsRegex) {
      if ($line -match $p) {
        $matched = $true
        break
      }
    }
    if (-not $matched) {
      $cnt = 0
      foreach ($p in $patternsText) {
        if ($line.Contains($p)) { $cnt++ }
        if ($cnt -ge 2) {
          $matched = $true
          break
        }
      }
    }
    if ($matched) {
        $hits += [PSCustomObject]@{
          File = $f.FullName
          Line = $lineNo
          Text = $line.Trim()
        }
    }
  }
}

if ($hits.Count -eq 0) {
  Write-Host "OK: mojibake patterns not found."
  exit 0
}

Write-Host "Found possible mojibake patterns:" -ForegroundColor Yellow
$hits | Select-Object -First 200 | ForEach-Object {
  Write-Host "$($_.File):$($_.Line): $($_.Text)"
}

if ($hits.Count -gt 200) {
  Write-Host "... and $($hits.Count - 200) more." -ForegroundColor Yellow
}

exit 1
