"use strict";

function pointSegDistance(p, a, b) {
  const vx = b.x - a.x, vy = b.y - a.y;
  const wx = p.x - a.x, wy = p.y - a.y;
  const len2 = vx * vx + vy * vy;
  if (len2 <= 1e-12) return Math.hypot(wx, wy);
  const t = Math.max(0, Math.min(1, (wx * vx + wy * vy) / len2));
  return Math.hypot(p.x - a.x - t * vx, p.y - a.y - t * vy);
}

function rdp(input, eps) {
  if (input.length <= 2) return input.slice();
  const keep = new Uint8Array(input.length);
  keep[0] = 1; keep[input.length - 1] = 1;
  const stack = [[0, input.length - 1]];
  while (stack.length) {
    const [s, e] = stack.pop();
    let bestIdx = -1, bestDist = eps;
    for (let i = s + 1; i < e; i++) {
      const d = pointSegDistance(input[i], input[s], input[e]);
      if (d > bestDist) { bestDist = d; bestIdx = i; }
    }
    if (bestIdx > s && bestIdx < e) {
      keep[bestIdx] = 1;
      stack.push([s, bestIdx], [bestIdx, e]);
    }
  }
  return input.filter((_, i) => keep[i]);
}

function circle(cx, cy, r, n) {
  return Array.from({ length: n }, (_, i) => {
    const a = (2 * Math.PI * i) / n;
    return { x: cx + r * Math.cos(a), y: cy + r * Math.sin(a) };
  });
}

function maxDeviation(original, simplified) {
  let max = 0;
  for (const p of original) {
    let minDist = Infinity;
    for (let i = 0; i + 1 < simplified.length; i++) {
      const d = pointSegDistance(p, simplified[i], simplified[i + 1]);
      if (d < minDist) minDist = d;
    }
    if (minDist < Infinity && minDist > max) max = minDist;
  }
  return max;
}

describe("pointSegDistance", () => {
  test("distance from midpoint to segment = 0", () => {
    expect(pointSegDistance({x:5,y:0}, {x:0,y:0}, {x:10,y:0})).toBeLessThan(1e-9);
  });

  test("distance from point above segment midpoint", () => {
    expect(Math.abs(pointSegDistance({x:5,y:3}, {x:0,y:0}, {x:10,y:0}) - 3)).toBeLessThan(1e-9);
  });

  test("distance from point beyond end = distance to endpoint", () => {
    expect(Math.abs(pointSegDistance({x:15,y:0}, {x:0,y:0}, {x:10,y:0}) - 5)).toBeLessThan(1e-9);
  });

  test("zero-length segment → distance to point", () => {
    expect(Math.abs(pointSegDistance({x:0,y:0}, {x:3,y:4}, {x:3,y:4}) - 5)).toBeLessThan(1e-9);
  });
});

describe("RDP algorithm", () => {
  test("straight line: all interior points removed (eps > 0)", () => {
    const line = Array.from({ length: 101 }, (_, i) => ({ x: i, y: 0 }));
    expect(rdp(line, 0.01).length).toBe(2);
  });

  test("endpoints always preserved", () => {
    const pts = circle(0, 0, 100, 200);
    const result = rdp(pts, 5);
    expect(result[0]).toEqual(pts[0]);
    expect(result[result.length - 1]).toEqual(pts[pts.length - 1]);
  });

  test("larger eps → fewer points", () => {
    const pts = circle(0, 0, 100, 500);
    expect(rdp(pts, 1).length).toBeGreaterThan(rdp(pts, 5).length);
    expect(rdp(pts, 5).length).toBeGreaterThan(rdp(pts, 20).length);
  });

  test("result always subset of input", () => {
    const pts = circle(0, 0, 50, 300);
    const set = new Set(pts.map(p => `${p.x},${p.y}`));
    for (const p of rdp(pts, 3)) {
      expect(set.has(`${p.x},${p.y}`)).toBe(true);
    }
  });

  test("eps=0 → all points kept", () => {
    const pts = circle(0, 0, 50, 50);
    expect(rdp(pts, 0).length).toBe(pts.length);
  });

  test("max deviation ≤ eps [key guarantee]", () => {
    const pts = circle(0, 0, 100, 1000);
    const eps = 5;
    expect(maxDeviation(pts, rdp(pts, eps))).toBeLessThanOrEqual(eps + 1e-9);
  });

  test("2-point input returned as-is", () => {
    expect(rdp([{x:0,y:0},{x:1,y:1}], 1).length).toBe(2);
  });

  test("spike above eps threshold is preserved", () => {
    const pts = Array.from({ length: 11 }, (_, i) => ({ x: i * 10, y: 0 }));
    pts.splice(5, 0, { x: 50, y: 10 });
    expect(rdp(pts, 5).some(p => Math.abs(p.y - 10) < 1e-9)).toBe(true);
  });

  test("spike below eps threshold is removed", () => {
    const pts = Array.from({ length: 11 }, (_, i) => ({ x: i * 10, y: 0 }));
    pts.splice(5, 0, { x: 50, y: 1 });
    expect(rdp(pts, 5).some(p => Math.abs(p.y - 1) < 1e-9)).toBe(false);
  });
});
