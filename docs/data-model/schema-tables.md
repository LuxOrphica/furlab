# FurLab Access DB Schema (normalized for Access + W UI)

Notation (Access types):
- GUID = Replication ID
- TEXT(n)
- LONGTEXT = Memo / Long Text
- DOUBLE
- LONG = Long Integer
- DATETIME

## 0) Dictionaries

### ScrapStatusDict
PK: `code` (TEXT(20))
Columns:
- `code`: TEXT(20), not null
- `descr`: TEXT(80), null
Seed:
- `Available`, `Reserved`, `Used`, `Discarded`

### ScrapQualityDict
PK: `code` (TEXT(20))
Columns:
- `code`: TEXT(20), not null
- `descr`: TEXT(80), null
Seed:
- `OK`, `Reject`

## 1) Reference Data

### FurMaterial
PK: `id` (GUID)
Columns:
- `id`: GUID, not null
- `materialName`: TEXT(120), not null
- `propertiesJson`: LONGTEXT, null

### StorageLocation
PK: `id` (GUID)
UNIQUE: `locCode`
Columns:
- `id`: GUID, not null
- `locCode`: TEXT(40), not null
- `descr`: TEXT(120), null
Indexes:
- `ux_StorageLocation_locCode` (UNIQUE) on `locCode`

## 2) Product Structure

### Part
PK: `id` (GUID)
Columns:
- `id`: GUID, not null
- `partNo`: LONG, null
- `partName`: TEXT(120), null

### Zone
PK: `id` (GUID)
FK: `partId` -> `Part.id`
FK: `materialId` -> `FurMaterial.id` (NULL ok)
Columns:
- `id`: GUID, not null
- `partId`: GUID, not null
- `zoneNo`: LONG, null
- `zoneContour`: LONGTEXT, null
- `materialId`: GUID, null
- `pileDirectionDeg`: DOUBLE, null
Indexes:
- `ix_Zone_partId` on `partId`
- `ix_Zone_materialId` on `materialId`

### Fragment
PK: `id` (GUID)
FK: `zoneId` -> `Zone.id`
Columns:
- `id`: GUID, not null
- `zoneId`: GUID, not null
- `fragmentCode`: TEXT(32), null
- `fragmentContour`: LONGTEXT, null
- `areaMm2`: DOUBLE, null
Indexes:
- `ix_Fragment_zoneId` on `zoneId`
- `ix_Fragment_fragmentCode` on `fragmentCode`

## 3) Layout And Runs

### Layout
PK: `id` (GUID)
FK: `zoneId` -> `Zone.id`
Columns:
- `id`: GUID, not null
- `zoneId`: GUID, not null
- `layoutType`: TEXT(40), not null
- `paramsJson`: LONGTEXT, null
Indexes:
- `ix_Layout_zoneId` on `zoneId`
- `ix_Layout_layoutType` on `layoutType`

### LayoutRun
PK: `id` (GUID)
FK: `layoutId` -> `Layout.id`
Columns:
- `id`: GUID, not null
- `layoutId`: GUID, not null
- `startedAt`: DATETIME, null
- `paramsSnapshot`: LONGTEXT, null
- `resultSnapshot`: LONGTEXT, null
Indexes:
- `ix_LayoutRun_layoutId_startedAt` on (`layoutId`, `startedAt`)

### InventoryLayoutConfig
PK: `id` (GUID)
FK: `layoutId` -> `Layout.id`
Columns:
- `id`: GUID, not null
- `layoutId`: GUID, not null
- `maxCandidates`: LONG, not null
- `filtersJson`: LONGTEXT, null
- `constraintsJson`: LONGTEXT, null
Indexes:
- `ix_InventoryLayoutConfig_layoutId` on `layoutId`

## 4) Warehouse Core

### ScrapPiece
PK: `id` (GUID)
UNIQUE: `inventoryTag`
FK: `materialId` -> `FurMaterial.id` (NULL ok)
FK: `storageLocationId` -> `StorageLocation.id` (NULL ok)
FK: `scrapStatus` -> `ScrapStatusDict.code` (NULL ok)
FK: `scrapQuality` -> `ScrapQualityDict.code` (NULL ok)
Columns:
- `id`: GUID, not null
- `inventoryTag`: TEXT(64), not null
- `materialId`: GUID, null
- `storageLocationId`: GUID, null
- `scrapContour`: LONGTEXT, null
- `napDirectionDeg`: DOUBLE, null
- `areaMm2`: DOUBLE, null
- `bboxWidthMm`: DOUBLE, null
- `bboxHeightMm`: DOUBLE, null
- `maxSpanMm`: DOUBLE, null
- `scrapQuality`: TEXT(20), null
- `scrapStatus`: TEXT(20), null
- `note`: TEXT(255), null
- `createdAt`: DATETIME, null
- `updatedAt`: DATETIME, null
- `metricsJson`: LONGTEXT, null
Nap direction contract:
- Domain term `napDirection` is stored in DB as `ScrapPiece.napDirectionDeg`.
- Value range: `0 <= napDirectionDeg < 360` (degrees).
- Meaning: arrow direction from label base to tip, measured in scan plane.
- Since the label is scanned with the piece, `napDirectionDeg` is contour-bound to `scrapContour`.
Indexes:
- `ux_ScrapPiece_inventoryTag` (UNIQUE) on `inventoryTag`
- `ix_ScrapPiece_materialId` on `materialId`
- `ix_ScrapPiece_status` on `scrapStatus`
- `ix_ScrapPiece_locationId` on `storageLocationId`

### ScrapReservation
PK: `id` (GUID)
FK: `scrapPieceId` -> `ScrapPiece.id`
FK: `layoutRunId` -> `LayoutRun.id` (NULL ok)
FK: `fragmentId` -> `Fragment.id` (NULL ok)
Columns:
- `id`: GUID, not null
- `scrapPieceId`: GUID, not null
- `layoutRunId`: GUID, null
- `fragmentId`: GUID, null
- `reservedAt`: DATETIME, not null
- `releasedAt`: DATETIME, null
- `reservedBy`: TEXT(80), null
- `note`: TEXT(255), null
Indexes:
- `ix_ScrapReservation_pieceId` on `scrapPieceId`
- `ix_ScrapReservation_runId` on `layoutRunId`

### ScrapTransaction
PK: `id` (GUID)
FK: `scrapPieceId` -> `ScrapPiece.id`
FK: `fromLocId` -> `StorageLocation.id` (NULL ok)
FK: `toLocId` -> `StorageLocation.id` (NULL ok)
FK: `statusBefore` -> `ScrapStatusDict.code` (NULL ok)
FK: `statusAfter` -> `ScrapStatusDict.code` (NULL ok)
Columns:
- `id`: GUID, not null
- `scrapPieceId`: GUID, not null
- `transType`: TEXT(20), not null
- `transAt`: DATETIME, not null
- `fromLocId`: GUID, null
- `toLocId`: GUID, null
- `statusBefore`: TEXT(20), null
- `statusAfter`: TEXT(20), null
- `note`: TEXT(255), null
- `sourceRef`: TEXT(120), null
Indexes:
- `ix_ScrapTransaction_piece_time` on (`scrapPieceId`, `transAt`)

## 5) Traceability Fact

### LayoutRunScrapPlacement
PK: (`layoutRunId`, `fragmentId`)
FK: `layoutRunId` -> `LayoutRun.id`
FK: `fragmentId` -> `Fragment.id`
FK: `scrapPieceId` -> `ScrapPiece.id`
UNIQUE: (`layoutRunId`, `scrapPieceId`)
Columns:
- `layoutRunId`: GUID, not null
- `fragmentId`: GUID, not null
- `scrapPieceId`: GUID, not null
- `rotationDeg`: DOUBLE, null
- `offsetXmm`: DOUBLE, null
- `offsetYmm`: DOUBLE, null
- `resultContourSnapshot`: LONGTEXT, null
Nap direction on placement:
- `effectiveNapDeg = (ScrapPiece.napDirectionDeg + LayoutRunScrapPlacement.rotationDeg) Mod 360`
Indexes:
- `ux_LRSP_run_scrap` (UNIQUE) on (`layoutRunId`, `scrapPieceId`)
- `ix_LRSP_runId` on `layoutRunId`
- `ix_LRSP_fragmentId` on `fragmentId`
- `ix_LRSP_scrapPieceId` on `scrapPieceId`

## 6) Import From FurLab Spec (optional)

### ImportBatch
PK: `id` (GUID)
Columns:
- `id`: GUID, not null
- `sourceName`: TEXT(80), null
- `createdAt`: DATETIME, null

### ImportSpecLine
PK: `id` (GUID)
FK: `batchId` -> `ImportBatch.id`
Columns:
- `id`: GUID, not null
- `batchId`: GUID, not null
- `modelNo`: LONG, null
- `partNo`: LONG, null
- `zoneNo`: LONG, null
- `fragmentCode`: TEXT(32), null
- `qty`: LONG, null
- `areaMm2`: DOUBLE, null
- `napDirectionDeg`: DOUBLE, null
- `inventoryTag`: TEXT(64), null
- `layoutRunIdText`: TEXT(64), null
Indexes:
- `ix_ImportSpecLine_batchId` on `batchId`
- `ix_ImportSpecLine_inventoryTag` on `inventoryTag`
