"use strict";

function normalizeStatus(v) {
  const s = String(v || "").trim().toLowerCase();
  if (!s) return "";
  if (s === "available") return "Available";
  if (s === "reserved") return "Reserved";
  if (s === "used") return "Used";
  if (s === "discarded") return "Discarded";
  return "";
}

function canTransition(action, currentStatus) {
  const a = String(action || "").trim().toLowerCase();
  const c = normalizeStatus(currentStatus);
  if (a === "reserve") {
    if (c !== "Available") return { ok: false, error: "transition_denied_reserve_requires_available" };
    return { ok: true, next: "Reserved" };
  }
  if (a === "release") {
    if (c !== "Reserved") return { ok: false, error: "transition_denied_release_requires_reserved" };
    return { ok: true, next: "Available" };
  }
  if (a === "use") {
    if (c !== "Reserved" && c !== "Available") return { ok: false, error: "transition_denied_use_requires_available_or_reserved" };
    return { ok: true, next: "Used" };
  }
  return { ok: false, error: "action_invalid" };
}

function canOverwriteStatus(currentStatus, nextStatus) {
  const cur = normalizeStatus(currentStatus);
  const next = normalizeStatus(nextStatus);
  if (!next) return { ok: false, error: "scrapStatus_invalid" };
  // Domain invariant: discarded scraps are terminal in operational flows.
  if (cur === "Discarded" && next !== "Discarded") {
    return { ok: false, error: "invariant_discarded_cannot_reactivate" };
  }
  return { ok: true };
}

module.exports = {
  normalizeStatus,
  canTransition,
  canOverwriteStatus
};
