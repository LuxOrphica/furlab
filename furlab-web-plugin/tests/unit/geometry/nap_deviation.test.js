"use strict";
const { wrapSignedDeg, computeNapDeviation } = require("../../../src/services/inventory_solver_nap");

function deltaDeg(a, b) {
  if (a == null || b == null) return null;
  return wrapSignedDeg(Number(b) - Number(a));
}
function normalizeDeg(v) {
  let x = Number(v || 0) % 360;
  if (x < 0) x += 360;
  return x;
}
const deps = { deltaDeg, normalizeDeg };

describe("wrapSignedDeg", () => {
  test.each([
    [0, 0], [90, 90], [180, 180], [-180, 180],
    [181, -179], [-181, 179], [360, 0], [270, -90],
    [-270, 90], [540, 180], [-540, 180],
  ])("wrapSignedDeg(%i) = %i", (input, expected) => {
    expect(wrapSignedDeg(input)).toBe(expected);
  });

  test("result always in (-180, 180]", () => {
    for (let v = -720; v <= 720; v += 13) {
      const w = wrapSignedDeg(v);
      expect(w).toBeGreaterThan(-180);
      expect(w).toBeLessThanOrEqual(180);
    }
  });
});

describe("computeNapDeviation", () => {
  test("exact match → deviation = 0", () => {
    expect(Math.abs(computeNapDeviation(45, 45, false, deps))).toBeLessThan(1e-9);
  });

  test("90° off → deviation = 90", () => {
    expect(Math.abs(computeNapDeviation(0, 90, false, deps) - 90)).toBeLessThan(1e-9);
  });

  test("180° off without flip → deviation = ±180", () => {
    expect(Math.abs(Math.abs(computeNapDeviation(0, 180, false, deps)) - 180)).toBeLessThan(1e-9);
  });

  test("180° off WITH flip → deviation = 0", () => {
    expect(Math.abs(computeNapDeviation(0, 180, true, deps))).toBeLessThan(1e-9);
  });

  test("10° off WITH flip → abs-min picks 10° (not -170°)", () => {
    expect(Math.abs(computeNapDeviation(0, 10, true, deps) - 10)).toBeLessThan(1e-9);
  });

  test("170° off WITH flip → abs-min picks -10° (flip is closer)", () => {
    expect(Math.abs(computeNapDeviation(0, 170, true, deps) + 10)).toBeLessThan(1e-9);
  });

  test("deviation without flip always ≤ 180 in absolute value", () => {
    for (let t = 0; t < 360; t += 15)
      for (let r = 0; r < 360; r += 15)
        expect(Math.abs(computeNapDeviation(t, r, false, deps))).toBeLessThanOrEqual(180 + 1e-9);
  });

  test("with flip: |deviation| always ≤ 90", () => {
    for (let t = 0; t < 360; t += 15)
      for (let r = 0; r < 360; r += 15)
        expect(Math.abs(computeNapDeviation(t, r, true, deps))).toBeLessThanOrEqual(90 + 1e-9);
  });

  test("missing deps → returns null", () => {
    expect(computeNapDeviation(0, 90, false, {})).toBeNull();
  });

  test("null deps → returns null", () => {
    expect(computeNapDeviation(0, 90, false, null)).toBeNull();
  });

  test("angle wrap: target=350, rotated=10 → deviation=20 (crosses 0°)", () => {
    expect(Math.abs(computeNapDeviation(350, 10, false, deps) - 20)).toBeLessThan(1e-9);
  });
});
