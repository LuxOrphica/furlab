# ScrapPiece contour normalization contract

Status: proposed canon
Date: 2026-07-07

## Decision

Do not add a new set of contour columns/fields for every intermediate frame.

The target database semantics are:

- `ScrapPiece.scrapContour` stores the layout-normalized physical contour of the scrap.
- `ScrapPiece.napDirectionDeg` stores `90` for that normalized contour.
- `metricsJson.contourRaw` and `metricsJson.napDirectionDegRaw` remain the audit/source data from registration.
- Existing `metricsJson.contourCanonical` and `metricsJson.napDirectionDegCanonical` remain compatibility/fallback data during migration, but are not the target solver input.

In other words, the working contour in the table is the contour used by Access normalized preview, the web plugin inventory view, and inventory solvers.

## Coordinate And Angle Convention

All stored FurLab geometry uses the FurLab raster convention:

- `X` grows to the right.
- `Y` grows downward.
- angles are degrees clockwise from `+X`, normalized to `[0, 360)`.
- contour coordinates are millimetres.

The production scan side is `leather_up`. This is a pipeline constant, not a per-piece field. If a future scanner workflow supports other scan sides, that workflow must introduce an explicit migration and reader contract.

DXF/CAD import and export may need a boundary adapter, but this must not change the stored FurLab contour convention.

## Existing And Target Fields

| Field | Current role | Target role |
|---|---|---|
| `scrapContour` | Often stores mirrored `fur_up` / `contourCanonical` | Stores layout-normalized contour (`fur_up` rotated so pile direction is down) |
| `napDirectionDeg` | Often stores canonical/fur-side nap angle | Stores `90` for normalized `scrapContour` |
| `metricsJson.contourRaw` | Raw scan contour | Keep as source/audit |
| `metricsJson.napDirectionDegRaw` | Raw scan nap angle | Keep as source/audit |
| `metricsJson.contourCanonical` | Mirrored `fur_up` contour | Keep as legacy fallback/audit |
| `metricsJson.napDirectionDegCanonical` | Fur-side nap angle | Keep as legacy fallback/audit |

No new mandatory `contourFurUp`, `contourLayoutNorm`, `napDirectionDegFurUp`, or `napDirectionDegLayoutNorm` fields are required.

## Normalization Formula

Because production scans are always `leather_up`:

1. `contourFurUp = mirrorVerticalByBBoxCenter(metricsJson.contourRaw)`.
2. `napFurUp = normalizeDeg360(180 - metricsJson.napDirectionDegRaw)`.
3. `scrapContour = rotate(contourFurUp, 90 - napFurUp)`.
4. `napDirectionDeg = 90`.

Rotation uses the FurLab coordinate convention: positive degrees rotate clockwise on screen because `Y` is down.

## Consumer Contract

Access piece card:

- must not lose `metricsJson.contourRaw` or `metricsJson.napDirectionDegRaw`;
- after migration, treats `scrapContour` as already normalized for the main operator view;
- may display raw/canonical diagnostic overlays from `metricsJson`, but must not rewrite them silently.

Web plugin candidate import:

- uses `scrapContour` directly when the row is marked/known as migrated;
- does not mirror or rotate it again;
- keeps legacy fallback for old rows: `contourCanonical + napDirectionDegCanonical` may be normalized on read until DB migration is complete.

Inventory solvers:

- receive already layout-normalized candidates;
- must not rotate pieces for `inventory_voronoi_sa` (R6);
- must keep `alignedContour` equal to translated normalized piece geometry, not a re-normalized variant.

Reports and exports:

- result fragments are derived from normalized placement geometry;
- any CAD/CLO coordinate adapter must live at the import/export boundary and be documented separately.

## Migration Plan

1. Audit the current Access DB without changing it:
   - verify every usable `ScrapPiece` has `metricsJson.contourRaw`;
   - verify every usable `ScrapPiece` has `metricsJson.napDirectionDegRaw`;
   - compare current `scrapContour` with expected normalized contour and report mismatches.
2. Back up `furlab-access/BD/Furlab 1.accdb`.
3. Backfill only existing fields:
   - set `scrapContour` to the normalized contour;
   - set `napDirectionDeg` to `90`;
   - keep raw/canonical data in `metricsJson`.
4. Update Access card and web-plugin readers to treat migrated `scrapContour` as normalized.
5. Keep fallback readers for old rows and old DB copies until the migration is confirmed.

## Safety Rules For Furlab Access

- Never delete `metricsJson.contourRaw` or `metricsJson.napDirectionDegRaw`.
- Never overwrite existing DB data without a backup and an audit report.
- Do not remove legacy `contourCanonical` readers in the first implementation pass.
- Do not change the global web-plugin viewport as part of this migration.
- Do not rewrite historical layout snapshots; they remain replay artifacts of the code version that produced them.
