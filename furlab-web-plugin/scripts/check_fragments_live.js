"use strict";
// Вызывает live API и проверяет алгоритм фрагментов на результате
// node scripts/check_fragments_live.js [seamReserveMm=12]

const http = require("http");
const path = require("path");
const fs = require("fs");
const { diffMulti, unionMulti, pointsToMultiPolygon, intersectMulti } = require("../src/services/polygon_ops");

const seamReserveMm = Number(process.argv[2] || 12);
const API = "http://127.0.0.1:5600";

function mpArea(mp) {
  if (!Array.isArray(mp)) return 0;
  let s = 0;
  for (const poly of mp) {
    if (!Array.isArray(poly)) continue;
    for (let ri = 0; ri < poly.length; ri++) {
      const ring = poly[ri];
      let a = 0;
      for (let i = 0; i < ring.length; i++) {
        const cur = ring[i];
        const nxt = ring[(i + 1) % ring.length];
        a += cur[0] * nxt[1] - nxt[0] * cur[1];
      }
      s += Math.abs(a) * 0.5 * (ri === 0 ? 1 : -1);
    }
  }
  return Math.abs(s);
}

function toPts(arr) {
  return (arr || []).map(q => ({ x: Number(q && q.x), y: Number(q && q.y) }))
    .filter(q => Number.isFinite(q.x) && Number.isFinite(q.y));
}

function extractPts(poly) {
  const outer = Array.isArray(poly) && Array.isArray(poly[0]) ? poly[0] : null;
  if (!outer) return null;
  const pts = [];
  for (let k = 0; k < outer.length - 1; k++) {
    const x = Number(outer[k] && outer[k][0]);
    const y = Number(outer[k] && outer[k][1]);
    if (Number.isFinite(x) && Number.isFinite(y)) pts.push({ x, y });
  }
  return pts.length >= 3 ? pts : null;
}

function postJson(routePath, body) {
  const data = JSON.stringify(body);
  return new Promise((resolve, reject) => {
    const req = http.request({
      method: "POST",
      hostname: "127.0.0.1",
      port: 5600,
      path: routePath,
      headers: { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(data) },
      timeout: 60000
    }, res => {
      let raw = "";
      res.on("data", c => raw += c);
      res.on("end", () => resolve(JSON.parse(raw)));
    });
    req.on("error", reject);
    req.on("timeout", () => req.destroy(new Error("timeout")));
    req.write(data);
    req.end();
  });
}

async function main() {
  // Загружаем oracle case
  const oracle = JSON.parse(fs.readFileSync(path.join(__dirname, "../oracle_case_zone_1_1772731241049.json")));

  // Формируем запрос с ненулевым pieceSeamReserveMm
  // Формируем candidates из pieces (как в sweep_inventory_case.js)
  const candidates = oracle.pieces.map(p => {
    const pts = Array.isArray(p.points) ? p.points : [];
    return {
      id: String(p.id || ""),
      inventoryTag: String(p.id || ""),
      areaMm2: Number(p.areaMm2 || 0),
      bboxWidthMm: Number(p.bboxWidthMm || 0),
      bboxHeightMm: Number(p.bboxHeightMm || 0),
      napDirectionDeg: 90,
      scrapContour: JSON.stringify({ path: pts.map(q => ({ x: Number(q.x), y: Number(q.y) })) })
    };
  });

  const params = oracle.params || {};
  const requestBody = {
    zone: { id: Number(oracle.zone && oracle.zone.id || 1), points: oracle.zone.points },
    fillType: "voronoi",
    axis: "y",
    directInventory: true,
    assignOnly: false,
    placementStrategy: "bestFit",
    strictCoverage: false,
    coverageTarget: Number(params.coverageTarget || 0.999),
    coverageEps: Number(params.coverageEps || 0.002),
    seed: Number(oracle.seed || 1),
    qualityMode: "strict",
    rasterMm: Number(params.rFinal || 2),
    maxSolveMs: 15000,
    maxPieces: 8,
    maxPointsPerCandidate: Number(params.maxPointsPerCandidate || 120),
    minGainAreaMm2: 30,
    pieceSeamReserveMm: seamReserveMm,
    constraints: {
      napDirectionDeg: 90,
      napToleranceDeg: Number(params.napTolDeg || 15),
      requireScrapContour: true
    },
    candidates
  };

  console.log(`Sending request: directInventory=true, seamReserve=${seamReserveMm}mm, maxPieces=8, pieces=${candidates.length}`);
  const result = await postJson("/api/layout/fill/preview", requestBody);

  if (!result.ok && result.resultStatus !== "ok") {
    console.log("Result status:", result.resultStatus, result.failedReason);
  }

  const placements = (result.placements || []).filter(p => String(p.status || "") === "matched");
  console.log(`Matched placements: ${placements.length}`);
  if (!placements.length) {
    console.log("No matched placements, can't check fragments");
    return;
  }

  // Проверяем наличие inZoneCoreContour
  for (let pi = 0; pi < placements.length; pi++) {
    const p = placements[pi];
    const hasCore = (Array.isArray(p.inZoneCoreContours) && p.inZoneCoreContours.length > 0) ||
                    (Array.isArray(p.inZoneCoreContour) && p.inZoneCoreContour.length >= 3);
    const hasFull = (Array.isArray(p.inZoneContours) && p.inZoneContours.length > 0) ||
                    (Array.isArray(p.inZoneContour) && p.inZoneContour.length >= 3);
    const coreArea = Number(p.inZoneCoreAreaMm2 || 0);
    const fullArea = Number(p.inZoneAreaMm2 || 0);
    console.log(`  placement[${pi}] hasCore=${hasCore} hasFull=${hasFull} coreArea=${coreArea.toFixed(0)} fullArea=${fullArea.toFixed(0)} diff=${(fullArea-coreArea).toFixed(0)}`);
  }

  // Воспроизводим алгоритм
  const matched = [];
  for (let pi = 0; pi < placements.length; pi++) {
    const p = placements[pi];
    const fullMp = Array.isArray(p.inZoneContours) && p.inZoneContours.length > 0
      ? p.inZoneContours
      : (Array.isArray(p.inZoneContour) && p.inZoneContour.length >= 3
        ? pointsToMultiPolygon(toPts(p.inZoneContour)) : []);
    const coreMp = Array.isArray(p.inZoneCoreContours) && p.inZoneCoreContours.length > 0
      ? p.inZoneCoreContours
      : (Array.isArray(p.inZoneCoreContour) && p.inZoneCoreContour.length >= 3
        ? pointsToMultiPolygon(toPts(p.inZoneCoreContour)) : []);
    matched.push({ pi, p, fullMp, coreMp });
  }

  let coveredCoresMp = [];
  const fragments = [];
  for (const { pi, fullMp, coreMp } of matched) {
    const fragmentMp = coveredCoresMp.length > 0 && fullMp.length > 0
      ? diffMulti(fullMp, coveredCoresMp)
      : fullMp;
    if (coreMp.length > 0) {
      coveredCoresMp = coveredCoresMp.length > 0 ? unionMulti(coveredCoresMp, coreMp) : coreMp;
    }
    fragments.push({ pi, fragmentMp, area: mpArea(fragmentMp) });
  }

  console.log(`\n--- Fragment areas ---`);
  let totalFragArea = 0;
  for (const { pi, area } of fragments) {
    console.log(`  frag[${pi}] area=${area.toFixed(0)}mm²`);
    totalFragArea += area;
  }

  // Проверка перекрытий
  console.log(`\n--- Overlap check ---`);
  let totalOverlap = 0;
  for (let i = 0; i < fragments.length; i++) {
    for (let j = i + 1; j < fragments.length; j++) {
      const overlap = intersectMulti(fragments[i].fragmentMp, fragments[j].fragmentMp);
      const oa = mpArea(overlap);
      if (oa > 1) {
        console.log(`  OVERLAP frag[${i}] x frag[${j}] = ${oa.toFixed(0)}mm²`);
        totalOverlap += oa;
      }
    }
  }
  if (totalOverlap === 0) console.log("  No overlaps ✓");
  else console.log(`  Total overlap: ${totalOverlap.toFixed(0)}mm²`);

  // Проверка дырок
  console.log(`\n--- Holes check ---`);
  const zonePts = oracle.zone && oracle.zone.points ? toPts(oracle.zone.points) : null;
  if (zonePts && zonePts.length >= 3) {
    const zoneMp = pointsToMultiPolygon(zonePts);
    const zoneArea = mpArea(zoneMp);
    let unionFrags = [];
    for (const { fragmentMp } of fragments) {
      if (fragmentMp.length > 0) unionFrags = unionFrags.length > 0 ? unionMulti(unionFrags, fragmentMp) : fragmentMp;
    }
    const holesInZone = diffMulti(zoneMp, unionFrags);
    const holesArea = mpArea(holesInZone);
    const coveredArea = mpArea(unionFrags);
    console.log(`  Zone: ${zoneArea.toFixed(0)}mm²  Covered: ${coveredArea.toFixed(0)}mm²  Holes: ${holesArea.toFixed(0)}mm²`);
    if (holesArea < 10) console.log("  No significant holes in zone ✓");
    else console.log(`  WARNING: holes = ${holesArea.toFixed(0)}mm²`);
  }

  // Итог из API fragments
  const apiFrag = result.fragments || [];
  console.log(`\nAPI returned ${apiFrag.length} fragments (from solverFragments block)`);
  if (apiFrag.length) {
    const totalApi = apiFrag.reduce((s, f) => s + Number(f.areaMm2 || 0), 0);
    console.log(`API fragments total area: ${totalApi.toFixed(0)}mm²`);
  }
}

main().catch(e => { console.error("Error:", e.message); process.exit(1); });
