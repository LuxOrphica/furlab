var dbPath = WScript.Arguments.length > 0 ? WScript.Arguments(0) : "";
var sqlPath = WScript.Arguments.length > 1 ? WScript.Arguments(1) : "";
var logPath = WScript.Arguments.length > 2 ? WScript.Arguments(2) : "";

if (!dbPath || !sqlPath || !logPath) {
  WScript.Echo("USAGE: cscript //nologo run_access_sql.js <dbPath> <sqlPath> <logPath>");
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

var txt = "";
try {
  var stm = new ActiveXObject("ADODB.Stream");
  stm.Type = 2; // adTypeText
  stm.Charset = "unicode";
  stm.Open();
  stm.LoadFromFile(sqlPath);
  txt = stm.ReadText(-1); // adReadAll
  stm.Close();
} catch (e1) {
  try {
    var stmUtf8 = new ActiveXObject("ADODB.Stream");
    stmUtf8.Type = 2; // adTypeText
    stmUtf8.Charset = "utf-8";
    stmUtf8.Open();
    stmUtf8.LoadFromFile(sqlPath);
    txt = stmUtf8.ReadText(-1);
    stmUtf8.Close();
  } catch (e2) {
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

var conn = new ActiveXObject("ADODB.Connection");
try {
  conn.Open("Provider=Microsoft.ACE.OLEDB.16.0;Data Source=" + dbPath + ";");
} catch (e1) {
  try {
    conn.Open("Provider=Microsoft.ACE.OLEDB.12.0;Data Source=" + dbPath + ";");
  } catch (e2) {
    WScript.Echo("OPEN_FAILED: " + e2.message);
    WScript.Quit(4);
  }
}

var parts = sql.split(";");
var ok = 0;
var err = 0;
var log = fso.OpenTextFile(logPath, 8, true);
log.WriteLine(new Date() + " START");

for (var j = 0; j < parts.length; j++) {
  var stmt = parts[j].replace(/^\s+|\s+$/g, "");
  if (stmt.length === 0) continue;
  try {
    conn.Execute(stmt);
    ok++;
  } catch (ex) {
    err++;
    log.WriteLine(new Date() + " ERR " + ex.message);
    log.WriteLine("SQL: " + stmt);
    log.WriteLine("-----");
  }
}

conn.Close();
log.WriteLine(new Date() + " DONE OK=" + ok + " ERR=" + err);
log.Close();
WScript.Echo("DONE OK=" + ok + " ERR=" + err + " LOG=" + logPath);
