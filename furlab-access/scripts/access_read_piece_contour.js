var dbPath = WScript.Arguments.length > 0 ? WScript.Arguments(0) : "";
var pieceId = WScript.Arguments.length > 1 ? WScript.Arguments(1) : "";
if (!dbPath || !pieceId) {
  WScript.Echo('{"ok":false,"error":"db_path_and_piece_id_required"}');
  WScript.Quit(1);
}

var app = null;
var daoDb = null;
var adoConn = null;
var __stage = "init";

function esc(s) {
  if (s === null || s === undefined) return "";
  return String(s)
    .replace(/\\/g, "\\\\")
    .replace(/"/g, '\\"')
    .replace(/\r/g, "\\r")
    .replace(/\n/g, "\\n")
    .replace(/\t/g, "\\t")
    .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, " ");
}

function toJsonStr(s) {
  return '"' + esc(s) + '"';
}

function toJsonValue(v) {
  if (v === null || v === undefined) return "null";
  if (typeof v === "number") return isFinite(v) ? String(v) : "null";
  if (typeof v === "boolean") return v ? "true" : "false";
  if (v instanceof Date) return toJsonStr(String(v));
  return toJsonStr(String(v));
}

function readSingle(db, sql, fields) {
  __stage = "readSingle_open";
  var rs = db.OpenRecordset(sql);
  var out = null;
  if (!rs.EOF) {
    var obj = [];
    for (var i = 0; i < fields.length; i++) {
      __stage = "readSingle_field_" + fields[i];
      var f = fields[i];
      obj.push(toJsonStr(f) + ":" + toJsonValue(rs.Fields(f).Value));
    }
    out = "{" + obj.join(",") + "}";
  }
  rs.Close();
  return out;
}

function readSingleAdo(conn, sql, fields) {
  __stage = "readSingleAdo_exec";
  var rs = conn.Execute(sql);
  var out = null;
  if (!rs.EOF) {
    var obj = [];
    for (var i = 0; i < fields.length; i++) {
      __stage = "readSingleAdo_field_" + fields[i];
      var f = fields[i];
      obj.push(toJsonStr(f) + ":" + toJsonValue(rs.Fields(f).Value));
    }
    out = "{" + obj.join(",") + "}";
  }
  rs.Close();
  return out;
}

function normalizeGuidLike(v) {
  var s = String(v === null || v === undefined ? "" : v).toLowerCase();
  s = s.replace(/\s+/g, "");
  s = s.replace(/\{guid/g, "");
  s = s.replace(/[{}]/g, "");
  return s;
}

function isGuidLike(v) {
  var s = normalizeGuidLike(v);
  if (!s) return false;
  if (s.length === 32) return /^[0-9a-f]{32}$/.test(s);
  if (s.length === 36) return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(s);
  return false;
}

function escSqlText(s) {
  return String(s === null || s === undefined ? "" : s).replace(/'/g, "''");
}

function guidCandidates(sourceId) {
  var norm = normalizeGuidLike(sourceId);
  var out = [];
  function push(v) {
    var s = String(v || "");
    if (!s) return;
    var key = s.toLowerCase();
    for (var i = 0; i < out.length; i++) {
      if (String(out[i]).toLowerCase() === key) return;
    }
    out.push(s);
  }
  push(String(sourceId || ""));
  if (norm) {
    var up = norm.toUpperCase();
    push(up);
    push("{" + up + "}");
    push("{guid {" + up + "}}");
    push("guid {" + up + "}");
  }
  return out;
}

function buildPieceSelectSqlById(sourceId) {
  var cands = guidCandidates(sourceId);
  var where = [];
  for (var i = 0; i < cands.length; i++) {
    where.push("[id]='" + escSqlText(cands[i]) + "'");
  }
  var whereSql = where.length ? where.join(" OR ") : "1=0";
  return (
    "SELECT TOP 1 id, metricsJson, scrapContour " +
    "FROM ScrapPiece WHERE (" + whereSql + ");"
  );
}

function buildPieceSelectSqlByTag(sourceId) {
  var srcTrim = String(sourceId || "");
  var whereSql = srcTrim ? ("[inventoryTag]='" + escSqlText(srcTrim) + "'") : "1=0";
  return (
    "SELECT TOP 1 id, metricsJson, scrapContour " +
    "FROM ScrapPiece WHERE (" + whereSql + ");"
  );
}

try {
  __stage = "open_db";
  var db = null;
  try {
    adoConn = new ActiveXObject("ADODB.Connection");
    adoConn.Open("Provider=Microsoft.ACE.OLEDB.12.0;Data Source=" + dbPath + ";Persist Security Info=False;");
  } catch (adoErr) { adoConn = null; }

  if (!adoConn) {
    try {
      var dao = new ActiveXObject("DAO.DBEngine.120");
      daoDb = dao.OpenDatabase(dbPath, false, true);
      db = daoDb;
    } catch (daoErr) {}
  }

  if (!adoConn && !db) {
    app = new ActiveXObject("Access.Application");
    try { app.Visible = false; } catch (_) {}
    try { app.UserControl = false; } catch (_) {}
    app.OpenCurrentDatabase(dbPath, true);
    db = app.CurrentDb();
  }

  var fields = ["id", "metricsJson", "scrapContour"];
  var objText = null;
  if (isGuidLike(pieceId)) {
    var sqlById = buildPieceSelectSqlById(pieceId);
    if (adoConn) objText = readSingleAdo(adoConn, sqlById, fields);
    if (!objText && db) objText = readSingle(db, sqlById, fields);
  } else {
    var sqlByTag = buildPieceSelectSqlByTag(pieceId);
    if (adoConn) objText = readSingleAdo(adoConn, sqlByTag, fields);
    if (!objText && db) objText = readSingle(db, sqlByTag, fields);
  }

  if (!objText) {
    WScript.Echo('{"ok":false,"error":"piece_not_found","stage":' + toJsonStr(__stage) + "}");
    WScript.Quit(2);
  }

  WScript.Echo('{"ok":true,"item":' + objText + "}");
  WScript.Quit(0);
} catch (e) {
  var msg = String(e && e.message ? e.message : e);
  WScript.Echo('{"ok":false,"error":"piece_contour_failed","message":' + toJsonStr(msg) + ',"stage":' + toJsonStr(__stage) + "}");
  WScript.Quit(3);
} finally {
  try { if (daoDb) daoDb.Close(); } catch (_) {}
  try { if (app) app.Quit(2); } catch (_) {}
  try { if (adoConn) adoConn.Close(); } catch (_) {}
}


