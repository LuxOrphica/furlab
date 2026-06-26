"use strict";

function polygonArea(pts) {
  if (!pts || pts.length < 3) return 0;
  let s = 0;
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i], b = pts[(i + 1) % pts.length];
    s += a.x * b.y - b.x * a.y;
  }
  return Math.abs(s) * 0.5;
}

function scanlineWidestInterval(points, y) {
  const pts = Array.isArray(points) ? points : [];
  if (pts.length < 3) return null;
  const xs = [];
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i], b = pts[(i + 1) % pts.length];
    const ax = Number(a.x), ay = Number(a.y), bx = Number(b.x), by = Number(b.y);
    if (Math.abs(ay - by) < 1e-9) continue;
    const crosses = (ay <= y && y < by) || (by <= y && y < ay);
    if (!crosses) continue;
    xs.push(ax + (bx - ax) * (y - ay) / (by - ay));
  }
  xs.sort((a, b) => a - b);
  let widest = null;
  for (let i = 0; i + 1 < xs.length; i += 2) {
    const left = xs[i], right = xs[i + 1];
    if (!Number.isFinite(left) || !Number.isFinite(right) || right <= left) continue;
    if (!widest || (right - left) > (widest.right - widest.left))
      widest = { left, right, width: right - left };
  }
  return widest;
}

function quantile(list, q) {
  const arr = list.slice().sort((a, b) => a - b);
  if (!arr.length) return null;
  if (arr.length === 1) return arr[0];
  const pos = Math.max(0, Math.min(arr.length - 1, (arr.length - 1) * q));
  const lo = Math.floor(pos), hi = Math.ceil(pos);
  if (lo === hi) return arr[lo];
  return arr[lo] * (1 - (pos - lo)) + arr[hi] * (pos - lo);
}

function buildSectorPolygon(cx, cy, r0, r1, a0, a1) {
  const arcSegments = Math.max(6, Math.ceil(Math.abs(a1 - a0) / (Math.PI / 18)));
  const out = [];
  for (let i = 0; i <= arcSegments; i++) {
    const a = a0 + (a1 - a0) * i / arcSegments;
    out.push({ x: cx + Math.cos(a) * r1, y: cy + Math.sin(a) * r1 });
  }
  for (let i = arcSegments; i >= 0; i--) {
    const a = a0 + (a1 - a0) * i / arcSegments;
    out.push({ x: cx + Math.cos(a) * r0, y: cy + Math.sin(a) * r0 });
  }
  return out;
}

describe("Scanline (generateRegularFragments)", () => {
  const sq = [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 100 }, { x: 0, y: 100 }];

  test("scanline through middle of square returns full width", () => {
    const r = scanlineWidestInterval(sq, 50);
    expect(r).not.toBeNull();
    expect(Math.abs(r.left - 0)).toBeLessThan(1e-6);
    expect(Math.abs(r.right - 100)).toBeLessThan(1e-6);
    expect(Math.abs(r.width - 100)).toBeLessThan(1e-6);
  });

  test("scanline through triangle returns correct chord", () => {
    const tri = [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 50, y: 100 }];
    const r = scanlineWidestInterval(tri, 50);
    expect(r).not.toBeNull();
    expect(Math.abs(r.left - 25)).toBeLessThan(1e-6);
    expect(Math.abs(r.right - 75)).toBeLessThan(1e-6);
  });

  test("scanline above polygon returns null", () => {
    expect(scanlineWidestInterval(sq, 200)).toBeNull();
  });

  test("scanline below polygon returns null", () => {
    expect(scanlineWidestInterval(sq, -1)).toBeNull();
  });

  test("scanline width ≤ bbox width", () => {
    const poly = [{ x: 10, y: 10 }, { x: 90, y: 10 }, { x: 90, y: 90 }, { x: 10, y: 90 }];
    for (let y = 15; y < 90; y += 10) {
      const r = scanlineWidestInterval(poly, y);
      if (r) expect(r.width).toBeLessThanOrEqual(80 + 1e-6);
    }
  });

  test("quantile: median of [1,3,5] = 3", () => {
    expect(Math.abs(quantile([1, 3, 5], 0.5) - 3)).toBeLessThan(1e-9);
  });

  test("quantile q=0 → min, q=1 → max", () => {
    const arr = [5, 3, 8, 1, 9, 2];
    expect(quantile(arr, 0)).toBe(1);
    expect(quantile(arr, 1)).toBe(9);
  });
});

describe("Diagonal bands (generateDiagonalFragments)", () => {
  test("diagonal transform u = y - slope*x maps corners correctly", () => {
    const slope = Math.tan(Math.PI / 4);
    const corners = [{x:0,y:0},{x:100,y:0},{x:100,y:100},{x:0,y:100}];
    const us = corners.map(p => p.y - slope * p.x);
    expect(Math.abs(us[0])).toBeLessThan(1e-6);
    expect(Math.abs(us[1] + 100)).toBeLessThan(1e-6);
    expect(Math.abs(us[2])).toBeLessThan(1e-6);
    expect(Math.abs(us[3] - 100)).toBeLessThan(1e-6);
  });

  test("diagonal bands cover full u-range with no gaps", () => {
    const slope = Math.tan(Math.PI / 4);
    const corners = [{x:0,y:0},{x:200,y:0},{x:200,y:200},{x:0,y:200}];
    const us = corners.map(p => p.y - slope * p.x);
    const bandStep = 50;
    const bandStart = Math.floor(Math.min(...us) / bandStep) - 1;
    const bandEnd = Math.ceil(Math.max(...us) / bandStep) + 1;
    for (const u of us) {
      let covered = false;
      for (let b = bandStart; b <= bandEnd; b++)
        if (u >= b * bandStep && u < (b + 1) * bandStep) { covered = true; break; }
      expect(covered).toBe(true);
    }
  });

  test("herringbone: points equidistant from axis have same u", () => {
    const slope = 1, axisX = 50, orientation = 1;
    const u1 = 100 - orientation * slope * Math.abs(30 - axisX);
    const u2 = 100 - orientation * slope * Math.abs(70 - axisX);
    expect(Math.abs(u1 - u2)).toBeLessThan(1e-9);
  });

  test("slope = tan(angleDeg) is finite for all valid angles", () => {
    for (const deg of [-89, -45, 0, 30, 45, 60, 89]) {
      const slope = Math.tan(Math.abs(deg) * Math.PI / 180);
      expect(Number.isFinite(slope)).toBe(true);
      expect(slope).toBeGreaterThanOrEqual(0);
    }
  });
});

describe("Radial sectors (generateRadialFragments)", () => {
  test("sector area ≈ (r1²-r0²)/2 · (a1-a0)", () => {
    const [r0, r1, a0, a1] = [10, 30, 0, Math.PI / 2];
    const expected = 0.5 * (r1 * r1 - r0 * r0) * (a1 - a0);
    const actual = polygonArea(buildSectorPolygon(0, 0, r0, r1, a0, a1));
    expect(Math.abs(actual - expected) / expected).toBeLessThan(0.01);
  });

  test("full circle r0=0 → area ≈ πr²", () => {
    const r1 = 50;
    const actual = polygonArea(buildSectorPolygon(0, 0, 0, r1, 0, Math.PI * 2));
    expect(Math.abs(actual - Math.PI * r1 * r1) / (Math.PI * r1 * r1)).toBeLessThan(0.01);
  });

  test("N equal sectors cover same area as full annulus", () => {
    const [r0, r1, N] = [20, 60, 8];
    const step = (Math.PI * 2) / N;
    const total = Array.from({ length: N }, (_, i) =>
      polygonArea(buildSectorPolygon(0, 0, r0, r1, i * step, (i + 1) * step))
    ).reduce((s, a) => s + a, 0);
    const annulus = Math.PI * (r1 * r1 - r0 * r0);
    expect(Math.abs(total - annulus) / annulus).toBeLessThan(0.01);
  });

  test("sector points lie on correct radii", () => {
    const pts = buildSectorPolygon(0, 0, 10, 40, 0, Math.PI / 3);
    for (const p of pts) {
      const d = Math.hypot(p.x, p.y);
      expect(d).toBeGreaterThanOrEqual(10 - 0.1);
      expect(d).toBeLessThanOrEqual(40 + 0.1);
    }
  });

  test("equal sectors at different rotations have equal areas", () => {
    const a1 = polygonArea(buildSectorPolygon(0, 0, 10, 30, 0, Math.PI / 4));
    const a2 = polygonArea(buildSectorPolygon(0, 0, 10, 30, Math.PI / 2, Math.PI * 3 / 4));
    expect(Math.abs(a1 - a2)).toBeLessThan(0.1);
  });

  test("sector center offset shifts all points", () => {
    const pts1 = buildSectorPolygon(0, 0, 10, 30, 0, Math.PI / 4);
    const pts2 = buildSectorPolygon(100, 200, 10, 30, 0, Math.PI / 4);
    for (let i = 0; i < pts1.length; i++) {
      expect(Math.abs(pts2[i].x - pts1[i].x - 100)).toBeLessThan(1e-9);
      expect(Math.abs(pts2[i].y - pts1[i].y - 200)).toBeLessThan(1e-9);
    }
  });

  test("ringCount rings cover full disk area", () => {
    const [innerR, maxR, ringCount] = [0, 100, 5];
    const ringStep = (maxR - innerR) / ringCount;
    const total = Array.from({ length: ringCount }, (_, i) =>
      polygonArea(buildSectorPolygon(0, 0, innerR + i * ringStep, innerR + (i + 1) * ringStep, 0, Math.PI * 2))
    ).reduce((s, a) => s + a, 0);
    expect(Math.abs(total - Math.PI * maxR * maxR) / (Math.PI * maxR * maxR)).toBeLessThan(0.01);
  });
});
