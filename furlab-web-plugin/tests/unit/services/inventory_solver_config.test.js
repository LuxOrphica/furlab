"use strict";

const { resolveInventoryDirectConfig } = require("../../../src/services/inventory_solver_config");

function makeConfig(options) {
  return resolveInventoryDirectConfig({
    options: options || {},
    sourceConstraints: {},
    zoneArea: 100000,
    candidateAreaBudgetMm2: 200000,
    normalizeDeg(value) {
      const n = Number(value);
      return Number.isFinite(n) ? ((n % 360) + 360) % 360 : null;
    },
    NAP_EPS_DEG: 0.1,
  });
}

describe("inventory solver config", () => {
  it("keeps hard timeout at least as large as soft timeout", () => {
    const cfg = makeConfig({ maxSolveMs: 20000, hardMaxSolveMs: 10000 });

    expect(cfg.maxSolveMs).toBe(20000);
    expect(cfg.hardMaxSolveMs).toBe(20000);
  });

  it("passes route-level absolute deadline into solver config", () => {
    const deadline = Date.now() + 15000;
    const cfg = makeConfig({ maxSolveMs: 10000, hardMaxSolveMs: 20000, solveDeadlineMs: deadline });

    expect(cfg.solveDeadlineMs).toBe(deadline);
  });

  it("ignores invalid absolute deadline values", () => {
    const cfg = makeConfig({ solveDeadlineMs: "bad" });

    expect(cfg.solveDeadlineMs).toBe(null);
  });
});
