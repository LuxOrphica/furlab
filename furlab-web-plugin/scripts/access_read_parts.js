var dbPath = WScript.Arguments.length > 0 ? WScript.Arguments(0) : "";
if (!dbPath) {
  WScript.Echo('{"ok":false,"error":"db_path_required"}');
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

function toJsonStr(s) { return '"' + esc(s) + '"'; }
function toJsonNum(v) { return (v === null || v === undefined || v === "") ? "null" : String(Number(v)); }

var daoDb = null;
try {
  var dao = new ActiveXObject("DAO.DBEngine.120");
  daoDb = dao.OpenDatabase(dbPath, false, true);
  var rs = daoDb.OpenRecordset("SELECT id, partNo, partName FROM Part ORDER BY partNo, partName;");
  var out = [];
  while (!rs.EOF) {
    out.push(
      "{" +
      '"id":' + toJsonStr(rs.Fields("id").Value || "") + "," +
      '"partNo":' + toJsonNum(rs.Fields("partNo").Value) + "," +
      '"partName":' + toJsonStr(rs.Fields("partName").Value || "") +
      "}"
    );
    rs.MoveNext();
  }
  rs.Close();
  daoDb.Close();
  WScript.Echo('{"ok":true,"items":[' + out.join(",") + ']}');
  WScript.Quit(0);
} catch (e) {
  try { if (daoDb) daoDb.Close(); } catch (_) {}
  WScript.Echo('{"ok":false,"error":"parts_read_failed","description":"' + esc(e.description || e.message || e) + '"}');
  WScript.Quit(2);
}
