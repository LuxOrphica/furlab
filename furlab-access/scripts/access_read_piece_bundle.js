var dbPath = WScript.Arguments.length > 0 ? WScript.Arguments(0) : "";
var pieceRef = WScript.Arguments.length > 1 ? WScript.Arguments(1) : "";
var includeReservation = WScript.Arguments.length > 2 ? String(WScript.Arguments(2)) === "1" : false;
var includeHistory = WScript.Arguments.length > 3 ? String(WScript.Arguments(3)) === "1" : false;

if (!dbPath || !pieceRef) {
  WScript.Echo('{"ok":false,"error":"db_path_and_piece_ref_required"}');
  WScript.Quit(1);
}

var conn = null;
var db = null;
var daoDb = null;
var app = null;

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
function toJsonStr(s) { return '"' + esc(s) + '"'; }
function toJsonValue(v) {
  if (v === null || v === undefined) return "null";
  if (typeof v === "number") return isFinite(v) ? String(v) : "null";
  if (typeof v === "boolean") return v ? "true" : "false";
  return toJsonStr(String(v));
}
function trimText(s) { return String(s || "").replace(/^\s+|\s+$/g, ""); }
function escSqlText(s) { return String(s || "").replace(/'/g, "''"); }

function guidCandidates(sourceId) {
  var raw = trimText(sourceId);
  var norm = raw.toLowerCase().replace(/\s+/g, "").replace(/\{guid/g, "").replace(/[{}]/g, "");
  var out = [];
  function push(v) {
    var s = trimText(v);
    if (!s) return;
    for (var i = 0; i < out.length; i++) {
      if (String(out[i]).toLowerCase() === s.toLowerCase()) return;
    }
    out.push(s);
  }
  push(raw);
  if (norm) {
    var up = norm.toUpperCase();
    push(up);
    push("{" + up + "}");
    push("{guid {" + up + "}}");
    push("guid {" + up + "}");
  }
  return out;
}

function isGuidLike(v) {
  var norm = trimText(v).toLowerCase().replace(/\s+/g, "").replace(/\{guid/g, "").replace(/[{}]/g, "");
  if (!norm) return false;
  if (norm.length === 32) return /^[0-9a-f]{32}$/.test(norm);
  if (norm.length === 36) return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(norm);
  return false;
}

function buildWhereEqAny(field, values) {
  var terms = [];
  for (var i = 0; i < values.length; i++) {
    var v = trimText(values[i]);
    if (!v) continue;
    terms.push("[" + field + "]='" + escSqlText(v) + "'");
  }
  if (terms.length === 0) return "1=0";
  return "(" + terms.join(" OR ") + ")";
}

function openRecordset(sql) {
  if (conn) {
    var rsA = new ActiveXObject("ADODB.Recordset");
    rsA.Open(sql, conn, 0, 1);
    return rsA;
  }
  if (db) return db.OpenRecordset(sql);
  throw new Error("no_connection");
}

function queryFirst(sql, fields) {
  var rs = openRecordset(sql);
  var out = null;
  if (!rs.EOF) {
    var obj = [];
    for (var i = 0; i < fields.length; i++) {
      var f = fields[i];
      obj.push(toJsonStr(f) + ":" + toJsonValue(rs.Fields(f).Value));
    }
    out = "{" + obj.join(",") + "}";
  }
  rs.Close();
  return out;
}

function queryRows(sql, fields, sourceTable) {
  var rs = openRecordset(sql);
  var arr = [];
  while (!rs.EOF) {
    var obj = [];
    for (var i = 0; i < fields.length; i++) {
      var f = fields[i];
      var name = (typeof f === "string") ? f : f.name;
      var alias = (typeof f === "string") ? f : f.alias;
      obj.push(toJsonStr(alias) + ":" + toJsonValue(rs.Fields(name).Value));
    }
    if (sourceTable) obj.push(toJsonStr("sourceTable") + ":" + toJsonStr(sourceTable));
    arr.push("{" + obj.join(",") + "}");
    rs.MoveNext();
  }
  rs.Close();
  return arr;
}

function mergeRows(dst, src) {
  for (var i = 0; i < src.length; i++) dst.push(src[i]);
}

try {
  try {
    conn = new ActiveXObject("ADODB.Connection");
    conn.Open("Provider=Microsoft.ACE.OLEDB.12.0;Data Source=" + dbPath + ";Persist Security Info=False;");
  } catch (_) { conn = null; }

  if (!conn) {
    try {
      var dao = new ActiveXObject("DAO.DBEngine.120");
      daoDb = dao.OpenDatabase(dbPath, false, true);
      db = daoDb;
    } catch (_) { db = null; }
  }

  if (!conn && !db) {
    app = new ActiveXObject("Access.Application");
    try { app.Visible = false; } catch (_) {}
    try { app.UserControl = false; } catch (_) {}
    app.OpenCurrentDatabase(dbPath, false);
    try { db = app.CurrentDb(); } catch (_) {}
    if (!db) { try { db = app.CurrentDb; } catch (_) {} }
    if (!db) { throw new Error("current_db_unavailable"); }
  }

  var refCands = guidCandidates(pieceRef);
  var wherePiece = buildWhereEqAny("id", refCands);
  var whereTag = buildWhereEqAny("inventoryTag", [pieceRef]);

  var pieceSqlById =
    "SELECT TOP 1 id, inventoryTag, materialId, storageLocationId, scrapQuality, scrapStatus, " +
    "areaMm2, bboxWidthMm, bboxHeightMm, maxSpanMm, napDirectionDeg, [note], createdAt, updatedAt, metricsJson, scrapContour " +
    "FROM ScrapPiece WHERE (" + wherePiece + ");";
  var pieceSqlByTag =
    "SELECT TOP 1 id, inventoryTag, materialId, storageLocationId, scrapQuality, scrapStatus, " +
    "areaMm2, bboxWidthMm, bboxHeightMm, maxSpanMm, napDirectionDeg, [note], createdAt, updatedAt, metricsJson, scrapContour " +
    "FROM ScrapPiece WHERE (" + whereTag + ");";

  var pieceFields = [
    "id", "inventoryTag", "materialId", "storageLocationId", "scrapQuality", "scrapStatus",
    "areaMm2", "bboxWidthMm", "bboxHeightMm", "maxSpanMm", "napDirectionDeg", "note",
    "createdAt", "updatedAt", "metricsJson", "scrapContour"
  ];
  var item = null;
  if (isGuidLike(pieceRef)) {
    item = queryFirst(pieceSqlById, pieceFields);
  } else {
    item = queryFirst(pieceSqlByTag, pieceFields);
  }
  if (!item) {
    WScript.Echo('{"ok":false,"error":"piece_not_found"}');
    WScript.Quit(2);
  }

  var idMatch = String(item).match(/"id"\s*:\s*"([^"]*)"/i);
  var tagMatch = String(item).match(/"inventoryTag"\s*:\s*"([^"]*)"/i);
  var pieceId = idMatch ? idMatch[1] : pieceRef;
  var invTag = tagMatch ? tagMatch[1] : "";

  var fullCands = guidCandidates(pieceId);
  if (invTag) fullCands.push(invTag);
  var whereScrapPiece = buildWhereEqAny("scrapPieceId", fullCands);

  var reservationActive = "null";
  var reservationLast = "null";
  if (includeReservation) {
    try {
      var activeSql =
        "SELECT TOP 1 id, scrapPieceId, reservedAt, releasedAt, reservedBy, [note] " +
        "FROM ScrapReservation WHERE " + whereScrapPiece + " AND ([releasedAt] IS NULL OR [releasedAt]='') " +
        "ORDER BY reservedAt DESC;";
      var lastSql =
        "SELECT TOP 1 id, scrapPieceId, reservedAt, releasedAt, reservedBy, [note] " +
        "FROM ScrapReservation WHERE " + whereScrapPiece + " ORDER BY reservedAt DESC;";
      var rFields = ["id", "scrapPieceId", "reservedAt", "releasedAt", "reservedBy", "note"];
      reservationActive = queryFirst(activeSql, rFields) || "null";
      reservationLast = queryFirst(lastSql, rFields) || "null";
    } catch (_) {}
  }

  var historyRows = [];
  if (includeHistory) {
    try {
      var txSql =
        "SELECT TOP 200 [transAt], [transType], [statusBefore], [statusAfter], [sourceRef], [note] " +
        "FROM ScrapTransaction WHERE " + whereScrapPiece + " ORDER BY [transAt] DESC;";
      mergeRows(historyRows, queryRows(txSql, [
        "transAt", "transType", "statusBefore", "statusAfter", "sourceRef", "note"
      ], "ScrapTransaction"));
    } catch (_) {}

    try {
      var placementSql =
        "SELECT TOP 200 lr.[id] AS layoutRunId, f.[id] AS fragmentId, Nz(z.[id], f.[zoneId]) AS zoneId, " +
        "p.[rotationDeg] AS rotationDeg, p.[offsetXmm] AS offsetXmm, p.[offsetYmm] AS offsetYmm, " +
        "Nz(p.[resultContourSnapshot], f.[fragmentContour]) AS resultContourSnapshot, lr.[startedAt] AS ts, 'Place' AS action " +
        "FROM (((LayoutRunScrapPlacement AS p " +
        "LEFT JOIN LayoutRun AS lr ON p.[layoutRunId]=lr.[id]) " +
        "LEFT JOIN Layout AS l ON lr.[layoutId]=l.[id]) " +
        "LEFT JOIN Zone AS z ON l.[zoneId]=z.[id]) " +
        "LEFT JOIN Fragment AS f ON p.[fragmentId]=f.[id] " +
        "WHERE " + whereScrapPiece + " ORDER BY lr.[startedAt] DESC;";
      mergeRows(historyRows, queryRows(placementSql, [
        { name: "layoutRunId", alias: "layoutRunId" },
        { name: "fragmentId", alias: "fragmentId" },
        { name: "zoneId", alias: "zoneId" },
        { name: "rotationDeg", alias: "rotationDeg" },
        { name: "offsetXmm", alias: "offsetXmm" },
        { name: "offsetYmm", alias: "offsetYmm" },
        { name: "resultContourSnapshot", alias: "resultContourSnapshot" },
        { name: "ts", alias: "ts" },
        { name: "action", alias: "action" }
      ], "LayoutRunScrapPlacement"));
    } catch (_) {}
  }

  WScript.Echo(
    '{"ok":true,"item":' + item +
    ',"reservation":{"active":' + reservationActive + ',"last":' + reservationLast + "}" +
    ',"history":[' + historyRows.join(",") + "]}"
  );

  try { if (daoDb) daoDb.Close(); } catch (_) {}
  try { if (conn) conn.Close(); } catch (_) {}
  try {
    if (app) {
      app.CloseCurrentDatabase();
      app.Quit(2);
    }
  } catch (_) {}
  WScript.Quit(0);
} catch (e) {
  try { if (daoDb) daoDb.Close(); } catch (_) {}
  try { if (conn) conn.Close(); } catch (_) {}
  try {
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


