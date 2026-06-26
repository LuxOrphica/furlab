$procs = Get-Process -Name "zrok" -ErrorAction SilentlyContinue
if ($null -eq $procs) {
  Write-Host "[zrok] not running"
  exit 0
}
foreach ($p in $procs) {
  Stop-Process -Id $p.Id -Force
  Write-Host "[zrok] stopped PID $($p.Id)"
}
