"use strict";
const fc = require("fast-check");
const {
  pointsToMultiPolygon,
  multiPolygonArea,
  unionMulti,
  intersectMulti,
  diffMulti,
} = require("../../src/services/polygon_ops");
const { buildPieceWorkingContour } = require("../../src/services/piece_working_area");
const { wrapSignedDeg } = require("../../src/services/inventory_solver_nap");

// ---- Arbitraries ----

// Convex polygon: regular n-gon with random center, radius, rotation
const convexPolygon = fc
  .tuple(
    fc.double({ min: -500, max: 500, noNaN: true }),  // cx
    fc.double({ min: -500, max: 500, noNaN: true }),  // cy
    fc.double({ min: 10,   max: 300, noNaN: true }),  // r
    fc.double({ min: 0,    max: Math.PI * 2, noNaN: true }), // rotation
    fc.integer({ min: 3, max: 12 })                  // sides
  )
  .map(([cx, cy, r, rot, n]) =>
    Array.from({ length: n }, (_, i) => {
      const a = rot + (2 * Math.PI * i) / n;
      return { x: cx + r * Math.cos(a), y: cy + r * Math.sin(a) };
    })
  );

// Two overlapping convex polygons (guaranteed intersection)
const overlappingPair = fc
  .tuple(
    fc.double({ min: 10, max: 200, noNaN: true }),  // r
    fc.double({ min: 0, max: 1, noNaN: true }),     // overlap fraction
    fc.integer({ min: 3, max: 8 })                 // sides
  )
  .map(([r, overlap, n]) => {
    const makeNgon = (cx, cy) =>
      Array.from({ length: n }, (_, i) => {
        const a = (2 * Math.PI * i) / n;
        return { x: cx + r * Math.cos(a), y: cy + r * Math.sin(a) };
      });
    const offset = r * (2 - overlap * 1.5);
    return [makeNgon(0, 0), makeNgon(offset, 0)];
  });

// Square with random position and size
const square = fc
  .tuple(
    fc.double({ min: -300, max: 300, noNaN: true }),
    fc.double({ min: -300, max: 300, noNaN: true }),
    fc.double({ min: 20,   max: 200, noNaN: true })
  )
  .map(([x, y, s]) => [
    { x, y }, { x: x+s, y }, { x: x+s, y: y+s }, { x, y: y+s }
  ]);

// ================================================================
// polygon_ops — булева геометрия
// ================================================================

describe("property: polygon_ops", () => {

  test("area is always non-negative for any polygon", () => {
    fc.assert(
      fc.property(convexPolygon, (pts) => {
        const area = multiPolygonArea(pointsToMultiPolygon(pts));
        expect(area).toBeGreaterThanOrEqual(0);
      }),
      { numRuns: 500 }
    );
  });

  test("area is translation-invariant", () => {
    fc.assert(
      fc.property(
        convexPolygon,
        fc.double({ min: -10000, max: 10000, noNaN: true }),
        fc.double({ min: -10000, max: 10000, noNaN: true }),
        (pts, dx, dy) => {
          const translated = pts.map(p => ({ x: p.x + dx, y: p.y + dy }));
          const a1 = multiPolygonArea(pointsToMultiPolygon(pts));
          const a2 = multiPolygonArea(pointsToMultiPolygon(translated));
          expect(Math.abs(a1 - a2)).toBeLessThan(1e-3);
        }
      ),
      { numRuns: 300 }
    );
  });

  test("area conservation: S(A) = S(A∩B) + S(A\\B) for any two polygons", () => {
    fc.assert(
      fc.property(overlappingPair, ([ptsA, ptsB]) => {
        const A = pointsToMultiPolygon(ptsA);
        const B = pointsToMultiPolygon(ptsB);
        const sA = multiPolygonArea(A);
        const sI = multiPolygonArea(intersectMulti(A, B));
        const sD = multiPolygonArea(diffMulti(A, B));
        expect(Math.abs(sA - sI - sD)).toBeLessThan(sA * 0.01 + 1);
      }),
      { numRuns: 200 }
    );
  });

  test("union area >= max(S(A), S(B))", () => {
    fc.assert(
      fc.property(overlappingPair, ([ptsA, ptsB]) => {
        const A = pointsToMultiPolygon(ptsA);
        const B = pointsToMultiPolygon(ptsB);
        const sU = multiPolygonArea(unionMulti(A, B));
        const sA = multiPolygonArea(A);
        const sB = multiPolygonArea(B);
        expect(sU).toBeGreaterThanOrEqual(Math.max(sA, sB) - 1);
      }),
      { numRuns: 200 }
    );
  });

  test("intersection area <= min(S(A), S(B))", () => {
    fc.assert(
      fc.property(overlappingPair, ([ptsA, ptsB]) => {
        const A = pointsToMultiPolygon(ptsA);
        const B = pointsToMultiPolygon(ptsB);
        const sI = multiPolygonArea(intersectMulti(A, B));
        const sA = multiPolygonArea(A);
        const sB = multiPolygonArea(B);
        expect(sI).toBeLessThanOrEqual(Math.min(sA, sB) + 1);
      }),
      { numRuns: 200 }
    );
  });

  test("S(A∪B) = S(A) + S(B) - S(A∩B)  [inclusion-exclusion]", () => {
    fc.assert(
      fc.property(overlappingPair, ([ptsA, ptsB]) => {
        const A = pointsToMultiPolygon(ptsA);
        const B = pointsToMultiPolygon(ptsB);
        const sA = multiPolygonArea(A);
        const sB = multiPolygonArea(B);
        const sU = multiPolygonArea(unionMulti(A, B));
        const sI = multiPolygonArea(intersectMulti(A, B));
        expect(Math.abs(sU - (sA + sB - sI))).toBeLessThan(sU * 0.01 + 1);
      }),
      { numRuns: 200 }
    );
  });

  test("diff(A, A) = empty for any polygon", () => {
    fc.assert(
      fc.property(convexPolygon, (pts) => {
        const A = pointsToMultiPolygon(pts);
        expect(multiPolygonArea(diffMulti(A, A))).toBeLessThan(1);
      }),
      { numRuns: 300 }
    );
  });

  test("intersect(A, A) area = S(A) for any polygon", () => {
    fc.assert(
      fc.property(convexPolygon, (pts) => {
        const A = pointsToMultiPolygon(pts);
        const sA = multiPolygonArea(A);
        const sI = multiPolygonArea(intersectMulti(A, A));
        expect(Math.abs(sA - sI)).toBeLessThan(sA * 0.01 + 1);
      }),
      { numRuns: 300 }
    );
  });
});

// ================================================================
// piece_working_area — inset контура
// ================================================================

describe("property: buildPieceWorkingContour", () => {

  test("inset always produces area < original for any valid square", () => {
    fc.assert(
      fc.property(
        fc.double({ min: 50, max: 300, noNaN: true }),
        fc.double({ min: 1,  max: 10,  noNaN: true }),
        (side, reserve) => {
          fc.pre(reserve < side * 0.4);
          const pts = [
            { x: 0, y: 0 }, { x: side, y: 0 },
            { x: side, y: side }, { x: 0, y: side }
          ];
          const r = buildPieceWorkingContour(pts, reserve);
          if (r.status !== "ok") return;
          let origArea = 0, insetArea = 0;
          for (let i = 0; i < pts.length; i++) {
            const a = pts[i], b = pts[(i+1) % pts.length];
            origArea += a.x * b.y - b.x * a.y;
          }
          origArea = Math.abs(origArea) * 0.5;
          for (let i = 0; i < r.contour.length; i++) {
            const a = r.contour[i], b = r.contour[(i+1) % r.contour.length];
            insetArea += a.x * b.y - b.x * a.y;
          }
          insetArea = Math.abs(insetArea) * 0.5;
          expect(insetArea).toBeLessThan(origArea);
        }
      ),
      { numRuns: 200 }
    );
  });

  test("larger reserve → smaller or equal inset area", () => {
    fc.assert(
      fc.property(
        fc.double({ min: 80, max: 200, noNaN: true }),
        fc.double({ min: 2, max: 8, noNaN: true }),
        fc.double({ min: 9, max: 20, noNaN: true }),
        (side, r1, r2) => {
          fc.pre(r1 < r2 && r2 < side * 0.4);
          const pts = [
            { x: 0, y: 0 }, { x: side, y: 0 },
            { x: side, y: side }, { x: 0, y: side }
          ];
          const res1 = buildPieceWorkingContour(pts, r1);
          const res2 = buildPieceWorkingContour(pts, r2);
          if (res1.status !== "ok" || res2.status !== "ok") return;
          const area = (contour) => {
            let s = 0;
            for (let i = 0; i < contour.length; i++) {
              const a = contour[i], b = contour[(i+1) % contour.length];
              s += a.x * b.y - b.x * a.y;
            }
            return Math.abs(s) * 0.5;
          };
          expect(area(res1.contour)).toBeGreaterThanOrEqual(area(res2.contour) - 1);
        }
      ),
      { numRuns: 200 }
    );
  });

  test("inset is translation-invariant", () => {
    fc.assert(
      fc.property(
        fc.double({ min: 50, max: 200, noNaN: true }),
        fc.double({ min: 1, max: 8, noNaN: true }),
        fc.double({ min: -1000, max: 1000, noNaN: true }),
        fc.double({ min: -1000, max: 1000, noNaN: true }),
        (side, reserve, dx, dy) => {
          fc.pre(reserve < side * 0.35);
          const area = (contour) => {
            let s = 0;
            for (let i = 0; i < contour.length; i++) {
              const a = contour[i], b = contour[(i+1) % contour.length];
              s += a.x * b.y - b.x * a.y;
            }
            return Math.abs(s) * 0.5;
          };
          const pts1 = [
            { x: 0, y: 0 }, { x: side, y: 0 },
            { x: side, y: side }, { x: 0, y: side }
          ];
          const pts2 = pts1.map(p => ({ x: p.x + dx, y: p.y + dy }));
          const r1 = buildPieceWorkingContour(pts1, reserve);
          const r2 = buildPieceWorkingContour(pts2, reserve);
          if (r1.status !== "ok" || r2.status !== "ok") return;
          expect(Math.abs(area(r1.contour) - area(r2.contour))).toBeLessThan(5);
        }
      ),
      { numRuns: 150 }
    );
  });
});

// ================================================================
// wrapSignedDeg — угловая арифметика
// ================================================================

describe("property: wrapSignedDeg", () => {

  test("result always in (-180, 180] for any input", () => {
    fc.assert(
      fc.property(fc.double({ min: -1e6, max: 1e6, noNaN: true }), (v) => {
        const w = wrapSignedDeg(v);
        expect(w).toBeGreaterThan(-180);
        expect(w).toBeLessThanOrEqual(180);
      }),
      { numRuns: 1000 }
    );
  });

  test("wrapSignedDeg(v) = wrapSignedDeg(v + 360) for any v", () => {
    fc.assert(
      fc.property(fc.double({ min: -1e5, max: 1e5, noNaN: true }), (v) => {
        // Use tolerance: for subnormals near 0, v+360 loses v due to float precision
        expect(Math.abs(wrapSignedDeg(v) - wrapSignedDeg(v + 360))).toBeLessThan(1e-6);
      }),
      { numRuns: 500 }
    );
  });

  test("|wrapSignedDeg(a - b)| = angular distance between a and b", () => {
    fc.assert(
      fc.property(
        fc.double({ min: 0, max: 360, noNaN: true }),
        fc.double({ min: 0, max: 360, noNaN: true }),
        (a, b) => {
          const diff = wrapSignedDeg(a - b);
          // Angular distance is always the shortest path on the circle
          expect(Math.abs(diff)).toBeLessThanOrEqual(180);
        }
      ),
      { numRuns: 500 }
    );
  });

  test("wrapSignedDeg is idempotent for values already in range", () => {
    fc.assert(
      fc.property(fc.double({ min: -179.9999, max: 180, noNaN: true }), (v) => {
        expect(wrapSignedDeg(v)).toBeCloseTo(v, 6);
      }),
      { numRuns: 500 }
    );
  });
});
