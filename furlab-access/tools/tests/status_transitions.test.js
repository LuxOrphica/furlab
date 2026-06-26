"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { apiKey, baseUrl, requestJson, postJson } = require("./test_client");

const pieceId = String(process.env.BACKEND_TEST_PIECE_ID || process.env.SMOKE_PIECE_ID || "").trim();
const enableWrite = String(process.env.BACKEND_TEST_WRITE || "").trim() === "1";

function normalizeStatus(s) {
  return String(s || "").trim().toLowerCase();
}

function deniedActionForStatus(status) {
  const s = normalizeStatus(status);
  if (s === "available") return "release";
  if (s === "reserved") return "reserve";
  return "reserve";
}

function reversiblePlan(status) {
  const s = normalizeStatus(status);
  if (s === "available") return { forward: "reserve", rollback: "release" };
  if (s === "reserved") return { forward: "release", rollback: "reserve" };
  return null;
}

test("Transition endpoints are auth-protected when API key is required", async () => {
  const encoded = encodeURIComponent(pieceId || "{00000000-0000-0000-0000-000000000000}");
  const res = await fetch(`${baseUrl}/api/piece/${encoded}/reserve`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ userName: "test" })
  });
  const json = await res.json().catch(() => null);
  if (!apiKey) {
    assert.ok([200, 400, 404].includes(res.status));
    return;
  }
  assert.equal(res.status, 401);
  assert.equal(json?.ok, false);
});

test("Business transitions and edge cases", { skip: !(enableWrite && apiKey && pieceId) }, async () => {
  const encoded = encodeURIComponent(pieceId);
  const read = await requestJson(`/api/piece/${encoded}`);
  assert.equal(read.res.status, 200);
  assert.equal(read.json?.ok, true);
  const startStatus = read.json?.item?.scrapStatus || "";

  const deniedAction = deniedActionForStatus(startStatus);
  const denied = await postJson(`/api/piece/${encoded}/${deniedAction}`, {
    userName: "backend-test",
    note: "denied-check"
  });
  assert.equal(denied.res.status, 400);
  assert.equal(denied.json?.ok, false);
  assert.equal(typeof denied.json?.errorCode, "string");

  const plan = reversiblePlan(startStatus);
  if (!plan) {
    return;
  }

  const forward = await postJson(`/api/piece/${encoded}/${plan.forward}`, {
    userName: "backend-test",
    note: "transition-forward"
  });
  assert.equal(forward.res.status, 200);
  assert.equal(forward.json?.ok, true);

  const rollback = await postJson(`/api/piece/${encoded}/${plan.rollback}`, {
    userName: "backend-test",
    note: "transition-rollback"
  });
  assert.equal(rollback.res.status, 200);
  assert.equal(rollback.json?.ok, true);
});

test("Concurrent reserve conflict (optimistic/concurrency path)", { skip: !(enableWrite && apiKey && pieceId) }, async () => {
  const encoded = encodeURIComponent(pieceId);

  const ensureAvailable = async () => {
    const r = await requestJson(`/api/piece/${encoded}`);
    assert.equal(r.res.status, 200);
    const s = normalizeStatus(r.json?.item?.scrapStatus);
    if (s === "reserved") {
      const rel = await postJson(`/api/piece/${encoded}/release`, { userName: "backend-test", note: "prep-release" });
      assert.equal(rel.res.status, 200);
    }
  };

  await ensureAvailable();

  const [a, b] = await Promise.all([
    postJson(`/api/piece/${encoded}/reserve`, { userName: "backend-test", note: "race-a" }),
    postJson(`/api/piece/${encoded}/reserve`, { userName: "backend-test", note: "race-b" })
  ]);
  const statuses = [a.res.status, b.res.status].sort();
  assert.deepEqual(statuses, [200, 400]);

  const release = await postJson(`/api/piece/${encoded}/release`, { userName: "backend-test", note: "race-cleanup" });
  assert.equal(release.res.status, 200);
});
