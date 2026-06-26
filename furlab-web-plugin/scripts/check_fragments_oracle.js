"use strict";
// Тест с реальным oracle case — проверяем фрагменты из API
const http = require("http");
const fs = require("fs");
const path = require("path");
const { intersectMulti, unionMulti, pointsToMultiPolygon, diffMulti } = require("../src/services/polygon_ops");

function mpArea(mp) {
  let s = 0;
  for (const poly of (mp||[])) {
    for (let ri = 0; ri < poly.length; ri++) {
      const ring = poly[ri]; let a = 0;
      for (let i = 0; i < ring.length; i++) { const c=ring[i],n=ring[(i+1)%ring.length]; a+=c[0]*n[1]-n[0]*c[1]; }
      s += Math.abs(a)*0.5*(ri===0?1:-1);
    }
  }
  return Math.abs(s);
}
function toPts(arr) {
  return (arr||[]).map(q=>({x:Number(q&&q.x),y:Number(q&&q.y)})).filter(q=>isFinite(q.x)&&isFinite(q.y));
}

function postJson(routePath, body) {
  const data = JSON.stringify(body);
  return new Promise((resolve, reject) => {
    const req = http.request({
      method:"POST",hostname:"127.0.0.1",port:5600,path:routePath,
      headers:{"Content-Type":"application/json","Content-Length":Buffer.byteLength(data)},
      timeout:180000
    }, res => { let raw=""; res.on("data",c=>raw+=c); res.on("end",()=>resolve(JSON.parse(raw))); });
    req.on("error",reject);
    req.on("timeout",()=>req.destroy(new Error("timeout")));
    req.write(data); req.end();
  });
}

async function main() {
  const oracle = JSON.parse(fs.readFileSync(path.join(__dirname,"../oracle_case_zone_1_1772731241049.json")));
  const params = oracle.params || {};

  // Формируем candidates из pieces
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

  const body = {
    zone: { id: Number(oracle.zone.id || 1), points: oracle.zone.points },
    fillType: "voronoi",
    axis: "y",
    directInventory: true,
    assignOnly: false,
    placementStrategy: "bestFit",
    strictCoverage: true,
    coverageTarget: Number(params.coverageTarget || 0.999),
    coverageEps: Number(params.coverageEps || 0.002),
    seed: Number(oracle.seed || 1),
    qualityMode: "strict",
    rasterMm: Number(params.rFinal || 2),
    maxSolveMs: 60000,
    maxPieces: Number(params.maxPieces || 30),
    maxPointsPerCandidate: Number(params.maxPointsPerCandidate || 120),
    minGainAreaMm2: 30,
    pieceSeamReserveMm: 12,
    maxPieces: 30,
    constraints: {
      napDirectionDeg: 90,
      napToleranceDeg: Number(params.napTolDeg || 15),
      requireScrapContour: true
    },
    candidates
  };

  console.log(`Sending request: oracle zone_1, seam=0, maxPieces=${body.maxPieces}`);
  const result = await postJson("/api/layout/fill/preview", body);
  const matched = (result.placements||[]).filter(p => p.status === "matched");
  console.log(`Result: status=${result.resultStatus} matched=${matched.length} coverage=${(result.coveragePercent||0).toFixed(1)}%`);

  const apiFrag = result.fragments || [];
  console.log(`API fragments: ${apiFrag.length}`);
  if (!apiFrag.length) { console.log("No fragments"); return; }

  let totalArea = 0;
  for (const f of apiFrag) totalArea += Number(f.areaMm2 || 0);
  console.log(`Total fragments area: ${totalArea.toFixed(0)}mm²`);

  // Строим MPs из fragments
  const fragMps = apiFrag.map(f => {
    const pts = toPts(f.points || []);
    return pts.length >= 3 ? pointsToMultiPolygon(pts) : [];
  });

  // Overlap check
  console.log("\n--- Overlaps ---");
  let totalOverlap = 0;
  for (let i = 0; i < fragMps.length; i++) {
    for (let j = i+1; j < fragMps.length; j++) {
      const ov = intersectMulti(fragMps[i], fragMps[j]);
      const oa = mpArea(ov);
      if (oa > 1) {
        const fi = apiFrag[i], fj = apiFrag[j];
        console.log(`  frag[${i}](pi=${fi.ownerPlacementIndex},fallback=${fi.isFallbackFragment||false}) x frag[${j}](pi=${fj.ownerPlacementIndex},fallback=${fj.isFallbackFragment||false}) = ${oa.toFixed(0)}mm²`);
        totalOverlap += oa;
      }
    }
  }
  if (totalOverlap === 0) console.log("  No overlaps ✓");
  else console.log(`  Total: ${totalOverlap.toFixed(0)}mm²`);

  // Holes check
  console.log("\n--- Zone holes ---");
  const zoneMp = pointsToMultiPolygon(toPts(oracle.zone.points));
  const zoneArea = mpArea(zoneMp);
  let unionFrags = [];
  for (const mp of fragMps) {
    if (mp.length > 0) unionFrags = unionFrags.length > 0 ? unionMulti(unionFrags, mp) : mp;
  }
  const holes = diffMulti(zoneMp, unionFrags);
  const holesArea = mpArea(holes);
  console.log(`  Zone: ${zoneArea.toFixed(0)}mm²  Covered: ${mpArea(unionFrags).toFixed(0)}mm²  Holes: ${holesArea.toFixed(0)}mm²`);
  if (holesArea < 10) console.log("  No significant holes ✓");
  else console.log(`  WARNING: ${holesArea.toFixed(0)}mm² holes`);
}

main().catch(e => { console.error("Error:", e.message); process.exit(1); });
