export function formatLoadTelemetryText(t) {
  if (!t || typeof t !== "object") return "";
  const parts = [];
  if (Number.isFinite(t.decodeMs)) parts.push(`decode ${Math.round(t.decodeMs)} мс`);
  if (Number.isFinite(t.dpiMs)) parts.push(`dpi ${Math.round(t.dpiMs)} мс`);
  if (Number.isFinite(t.dictMs)) parts.push(`dict ${Math.round(t.dictMs)} мс`);
  if (Number.isFinite(t.modelMs)) parts.push(`mask ${Math.round(t.modelMs)} мс`);
  if (Number.isFinite(t.autoMs)) parts.push(`auto ${Math.round(t.autoMs)} мс`);
  if (Number.isFinite(t.qrMs)) parts.push(`qr ${Math.round(t.qrMs)} мс`);
  if (Number.isFinite(t.totalMs)) parts.push(`total ${Math.round(t.totalMs)} мс`);
  return parts.length ? `Load telemetry: ${parts.join(" | ")}` : "";
}

export function formatLoadTelemetryDetails(t) {
  if (!t || typeof t !== "object") return "";
  const entries = [];
  const pushEntry = (key, label) => {
    if (Number.isFinite(t[key])) entries.push({ key, label, ms: Math.max(0, Math.round(t[key])) });
  };
  pushEntry("decodeMs", "decode");
  pushEntry("dpiMs", "dpi");
  pushEntry("dictMs", "dict");
  pushEntry("modelMs", "mask");
  pushEntry("autoMs", "auto");
  pushEntry("qrMs", "qr");
  pushEntry("totalMs", "total");
  if (!entries.length) return "";
  const total = entries.find((e) => e.key === "totalMs")?.ms || 0;
  const stages = entries
    .filter((e) => e.key !== "totalMs")
    .map((e) => `${e.label}: ${e.ms} мс`);
  let bottleneck = "";
  const stageOnly = entries.filter((e) => e.key !== "totalMs");
  if (stageOnly.length) {
    let worst = stageOnly[0];
    for (let i = 1; i < stageOnly.length; i++) {
      if (stageOnly[i].ms > worst.ms) worst = stageOnly[i];
    }
    bottleneck = `Узкое место: ${worst.label} (${worst.ms} мс)`;
  }
  const totalLine = total > 0 ? `total: ${total} мс` : "";
  return [
    totalLine,
    stages.length ? `Этапы: ${stages.join(" | ")}` : "",
    "Примечание: qr считается асинхронно и может пересекаться по времени с другими этапами.",
    bottleneck
  ]
    .filter(Boolean)
    .join("\n");
}

