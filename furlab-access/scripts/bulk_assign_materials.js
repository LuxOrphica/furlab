var dbPath = WScript.Arguments.length > 0 ? WScript.Arguments(0) : "";
if (!dbPath) {
  WScript.Echo('{"ok":false,"error":"db_path_required"}');
  WScript.Quit(1);
}

function esc(s) {
  return String(s === null || s === undefined ? "" : s).replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

function sqlGuidLike(v) {
  var s = String(v === null || v === undefined ? "" : v).replace(/^\s+|\s+$/g, "");
  if (!s) return "Null";
  var m = s.match(/[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}/);
  if (m) return "{guid {" + String(m[0]).toUpperCase() + "}}";
  var body = s.replace(/[{}]/g, "").replace(/^guid\s+/i, "").replace(/^\s+|\s+$/g, "");
  if (!body) return "Null";
  return "{guid {" + String(body).toUpperCase() + "}}";
}

var dao = null;
var db = null;
try {
  dao = new ActiveXObject("DAO.DBEngine.120");
  db = dao.OpenDatabase(dbPath, false, false);

  // Загрузить все материалы
  var rsMat = db.OpenRecordset("SELECT id FROM FurMaterial;");
  var materials = [];
  while (!rsMat.EOF) {
    materials.push(String(rsMat.Fields("id").Value || ""));
    rsMat.MoveNext();
  }
  rsMat.Close();

  if (materials.length === 0) {
    WScript.Echo('{"ok":false,"error":"no materials found"}');
    db.Close();
    WScript.Quit(1);
  }

  // Найти куски без материала
  var rs = db.OpenRecordset("SELECT id FROM ScrapPiece WHERE materialId IS NULL OR materialId='';");
  var ids = [];
  while (!rs.EOF) {
    ids.push(String(rs.Fields("id").Value || ""));
    rs.MoveNext();
  }
  rs.Close();

  if (ids.length === 0) {
    WScript.Echo('{"ok":true,"updated":0,"message":"all pieces already have material"}');
    db.Close();
    WScript.Quit(0);
  }

  var updated = 0;
  var errors = 0;

  for (var i = 0; i < ids.length; i++) {
    var matId = materials[Math.floor(Math.random() * materials.length)];
    try {
      db.Execute(
        "UPDATE ScrapPiece SET materialId=" + sqlGuidLike(matId) + ", updatedAt=Now() WHERE id=" + sqlGuidLike(ids[i]) + ";",
        128
      );
      updated++;
    } catch (e) {
      errors++;
    }
  }

  db.Close();
  WScript.Echo('{"ok":true,"updated":' + updated + ',"errors":' + errors + ',"total":' + ids.length + ',"materials":' + materials.length + '}');
  WScript.Quit(0);
} catch (e) {
  try { if (db) db.Close(); } catch (_) {}
  WScript.Echo('{"ok":false,"error":"' + esc(e.message || e.description) + '"}');
  WScript.Quit(1);
}
