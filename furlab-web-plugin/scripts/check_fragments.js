"use strict";
// Проверяет алгоритм фрагментов на данных из result.json
// Запуск: node scripts/check_fragments.js <path_to_result.json>

const fs = require("fs");
const path = require("path");

const { diffMulti, unionMulti, pointsToMultiPolygon, intersectMulti } = require("../src/services/polygon_ops");

function mpArea(mp) {
  if (!Array.isArray(mp)) return 0;
  let s = 0;
  for (const poly of mp) {
    if (!Array.isArray(poly)) continue;
    for (let ri = 0; ri < poly.length; ri++) {
      const ring = poly[ri];
      if (!Array.isArray(ring) || ring.length < 3) continue;
      let a = 0;
      for (let i = 0; i < ring.length; i++) {
        const cur = ring[i];
        const nxt = ring[(i + 1) % ring.length];
        a += cur[0] * nxt[1] - nxt[0] * cur[1];
      }
      const area = Math.abs(a) * 0.5;
      s += ri === 0 ? area : -area;
    }
  }
  return Math.abs(s);
}

function toPts(arr) {
  return (arr || []).map((q) => ({ x: Number(q && q.x), y: Number(q && q.y) }))
    .filter((q) => Number.isFinite(q.x) && Number.isFinite(q.y));
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

const resultPath = process.argv[2] || path.join(__dirname, "../tmp/test_runs/2026-03-09T21-08-55-177Z/oracle_case_zone_1_1772731241049/result.json");
const result = JSON.parse(fs.readFileSync(resultPath, "utf8"));

const placements = (result.placements || []).filter(p => String(p.status || "") === "matched");
console.log(`Placements matched: ${placements.length}`);

// Воспроизводим алгоритм из layout.js
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
  console.log(`  [${pi}] fullMp polys=${fullMp.length} fullArea=${mpArea(fullMp).toFixed(0)}mm² | coreMp polys=${coreMp.length} coreArea=${mpArea(coreMp).toFixed(0)}mm²`);
}

let coveredCoresMp = [];
const solverFragments = [];
for (const { pi, p, fullMp, coreMp } of matched) {
  const fragmentMp = coveredCoresMp.length > 0 && fullMp.length > 0
    ? diffMulti(fullMp, coveredCoresMp)
    : fullMp;
  if (coreMp.length > 0) {
    coveredCoresMp = coveredCoresMp.length > 0
      ? unionMulti(coveredCoresMp, coreMp)
      : coreMp;
  }
  const fragArea = mpArea(fragmentMp);
  solverFragments.push({ pi, fragmentMp, fragArea });
}

console.log(`\n--- Fragment areas ---`);
let totalFragArea = 0;
for (const { pi, fragArea } of solverFragments) {
  console.log(`  frag[${pi}] area=${fragArea.toFixed(0)}mm²`);
  totalFragArea += fragArea;
}
console.log(`Total fragments area: ${totalFragArea.toFixed(0)}mm²`);

// Проверяем перекрытия между фрагментами
console.log(`\n--- Overlap check ---`);
let totalOverlap = 0;
for (let i = 0; i < solverFragments.length; i++) {
  for (let j = i + 1; j < solverFragments.length; j++) {
    const overlap = intersectMulti(solverFragments[i].fragmentMp, solverFragments[j].fragmentMp);
    const oa = mpArea(overlap);
    if (oa > 1) {
      console.log(`  OVERLAP frag[${i}] x frag[${j}] = ${oa.toFixed(0)}mm²`);
      totalOverlap += oa;
    }
  }
}
if (totalOverlap === 0) console.log("  No overlaps ✓");
else console.log(`  Total overlap: ${totalOverlap.toFixed(0)}mm²`);

// Проверяем покрытие зоны — объединяем все фрагменты и сравниваем с зоной
console.log(`\n--- Zone coverage check ---`);
const zonePts = (result.zone && result.zone.points) ? toPts(result.zone.points) : null;
if (zonePts && zonePts.length >= 3) {
  const zoneMp = pointsToMultiPolygon(zonePts);
  const zoneArea = mpArea(zoneMp);
  console.log(`Zone area: ${zoneArea.toFixed(0)}mm²`);

  let unionFrags = [];
  for (const { fragmentMp } of solverFragments) {
    if (fragmentMp.length > 0) {
      unionFrags = unionFrags.length > 0 ? unionMulti(unionFrags, fragmentMp) : fragmentMp;
    }
  }
  const coveredArea = mpArea(unionFrags);
  console.log(`Covered by fragments: ${coveredArea.toFixed(0)}mm²`);

  // Дырки = зона минус покрытие фрагментами
  const holes = diffMulti(zoneMp, unionFrags);
  const holesArea = mpArea(holes);
  console.log(`Holes (zone - fragments): ${holesArea.toFixed(0)}mm²`);
  if (holesArea < 10) console.log("  No significant holes ✓");
  else console.log(`  WARNING: holes = ${holesArea.toFixed(0)}mm²`);
} else {
  console.log("  Zone not available in result, checking total area only");
  // Сравниваем с суммой inZoneContour всех кусков
  let totalInZone = 0;
  for (const { p } of matched) totalInZone += mpArea(
    Array.isArray(p.inZoneContours) && p.inZoneContours.length > 0
      ? p.inZoneContours : pointsToMultiPolygon(toPts(p.inZoneContour))
  );
  console.log(`Sum of inZoneContour areas: ${totalInZone.toFixed(0)}mm²`);
  console.log(`Total fragments: ${totalFragArea.toFixed(0)}mm²`);
}
