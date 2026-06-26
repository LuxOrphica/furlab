// FurLab Zone classification helpers
// Exposes window.FurLabZoneClassify
(function (global) {

  let _state = null;

  function init(ctx) {
    _state = ctx.state;
  }

  // ---------------------------------------------------------------------------
  // Detail contour
  // ---------------------------------------------------------------------------

  function getDetailContourPoints(detailId) {
    const detail = (Array.isArray(_state.details) ? _state.details : []).find((item) =>
      Number(item && item.id || 0) === Number(detailId || 0)
    ) || null;
    const pts = Array.isArray(detail && detail.entity && detail.entity.points) ? detail.entity.points : [];
    return pts.length >= 3 ? pts : [];
  }

  function pointsMatchExactly(pointsA, pointsB, toleranceMm) {
    if (toleranceMm === undefined) toleranceMm = 0.01;
    const a = Array.isArray(pointsA) ? pointsA : [];
    const b = Array.isArray(pointsB) ? pointsB : [];
    if (a.length < 3 || b.length < 3 || a.length !== b.length) return false;
    const tol2 = toleranceMm * toleranceMm;
    for (let i = 0; i < a.length; i++) {
      const dx = a[i].x - b[i].x;
      const dy = a[i].y - b[i].y;
      if (dx * dx + dy * dy > tol2) return false;
    }
    return true;
  }

  // ---------------------------------------------------------------------------
  // Zone origin classification
  // ---------------------------------------------------------------------------

  function isLikelyBaseZone(zone) {
    const z = zone && typeof zone === "object" ? zone : null;
    if (!z) return false;
    return pointsMatchExactly(
      Array.isArray(z.points) ? z.points : [],
      getDetailContourPoints(Number(z.detailId || 0) || 0),
      0.01
    );
  }

  function isLegacyManualZone(zone) {
    const z = zone && typeof zone === "object" ? zone : null;
    if (!z) return false;
    const origin = String(z.originType || "").trim().toLowerCase();
    if (origin === "manual") return true;
    if (origin === "split") return false;
    if (Number(z.parentZoneId || 0) > 0) return false;
    return !isLikelyBaseZone(z);
  }

  function migrateLoadedZoneOriginTypes(zones) {
    const list = Array.isArray(zones) ? zones : [];
    let changed = false;
    for (const zone of list) {
      const origin = String(zone && zone.originType || "").trim().toLowerCase();
      if (isLegacyManualZone(zone) && origin !== "manual") {
        zone.originType = "manual";
        changed = true;
      } else if (isLikelyBaseZone(zone) && origin !== "base" && Number(zone && zone.parentZoneId || 0) <= 0) {
        zone.originType = "base";
        changed = true;
      }
    }
    return changed;
  }

  function isSplitDerivedZone(zone) {
    return !!(zone && String(zone.originType || "base") === "split");
  }

  function isManualZone(zone) {
    return !!(zone && (String(zone.originType || "base") === "manual" || isLegacyManualZone(zone)));
  }

  function getRelatedSplitZones(zone) {
    const z = zone && typeof zone === "object" ? zone : null;
    if (!z || !isSplitDerivedZone(z)) return [];
    return (Array.isArray(_state.zones) ? _state.zones : []).filter((item) =>
      String(item && item.originType || "base") === "split" &&
      Number(item && item.parentZoneId || 0) === Number(z.parentZoneId || 0) &&
      Number(item && item.detailId || 0) === Number(z.detailId || 0)
    );
  }

  function hasSplitDescendants(zone) {
    const z = zone && typeof zone === "object" ? zone : null;
    if (!z || !isSplitDerivedZone(z)) return false;
    const detailId = Number(z.detailId || 0) || 0;
    const zoneIdText = String(Number(z.id || 0) || "");
    if (!detailId || !zoneIdText) return false;
    return (Array.isArray(_state.zones) ? _state.zones : []).some((item) => {
      if (!item || String(item.originType || "base") !== "split") return false;
      if (Number(item.detailId || 0) !== detailId) return false;
      const itemIdText = String(Number(item.id || 0) || "");
      return itemIdText.length > zoneIdText.length && itemIdText.startsWith(zoneIdText);
    });
  }

  function canRestoreParentZone(zone) {
    const z = zone && typeof zone === "object" ? zone : null;
    return !!(z && isSplitDerivedZone(z) && !hasSplitDescendants(z));
  }

  function isLastZoneInDetail(zone) {
    const z = zone && typeof zone === "object" ? zone : null;
    if (!z) return false;
    const detailId = Number(z.detailId || 0);
    const zonesInDetail = (Array.isArray(_state.zones) ? _state.zones : [])
      .filter((item) => Number(item && item.detailId || 0) === detailId);
    return zonesInDetail.length <= 1;
  }

  function canDeleteZone(zone) {
    const z = zone && typeof zone === "object" ? zone : null;
    if (!z) return false;
    if (isLastZoneInDetail(z)) return false;
    if (isManualZone(z)) return true;
    return canRestoreParentZone(z);
  }

  // ---------------------------------------------------------------------------
  // Public API
  // ---------------------------------------------------------------------------

  global.FurLabZoneClassify = {
    init,
    getDetailContourPoints,
    pointsMatchExactly,
    isLikelyBaseZone,
    isLegacyManualZone,
    migrateLoadedZoneOriginTypes,
    isSplitDerivedZone,
    isManualZone,
    getRelatedSplitZones,
    hasSplitDescendants,
    canRestoreParentZone,
    isLastZoneInDetail,
    canDeleteZone,
  };

})(window);
