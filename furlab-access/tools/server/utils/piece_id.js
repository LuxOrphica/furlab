"use strict";

function normalizeGuidLike(value) {
  const s = String(value || "").toLowerCase();
  return s
    .replace(/\s+/g, "")
    .replace(/\{guid/g, "")
    .replace(/[{}]/g, "");
}

function looksLikeGuid(value) {
  const s = normalizeGuidLike(value);
  return /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/.test(s);
}

function isSamePieceId(requested, item) {
  if (!item || typeof item !== "object") return false;
  const req = String(requested || "").trim();
  if (!req) return false;
  const itemId = String(item.id || "").trim();
  const itemTag = String(item.inventoryTag || "").trim();
  if (looksLikeGuid(req)) {
    return normalizeGuidLike(req) === normalizeGuidLike(itemId);
  }
  return req === itemTag;
}

module.exports = {
  normalizeGuidLike,
  looksLikeGuid,
  isSamePieceId
};
