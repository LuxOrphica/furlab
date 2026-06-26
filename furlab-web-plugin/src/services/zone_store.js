"use strict";

const fs = require("fs");
const path = require("path");
const { pointsToMultiPolygon, unionMulti, largestOuterRingPoints } = require("./polygon_ops");

function createZoneStore(options) {
  const filePath = String(options && options.filePath || "");
  if (!filePath) throw new Error("zone_store_file_required");
  fs.mkdirSync(path.dirname(filePath), { recursive: true });

  function readStore() {
    if (!fs.existsSync(filePath)) {
      return { version: 1, workspaces: {} };
    }
    try {
      const raw = fs.readFileSync(filePath, "utf8");
      const data = JSON.parse(raw);
      if (!data || typeof data !== "object") return { version: 1, workspaces: {} };
      if (!data.workspaces || typeof data.workspaces !== "object") data.workspaces = {};
      return data;
    } catch (_) {
      return { version: 1, workspaces: {} };
    }
  }

  function writeStore(store) {
    const safeStore = store && typeof store === "object" ? store : { version: 1, workspaces: {} };
    if (!safeStore.workspaces || typeof safeStore.workspaces !== "object") safeStore.workspaces = {};
    fs.writeFileSync(filePath, JSON.stringify(safeStore, null, 2), "utf8");
  }

  function polygonArea(points) {
    if (!Array.isArray(points) || points.length < 3) return 0;
    let sum = 0;
    for (let i = 0; i < points.length; i++) {
      const a = points[i];
      const b = points[(i + 1) % points.length];
      sum += Number(a.x || 0) * Number(b.y || 0) - Number(b.x || 0) * Number(a.y || 0);
    }
    return Math.abs(sum) * 0.5;
  }

  function normalizeZone(raw, context) {
    const id = Number(raw && raw.id);
    const detailId = Number(raw && raw.detailId);
    const napDirectionDeg = Number(raw && raw.napDirectionDeg);
    const points = (Array.isArray(raw && raw.points) ? raw.points : [])
      .map((point) => ({ x: Number(point && point.x), y: Number(point && point.y) }))
      .filter((point) => Number.isFinite(point.x) && Number.isFinite(point.y));
    if (!Number.isFinite(id) || id <= 0) throw new Error("invalid_zone_id");
    if (!Number.isFinite(detailId) || detailId <= 0) throw new Error(`invalid_zone_detail:${id}`);
    if (points.length < 3) throw new Error(`invalid_zone_points:${id}`);
    if (polygonArea(points) <= 1e-6) throw new Error(`invalid_zone_area:${id}`);
    const detailZoneCount = Number(context && context.detailZoneCounts && context.detailZoneCounts.get(detailId) || 0) || 0;
    const explicitOriginType = String(raw && raw.originType || "").trim().toLowerCase();
    const inferredOriginType = explicitOriginType === "split" || explicitOriginType === "base" || explicitOriginType === "manual"
      ? explicitOriginType
      : (detailZoneCount > 1 ? "split" : "base");
    const parentZoneSnapshotRaw = raw && raw.parentZoneSnapshot && typeof raw.parentZoneSnapshot === "object"
      ? raw.parentZoneSnapshot
      : null;
    const parentZoneSnapshot = parentZoneSnapshotRaw
      ? {
          id: Number(parentZoneSnapshotRaw.id || 0) || null,
          name: String(parentZoneSnapshotRaw.name || ""),
          detailId: Number(parentZoneSnapshotRaw.detailId || 0) || null,
          materialId: parentZoneSnapshotRaw.materialId !== undefined && parentZoneSnapshotRaw.materialId !== null && String(parentZoneSnapshotRaw.materialId).trim()
            ? String(parentZoneSnapshotRaw.materialId).trim()
            : null,
          materialName: parentZoneSnapshotRaw.materialName !== undefined && parentZoneSnapshotRaw.materialName !== null && String(parentZoneSnapshotRaw.materialName).trim()
            ? String(parentZoneSnapshotRaw.materialName).trim()
            : null,
          napDirectionDeg: Number.isFinite(Number(parentZoneSnapshotRaw.napDirectionDeg)) ? Number(parentZoneSnapshotRaw.napDirectionDeg) : 90,
          originType: ["base", "split", "manual"].includes(String(parentZoneSnapshotRaw.originType || "").trim().toLowerCase())
            ? String(parentZoneSnapshotRaw.originType || "").trim().toLowerCase()
            : "base",
          parentZoneId: Number(parentZoneSnapshotRaw.parentZoneId || 0) || null,
          points: (Array.isArray(parentZoneSnapshotRaw.points) ? parentZoneSnapshotRaw.points : [])
            .map((point) => ({ x: Number(point && point.x), y: Number(point && point.y) }))
            .filter((point) => Number.isFinite(point.x) && Number.isFinite(point.y))
        }
      : null;
    return {
      id,
      name: String(raw && raw.name || `Зона ${id}`),
      detailId,
      materialId: raw && raw.materialId !== undefined && raw.materialId !== null && String(raw.materialId).trim()
        ? String(raw.materialId).trim()
        : null,
      materialName: raw && raw.materialName !== undefined && raw.materialName !== null && String(raw.materialName).trim()
        ? String(raw.materialName).trim()
        : null,
      napDirectionDeg: Number.isFinite(napDirectionDeg) ? napDirectionDeg : 90,
      originType: inferredOriginType === "split" || inferredOriginType === "manual" ? inferredOriginType : "base",
      parentZoneId: Number(raw && raw.parentZoneId || 0) || null,
      parentZoneSnapshot: parentZoneSnapshot && parentZoneSnapshot.id && parentZoneSnapshot.detailId && Array.isArray(parentZoneSnapshot.points) && parentZoneSnapshot.points.length >= 3
        ? parentZoneSnapshot
        : null,
      points,
      holes: Array.isArray(raw && raw.holes)
        ? raw.holes.map((h) => Array.isArray(h)
            ? h.map((p) => ({ x: Number(p && p.x), y: Number(p && p.y) })).filter((p) => Number.isFinite(p.x) && Number.isFinite(p.y))
            : []).filter((h) => h.length >= 3)
        : []
    };
  }

  function normalizeZones(rawZones) {
    const detailZoneCounts = new Map();
    for (const raw of Array.isArray(rawZones) ? rawZones : []) {
      const detailId = Number(raw && raw.detailId);
      if (!Number.isFinite(detailId) || detailId <= 0) continue;
      detailZoneCounts.set(detailId, Number(detailZoneCounts.get(detailId) || 0) + 1);
    }
    return (Array.isArray(rawZones) ? rawZones : []).map((raw) => normalizeZone(raw, { detailZoneCounts }));
  }

  function inferNumericParentZoneId(zoneId) {
    const id = Number(zoneId);
    if (!Number.isFinite(id) || id <= 0 || id < 10) return null;
    return Math.floor(id / 10) || null;
  }

  function inferParentMetaFromHierarchy(current, zone) {
    const detailId = Number(zone && zone.detailId || 0) || null;
    const parentId = Number(zone && zone.parentZoneId || 0) || null;
    if (!detailId || !parentId) return { originType: "base", parentZoneId: null };
    const existingParent = (Array.isArray(current) ? current : []).find((item) =>
      Number(item && item.id || 0) === parentId
      && Number(item && item.detailId || 0) === detailId
    ) || null;
    if (existingParent) {
      return {
        originType: String(existingParent.originType || "base") === "split" ? "split" : "base",
        parentZoneId: Number(existingParent.parentZoneId || 0) || null
      };
    }
    const inferredAncestorId = inferNumericParentZoneId(parentId);
    return {
      originType: inferredAncestorId ? "split" : "base",
      parentZoneId: inferredAncestorId
    };
  }

  function collectSplitChildren(current, zone) {
    const detailId = Number(zone && zone.detailId || 0) || 0;
    const parentZoneId = Number(zone && zone.parentZoneId || 0) || 0;
    return (Array.isArray(current) ? current : []).filter((item) =>
      String(item && item.originType || "base") === "split"
      && Number(item && item.detailId || 0) === detailId
      && Number(item && item.parentZoneId || 0) === parentZoneId
    );
  }

  function hasSplitDescendants(current, zone) {
    const detailId = Number(zone && zone.detailId || 0) || 0;
    const zoneIdText = String(Number(zone && zone.id || 0) || "");
    if (!detailId || !zoneIdText) return false;
    return (Array.isArray(current) ? current : []).some((item) => {
      if (String(item && item.originType || "base") !== "split") return false;
      if (Number(item && item.detailId || 0) !== detailId) return false;
      const itemIdText = String(Number(item && item.id || 0) || "");
      return itemIdText.length > zoneIdText.length && itemIdText.startsWith(zoneIdText);
    });
  }

  function buildParentSnapshotFromChildren(current, children, fallbackZone) {
    if (!Array.isArray(children) || children.length < 2) return null;
    let merged = [];
    for (const child of children) {
      merged = unionMulti(merged, pointsToMultiPolygon(child && child.points));
    }
    const points = largestOuterRingPoints(merged);
    if (!Array.isArray(points) || points.length < 3) return null;
    const zone = fallbackZone && typeof fallbackZone === "object" ? fallbackZone : {};
    const parentId = Number(zone.parentZoneId || (children[0] && children[0].parentZoneId) || 0) || null;
    const detailId = Number(zone.detailId || (children[0] && children[0].detailId) || 0) || null;
    if (!parentId || !detailId) return null;
    const parentMeta = inferParentMetaFromHierarchy(current, { detailId, parentZoneId: parentId });
    return {
      id: parentId,
      name: String(zone.parentZoneSnapshot && zone.parentZoneSnapshot.name || `Зона ${parentId}`),
      detailId,
      materialId: zone && zone.parentZoneSnapshot && zone.parentZoneSnapshot.materialId
        ? String(zone.parentZoneSnapshot.materialId)
        : (children[0] && children[0].materialId ? String(children[0].materialId) : null),
      materialName: zone && zone.parentZoneSnapshot && zone.parentZoneSnapshot.materialName
        ? String(zone.parentZoneSnapshot.materialName)
        : (children[0] && children[0].materialName ? String(children[0].materialName) : null),
      napDirectionDeg: Number.isFinite(Number(zone.napDirectionDeg))
        ? Number(zone.napDirectionDeg)
        : Number.isFinite(Number(children[0] && children[0].napDirectionDeg))
          ? Number(children[0].napDirectionDeg)
          : 90,
      originType: parentMeta.originType,
      parentZoneId: parentMeta.parentZoneId,
      points
    };
  }

  function findNearestExistingAncestor(current, zone) {
    const detailId = Number(zone && zone.detailId || 0) || null;
    let candidateId = Number(zone && zone.parentZoneId || 0) || null;
    if (!detailId || !candidateId) return null;
    while (candidateId) {
      const hit = (Array.isArray(current) ? current : []).find((item) =>
        Number(item && item.id || 0) === candidateId
        && Number(item && item.detailId || 0) === detailId
      ) || null;
      if (hit) return hit;
      candidateId = inferNumericParentZoneId(candidateId);
    }
    return null;
  }

  function list(workspaceKey) {
    const store = readStore();
    const key = String(workspaceKey || "").trim();
    if (!key) return [];
    const rec = store.workspaces[key];
    const zones = Array.isArray(rec && rec.zones) ? rec.zones : [];
    return normalizeZones(zones);
  }

  function saveAll(workspaceKey, zones, meta) {
    const key = String(workspaceKey || "").trim();
    if (!key) throw new Error("workspace_key_required");
    const normalized = normalizeZones(zones);
    const store = readStore();
    store.workspaces[key] = {
      workspaceKey: key,
      updatedAt: new Date().toISOString(),
      selectedZoneId: Number(meta && meta.selectedZoneId || 0) || null,
      zones: normalized
    };
    writeStore(store);
    return normalized;
  }

  function setMaterial(workspaceKey, zoneId, material) {
    const key = String(workspaceKey || "").trim();
    const zid = Number(zoneId);
    if (!key) throw new Error("workspace_key_required");
    if (!Number.isFinite(zid) || zid <= 0) throw new Error("zone_id_required");
    const store = readStore();
    const rec = store.workspaces[key];
    if (!rec || !Array.isArray(rec.zones)) throw new Error("workspace_not_found");
    const current = normalizeZones(rec.zones);
    const target = current.find((zone) => Number(zone && zone.id || 0) === zid) || null;
    if (!target) throw new Error("zone_not_found");
    const materialId = material && material.materialId !== undefined && material.materialId !== null && String(material.materialId).trim()
      ? String(material.materialId).trim()
      : null;
    const materialName = material && material.materialName !== undefined && material.materialName !== null && String(material.materialName).trim()
      ? String(material.materialName).trim()
      : null;
    target.materialId = materialId;
    target.materialName = materialName || materialId;
    rec.zones = current;
    rec.updatedAt = new Date().toISOString();
    writeStore(store);
    return normalizeZones(rec.zones);
  }

  function deleteOne(workspaceKey, zoneId) {
    const key = String(workspaceKey || "").trim();
    const zid = Number(zoneId);
    if (!key) throw new Error("workspace_key_required");
    if (!Number.isFinite(zid) || zid <= 0) throw new Error("zone_id_required");
    const store = readStore();
    const rec = store.workspaces[key];
    if (!rec || !Array.isArray(rec.zones)) return [];
    const current = normalizeZones(rec.zones);
    const target = current.find((zone) => Number(zone && zone.id || 0) === zid) || null;
    if (!target) return current;
    if (String(target.originType || "base") === "manual") {
      rec.zones = current.filter((zone) => Number(zone && zone.id || 0) !== zid);
      rec.updatedAt = new Date().toISOString();
      writeStore(store);
      return normalizeZones(rec.zones);
    }
    if (String(target.originType || "base") !== "split") {
      throw new Error("base_zone_cannot_be_deleted");
    }
    if (hasSplitDescendants(current, target)) {
      throw new Error("split_zone_has_children");
    }
    const siblingChildren = collectSplitChildren(current, target);
    let parentSnapshot = target.parentZoneSnapshot && typeof target.parentZoneSnapshot === "object"
      ? normalizeZone(target.parentZoneSnapshot, { detailZoneCounts: new Map([[Number(target.parentZoneSnapshot.detailId || 0), 1]]) })
      : null;
    if (!parentSnapshot) {
      const siblingWithSnapshot = siblingChildren.find((zone) => zone && zone.parentZoneSnapshot && typeof zone.parentZoneSnapshot === "object") || null;
      if (siblingWithSnapshot) {
        parentSnapshot = normalizeZone(siblingWithSnapshot.parentZoneSnapshot, { detailZoneCounts: new Map([[Number(siblingWithSnapshot.parentZoneSnapshot.detailId || 0), 1]]) });
      }
    }
    if (!parentSnapshot) {
      const synthesized = buildParentSnapshotFromChildren(current, siblingChildren, target);
      if (synthesized) {
        parentSnapshot = normalizeZone(synthesized, { detailZoneCounts: new Map([[Number(synthesized.detailId || 0), synthesized.originType === "split" ? 2 : 1]]) });
      }
    }
    const removeIds = new Set();
    if (parentSnapshot) {
      for (const child of siblingChildren) {
        const cid = Number(child && child.id || 0) || 0;
        if (cid > 0) removeIds.add(cid);
      }
    } else {
      const nearestAncestor = findNearestExistingAncestor(current, target);
      if (!nearestAncestor) {
        throw new Error("split_zone_parent_snapshot_missing");
      }
      const subtreePrefix = String(Number(target.parentZoneId || 0) || "");
      for (const zone of current) {
        const idText = String(Number(zone && zone.id || 0) || "");
        if (
          String(zone && zone.originType || "base") === "split"
          && Number(zone && zone.detailId || 0) === Number(target.detailId || 0)
          && subtreePrefix
          && idText.startsWith(subtreePrefix)
        ) {
          removeIds.add(Number(zone.id || 0));
        }
      }
      removeIds.add(zid);
    }
    const keepZones = current.filter((zone) => !removeIds.has(Number(zone && zone.id || 0)));
    if (parentSnapshot && !keepZones.some((zone) => Number(zone && zone.id || 0) === Number(parentSnapshot.id || 0) && Number(zone && zone.detailId || 0) === Number(parentSnapshot.detailId || 0))) {
      keepZones.push(parentSnapshot);
    }
    rec.zones = keepZones;
    rec.updatedAt = new Date().toISOString();
    writeStore(store);
    return normalizeZones(rec.zones);
  }

  function resetWorkspace(workspaceKey) {
    const key = String(workspaceKey || "").trim();
    if (!key) throw new Error("workspace_key_required");
    const store = readStore();
    if (store.workspaces && Object.prototype.hasOwnProperty.call(store.workspaces, key)) {
      delete store.workspaces[key];
      writeStore(store);
    }
    return true;
  }

  return {
    list,
    saveAll,
    setMaterial,
    deleteOne,
    resetWorkspace
  };
}

module.exports = {
  createZoneStore
};
