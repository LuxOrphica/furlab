"use strict";
// Минимальный тест: 3 прямоугольных куска в прямоугольной зоне, seamReserve=12мм
// node scripts/check_fragments_minimal.js

const http = require("http");
const { diffMulti, unionMulti, pointsToMultiPolygon, intersectMulti } = require("../src/services/polygon_ops");

function mpArea(mp) {
  if (!Array.isArray(mp)) return 0;
  let s = 0;
  for (const poly of mp) {
    if (!Array.isArray(poly)) continue;
    for (let ri = 0; ri < poly.length; ri++) {
      const ring = poly[ri];
      let a = 0;
      for (let i = 0; i < ring.length; i++) {
        const c = ring[i], n = ring[(i + 1) % ring.length];
        a += c[0] * n[1] - n[0] * c[1];
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

function postJson(routePath, body) {
  const data = JSON.stringify(body);
  return new Promise((resolve, reject) => {
    const req = http.request({
      method: "POST", hostname: "127.0.0.1", port: 5600, path: routePath,
      headers: { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(data) },
      timeout: 120000
    }, res => {
      let raw = "";
      res.on("data", c => raw += c);
      res.on("end", () => resolve(JSON.parse(raw)));
    });
    req.on("error", reject);
    req.on("timeout", () => req.destroy(new Error("timeout")));
    req.write(data); req.end();
  });
}

// Зона 250×200мм (3 куска 120×200 должны покрыть её при seam=12мм — их ядра 96мм + перекрытие)
const zone = {
  id: 99,
  points: [
    { x: 0, y: 0 }, { x: 250, y: 0 }, { x: 250, y: 200 }, { x: 0, y: 200 }
  ]
};

// 3 куска ~120×200мм каждый (перекрываются по припуску 12мм)
function makeRectScrap(x1, y1, x2, y2) {
  return JSON.stringify({ path: [
    { x: x1, y: y1 }, { x: x2, y: y1 }, { x: x2, y: y2 }, { x: x1, y: y2 }
  ]});
}

const seam = 12;
const candidates = [
  { id: "p1", inventoryTag: "p1", areaMm2: 24000, bboxWidthMm: 120, bboxHeightMm: 200,
    napDirectionDeg: 90, scrapContour: makeRectScrap(0, 0, 120, 200) },
  { id: "p2", inventoryTag: "p2", areaMm2: 24000, bboxWidthMm: 120, bboxHeightMm: 200,
    napDirectionDeg: 90, scrapContour: makeRectScrap(0, 0, 120, 200) },
  { id: "p3", inventoryTag: "p3", areaMm2: 24000, bboxWidthMm: 120, bboxHeightMm: 200,
    napDirectionDeg: 90, scrapContour: makeRectScrap(0, 0, 120, 200) }
];

const requestBody = {
  zone,
  fillType: "voronoi",
  axis: "y",
  directInventory: true,
  assignOnly: false,
  placementStrategy: "bestFit",
  strictCoverage: false,
  coverageTarget: 0.99,
  coverageEps: 0.01,
  seed: 42,
  qualityMode: "strict",
  rasterMm: 5,
  maxSolveMs: 10000,
  maxPieces: 10,
  maxPointsPerCandidate: 30,
  minGainAreaMm2: 100,
  pieceSeamReserveMm: seam,
  constraints: { napDirectionDeg: 90, napToleranceDeg: 45, requireScrapContour: true },
  candidates
};

async function main() {
  console.log(`Sending request: 3 pieces 120×200mm, zone 300×200mm, seam=${seam}mm`);
  const result = await postJson("/api/layout/fill/preview", requestBody);
  console.log(`Result: ok=${result.ok}, status=${result.resultStatus}, matched=${(result.placements||[]).filter(p=>p.status==="matched").length}`);

  const placements = (result.placements || []).filter(p => String(p.status || "") === "matched");
  if (!placements.length) {
    console.log("No matched placements.");
    return;
  }

  // Проверяем inZoneCoreContour
  for (let pi = 0; pi < placements.length; pi++) {
    const p = placements[pi];
    const coreArea = Number(p.inZoneCoreAreaMm2 || 0);
    const fullArea = Number(p.inZoneAreaMm2 || 0);
    const hasCore = (p.inZoneCoreContours||[]).length > 0 || (p.inZoneCoreContour||[]).length >= 3;
    console.log(`  p[${pi}] tag=${p.inventoryTag} fullArea=${fullArea.toFixed(0)} coreArea=${coreArea.toFixed(0)} diff=${(fullArea-coreArea).toFixed(0)} hasCore=${hasCore}`);
  }

  // Используем fragments из ответа API (сформированные сервером)
  const apiFrag = result.fragments || [];
  console.log(`\nAPI fragments: ${apiFrag.length}`);
  if (!apiFrag.length) { console.log("No fragments in API response"); return; }

  // Строим multipolygons из API фрагментов
  const fragments = apiFrag.map((f, i) => {
    const pts = (f.points || []).map(q => ({ x: Number(q.x), y: Number(q.y) })).filter(q => Number.isFinite(q.x) && Number.isFinite(q.y));
    const mp = pts.length >= 3 ? pointsToMultiPolygon(pts) : [];
    const area = Number(f.areaMm2 || 0);
    console.log(`  frag[${i}] pi=${f.ownerPlacementIndex} area=${area.toFixed(0)}mm²`);
    return { i, mp, area };
  });

  // Перекрытия между фрагментами
  console.log(`\n--- Overlaps (API fragments) ---`);
  let totalOverlap = 0;
  for (let i = 0; i < fragments.length; i++) {
    for (let j = i + 1; j < fragments.length; j++) {
      const ov = intersectMulti(fragments[i].mp, fragments[j].mp);
      const oa = mpArea(ov);
      if (oa > 1) { console.log(`  frag[${i}] x frag[${j}] = ${oa.toFixed(0)}mm²`); totalOverlap += oa; }
    }
  }
  if (totalOverlap === 0) console.log("  No overlaps ✓");
  else console.log(`  Total overlap: ${totalOverlap.toFixed(0)}mm²`);

  // Дырки в зоне
  console.log(`\n--- Zone holes (API fragments) ---`);
  const zoneMp = pointsToMultiPolygon(toPts(zone.points));
  const zoneArea = mpArea(zoneMp);
  let unionFrags = [];
  for (const { mp } of fragments) {
    if (mp.length > 0) unionFrags = unionFrags.length > 0 ? unionMulti(unionFrags, mp) : mp;
  }
  const holes = diffMulti(zoneMp, unionFrags);
  const holesArea = mpArea(holes);
  console.log(`  Zone: ${zoneArea.toFixed(0)}mm²  Covered: ${mpArea(unionFrags).toFixed(0)}mm²  Holes: ${holesArea.toFixed(0)}mm²`);
  if (holesArea < 10) console.log("  No significant holes ✓");
  else console.log(`  WARNING: ${holesArea.toFixed(0)}mm² holes`);
}

main().catch(e => { console.error("Error:", e.message); process.exit(1); });
