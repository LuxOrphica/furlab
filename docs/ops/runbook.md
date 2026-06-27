# RUNBOOK (Backend/Access)

## 1) Start API

```powershell
cd F:\FURLAB\dev\furlab-access
$env:FURLAB_API_KEY="change-me"
powershell -NoProfile -ExecutionPolicy Bypass -File tools/start_ui_lab_server.ps1
```

## 2) Health check

```powershell
curl <backend-base-url>/api/health
```

## 3) Smoke checks

```powershell
cd F:\FURLAB\dev\furlab-access
$env:SMOKE_BASE_URL="<backend-base-url>"
$env:FURLAB_API_KEY="change-me"
# optional:
# $env:SMOKE_PIECE_ID="{GUID or inventoryTag}"
node tools/smoke_api.js
```

### 3.1) Write smoke (safe mode with rollback)

```powershell
cd F:\FURLAB\dev\furlab-access
$env:SMOKE_BASE_URL="<backend-base-url>"
$env:FURLAB_API_KEY="change-me"
$env:SMOKE_PIECE_ID="{GUID or inventoryTag}"
$env:SMOKE_WRITE="1"
node tools/smoke_api.js
```

Notes:
- Uses existing piece only (no new inserts by default).
- Tests `update` as no-op payload.
- Tests `save-scrap-piece` conflict path (`already_exists`) expecting `409`.
- For transitions does `reserve->release` or `release->reserve` depending on current status.
- If status is not reversible (`Used`/`Discarded`), transition step is skipped.

### 3.2) Write smoke full-flow (save/update/reserve/release/use + cleanup)

```powershell
cd F:\FURLAB\dev\furlab-access
$env:SMOKE_BASE_URL="<backend-base-url>"
$env:FURLAB_API_KEY="change-me"
$env:SMOKE_WRITE_FULL="1"
node tools/smoke_api.js
```

Notes:
- Creates/overwrites a temporary `SMOKE_FULL_*` piece.
- Runs `save -> update -> reserve -> release -> use`.
- Cleanup step resets the same temp piece back to `Available`.

## 4) Typical incidents

- `api_key_required` / `api_key_invalid`:
  - verify `FURLAB_API_KEY` on server and client request header `X-API-Key`.
- `registry_*_failed` / empty data:
  - check DB lock state and DB path from `/api/health`.
  - restart API to refresh mirror/cache.
- `piece_*_parse_failed`:
  - inspect latest `tmp\access-api\*.log` and script output.

## 5) Stage3: Ensure DB indexes

```powershell
cd F:\FURLAB\dev\furlab-access
cscript //nologo //U scripts/access_ensure_indexes.js "F:\FURLAB\dev\furlab-access\БД\Furlab 1.accdb"
```

Expected:
- JSON summary with `created/skipped/failed`.
- `failed=0` for a healthy schema.

## 6) Backend tests (Stage4)

Contract + edge tests (read-only by default):

```powershell
cd F:\FURLAB\dev\furlab-access
$env:BACKEND_TEST_BASE_URL="<backend-base-url>"
# optional piece contract:
# $env:BACKEND_TEST_PIECE_ID="{GUID or inventoryTag}"
node --test tools/tests/api_contract.test.js tools/tests/status_transitions.test.js
```

Write transition tests (mutating, reversible):

```powershell
cd F:\FURLAB\dev\furlab-access
$env:BACKEND_TEST_BASE_URL="<backend-base-url>"
$env:FURLAB_API_KEY="change-me"
$env:BACKEND_TEST_PIECE_ID="{GUID or inventoryTag}"
$env:BACKEND_TEST_WRITE="1"
node --test tools/tests/status_transitions.test.js
```

Pre-merge gate:

```powershell
cd F:\FURLAB\dev\furlab-access
powershell -NoProfile -ExecutionPolicy Bypass -File tools/run_premerge_checks.ps1
```

## 7) Backup and restore (Stage5)

Create backup:

```powershell
cd F:\FURLAB\dev\furlab-access
powershell -NoProfile -ExecutionPolicy Bypass -File tools/db/backup_access_db.ps1 -Label "pre-change"
```

Restore backup:

```powershell
cd F:\FURLAB\dev\furlab-access
# stop API task first
powershell -NoProfile -ExecutionPolicy Bypass -File tools/db/restore_access_db.ps1 -BackupFile "F:\FURLAB\dev\furlab-access\backups\access\Furlab 1_YYYYMMDD_HHMMSS.accdb"
```

## 8) Migrations with journal (Stage5)

```powershell
cd F:\FURLAB\dev\furlab-access
# stop API task first
cscript //nologo scripts/access_apply_migrations.js "БД\Furlab 1.accdb" "sql"
```

For existing DB bootstrap (journal only):

```powershell
cd F:\FURLAB\dev\furlab-access
# stop API task first
cscript //nologo scripts/access_apply_migrations.js "БД\Furlab 1.accdb" "sql" baseline
```

References:
- `docs/MIGRATIONS.md`
- `docs/INCIDENT_CHECKLIST.md`

## 9) Build Windows EXE launcher for API

Build:

```powershell
cd F:\FURLAB\dev\furlab-access
powershell -NoProfile -ExecutionPolicy Bypass -File tools/build_ui_lab_server_exe.ps1
```

Run:

```powershell
cd F:\FURLAB\dev\furlab-access
$env:FURLAB_API_KEY="change-me"
.\dist\exe\furlab_ui_lab_server.exe
```

Notes:
- This EXE is a launcher for local project files, not a fully standalone package.
- Keep repository structure intact (`tools/`, `scripts/`, `ui-lab/`, `sql/`, `БД/`).
- The backend runs on the configured project API port unless overridden with `UI_LAB_PORT`.

## 10) Build Portable Standalone EXE (no local Node.js required)

Build:

```powershell
cd F:\FURLAB\dev\furlab-access
powershell -NoProfile -ExecutionPolicy Bypass -File tools/build_ui_lab_server_portable_exe.ps1
```

Run:

```powershell
$env:FURLAB_API_KEY="change-me"
F:\FURLAB\dev\furlab-access\dist\exe\furlab_ui_lab_server_portable.exe
```

Notes:
- On first start EXE extracts runtime to `%LOCALAPPDATA%\FurLabUiLab\portable-runtime\runtime-<hash>`.
- If bundled DB exists, default `FURLAB_DB_PATH` is set to extracted `БД\Furlab 1.accdb`.
- You can override DB explicitly: `setx FURLAB_DB_PATH "D:\path\custom.accdb"`.

## 11) Build Electron Portable EXE (Desktop wrapper)

Build:

```powershell
cd F:\FURLAB\dev\furlab-access
powershell -NoProfile -ExecutionPolicy Bypass -File tools/build_ui_lab_electron_portable.ps1
```

Run:

```powershell
F:\FURLAB\dev\furlab-access\tools\electron-shell\dist\FurLab UI Lab 0.1.0.exe
```

Notes:
- Electron app starts backend (`tools/ui_lab_server.js`) in background and opens the bundled UI route.
- If the configured API port is occupied, set another port before start:
  - `set UI_LAB_PORT=5511` (cmd)
  - `$env:UI_LAB_PORT="5511"` (PowerShell)

