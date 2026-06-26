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
  var src = String(s);
  var out = "";
  for (var i = 0; i < src.length; i++) {
    var ch = src.charAt(i);
    var code = src.charCodeAt(i);
    if (ch === "\\") out += "\\\\";
    else if (ch === '"') out += '\\"';
    else if (code === 8) out += "\\b";
    else if (code === 9) out += "\\t";
    else if (code === 10) out += "\\n";
    else if (code === 12) out += "\\f";
    else if (code === 13) out += "\\r";
    else if (code < 32 || code > 126) {
      var hex = code.toString(16).toUpperCase();
      while (hex.length < 4) hex = "0" + hex;
      out += "\\u" + hex;
    } else out += ch;
  }
  return out;
}

function toJsonStr(s) {
  return '"' + esc(s) + '"';
}

function isoLikeDate(d) {
  try {
    var pad = function(n) { return (n < 10 ? "0" : "") + n; };
    return (
      d.getFullYear() + "-" +
      pad(d.getMonth() + 1) + "-" +
      pad(d.getDate()) + "T" +
      pad(d.getHours()) + ":" +
      pad(d.getMinutes()) + ":" +
      pad(d.getSeconds())
    );
  } catch (_) {
    return String(d);
  }
}

function toJsonValue(v) {
  if (v === null || v === undefined) return "null";
  if (typeof v === "number") return isFinite(v) ? String(v) : "null";
  if (typeof v === "boolean") return v ? "true" : "false";
  if (v instanceof Date) return toJsonStr(isoLikeDate(v));
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
    "SELECT TOP 1 id, inventoryTag, materialId, storageLocationId, scrapQuality, scrapStatus, " +
    "areaMm2, bboxWidthMm, bboxHeightMm, maxSpanMm, napDirectionDeg, [note], createdAt, updatedAt, metricsJson, scrapContour " +
    "FROM ScrapPiece WHERE (" + whereSql + ");"
  );
}

function buildPieceSelectSqlByTag(sourceId) {
  var srcTrim = String(sourceId || "");
  var whereSql = srcTrim ? ("[inventoryTag]='" + escSqlText(srcTrim) + "'") : "1=0";
  return (
    "SELECT TOP 1 id, inventoryTag, materialId, storageLocationId, scrapQuality, scrapStatus, " +
    "areaMm2, bboxWidthMm, bboxHeightMm, maxSpanMm, napDirectionDeg, [note], createdAt, updatedAt, metricsJson, scrapContour " +
    "FROM ScrapPiece WHERE (" + whereSql + ");"
  );
}

function readByNormalizedIdDb(db, sourceId, fields) {
  if (isGuidLike(sourceId)) {
    __stage = "query_by_id_db";
    return readSingle(db, buildPieceSelectSqlById(sourceId), fields);
  }
  __stage = "query_by_tag_db";
  return readSingle(db, buildPieceSelectSqlByTag(sourceId), fields);
}

function readByNormalizedIdAdo(conn, sourceId, fields) {
  if (isGuidLike(sourceId)) {
    __stage = "query_by_id_ado";
    return readSingleAdo(conn, buildPieceSelectSqlById(sourceId), fields);
  }
  __stage = "query_by_tag_ado";
  return readSingleAdo(conn, buildPieceSelectSqlByTag(sourceId), fields);
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

  var fields = [
    "id",
    "inventoryTag",
    "materialId",
    "storageLocationId",
    "scrapQuality",
    "scrapStatus",
    "areaMm2",
    "bboxWidthMm",
    "bboxHeightMm",
    "maxSpanMm",
    "napDirectionDeg",
    "note",
    "createdAt",
    "updatedAt",
    "metricsJson",
    "scrapContour"
  ];

  var objText = null;
  if (adoConn) objText = readByNormalizedIdAdo(adoConn, pieceId, fields);
  if (!objText && db) objText = readByNormalizedIdDb(db, pieceId, fields);

  if (!objText) {
    WScript.Echo('{"ok":false,"error":"piece_not_found","stage":' + toJsonStr(__stage) + "}");
    WScript.Quit(2);
  }

  WScript.Echo('{"ok":true,"item":' + objText + "}");
  WScript.Quit(0);
} catch (e) {
  var msg = String(e && e.message ? e.message : e);
  WScript.Echo('{"ok":false,"error":"piece_read_failed","message":' + toJsonStr(msg) + ',"stage":' + toJsonStr(__stage) + "}");
  WScript.Quit(3);
} finally {
  try { if (daoDb) daoDb.Close(); } catch (_) {}
  try { if (app) app.Quit(2); } catch (_) {}
  try { if (adoConn) adoConn.Close(); } catch (_) {}
}


