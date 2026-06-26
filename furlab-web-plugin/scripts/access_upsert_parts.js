var dbPath = WScript.Arguments.length > 0 ? WScript.Arguments(0) : "";
var jsonPath = WScript.Arguments.length > 1 ? WScript.Arguments(1) : "";
if (!dbPath) {
  WScript.Echo('{"ok":false,"error":"db_path_required"}');
  WScript.Quit(1);
}
if (!jsonPath) {
  WScript.Echo('{"ok":false,"error":"json_path_required"}');
  WScript.Quit(1);
}

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

function sqlText(s) {
  return "'" + String(s || "").replace(/'/g, "''") + "'";
}

function newGuid() {
  var g = new ActiveXObject("Scriptlet.TypeLib").Guid;
  var s = String(g || "").toUpperCase();
  var m = s.match(/[0-9A-F]{8}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{12}/);
  if (!m) return "{00000000-0000-0000-0000-000000000000}";
  return "{" + m[0] + "}";
}

function readUtf8(path) {
  var stm = new ActiveXObject("ADODB.Stream");
  stm.Type = 2;
  stm.Charset = "utf-8";
  stm.Open();
  stm.LoadFromFile(path);
  var txt = stm.ReadText();
  stm.Close();
  return txt;
}

var daoDb = null;
try {
  var jsonText = readUtf8(jsonPath) || "{}";
  var payload = eval("(" + jsonText + ")");
  var parts = payload && payload.parts && payload.parts.length ? payload.parts : [];

  var dao = new ActiveXObject("DAO.DBEngine.120");
  daoDb = dao.OpenDatabase(dbPath, false, false);

  var rsMax = daoDb.OpenRecordset("SELECT MAX(partNo) AS maxNo FROM Part;");
  var nextPartNo = Number(rsMax.Fields("maxNo").Value || 0) + 1;
  rsMax.Close();

  var created = 0;
  var skipped = 0;
  var errors = 0;
  var itemRows = [];

  for (var i = 0; i < parts.length; i++) {
    var rec = parts[i] || {};
    var partName = String(rec.partName || "").replace(/^\s+|\s+$/g, "");
    var sourcePath = String(rec.sourcePath || "");
    if (!partName) {
      skipped++;
      itemRows.push('{"partName":"","sourcePath":"' + esc(sourcePath) + '","status":"skipped_empty_name"}');
      continue;
    }

    var rsExists = daoDb.OpenRecordset("SELECT TOP 1 id FROM Part WHERE partName=" + sqlText(partName) + ";");
    var exists = !rsExists.EOF;
    rsExists.Close();
    if (exists) {
      skipped++;
      itemRows.push('{"partName":"' + esc(partName) + '","sourcePath":"' + esc(sourcePath) + '","status":"skipped_exists"}');
      continue;
    }

    try {
      var guid = newGuid();
      var sql =
        "INSERT INTO Part (id, partNo, partName) VALUES (" +
        sqlText(guid) + ", " + String(nextPartNo) + ", " + sqlText(partName) + ");";
      daoDb.Execute(sql);
      created++;
      itemRows.push('{"partName":"' + esc(partName) + '","sourcePath":"' + esc(sourcePath) + '","status":"created","partNo":' + String(nextPartNo) + '}');
      nextPartNo++;
    } catch (oneErr) {
      errors++;
      itemRows.push('{"partName":"' + esc(partName) + '","sourcePath":"' + esc(sourcePath) + '","status":"error","error":"' + esc(oneErr.description || oneErr.message || oneErr) + '"}');
    }
  }

  daoDb.Close();
  WScript.Echo(
    '{"ok":true,"created":' + String(created) + ',"skipped":' + String(skipped) + ',"errors":' + String(errors) + ',"items":[' + itemRows.join(",") + ']}'
  );
  WScript.Quit(0);
} catch (e) {
  try { if (daoDb) daoDb.Close(); } catch (_) {}
  WScript.Echo('{"ok":false,"error":"parts_upsert_failed","description":"' + esc(e.description || e.message || e) + '"}');
  WScript.Quit(2);
}
