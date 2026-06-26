"use strict";

const {
  pointsToMultiPolygon,
  intersectMulti,
  unionMulti,
  diffMulti,
  multiPolygonArea
} = require("../services/polygon_ops");

function normalizePoint(point) {
  const x = Number(point && point.x);
  const y = Number(point && point.y);
  if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
  return { x, y };
}

function normalizeContour(points) {
  return (Array.isArray(points) ? points : []).map(normalizePoint).filter(Boolean);
}

function parseOptionalString(val) {
  return val !== undefined && val !== null && String(val).trim() ? String(val).trim() : null;
}

async function handleZoneRoutes(req, res, reqUrl, deps) {
  const jsonReply = deps && deps.jsonReply;
  const readBodyJson = deps && deps.readBodyJson;
  const zoneStore = deps && deps.zoneStore;
  if (typeof jsonReply !== "function" || typeof readBodyJson !== "function" || !zoneStore) {
    throw new Error("zone_route_deps_missing");
  }

  if (req.method === "GET" && reqUrl.pathname === "/api/zones") {
    const workspaceKey = String(reqUrl.searchParams.get("workspaceKey") || "").trim();
    if (!workspaceKey) return jsonReply(res, 400, { ok: false, error: "workspace_key_required" });
    try {
      const zones = zoneStore.list(workspaceKey);
      return jsonReply(res, 200, { ok: true, workspaceKey, zones });
    } catch (e) {
      return jsonReply(res, 500, { ok: false, error: e && e.message ? e.message : "zone_list_failed" });
    }
  }

  if (req.method === "POST" && reqUrl.pathname === "/api/zones/save") {
    try {
      const body = await readBodyJson(req);
      const workspaceKey = String(body && body.workspaceKey || "").trim();
      const selectedZoneId = Number(body && body.selectedZoneId || 0) || null;
      const zones = zoneStore.saveAll(workspaceKey, body && body.zones, { selectedZoneId });
      return jsonReply(res, 200, { ok: true, workspaceKey, selectedZoneId, zones });
    } catch (e) {
      return jsonReply(res, 400, { ok: false, error: e && e.message ? e.message : "zone_save_failed" });
    }
  }

  if (req.method === "POST" && reqUrl.pathname === "/api/zones/delete") {
    try {
      const body = await readBodyJson(req);
      const workspaceKey = String(body && body.workspaceKey || "").trim();
      const zoneId = Number(body && body.zoneId || 0) || 0;
      const zones = zoneStore.deleteOne(workspaceKey, zoneId);
      return jsonReply(res, 200, { ok: true, workspaceKey, zones });
    } catch (e) {
      return jsonReply(res, 400, { ok: false, error: e && e.message ? e.message : "zone_delete_failed" });
    }
  }

  {
    const match = req.method === "POST"
      ? reqUrl.pathname.match(/^\/api\/project\/zones\/(\d+)\/material$/)
      : null;
    if (match) {
      try {
        const body = await readBodyJson(req);
        const workspaceKey = String(body && body.workspaceKey || "").trim();
        const zoneId = Number(match[1] || 0) || 0;
        const materialId = parseOptionalString(body && body.materialId);
        const materialName = parseOptionalString(body && body.materialName);
        const zones = zoneStore.setMaterial(workspaceKey, zoneId, { materialId, materialName });
        return jsonReply(res, 200, { ok: true, workspaceKey, zoneId, materialId, materialName, zones });
      } catch (e) {
        return jsonReply(res, 400, { ok: false, error: e && e.message ? e.message : "zone_material_failed" });
      }
    }
  }

  if (req.method === "POST" && reqUrl.pathname === "/api/zones/reset") {
    try {
      const body = await readBodyJson(req);
      const workspaceKey = String(body && body.workspaceKey || "").trim();
      zoneStore.resetWorkspace(workspaceKey);
      return jsonReply(res, 200, { ok: true, workspaceKey });
    } catch (e) {
      return jsonReply(res, 400, { ok: false, error: e && e.message ? e.message : "zone_reset_failed" });
    }
  }

  if (req.method === "POST" && reqUrl.pathname === "/api/zones/validate") {
    try {
      const body = await readBodyJson(req);
      const details = Array.isArray(body && body.details) ? body.details : [];
      const zones = Array.isArray(body && body.zones) ? body.zones : [];
      const detailMap = new Map();
      const zonesByDetail = new Map();
      const zoneResults = [];
      const detailResults = [];
      const overlapResults = [];

      for (const rawDetail of details) {
        const detailId = Number(rawDetail && rawDetail.id);
        const points = normalizeContour(rawDetail && rawDetail.points);
        if (!Number.isFinite(detailId) || detailId <= 0 || points.length < 3) continue;
        const mp = pointsToMultiPolygon(points);
        detailMap.set(detailId, {
          id: detailId,
          name: String(rawDetail && rawDetail.name || `Деталь ${detailId}`),
          mp,
          areaMm2: multiPolygonArea(mp)
        });
      }

      for (const rawZone of zones) {
        const zoneId = Number(rawZone && rawZone.id);
        const detailId = Number(rawZone && rawZone.detailId);
        const points = normalizeContour(rawZone && rawZone.points);
        if (!Number.isFinite(zoneId) || zoneId <= 0 || !Number.isFinite(detailId) || detailId <= 0 || points.length < 3) continue;
        const mp = pointsToMultiPolygon(points);
        const detail = detailMap.get(detailId) || null;
        const zoneAreaMm2 = multiPolygonArea(mp);
        const insideMp = detail ? intersectMulti(mp, detail.mp) : [];
        const insideAreaMm2 = multiPolygonArea(insideMp);
        const zoneRecord = {
          id: zoneId,
          name: String(rawZone && rawZone.name || `Зона ${zoneId}`),
          detailId,
          mp,
          areaMm2: zoneAreaMm2,
          outsideAreaMm2: Math.max(0, zoneAreaMm2 - insideAreaMm2),
          overlaps: []
        };
        zoneResults.push(zoneRecord);
        if (!zonesByDetail.has(detailId)) zonesByDetail.set(detailId, []);
        zonesByDetail.get(detailId).push(zoneRecord);
      }

      for (const [detailId, detailZones] of zonesByDetail.entries()) {
        let unionMpForDetail = [];
        for (let i = 0; i < detailZones.length; i++) {
          const zone = detailZones[i];
          unionMpForDetail = unionMpForDetail.length ? unionMulti(unionMpForDetail, zone.mp) : zone.mp;
          for (let j = i + 1; j < detailZones.length; j++) {
            const other = detailZones[j];
            const overlapMp = intersectMulti(zone.mp, other.mp);
            const overlapAreaMm2 = multiPolygonArea(overlapMp);
            if (overlapAreaMm2 > 1e-6) {
              zone.overlaps.push({ zoneId: other.id, areaMm2: overlapAreaMm2 });
              other.overlaps.push({ zoneId: zone.id, areaMm2: overlapAreaMm2 });
              overlapResults.push({ detailId, zoneAId: zone.id, zoneBId: other.id, areaMm2: overlapAreaMm2 });
            }
          }
        }
        const detail = detailMap.get(detailId) || null;
        if (detail) {
          const uncoveredMp = diffMulti(detail.mp, unionMpForDetail);
          detailResults.push({
            id: detail.id,
            name: detail.name,
            areaMm2: detail.areaMm2,
            uncoveredAreaMm2: multiPolygonArea(uncoveredMp),
            zoneCount: detailZones.length
          });
        }
      }

      for (const detail of detailMap.values()) {
        if (detailResults.some((item) => Number(item.id) === Number(detail.id))) continue;
        detailResults.push({
          id: detail.id,
          name: detail.name,
          areaMm2: detail.areaMm2,
          uncoveredAreaMm2: detail.areaMm2,
          zoneCount: 0
        });
      }

      return jsonReply(res, 200, {
        ok: true,
        summary: {
          details: detailResults.length,
          zones: zoneResults.length,
          overlaps: overlapResults.length,
          uncoveredAreaMm2: detailResults.reduce((sum, item) => sum + Number(item && item.uncoveredAreaMm2 || 0), 0),
          outsideAreaMm2: zoneResults.reduce((sum, item) => sum + Number(item && item.outsideAreaMm2 || 0), 0)
        },
        details: detailResults,
        zones: zoneResults.map((zone) => ({
          id: zone.id,
          name: zone.name,
          detailId: zone.detailId,
          areaMm2: zone.areaMm2,
          outsideAreaMm2: zone.outsideAreaMm2,
          overlaps: zone.overlaps
        })),
        overlaps: overlapResults
      });
    } catch (e) {
      return jsonReply(res, 400, { ok: false, error: e && e.message ? e.message : "zone_validate_failed" });
    }
  }
}

module.exports = {
  handleZoneRoutes
};
