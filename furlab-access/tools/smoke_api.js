"use strict";

const baseUrl = String(process.env.SMOKE_BASE_URL || "http://127.0.0.1:5500").replace(/\/+$/, "");
const apiKey = String(process.env.FURLAB_API_KEY || "").trim();
const pieceId = String(process.env.SMOKE_PIECE_ID || "").trim();
const writeSmoke = String(process.env.SMOKE_WRITE || "").trim() === "1";
const writeSmokeFull = String(process.env.SMOKE_WRITE_FULL || "").trim() === "1";

async function httpJson(path, init = {}) {
  const headers = { ...(init.headers || {}) };
  if (apiKey) headers["X-API-Key"] = apiKey;
  const res = await fetch(`${baseUrl}${path}`, { ...init, headers });
  let json = null;
  try { json = await res.json(); } catch (_) {}
  return { res, json };
}

async function check(name, fn) {
  try {
    await fn();
    console.log(`OK  ${name}`);
  } catch (e) {
    console.error(`ERR ${name}: ${e.message || e}`);
    throw e;
  }
}

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

async function postJson(path, body) {
  return httpJson(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body || {})
  });
}

function inverseTransition(status) {
  const s = String(status || "").toLowerCase();
  if (s === "available") return { forward: "reserve", rollback: "release" };
  if (s === "reserved") return { forward: "release", rollback: "reserve" };
  return null;
}

async function main() {
  await check("health", async () => {
    const { res, json } = await httpJson("/api/health");
    assert(res.status === 200, `status=${res.status}`);
    assert(json && json.ok === true, "ok!=true");
  });

  await check("dicts", async () => {
    const { res, json } = await httpJson("/api/dicts");
    assert(res.status === 200, `status=${res.status}`);
    assert(json && Array.isArray(json.materials), "materials missing");
    assert(Array.isArray(json.locations), "locations missing");
  });

  await check("registry", async () => {
    const { res, json } = await httpJson("/api/registry?page=1&pageSize=5");
    assert(res.status === 200, `status=${res.status}`);
    assert(json && json.ok === true, "ok!=true");
    assert(Array.isArray(json.items), "items missing");
  });

  await check("history_usage", async () => {
    const { res, json } = await httpJson("/api/history/usage");
    assert(res.status === 200, `status=${res.status}`);
    assert(json && json.ok === true, "ok!=true");
    assert(Array.isArray(json.items), "items missing");
  });

  if (pieceId) {
    await check("piece_by_id", async () => {
      const { res, json } = await httpJson(`/api/piece/${encodeURIComponent(pieceId)}?include=all`);
      assert(res.status === 200, `status=${res.status}`);
      assert(json && json.ok === true, "ok!=true");
      assert(json.item && typeof json.item === "object", "item missing");
    });

    if (writeSmoke) {
      if (!apiKey) throw new Error("SMOKE_WRITE=1 requires FURLAB_API_KEY");

      let piece = null;
      await check("write_setup_read_piece", async () => {
        const { res, json } = await httpJson(`/api/piece/${encodeURIComponent(pieceId)}?include=all`);
        assert(res.status === 200, `status=${res.status}`);
        assert(json && json.ok === true, "ok!=true");
        piece = json.item || null;
        assert(piece && typeof piece === "object", "item missing");
      });

      await check("write_update_noop", async () => {
        const payload = {
          materialId: piece.materialId || "",
          storageLocationId: piece.storageLocationId || "",
          scrapQuality: piece.scrapQuality || "Good",
          note: piece.note || ""
        };
        const { res, json } = await postJson(`/api/piece/${encodeURIComponent(pieceId)}/update`, payload);
        assert(res.status === 200, `status=${res.status}`);
        assert(json && json.ok === true, "ok!=true");
      });

      await check("write_save_conflict_path", async () => {
        const tag = String(piece.inventoryTag || "").trim();
        assert(tag, "inventoryTag missing");
        const payload = {
          inventoryTag: tag,
          confirmOverwrite: false,
          scrapQuality: piece.scrapQuality || "Good",
          scrapStatus: piece.scrapStatus || "Available",
          note: piece.note || "",
          scrapContour: piece.scrapContour || {},
          metrics: {}
        };
        const { res, json } = await postJson("/api/save-scrap-piece", payload);
        assert(res.status === 409, `expected 409, got ${res.status}`);
        assert(json && json.ok === false, "ok should be false");
        assert(json.error === "already_exists", `unexpected error=${json && json.error}`);
      });

      await check("write_transition_and_rollback", async () => {
        const startStatus = String(piece.scrapStatus || "");
        const plan = inverseTransition(startStatus);
        if (!plan) {
          console.log(`SKIP write_transition_and_rollback (status=${startStatus})`);
          return;
        }

        const forward = await postJson(
          `/api/piece/${encodeURIComponent(pieceId)}/${plan.forward}`,
          { userName: "smoke-test", note: `smoke:${plan.forward}` }
        );
        assert(forward.res.status === 200, `forward status=${forward.res.status}`);
        assert(forward.json && forward.json.ok === true, "forward ok!=true");

        const rollback = await postJson(
          `/api/piece/${encodeURIComponent(pieceId)}/${plan.rollback}`,
          { userName: "smoke-test", note: `smoke:${plan.rollback}` }
        );
        assert(rollback.res.status === 200, `rollback status=${rollback.res.status}`);
        assert(rollback.json && rollback.json.ok === true, "rollback ok!=true");
      });
    }
  } else {
    console.log("SKIP piece_by_id (set SMOKE_PIECE_ID)");
  }

  if (writeSmokeFull) {
    if (!apiKey) throw new Error("SMOKE_WRITE_FULL=1 requires FURLAB_API_KEY");
    let tempTag = "";
    let tempId = "";
    let materialId = "";
    let storageLocationId = "";
    const metrics = { test: "smoke_write_full" };
    const contour = { points: [{ x: 0, y: 0 }, { x: 30, y: 0 }, { x: 30, y: 30 }, { x: 0, y: 30 }] };
    let cleanupScheduled = false;

    try {
      await check("write_full_setup_dicts", async () => {
        const { res, json } = await httpJson("/api/dicts");
        assert(res.status === 200, `status=${res.status}`);
        const m = Array.isArray(json?.materials) ? json.materials[0] : null;
        const l = Array.isArray(json?.locations) ? json.locations[0] : null;
        materialId = String(m?.id || "");
        storageLocationId = String(l?.id || "");
        assert(materialId, "materialId missing");
        assert(storageLocationId, "storageLocationId missing");
      });

      tempTag = `SMOKE_FULL_${new Date().toISOString().replace(/[^0-9]/g, "").slice(0, 14)}`;

      await check("write_full_save", async () => {
        const { res, json } = await postJson("/api/save-scrap-piece", {
          inventoryTag: tempTag,
          confirmOverwrite: true,
          materialId,
          storageLocationId,
          scrapQuality: "Good",
          scrapStatus: "Available",
          note: "smoke full create",
          areaMm2: 900,
          bboxWidthMm: 30,
          bboxHeightMm: 30,
          maxSpanMm: 42.4,
          napDirectionDeg: 0,
          scrapContour: contour,
          metrics
        });
        assert(res.status === 200, `status=${res.status}`);
        assert(json && json.ok === true, "ok!=true");
      });

      await check("write_full_fetch_id", async () => {
        const { res, json } = await httpJson(`/api/piece/${encodeURIComponent(tempTag)}`);
        assert(res.status === 200, `status=${res.status}`);
        assert(json && json.ok === true, "ok!=true");
        tempId = String(json?.item?.id || "");
        assert(tempId, "temp piece id missing");
      });

      await check("write_full_update", async () => {
        const { res, json } = await postJson(`/api/piece/${encodeURIComponent(tempId)}/update`, {
          materialId,
          storageLocationId,
          scrapQuality: "Limited",
          note: "smoke full updated"
        });
        assert(res.status === 200, `status=${res.status}`);
        assert(json && json.ok === true, "ok!=true");
      });

      await check("write_full_reserve", async () => {
        const { res, json } = await postJson(`/api/piece/${encodeURIComponent(tempId)}/reserve`, {
          userName: "smoke-test",
          note: "smoke reserve"
        });
        assert(res.status === 200, `status=${res.status}`);
        assert(json && json.ok === true, "ok!=true");
      });

      await check("write_full_release", async () => {
        const { res, json } = await postJson(`/api/piece/${encodeURIComponent(tempId)}/release`, {
          userName: "smoke-test",
          note: "smoke release"
        });
        assert(res.status === 200, `status=${res.status}`);
        assert(json && json.ok === true, "ok!=true");
      });

      await check("write_full_use", async () => {
        const { res, json } = await postJson(`/api/piece/${encodeURIComponent(tempId)}/use`, {
          userName: "smoke-test",
          note: "smoke use"
        });
        assert(res.status === 200, `status=${res.status}`);
        assert(json && json.ok === true, "ok!=true");
      });

      cleanupScheduled = true;
    } finally {
      if (cleanupScheduled && tempTag) {
        await check("write_full_cleanup_reset_available", async () => {
          const { res, json } = await postJson("/api/save-scrap-piece", {
            inventoryTag: tempTag,
            confirmOverwrite: true,
            materialId,
            storageLocationId,
            scrapQuality: "Good",
            scrapStatus: "Available",
            note: "smoke full cleanup",
            areaMm2: 900,
            bboxWidthMm: 30,
            bboxHeightMm: 30,
            maxSpanMm: 42.4,
            napDirectionDeg: 0,
            scrapContour: contour,
            metrics: { ...metrics, cleanup: true }
          });
          assert(res.status === 200, `status=${res.status}`);
          assert(json && json.ok === true, "ok!=true");
        });
      }
    }
  }

  console.log("Smoke API checks passed.");
}

main().catch(() => {
  process.exit(1);
});
