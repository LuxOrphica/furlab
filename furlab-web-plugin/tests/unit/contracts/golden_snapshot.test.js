"use strict";

const {
  bboxForPoints,
  normalizeInventoryDirectResponse,
  normalizeModePreviewResponse,
  polygonArea,
  roundNumber,
} = require("../../../src/contracts/golden_snapshot");

describe("golden snapshot normalization", () => {
  it("rounds numbers to stable precision", () => {
    expect(roundNumber(1.23456)).toBe(1.235);
    expect(roundNumber("bad")).toBe(null);
  });

  it("computes polygon area independent of point order direction", () => {
    expect(polygonArea([
      { x: 0, y: 0 },
      { x: 10, y: 0 },
      { x: 10, y: 5 },
      { x: 0, y: 5 },
    ])).toBe(50);
  });

  it("computes bbox for render contours", () => {
    expect(bboxForPoints([
      { x: 2, y: 4 },
      { x: -1, y: 8 },
      { x: 10, y: 3 },
    ])).toEqual({ minX: -1, minY: 3, maxX: 10, maxY: 8 });
  });

  it("keeps deterministic fields and drops noisy runtime details", () => {
    const snapshot = normalizeModePreviewResponse({
      ok: true,
      layoutType: "longitudinal",
      modeVersion: "v0.1",
      resultStatus: "ok",
      stats: { fragmentsTotal: 1, totalAreaMm2: 50, coveragePercent: 99.99999 },
      render: {
        renderOrderPolicy: "fragment_index",
        solveOrder: [1],
        items: [{
          id: "frag-1",
          closed: true,
          renderIndex: 1,
          contour: [
            { x: 0, y: 0 },
            { x: 10, y: 0 },
            { x: 10, y: 5 },
            { x: 0, y: 5 },
          ],
          meta: { status: "fragment" },
        }],
      },
      debug: { volatile: true },
      timingMs: { matching: 123 },
    });

    expect(snapshot).toEqual({
      ok: true,
      layoutType: "longitudinal",
      modeVersion: "v0.1",
      resultStatus: "ok",
      failedReason: null,
      warnings: [],
      stats: {
        fragmentsTotal: 1,
        rawFragmentsTotal: null,
        droppedByNormalize: null,
        totalAreaMm2: 50,
        coveragePercent: 100,
      },
      render: {
        renderOrderPolicy: "fragment_index",
        stackOrderPolicy: "",
        solveOrder: ["1"],
        itemCount: 1,
        items: [{
          id: "frag-1",
          renderIndex: 1,
          closed: true,
          status: "fragment",
          areaMm2: 50,
          bbox: { minX: 0, minY: 0, maxX: 10, maxY: 5 },
          contour: [
            { x: 0, y: 0 },
            { x: 10, y: 0 },
            { x: 10, y: 5 },
            { x: 0, y: 5 },
          ],
        }],
      },
    });
  });

  it("normalizes inventory direct responses into compact golden snapshots", () => {
    const snapshot = normalizeInventoryDirectResponse({
      ok: true,
      resultStatus: "ok",
      coveragePercent: 88.8888,
      coveredRatio: 0.888888,
      residualAreaMm2: 123.4567,
      fullCoverageOk: false,
      usedInventoryTags: ["p1"],
      placements: [{
        placementId: "pl-1",
        inventoryTag: "p1",
        status: "matched",
        solveOrder: 1,
        fitScore: 1.23456,
        alignedContour: [
          { x: 0, y: 0 },
          { x: 10, y: 0 },
          { x: 10, y: 10 },
        ],
        alignedCoreContour: [
          { x: 2, y: 2 },
          { x: 8, y: 2 },
          { x: 8, y: 8 },
        ],
      }],
      fragments: [{
        id: 1,
        ownerPlacementIndex: 0,
        areaMm2: 50.1234,
        points: [
          { x: 0, y: 0 },
          { x: 10, y: 0 },
          { x: 10, y: 10 },
        ],
      }],
    });

    expect(snapshot.counts).toEqual({
      placements: 1,
      matched: 1,
      fragments: 1,
      usedInventoryTags: 1,
    });
    expect(snapshot.coveragePercent).toBe(88.889);
    expect(snapshot.placements[0].alignedContourAreaMm2).toBe(50);
    expect(snapshot.fragments[0].computedAreaMm2).toBe(50);
  });
});
