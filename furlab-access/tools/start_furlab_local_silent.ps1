$ErrorActionPreference = "Stop"

Write-Host "[furlab-local] start API + Docker frontend"
powershell -NoProfile -ExecutionPolicy Bypass -File "f:\FURLAB\dev\furlab-access\tools\start_ldv_docker_stack.ps1"
