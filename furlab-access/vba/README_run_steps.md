# Run steps for Access VBA build

1. Open your `.accdb` in Microsoft Access.
2. Press `Alt + F11` to open VBA editor.
3. Import module file `vba/BuildFurLabDB.bas`:
   - `File` -> `Import File...`
4. Ensure SQL file exists:
   - `sql/003_init_access_jet_w_ui_schema.sql`
5. Run macro from Immediate Window (`Ctrl + G`):
   - `BuildFurLabDB_JetCompatible`
   - For full rebuild (drop + recreate): `RebuildFurLabDB_JetCompatible`
6. If script is not auto-detected, paste full path when prompted, for example:
   - `f:\FURLAB\dev\furlab-access\sql\003_init_access_jet_w_ui_schema.sql`

Notes:
- Script executes SQL statements sequentially via `CurrentDb.Execute`.
- On error, execution stops and details are written to:
  - `notes/errors/build_db_errors.log` (relative to Access project folder).
- To run a custom SQL file:
  - `BuildFurLabDB_FromFile "C:\path\to\script.sql"`
- Rebuild script path:
  - `sql/004_rebuild_access_jet_w_ui_schema.sql`
- Nap direction rule:
  - Domain `napDirection` is stored as `ScrapPiece.napDirectionDeg` (0..360).
  - For placement, compute:
    - `effectiveNapDeg = (ScrapPiece.napDirectionDeg + LayoutRunScrapPlacement.rotationDeg) Mod 360`
- Contour storage:
  - Piece contour is stored in `ScrapPiece.scrapContour` as JSON (`LONGTEXT`), in millimeters.
  - Placement contour snapshot (optional) is stored in `LayoutRunScrapPlacement.resultContourSnapshot`.
