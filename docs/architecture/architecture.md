# Backend Architecture (furlab-access)

## Layers
- `tools/ui_lab_server.js`
  - thin HTTP entrypoint
  - request/response wiring, CORS/auth, startup prewarm
- `tools/server/routes/*`
  - HTTP route handling only
  - no direct Access/cscript calls
- `tools/server/bootstrap/*`
  - dependency wiring and service composition
- `tools/server/services/*`
  - business logic and Access read/write orchestration
  - cache/mirror policies, fallback behavior
- `tools/server/utils/*`
  - pure helpers (config, error normalization, request body, logger, temp files, id/db helpers)

## Responsibility Split
- Business logic: `services/*`
- I/O:
  - HTTP I/O: `ui_lab_server.js`, `routes/*`
  - DB/script I/O: `services/*` via `accessRunner/cscript_runner.js`
  - Filesystem temp/cache: `services/cache/*`, `utils/temp_files.js`

## API Rules
- Routes call only service methods provided by bootstrap context.
- Response formatting is centralized:
  - `normalizeApiPayload()` adds `requestId`, normalized error shape.
- Write endpoints are guarded by `checkWriteAuth()` (`X-API-Key` / Bearer).

## Error Contract
- Keep backward compatibility:
  - `error` (legacy string code)
- Unified fields:
  - `errorCode`
  - `errorDetail: { code, message, statusCode, requestId }`

## Logging
- Structured JSON logs via `utils/logger.js`
- Minimum fields:
  - `level`, `event`, `requestId`, `method`, `path`, `statusCode`, `durationMs`
- Prefer adding source/cache flags (`diag.source`, `cache.cached`, `cache.stale`) for read paths.

## Adding New Endpoint Checklist
1. Add route in `routes/*` (or new route module).
2. Add/extend service method in `services/*`.
3. Wire dependency in `bootstrap/app_services.js`.
4. Ensure response goes through normalized payload.
5. Extend `tools/smoke_api.js` for positive and error paths.
6. Update runbook/docs if behavior changed.
