"use strict";
const { buildPieceWorkingContour, outsetPath } = require("../../../src/services/piece_working_area");

function sq(x, y, s) {
  return [{ x, y }, { x: x+s, y }, { x: x+s, y: y+s }, { x, y: y+s }];
}

function area(pts) {
  if (!pts || pts.length < 3) return 0;
  let s = 0;
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i], b = pts[(i + 1) % pts.length];
    s += a.x * b.y - b.x * a.y;
  }
  return Math.abs(s) * 0.5;
}

describe("buildPieceWorkingContour", () => {
  test("reserve=0 → no change, applied=false", () => {
    const r = buildPieceWorkingContour(sq(0, 0, 100), 0);
    expect(r.applied).toBe(false);
    expect(r.status).toBe("no_reserve");
    expect(r.contour.length).toBe(4);
  });

  test("inset 10mm on 100x100 square → status ok, applied=true", () => {
    const r = buildPieceWorkingContour(sq(0, 0, 100), 10);
    expect(r.status).toBe("ok");
    expect(r.applied).toBe(true);
    expect(r.contour.length).toBeGreaterThanOrEqual(3);
  });

  test("inset shrinks area: 100x100 inset 10 → area < 10000", () => {
    const r = buildPieceWorkingContour(sq(0, 0, 100), 10);
    const a = area(r.contour);
    expect(a).toBeLessThan(10000);
    expect(a).toBeGreaterThan(0);
  });

  test("inset 10mm on 100x100 square → area ≈ 6400 (80x80)", () => {
    const r = buildPieceWorkingContour(sq(0, 0, 100), 10);
    const a = area(r.contour);
    expect(a).toBeGreaterThan(5800);
    expect(a).toBeLessThanOrEqual(6400);
  });

  test("larger inset → smaller result area", () => {
    const r5  = buildPieceWorkingContour(sq(0, 0, 100), 5);
    const r20 = buildPieceWorkingContour(sq(0, 0, 100), 20);
    expect(area(r5.contour)).toBeGreaterThan(area(r20.contour));
  });

  test("inset > half side → reserve_too_large or reserve_clamped", () => {
    const r = buildPieceWorkingContour(sq(0, 0, 10), 20);
    expect(["reserve_too_large", "reserve_clamped"]).toContain(r.status);
  });

  test("inset slightly over limit → reserve_clamped or reserve_too_large", () => {
    const r = buildPieceWorkingContour(sq(0, 0, 100), 51);
    expect(["reserve_clamped", "reserve_too_large"]).toContain(r.status);
    if (r.status === "reserve_clamped") {
      expect(r.applied).toBe(true);
      expect(r.reserveMm).toBeLessThan(51);
    }
  });

  test("invalid input (< 3 points) → status invalid_input", () => {
    const r = buildPieceWorkingContour([{x:0,y:0}, {x:1,y:0}], 5);
    expect(r.status).toBe("invalid_input");
    expect(r.applied).toBe(false);
  });

  test("empty input → status invalid_input", () => {
    const r = buildPieceWorkingContour([], 5);
    expect(r.status).toBe("invalid_input");
  });

  test("inset is invariant to translation", () => {
    const r1 = buildPieceWorkingContour(sq(0, 0, 100), 10);
    const r2 = buildPieceWorkingContour(sq(500, 1000, 100), 10);
    expect(Math.abs(area(r1.contour) - area(r2.contour))).toBeLessThan(5);
  });
});

describe("outsetPath", () => {
  test("outset enlarges area", () => {
    expect(area(outsetPath(sq(0, 0, 100), 10))).toBeGreaterThan(10000);
  });

  test("outset reserve=0 → returns original reference", () => {
    const pts = sq(0, 0, 100);
    expect(outsetPath(pts, 0)).toBe(pts);
  });

  test("larger outset → larger area", () => {
    const pts = sq(0, 0, 100);
    expect(area(outsetPath(pts, 5))).toBeLessThan(area(outsetPath(pts, 20)));
  });

  test("outset(inset(X, R), R) area ≈ original (rounded corners cause slight deficit)", () => {
    const pts = sq(0, 0, 100);
    const inset = buildPieceWorkingContour(pts, 10);
    expect(inset.status).toBe("ok");
    const restored = outsetPath(inset.contour, 10);
    const orig = area(pts);
    const rest = area(restored);
    expect(rest).toBeLessThanOrEqual(orig + 1);
    expect(rest).toBeGreaterThan(orig * 0.85);
  });
});
