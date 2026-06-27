# FurLab Working Canon

This file is the local implementation canon for `furlab-web-plugin`.

Primary sources:

- `docs/canon/FurLab_Data_Model_Glossary_v5.docx`
- `docs/canon/FurLab_Layouts_Types_Parameters_Scenarios.docx`
- `docs/canon/FurLab_Inventory_Waste_Accounting_v5.docx`

## Core rule

Use canonical FurLab terms only. Do not introduce substitute terminology in code, UI, contracts, reports, telemetry, or debug text unless the original canon cannot be used technically.

## Canonical entities

- `part`: product element containing one or more fur-processing zones
- `zone`: area inside a part where layout is performed and fragments are formed
- `zoneContour`: boundary contour of the zone; clipping limiter for the result
- `layout`: operation/settings that define how fragments are formed inside a zone
- `layoutRun`: fact of execution with fixed input parameters and obtained result
- `fragment`: closed result area inside a zone, used for specification, reporting, and export
- `fragmentContour`: final geometry of a fragment after clipping by zone and applying rules
- `scrapInventory`: pool of available fur scraps
- `scrapPiece`: physical inventory unit with tag, material, and contour
- `scrapContour`: digitized contour of a `scrapPiece`
- `inventoryTag`: unique identifier of a `scrapPiece`
- `napDirection`: pile direction of a piece
- `pileDirectionDeg`: pile direction of a zone

## Canonical layout relation

- `Layout.zoneId` means a layout belongs to exactly one zone.
- `Fragment.zoneId` means a fragment belongs to exactly one zone.
- `LayoutRun.layoutId` means a run belongs to one specific layout.
- Therefore, one manual inventory layout must be bound to one concrete zone and one concrete part through that zone.
- Recompute, apply, save, open, reports, and rendering for a manual layout must use the bound zone of that layout, not an arbitrary currently selected zone.

## InventoryLayout canon

For `InventoryLayout`:

- source geometry is `scrapContour` from `ScrapPiece` plus placement rules
- result is `fragment` as derivatives of `scrapPiece`
- fixation in data is:
  - `Layout.params`
  - `InventoryLayoutConfig`
  - `LayoutRun.paramsSnapshot`
  - `LayoutRunScrapPlacement(fragmentId, scrapPieceId, rotationDeg, offsetXmm, offsetYmm, resultContourSnapshot)`

This means:

- a piece is a source entity
- a fragment is a result entity
- result geometry must be fixed as `fragmentContour` / `resultContourSnapshot`, not treated as equal to the full `scrapContour`

## InventoryLayout execution order

Canonical sequence from Appendix Y:

1. Build candidate pool `ScrapPiece` by `filters` and `maxCandidates`.
2. Apply `constraints`.
3. Choose `placementStrategy`.
4. Place pieces in the zone.
5. Clip result contours by `zoneContour`.
6. Normalize result by `normalizeRules`.
7. Create `fragment`.
8. Persist usage facts in `LayoutRunScrapPlacement`.

## NormalizeRules canon

The following names are canonical and should be reused as-is:

- `minFragmentWidthMm`
- `minFragmentLengthMm`
- `simplifyToleranceMm`
- `mergeSmallFragments`
- `seamAllowanceReserveMm`

If the UI needs a friendlier label, keep the canonical parameter name in code, contracts, and debug output.

## Manual inventory mode interpretation

- Before apply:
  - user works with `scrapPiece`
  - evaluation is zone-bound and layout-bound
- After apply:
  - result is expressed as `fragment` inside the bound zone
  - reports and specifications must use fragments as result units, not raw pieces

## Forbidden terminology drift

Do not silently replace canon with ad-hoc terms like:

- `piece result` when `fragment` is meant
- `current selected zone` when a layout-bound zone is meant
- `layout for detail` when the canonical object is `layout` bound to `zone`
