"use strict";
const {
  generateRegularFragments,
  generateShiftedFragments,
  generateDiagonalFragments,
  generateRadialFragments,
  polygonArea,
  polygonBBox,
} = require("../../../src/services/fragment_generators");

// ---- shared fixtures ----

function sq(x, y, w, h) {
  return [{ x, y }, { x: x + w, y }, { x: x + w, y: y + h }, { x, y: y + h }];
}

const SQUARE = sq(0, 0, 600, 600);     // 600x600 mm
const WIDE   = sq(0, 0, 1200, 400);    // wide landscape

function totalArea(frags) {
  return frags.reduce((s, f) => s + polygonArea(f), 0);
}

function allInsideBBox(frags, zone) {
  const bbox = polygonBBox(zone);
  for (const f of frags) {
    for (const p of f) {
      if (p.x < bbox.minX - 1 || p.x > bbox.maxX + 1 ||
          p.y < bbox.minY - 1 || p.y > bbox.maxY + 1) return false;
    }
  }
  return true;
}

// ================================================================
// generateRegularFragments
// ================================================================

describe("generateRegularFragments", () => {

  test("returns non-empty array for valid zone", () => {
    const frags = generateRegularFragments(SQUARE, { rows: 3, cols: 3 });
    expect(frags.length).toBeGreaterThan(0);
  });

  test("3×3 grid → up to 9 fragments", () => {
    const frags = generateRegularFragments(SQUARE, { rows: 3, cols: 3 });
    expect(frags.length).toBeLessThanOrEqual(9);
    expect(frags.length).toBeGreaterThanOrEqual(1);
  });

  test("total area ≈ zone area (no gap)", () => {
    const frags = generateRegularFragments(SQUARE, { rows: 4, cols: 4 });
    const zoneArea = polygonArea(SQUARE);
    expect(totalArea(frags)).toBeGreaterThan(zoneArea * 0.90);
    expect(totalArea(frags)).toBeLessThanOrEqual(zoneArea * 1.01);
  });

  test("all fragments inside zone bbox", () => {
    const frags = generateRegularFragments(SQUARE, { rows: 3, cols: 3 });
    expect(allInsideBBox(frags, SQUARE)).toBe(true);
  });

  test("with gap: total area < zone area", () => {
    const frags = generateRegularFragments(SQUARE, { rows: 3, cols: 3, gapX: 10, gapY: 10 });
    expect(totalArea(frags)).toBeLessThan(polygonArea(SQUARE));
  });

  test("more rows+cols → more fragments", () => {
    const f3 = generateRegularFragments(SQUARE, { rows: 3, cols: 3 });
    const f5 = generateRegularFragments(SQUARE, { rows: 5, cols: 5 });
    expect(f5.length).toBeGreaterThanOrEqual(f3.length);
  });

  test("empty zone → returns []", () => {
    expect(generateRegularFragments([], { rows: 3, cols: 3 })).toEqual([]);
  });

  test("degenerate zone (< 3 pts) → returns []", () => {
    expect(generateRegularFragments([{ x: 0, y: 0 }, { x: 100, y: 0 }], { rows: 2, cols: 2 })).toEqual([]);
  });

  test("same seed → same result (deterministic)", () => {
    const opts = { rows: 3, cols: 3, variability: 8, seed: 42 };
    const f1 = generateRegularFragments(SQUARE, opts);
    const f2 = generateRegularFragments(SQUARE, opts);
    expect(f1.length).toBe(f2.length);
    expect(f1[0][0]).toEqual(f2[0][0]);
  });

  test("each fragment has ≥ 3 points", () => {
    const frags = generateRegularFragments(WIDE, { rows: 2, cols: 4 });
    for (const f of frags) expect(f.length).toBeGreaterThanOrEqual(3);
  });
});

// ================================================================
// generateShiftedFragments
// ================================================================

describe("generateShiftedFragments", () => {

  test("returns non-empty array", () => {
    expect(generateShiftedFragments(SQUARE, { rows: 3, cols: 3 }).length).toBeGreaterThan(0);
  });

  test("total area ≈ zone area (no gap)", () => {
    const frags = generateShiftedFragments(SQUARE, { rows: 4, cols: 4 });
    const zoneArea = polygonArea(SQUARE);
    expect(totalArea(frags)).toBeGreaterThan(zoneArea * 0.90);
    expect(totalArea(frags)).toBeLessThanOrEqual(zoneArea * 1.01);
  });

  test("all fragments inside zone bbox", () => {
    const frags = generateShiftedFragments(SQUARE, { rows: 3, cols: 3, shiftPercent: 50 });
    expect(allInsideBBox(frags, SQUARE)).toBe(true);
  });

  test("shifted rows produce more cells than unshifted (shiftPercent > 0)", () => {
    // With shift, odd rows get an extra cell spilling outside bbox → more or equal frags
    const fShift = generateShiftedFragments(SQUARE, { rows: 4, cols: 3, shiftPercent: 50 });
    const fNoShift = generateShiftedFragments(SQUARE, { rows: 4, cols: 3, shiftPercent: 0 });
    expect(fShift.length).toBeGreaterThanOrEqual(fNoShift.length);
  });

  test("with gap: total area < zone area", () => {
    const frags = generateShiftedFragments(SQUARE, { rows: 3, cols: 3, gapX: 15, gapY: 15 });
    expect(totalArea(frags)).toBeLessThan(polygonArea(SQUARE));
  });

  test("empty zone → returns []", () => {
    expect(generateShiftedFragments([], { rows: 3, cols: 3 })).toEqual([]);
  });
});

// ================================================================
// generateDiagonalFragments
// ================================================================

describe("generateDiagonalFragments", () => {

  test("returns non-empty array for square zone", () => {
    expect(generateDiagonalFragments(SQUARE, { angleDeg: 45, bandStepMm: 150 }).length).toBeGreaterThan(0);
  });

  test("total area ≈ zone area (no gap)", () => {
    const frags = generateDiagonalFragments(SQUARE, { angleDeg: 45, bandStepMm: 120, axisCount: 0 });
    expect(totalArea(frags)).toBeGreaterThan(polygonArea(SQUARE) * 0.90);
    expect(totalArea(frags)).toBeLessThanOrEqual(polygonArea(SQUARE) * 1.01);
  });

  test("all fragments inside zone bbox", () => {
    const frags = generateDiagonalFragments(SQUARE, { angleDeg: 30, bandStepMm: 100 });
    expect(allInsideBBox(frags, SQUARE)).toBe(true);
  });

  test("smaller bandStep → more fragments", () => {
    const fBig  = generateDiagonalFragments(SQUARE, { angleDeg: 45, bandStepMm: 200, axisCount: 0 });
    const fSmall = generateDiagonalFragments(SQUARE, { angleDeg: 45, bandStepMm: 100, axisCount: 0 });
    expect(fSmall.length).toBeGreaterThanOrEqual(fBig.length);
  });

  test("negative angle (opposite diagonal) also works", () => {
    const frags = generateDiagonalFragments(SQUARE, { angleDeg: -45, bandStepMm: 120, axisCount: 0 });
    expect(frags.length).toBeGreaterThan(0);
    expect(allInsideBBox(frags, SQUARE)).toBe(true);
  });

  test("angleDeg=0 (horizontal bands) works", () => {
    const frags = generateDiagonalFragments(SQUARE, { angleDeg: 0, bandStepMm: 150, axisCount: 0 });
    expect(frags.length).toBeGreaterThan(0);
  });

  test("herringbone (axisCount=1) works", () => {
    const frags = generateDiagonalFragments(SQUARE, { angleDeg: 45, bandStepMm: 120, axisCount: 1 });
    expect(frags.length).toBeGreaterThan(0);
    expect(allInsideBBox(frags, SQUARE)).toBe(true);
  });

  test("with gap: total area < zone area", () => {
    const frags = generateDiagonalFragments(SQUARE, { angleDeg: 45, bandStepMm: 120, axisCount: 0, gapX: 10 });
    expect(totalArea(frags)).toBeLessThan(polygonArea(SQUARE));
  });

  test("empty zone → returns []", () => {
    expect(generateDiagonalFragments([], { angleDeg: 45, bandStepMm: 100 })).toEqual([]);
  });
});

// ================================================================
// generateRadialFragments
// ================================================================

describe("generateRadialFragments", () => {

  test("returns non-empty array for square zone", () => {
    const frags = generateRadialFragments(SQUARE, { ringCount: 2, sectorCount: 8 });
    expect(frags.length).toBeGreaterThan(0);
  });

  test("total area ≈ zone area (no gap)", () => {
    const frags = generateRadialFragments(SQUARE, { ringCount: 3, sectorCount: 8 });
    const zoneArea = polygonArea(SQUARE);
    expect(totalArea(frags)).toBeGreaterThan(zoneArea * 0.85);
    expect(totalArea(frags)).toBeLessThanOrEqual(zoneArea * 1.01);
  });

  test("all fragments inside zone bbox", () => {
    const frags = generateRadialFragments(SQUARE, { ringCount: 2, sectorCount: 6 });
    expect(allInsideBBox(frags, SQUARE)).toBe(true);
  });

  test("more rings → more fragments", () => {
    const f2 = generateRadialFragments(SQUARE, { ringCount: 2, sectorCount: 8 });
    const f4 = generateRadialFragments(SQUARE, { ringCount: 4, sectorCount: 8 });
    expect(f4.length).toBeGreaterThanOrEqual(f2.length);
  });

  test("more sectors → more fragments", () => {
    const f4 = generateRadialFragments(SQUARE, { ringCount: 2, sectorCount: 4 });
    const f8 = generateRadialFragments(SQUARE, { ringCount: 2, sectorCount: 8 });
    expect(f8.length).toBeGreaterThanOrEqual(f4.length);
  });

  test("with gap: total area < zone area", () => {
    const frags = generateRadialFragments(SQUARE, { ringCount: 2, sectorCount: 8, gapX: 10 });
    expect(totalArea(frags)).toBeLessThan(polygonArea(SQUARE));
  });

  test("innerRadius > 0 with gap → area < full zone area", () => {
    // gap prevents fillRemainderIntoFrags from merging the center hole back in
    const frags = generateRadialFragments(SQUARE, { ringCount: 2, sectorCount: 8, innerRadiusMm: 100, gapX: 1 });
    expect(totalArea(frags)).toBeLessThan(polygonArea(SQUARE));
  });

  test("rotation shifts all fragments (different first-fragment centroids)", () => {
    const f0  = generateRadialFragments(SQUARE, { ringCount: 1, sectorCount: 4, rotationDeg: 0 });
    const f45 = generateRadialFragments(SQUARE, { ringCount: 1, sectorCount: 4, rotationDeg: 45 });
    if (f0.length && f45.length) {
      const cx0  = f0[0].reduce((s, p) => s + p.x, 0) / f0[0].length;
      const cx45 = f45[0].reduce((s, p) => s + p.x, 0) / f45[0].length;
      expect(Math.abs(cx0 - cx45)).toBeGreaterThan(1);
    }
  });

  test("empty zone → returns []", () => {
    expect(generateRadialFragments([], { ringCount: 2, sectorCount: 8 })).toEqual([]);
  });

  test("each fragment has ≥ 3 points", () => {
    const frags = generateRadialFragments(SQUARE, { ringCount: 2, sectorCount: 8 });
    for (const f of frags) expect(f.length).toBeGreaterThanOrEqual(3);
  });
});
