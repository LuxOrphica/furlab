var dbPath = WScript.Arguments.length > 0 ? WScript.Arguments(0) : "";
if (!dbPath) {
  WScript.Echo('{"ok":false,"error":"db_path_required"}');
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

function rowsFromRecordset(rs) {
  var out = [];
  while (!rs.EOF) {
    var obj = [];
    obj.push('"inventoryTag":' + toJsonValue(rs.Fields("inventoryTag").Value));
    obj.push('"layoutRunId":' + toJsonValue(rs.Fields("layoutRunId").Value));
    obj.push('"fragmentId":' + toJsonValue(rs.Fields("fragmentId").Value));
    obj.push('"zoneId":' + toJsonValue(rs.Fields("zoneId").Value));
    obj.push('"rotationDeg":' + toJsonValue(rs.Fields("rotationDeg").Value));
    obj.push('"offsetXmm":' + toJsonValue(rs.Fields("offsetXmm").Value));
    obj.push('"offsetYmm":' + toJsonValue(rs.Fields("offsetYmm").Value));
    obj.push('"resultContourSnapshot":' + toJsonValue(rs.Fields("resultContourSnapshot").Value));
    obj.push('"ts":' + toJsonValue(rs.Fields("ts").Value));
    out.push("{" + obj.join(",") + "}");
    rs.MoveNext();
  }
  rs.Close();
  return "[" + out.join(",") + "]";
}

function runQuery(db, sql) {
  var rs = db.OpenRecordset(sql);
  return rowsFromRecordset(rs);
}

function runQueryAdo(conn, sql) {
  var rs = new ActiveXObject("ADODB.Recordset");
  rs.Open(sql, conn, 0, 1);
  return rowsFromRecordset(rs);
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
  if (!db) {
    adoConn = new ActiveXObject("ADODB.Connection");
    adoConn.Open("Provider=Microsoft.ACE.OLEDB.12.0;Data Source=" + dbPath + ";Persist Security Info=False;");
  }
  if (!db && !adoConn) throw new Error("current_db_unavailable");

  var sql =
    "SELECT sp.[inventoryTag] AS inventoryTag, p.[layoutRunId] AS layoutRunId, p.[fragmentId] AS fragmentId, IIf(IsNull(z.[id]), f.[zoneId], z.[id]) AS zoneId, " +
    "p.[rotationDeg] AS rotationDeg, p.[offsetXmm] AS offsetXmm, p.[offsetYmm] AS offsetYmm, " +
    "p.[resultContourSnapshot] AS resultContourSnapshot, lr.[startedAt] AS ts " +
    "FROM ((((LayoutRunScrapPlacement AS p " +
    "LEFT JOIN ScrapPiece AS sp ON p.[scrapPieceId]=sp.[id]) " +
    "LEFT JOIN LayoutRun AS lr ON p.[layoutRunId]=lr.[id]) " +
    "LEFT JOIN Layout AS l ON lr.[layoutId]=l.[id]) " +
    "LEFT JOIN Zone AS z ON l.[zoneId]=z.[id]) " +
    "LEFT JOIN Fragment AS f ON p.[fragmentId]=f.[id] " +
    "ORDER BY lr.[startedAt] DESC;";

  var arr = db ? runQuery(db, sql) : runQueryAdo(adoConn, sql);
  WScript.Echo('{"ok":true,"items":' + arr + "}");

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
  } catch (_) {}
  WScript.Echo('{"ok":false,"error":"' + esc(e.message || e.description || e) + '"}');
  WScript.Quit(3);
}


