"use strict";
const {
  pointsToMultiPolygon,
  multiPolygonArea,
  unionMulti,
  intersectMulti,
  diffMulti,
  largestOuterRingPoints,
} = require("../../../src/services/polygon_ops");

function sq(x, y, s) {
  return [{ x, y }, { x: x+s, y }, { x: x+s, y: y+s }, { x, y: y+s }];
}

describe("pointsToMultiPolygon", () => {
  test("converts square to mp", () => {
    const mp = pointsToMultiPolygon(sq(0, 0, 10));
    expect(mp.length).toBe(1);
    expect(mp[0].length).toBe(1);
    expect(mp[0][0].length).toBeGreaterThanOrEqual(4);
  });

  test("returns empty array for < 3 points", () => {
    expect(pointsToMultiPolygon([])).toEqual([]);
    expect(pointsToMultiPolygon([{x:0,y:0}])).toEqual([]);
    expect(pointsToMultiPolygon([{x:0,y:0},{x:1,y:0}])).toEqual([]);
  });
});

describe("multiPolygonArea", () => {
  test("area of 10x10 square = 100", () => {
    const area = multiPolygonArea(pointsToMultiPolygon(sq(0, 0, 10)));
    expect(Math.abs(area - 100)).toBeLessThan(1e-6);
  });

  test("area of 100x200 rectangle = 20000", () => {
    const pts = [{x:0,y:0},{x:100,y:0},{x:100,y:200},{x:0,y:200}];
    const area = multiPolygonArea(pointsToMultiPolygon(pts));
    expect(Math.abs(area - 20000)).toBeLessThan(1e-6);
  });

  test("area is invariant to translation", () => {
    const a1 = multiPolygonArea(pointsToMultiPolygon(sq(0, 0, 50)));
    const a2 = multiPolygonArea(pointsToMultiPolygon(sq(1000, 2000, 50)));
    expect(Math.abs(a1 - a2)).toBeLessThan(1e-6);
  });

  test("area >= 0 for any polygon", () => {
    const pts = [{x:0,y:0},{x:5,y:10},{x:10,y:0},{x:8,y:6},{x:2,y:6}];
    expect(multiPolygonArea(pointsToMultiPolygon(pts))).toBeGreaterThanOrEqual(0);
  });

  test("empty mp has area 0", () => {
    expect(multiPolygonArea([])).toBe(0);
  });
});

describe("unionMulti", () => {
  test("union of two non-overlapping squares has area = sum", () => {
    const a = pointsToMultiPolygon(sq(0, 0, 10));
    const b = pointsToMultiPolygon(sq(20, 0, 10));
    const area = multiPolygonArea(unionMulti(a, b));
    expect(Math.abs(area - 200)).toBeLessThan(1);
  });

  test("union of identical squares = one square", () => {
    const a = pointsToMultiPolygon(sq(0, 0, 10));
    const area = multiPolygonArea(unionMulti(a, a));
    expect(Math.abs(area - 100)).toBeLessThan(1);
  });

  test("union area >= each individual area", () => {
    const a = pointsToMultiPolygon(sq(0, 0, 10));
    const b = pointsToMultiPolygon(sq(5, 5, 10));
    const ua = multiPolygonArea(unionMulti(a, b));
    expect(ua).toBeGreaterThanOrEqual(multiPolygonArea(a) - 1);
    expect(ua).toBeGreaterThanOrEqual(multiPolygonArea(b) - 1);
  });
});

describe("intersectMulti", () => {
  test("intersection of non-overlapping squares = empty", () => {
    const a = pointsToMultiPolygon(sq(0, 0, 10));
    const b = pointsToMultiPolygon(sq(20, 0, 10));
    expect(multiPolygonArea(intersectMulti(a, b))).toBeLessThan(1);
  });

  test("intersection of identical squares = same square", () => {
    const a = pointsToMultiPolygon(sq(0, 0, 10));
    const area = multiPolygonArea(intersectMulti(a, a));
    expect(Math.abs(area - 100)).toBeLessThan(1);
  });

  test("intersection of half-overlapping squares = 5x10 = 50", () => {
    const a = pointsToMultiPolygon(sq(0, 0, 10));
    const b = pointsToMultiPolygon(sq(5, 0, 10));
    const area = multiPolygonArea(intersectMulti(a, b));
    expect(Math.abs(area - 50)).toBeLessThan(1);
  });

  test("intersection area <= min(a, b)", () => {
    const a = pointsToMultiPolygon(sq(0, 0, 10));
    const b = pointsToMultiPolygon(sq(3, 3, 20));
    const ia = multiPolygonArea(intersectMulti(a, b));
    const minArea = Math.min(multiPolygonArea(a), multiPolygonArea(b));
    expect(ia).toBeLessThanOrEqual(minArea + 1);
  });
});

describe("diffMulti", () => {
  test("diff of square minus itself = empty", () => {
    const a = pointsToMultiPolygon(sq(0, 0, 10));
    expect(multiPolygonArea(diffMulti(a, a))).toBeLessThan(1);
  });

  test("diff of non-overlapping = original", () => {
    const a = pointsToMultiPolygon(sq(0, 0, 10));
    const b = pointsToMultiPolygon(sq(20, 0, 10));
    expect(Math.abs(multiPolygonArea(diffMulti(a, b)) - 100)).toBeLessThan(1);
  });

  test("diff area = original - intersection", () => {
    const a = pointsToMultiPolygon(sq(0, 0, 10));
    const b = pointsToMultiPolygon(sq(5, 0, 10));
    const expected = multiPolygonArea(a) - multiPolygonArea(intersectMulti(a, b));
    expect(Math.abs(multiPolygonArea(diffMulti(a, b)) - expected)).toBeLessThan(1);
  });

  test("A = intersect(A,B) + diff(A,B) [area conservation]", () => {
    const a = pointsToMultiPolygon(sq(0, 0, 10));
    const b = pointsToMultiPolygon(sq(3, 3, 8));
    const areaA = multiPolygonArea(a);
    const areaI = multiPolygonArea(intersectMulti(a, b));
    const areaD = multiPolygonArea(diffMulti(a, b));
    expect(Math.abs(areaA - areaI - areaD)).toBeLessThan(1);
  });
});

describe("largestOuterRingPoints", () => {
  test("returns points for single polygon", () => {
    const mp = pointsToMultiPolygon(sq(0, 0, 10));
    const pts = largestOuterRingPoints(mp);
    expect(Array.isArray(pts)).toBe(true);
    expect(pts.length).toBeGreaterThanOrEqual(3);
  });

  test("returns largest polygon when two non-overlapping", () => {
    const big = pointsToMultiPolygon(sq(0, 0, 20));
    const small = pointsToMultiPolygon(sq(30, 0, 5));
    const both = unionMulti(big, small);
    const pts = largestOuterRingPoints(both);
    const area = multiPolygonArea(pointsToMultiPolygon(pts));
    expect(area).toBeGreaterThan(300);
  });
});
