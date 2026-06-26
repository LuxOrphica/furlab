"use strict";

const invariant = require("tiny-invariant");

function assertFiniteNumber(value, label) {
  invariant(Number.isFinite(Number(value)), `${label} must be a finite number`);
}

function assertPoint(point, label) {
  invariant(point && typeof point === "object", `${label} must be an object`);
  assertFiniteNumber(point.x, `${label}.x`);
  assertFiniteNumber(point.y, `${label}.y`);
}

function assertClosedContour(points, label) {
  invariant(Array.isArray(points), `${label} must be an array`);
  invariant(points.length >= 3, `${label} must contain at least 3 points`);
  for (let i = 0; i < points.length; i++) {
    assertPoint(points[i], `${label}.${i}`);
  }
}

function assertFragment(fragment, label) {
  invariant(fragment && typeof fragment === "object", `${label} must be an object`);
  invariant(String(fragment.id || "").trim(), `${label}.id is required`);
  assertClosedContour(fragment.points, `${label}.points`);
  if (Object.prototype.hasOwnProperty.call(fragment, "areaMm2")) {
    assertFiniteNumber(fragment.areaMm2, `${label}.areaMm2`);
    invariant(Number(fragment.areaMm2) >= 0, `${label}.areaMm2 must be non-negative`);
  }
}

function assertFragments(fragments, label = "fragments") {
  invariant(Array.isArray(fragments), `${label} must be an array`);
  const ids = new Set();
  for (let i = 0; i < fragments.length; i++) {
    assertFragment(fragments[i], `${label}.${i}`);
    const id = String(fragments[i].id);
    invariant(!ids.has(id), `${label}.${i}.id must be unique`);
    ids.add(id);
  }
}

function placementIdentity(placement) {
  return String(
    (placement && placement.placementId) ||
    (placement && placement.fragmentId) ||
    (placement && placement.scrapPieceId) ||
    (placement && placement.inventoryTag) ||
    ""
  ).trim();
}

function assertOptionalFiniteNumber(owner, field, label, options = {}) {
  if (!Object.prototype.hasOwnProperty.call(owner, field)) return;
  const value = owner[field];
  if (value === null || value === undefined || value === "") return;
  assertFiniteNumber(value, `${label}.${field}`);
  if (options.nonNegative) {
    invariant(Number(value) >= 0, `${label}.${field} must be non-negative`);
  }
}

function assertOptionalContour(owner, field, label) {
  if (!Object.prototype.hasOwnProperty.call(owner, field)) return;
  const value = owner[field];
  if (value === null || value === undefined) return;
  invariant(Array.isArray(value), `${label}.${field} must be an array`);
  if (value.length === 0) return;
  assertClosedContour(value, `${label}.${field}`);
}

function assertPlacement(placement, label) {
  invariant(placement && typeof placement === "object", `${label} must be an object`);
  invariant(placementIdentity(placement), `${label}.identity is required`);
  invariant(String(placement.status || "").trim(), `${label}.status is required`);

  const status = String(placement.status || "");
  if (status === "matched") {
    assertClosedContour(placement.alignedContour, `${label}.alignedContour`);
  } else {
    assertOptionalContour(placement, "alignedContour", label);
  }
  assertOptionalContour(placement, "alignedCoreContour", label);
  assertOptionalContour(placement, "inZoneContour", label);
  assertOptionalContour(placement, "inZoneCoreContour", label);
  assertOptionalContour(placement, "fragmentContour", label);
  assertOptionalContour(placement, "usedVisibleContour", label);

  [
    "fragmentAreaMm2",
    "scrapAreaMm2",
    "usedVisibleAreaMm2",
    "inZoneAreaMm2",
    "inZoneCoreAreaMm2",
    "bboxWidthMm",
    "bboxHeightMm",
    "fitScore",
    "fitAreaRatio",
    "fitCoverageRatio",
    "fitOverlap",
    "fitInsidePercent",
    "fitChamferMm",
    "napDeltaDeg",
    "alignRotationDeg",
    "alignOffsetX",
    "alignOffsetY",
    "solveOrder",
    "solveIndex",
    "renderIndex",
  ].forEach((field) => assertOptionalFiniteNumber(placement, field, label, {
    nonNegative: /Area|Percent|Ratio|Score|Overlap|Chamfer|Width|Height|Index|Order/.test(field)
  }));
}

function assertPlacements(placements, label = "placements") {
  invariant(Array.isArray(placements), `${label} must be an array`);
  const ids = new Set();
  for (let i = 0; i < placements.length; i++) {
    assertPlacement(placements[i], `${label}.${i}`);
    const id = placementIdentity(placements[i]);
    invariant(!ids.has(id), `${label}.${i}.identity must be unique`);
    ids.add(id);
  }
}

function assertRenderItem(item, label) {
  invariant(item && typeof item === "object", `${label} must be an object`);
  invariant(String(item.id || "").trim(), `${label}.id is required`);
  invariant(item.closed === true, `${label}.closed must be true`);
  assertFiniteNumber(item.renderIndex, `${label}.renderIndex`);
  assertClosedContour(item.contour, `${label}.contour`);
}

function assertRenderItems(items, label = "render.items") {
  invariant(Array.isArray(items), `${label} must be an array`);
  const ids = new Set();
  for (let i = 0; i < items.length; i++) {
    assertRenderItem(items[i], `${label}.${i}`);
    const id = String(items[i].id);
    invariant(!ids.has(id), `${label}.${i}.id must be unique`);
    ids.add(id);
  }
}

function assertRenderOutput(render, label = "render") {
  invariant(render && typeof render === "object", `${label} must be an object`);
  assertRenderItems(render.items || [], `${label}.items`);
  if (Object.prototype.hasOwnProperty.call(render, "itemCount")) {
    invariant(
      Number(render.itemCount) === (render.items || []).length,
      `${label}.itemCount must match render.items.length`
    );
  }
}

module.exports = {
  assertFiniteNumber,
  assertPoint,
  assertClosedContour,
  assertFragment,
  assertFragments,
  assertPlacement,
  assertPlacements,
  assertRenderItem,
  assertRenderItems,
  assertRenderOutput,
};
