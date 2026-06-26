"use strict";

const {
  parseModePreviewApiRequest,
} = require("../../../src/contracts/furlab_case_contracts");
const {
  parsePreviewWrapperRequest,
} = require("../../../src/modes/wrapper");

const validRequest = {
  layoutType: "longitudinal",
  zone: {
    id: "zone-1",
    points: [
      { x: 0, y: 0 },
      { x: 100, y: 0 },
      { x: 100, y: 50 },
      { x: 0, y: 50 },
    ],
  },
  inputs: { axis: "y" },
  options: { rows: 1, cols: 2 },
  seed: 123,
};

describe("mode preview API contract", () => {
  it("normalizes valid requests into wrapper input shape", () => {
    const parsed = parseModePreviewApiRequest(validRequest);

    expect(parsed.ok).toBe(true);
    expect(parsed.value).toEqual({
      layoutType: "longitudinal",
      zoneId: "zone-1",
      zonePoints: validRequest.zone.points,
      inputs: { axis: "y" },
      options: { rows: 1, cols: 2 },
      seed: 123,
    });
  });

  it("coerces numeric strings at the API boundary", () => {
    const parsed = parseModePreviewApiRequest({
      ...validRequest,
      zone: {
        id: "zone-1",
        points: [
          { x: "0", y: "0" },
          { x: "100", y: "0" },
          { x: "100", y: "50" },
        ],
      },
      seed: "42",
    });

    expect(parsed.ok).toBe(true);
    expect(parsed.value.zonePoints[1]).toEqual({ x: 100, y: 0 });
    expect(parsed.value.seed).toBe(42);
  });

  it("allows missing seed and preserves null for deterministic caller choice", () => {
    const { seed, ...withoutSeed } = validRequest;
    const parsed = parseModePreviewApiRequest(withoutSeed);

    expect(parsed.ok).toBe(true);
    expect(parsed.value.seed).toBe(null);
  });

  it("rejects unsupported layout types", () => {
    const parsed = parsePreviewWrapperRequest({
      ...validRequest,
      layoutType: "unknown-mode",
    });

    expect(parsed).toEqual({ ok: false, error: "layout_type_unsupported" });
  });

  it("rejects zones with fewer than three valid points", () => {
    const parsed = parsePreviewWrapperRequest({
      ...validRequest,
      zone: { id: "bad-zone", points: [{ x: 0, y: 0 }, { x: 1, y: 1 }] },
    });

    expect(parsed).toEqual({ ok: false, error: "zone_points_required" });
  });

  it("returns zod issue text for malformed numeric coordinates", () => {
    const parsed = parsePreviewWrapperRequest({
      ...validRequest,
      zone: {
        id: "bad-zone",
        points: [
          { x: 0, y: 0 },
          { x: 1, y: 0 },
          { x: "not-a-number", y: 1 },
        ],
      },
    });

    expect(parsed.ok).toBe(false);
    expect(parsed.error).toMatch(/zone\.points\.2\.x/i);
  });
});
