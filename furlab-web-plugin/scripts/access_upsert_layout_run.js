// CScript (JScript) — runs via cscript.exe
// Upserts Part, Zone, Layout, LayoutRun, Fragment, LayoutRunScrapPlacement from a project save.
//
// Payload JSON (argument 2):
//   parts:   Array of { id: number (partNo), name: string }
//   zones:   Array of { id: number (zoneNo), detailId: number (partNo), materialId: string,
//                       napDirectionDeg: number, points: [{x,y},...] }
//   layouts: Array of { id: string, zoneId: number, layoutType: string, paramsJson: string|null,
//              runs: [{ id, startedAt, paramsSnapshot, resultSnapshot,
//                       scrapPlacements: [{fragmentId, scrapPieceId, rotationDeg, offsetXmm, offsetYmm}] }] }

var dbPath   = WScript.Arguments.length > 0 ? WScript.Arguments(0) : "";
var jsonPath = WScript.Arguments.length > 1 ? WScript.Arguments(1) : "";
if (!dbPath)   { WScript.Echo('{"ok":false,"error":"db_path_required"}');   WScript.Quit(1); }
if (!jsonPath) { WScript.Echo('{"ok":false,"error":"json_path_required"}'); WScript.Quit(1); }

// ── helpers ──────────────────────────────────────────────────────────────────

function esc(s) {
  if (s === null || s === undefined) return "";
  var src = String(s);
  var out = "";
  for (var i = 0; i < src.length; i++) {
    var code = src.charCodeAt(i);
    var ch = src.charAt(i);
    if      (ch === "\\") out += "\\\\";
    else if (ch === '"')  out += '\\"';
    else if (code === 8)  out += "\\b";
    else if (code === 9)  out += "\\t";
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

function sqlText(s) { return "'" + String(s == null ? "" : s).replace(/'/g, "''") + "'"; }

function normGuid(v) {
  var s = String(v == null ? "" : v).replace(/\s/g, "").replace(/[{}]/g, "").toUpperCase();
  if (s.length === 32) s = s.slice(0,8)+"-"+s.slice(8,12)+"-"+s.slice(12,16)+"-"+s.slice(16,20)+"-"+s.slice(20);
  return "{" + s + "}";
}

function toAccessDate(v) {
  if (!v) return "Null";
  try {
    var d = (typeof v === "number") ? new Date(v) : new Date(String(v));
    if (isNaN(d.getTime())) return "Null";
    // Access accepts ISO: #YYYY-MM-DD HH:MM:SS#
    var pad = function(n){ return n < 10 ? "0"+n : ""+n; };
    return "#" + d.getUTCFullYear()+"-"+pad(d.getUTCMonth()+1)+"-"+pad(d.getUTCDate()) +
      " " + pad(d.getUTCHours())+":"+pad(d.getUTCMinutes())+":"+pad(d.getUTCSeconds()) + "#";
  } catch(_){ return "Null"; }
}

function toJsonMemo(v) {
  // Accepts a pre-serialized JSON string (from Node.js) or null/undefined
  if (v == null) return "Null";
  var s = String(v);
  if (!s) return "Null";
  return sqlText(s);
}

function readUtf8(path) {
  var stm = new ActiveXObject("ADODB.Stream");
  stm.Type = 2; stm.Charset = "utf-8"; stm.Open(); stm.LoadFromFile(path);
  var txt = stm.ReadText(); stm.Close();
  return txt;
}

// Deterministic GUID from an arbitrary string (pads char codes into 16-byte UUID)
function strToGuid(s) {
  var src = String(s == null ? "" : s);
  var bytes = [];
  for (var i = 0; i < 16; i++) {
    bytes.push(i < src.length ? src.charCodeAt(i) & 0xFF : 0);
  }
  function h2(b) { var x = b.toString(16).toUpperCase(); return x.length < 2 ? "0" + x : x; }
  return "{" +
    h2(bytes[0])+h2(bytes[1])+h2(bytes[2])+h2(bytes[3]) + "-" +
    h2(bytes[4])+h2(bytes[5]) + "-" +
    h2(bytes[6])+h2(bytes[7]) + "-" +
    h2(bytes[8])+h2(bytes[9]) + "-" +
    h2(bytes[10])+h2(bytes[11])+h2(bytes[12])+h2(bytes[13])+h2(bytes[14])+h2(bytes[15]) +
  "}";
}

function rowExists(db, table, col, val) {
  try {
    var rs = db.OpenRecordset("SELECT " + col + " FROM [" + table + "] WHERE " + col + "=" + sqlText(val) + ";");
    var found = !rs.EOF;
    rs.Close();
    return found;
  } catch(_){ return false; }
}

// Extract clean GUID string from any DAO GUID value (may come as "{guid {XXXX-...}}")
function extractGuid(v) {
  var s = String(v == null ? "" : v);
  var m = s.match(/[0-9A-Fa-f]{8}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{12}/);
  return m ? "{" + m[0].toUpperCase() + "}" : "";
}

// Look up GUID by a numeric "No" field in any table; returns GUID string or ""
function guidByNo(db, table, noCol, noVal) {
  if (noVal == null || noVal === "") return "";
  try {
    var rs = db.OpenRecordset("SELECT id FROM [" + table + "] WHERE " + noCol + "=" + Number(noVal) + ";");
    var guid = "";
    if (!rs.EOF) guid = extractGuid(rs.Fields("id").Value);
    rs.Close();
    return guid;
  } catch(_){ return ""; }
}

// Upsert a Part row; returns GUID
function upsertPart(db, partNo, partName) {
  var guid = guidByNo(db, "Part", "partNo", partNo);
  if (guid) {
    try {
      db.Execute("UPDATE [Part] SET partName=" + sqlText(partName) + " WHERE partNo=" + Number(partNo) + ";");
    } catch(_) {}
    return guid;
  }
  guid = strToGuid("part_" + partNo);
  try {
    db.Execute("INSERT INTO [Part] (id, partNo, partName) VALUES (" +
      sqlText(guid) + ", " + Number(partNo) + ", " + sqlText(partName) + ");");
  } catch(_) { return ""; }
  return guid;
}

// Upsert a Zone row; returns GUID
function upsertZone(db, zoneNo, partGuid, materialId, napDeg, contourJson) {
  var normMatId = extractGuid(materialId || "");
  var guid = guidByNo(db, "Zone", "zoneNo", zoneNo);
  if (guid) {
    try {
      db.Execute("UPDATE [Zone] SET" +
        (partGuid ? " partId=" + sqlText(partGuid) + "," : "") +
        (normMatId ? " materialId=" + sqlText(normMatId) + "," : "") +
        " pileDirectionDeg=" + (isNaN(Number(napDeg)) ? 0 : Number(napDeg)) + "," +
        " zoneContour=" + (contourJson ? sqlText(contourJson) : "Null") +
        " WHERE zoneNo=" + Number(zoneNo) + ";");
    } catch(_) {}
    return guid;
  }
  if (!partGuid) return "";  // partId is NOT NULL FK
  guid = strToGuid("zone_" + zoneNo);
  try {
    db.Execute("INSERT INTO [Zone] (id, partId, zoneNo, materialId, pileDirectionDeg, zoneContour) VALUES (" +
      sqlText(guid) + ", " + sqlText(partGuid) + ", " + Number(zoneNo) + ", " +
      (normMatId ? sqlText(normMatId) : "Null") + ", " +
      (isNaN(Number(napDeg)) ? 0 : Number(napDeg)) + ", " +
      (contourJson ? sqlText(contourJson) : "Null") + ");");
  } catch(_) { return ""; }
  return guid;
}

// ── main ─────────────────────────────────────────────────────────────────────

var daoDb = null;
try {
  var raw = readUtf8(jsonPath);
  var payload = eval("(" + raw + ")");
  var layouts = payload.layouts;
  var parts   = payload.parts   || [];
  var zones   = payload.zones   || [];

  var dao = new ActiveXObject("DAO.DBEngine.120");
  daoDb = dao.OpenDatabase(dbPath, false, false);

  // ── 1. Upsert Parts (Детали) ────────────────────────────────────────────
  var partGuidMap = {};  // partNo -> GUID
  for (var pi = 0; pi < parts.length; pi++) {
    var part = parts[pi];
    var pNo = Number(part.id || 0);
    if (!pNo) continue;
    var existedPart = !!guidByNo(daoDb, "Part", "partNo", pNo);
    var pGuid = upsertPart(daoDb, pNo, String(part.name || "Деталь " + pNo));
    if (pGuid) { partGuidMap[pNo] = pGuid; if (!existedPart) partsWritten++; }
  }

  // ── 2. Upsert Zones (Зоны) ──────────────────────────────────────────────
  var zoneGuidMap = {};  // zoneNo -> GUID
  for (var zi = 0; zi < zones.length; zi++) {
    var zone = zones[zi];
    var zNo    = Number(zone.id || 0);
    var zPartNo = Number(zone.detailId || 0);
    if (!zNo) continue;
    var zPartGuid = partGuidMap[zPartNo] || guidByNo(daoDb, "Part", "partNo", zPartNo);
    var zContour = (zone.points && zone.points.length) ? zone.points : null;
    var zContourJson = null;
    if (zContour) {
      var pts = [];
      for (var pti = 0; pti < zContour.length; pti++) pts.push('{"x":' + zContour[pti].x + ',"y":' + zContour[pti].y + '}');
      zContourJson = "[" + pts.join(",") + "]";
    }
    var existedZone = !!guidByNo(daoDb, "Zone", "zoneNo", zNo);
    var zGuid = upsertZone(daoDb, zNo, zPartGuid, zone.materialId, zone.napDirectionDeg, zContourJson);
    if (zGuid) { zoneGuidMap[zNo] = zGuid; if (!existedZone) zonesWritten++; }
  }

  var partsWritten  = 0;
  var zonesWritten  = 0;
  var layoutsWritten = 0;
  var runsWritten    = 0;
  var placementsWritten = 0;

  if (!layouts || !layouts.length) {
    WScript.Echo('{"ok":true,"parts":' + partsWritten + ',"zones":' + zonesWritten + ',"layouts":0,"runs":0,"placements":0}');
    WScript.Quit(0);
  }

  // Diagnostic: count total placements in payload
  var totalSps = 0;
  for (var di = 0; di < layouts.length; di++) {
    var dlays = layouts[di].runs || [];
    for (var dri = 0; dri < dlays.length; dri++) {
      var dsp = dlays[dri].scrapPlacements;
      totalSps += (dsp && dsp.length) ? dsp.length : 0;
    }
  }
  WScript.StdErr.WriteLine("[upsert] layouts=" + layouts.length + " totalScrapPlacements=" + totalSps);

  for (var li = 0; li < layouts.length; li++) {
    var lay = layouts[li];
    var layId      = strToGuid(lay.id || "");
    var zoneNoRaw  = lay.zoneId;
    var zoneGuid   = (zoneNoRaw != null && zoneNoRaw !== "")
      ? (zoneGuidMap[Number(zoneNoRaw)] || guidByNo(daoDb, "Zone", "zoneNo", zoneNoRaw))
      : "";
    var layoutType = String(lay.layoutType || "unknown");
    var paramsJson = toJsonMemo(lay.paramsJson != null ? lay.paramsJson : null);

    if (!layId || layId === "{}") continue;

    // Upsert Layout
    if (rowExists(daoDb, "Layout", "id", layId)) {
      try {
        daoDb.Execute(
          "UPDATE [Layout] SET layoutType=" + sqlText(layoutType) +
          ", paramsJson=" + paramsJson +
          (zoneGuid ? ", zoneId=" + sqlText(zoneGuid) : "") +
          " WHERE id=" + sqlText(layId) + ";"
        );
      } catch(_) {}
    } else if (zoneGuid) {
      try {
        daoDb.Execute(
          "INSERT INTO [Layout] (id, zoneId, layoutType, paramsJson) VALUES (" +
            sqlText(layId) + ", " + sqlText(zoneGuid) + ", " +
            sqlText(layoutType) + ", " + paramsJson + ");"
        );
        layoutsWritten++;
      } catch(e) {
        // skip if FK fails
      }
    }
    // If zoneGuid not found, skip Layout insert but still attempt LayoutRun below
    // (won't succeed due to FK, but we try gracefully)

    // Upsert LayoutRuns
    var runs = (lay.runs && lay.runs.length) ? lay.runs : [];
    for (var ri = 0; ri < runs.length; ri++) {
      var run = runs[ri];
      var runId       = strToGuid(run.id || "");
      var startedAt   = toAccessDate(run.startedAt || null);
      var paramSnap   = toJsonMemo(run.paramsSnapshot != null ? run.paramsSnapshot : null);
      var resultSnap  = toJsonMemo(run.resultSnapshot != null ? run.resultSnapshot : null);

      if (!runId || runId === "{}") continue;

      if (rowExists(daoDb, "LayoutRun", "id", runId)) {
        try {
          daoDb.Execute(
            "UPDATE [LayoutRun] SET paramsSnapshot=" + paramSnap +
            ", resultSnapshot=" + resultSnap +
            " WHERE id=" + sqlText(runId) + ";"
          );
        } catch(_) {}
      } else {
        try {
          daoDb.Execute(
            "INSERT INTO [LayoutRun] (id, layoutId, startedAt, paramsSnapshot, resultSnapshot) VALUES (" +
              sqlText(runId) + ", " + sqlText(layId) + ", " +
              startedAt + ", " + paramSnap + ", " + resultSnap + ");"
          );
          runsWritten++;
        } catch(e) {
          // skip if layoutId FK fails (layout not written above)
        }
      }

      // Upsert Fragment rows referenced by placements (needed for FK)
      var resultFrags = (run.resultSnapshot && run.resultSnapshot.fragments) ? run.resultSnapshot.fragments : [];
      var fragIdMap = {};  // stringId -> GUID
      for (var fi = 0; fi < resultFrags.length; fi++) {
        var rf = resultFrags[fi];
        var rfStringId = String(rf && (rf.id || rf.fragmentId) || "");
        if (!rfStringId) continue;
        var rfGuid = strToGuid(rfStringId);
        fragIdMap[rfStringId] = rfGuid;
        if (zoneGuid && !rowExists(daoDb, "Fragment", "id", rfGuid)) {
          try {
            daoDb.Execute(
              "INSERT INTO [Fragment] (id, zoneId, fragmentCode, areaMm2) VALUES (" +
                sqlText(rfGuid) + ", " + sqlText(zoneGuid) + ", " +
                sqlText(rfStringId) + ", " + (Number(rf.areaMm2) || 0) + ");"
            );
          } catch(_) {}
        }
      }

      // Upsert LayoutRunScrapPlacement rows
      var sps = (run.scrapPlacements && run.scrapPlacements.length) ? run.scrapPlacements : [];
      for (var si = 0; si < sps.length; si++) {
        var sp = sps[si];
        var spFragStrId = String(sp.fragmentId || "");
        var fragId    = fragIdMap[spFragStrId] || strToGuid(spFragStrId);
        var pieceId   = extractGuid(sp.scrapPieceId || "");
        var rotDeg    = isNaN(Number(sp.rotationDeg)) ? "Null" : Number(sp.rotationDeg);
        var offX      = isNaN(Number(sp.offsetXmm))   ? "Null" : Number(sp.offsetXmm);
        var offY      = isNaN(Number(sp.offsetYmm))   ? "Null" : Number(sp.offsetYmm);

        if (!fragId || !pieceId || fragId === "{}" || pieceId === "{}") {
          WScript.StdErr.WriteLine("[placement] skip frag=" + (spFragStrId||"?") + " pieceId=" + pieceId + " fragId=" + fragId);
          continue;
        }

        // PK is (layoutRunId, fragmentId) — upsert via delete+insert
        try {
          daoDb.Execute(
            "DELETE FROM [LayoutRunScrapPlacement] WHERE layoutRunId=" + sqlText(runId) +
            " AND fragmentId=" + sqlText(fragId) + ";"
          );
        } catch(_) {}
        try {
          daoDb.Execute(
            "INSERT INTO [LayoutRunScrapPlacement] " +
            "(layoutRunId, fragmentId, scrapPieceId, rotationDeg, offsetXmm, offsetYmm) VALUES (" +
              sqlText(runId) + ", " + sqlText(fragId) + ", " + sqlText(pieceId) + ", " +
              rotDeg + ", " + offX + ", " + offY + ");"
          );
          WScript.StdErr.WriteLine("[placement] ok frag=" + spFragStrId + " piece=" + pieceId + " run=" + runId);
          placementsWritten++;
        } catch(e) {
          WScript.StdErr.WriteLine("[placement] err frag=" + spFragStrId + " piece=" + pieceId + ": " + String(e.message || e));
        }
      }
    }
  }

  WScript.Echo(
    '{"ok":true' +
    ',"parts":' + partsWritten +
    ',"zones":' + zonesWritten +
    ',"layouts":' + layoutsWritten +
    ',"runs":' + runsWritten +
    ',"placements":' + placementsWritten + '}'
  );

} catch(e) {
  WScript.Echo('{"ok":false,"error":"script_error","detail":"' + esc(String(e.message || e)) + '"}');
} finally {
  try { if (daoDb) daoDb.Close(); } catch(_) {}
}
