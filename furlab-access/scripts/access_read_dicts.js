var dbPath = WScript.Arguments.length > 0 ? WScript.Arguments(0) : "";
if (!dbPath) {
  WScript.Echo('{"ok":false,"error":"db_path_required"}');
  WScript.Quit(1);
}

var app = null;
var daoDb = null;
var adoConn = null;

function esc(s) {
  if (s === null || s === undefined) return "";
  var src = String(s);
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

function toJsonStr(s) {
  return '"' + esc(s) + '"';
}

function readRows(db, sql, fields) {
  var arr = [];
  var rs = db.OpenRecordset(sql);
  while (!rs.EOF) {
    var objParts = [];
    for (var i = 0; i < fields.length; i++) {
      var f = fields[i];
      var v = rs.Fields(f).Value;
      if (v === null || v === undefined) {
        objParts.push(toJsonStr(f) + ":null");
      } else {
        objParts.push(toJsonStr(f) + ":" + toJsonStr(v));
      }
    }
    arr.push("{" + objParts.join(",") + "}");
    rs.MoveNext();
  }
  rs.Close();
  return "[" + arr.join(",") + "]";
}

function readRowsAdo(conn, sql, fields) {
  var arr = [];
  var rs = new ActiveXObject("ADODB.Recordset");
  rs.Open(sql, conn, 0, 1); // adOpenForwardOnly, adLockReadOnly
  while (!rs.EOF) {
    var objParts = [];
    for (var i = 0; i < fields.length; i++) {
      var f = fields[i];
      var v = rs.Fields(f).Value;
      if (v === null || v === undefined) {
        objParts.push(toJsonStr(f) + ":null");
      } else {
        objParts.push(toJsonStr(f) + ":" + toJsonStr(v));
      }
    }
    arr.push("{" + objParts.join(",") + "}");
    rs.MoveNext();
  }
  rs.Close();
  return "[" + arr.join(",") + "]";
}

function tryReadRows(db, variants, fields, errPrefix) {
  var lastErr = null;
  for (var i = 0; i < variants.length; i++) {
    try {
      return readRows(db, variants[i], fields);
    } catch (e) {
      lastErr = e;
    }
  }
  throw new Error(errPrefix + ": " + (lastErr && (lastErr.message || lastErr.description || lastErr) || "unknown"));
}

function tryReadRowsAny(db, conn, variants, fields, errPrefix) {
  var lastErr = null;
  for (var i = 0; i < variants.length; i++) {
    try {
      if (db) return readRows(db, variants[i], fields);
      if (conn) return readRowsAdo(conn, variants[i], fields);
      throw new Error("no_db_connection");
    } catch (e) {
      lastErr = e;
    }
  }
  throw new Error(errPrefix + ": " + (lastErr && (lastErr.message || lastErr.description || lastErr) || "unknown"));
}

function resolveDbFromAccessApp(appObj) {
  var db = null;
  try { db = appObj.CurrentDb(); } catch (_) {}
  if (!db) { try { db = appObj.CurrentDb; } catch (_) {} }
  if (!db) {
    try {
      db = appObj.DBEngine.Workspaces(0).Databases(0);
    } catch (_) {}
  }
  return db;
}

try {
  var db = null;
  try {
    var dao = new ActiveXObject("DAO.DBEngine.120");
    daoDb = dao.OpenDatabase(dbPath, false, true);
    db = daoDb;
  } catch (daoErr) {}

  if (!db) {
    app = new ActiveXObject("Access.Application");
    try { app.Visible = false; } catch (_) {}
    try { app.UserControl = false; } catch (_) {}
    app.OpenCurrentDatabase(dbPath, false);
    db = resolveDbFromAccessApp(app);
  }
  if (!db) {
    try {
      adoConn = new ActiveXObject("ADODB.Connection");
      adoConn.Open("Provider=Microsoft.ACE.OLEDB.12.0;Data Source=" + dbPath + ";Persist Security Info=False;");
    } catch (adoErr) {}
  }
  if (!db && !adoConn) throw new Error("current_db_unavailable");

  var materials;
  var locations;
  var qualities;
  var statuses;
  materials = tryReadRowsAny(
    db,
    adoConn,
    [
      "SELECT [id] AS idVal, [materialName] FROM FurMaterial WHERE [materialName] Is Not Null ORDER BY [materialName];",
      "SELECT [id] AS idVal, [name] AS materialName FROM FurMaterial WHERE [name] Is Not Null ORDER BY [name];"
    ],
    ["idVal", "materialName"],
    "materials_query_failed"
  );

  locations = tryReadRowsAny(
    db,
    adoConn,
    [
      "SELECT [id] AS idVal, [locCode] FROM StorageLocation WHERE [locCode] Is Not Null ORDER BY [locCode];",
      "SELECT [id] AS idVal, [code] AS locCode FROM StorageLocation WHERE [code] Is Not Null ORDER BY [code];",
      "SELECT [id] AS idVal, locationCode AS locCode FROM StorageLocation WHERE locationCode Is Not Null ORDER BY locationCode;"
    ],
    ["idVal", "locCode"],
    "locations_query_failed"
  );
  try {
    qualities = db
      ? readRows(db, "SELECT code, descr FROM ScrapQualityDict ORDER BY code;", ["code", "descr"])
      : readRowsAdo(adoConn, "SELECT code, descr FROM ScrapQualityDict ORDER BY code;", ["code", "descr"]);
  } catch (qErr) {
    throw new Error("qualities_query_failed: " + (qErr.message || qErr.description || qErr));
  }
  try {
    statuses = db
      ? readRows(db, "SELECT code, descr FROM ScrapStatusDict ORDER BY code;", ["code", "descr"])
      : readRowsAdo(adoConn, "SELECT code, descr FROM ScrapStatusDict ORDER BY code;", ["code", "descr"]);
  } catch (sErr) {
    throw new Error("statuses_query_failed: " + (sErr.message || sErr.description || sErr));
  }

  var out =
    '{"ok":true,"materials":' + materials +
    ',"locations":' + locations +
    ',"qualities":' + qualities +
    ',"statuses":' + statuses + "}";
  WScript.Echo(out);
  try { if (daoDb) daoDb.Close(); } catch (_) {}
  try { if (adoConn) adoConn.Close(); } catch (_) {}
  try {
    if (app) {
      app.CloseCurrentDatabase();
      app.Quit(2);
    }
  } catch (_) {}
  WScript.Quit(0);
} catch (e) {
  try {
    if (daoDb) daoDb.Close();
    if (adoConn) adoConn.Close();
    if (app) {
      app.CloseCurrentDatabase();
      app.Quit(2);
    }
  } catch (q) {}
  WScript.Echo(
    '{"ok":false,"error":"' + esc(e.message || e.description || e) +
    '","number":"' + esc(e.number) + '","description":"' + esc(e.description) + '"}'
  );
  WScript.Quit(2);
}


