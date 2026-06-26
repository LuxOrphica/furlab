# FurLab Web Plugin (Standalone)

Этот проект вынесен из `furlab-access`.

## Принцип связи
- Связь с текущим контуром `FURLAB AC` только через общую базу `accdb`.
- Прямых импортов/вызовов из `furlab-access` не использовать.
- Источник `Part`: DXF-файлы лекал (импорт в веб-проекте), а не ручное наполнение `Part` в БД.

## План старта
1. Создать отдельный backend в этой папке с подключением к `Furlab 1.accdb`.
2. Создать отдельный frontend (React) в этой папке.
3. Реализовать проектный контур: `Part -> Zone -> Layout -> LayoutRun -> Fragment`.
4. Подключить контур инвентаря как внешний ресурс через ту же БД.

## Документы
- UI map по прототипу v5: `docs/UI_MAP_V5.md`

## Workspace Engine
- Working field uses `Konva` (Canvas 2D scene/layers/events).
- Current stack: `pattern layer + zones layer + selection layer + guides layer`, tools (`select/pan/draw-zone/edit-vertex`), `undo/redo`.

## DXF Import (Step 1)
- `POST /api/import/dxf/discover`
  - body: `{ "folder": "C:/patterns", "recursive": false }`
  - effect: finds `.dxf` files in folder, no DB writes.
- `POST /api/import/dxf/pick-files`
  - body: `{}`
  - effect: opens native Windows file picker (Explorer dialog), returns selected `.dxf` paths.
- `POST /api/import/dxf/preview`
  - body: `{ "files": ["C:/path/a.dxf", "C:/path/b.dxf"] }`
  - effect: no DB writes, returns `token` and parsed part candidates.
  - each item includes validation/meta: `exists`, `isReadyForCommit`, `sizeBytes`, `modifiedAt`, `dxfSummary`.
- `POST /api/import/dxf/commit`
  - body: `{ "token": "...", "selectedIndexes": [0,1] }`
  - effect: writes only confirmed and `isReadyForCommit=true` candidates to `Part`.
- `GET /api/project/parts`
  - returns saved `Part` rows from Access DB.
- `GET /`
  - simple local UI page for `discover -> preview -> commit`.

## ZPRJ Import (Step 1.1)
- `POST /api/import/zprj/pick-file`
  - body: `{}`
  - effect: opens native Windows file picker for `.zprj`.
- `POST /api/import/zprj/preview`
  - body: `{ "filePath": "C:/path/project.zprj" }`
  - effect: reads container structure and prepares `Part` candidates (no DB writes).
  - geometry priority:
  - `DXF` (if found in `.zprj/.zpac`)
  - `PAC` heuristic parser fallback (binary `*.pac`, geometry-only; textures ignored)
  - `POS` heuristic parser fallback (if PAC is unavailable)
  - items with detected geometry are marked `geometryAvailable=true`.
- `POST /api/import/zprj/commit`
  - body: `{ "token": "...", "selectedIndexes": [0] }`
  - effect: writes selected candidates to `Part`.
- Current limitation:
  - `PAC/POS` parsing is heuristic (best-effort). On some CLO files geometry may be partial or not detected.

## Inventory + Fill Preview (Step 5 draft)
- `POST /api/inventory/candidates`
  - body (minimum): `{ "zone": { "points": [{ "x":0,"y":0 }, ...] } }`
  - effect: reads `ScrapPiece` candidates from Access DB and ranks them by zone constraints.
  - supports filters: `materialId`, `onlyAvailable`, `allowedStatuses`, `min/maxAreaMm2`,
    `min/maxAlongMm`, `min/maxAcrossMm`, `axis`, `napDirectionDeg`, `napToleranceDeg`, `limit`.
- `POST /api/layout/fill/preview`
  - body (minimum): `{ "zone": { "points": [...] }, "fillType": "voronoi" }`
  - effect: server-side generation of fragments (`voronoi` or `regular`) + optional candidate assignment preview.
  - supports params: `density`, `variability`, `anisotropy`, `rows`, `cols`, `minAreaMm2`, `maxCandidates`, `axis`, `candidates`.
