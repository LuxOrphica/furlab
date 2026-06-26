var dbPath = WScript.Arguments.length > 0 ? WScript.Arguments(0) : "";
var sqlPath = WScript.Arguments.length > 1 ? WScript.Arguments(1) : "";
var logPath = WScript.Arguments.length > 2 ? WScript.Arguments(2) : "";

if (!dbPath || !sqlPath || !logPath) {
  WScript.Echo("USAGE: cscript //nologo run_access_sql_via_access.js <dbPath> <sqlPath> <logPath>");
  WScript.Quit(1);
}

var fso = new ActiveXObject("Scripting.FileSystemObject");
if (!fso.FileExists(dbPath)) {
  WScript.Echo("DB_NOT_FOUND: " + dbPath);
  WScript.Quit(2);
}
if (!fso.FileExists(sqlPath)) {
  WScript.Echo("SQL_NOT_FOUND: " + sqlPath);
  WScript.Quit(3);
}

function readTextUtf8(path) {
  var stm = new ActiveXObject("ADODB.Stream");
  stm.Type = 2; // adTypeText
  stm.Charset = "unicode";
  stm.Open();
  stm.LoadFromFile(path);
  var data = stm.ReadText(-1); // adReadAll
  stm.Close();
  return data;
}

function nowMs() {
  return new Date().getTime();
}

function trimText(s) {
  return String(s || "")
    .replace(/^\uFEFF/, "")
    .replace(/^\s+|\s+$/g, "");
}

var txt = "";
try {
  txt = readTextUtf8(sqlPath);
} catch (utfErr) {
  try {
    var stmUtf8 = new ActiveXObject("ADODB.Stream");
    stmUtf8.Type = 2; // adTypeText
    stmUtf8.Charset = "utf-8";
    stmUtf8.Open();
    stmUtf8.LoadFromFile(sqlPath);
    txt = stmUtf8.ReadText(-1);
    stmUtf8.Close();
  } catch (_) {
    // Fallback: if ADODB.Stream is unavailable, read with default encoding.
    var ts = fso.OpenTextFile(sqlPath, 1, false);
    txt = ts.ReadAll();
    ts.Close();
  }
}

var lines = txt.replace(/\r\n/g, "\n").replace(/\r/g, "\n").split("\n");
var cleaned = [];
for (var i = 0; i < lines.length; i++) {
  var t = lines[i].replace(/^\s+/, "");
  if (t.indexOf("--") !== 0) {
    cleaned.push(lines[i]);
  }
}
var sql = cleaned.join("\n");
var parts = sql.split(";");

var log = fso.OpenTextFile(logPath, 8, true);
var engine = "";
var ok = 0;
var err = 0;
var openMs = 0;
var execMs = 0;
var closeMs = 0;
var attempts = [];

function runStatementsWithAdo() {
  var conn = null;
  var tOpen0 = nowMs();
  try {
    conn = new ActiveXObject("ADODB.Connection");
    conn.Open("Provider=Microsoft.ACE.OLEDB.12.0;Data Source=" + dbPath + ";Persist Security Info=False;");
  } catch (eOpen) {
    attempts.push("ado_open_failed: " + (eOpen.message || eOpen.description || eOpen));
    try { if (conn) conn.Close(); } catch (_) {}
    return false;
  }
  openMs = nowMs() - tOpen0;
  engine = "ado";
  var tExec0 = nowMs();
  for (var j = 0; j < parts.length; j++) {
    var stmt = trimText(parts[j]);
    if (!stmt) continue;
    try {
      conn.Execute(stmt);
      ok++;
    } catch (ex) {
      err++;
      try {
        log.WriteLine(new Date() + " ERR " + (ex.message || ex.description || ex));
        log.WriteLine("SQL: " + stmt);
        log.WriteLine("-----");
      } catch (_) {}
    }
  }
  execMs = nowMs() - tExec0;
  var tClose0 = nowMs();
  try { conn.Close(); } catch (_) {}
  closeMs = nowMs() - tClose0;
  return true;
}

function runStatementsWithDao() {
  var dao = null;
  var db = null;
  var tOpen0 = nowMs();
  try {
    dao = new ActiveXObject("DAO.DBEngine.120");
    db = dao.OpenDatabase(dbPath, false, false);
  } catch (eOpen) {
    attempts.push("dao_open_failed: " + (eOpen.message || eOpen.description || eOpen));
    try { if (db) db.Close(); } catch (_) {}
    return false;
  }
  openMs = nowMs() - tOpen0;
  engine = "dao";
  var tExec0 = nowMs();
  for (var j = 0; j < parts.length; j++) {
    var stmt = trimText(parts[j]);
    if (!stmt) continue;
    try {
      db.Execute(stmt, 128); // dbFailOnError
      ok++;
    } catch (ex) {
      err++;
      try {
        log.WriteLine(new Date() + " ERR " + (ex.message || ex.description || ex));
        log.WriteLine("SQL: " + stmt);
        log.WriteLine("-----");
      } catch (_) {}
    }
  }
  execMs = nowMs() - tExec0;
  var tClose0 = nowMs();
  try { db.Close(); } catch (_) {}
  closeMs = nowMs() - tClose0;
  return true;
}

function runStatementsWithAccessApp() {
  var app = null;
  var db = null;
  var tOpen0 = nowMs();
  try {
    app = new ActiveXObject("Access.Application");
    try { app.Visible = false; } catch (_) {}
    try { app.UserControl = false; } catch (_) {}
    app.OpenCurrentDatabase(dbPath, false);
    db = app.CurrentDb();
  } catch (eOpen) {
    attempts.push("access_app_open_failed: " + (eOpen.message || eOpen.description || eOpen));
    try { if (app) app.Quit(2); } catch (_) {}
    return false;
  }
  openMs = nowMs() - tOpen0;
  engine = "access_app";
  var tExec0 = nowMs();
  for (var j = 0; j < parts.length; j++) {
    var stmt = trimText(parts[j]);
    if (!stmt) continue;
    try {
      db.Execute(stmt, 128); // dbFailOnError
      ok++;
    } catch (ex) {
      err++;
      try {
        log.WriteLine(new Date() + " ERR " + (ex.message || ex.description || ex));
        log.WriteLine("SQL: " + stmt);
        log.WriteLine("-----");
      } catch (_) {}
    }
  }
  execMs = nowMs() - tExec0;
  var tClose0 = nowMs();
  try { app.CloseCurrentDatabase(); } catch (_) {}
  try { app.Quit(2); } catch (_) {}
  closeMs = nowMs() - tClose0;
  return true;
}

log.WriteLine(new Date() + " START sql_runner");

var started = false;
if (!started) started = runStatementsWithAdo();
if (!started) started = runStatementsWithDao();
if (!started) started = runStatementsWithAccessApp();

if (!started) {
  log.WriteLine(new Date() + " FATAL cannot open DB with any engine");
  if (attempts.length > 0) log.WriteLine("ATTEMPTS: " + attempts.join(" | "));
  log.Close();
  WScript.Echo("OPEN_DB_FAILED LOG=" + logPath);
  WScript.Quit(4);
}

log.WriteLine(new Date() + " ENGINE " + engine + " openMs=" + openMs + " execMs=" + execMs + " closeMs=" + closeMs);
if (attempts.length > 0) log.WriteLine("ATTEMPTS: " + attempts.join(" | "));
log.WriteLine(new Date() + " DONE OK=" + ok + " ERR=" + err);
log.Close();
WScript.Echo("DONE ENGINE=" + engine + " OK=" + ok + " ERR=" + err + " openMs=" + openMs + " execMs=" + execMs + " closeMs=" + closeMs + " LOG=" + logPath);


