var dbPath = WScript.Arguments.length > 0 ? WScript.Arguments(0) : "";
if (!dbPath) {
  WScript.Echo('{"ok":false,"error":"db_path_required"}');
  WScript.Quit(1);
}

function esc(s) {
  return String(s === null || s === undefined ? "" : s).replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

function trimStr(s) {
  return String(s === null || s === undefined ? "" : s).replace(/^\s+|\s+$/g, "");
}

function sqlGuidLike(v) {
  var s = trimStr(v);
  if (!s) return "Null";
  var m = s.match(/[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}/);
  if (m) return "{guid {" + String(m[0]).toUpperCase() + "}}";
  var body = trimStr(s.replace(/[{}]/g, "").replace(/^guid\s+/i, ""));
  if (!body) return "Null";
  return "{guid {" + String(body).toUpperCase() + "}}";
}

function newGuid() {
  try {
    var g = new ActiveXObject("Scriptlet.TypeLib").Guid;
    return String(g || "").replace(/[{}]/g, "").toUpperCase();
  } catch (_) {}
  function hex4() { return ("0000" + Math.floor(Math.random() * 65536).toString(16)).slice(-4).toUpperCase(); }
  return hex4()+hex4()+"-"+hex4()+"-"+hex4()+"-"+hex4()+"-"+hex4()+hex4()+hex4();
}

var dao = null;
var db = null;
try {
  dao = new ActiveXObject("DAO.DBEngine.120");
  db = dao.OpenDatabase(dbPath, false, false);

  // Найти все куски со статусом Reserved
  var rs = db.OpenRecordset("SELECT id, inventoryTag FROM ScrapPiece WHERE scrapStatus='Reserved';");
  var ids = [];
  while (!rs.EOF) {
    ids.push({ id: String(rs.Fields("id").Value || ""), tag: String(rs.Fields("inventoryTag").Value || "") });
    rs.MoveNext();
  }
  rs.Close();

  if (ids.length === 0) {
    WScript.Echo('{"ok":true,"released":0,"message":"no reserved pieces found"}');
    db.Close();
    WScript.Quit(0);
  }

  var released = 0;
  var txInserted = 0;
  var updateErrors = [];
  var txErrors = [];

  // Проверить поля ScrapTransaction
  var txFields = [];
  try {
    var rsTx = db.OpenRecordset("SELECT TOP 1 * FROM ScrapTransaction;");
    var flds = rsTx.Fields;
    for (var fi = 0; fi < flds.Count; fi++) {
      try { txFields.push(String(flds.Item(fi).Name)); } catch (_) {}
    }
    try { rsTx.Close(); } catch (_) {}
  } catch (_) {}

  for (var i = 0; i < ids.length; i++) {
    var pieceId = ids[i].id;
    var guidSql = sqlGuidLike(pieceId);
    // UPDATE
    try {
      db.Execute(
        "UPDATE ScrapPiece SET scrapStatus='Available', updatedAt=Now() WHERE id=" + guidSql + ";",
        128
      );
      released++;
    } catch (e1) {
      updateErrors.push(esc(e1.message || e1.description));
      continue;
    }
    // INSERT ScrapTransaction
    try {
      var newId = sqlGuidLike(newGuid());
      db.Execute(
        "INSERT INTO ScrapTransaction (id, scrapPieceId, transType, statusBefore, statusAfter, transAt, note, sourceRef) VALUES (" +
        newId + ", " + guidSql + ", 'Release', 'Reserved', 'Available', Now(), 'Bulk release', 'bulk-release-script');",
        128
      );
      txInserted++;
    } catch (e2) {
      txErrors.push(esc(e2.message || e2.description));
    }
  }

  db.Close();
  WScript.Echo(
    '{"ok":true,"released":' + released + ',"txInserted":' + txInserted +
    ',"total":' + ids.length +
    ',"txFields":' + JSON.stringify(txFields) +
    ',"updateErrors":' + JSON.stringify(updateErrors.slice(0,3)) +
    ',"txErrors":' + JSON.stringify(txErrors.slice(0,3)) + '}'
  );
  WScript.Quit(0);
} catch (e) {
  try { if (db) db.Close(); } catch (_) {}
  WScript.Echo('{"ok":false,"error":"' + esc(e.message || e.description) + '"}');
  WScript.Quit(1);
}
