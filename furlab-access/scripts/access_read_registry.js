var dbPath = WScript.Arguments.length > 0 ? WScript.Arguments(0) : "";
var includeNote = WScript.Arguments.length > 1 ? String(WScript.Arguments(1)) : "0";
if (!dbPath) {
  WScript.Echo('{"ok":false,"error":"db_path_required"}');
  WScript.Quit(1);
}

var daoDb = null;
var adoConn = null;
var tScriptStart = new Date().getTime();
var tOpenStart = tScriptStart;
var tQueryStart = 0;
var tEncodeStart = 0;
var daoOpenErr = "";
var adoOpenErr = "";
var daoOpenCode = 0;
var adoOpenCode = 0;

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

function toJsonValue(v) {
  if (v === null || v === undefined) return "null";
  if (typeof v === "number") return isFinite(v) ? String(v) : "null";
  if (typeof v === "boolean") return v ? "true" : "false";
  if (v instanceof Date) return toJsonStr(v.toISOString());
  return toJsonStr(String(v));
}

function rowsFromRecordset(rs, fields) {
  var out = [];
  var count = 0;
  while (!rs.EOF) {
    var obj = [];
    for (var i = 0; i < fields.length; i++) {
      var f = fields[i];
      var v = rs.Fields(f).Value;
      obj.push(toJsonStr(f) + ":" + toJsonValue(v));
    }
    out.push("{" + obj.join(",") + "}");
    count++;
    rs.MoveNext();
  }
  rs.Close();
  return { json: "[" + out.join(",") + "]", count: count };
}

function queryRowsDb(db, sql, fields) {
  var rs = db.OpenRecordset(sql);
  return rowsFromRecordset(rs, fields);
}

function queryRowsAdo(conn, sql, fields) {
  var rs = new ActiveXObject("ADODB.Recordset");
  rs.Open(sql, conn, 0, 1);
  return rowsFromRecordset(rs, fields);
}

try {
  var db = null;
  var engine = "";
  try {
    var dao = new ActiveXObject("DAO.DBEngine.120");
    daoDb = dao.OpenDatabase(dbPath, false, true);
    db = daoDb;
    engine = "dao";
  } catch (daoErr) {
    daoOpenErr = String(daoErr && (daoErr.message || daoErr.description || daoErr));
    daoOpenCode = Number(daoErr && daoErr.number || 0);
  }

  if (!db) {
    try {
      adoConn = new ActiveXObject("ADODB.Connection");
      adoConn.Open("Provider=Microsoft.ACE.OLEDB.12.0;Data Source=" + dbPath + ";Persist Security Info=False;");
      engine = "ado";
    } catch (adoErr) {
      adoOpenErr = String(adoErr && (adoErr.message || adoErr.description || adoErr));
      adoOpenCode = Number(adoErr && adoErr.number || 0);
      adoConn = null;
    }
  }
  if (!db && !adoConn) throw new Error("current_db_unavailable");
  var openMs = new Date().getTime() - tOpenStart;

  var sql =
    "SELECT " +
    "id, inventoryTag, materialId, storageLocationId, scrapQuality, scrapStatus, " +
    "areaMm2, maxSpanMm, napDirectionDeg, updatedAt" +
    (includeNote === "1" ? ", [note] " : " ") +
    "FROM ScrapPiece;";
  var fields = [
    "id",
    "inventoryTag",
    "materialId",
    "storageLocationId",
    "scrapQuality",
    "scrapStatus",
    "areaMm2",
    "maxSpanMm",
    "napDirectionDeg",
    "updatedAt"
  ];
  if (includeNote === "1") fields.push("note");
  tQueryStart = new Date().getTime();
  var query = db ? queryRowsDb(db, sql, fields) : queryRowsAdo(adoConn, sql, fields);
  var queryMs = new Date().getTime() - tQueryStart;
  tEncodeStart = new Date().getTime();
  var items = query.json;
  var encodeMs = new Date().getTime() - tEncodeStart;
  var beforeCloseMs = new Date().getTime() - tScriptStart;
  var tClose0 = new Date().getTime();
  try { if (daoDb) daoDb.Close(); } catch (_) {}
  try { if (adoConn) adoConn.Close(); } catch (_) {}
  var closeMs = new Date().getTime() - tClose0;
  var totalMs = new Date().getTime() - tScriptStart;
  var out = '{"ok":true,"items":' + items + ',"diag":{"engine":' + toJsonStr(engine) + ',"openMs":' + String(openMs) + ',"queryMs":' + String(queryMs) + ',"encodeMs":' + String(encodeMs) + ',"closeMs":' + String(closeMs) + ',"rows":' + String(query.count) + ',"beforeCloseMs":' + String(beforeCloseMs) + ',"totalMs":' + String(totalMs) + ',"daoOpenErr":' + toJsonStr(daoOpenErr) + ',"adoOpenErr":' + toJsonStr(adoOpenErr) + ',"accessOpenErr":""}}';
  WScript.Echo(out);
  WScript.Quit(0);
} catch (e) {
  try {
    if (daoDb) daoDb.Close();
    if (adoConn) adoConn.Close();
  } catch (q) {}
  WScript.Echo(
    '{"ok":false,"error":"registry_open_or_query_failed","number":"' + esc(e.number) + '","description":"' + esc(e.description) +
    '","diag":{"daoOpenCode":' + String(daoOpenCode) + ',"adoOpenCode":' + String(adoOpenCode) + ',"accessOpenCode":0' +
    ',"daoOpenErr":' + toJsonStr(daoOpenErr) + ',"adoOpenErr":' + toJsonStr(adoOpenErr) + ',"accessOpenErr":""}}'
  );
  WScript.Quit(2);
}


