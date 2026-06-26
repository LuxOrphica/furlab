"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { requestJson } = require("./test_client");

const pieceId = String(process.env.BACKEND_TEST_PIECE_ID || process.env.SMOKE_PIECE_ID || "").trim();

test("GET /api/health contract", async () => {
  const { res, json } = await requestJson("/api/health");
  assert.equal(res.status, 200);
  assert.equal(json?.ok, true);
  assert.equal(typeof json?.dbPath, "string");
  assert.equal(typeof json?.server?.file, "string");
  assert.equal(typeof json?.cacheTtl?.dictsMs, "number");
  assert.equal(typeof json?.requestId, "string");
});

test("GET /api/dicts contract", async () => {
  const { res, json } = await requestJson("/api/dicts");
  assert.equal(res.status, 200);
  assert.equal(json?.ok, true);
  assert.ok(Array.isArray(json?.materials));
  assert.ok(Array.isArray(json?.locations));
  assert.ok(Array.isArray(json?.qualities));
  assert.ok(Array.isArray(json?.statuses));
});

test("GET /api/registry contract", async () => {
  const { res, json } = await requestJson("/api/registry?page=1&pageSize=10");
  assert.equal(res.status, 200);
  assert.equal(json?.ok, true);
  assert.ok(Array.isArray(json?.items));
  assert.equal(typeof json?.total, "number");
});

test("GET /api/history/usage contract", async () => {
  const { res, json } = await requestJson("/api/history/usage");
  assert.equal(res.status, 200);
  assert.equal(json?.ok, true);
  assert.ok(Array.isArray(json?.items));
  assert.equal(typeof json?.requestId, "string");
});

test("Unknown /api route returns normalized JSON error", async () => {
  const { res, json } = await requestJson("/api/not-found");
  assert.equal(res.status, 404);
  assert.equal(json?.ok, false);
  assert.equal(json?.errorCode, "api_not_found");
  assert.equal(typeof json?.errorDetail?.message, "string");
  assert.equal(typeof json?.errorDetail?.requestId, "string");
});

test("GET /api/piece/:id include contract", { skip: !pieceId }, async () => {
  const encoded = encodeURIComponent(pieceId);
  const { res: r1, json: j1 } = await requestJson(`/api/piece/${encoded}?includeReservation=1&includeHistory=1`);
  assert.equal(r1.status, 200);
  assert.equal(j1?.ok, true);
  assert.equal(typeof j1?.item, "object");
  assert.ok(Object.prototype.hasOwnProperty.call(j1, "reservation"));
  assert.ok(Object.prototype.hasOwnProperty.call(j1, "history"));

  const { res: r2, json: j2 } = await requestJson(`/api/piece/${encoded}?includeReservation=1&includeHistory=0`);
  assert.equal(r2.status, 200);
  assert.equal(j2?.ok, true);
  assert.equal(typeof j2?.item, "object");
  assert.ok(Object.prototype.hasOwnProperty.call(j2, "reservation"));
  assert.ok(!Object.prototype.hasOwnProperty.call(j2, "history"));
});
