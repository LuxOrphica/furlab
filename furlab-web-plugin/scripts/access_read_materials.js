var fso = new ActiveXObject("Scripting.FileSystemObject");

function esc(s) {
  var src = String(s == null ? "" : s);
  var out = "";
  for (var i = 0; i < src.length; i++) {
    var ch = src.charAt(i);
    var code = src.charCodeAt(i);
    if (ch === "\\") {
      out += "\\\\";
    } else if (ch === '"') {
      out += '\\"';
    } else if (code === 8) {
      out += "\\b";
    } else if (code === 9) {
      out += "\\t";
    } else if (code === 10) {
      out += "\\n";
    } else if (code === 12) {
      out += "\\f";
    } else if (code === 13) {
      out += "\\r";
    } else if (code < 32 || code > 126) {
      var hex = code.toString(16).toUpperCase();
      while (hex.length < 4) hex = "0" + hex;
      out += "\\u" + hex;
    } else {
      out += ch;
    }
  }
  return out;
}

function writeError(error) {
  WScript.StdOut.Write('{"ok":false,"error":"' + esc(error) + '"}');
}

function writeItems(items) {
  var out = ['{"ok":true,"items":['];
  for (var i = 0; i < items.length; i++) {
    if (i > 0) out.push(",");
    var item = items[i] || {};
    out.push(
      '{"id":"' + esc(item.id || "") +
      '","name":"' + esc(item.name || "") +
      '","piecesCount":' + String(Number(item.piecesCount || 0) || 0) +
      "}"
    );
  }
  out.push("]}");
  WScript.StdOut.Write(out.join(""));
}

var dbPath = WScript.Arguments.length > 0 ? String(WScript.Arguments(0) || "") : "";
if (!dbPath || !fso.FileExists(dbPath)) {
  writeError("db_not_found");
  WScript.Quit(2);
}

var conn = null;
try {
  conn = new ActiveXObject("ADODB.Connection");
  conn.Open("Provider=Microsoft.ACE.OLEDB.12.0;Data Source=" + dbPath + ";Persist Security Info=False;");

  var sql = "SELECT fm.id AS materialId, fm.materialName, Count(sp.id) AS piecesCount " +
            "FROM FurMaterial AS fm " +
            "LEFT JOIN ScrapPiece AS sp ON sp.materialId = fm.id " +
            "GROUP BY fm.id, fm.materialName " +
            "ORDER BY fm.materialName, fm.id";
  var rs = conn.Execute(sql);
  var items = [];
  while (!rs.EOF) {
    var materialId = String(rs.Fields("materialId").Value || "");
    var materialName = String(rs.Fields("materialName").Value || "");
    if (!materialId) {
      rs.MoveNext();
      continue;
    }
    var piecesCount = Number(rs.Fields("piecesCount").Value || 0) || 0;
    items.push({
      id: materialId,
      name: materialName || materialId,
      piecesCount: piecesCount
    });
    rs.MoveNext();
  }
  try { rs.Close(); } catch (_) {}
  try { conn.Close(); } catch (_) {}
  writeItems(items);
  WScript.Quit(0);
} catch (e) {
  try { if (conn) conn.Close(); } catch (_) {}
  writeError(String(e && e.message ? e.message : e));
  WScript.Quit(1);
}
