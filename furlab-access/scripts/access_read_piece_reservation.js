var dbPath = WScript.Arguments.length > 0 ? WScript.Arguments(0) : "";
var pieceId = WScript.Arguments.length > 1 ? WScript.Arguments(1) : "";
if (!dbPath || !pieceId) {
  WScript.Echo('{"ok":false,"error":"db_path_and_piece_id_required"}');
  WScript.Quit(1);
}

var app = null;
var daoDb = null;

function esc(s) {
  if (s === null || s === undefined) return "";
  return String(s).replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

function toJsonStr(s) { return '"' + esc(s) + '"'; }

function toJsonValue(v) {
  if (v === null || v === undefined) return "null";
  if (typeof v === "number") return isFinite(v) ? String(v) : "null";
  if (typeof v === "boolean") return v ? "true" : "false";
  if (v instanceof Date) return toJsonStr(v.toISOString());
  return toJsonStr(String(v));
}

function normalizeGuidLike(v) {
  var s = String(v === null || v === undefined ? "" : v).toLowerCase();
  s = s.replace(/\s+/g, "");
  s = s.replace(/\{guid/g, "");
  s = s.replace(/[{}]/g, "");
  return s;
}

function resolveDbFromAccessApp(appObj) {
  var db = null;
  try { db = appObj.CurrentDb(); } catch (_) {}
  if (!db) { try { db = appObj.CurrentDb; } catch (_) {} }
  if (!db) {
    try { db = appObj.DBEngine.Workspaces(0).Databases(0); } catch (_) {}
  }
  return db;
}

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

function rowToJson(rs) {
  var fields = ["id", "scrapPieceId", "reservedAt", "releasedAt", "reservedBy", "note"];
  var obj = [];
  for (var i = 0; i < fields.length; i++) {
    var f = fields[i];
    obj.push(toJsonStr(f) + ":" + toJsonValue(rs.Fields(f).Value));
  }
  return "{" + obj.join(",") + "}";
}

try {
  var db = null;
  try {
    var dao = new ActiveXObject("DAO.DBEngine.120");
    daoDb = dao.OpenDatabase(dbPath, false, true);
    db = daoDb;
  } catch (_) {}

  if (!db) {
    app = new ActiveXObject("Access.Application");
    try { app.Visible = false; } catch (_) {}
    try { app.UserControl = false; } catch (_) {}
    app.OpenCurrentDatabase(dbPath, false);
    db = resolveDbFromAccessApp(app);
  }
  if (!db) throw new Error("current_db_unavailable");

  if (!tableExists(db, "ScrapReservation")) {
    WScript.Echo('{"ok":true,"active":null,"last":null}');
    WScript.Quit(0);
  }

  var rs = db.OpenRecordset(
    "SELECT id, scrapPieceId, reservedAt, releasedAt, reservedBy, [note] FROM ScrapReservation ORDER BY reservedAt DESC;"
  );
  var target = normalizeGuidLike(pieceId);
  var active = null;
  var last = null;
  while (!rs.EOF) {
    if (normalizeGuidLike(rs.Fields("scrapPieceId").Value) === target) {
      if (last === null) last = rowToJson(rs);
      var rel = rs.Fields("releasedAt").Value;
      if (active === null && (rel === null || rel === undefined || String(rel) === "")) {
        active = rowToJson(rs);
      }
      if (last !== null && active !== null) break;
    }
    rs.MoveNext();
  }
  rs.Close();

  WScript.Echo('{"ok":true,"active":' + (active || "null") + ',"last":' + (last || "null") + "}");
  try { if (daoDb) daoDb.Close(); } catch (_) {}
  try {
    if (app) {
      app.CloseCurrentDatabase();
      app.Quit(2);
    }
  } catch (_) {}
  WScript.Quit(0);
} catch (e) {
  try {
    if (daoDb) daoDb.Close();
    if (app) {
      app.CloseCurrentDatabase();
      app.Quit(2);
    }
  } catch (_) {}
  WScript.Echo(
    '{"ok":false,"error":"' + esc(e.message || e.description || e) +
    '","number":"' + esc(e.number) + '","description":"' + esc(e.description) + '"}'
  );
  WScript.Quit(3);
}


