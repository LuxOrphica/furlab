param(
  [Parameter(Mandatory)][string]$Token
)

$zrokExe = "C:\Users\Александр\AppData\Local\zrok\zrok.exe"

$running = Get-Process -Name "zrok" -ErrorAction SilentlyContinue
if ($null -ne $running) {
  Write-Host "[zrok] already running (PID $($running.Id -join ', '))"
  exit 0
}

Write-Host "[zrok] starting reserved share: $Token"
Start-Process -FilePath $zrokExe -ArgumentList "share", "reserved", $Token -WindowStyle Normal
