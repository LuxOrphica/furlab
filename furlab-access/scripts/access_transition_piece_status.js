var dbPath = WScript.Arguments.length > 0 ? WScript.Arguments(0) : "";
var pieceId = WScript.Arguments.length > 1 ? WScript.Arguments(1) : "";
var action = WScript.Arguments.length > 2 ? WScript.Arguments(2) : "";
var userName = WScript.Arguments.length > 3 ? WScript.Arguments(3) : "";
var note = WScript.Arguments.length > 4 ? WScript.Arguments(4) : "";

if (!dbPath || !pieceId || !action) {
  WScript.Echo('{"ok":false,"error":"db_path_piece_id_action_required"}');
  WScript.Quit(1);
}

var app = null;
var daoDb = null;
var daoEngine = null;

function esc(s) {
  if (s === null || s === undefined) return "";
  return String(s).replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

function toJsonStr(s) { return '"' + esc(s) + '"'; }

function trimStr(v) {
  return String(v === null || v === undefined ? "" : v).replace(/^\s+|\s+$/g, "");
}

function normalizeGuidLike(v) {
  var s = String(v === null || v === undefined ? "" : v).toLowerCase();
  s = s.replace(/\s+/g, "");
  s = s.replace(/\{guid/g, "");
  s = s.replace(/[{}]/g, "");
  return s;
}

function nowSql() {
  return "Now()";
}

function sqlText(v) {
  if (v === null || v === undefined) return "Null";
  return "'" + String(v).replace(/'/g, "''") + "'";
}

function sqlGuidLike(v) {
  if (v === null || v === undefined) return "Null";
  var s = trimStr(v);
  if (!s) return "Null";
  var m = s.match(/[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}/);
  if (m) {
    return "{guid {" + String(m[0]).toUpperCase() + "}}";
  }
  var body = trimStr(s.replace(/[{}]/g, "").replace(/^guid\s+/i, ""));
  if (!body) return "Null";
  return "{guid {" + String(body).toUpperCase() + "}}";
}

function guid() {
  try {
    var g = new ActiveXObject("Scriptlet.TypeLib").Guid;
    return String(g || "").replace(/[{}]/g, "").toUpperCase();
  } catch (_) {}
  function hex4() {
    return ("0000" + Math.floor(Math.random() * 65536).toString(16)).slice(-4).toUpperCase();
  }
  return hex4() + hex4() + "-" + hex4() + "-" + hex4() + "-" + hex4() + "-" + hex4() + hex4() + hex4();
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

function resolveWorkspace(db, appObj, daoObj) {
  try {
    if (db && db.Workspace) return db.Workspace;
  } catch (_) {}
  try {
    if (appObj && appObj.DBEngine) return appObj.DBEngine.Workspaces(0);
  } catch (_) {}
  try {
    if (daoObj) return daoObj.Workspaces(0);
  } catch (_) {}
  return null;
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

function findPiece(db, sourceId) {
  var rs = db.OpenRecordset("SELECT id, inventoryTag, scrapStatus FROM ScrapPiece;");
  var targetGuid = normalizeGuidLike(sourceId);
  var targetTag = trimStr(sourceId).toLowerCase();
  var out = null;
  while (!rs.EOF) {
    var rowId = String(rs.Fields("id").Value || "");
    var rowTag = trimStr(rs.Fields("inventoryTag").Value || "");
    var idMatch = (normalizeGuidLike(rowId) === targetGuid);
    var tagMatch = (targetTag && rowTag.toLowerCase() === targetTag);
    if (idMatch || tagMatch) {
      out = {
        id: rowId,
        inventoryTag: rowTag,
        scrapStatus: String(rs.Fields("scrapStatus").Value || "")
      };
      break;
    }
    rs.MoveNext();
  }
  rs.Close();
  return out;
}

function normalizeStatus(s) {
  var t = trimStr(String(s || "").toLowerCase().replace(/\s+/g, " "));
  // Use unicode escapes to avoid file-encoding dependent comparisons.
  if (
    t === "available" ||
    t === "\u0434\u043e\u0441\u0442\u0443\u043f\u0435\u043d" ||
    t === "\u0434\u043e\u0441\u0442\u0443\u043f\u043d\u043e"
  ) return "Available";
  if (
    t === "reserved" ||
    t === "\u0437\u0430\u0440\u0435\u0437\u0435\u0440\u0432\u0438\u0440\u043e\u0432\u0430\u043d" ||
    t === "\u0440\u0435\u0437\u0435\u0440\u0432"
  ) return "Reserved";
  if (t === "used" || t === "\u0438\u0441\u043f\u043e\u043b\u044c\u0437\u043e\u0432\u0430\u043d") return "Used";
  if (t === "discarded" || t === "\u0441\u043f\u0438\u0441\u0430\u043d") return "Discarded";
  return "";
}

function statusAfter(actionName, current) {
  var a = String(actionName || "").toLowerCase();
  var c = normalizeStatus(current);
  if (a === "reserve") {
    if (c !== "Available") return { ok: false, error: "transition_denied_reserve_requires_available" };
    return { ok: true, next: "Reserved", op: "Reserve" };
  }
  if (a === "release") {
    if (c !== "Reserved") return { ok: false, error: "transition_denied_release_requires_reserved" };
    return { ok: true, next: "Available", op: "Release" };
  }
  if (a === "use") {
    if (c !== "Reserved" && c !== "Available") return { ok: false, error: "transition_denied_use_requires_available_or_reserved" };
    return { ok: true, next: "Used", op: "Use" };
  }
  return { ok: false, error: "action_invalid" };
}

function execWithAffected(dbObj, sqlTextValue) {
  dbObj.Execute(sqlTextValue, 128);
  var affected = 0;
  try { affected = Number(dbObj.RecordsAffected || 0); } catch (_) {}
  return affected;
}

try {
  var db = null;
  var ws = null;
  var txStarted = false;
  try {
    daoEngine = new ActiveXObject("DAO.DBEngine.120");
    daoDb = daoEngine.OpenDatabase(dbPath);
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
  ws = resolveWorkspace(db, app, daoEngine);

  var piece = findPiece(db, pieceId);
  if (!piece) {
    WScript.Echo('{"ok":false,"error":"piece_not_found"}');
    WScript.Quit(2);
  }

  var transition = statusAfter(action, piece.scrapStatus);
  if (!transition.ok) {
    WScript.Echo('{"ok":false,"error":"' + esc(transition.error) + '","currentStatus":' + toJsonStr(piece.scrapStatus) + "}");
    WScript.Quit(2);
  }

  var actor = trimStr(userName || "");
  if (!actor) actor = "react-ui";
  var userNote = trimStr(note || "");

  try {
    if (ws) {
      ws.BeginTrans();
      txStarted = true;
    }

    var updated = execWithAffected(
      db,
      "UPDATE ScrapPiece SET scrapStatus=" + sqlText(transition.next) +
      ", updatedAt=" + nowSql() +
      " WHERE id=" + sqlGuidLike(piece.id) +
      " AND scrapStatus=" + sqlText(piece.scrapStatus) + ";"
    );
    if (updated < 1) {
      throw new Error("transition_conflict_status_changed");
    }

    if (tableExists(db, "ScrapReservation")) {
      if (String(action || "").toLowerCase() === "reserve") {
        var rid = "{" + guid() + "}";
        db.Execute(
          "INSERT INTO ScrapReservation (id, scrapPieceId, reservedAt, releasedAt, reservedBy, [note]) VALUES (" +
            sqlGuidLike(rid) + "," +
            sqlGuidLike(piece.id) + "," +
            nowSql() + "," +
            "Null," +
            sqlText(actor) + "," +
            sqlText(userNote) +
          ");",
          128
        );
      } else if (String(action || "").toLowerCase() === "release" || String(action || "").toLowerCase() === "use") {
        db.Execute(
          "UPDATE ScrapReservation SET releasedAt=" + nowSql() +
          " WHERE scrapPieceId=" + sqlGuidLike(piece.id) + " AND releasedAt Is Null;",
          128
        );
      }
    }

    if (tableExists(db, "ScrapTransaction")) {
      var tid = "{" + guid() + "}";
      db.Execute(
        "INSERT INTO ScrapTransaction (id, scrapPieceId, transType, transAt, statusBefore, statusAfter, [note], sourceRef) VALUES (" +
          sqlGuidLike(tid) + "," +
          sqlGuidLike(piece.id) + "," +
          sqlText(transition.op) + "," +
          nowSql() + "," +
          sqlText(normalizeStatus(piece.scrapStatus) || piece.scrapStatus) + "," +
          sqlText(transition.next) + "," +
          sqlText(userNote) + "," +
          sqlText("React_ScrapPieceCard") +
        ");",
        128
      );
    }

    if (txStarted && ws) {
      ws.CommitTrans();
      txStarted = false;
    }
  } catch (txErr) {
    if (txStarted && ws) {
      try { ws.Rollback(); } catch (_) {}
      txStarted = false;
    }
    throw txErr;
  }

  WScript.Echo(
    '{"ok":true,"pieceId":' + toJsonStr(piece.id) +
    ',"inventoryTag":' + toJsonStr(piece.inventoryTag) +
    ',"beforeStatus":' + toJsonStr(piece.scrapStatus) +
    ',"afterStatus":' + toJsonStr(transition.next) + "}"
  );

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

