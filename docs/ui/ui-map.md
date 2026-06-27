# FurLab Web Plugin - UI Map (v5)

Source:
- Screenshot pack: `F:/FURLAB/<ru-folder>/` (prototype v5)

## 1) Main User Flow

| Step | Prototype Group | User Action | DB Tables | Planned API (standalone backend) |
|---|---|---|---|---|
| 01 | `1.*`, `2.*` | Open plugin, import/select DXF pattern files | `Part` (derived from DXF), `ImportBatch` (optional) | `POST /api/import/dxf`, `GET /api/project/parts` |
| 02 | `3.*` | Select part, create/split zones | `Zone` | `GET /api/project/zones`, `POST /api/project/zones/split` |
| 03 | `4.*` | Assign fur material to zone | `FurMaterial`, `Zone` | `GET /api/dicts/materials`, `POST /api/project/zones/:id/material` |
| 04 | `5.0.*`, `5.1*` | Select layout type and set params | `Layout`, `InventoryLayoutConfig` | `GET /api/project/layout-types`, `POST /api/project/zones/:id/layout` |
| 05A | `5.2.*` | Inventory layout (mode A): candidates -> preview -> apply | `ScrapPiece`, `LayoutRun`, `Fragment`, `LayoutRunScrapPlacement`, `InventoryLayoutConfig` | `POST /api/layout-runs/inventory/preview`, `POST /api/layout-runs/inventory/apply` |
| 05B | `5.3.*` | Irregular/intarsia + stencil + fill remaining + assign from inventory (mode B) | `LayoutRun`, `Fragment`, `LayoutRunScrapPlacement`, `ScrapPiece` | `POST /api/layout-runs/irregular/preview`, `POST /api/layout-runs/fill-remaining/preview`, `POST /api/layout-runs/assign/apply` |
| 06 | `7.*` | Select finishing preset and tune fields | (optional finishing storage) | `GET /api/dicts/finishes`, `POST /api/project/zones/:id/finish` |
| 07 | `8.*` | Inspect/edit fragment parameters | `Fragment` | `GET /api/project/fragments/:id`, `PATCH /api/project/fragments/:id` |
| 08 | `9.*` | Convert to patterns, preview, run conversion | `LayoutRun`, `Fragment`, `Zone` | `POST /api/export/patterns/preview`, `POST /api/export/patterns/run` |
| 09 | `10.*`, `11.*` | Generate reports/specification and traceability | `Part`, `Zone`, `Fragment`, `ScrapPiece`, `LayoutRunScrapPlacement` | `GET /api/reports/summary`, `GET /api/reports/specification`, `GET /api/reports/traceability` |

## 2) UI Areas To Preserve

| Area | Prototype Group | Web Requirement |
|---|---|---|
| Left tools rail | tools/context menu screenshots | Quick actions for current context (zone/fragment/layout). |
| Modes panel | mode panel screenshots | Mode-first navigation: Zone -> Material -> Layout -> Finish -> Reports. |
| Property editor | properties panel screenshots | Right-side inspector with grouped sections and state-dependent controls. |
| Overlay settings | display settings screenshots | Toggles for zone borders, fragment fills, pile direction, statuses. |
| Dialog workflow | `5.2.2`, `5.2.4`, `9.1`, `9.2` | Step dialogs/wizards for long operations. |

## 3) Inventory-Specific UI Contracts

| Scenario | Prototype Group | Required Data |
|---|---|---|
| Label + QR flow | label screenshots | `ScrapPiece.inventoryTag`, `scrapContour`, `napDirectionDeg`, scan source ref |
| Candidate tuning | `5.2.2`, `5.3.6.1` | `InventoryLayoutConfig.maxCandidates`, `filtersJson`, `constraintsJson` |
| Preview before commit | `5.2.4`, `5.3.6.4` | Temporary placement set with warnings/conflicts |
| Placement traceability | `5.2.6`, `11.*` | `layoutRunId`, `fragmentId`, `scrapPieceId`, `resultContourSnapshot` |

## 4) Implementation Sequence (Standalone Project)

1. Build `Part/Zone/Material/Layout` read-write inspector.
2. Build `LayoutRun` preview/apply for regular + inventory mode A.
3. Build irregular/intarsia, fill remaining, mode B assignment.
4. Build conversion/export pipeline.
5. Build reports/specification/traceability screens.

## 5) Constraints

- This map applies only to `f:/FURLAB/dev/furlab-web-plugin`.
- No code coupling with `furlab-access`.
- Shared integration point is Access DB (`.accdb`) only.
- `Part` source of truth: DXF pattern files. DB `Part` is a persisted projection after DXF import.
