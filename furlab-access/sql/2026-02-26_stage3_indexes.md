# Stage 3 Index Plan (Access)

Target script: `scripts/access_ensure_indexes.js`

Indexes enforced:
- `ScrapPiece(ix_scrappiece_updatedat)` on `(updatedAt)`
- `ScrapPiece(ix_scrappiece_inventorytag)` on `(inventoryTag)`
- `ScrapPiece(ix_scrappiece_status_updatedat)` on `(scrapStatus, updatedAt)`
- `ScrapTransaction(ix_scraptransaction_piece_transat)` on `(scrapPieceId, transAt)`
- `ScrapReservation(ix_scrapreservation_piece_releasedat)` on `(scrapPieceId, releasedAt)`
- `LayoutRunScrapPlacement(ix_lrsp_scrappiece_layoutrun)` on `(scrapPieceId, layoutRunId)`
- `LayoutRun(ix_layoutrun_startedat)` on `(startedAt)`
- `ScrapPieceUsageHistory(ix_spuh_piece_createdat)` on `(pieceId, createdAt)`
- `ScrapUsageHistory(ix_suh_piece_createdat)` on `(pieceId, createdAt)`
- `InventoryHistory(ix_inventoryhistory_tag_createdat)` on `(inventoryTag, createdAt)`

Run:
```powershell
cscript //nologo //U scripts/access_ensure_indexes.js "F:\FURLAB\dev\furlab-access\БД\Furlab 1.accdb"
```

Notes:
- Script is idempotent: existing indexes are skipped.
- Missing tables are skipped (prototype-safe).
