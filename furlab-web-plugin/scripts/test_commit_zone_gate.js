"use strict";
// Тест: commitZoneMutation gate — проверяем что:
// 1. candidate с gap → {ok: false, reason: 'partition'}, state.zones не изменён
// 2. candidate корректный → {ok: true}, state.zones обновлён
// 3. candidate с geometry error → {ok: false, reason: 'geometry'}
//
// Запуск: node scripts/test_commit_zone_gate.js

// Воспроизводим логику commitZoneMutation в изоляции (Node.js, без браузера).
// Используем validatePartZonePartition из публичного geom.js через jsdom или inline.

const assert = require("assert");

// --- Inline minimal geometry ---

function polygonArea(pts) {
  let s = 0;
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i], b = pts[(i + 1) % pts.length];
    s += a.x * b.y - b.x * a.y;
  }
  return s / 2;
}

// Minimal validatePartZonePartition: checks that union of zone areas ≈ partArea, no gap/overlap
function validatePartZonePartition(partContour, zones) {
  const issues = [];
  if (!Array.isArray(partContour) || partContour.length < 3) return issues;
  if (!Array.isArray(zones) || zones.length === 0) {
    issues.push({ code: "no_zones", message: "No zones", severity: "error" });
    return issues;
  }
  const partArea = Math.abs(polygonArea(partContour));
  const sumAreas = zones.reduce((s, z) => s + (Array.isArray(z.points) ? Math.abs(polygonArea(z.points)) : 0), 0);
  if (Math.abs(sumAreas - partArea) > 2) {
    issues.push({ code: "gap_or_overlap", message: `Area mismatch: partArea=${partArea.toFixed(1)} sumAreas=${sumAreas.toFixed(1)}`, severity: "error" });
  }
  return issues;
}

function validateZoneGeometryClient(zone) {
  const issues = [];
  const outer = Array.isArray(zone && zone.points) ? zone.points : [];
  if (outer.length < 3) {
    issues.push({ code: "invalid_outer_contour", message: "Less than 3 points", severity: "error" });
  }
  return issues;
}

// --- Fake state ---
function makeState(zones) {
  return { zones: zones.slice(), _lastCommitOp: null };
}

// --- Fake commitZoneMutation (mirrors app.js logic) ---
async function commitZoneMutation({ operationType, beforeZones, candidateZones, affectedDetailId, skipValidation, deferPersist }, state, geom) {
  if (!skipValidation) {
    // 1. geometry
    const geomErrors = [];
    for (const z of candidateZones) {
      const issues = validateZoneGeometryClient(z);
      for (const issue of issues) {
        if (issue.severity === "error") geomErrors.push({ zoneId: z.id, issue });
      }
    }
    if (geomErrors.length > 0) {
      state.zones = beforeZones;
      return { ok: false, reason: "geometry", issues: geomErrors };
    }
    // 2. partition
    if (affectedDetailId) {
      const partContour = geom.getPartContour(affectedDetailId);
      if (partContour && partContour.length >= 3) {
        const candidatesForPart = candidateZones.filter((z) => Number(z.detailId || 0) === affectedDetailId);
        const partIssues = validatePartZonePartition(partContour, candidatesForPart);
        const partErrors = partIssues.filter((i) => i.severity === "error");
        if (partErrors.length > 0) {
          state.zones = beforeZones;
          return { ok: false, reason: "partition", issues: partErrors };
        }
      }
    }
  }
  // commit
  state.zones = candidateZones;
  state._lastCommitOp = operationType;
  return { ok: true };
}

// --- Tests ---

let passed = 0;
let failed = 0;
function ok(label, cond) {
  if (cond) { console.log(`  ✓ ${label}`); passed++; }
  else { console.error(`  ✗ FAIL: ${label}`); failed++; }
}

// Part contour: square 100x100
const partContour = [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 100 }, { x: 0, y: 100 }];
const detailId = 1;

// Fake geom
const geom = { getPartContour: (id) => id === detailId ? partContour : null };

(async () => {
  // --- Test 1: Candidate with gap (only covers 60% of part) ---
  console.log("\nTest 1: candidate with gap → gate must reject");
  {
    const zone1 = { id: 10, detailId, points: [{ x: 0, y: 0 }, { x: 60, y: 0 }, { x: 60, y: 100 }, { x: 0, y: 100 }] };
    const stateA = makeState([{ id: 99, detailId, points: partContour }]);
    const beforeZones = stateA.zones.slice();
    const result = await commitZoneMutation({
      operationType: "split-line",
      beforeZones,
      candidateZones: [zone1], // only 60x100 = 6000, partArea = 10000 → gap 4000
      affectedDetailId: detailId
    }, stateA, geom);
    ok("result.ok === false", result.ok === false);
    ok("result.reason === 'partition'", result.reason === "partition");
    ok("state.zones unchanged (rollback)", stateA.zones === beforeZones);
    ok("state.zones length unchanged", stateA.zones.length === beforeZones.length);
  }

  // --- Test 2: Correct candidate (two zones covering full part) ---
  console.log("\nTest 2: correct candidate → gate must accept");
  {
    const zoneA = { id: 10, detailId, points: [{ x: 0, y: 0 }, { x: 50, y: 0 }, { x: 50, y: 100 }, { x: 0, y: 100 }] };
    const zoneB = { id: 11, detailId, points: [{ x: 50, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 100 }, { x: 50, y: 100 }] };
    const stateB = makeState([{ id: 99, detailId, points: partContour }]);
    const beforeZones = stateB.zones.slice();
    const result = await commitZoneMutation({
      operationType: "split-line",
      beforeZones,
      candidateZones: [zoneA, zoneB], // 5000 + 5000 = 10000 = partArea → ok
      affectedDetailId: detailId
    }, stateB, geom);
    ok("result.ok === true", result.ok === true);
    ok("state.zones updated to candidates", stateB.zones.length === 2);
    ok("state._lastCommitOp set", stateB._lastCommitOp === "split-line");
  }

  // --- Test 3: Candidate with geometry error (< 3 points) ---
  console.log("\nTest 3: candidate with geometry error → gate must reject");
  {
    const badZone = { id: 10, detailId, points: [{ x: 0, y: 0 }, { x: 50, y: 0 }] }; // only 2 points
    const stateC = makeState([{ id: 99, detailId, points: partContour }]);
    const beforeZones = stateC.zones.slice();
    const result = await commitZoneMutation({
      operationType: "draw-zone",
      beforeZones,
      candidateZones: [badZone],
      affectedDetailId: detailId
    }, stateC, geom);
    ok("result.ok === false", result.ok === false);
    ok("result.reason === 'geometry'", result.reason === "geometry");
    ok("state.zones rollback on geometry error", stateC.zones === beforeZones);
  }

  // --- Test 4: skipValidation — system operations pass through ---
  console.log("\nTest 4: skipValidation=true → gate accepts any state");
  {
    const badZone = { id: 10, detailId, points: [{ x: 0, y: 0 }] }; // invalid but skipped
    const stateD = makeState([]);
    const beforeZones = stateD.zones.slice();
    const result = await commitZoneMutation({
      operationType: "load",
      beforeZones,
      candidateZones: [badZone],
      affectedDetailId: detailId,
      skipValidation: true
    }, stateD, geom);
    ok("result.ok === true with skipValidation", result.ok === true);
    ok("state.zones updated despite invalid zones", stateD.zones.length === 1);
  }

  // --- Summary ---
  console.log(`\n─────────────────────────────`);
  console.log(`Tests: ${passed + failed} | Passed: ${passed} | Failed: ${failed}`);
  if (failed > 0) process.exit(1);
})();
