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

function asNum(v) {
  if (v === null || v === undefined || v === "") return null;
  var n = Number(v);
  return isNaN(n) ? null : n;
}

function toIso(v) {
  if (v === null || v === undefined || v === "") return "";
  try {
    var d = new Date(v);
    if (isNaN(d.getTime())) return String(v);
    return d.toISOString();
  } catch (_) {
    return String(v);
  }
}

function inList(x, arr) {
  if (!arr || !arr.length) return false;
  var sx = String(x || "").toLowerCase();
  for (var i = 0; i < arr.length; i++) {
    if (sx === String(arr[i] || "").toLowerCase()) return true;
  }
  return false;
}

function normalizeStatusCode(v) {
  var s = String(v || "").replace(/^\s+|\s+$/g, "").toLowerCase();
  if (!s) return "";
  if (s === "available" || s === "avail" || s === "available_piece" || s === "доступен") return "available";
  if (s === "reserved" || s === "reserve" || s === "booked" || s === "allocated" || s === "зарезервирован") return "reserved";
  if (s === "used" || s === "in use" || s === "consumed" || s === "использован") return "used";
  if (s === "discarded" || s === "disposed" || s === "writeoff" || s === "written_off" || s === "writtenoff" || s === "списан") return "discarded";
  return s;
}

function angDiffDeg(a, b) {
  if (a === null || a === undefined || b === null || b === undefined || a === "" || b === "") return null;
  var da = Number(a);
  var db = Number(b);
  if (isNaN(da) || isNaN(db)) return null;
  var d = ((da - db) % 360 + 360) % 360;
  if (d > 180) d = 360 - d;
  return d;
}

function normGuid(s) {
  // Access stores GUIDs as "{guid {XXXXXXXX-...}}", normalize to bare "{XXXXXXXX-...}" for comparison
  var t = s.replace(/^\s+|\s+$/g, "").toLowerCase();
  var m = t.match(/\{guid\s*(\{[0-9a-f\-]+\})\}/);
  return m ? m[1] : t;
}

function hasContour(contour) {
  var s = String(contour || "");
  if (!s) return false;
  if (s.length < 8) return false;
  return s.indexOf("[") >= 0 || s.indexOf("{") >= 0 || s.indexOf(";") >= 0 || s.indexOf(",") >= 0;
}

function parseJsonObject(text) {
  var s = String(text || "");
  if (!s) return null;
  try {
    if (typeof JSON !== "undefined" && JSON && typeof JSON.parse === "function") {
      return JSON.parse(s);
    }
  } catch (_) {
    return null;
  }
  try {
    return eval("(" + s + ")");
  } catch (_) {
    return null;
  }
}

function normalizeDeg360(v) {
  var n = Number(v);
  if (!isFinite(n)) return null;
  n = n % 360;
  if (n < 0) n += 360;
  return n;
}

function normalizeContourPathPoints(path) {
  var out = [];
  if (!path || !path.length) return out;
  for (var i = 0; i < path.length; i++) {
    var p = path[i] || {};
    var x = Number(p.x);
    var y = Number(p.y);
    if (isFinite(x) && isFinite(y)) out.push({ x: x, y: y });
  }
  if (out.length > 1) {
    var a = out[0];
    var b = out[out.length - 1];
    if (Math.abs(a.x - b.x) < 1e-9 && Math.abs(a.y - b.y) < 1e-9) out.pop();
  }
  return out;
}

function closePath(path) {
  if (!path || path.length < 1) return [];
  var out = path.slice();
  var a = out[0];
  var b = out[out.length - 1];
  if (Math.abs(a.x - b.x) > 1e-9 || Math.abs(a.y - b.y) > 1e-9) {
    out.push({ x: a.x, y: a.y });
  }
  return out;
}

function contourBBox(path) {
  if (!path || path.length < 1) return null;
  var minX = Infinity;
  var minY = Infinity;
  var maxX = -Infinity;
  var maxY = -Infinity;
  for (var i = 0; i < path.length; i++) {
    var p = path[i] || {};
    var x = Number(p.x);
    var y = Number(p.y);
    if (!isFinite(x) || !isFinite(y)) continue;
    if (x < minX) minX = x;
    if (y < minY) minY = y;
    if (x > maxX) maxX = x;
    if (y > maxY) maxY = y;
  }
  if (!isFinite(minX) || !isFinite(minY) || !isFinite(maxX) || !isFinite(maxY)) return null;
  return { width: Math.max(0, maxX - minX), height: Math.max(0, maxY - minY) };
}

function contourArea(path) {
  if (!path || path.length < 3) return 0;
  var sum = 0;
  for (var i = 0; i < path.length; i++) {
    var a = path[i];
    var b = path[(i + 1) % path.length];
    sum += Number(a.x) * Number(b.y) - Number(b.x) * Number(a.y);
  }
  return Math.abs(sum) / 2;
}

function maxPointSpan(path) {
  if (!path || path.length < 2) return null;
  var max = 0;
  for (var i = 0; i < path.length; i++) {
    for (var j = i + 1; j < path.length; j++) {
      var dx = Number(path[i].x) - Number(path[j].x);
      var dy = Number(path[i].y) - Number(path[j].y);
      var d = Math.sqrt(dx * dx + dy * dy);
      if (d > max) max = d;
    }
  }
  return max;
}

function rotatePathDeg(path, deg) {
  var rad = Number(deg) * Math.PI / 180;
  var c = Math.cos(rad);
  var s = Math.sin(rad);
  var out = [];
  for (var i = 0; i < path.length; i++) {
    var p = path[i];
    out.push({
      x: Number(p.x) * c - Number(p.y) * s,
      y: Number(p.x) * s + Number(p.y) * c
    });
  }
  return out;
}

function jsonNum(v) {
  var n = Number(v);
  return isFinite(n) ? String(n) : "null";
}

function jsonStringOrNull(v) {
  if (v === null || v === undefined || v === "") return "null";
  return '"' + esc(String(v)) + '"';
}

function contourToJson(contour) {
  var pts = contour && contour.path && contour.path.length ? contour.path : [];
  var pathParts = [];
  for (var i = 0; i < pts.length; i++) {
    pathParts.push('{"x":' + jsonNum(pts[i].x) + ',"y":' + jsonNum(pts[i].y) + "}");
  }
  var src = contour.source || {};
  var met = contour.metrics || {};
  return "{" +
    '"units":"' + esc(contour.units || "mm") + '",' +
    '"path":[' + pathParts.join(",") + "]," +
    '"source":{' +
      '"frame":' + jsonStringOrNull(src.frame) + "," +
      '"canonicalized":' + (src.canonicalized ? "true" : "false") + "," +
      '"canonicalizationMethod":' + jsonStringOrNull(src.canonicalizationMethod) + "," +
      '"scanSide":' + jsonStringOrNull(src.scanSide) + "," +
      '"napTargetDeg":' + jsonNum(src.napTargetDeg) + "," +
      '"method":' + jsonStringOrNull(src.method) + "," +
      '"layoutNapAligned":' + (src.layoutNapAligned ? "true" : "false") + "," +
      '"layoutNapTargetDeg":' + jsonNum(src.layoutNapTargetDeg) + "," +
      '"layoutRotationDeg":' + jsonNum(src.layoutRotationDeg) +
    "}," +
    '"metrics":{' +
      '"area":' + jsonNum(met.area) + "," +
      '"bboxWidth":' + jsonNum(met.bboxWidth) + "," +
      '"bboxHeight":' + jsonNum(met.bboxHeight) +
    "}" +
  "}";
}

function isLayoutNormalizedContour(contour) {
  if (!contour || typeof contour !== "object") return false;
  var src = contour.source || {};
  var frame = String(src.frame || "").toLowerCase();
  var method = String(src.method || "").toLowerCase();
  var napTarget = normalizeDeg360(src.napTargetDeg);
  var layoutTarget = normalizeDeg360(src.layoutNapTargetDeg);
  return frame === "layout_norm" ||
    src.layoutNapAligned === true ||
    napTarget === 90 ||
    layoutTarget === 90 ||
    method.indexOf("then_rotate") >= 0;
}

function buildLayoutNormalizedCandidate(row, metricsJson) {
  var metrics = parseJsonObject(metricsJson);
  var storedContour = parseJsonObject(row.scrapContour);
  var sourceContour = null;
  if (isLayoutNormalizedContour(storedContour)) {
    sourceContour = storedContour;
  } else if (metrics && metrics.contourLayout && typeof metrics.contourLayout === "object") {
    sourceContour = metrics.contourLayout;
  } else if (metrics && metrics.contourNapAligned && typeof metrics.contourNapAligned === "object") {
    sourceContour = metrics.contourNapAligned;
  } else if (metrics && metrics.contourCanonical && typeof metrics.contourCanonical === "object") {
    sourceContour = metrics.contourCanonical;
  } else {
    sourceContour = storedContour;
  }
  if (!sourceContour || typeof sourceContour !== "object") return row;
  var path = normalizeContourPathPoints(sourceContour.path);
  if (path.length < 3) return row;

  var nap = metrics ? normalizeDeg360(metrics.napDirectionDegCanonical) : null;
  if (nap === null) nap = normalizeDeg360(row.napDirectionDeg);
  if (nap === null) return row;

  var alreadyLayout = isLayoutNormalizedContour(sourceContour);
  var layoutPath = alreadyLayout ? path : rotatePathDeg(path, 90 - nap);
  var bb = contourBBox(layoutPath);
  if (!bb) return row;
  var layoutContour = {
    units: String(sourceContour.units || "mm"),
    path: closePath(layoutPath),
    source: {
      canonicalized: !!(sourceContour.source && sourceContour.source.canonicalized),
      canonicalizationMethod: sourceContour.source && sourceContour.source.canonicalizationMethod ? String(sourceContour.source.canonicalizationMethod) : null,
      scanSide: sourceContour.source && sourceContour.source.scanSide ? String(sourceContour.source.scanSide) : null,
      frame: "layout_norm",
      napTargetDeg: 90,
      method: alreadyLayout && sourceContour.source && sourceContour.source.method ? String(sourceContour.source.method) : "mirror_vertical_bbox_center_then_rotate",
      layoutNapAligned: true,
      layoutNapTargetDeg: 90,
      layoutRotationDeg: alreadyLayout ? 0 : normalizeDeg360(90 - nap)
    },
    metrics: {
      area: contourArea(layoutPath),
      bboxWidth: bb.width,
      bboxHeight: bb.height
    }
  };
  row.scrapContour = contourToJson(layoutContour);
  row.napDirectionDeg = 90;
  row.areaMm2 = layoutContour.metrics.area;
  row.bboxWidthMm = layoutContour.metrics.bboxWidth;
  row.bboxHeightMm = layoutContour.metrics.bboxHeight;
  row.maxSpanMm = maxPointSpan(layoutPath);
  return row;
}

function addRejectSample(map, key, row, extra) {
  if (!map[key]) map[key] = [];
  if (map[key].length >= 5) return;
  var item = {
    id: String(row.id || ""),
    inventoryTag: String(row.inventoryTag || ""),
    materialId: String(row.materialId || ""),
    scrapStatus: String(row.scrapStatus || ""),
    areaMm2: row.areaMm2,
    bboxWidthMm: row.bboxWidthMm,
    bboxHeightMm: row.bboxHeightMm,
    maxSpanMm: row.maxSpanMm
  };
  if (extra !== null && extra !== undefined) {
    if (typeof extra === "object") {
      if (extra.rule !== undefined) item.rule = String(extra.rule || "");
      if (extra.pieceValue !== undefined) item.pieceValue = extra.pieceValue;
      if (extra.threshold !== undefined) item.threshold = extra.threshold;
      if (extra.detail !== undefined) item.detail = String(extra.detail || "");
    } else {
      item.detail = String(extra);
    }
  }
  map[key].push(item);
}

function stringifySampleList(arr) {
  var src = arr || [];
  var out = [];
  for (var i = 0; i < src.length; i++) {
    var x = src[i] || {};
    out.push(
      "{" +
        '"id":"' + esc(x.id || "") + '",' +
        '"inventoryTag":"' + esc(x.inventoryTag || "") + '",' +
        '"materialId":"' + esc(x.materialId || "") + '",' +
        '"scrapStatus":"' + esc(x.scrapStatus || "") + '",' +
        '"areaMm2":' + (x.areaMm2 === null || x.areaMm2 === undefined || x.areaMm2 === "" ? "null" : String(x.areaMm2)) + "," +
        '"bboxWidthMm":' + (x.bboxWidthMm === null || x.bboxWidthMm === undefined || x.bboxWidthMm === "" ? "null" : String(x.bboxWidthMm)) + "," +
        '"bboxHeightMm":' + (x.bboxHeightMm === null || x.bboxHeightMm === undefined || x.bboxHeightMm === "" ? "null" : String(x.bboxHeightMm)) + "," +
        '"maxSpanMm":' + (x.maxSpanMm === null || x.maxSpanMm === undefined || x.maxSpanMm === "" ? "null" : String(x.maxSpanMm)) + "," +
        '"rule":"' + esc(x.rule || "") + '",' +
        '"pieceValue":' + (x.pieceValue === null || x.pieceValue === undefined || x.pieceValue === "" ? "null" : String(x.pieceValue)) + "," +
        '"threshold":' + (x.threshold === null || x.threshold === undefined || x.threshold === "" ? "null" : String(x.threshold)) + "," +
        '"detail":"' + esc(x.detail || "") + '"' +
      "}"
    );
  }
  return out.join(",");
}

var daoDb = null;
try {
  var payload = eval("(" + (readUtf8(jsonPath) || "{}") + ")");
  var limit = Number(payload.limit || 200);
  if (!isFinite(limit) || limit < 1) limit = 200;
  if (limit > 2000) limit = 2000;
  var materialId = String(payload.materialId || "").replace(/^\s+|\s+$/g, "");
  var minAreaMm2 = asNum(payload.minAreaMm2);
  var maxAreaMm2 = asNum(payload.maxAreaMm2);
  var minWidthMm = asNum(payload.minWidthMm);
  var maxWidthMm = asNum(payload.maxWidthMm);
  var minHeightMm = asNum(payload.minHeightMm);
  var maxHeightMm = asNum(payload.maxHeightMm);
  var minSpanMm = asNum(payload.minSpanMm);
  var maxSpanMm = asNum(payload.maxSpanMm);
  var allowedStatuses = payload.allowedStatuses && payload.allowedStatuses.length ? payload.allowedStatuses : null;
  var allowedQualities = payload.allowedQualities && payload.allowedQualities.length ? payload.allowedQualities : null;
  var requireValidContour = payload.requireValidContour === true;
  var napDirectionDeg = asNum(payload.napDirectionDeg);
  var napToleranceDeg = asNum(payload.napToleranceDeg);
  if (napToleranceDeg === null) napToleranceDeg = asNum(payload.prefilterNapToleranceDeg);
  var onlyAvailable = payload.onlyAvailable === true;
  var layoutNormalizeScrapContour = payload.layoutNormalizeScrapContour === true;

  var includeScrapContour = true;
  var sql = "SELECT id, inventoryTag, materialId, scrapStatus, scrapQuality, areaMm2, bboxWidthMm, bboxHeightMm, maxSpanMm, napDirectionDeg, updatedAt, scrapContour, metricsJson FROM ScrapPiece";
  sql += " ORDER BY updatedAt DESC, areaMm2 DESC;";

  var dao = new ActiveXObject("DAO.DBEngine.120");
  daoDb = dao.OpenDatabase(dbPath, false, true);
  var activeReservations = {};
  try {
    var rsResv = daoDb.OpenRecordset("SELECT scrapPieceId FROM ScrapReservation WHERE releasedAt Is Null;");
    while (!rsResv.EOF) {
      var rid = String(rsResv.Fields("scrapPieceId").Value || "");
      if (rid) activeReservations[rid.toLowerCase()] = true;
      rsResv.MoveNext();
    }
    rsResv.Close();
  } catch (_) {}
  var rs = daoDb.OpenRecordset(sql);

  var rows = [];
  var rejectSamples = {};
  var rejectCounts = {
    inventoryTag: 0,
    status: 0,
    reservation: 0,
    material: 0,
    contour: 0,
    quality: 0,
    nap: 0,
    area_bbox_span: 0
  };
  var stageAfterStatus = 0;
  var stageAfterMaterial = 0;
  var stageAfterContour = 0;
  var stageAfterQuality = 0;
  var stageAfterNap = 0;

  while (!rs.EOF) {
    var row = {
      id: rs.Fields("id").Value || "",
      inventoryTag: rs.Fields("inventoryTag").Value || "",
      materialId: rs.Fields("materialId").Value || "",
      scrapStatus: rs.Fields("scrapStatus").Value || "",
      scrapQuality: rs.Fields("scrapQuality").Value || "",
      areaMm2: asNum(rs.Fields("areaMm2").Value),
      bboxWidthMm: asNum(rs.Fields("bboxWidthMm").Value),
      bboxHeightMm: asNum(rs.Fields("bboxHeightMm").Value),
      maxSpanMm: asNum(rs.Fields("maxSpanMm").Value),
      napDirectionDeg: asNum(rs.Fields("napDirectionDeg").Value),
      updatedAt: toIso(rs.Fields("updatedAt").Value),
      hasActiveReservation: false,
      scrapContour: includeScrapContour ? (rs.Fields("scrapContour").Value || "") : ""
    };
    if (layoutNormalizeScrapContour && includeScrapContour) {
      row = buildLayoutNormalizedCandidate(row, rs.Fields("metricsJson").Value || "");
    }
    if (!String(row.inventoryTag || "").replace(/^\s+|\s+$/g, "")) {
      rejectCounts.inventoryTag += 1;
      addRejectSample(rejectSamples, "inventoryTag", row, "missing_inventory_tag");
      rs.MoveNext();
      continue;
    }
    var st = String(row.scrapStatus || "");
    var stNorm = normalizeStatusCode(st);
    row.hasActiveReservation = !!activeReservations[String(row.id || "").toLowerCase()];
    if (onlyAvailable && stNorm !== "available") {
      rejectCounts.status += 1;
      addRejectSample(rejectSamples, "status", row, "onlyAvailable:not_available");
      rs.MoveNext();
      continue;
    }
    if (onlyAvailable && row.hasActiveReservation) {
      rejectCounts.reservation += 1;
      addRejectSample(rejectSamples, "reservation", row, "active_reservation");
      rs.MoveNext();
      continue;
    }
    if (allowedStatuses && !inList(st, allowedStatuses)) {
      rejectCounts.status += 1;
      addRejectSample(rejectSamples, "status", row, "allowedStatuses");
      rs.MoveNext();
      continue;
    }
    stageAfterStatus += 1;

    if (materialId && normGuid(String(row.materialId || "")) !== normGuid(String(materialId))) {
      rejectCounts.material += 1;
      addRejectSample(rejectSamples, "material", row, "materialId");
      rs.MoveNext();
      continue;
    }
    stageAfterMaterial += 1;

    if (requireValidContour && !hasContour(row.scrapContour)) {
      rejectCounts.contour += 1;
      addRejectSample(rejectSamples, "contour", row, "contour_missing_or_invalid");
      rs.MoveNext();
      continue;
    }
    stageAfterContour += 1;

    if (allowedQualities && !inList(row.scrapQuality, allowedQualities)) {
      rejectCounts.quality += 1;
      addRejectSample(rejectSamples, "quality", row, "allowedQualities");
      rs.MoveNext();
      continue;
    }
    stageAfterQuality += 1;

    if (napDirectionDeg !== null && napToleranceDeg !== null) {
      var dNap = angDiffDeg(row.napDirectionDeg, napDirectionDeg);
      if (dNap === null || dNap > Number(napToleranceDeg)) {
        rejectCounts.nap += 1;
        addRejectSample(rejectSamples, "nap", row, dNap === null ? "nap_missing" : ("delta=" + String(Math.round(dNap * 10) / 10)));
        rs.MoveNext();
        continue;
      }
    }
    stageAfterNap += 1;

    var failGeom = false;
    var geomReason = "";
    if (minAreaMm2 !== null && (row.areaMm2 === null || row.areaMm2 < minAreaMm2)) { failGeom = true; geomReason = "minAreaMm2"; }
    if (!failGeom && maxAreaMm2 !== null && row.areaMm2 !== null && row.areaMm2 > maxAreaMm2) { failGeom = true; geomReason = "maxAreaMm2"; }
    if (!failGeom && minWidthMm !== null && (row.bboxWidthMm === null || row.bboxWidthMm < minWidthMm)) { failGeom = true; geomReason = "minWidthMm"; }
    if (!failGeom && maxWidthMm !== null && row.bboxWidthMm !== null && row.bboxWidthMm > maxWidthMm) { failGeom = true; geomReason = "maxWidthMm"; }
    if (!failGeom && minHeightMm !== null && (row.bboxHeightMm === null || row.bboxHeightMm < minHeightMm)) { failGeom = true; geomReason = "minHeightMm"; }
    if (!failGeom && maxHeightMm !== null && row.bboxHeightMm !== null && row.bboxHeightMm > maxHeightMm) { failGeom = true; geomReason = "maxHeightMm"; }
    if (!failGeom && minSpanMm !== null && (row.maxSpanMm === null || row.maxSpanMm < minSpanMm)) { failGeom = true; geomReason = "minSpanMm"; }
    if (!failGeom && maxSpanMm !== null && row.maxSpanMm !== null && row.maxSpanMm > maxSpanMm) { failGeom = true; geomReason = "maxSpanMm"; }
    if (failGeom) {
      rejectCounts.area_bbox_span += 1;
      var pieceVal = null;
      var thresholdVal = null;
      if (geomReason === "minAreaMm2" || geomReason === "maxAreaMm2") { pieceVal = row.areaMm2; thresholdVal = (geomReason === "minAreaMm2" ? minAreaMm2 : maxAreaMm2); }
      if (geomReason === "minWidthMm" || geomReason === "maxWidthMm") { pieceVal = row.bboxWidthMm; thresholdVal = (geomReason === "minWidthMm" ? minWidthMm : maxWidthMm); }
      if (geomReason === "minHeightMm" || geomReason === "maxHeightMm") { pieceVal = row.bboxHeightMm; thresholdVal = (geomReason === "minHeightMm" ? minHeightMm : maxHeightMm); }
      if (geomReason === "minSpanMm" || geomReason === "maxSpanMm") { pieceVal = row.maxSpanMm; thresholdVal = (geomReason === "minSpanMm" ? minSpanMm : maxSpanMm); }
      addRejectSample(rejectSamples, "area_bbox_span", row, {
        rule: geomReason,
        pieceValue: pieceVal,
        threshold: thresholdVal,
        detail: "prefilter_threshold_failed"
      });
      rs.MoveNext();
      continue;
    }

    rows.push(
      "{" +
      '"id":"' + esc(row.id) + '",' +
      '"inventoryTag":"' + esc(row.inventoryTag) + '",' +
      '"materialId":"' + esc(row.materialId) + '",' +
      '"scrapStatus":"' + esc(row.scrapStatus) + '",' +
      '"hasActiveReservation":' + (row.hasActiveReservation ? "true" : "false") + "," +
      '"scrapQuality":"' + esc(row.scrapQuality) + '",' +
      '"areaMm2":' + (row.areaMm2 === null ? "null" : String(row.areaMm2)) + "," +
      '"bboxWidthMm":' + (row.bboxWidthMm === null ? "null" : String(row.bboxWidthMm)) + "," +
      '"bboxHeightMm":' + (row.bboxHeightMm === null ? "null" : String(row.bboxHeightMm)) + "," +
      '"maxSpanMm":' + (row.maxSpanMm === null ? "null" : String(row.maxSpanMm)) + "," +
      '"napDirectionDeg":' + (row.napDirectionDeg === null ? "null" : String(row.napDirectionDeg)) + "," +
      '"updatedAt":"' + esc(row.updatedAt) + '"' +
      (includeScrapContour ? ',"scrapContour":"' + esc(row.scrapContour || "") + '"' : "") +
      "}"
    );
    if (rows.length >= limit) break;
    rs.MoveNext();
  }

  rs.Close();
  daoDb.Close();
  var totalSource = stageAfterStatus + rejectCounts.status + rejectCounts.inventoryTag;
  var funnel =
    '"funnel":{' +
      '"totalSource":' + String(totalSource) + "," +
      '"afterStatus":' + String(stageAfterStatus) + "," +
      '"afterMaterial":' + String(stageAfterMaterial) + "," +
      '"afterContour":' + String(stageAfterContour) + "," +
      '"afterQuality":' + String(stageAfterQuality) + "," +
      '"afterNap":' + String(stageAfterNap) + "," +
      '"afterAreaBBoxSpan":' + String(rows.length) + "," +
      '"thresholds":{' +
        '"minAreaMm2":' + (minAreaMm2 === null ? "null" : String(minAreaMm2)) + "," +
        '"maxAreaMm2":' + (maxAreaMm2 === null ? "null" : String(maxAreaMm2)) + "," +
        '"minWidthMm":' + (minWidthMm === null ? "null" : String(minWidthMm)) + "," +
        '"maxWidthMm":' + (maxWidthMm === null ? "null" : String(maxWidthMm)) + "," +
        '"minHeightMm":' + (minHeightMm === null ? "null" : String(minHeightMm)) + "," +
        '"maxHeightMm":' + (maxHeightMm === null ? "null" : String(maxHeightMm)) + "," +
        '"minSpanMm":' + (minSpanMm === null ? "null" : String(minSpanMm)) + "," +
        '"maxSpanMm":' + (maxSpanMm === null ? "null" : String(maxSpanMm)) +
      "}," +
      '"thresholdBasis":{' +
        '"kind":"' + esc((payload.thresholdBasis && payload.thresholdBasis.kind) || "") + '",' +
        '"source":"' + esc((payload.thresholdBasis && payload.thresholdBasis.source) || "") + '",' +
        '"fragmentsCount":' + (payload.thresholdBasis && payload.thresholdBasis.fragmentsCount !== undefined ? String(Number(payload.thresholdBasis.fragmentsCount || 0)) : "null") +
      "}," +
      '"rejected":{' +
        '"inventoryTag":' + String(rejectCounts.inventoryTag) + "," +
        '"status":' + String(rejectCounts.status) + "," +
        '"reservation":' + String(rejectCounts.reservation) + "," +
        '"material":' + String(rejectCounts.material) + "," +
        '"contour":' + String(rejectCounts.contour) + "," +
        '"quality":' + String(rejectCounts.quality) + "," +
        '"nap":' + String(rejectCounts.nap) + "," +
        '"area_bbox_span":' + String(rejectCounts.area_bbox_span) +
      "}," +
      '"examples":{' +
        '"inventoryTag":[' + stringifySampleList(rejectSamples.inventoryTag || []) + "]," +
        '"status":[' + stringifySampleList(rejectSamples.status || []) + "]," +
        '"reservation":[' + stringifySampleList(rejectSamples.reservation || []) + "]," +
        '"material":[' + stringifySampleList(rejectSamples.material || []) + "]," +
        '"contour":[' + stringifySampleList(rejectSamples.contour || []) + "]," +
        '"quality":[' + stringifySampleList(rejectSamples.quality || []) + "]," +
        '"nap":[' + stringifySampleList(rejectSamples.nap || []) + "]," +
        '"area_bbox_span":[' + stringifySampleList(rejectSamples.area_bbox_span || []) + "]" +
      "}" +
    "}";
  WScript.Echo('{"ok":true,"items":[' + rows.join(",") + '],"count":' + String(rows.length) + "," + funnel + "}");
  WScript.Quit(0);
} catch (e) {
  try { if (daoDb) daoDb.Close(); } catch (_) {}
  WScript.Echo('{"ok":false,"error":"inventory_candidates_read_failed","description":"' + esc(e.description || e.message || e) + '"}');
  WScript.Quit(2);
}
