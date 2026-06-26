$ErrorActionPreference = "Stop"

Set-Location (Join-Path $PSScriptRoot "..")

Write-Host "[checks] smoke api"
node tools/smoke_api.js
if ($LASTEXITCODE -ne 0) { throw "smoke_api_failed ($LASTEXITCODE)" }

Write-Host "[checks] backend contract tests"
node --test tools/tests/api_contract.test.js tools/tests/status_transitions.test.js
if ($LASTEXITCODE -ne 0) { throw "backend_tests_failed ($LASTEXITCODE)" }

Write-Host "[checks] done"
