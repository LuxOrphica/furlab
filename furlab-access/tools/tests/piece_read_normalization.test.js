"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { createPieceReadService } = require("../server/services/piece_read_service");

function makeServiceWithCachedItem(item) {
  return createPieceReadService({
    ROOT_DIR: process.cwd(),
    path: require("path"),
    PIECE_READER_TIMEOUT_MS: 1000,
    PIECE_CACHE_TTL_SAFE_MS: 1000,
    CONTOUR_CACHE_TTL_SAFE_MS: 1000,
    registryCache: { items: [] },
    runReaderViaTempDbCopy: () => ({ run: { error: new Error("unexpected_reader_call"), status: 1 }, stdout: "", stderr: "" }),
    parseScriptJson: (s) => JSON.parse(s),
    readPieceCache: () => ({ item, cache: { cached: true, ttlMs: 1000 } }),
    readPieceLiteCache: () => null,
    writePieceLiteCache: () => {},
    writePieceCache: () => {},
    readContourCache: () => null,
    writeContourCache: () => {},
    readDiskCache: () => null,
    writeDiskCache: () => {},
    readHistoryCache: () => [],
    writeHistoryCache: () => {},
    isSamePieceId: () => true,
    looksLikeGuid: () => false,
    normalizeGuidLike: (v) => String(v || "")
  });
}

function parseContourPath(scrapContourJson) {
  const contour = JSON.parse(String(scrapContourJson || "{}"));
  return Array.isArray(contour.path) ? contour.path : [];
}

test("loadPieceById: mirrors contour for scanSide=leather_up and canonicalizes nap", () => {
  const rawContour = {
    units: "mm",
    path: [
      { x: 0, y: 0 },
      { x: 10, y: 0 },
      { x: 10, y: 10 },
      { x: 0, y: 10 },
      { x: 0, y: 0 }
    ]
  };
  const item = {
    id: "{TEST}",
    inventoryTag: "FL-SCR-000001",
    napDirectionDeg: 30,
    scrapContour: JSON.stringify(rawContour),
    metricsJson: JSON.stringify({
      scanSide: "leather_up",
      contourRaw: rawContour,
      napDirectionDegRaw: 30
    })
  };
  const svc = makeServiceWithCachedItem(item);
  const out = svc.loadPieceById("FL-SCR-000001");
  assert.equal(out.ok, true);

  // Vertical mirror around bbox center x=5: vertex (0,0) must become (10,0).
  const path = parseContourPath(out.item.scrapContour);
  assert.ok(path.length >= 4);
  assert.ok(path.some((p) => Number(p.x) === 10 && Number(p.y) === 0));
  const xs = path.map((p) => Number(p.x)).filter(Number.isFinite);
  const ys = path.map((p) => Number(p.y)).filter(Number.isFinite);
  assert.equal(Math.min(...xs), 0);
  assert.equal(Math.max(...xs), 10);
  assert.equal(Math.min(...ys), 0);
  assert.equal(Math.max(...ys), 10);
  assert.equal(out.item.napDirectionDeg, 150);

  const metrics = JSON.parse(String(out.item.metricsJson || "{}"));
  assert.equal(metrics.napDirectionDegCanonical, 150);
  assert.ok(metrics.contourCanonical);
  assert.equal(metrics.contourNormalization?.method, "mirror_vertical_bbox_center");
});

test("loadPieceById: legacy fallback mirrors from scrapContour when contourRaw absent", () => {
  const legacyContour = {
    units: "mm",
    path: [
      { x: 2, y: 1 },
      { x: 8, y: 1 },
      { x: 8, y: 5 },
      { x: 2, y: 5 },
      { x: 2, y: 1 }
    ]
  };
  const item = {
    id: "{TEST2}",
    inventoryTag: "FL-SCR-000002",
    napDirectionDeg: 45,
    scrapContour: JSON.stringify(legacyContour),
    metricsJson: JSON.stringify({ scanSide: "leather_up" })
  };
  const svc = makeServiceWithCachedItem(item);
  const out = svc.loadPieceById("FL-SCR-000002");
  assert.equal(out.ok, true);
  assert.equal(out.item.napDirectionDeg, 135);
  const metrics = JSON.parse(String(out.item.metricsJson || "{}"));
  assert.ok(metrics.contourCanonical);
});

test("loadPieceById: keeps contour as-is for non-leather_up scan side", () => {
  const contour = {
    units: "mm",
    path: [
      { x: 1, y: 1 },
      { x: 6, y: 1 },
      { x: 6, y: 4 },
      { x: 1, y: 4 },
      { x: 1, y: 1 }
    ]
  };
  const item = {
    id: "{TEST3}",
    inventoryTag: "FL-SCR-000003",
    napDirectionDeg: 210,
    scrapContour: JSON.stringify(contour),
    metricsJson: JSON.stringify({ scanSide: "face_up" })
  };
  const svc = makeServiceWithCachedItem(item);
  const out = svc.loadPieceById("FL-SCR-000003");
  assert.equal(out.ok, true);
  assert.equal(out.item.napDirectionDeg, 210);
  const path = parseContourPath(out.item.scrapContour);
  assert.equal(path[0].x, 1);
  assert.equal(path[0].y, 1);
});
