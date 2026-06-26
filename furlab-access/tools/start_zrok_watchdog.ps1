param(
  [Parameter(Mandatory)][string]$Token,
  [int]$IntervalSec = 10,
  [int]$FailThreshold = 2
)

$zrokExe = (Get-Command zrok -ErrorAction SilentlyContinue).Source
if (-not $zrokExe) { $zrokExe = "C:\Users\$env:USERNAME\AppData\Local\zrok\zrok.exe" }
$url = "https://$Token.share.zrok.io"
$fails = 0

Write-Host "[zrok-watchdog:$Token] monitoring $url every ${IntervalSec}s (fail threshold: $FailThreshold)"

function Get-ZrokProcess {
  Get-WmiObject Win32_Process -Filter "Name='zrok.exe'" -ErrorAction SilentlyContinue |
    Where-Object { $_.CommandLine -like "*$Token*" } |
    Select-Object -First 1
}

function Start-ZrokShare {
  Start-Process -FilePath $zrokExe -ArgumentList "share", "reserved", $Token -WindowStyle Hidden
  Write-Host "[zrok-watchdog:$Token] started"
}

while ($true) {
  $proc = Get-ZrokProcess
  if ($null -eq $proc) {
    Write-Host "[zrok-watchdog:$Token] process gone, restarting..."
    Start-ZrokShare
    $fails = 0
    Start-Sleep -Seconds $IntervalSec
    continue
  }

  try {
    $r = Invoke-WebRequest -Uri $url -UseBasicParsing -TimeoutSec 8
    if ($r.StatusCode -ge 200 -and $r.StatusCode -lt 500) {
      $fails = 0
    } else {
      $fails++
    }
  } catch {
    $fails++
    Write-Host "[zrok-watchdog:$Token] probe failed ($fails/$FailThreshold): $_"
  }

  if ($fails -ge $FailThreshold) {
    Write-Host "[zrok-watchdog:$Token] fail threshold reached, restarting..."
    $proc2 = Get-ZrokProcess
    if ($null -ne $proc2) {
      Stop-Process -Id $proc2.ProcessId -Force -ErrorAction SilentlyContinue
    }
    Start-Sleep -Seconds 2
    Start-ZrokShare
    $fails = 0
  }

  Start-Sleep -Seconds $IntervalSec
}
