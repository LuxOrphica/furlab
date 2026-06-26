var dbPath = WScript.Arguments.length > 0 ? WScript.Arguments(0) : "";
var pieceId = WScript.Arguments.length > 1 ? WScript.Arguments(1) : "";
var inventoryTag = WScript.Arguments.length > 2 ? WScript.Arguments(2) : "";
if (!dbPath || !pieceId) {
  WScript.Echo('{"ok":false,"error":"db_path_and_piece_id_required"}');
  WScript.Quit(1);
}

var app = null;
var daoDb = null;
var adoConn = null;

function esc(s) {
  if (s === null || s === undefined) return "";
  return String(s).replace(/\\/g, "\\\\").replace(/"/g, '\\"');
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

function rowsFromRecordset(rs, fields, sourceTable) {
  var out = [];
  while (!rs.EOF) {
    var obj = [];
    for (var i = 0; i < fields.length; i++) {
      var f = fields[i];
      obj.push(toJsonStr(f.alias) + ":" + toJsonValue(rs.Fields(f.name).Value));
    }
    obj.push(toJsonStr("sourceTable") + ":" + toJsonStr(sourceTable));
    out.push("{" + obj.join(",") + "}");
    rs.MoveNext();
  }
  rs.Close();
  return "[" + out.join(",") + "]";
}

function runQuery(db, sql, fields, sourceTable) {
  var rs = db.OpenRecordset(sql);
  return rowsFromRecordset(rs, fields, sourceTable);
}

function runQueryAdo(conn, sql, fields, sourceTable) {
  var rs = new ActiveXObject("ADODB.Recordset");
  rs.Open(sql, conn, 0, 1);
  return rowsFromRecordset(rs, fields, sourceTable);
}

function appendJsonArrayParts(parts, arrJson) {
  var s = trimText(String(arrJson || "").replace(/^\uFEFF/, ""));
  if (!s || s === "[]") return;
  if (s.charAt(0) === "[" && s.charAt(s.length - 1) === "]") {
    s = trimText(s.substring(1, s.length - 1));
  }
  if (s) parts.push(s);
}

function trimText(s) {
  return String(s || "").replace(/^\s+|\s+$/g, "");
}

function normalizeGuidLike(v) {
  var s = String(v || "");
  var m = s.match(/[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}/);
  if (!m) return "";
  return m[0].toUpperCase();
}

function buildPieceIdCandidates(id, tag) {
  var set = {};
  var out = [];
  function add(v) {
    var s = trimText(v);
    if (!s || set[s]) return;
    set[s] = true;
    out.push(s);
  }
  var raw = trimText(id);
  add(raw);
  var g = normalizeGuidLike(raw);
  if (g) {
    add(g);
    add("{" + g + "}");
    add("{guid {" + g + "}}");
  }
  var t = trimText(tag);
  if (t) add(t);
  return out;
}

function buildWhereEqAny(field, values) {
  var terms = [];
  for (var i = 0; i < values.length; i++) {
    var v = String(values[i] || "");
    if (!v) continue;
    terms.push("[" + field + "]='" + v.replace(/'/g, "''") + "'");
  }
  if (terms.length === 0) return "1=0";
  return "(" + terms.join(" OR ") + ")";
}

function tableExistsDb(db, tableName) {
  try {
    var tds = db.TableDefs;
    for (var i = 0; i < tds.Count; i++) {
      var td = null;
      try { td = tds.Item(i); } catch (_) {}
      if (!td) continue;
      if (String(td.Name || "").toLowerCase() === String(tableName || "").toLowerCase()) return true;
    }
  } catch (_) {}
  return false;
}

function tableExistsAdo(conn, tableName) {
  try {
    var rs = conn.OpenSchema(20); // adSchemaTables
    var want = String(tableName || "").toLowerCase();
    while (!rs.EOF) {
      var tn = String(rs.Fields("TABLE_NAME").Value || "").toLowerCase();
      if (tn === want) {
        rs.Close();
        return true;
      }
      rs.MoveNext();
    }
    rs.Close();
  } catch (_) {}
  return false;
}

function resolveDbFromAccessApp(appObj) {
  var db = null;
  try { db = appObj.CurrentDb(); } catch (_) {}
  if (!db) { try { db = appObj.CurrentDb; } catch (_) {} }
  if (!db) {
    try {
      db = appObj.DBEngine.Workspaces(0).Databases(0);
    } catch (_) {}
  }
  return db;
}

try {
  var db = null;
  try {
    var dao = new ActiveXObject("DAO.DBEngine.120");
    daoDb = dao.OpenDatabase(dbPath, false, true);
    db = daoDb;
  } catch (daoErr) {}

  if (!db) {
    app = new ActiveXObject("Access.Application");
    try { app.Visible = false; } catch (_) {}
    try { app.UserControl = false; } catch (_) {}
    app.OpenCurrentDatabase(dbPath, false);
    db = resolveDbFromAccessApp(app);
  }
  if (!db) {
    try {
      adoConn = new ActiveXObject("ADODB.Connection");
      adoConn.Open("Provider=Microsoft.ACE.OLEDB.12.0;Data Source=" + dbPath + ";Persist Security Info=False;");
    } catch (adoErr) {}
  }
  if (!db && !adoConn) throw new Error("current_db_unavailable");

  var idCandidates = buildPieceIdCandidates(pieceId, inventoryTag);
  var whereByPieceId = buildWhereEqAny("pieceId", idCandidates);
  var whereByScrapPieceId = buildWhereEqAny("scrapPieceId", idCandidates);
  var whereByInventoryTag = buildWhereEqAny("inventoryTag", idCandidates);
  var existingTables = {};
  var existsFn = db ? tableExistsDb : tableExistsAdo;
  function hasTable(name) {
    if (existingTables[name] !== undefined) return existingTables[name];
    existingTables[name] = existsFn(db || adoConn, name);
    return existingTables[name];
  }

  var variants = [
    {
      source: "ScrapTransaction",
      sql:
        "SELECT [transAt], [transType], [statusBefore], [statusAfter], [sourceRef], [note] AS noteVal " +
        "FROM ScrapTransaction WHERE " + whereByScrapPieceId + " ORDER BY [transAt] DESC;",
      fields: [
        { name: "transAt", alias: "transAt" },
        { name: "transType", alias: "transType" },
        { name: "statusBefore", alias: "statusBefore" },
        { name: "statusAfter", alias: "statusAfter" },
        { name: "sourceRef", alias: "sourceRef" },
        { name: "noteVal", alias: "note" }
      ]
    },
    {
      source: "ScrapPieceHistory",
      sql:
        "SELECT [createdAt] AS ts, [action], [userName], [note] AS noteVal " +
        "FROM ScrapPieceHistory WHERE " + whereByPieceId + " ORDER BY [createdAt] DESC;",
      fields: [
        { name: "ts", alias: "ts" },
        { name: "action", alias: "action" },
        { name: "userName", alias: "userName" },
        { name: "noteVal", alias: "note" }
      ]
    },
    {
      source: "LayoutRunScrapPlacement",
      sql:
        "SELECT lr.[id] AS layoutRunId, f.[id] AS fragmentId, Nz(z.[id], f.[zoneId]) AS zoneId, " +
        "p.[rotationDeg] AS rotationDeg, p.[offsetXmm] AS offsetXmm, p.[offsetYmm] AS offsetYmm, " +
        "Nz(p.[resultContourSnapshot], f.[fragmentContour]) AS resultContourSnapshot, lr.[startedAt] AS ts, 'Place' AS action " +
        "FROM (((LayoutRunScrapPlacement AS p " +
        "LEFT JOIN LayoutRun AS lr ON p.[layoutRunId]=lr.[id]) " +
        "LEFT JOIN Layout AS l ON lr.[layoutId]=l.[id]) " +
        "LEFT JOIN Zone AS z ON l.[zoneId]=z.[id]) " +
        "LEFT JOIN Fragment AS f ON p.[fragmentId]=f.[id] " +
        "WHERE " + whereByScrapPieceId + " ORDER BY lr.[startedAt] DESC;",
      fields: [
        { name: "layoutRunId", alias: "layoutRunId" },
        { name: "fragmentId", alias: "fragmentId" },
        { name: "zoneId", alias: "zoneId" },
        { name: "rotationDeg", alias: "rotationDeg" },
        { name: "offsetXmm", alias: "offsetXmm" },
        { name: "offsetYmm", alias: "offsetYmm" },
        { name: "resultContourSnapshot", alias: "resultContourSnapshot" },
        { name: "ts", alias: "ts" },
        { name: "action", alias: "action" }
      ]
    },
    {
      source: "ScrapPieceUsageHistory",
      sql:
        "SELECT [createdAt] AS ts, [operation] AS action, [userName], [note] AS noteVal, " +
        "[layoutRunId], [fragmentId], [rotationDeg], [offsetXmm], [offsetYmm] " +
        "FROM ScrapPieceUsageHistory WHERE " + whereByPieceId + " ORDER BY [createdAt] DESC;",
      fields: [
        { name: "ts", alias: "ts" },
        { name: "action", alias: "action" },
        { name: "userName", alias: "userName" },
        { name: "noteVal", alias: "note" },
        { name: "layoutRunId", alias: "layoutRunId" },
        { name: "fragmentId", alias: "fragmentId" },
        { name: "rotationDeg", alias: "rotationDeg" },
        { name: "offsetXmm", alias: "offsetXmm" },
        { name: "offsetYmm", alias: "offsetYmm" }
      ]
    },
    {
      source: "ScrapPieceUsageHistory",
      sql:
        "SELECT [createdAt] AS ts, [operation] AS action, [userName], [note] AS noteVal " +
        "FROM ScrapPieceUsageHistory WHERE " + whereByPieceId + " ORDER BY [createdAt] DESC;",
      fields: [
        { name: "ts", alias: "ts" },
        { name: "action", alias: "action" },
        { name: "userName", alias: "userName" },
        { name: "noteVal", alias: "note" }
      ]
    },
    {
      source: "ScrapUsageHistory",
      sql:
        "SELECT [createdAt] AS ts, [operation] AS action, [userName], [note] AS noteVal, " +
        "[layoutRunId], [fragmentId], [rotationDeg], [offsetXmm], [offsetYmm] " +
        "FROM ScrapUsageHistory WHERE " + whereByPieceId + " ORDER BY [createdAt] DESC;",
      fields: [
        { name: "ts", alias: "ts" },
        { name: "action", alias: "action" },
        { name: "userName", alias: "userName" },
        { name: "noteVal", alias: "note" },
        { name: "layoutRunId", alias: "layoutRunId" },
        { name: "fragmentId", alias: "fragmentId" },
        { name: "rotationDeg", alias: "rotationDeg" },
        { name: "offsetXmm", alias: "offsetXmm" },
        { name: "offsetYmm", alias: "offsetYmm" }
      ]
    },
    {
      source: "ScrapUsageHistory",
      sql:
        "SELECT [createdAt] AS ts, [operation] AS action, [userName], [note] AS noteVal " +
        "FROM ScrapUsageHistory WHERE " + whereByPieceId + " ORDER BY [createdAt] DESC;",
      fields: [
        { name: "ts", alias: "ts" },
        { name: "action", alias: "action" },
        { name: "userName", alias: "userName" },
        { name: "noteVal", alias: "note" }
      ]
    },
    {
      source: "InventoryHistory",
      sql:
        "SELECT [createdAt] AS ts, [action], [userName], [note] AS noteVal " +
        "FROM InventoryHistory WHERE " + whereByInventoryTag + " ORDER BY [createdAt] DESC;",
      fields: [
        { name: "ts", alias: "ts" },
        { name: "action", alias: "action" },
        { name: "userName", alias: "userName" },
        { name: "noteVal", alias: "note" }
      ]
    }
  ];

  var itemParts = [];
  var loadedAny = false;
  var loadedBySource = {};
  for (var i = 0; i < variants.length; i++) {
    try {
      var v = variants[i];
      var srcTable = v.source;
      if (!hasTable(srcTable)) continue;
      if (loadedBySource[v.source]) continue;
      var arr = db
        ? runQuery(db, v.sql, v.fields, v.source)
        : runQueryAdo(adoConn, v.sql, v.fields, v.source);
      appendJsonArrayParts(itemParts, arr);
      loadedBySource[v.source] = true;
      loadedAny = true;
    } catch (_) {}
  }

  if (!loadedAny) {
    WScript.Echo('{"ok":true,"items":[]}');
    WScript.Quit(0);
  }

  WScript.Echo('{"ok":true,"items":[' + itemParts.join(",") + "]}");
  try { if (daoDb) daoDb.Close(); } catch (_) {}
  try { if (adoConn) adoConn.Close(); } catch (_) {}
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
    if (adoConn) adoConn.Close();
    if (app) {
      app.CloseCurrentDatabase();
      app.Quit(2);
    }
  } catch (q) {}
  WScript.Echo(
    '{"ok":false,"error":"' + esc(e.message || e.description || e) +
    '","number":"' + esc(e.number) + '","description":"' + esc(e.description) + '"}'
  );
  WScript.Quit(3);
}


