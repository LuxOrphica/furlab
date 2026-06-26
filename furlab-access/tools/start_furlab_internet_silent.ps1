$ErrorActionPreference = "Stop"

Write-Host "[furlab-internet] start Docker stack"
powershell -NoProfile -ExecutionPolicy Bypass -File "f:\FURLAB\dev\furlab-access\tools\start_ldv_docker_stack.ps1"

Write-Host "[furlab-internet] start API watchdog"
Start-Process powershell -ArgumentList "-NoProfile", "-ExecutionPolicy", "Bypass", "-File", "f:\FURLAB\dev\furlab-access\tools\start_api_watchdog.ps1", "-IntervalSec", "15", "-FailThreshold", "2" -WindowStyle Hidden

Write-Host "[furlab-internet] start zrok watchdog (furlabac)"
Start-Process powershell -ArgumentList "-NoProfile", "-ExecutionPolicy", "Bypass", "-File", "f:\FURLAB\dev\furlab-access\tools\start_zrok_watchdog.ps1", "-Token", "furlabac", "-IntervalSec", "8", "-FailThreshold", "2" -WindowStyle Hidden

Write-Host "[furlab-internet] start web-plugin watchdog (5600)"
Start-Process powershell -ArgumentList "-NoProfile", "-ExecutionPolicy", "Bypass", "-File", "f:\FURLAB\dev\furlab-access\tools\start_web_plugin_watchdog.ps1", "-IntervalSec", "15" -WindowStyle Hidden

Write-Host "[furlab-internet] start zrok watchdog (furlabwp)"
Start-Process powershell -ArgumentList "-NoProfile", "-ExecutionPolicy", "Bypass", "-File", "f:\FURLAB\dev\furlab-access\tools\start_zrok_watchdog.ps1", "-Token", "furlabwp", "-IntervalSec", "8", "-FailThreshold", "2" -WindowStyle Hidden
