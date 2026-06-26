var dbPath = WScript.Arguments.length > 0 ? WScript.Arguments(0) : "";
var inventoryTag = WScript.Arguments.length > 1 ? WScript.Arguments(1) : "";

if (!dbPath || !inventoryTag) {
  WScript.Echo("USAGE: cscript //nologo access_inventory_exists.js <dbPath> <inventoryTag>");
  WScript.Quit(1);
}

var fso = new ActiveXObject("Scripting.FileSystemObject");
if (!fso.FileExists(dbPath)) {
  WScript.Echo("DB_NOT_FOUND: " + dbPath);
  WScript.Quit(2);
}

function esc(s) {
  if (s === null || s === undefined) return "";
  return String(s).replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

function toJsonStr(s) {
  return '"' + esc(s) + '"';
}

function nowMs() {
  return new Date().getTime();
}

function runWithAdo(safeTag) {
  var conn = null;
  var rs = null;
  var t0 = nowMs();
  var tOpen0 = t0;
  try {
    conn = new ActiveXObject("ADODB.Connection");
    conn.Open("Provider=Microsoft.ACE.OLEDB.12.0;Data Source=" + dbPath + ";Persist Security Info=False;");
    var openMs = nowMs() - tOpen0;
    var tQuery0 = nowMs();
    rs = conn.Execute("SELECT Count(*) AS c FROM ScrapPiece WHERE inventoryTag='" + safeTag + "'");
    var c = 0;
    if (!rs.EOF) c = rs.Fields("c").Value;
    var queryMs = nowMs() - tQuery0;
    var tClose0 = nowMs();
    try { rs.Close(); } catch (_) {}
    try { conn.Close(); } catch (_) {}
    var closeMs = nowMs() - tClose0;
    return { ok: true, exists: (c > 0), diag: { engine: "ado", openMs: openMs, queryMs: queryMs, closeMs: closeMs, totalMs: nowMs() - t0 } };
  } catch (e) {
    try { if (rs) rs.Close(); } catch (_) {}
    try { if (conn) conn.Close(); } catch (_) {}
    return { ok: false, error: "ado_failed: " + (e.message || e.description || e) };
  }
}

function runWithDao(safeTag) {
  var dao = null;
  var db = null;
  var rs = null;
  var t0 = nowMs();
  var tOpen0 = t0;
  try {
    dao = new ActiveXObject("DAO.DBEngine.120");
    db = dao.OpenDatabase(dbPath, false, true);
    var openMs = nowMs() - tOpen0;
    var tQuery0 = nowMs();
    rs = db.OpenRecordset("SELECT Count(*) AS c FROM ScrapPiece WHERE inventoryTag='" + safeTag + "'");
    var c = 0;
    if (!rs.EOF) c = rs.Fields("c").Value;
    var queryMs = nowMs() - tQuery0;
    var tClose0 = nowMs();
    try { rs.Close(); } catch (_) {}
    try { db.Close(); } catch (_) {}
    var closeMs = nowMs() - tClose0;
    return { ok: true, exists: (c > 0), diag: { engine: "dao", openMs: openMs, queryMs: queryMs, closeMs: closeMs, totalMs: nowMs() - t0 } };
  } catch (e) {
    try { if (rs) rs.Close(); } catch (_) {}
    try { if (db) db.Close(); } catch (_) {}
    return { ok: false, error: "dao_failed: " + (e.message || e.description || e) };
  }
}

function runWithAccessApp(safeTag) {
  var app = null;
  var db = null;
  var rs = null;
  var t0 = nowMs();
  var tOpen0 = t0;
  try {
    app = new ActiveXObject("Access.Application");
    try { app.Visible = false; } catch (_) {}
    try { app.UserControl = false; } catch (_) {}
    app.OpenCurrentDatabase(dbPath, false);
    try { db = app.CurrentDb(); } catch (_) {}
    if (!db) { try { db = app.CurrentDb; } catch (_) {} }
    if (!db) {
      try { db = app.DBEngine.Workspaces(0).Databases(0); } catch (_) {}
    }
    if (!db) throw new Error("current_db_unavailable");
    var openMs = nowMs() - tOpen0;
    var tQuery0 = nowMs();
    rs = db.OpenRecordset("SELECT Count(*) AS c FROM ScrapPiece WHERE inventoryTag='" + safeTag + "'");
    var c = 0;
    if (!rs.EOF) c = rs.Fields("c").Value;
    var queryMs = nowMs() - tQuery0;
    var tClose0 = nowMs();
    try { rs.Close(); } catch (_) {}
    try { app.CloseCurrentDatabase(); } catch (_) {}
    try { app.Quit(2); } catch (_) {}
    var closeMs = nowMs() - tClose0;
    return { ok: true, exists: (c > 0), diag: { engine: "access_app", openMs: openMs, queryMs: queryMs, closeMs: closeMs, totalMs: nowMs() - t0 } };
  } catch (e) {
    try { if (rs) rs.Close(); } catch (_) {}
    try { if (app) app.Quit(2); } catch (_) {}
    return { ok: false, error: "access_app_failed: " + (e.message || e.description || e) };
  }
}

try {
  var safeTag = inventoryTag.replace(/'/g, "''");
  var result = runWithAdo(safeTag);
  if (!result.ok) result = runWithDao(safeTag);
  if (!result.ok) result = runWithAccessApp(safeTag);
  if (!result.ok) throw new Error(result.error || "exists_check_failed");
  WScript.Echo(
    '{"ok":true,"exists":' + (result.exists ? "true" : "false") +
    ',"diag":{"engine":' + toJsonStr(result.diag.engine) +
    ',"openMs":' + String(result.diag.openMs) +
    ',"queryMs":' + String(result.diag.queryMs) +
    ',"closeMs":' + String(result.diag.closeMs) +
    ',"totalMs":' + String(result.diag.totalMs) + "}}"
  );
  WScript.Quit(0);
} catch (ex) {
  WScript.Echo('{"ok":false,"error":' + toJsonStr(ex.message || ex) + "}");
  WScript.Quit(4);
}


