# Incident Checklist (Access/API)

## 1) DB lock / cannot open database
Symptoms:
- `current_db_unavailable`
- Access COM errors about exclusive lock
- API read/write timeouts

Checklist:
1. Check active Access processes:
   - `Get-Process MSACCESS -ErrorAction SilentlyContinue`
2. Check API process:
   - `Get-CimInstance Win32_Process -Filter "Name='node.exe'" | ? { $_.CommandLine -like '*tools/ui_lab_server.js*' }`
3. Check lock file:
   - `Get-ChildItem "F:\FURLAB\dev\furlab-access\БД" -Filter *.laccdb`
4. If orphan Access COM exists:
   - `Get-Process MSACCESS -ErrorAction SilentlyContinue | Stop-Process -Force`
5. Restart API task and re-check `/api/health`.

## 2) Empty stdout / parse failures from cscript
Symptoms:
- `*_parse_failed`
- script returns non-zero or empty output

Checklist:
1. Re-run the specific script manually with absolute DB path.
2. Inspect `tmp\access-api\*.log`.
3. Confirm ACE provider + COM availability:
   - `New-Object -ComObject Access.Application`
4. If unstable, reduce concurrent calls and retry.

## 3) Broken/stale cache behavior
Symptoms:
- stale data despite updates
- inconsistent `cache` metadata

Checklist:
1. Force refresh endpoints when available (`refresh=1`).
2. Restart API to clear in-memory cache.
3. Remove stale disk cache files:
   - `tmp\access-api\registry_cache.json`
   - `tmp\access-api\piece-cache\*.json`
4. Verify `cacheTtl` from `/api/health`.

## 4) Recovery quick path
1. Stop API task.
2. Run restore script from known-good backup.
3. Start API task.
4. Run smoke:
   - `node tools/smoke_api.js`
