var dbPath = WScript.Arguments.length > 0 ? WScript.Arguments(0) : "";
var migrationsDirArg = WScript.Arguments.length > 1 ? WScript.Arguments(1) : "";
var modeArg = WScript.Arguments.length > 2 ? String(WScript.Arguments(2) || "") : "";

var fso = new ActiveXObject("Scripting.FileSystemObject");

var scriptDir = fso.GetParentFolderName(WScript.ScriptFullName);
var rootDir = fso.GetParentFolderName(scriptDir);
var migrationsDir = migrationsDirArg || fso.BuildPath(rootDir, "sql");
try { migrationsDir = fso.GetAbsolutePathName(migrationsDir); } catch (_) {}

function resolveDefaultDbPath() {
  function tryPath(p) {
    try {
      if (fso.FileExists(p)) return fso.GetAbsolutePathName(p);
    } catch (_) {}
    return "";
  }
  var p1 = tryPath(fso.BuildPath(fso.BuildPath(rootDir, "БД"), "Furlab 1.accdb"));
  if (p1) return p1;
  var folder = fso.GetFolder(rootDir);
  var stack = [folder];
  while (stack.length > 0) {
    var cur = stack.pop();
    var files = new Enumerator(cur.Files);
    for (; !files.atEnd(); files.moveNext()) {
      var file = files.item();
      var n = String(file.Name || "").toLowerCase();
      if (/\.accdb$/i.test(n)) return String(file.Path || "");
    }
    var dirs = new Enumerator(cur.SubFolders);
    for (; !dirs.atEnd(); dirs.moveNext()) stack.push(dirs.item());
  }
  return "";
}

if (!dbPath) {
  dbPath = resolveDefaultDbPath();
}
if (!dbPath) {
  WScript.Echo('{"ok":false,"error":"db_path_required_or_not_found"}');
  WScript.Quit(1);
}
try { dbPath = fso.GetAbsolutePathName(dbPath); } catch (_) {}

var app = null;
var daoDb = null;
var daoEngine = null;

function esc(s) {
  if (s === null || s === undefined) return "";
  return String(s).replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

function escSqlText(s) {
  return String(s === null || s === undefined ? "" : s).replace(/'/g, "''");
}

function openDb(path) {
  try {
    daoEngine = new ActiveXObject("DAO.DBEngine.120");
    daoDb = daoEngine.OpenDatabase(path);
    return daoDb;
  } catch (_) {}
  app = new ActiveXObject("Access.Application");
  try { app.Visible = false; } catch (_) {}
  try { app.UserControl = false; } catch (_) {}
  app.OpenCurrentDatabase(path, false);
  var db = null;
  try { db = app.CurrentDb(); } catch (_) {}
  if (!db) { try { db = app.CurrentDb; } catch (_) {} }
  if (!db) throw new Error("current_db_unavailable");
  return db;
}

function resolveWorkspace(db) {
  try { if (db && db.Workspace) return db.Workspace; } catch (_) {}
  try { if (app && app.DBEngine) return app.DBEngine.Workspaces(0); } catch (_) {}
  try { if (daoEngine) return daoEngine.Workspaces(0); } catch (_) {}
  return null;
}

function tableExists(db, tableName) {
  var want = String(tableName || "").toLowerCase();
  try {
    for (var i = 0; i < db.TableDefs.Count; i++) {
      var td = db.TableDefs(i);
      if (String(td.Name || "").toLowerCase() === want) return true;
    }
  } catch (_) {}
  return false;
}

function ensureMigrationsTable(db) {
  if (!tableExists(db, "SchemaMigrations")) {
    db.Execute(
      "CREATE TABLE SchemaMigrations (" +
      "id COUNTER CONSTRAINT pk_schemamigrations PRIMARY KEY, " +
      "fileName TEXT(255) NOT NULL, " +
      "appliedAt DATETIME NOT NULL, " +
      "notes LONGTEXT" +
      ");",
      128
    );
  }
  try {
    db.Execute("CREATE UNIQUE INDEX ux_schemamigrations_filename ON SchemaMigrations (fileName);", 128);
  } catch (_) {}
}

function migrationApplied(db, fileName) {
  var rs = db.OpenRecordset("SELECT COUNT(*) AS c FROM SchemaMigrations WHERE fileName='" + escSqlText(fileName) + "';");
  var c = 0;
  try { c = Number(rs.Fields("c").Value || 0); } catch (_) {}
  try { rs.Close(); } catch (_) {}
  return c > 0;
}

function readText(path) {
  try {
    var stm8 = new ActiveXObject("ADODB.Stream");
    stm8.Type = 2; // adTypeText
    stm8.Charset = "utf-8";
    stm8.Open();
    stm8.LoadFromFile(path);
    var t8 = stm8.ReadText(-1);
    stm8.Close();
    return t8;
  } catch (_) {}
  try {
    var stm = new ActiveXObject("ADODB.Stream");
    stm.Type = 2; // adTypeText
    stm.Charset = "unicode";
    stm.Open();
    stm.LoadFromFile(path);
    var t = stm.ReadText(-1);
    stm.Close();
    return t;
  } catch (_) {}
  var ts = fso.OpenTextFile(path, 1, false);
  var txt = ts.ReadAll();
  ts.Close();
  return txt;
}

function splitSqlStatements(sqlText) {
  var lines = String(sqlText || "").replace(/\r\n/g, "\n").replace(/\r/g, "\n").split("\n");
  var cleaned = [];
  for (var i = 0; i < lines.length; i++) {
    var t = lines[i].replace(/^\s+/, "");
    if (t.indexOf("--") === 0) continue;
    cleaned.push(lines[i]);
  }
  var raw = cleaned.join("\n").split(";");
  var out = [];
  for (var j = 0; j < raw.length; j++) {
    var stmt = String(raw[j] || "").replace(/^\s+|\s+$/g, "");
    if (stmt) out.push(stmt);
  }
  return out;
}

function listMigrationFiles(dirPath) {
  if (!fso.FolderExists(dirPath)) return [];
  var folder = fso.GetFolder(dirPath);
  var e = new Enumerator(folder.Files);
  var arr = [];
  for (; !e.atEnd(); e.moveNext()) {
    var file = e.item();
    var name = String(file.Name || "");
    if (/^\d+_.+\.sql$/i.test(name)) {
      arr.push({ name: name, path: String(file.Path || "") });
    }
  }
  arr.sort(function (a, b) {
    var x = String(a.name || "").toLowerCase();
    var y = String(b.name || "").toLowerCase();
    if (x < y) return -1;
    if (x > y) return 1;
    return 0;
  });
  return arr;
}

function toJsonStringArray(arr) {
  var out = [];
  for (var i = 0; i < arr.length; i++) out.push('"' + esc(arr[i]) + '"');
  return "[" + out.join(",") + "]";
}

function markApplied(db, fileName, note) {
  db.Execute(
    "INSERT INTO SchemaMigrations (fileName, appliedAt, notes) VALUES (" +
    "'" + escSqlText(fileName) + "', Now(), '" + escSqlText(note || "") + "');",
    128
  );
}

try {
  var db = openDb(dbPath);
  var ws = resolveWorkspace(db);
  ensureMigrationsTable(db);

  var files = listMigrationFiles(migrationsDir);
  var applied = [];
  var skipped = [];
  var failed = [];
  var baseline = [];
  var mode = String(modeArg || "").toLowerCase();
  var baselineMode = (mode === "baseline" || mode === "--baseline");

  if (baselineMode) {
    for (var b = 0; b < files.length; b++) {
      var bf = files[b];
      if (migrationApplied(db, bf.name)) {
        skipped.push(bf.name);
        continue;
      }
      try {
        markApplied(db, bf.name, "baseline_mark_only");
        baseline.push(bf.name);
      } catch (be) {
        failed.push({ file: bf.name, error: String(be && (be.message || be.description) || be) });
        break;
      }
    }
    var baseFailItems = [];
    for (var bi = 0; bi < failed.length; bi++) {
      baseFailItems.push(
        '{"file":"' + esc(failed[bi].file) + '","error":"' + esc(failed[bi].error) + '"}'
      );
    }
    WScript.Echo(
      '{"ok":' + (failed.length === 0 ? "true" : "false") +
      ',"mode":"baseline"' +
      ',"dbPath":"' + esc(dbPath) + '"' +
      ',"migrationsDir":"' + esc(migrationsDir) + '"' +
      ',"baselineCount":' + baseline.length +
      ',"skippedCount":' + skipped.length +
      ',"failedCount":' + failed.length +
      ',"baseline":' + toJsonStringArray(baseline) +
      ',"skipped":' + toJsonStringArray(skipped) +
      ',"failed":[' + baseFailItems.join(",") + "]" +
      "}"
    );
    try { if (daoDb) daoDb.Close(); } catch (_) {}
    try { if (app) { app.CloseCurrentDatabase(); app.Quit(2); } } catch (_) {}
    WScript.Quit(failed.length === 0 ? 0 : 2);
  }

  for (var i = 0; i < files.length; i++) {
    var f = files[i];
    if (migrationApplied(db, f.name)) {
      skipped.push(f.name);
      continue;
    }

    var stmts = splitSqlStatements(readText(f.path));
    var txStarted = false;
    try {
      if (ws) {
        ws.BeginTrans();
        txStarted = true;
      }
      for (var s = 0; s < stmts.length; s++) {
        db.Execute(stmts[s], 128);
      }
      markApplied(db, f.name, "applied_by_access_apply_migrations");
      if (txStarted && ws) {
        ws.CommitTrans();
        txStarted = false;
      }
      applied.push(f.name);
    } catch (e) {
      if (txStarted && ws) {
        try { ws.Rollback(); } catch (_) {}
      }
      failed.push({ file: f.name, error: String(e && (e.message || e.description) || e) });
      break;
    }
  }

  var failItems = [];
  for (var j = 0; j < failed.length; j++) {
    failItems.push(
      '{"file":"' + esc(failed[j].file) + '","error":"' + esc(failed[j].error) + '"}'
    );
  }

  WScript.Echo(
    '{"ok":' + (failed.length === 0 ? "true" : "false") +
    ',"dbPath":"' + esc(dbPath) + '"' +
    ',"migrationsDir":"' + esc(migrationsDir) + '"' +
    ',"appliedCount":' + applied.length +
    ',"skippedCount":' + skipped.length +
    ',"failedCount":' + failed.length +
    ',"applied":' + toJsonStringArray(applied) +
    ',"skipped":' + toJsonStringArray(skipped) +
    ',"failed":[' + failItems.join(",") + "]" +
    "}"
  );

  try { if (daoDb) daoDb.Close(); } catch (_) {}
  try { if (app) { app.CloseCurrentDatabase(); app.Quit(2); } } catch (_) {}
  WScript.Quit(failed.length === 0 ? 0 : 2);
} catch (e) {
  try { if (daoDb) daoDb.Close(); } catch (_) {}
  try { if (app) { app.CloseCurrentDatabase(); app.Quit(2); } } catch (_) {}
  WScript.Echo('{"ok":false,"error":"' + esc(e.message || e.description || e) + '"}');
  WScript.Quit(3);
}
