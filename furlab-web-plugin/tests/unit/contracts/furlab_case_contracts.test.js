"use strict";

const fs = require("fs");
const path = require("path");
const {
  modePreviewResponseSchema,
  modeCaseSchema,
  splitReuseCaseSchema,
  inventorySplitBaselineSchema,
  assertValidJsonContract,
} = require("../../../src/contracts/furlab_case_contracts");

const rootDir = path.resolve(__dirname, "../../..");

function readJson(relPath) {
  const fullPath = path.join(rootDir, relPath);
  return JSON.parse(fs.readFileSync(fullPath, "utf8"));
}

function listJsonFiles(relDir) {
  const dir = path.join(rootDir, relDir);
  return fs.readdirSync(dir)
    .filter((name) => name.toLowerCase().endsWith(".json"))
    .sort()
    .map((name) => path.join(relDir, name));
}

describe("FurLab JSON contracts", () => {
  for (const relPath of listJsonFiles("tests/cases/modes")) {
    it(`${relPath} matches mode case schema`, () => {
      const parsed = assertValidJsonContract(
        modeCaseSchema,
        readJson(relPath),
        relPath
      );

      expect(parsed.request.zone.points.length).toBeGreaterThanOrEqual(3);
      expect(parsed.request.seed).toBeTypeOf("number");
    });
  }

  it("tests/cases/split_reuse_required.json matches split reuse schema", () => {
    const parsed = assertValidJsonContract(
      splitReuseCaseSchema,
      readJson("tests/cases/split_reuse_required.json"),
      "tests/cases/split_reuse_required.json"
    );

    expect(parsed.pieces.length).toBeGreaterThanOrEqual(1);
  });

  it("tests/baselines/inventory_split_baseline.json matches baseline schema", () => {
    const parsed = assertValidJsonContract(
      inventorySplitBaselineSchema,
      readJson("tests/baselines/inventory_split_baseline.json"),
      "tests/baselines/inventory_split_baseline.json"
    );

    expect(Object.keys(parsed).length).toBeGreaterThan(0);
  });

  it("rejects malformed mode cases with a useful message", () => {
    expect(() => assertValidJsonContract(
      modeCaseSchema,
      { name: "bad", request: { layoutType: "radial" }, expect: {} },
      "bad-case"
    )).toThrow(/bad-case failed validation: .*zone/i);
  });

  it("accepts a valid mode preview response", () => {
    const parsed = assertValidJsonContract(
      modePreviewResponseSchema,
      {
        ok: true,
        layoutType: "inventory_direct",
        modeVersion: "v-test",
        resultStatus: "ok",
        warnings: [],
        failedReason: null,
        stats: { placementsTotal: 1 },
        render: {
          renderOrderPolicy: "solve_order",
          stackOrderPolicy: "solve_order",
          solveOrder: ["pl-1"],
          itemCount: 1,
          items: [{
            id: "pl-1",
            closed: true,
            renderIndex: 1,
            contour: [
              { x: 0, y: 0 },
              { x: 10, y: 0 },
              { x: 10, y: 10 },
            ],
          }],
        },
        placements: [{
          placementId: "pl-1",
          status: "matched",
          alignedContour: [
            { x: 0, y: 0 },
            { x: 10, y: 0 },
            { x: 10, y: 10 },
          ],
        }],
        debug: {},
      },
      "mode-preview-response"
    );

    expect(parsed.layoutType).toBe("inventory_direct");
    expect(parsed.render.items).toHaveLength(1);
  });

  it("rejects preview responses with mismatched itemCount", () => {
    expect(() => assertValidJsonContract(
      modePreviewResponseSchema,
      {
        ok: true,
        layoutType: "longitudinal",
        resultStatus: "ok",
        render: {
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
        },
      },
      "bad-response"
    )).toThrow(/itemCount/);
  });

  it("rejects matched placement responses without aligned contours", () => {
    expect(() => assertValidJsonContract(
      modePreviewResponseSchema,
      {
        ok: true,
        layoutType: "intarsia",
        resultStatus: "ok",
        render: { items: [] },
        placements: [{
          fragmentId: 1,
          status: "matched",
          alignedContour: null,
        }],
      },
      "bad-response"
    )).toThrow(/alignedContour/);
  });

  it("rejects duplicate placement identities in preview responses", () => {
    expect(() => assertValidJsonContract(
      modePreviewResponseSchema,
      {
        ok: true,
        layoutType: "inventory_direct",
        resultStatus: "ok",
        render: { items: [] },
        placements: [
          { placementId: "pl-1", status: "needs_attention", alignedContour: null },
          { placementId: "pl-1", status: "needs_attention", alignedContour: null },
        ],
      },
      "bad-response"
    )).toThrow(/identity/);
  });
});
