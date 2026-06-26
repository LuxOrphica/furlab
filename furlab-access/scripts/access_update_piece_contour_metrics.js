var dbPath = WScript.Arguments.length > 0 ? WScript.Arguments(0) : "";
var jsonPath = WScript.Arguments.length > 1 ? WScript.Arguments(1) : "";
var logPath = WScript.Arguments.length > 2 ? WScript.Arguments(2) : "";

if (!dbPath || !jsonPath || !logPath) {
  WScript.Echo('{"ok":false,"error":"db_and_json_required"}');
  WScript.Quit(1);
}

var fso = new ActiveXObject("Scripting.FileSystemObject");
if (!fso.FileExists(dbPath)) {
  WScript.Echo('{"ok":false,"error":"db_not_found"}');
  WScript.Quit(2);
}
if (!fso.FileExists(jsonPath)) {
  WScript.Echo('{"ok":false,"error":"json_not_found"}');
  WScript.Quit(3);
}

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

function parseJsonCompat(text) {
  var src = String(text || "");
  if (!src) return [];
  if (typeof JSON !== "undefined" && JSON && typeof JSON.parse === "function") {
    return JSON.parse(src);
  }
  return eval("(" + src + ")");
}

function readTextUtf8(path) {
  var stm = new ActiveXObject("ADODB.Stream");
  stm.Type = 2;
  stm.Charset = "utf-8";
  stm.Open();
  stm.LoadFromFile(path);
  var data = stm.ReadText(-1);
  stm.Close();
  return data;
}

function openDb(path) {
  try {
    var dao = new ActiveXObject("DAO.DBEngine.120");
    return dao.OpenDatabase(path);
  } catch (_) {}
  try {
    var app = new ActiveXObject("Access.Application");
    try { app.Visible = false; } catch (_) {}
    try { app.UserControl = false; } catch (_) {}
    app.OpenCurrentDatabase(path, false);
    return app.CurrentDb();
  } catch (_) {}
  return null;
}

function escSqlText(s) {
  return String(s === null || s === undefined ? "" : s).replace(/'/g, "''");
}

var log = fso.OpenTextFile(logPath, 8, true);
log.WriteLine(new Date() + " START update_piece_contour_metrics");

var dataText = "";
try {
  dataText = readTextUtf8(jsonPath);
} catch (eRead) {
  log.WriteLine(new Date() + " READ_JSON_FAILED " + eRead.message);
  log.Close();
  WScript.Echo('{"ok":false,"error":"read_json_failed"}');
  WScript.Quit(4);
}

var items = null;
try {
  items = parseJsonCompat(dataText);
} catch (eParse) {
  log.WriteLine(new Date() + " PARSE_JSON_FAILED " + eParse.message);
  log.Close();
  WScript.Echo('{"ok":false,"error":"parse_json_failed"}');
  WScript.Quit(5);
}

if (!items || !items.length) {
  log.WriteLine(new Date() + " EMPTY_UPDATES");
  log.Close();
  WScript.Echo('{"ok":true,"updated":0,"missing":0,"failed":0}');
  WScript.Quit(0);
}

var db = openDb(dbPath);
if (!db) {
  log.WriteLine(new Date() + " DB_OPEN_FAILED");
  log.Close();
  WScript.Echo('{"ok":false,"error":"db_open_failed"}');
  WScript.Quit(6);
}

var updated = 0;
var missing = 0;
var failed = 0;

for (var i = 0; i < items.length; i++) {
  var it = items[i] || {};
  var id = String(it.id || "");
  var inventoryTag = String(it.inventoryTag || "");
  if (!id) {
    failed++;
    continue;
  }

  var where = inventoryTag
    ? ("[inventoryTag]='" + escSqlText(inventoryTag) + "'")
    : ("[id]='" + escSqlText(id) + "'");
  var rs = null;
  try {
    rs = db.OpenRecordset("SELECT * FROM ScrapPiece WHERE " + where);
    if (rs.EOF) {
      missing++;
      rs.Close();
      continue;
    }

    rs.Edit();
    rs.Fields("metricsJson").Value = String(it.metricsJson || "");
    rs.Fields("scrapContour").Value = String(it.scrapContour || "");

    if (it.napDirectionDeg === null || it.napDirectionDeg === undefined || it.napDirectionDeg === "") {
      rs.Fields("napDirectionDeg").Value = null;
    } else {
      rs.Fields("napDirectionDeg").Value = Number(it.napDirectionDeg);
    }

    try { rs.Fields("updatedAt").Value = new Date(); } catch (_) {}

    rs.Update();
    rs.Close();
    updated++;
  } catch (ex) {
    failed++;
    try { if (rs) rs.Close(); } catch (_) {}
    log.WriteLine(new Date() + " FAIL id=" + id + " " + ex.message);
  }
}

try { db.Close(); } catch (_) {}
log.WriteLine(new Date() + " DONE updated=" + updated + " missing=" + missing + " failed=" + failed);
log.Close();
WScript.Echo('{"ok":true,"updated":' + updated + ',"missing":' + missing + ',"failed":' + failed + '}');
WScript.Quit(0);


