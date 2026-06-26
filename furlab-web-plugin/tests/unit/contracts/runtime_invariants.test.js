"use strict";

const {
  assertClosedContour,
  assertFragments,
  assertPlacements,
  assertRenderOutput,
} = require("../../../src/contracts/runtime_invariants");
const {
  renderItemsFromPlacements,
  renderItemsFromFragments,
  wrapInventoryDirectPreview,
  wrapIntarsiaPreview,
  wrapRegularFragmentPreview,
} = require("../../../src/modes/wrapper");

describe("runtime invariants", () => {
  it("accepts valid closed contours", () => {
    expect(() => assertClosedContour([
      { x: 0, y: 0 },
      { x: 10, y: 0 },
      { x: 10, y: 10 },
    ], "triangle")).not.toThrow();
  });

  it("rejects malformed contour points with a precise label", () => {
    expect(() => assertClosedContour([
      { x: 0, y: 0 },
      { x: 10, y: 0 },
      { x: "bad", y: 10 },
    ], "triangle")).toThrow(/triangle\.2\.x must be a finite number/);
  });

  it("rejects duplicate render item ids", () => {
    const item = {
      id: "frag-1",
      closed: true,
      renderIndex: 1,
      contour: [
        { x: 0, y: 0 },
        { x: 10, y: 0 },
        { x: 10, y: 10 },
      ],
    };

    expect(() => assertRenderOutput({
      itemCount: 2,
      items: [item, { ...item, renderIndex: 2 }],
    })).toThrow(/id must be unique/);
  });

  it("accepts valid fragments", () => {
    expect(() => assertFragments([{
      id: 1,
      points: [
        { x: 0, y: 0 },
        { x: 10, y: 0 },
        { x: 10, y: 10 },
      ],
      areaMm2: 50,
    }], "longitudinal.fragments")).not.toThrow();
  });

  it("rejects malformed fragment geometry before render mapping", () => {
    expect(() => assertFragments([{
      id: 1,
      points: [
        { x: 0, y: 0 },
        { x: 10, y: 0 },
        { x: Number.NaN, y: 10 },
      ],
      areaMm2: 50,
    }], "longitudinal.fragments")).toThrow(/longitudinal\.fragments\.0\.points\.2\.x/);
  });

  it("rejects duplicate fragment ids", () => {
    const fragment = {
      id: 1,
      points: [
        { x: 0, y: 0 },
        { x: 10, y: 0 },
        { x: 10, y: 10 },
      ],
      areaMm2: 50,
    };

    expect(() => assertFragments([fragment, { ...fragment }], "longitudinal.fragments"))
      .toThrow(/id must be unique/);
  });

  it("rejects negative fragment area", () => {
    expect(() => assertFragments([{
      id: 1,
      points: [
        { x: 0, y: 0 },
        { x: 10, y: 0 },
        { x: 10, y: 10 },
      ],
      areaMm2: -1,
    }], "longitudinal.fragments")).toThrow(/areaMm2 must be non-negative/);
  });

  it("accepts valid matched placements", () => {
    expect(() => assertPlacements([{
      placementId: "pl-1",
      inventoryTag: "INV-1",
      status: "matched",
      solveOrder: 1,
      alignedContour: [
        { x: 0, y: 0 },
        { x: 20, y: 0 },
        { x: 20, y: 20 },
      ],
      alignedCoreContour: [
        { x: 2, y: 2 },
        { x: 18, y: 2 },
        { x: 18, y: 18 },
      ],
      usedVisibleAreaMm2: 200,
    }], "inventory_direct.placements")).not.toThrow();
  });

  it("allows unmatched intarsia placements without aligned geometry", () => {
    expect(() => assertPlacements([{
      fragmentId: 1,
      status: "needs_attention",
      reason: "smart_not_found",
      alignedContour: null,
    }], "intarsia.placements")).not.toThrow();
  });

  it("rejects matched placements without a usable contour", () => {
    expect(() => assertPlacements([{
      placementId: "pl-1",
      status: "matched",
      alignedContour: [
        { x: 0, y: 0 },
        { x: 20, y: 0 },
      ],
    }], "inventory_direct.placements")).toThrow(/alignedContour must contain at least 3 points/);
  });

  it("rejects duplicate placement identities", () => {
    const placement = {
      placementId: "pl-1",
      status: "matched",
      alignedContour: [
        { x: 0, y: 0 },
        { x: 20, y: 0 },
        { x: 20, y: 20 },
      ],
    };

    expect(() => assertPlacements([placement, { ...placement }], "inventory_direct.placements"))
      .toThrow(/identity must be unique/);
  });

  it("rejects negative placement area metrics", () => {
    expect(() => assertPlacements([{
      placementId: "pl-1",
      status: "matched",
      alignedContour: [
        { x: 0, y: 0 },
        { x: 20, y: 0 },
        { x: 20, y: 20 },
      ],
      usedVisibleAreaMm2: -1,
    }], "inventory_direct.placements")).toThrow(/usedVisibleAreaMm2 must be non-negative/);
  });

  it("rejects mismatched render itemCount", () => {
    expect(() => assertRenderOutput({
      itemCount: 2,
      items: [{
        id: "frag-1",
        closed: true,
        renderIndex: 1,
        contour: [
          { x: 0, y: 0 },
          { x: 10, y: 0 },
          { x: 10, y: 10 },
        ],
      }],
    })).toThrow(/itemCount must match/);
  });

  it("renderItemsFromFragments produces invariant-safe render items", () => {
    const items = renderItemsFromFragments([{
      id: 1,
      points: [
        { x: 0, y: 0 },
        { x: 10, y: 0 },
        { x: 10, y: 10 },
      ],
      areaMm2: 50,
    }]);

    expect(() => assertRenderOutput({ items })).not.toThrow();
  });

  it("renderItemsFromPlacements produces invariant-safe render items", () => {
    const items = renderItemsFromPlacements([{
      placementId: "pl-1",
      inventoryTag: "INV-1",
      status: "matched",
      alignedContour: [
        { x: 0, y: 0 },
        { x: 20, y: 0 },
        { x: 20, y: 20 },
      ],
    }]);

    expect(() => assertRenderOutput({ items })).not.toThrow();
  });

  it("wrapRegularFragmentPreview validates its render output", () => {
    expect(() => wrapRegularFragmentPreview(
      {},
      {
        fragments: [{
          id: 1,
          points: [
            { x: 0, y: 0 },
            { x: 10, y: 0 },
            { x: 10, y: 10 },
          ],
          areaMm2: 50,
        }],
      },
      "longitudinal",
      "v-test",
      "Longitudinal"
    )).not.toThrow();
  });

  it("wrapRegularFragmentPreview rejects invalid fragments instead of dropping them", () => {
    expect(() => wrapRegularFragmentPreview(
      {},
      {
        fragments: [{
          id: 1,
          points: [
            { x: 0, y: 0 },
            { x: 10, y: 0 },
            { x: "bad", y: 10 },
          ],
          areaMm2: 50,
        }],
      },
      "longitudinal",
      "v-test",
      "Longitudinal"
    )).toThrow(/longitudinal\.fragments\.0\.points\.2\.x/);
  });

  it("wrapInventoryDirectPreview validates placements before render mapping", () => {
    expect(() => wrapInventoryDirectPreview(
      { options: {} },
      {
        placements: [{
          placementId: "pl-1",
          inventoryTag: "INV-1",
          status: "matched",
          alignedContour: [
            { x: 0, y: 0 },
            { x: 20, y: 0 },
            { x: 20, y: 20 },
          ],
        }],
      }
    )).not.toThrow();
  });

  it("wrapInventoryDirectPreview rejects invalid placement geometry", () => {
    expect(() => wrapInventoryDirectPreview(
      { options: {} },
      {
        placements: [{
          placementId: "pl-1",
          status: "matched",
          alignedContour: [
            { x: 0, y: 0 },
            { x: "bad", y: 0 },
            { x: 20, y: 20 },
          ],
        }],
      }
    )).toThrow(/inventory_direct\.placements\.0\.alignedContour\.1\.x/);
  });

  it("wrapIntarsiaPreview validates matched placements and keeps unmatched diagnostics", () => {
    expect(() => wrapIntarsiaPreview(
      { options: {} },
      {
        placements: [
          {
            fragmentId: 1,
            inventoryTag: "INV-1",
            status: "matched",
            alignedContour: [
              { x: 0, y: 0 },
              { x: 20, y: 0 },
              { x: 20, y: 20 },
            ],
          },
          {
            fragmentId: 2,
            status: "needs_attention",
            alignedContour: null,
          },
        ],
      }
    )).not.toThrow();
  });
});
