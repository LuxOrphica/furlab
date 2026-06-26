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

function readTextUtf8(path) {
  var stm = new ActiveXObject("ADODB.Stream");
  stm.Type = 2; // adTypeText
  stm.Charset = "utf-8";
  stm.Open();
  stm.LoadFromFile(path);
  var data = stm.ReadText(-1);
  stm.Close();
  return data;
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
  if (!src) return {};
  if (typeof JSON !== "undefined" && JSON && typeof JSON.parse === "function") {
    return JSON.parse(src);
  }
  // Legacy WSH engines may not expose global JSON.
  return eval("(" + src + ")");
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

function normalizeGuidValue(v) {
  if (!isGuidLike(v)) return "";
  var s = normalizeGuidLike(v);
  if (!s) return "";
  return "{" + s.toUpperCase() + "}";
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

var log = fso.OpenTextFile(logPath, 8, true);
log.WriteLine(new Date() + " START update_piece_fields");

var txt = "";
try {
  txt = readTextUtf8(jsonPath);
} catch (e) {
  log.WriteLine(new Date() + " READ_JSON_FAILED " + e.message);
  log.Close();
  WScript.Echo('{"ok":false,"error":"read_json_failed"}');
  WScript.Quit(4);
}

var payload = null;
try {
  payload = parseJsonCompat(txt || "{}");
} catch (e2) {
  log.WriteLine(new Date() + " PARSE_JSON_FAILED " + e2.message);
  log.Close();
  WScript.Echo('{"ok":false,"error":"parse_json_failed"}');
  WScript.Quit(5);
}

var pieceId = String(payload.pieceId || "");
var materialId = String(payload.materialId || "");
var storageLocationId = String(payload.storageLocationId || "");
var scrapQuality = String(payload.scrapQuality || "");
var note = String(payload.note || "");

if (!pieceId) {
  log.WriteLine(new Date() + " MISSING pieceId");
  log.Close();
  WScript.Echo('{"ok":false,"error":"piece_id_required"}');
  WScript.Quit(6);
}

var db = openDb(dbPath);
if (!db) {
  log.WriteLine(new Date() + " DB_OPEN_FAILED");
  log.Close();
  WScript.Echo('{"ok":false,"error":"db_open_failed"}');
  WScript.Quit(7);
}

var guid = normalizeGuidValue(pieceId);
var where = "";
if (guid) {
  where = "[id]='" + guid.replace(/'/g, "''") + "'";
} else {
  where = "[inventoryTag]='" + pieceId.replace(/'/g, "''") + "'";
}

var step = "init";
var rs = null;
try {
  step = "open_recordset";
  rs = db.OpenRecordset("SELECT * FROM ScrapPiece WHERE " + where);
  if (rs.EOF) {
    rs.Close();
    log.WriteLine(new Date() + " NOT_FOUND");
    log.Close();
    WScript.Echo('{"ok":false,"error":"piece_not_found"}');
    WScript.Quit(8);
  }
  step = "edit";
  rs.Edit();
  step = "set_materialId";
  if (materialId) {
    rs.Fields("materialId").Value = normalizeGuidValue(materialId);
  } else {
    rs.Fields("materialId").Value = null;
  }
  step = "set_storageLocationId";
  if (storageLocationId) {
    rs.Fields("storageLocationId").Value = normalizeGuidValue(storageLocationId);
  } else {
    rs.Fields("storageLocationId").Value = null;
  }
  step = "set_scrapQuality";
  if (scrapQuality) {
    rs.Fields("scrapQuality").Value = scrapQuality;
  }
  step = "set_note";
  rs.Fields("note").Value = note;
  // Some DB variants store updatedAt as text and reject Date assignment.
  step = "set_updatedAt";
  try { rs.Fields("updatedAt").Value = new Date(); } catch (_) {}
  step = "update";
  rs.Update();
  step = "close";
  rs.Close();
  log.WriteLine(new Date() + " OK");
  log.Close();
  WScript.Echo('{"ok":true}');
  WScript.Quit(0);
} catch (ex) {
  try { rs.Close(); } catch (_) {}
  log.WriteLine(new Date() + " FAIL step=" + step + " " + ex.message);
  log.Close();
  WScript.Echo('{"ok":false,"error":"update_failed","step":' + toJsonStr(step) + ',"message":' + toJsonStr(ex.message || ex) + "}");
  WScript.Quit(9);
}


