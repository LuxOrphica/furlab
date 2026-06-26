var dbPath = WScript.Arguments.length > 0 ? WScript.Arguments(0) : "";
if (!dbPath) {
  WScript.Echo('{"ok":false,"error":"db_path_required"}');
  WScript.Quit(1);
}
try {
  var __fso = new ActiveXObject("Scripting.FileSystemObject");
  dbPath = __fso.GetAbsolutePathName(dbPath);
} catch (_) {}

function esc(s) {
  if (s === null || s === undefined) return "";
  return String(s).replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

var daoDb = null;
var app = null;

function tableExists(db, tableName) {
  var n = String(tableName || "").toLowerCase();
  try {
    for (var i = 0; i < db.TableDefs.Count; i++) {
      var td = db.TableDefs(i);
      if (String(td.Name || "").toLowerCase() === n) return true;
    }
  } catch (_) {}
  return false;
}

function indexExists(tableDef, indexName) {
  var n = String(indexName || "").toLowerCase();
  try {
    for (var i = 0; i < tableDef.Indexes.Count; i++) {
      var idx = tableDef.Indexes(i);
      if (String(idx.Name || "").toLowerCase() === n) return true;
    }
  } catch (_) {}
  return false;
}

function ensureIndex(db, spec) {
  var tableName = String(spec.table || "");
  var indexName = String(spec.name || "");
  var fields = spec.fields || [];
  if (!tableName || !indexName || !fields.length) {
    return { ok: false, table: tableName, index: indexName, error: "invalid_spec" };
  }
  if (!tableExists(db, tableName)) {
    return { ok: true, table: tableName, index: indexName, skipped: true, reason: "table_missing" };
  }

  var td = db.TableDefs(tableName);
  if (indexExists(td, indexName)) {
    return { ok: true, table: tableName, index: indexName, skipped: true, reason: "exists" };
  }

  try {
    var idx = td.CreateIndex(indexName);
    for (var i = 0; i < fields.length; i++) {
      idx.Fields.Append(idx.CreateField(String(fields[i])));
    }
    td.Indexes.Append(idx);
    td.Indexes.Refresh();
    return { ok: true, table: tableName, index: indexName, created: true };
  } catch (e) {
    return { ok: false, table: tableName, index: indexName, error: String(e && (e.message || e.description) || e) };
  }
}

function resolveDbFromAccessApp(appObj) {
  var db = null;
  try { db = appObj.CurrentDb(); } catch (_) {}
  if (!db) { try { db = appObj.CurrentDb; } catch (_) {}
  }
  if (!db) {
    try { db = appObj.DBEngine.Workspaces(0).Databases(0); } catch (_) {}
  }
  return db;
}

function toJsonResult(obj) {
  var parts = [];
  for (var k in obj) {
    if (!obj.hasOwnProperty(k)) continue;
    var v = obj[k];
    if (typeof v === "boolean") {
      parts.push('"' + k + '":' + (v ? "true" : "false"));
    } else {
      parts.push('"' + k + '":"' + esc(v) + '"');
    }
  }
  return "{" + parts.join(",") + "}";
}

try {
  try {
    var dao = new ActiveXObject("DAO.DBEngine.120");
    daoDb = dao.OpenDatabase(dbPath);
  } catch (_) {}
  if (!daoDb) {
    app = new ActiveXObject("Access.Application");
    try { app.Visible = false; } catch (_) {}
    try { app.UserControl = false; } catch (_) {}
    app.OpenCurrentDatabase(dbPath, false);
    daoDb = resolveDbFromAccessApp(app);
  }
  if (!daoDb) throw new Error("current_db_unavailable");

  var specs = [
    { table: "ScrapPiece", name: "ix_scrappiece_updatedat", fields: ["updatedAt"] },
    { table: "ScrapPiece", name: "ix_scrappiece_inventorytag", fields: ["inventoryTag"] },
    { table: "ScrapPiece", name: "ix_scrappiece_status_updatedat", fields: ["scrapStatus", "updatedAt"] },

    { table: "ScrapTransaction", name: "ix_scraptransaction_piece_transat", fields: ["scrapPieceId", "transAt"] },
    { table: "ScrapReservation", name: "ix_scrapreservation_piece_releasedat", fields: ["scrapPieceId", "releasedAt"] },

    { table: "LayoutRunScrapPlacement", name: "ix_lrsp_scrappiece_layoutrun", fields: ["scrapPieceId", "layoutRunId"] },
    { table: "LayoutRun", name: "ix_layoutrun_startedat", fields: ["startedAt"] },

    { table: "ScrapPieceUsageHistory", name: "ix_spuh_piece_createdat", fields: ["pieceId", "createdAt"] },
    { table: "ScrapUsageHistory", name: "ix_suh_piece_createdat", fields: ["pieceId", "createdAt"] },
    { table: "InventoryHistory", name: "ix_inventoryhistory_tag_createdat", fields: ["inventoryTag", "createdAt"] }
  ];

  var results = [];
  var created = 0;
  var skipped = 0;
  var failed = 0;

  for (var i = 0; i < specs.length; i++) {
    var r = ensureIndex(daoDb, specs[i]);
    results.push(r);
    if (!r.ok) failed++;
    else if (r.created) created++;
    else skipped++;
  }

  var jsonParts = [];
  for (var j = 0; j < results.length; j++) {
    jsonParts.push(toJsonResult(results[j]));
  }

  WScript.Echo(
    '{"ok":' + (failed === 0 ? "true" : "false") +
    ',"created":' + created +
    ',"skipped":' + skipped +
    ',"failed":' + failed +
    ',"results":[' + jsonParts.join(",") + ']}'
  );
  try { if (daoDb) daoDb.Close(); } catch (_) {}
  try { if (app) { app.CloseCurrentDatabase(); app.Quit(2); } } catch (_) {}
  WScript.Quit(failed === 0 ? 0 : 2);
} catch (e) {
  try { if (daoDb) daoDb.Close(); } catch (_) {}
  try { if (app) { app.CloseCurrentDatabase(); app.Quit(2); } } catch (_) {}
  WScript.Echo('{"ok":false,"error":"' + esc(e.message || e.description || e) + '"}');
  WScript.Quit(3);
}


