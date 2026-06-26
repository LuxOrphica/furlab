import jsQR from "jsqr";

let started = false;

export async function startLegacyCore(): Promise<void> {
  if (started) return;
  started = true;

  const w = window as Window & { jsQR?: typeof jsQR };
  if (!w.jsQR) w.jsQR = jsQR;

  // @ts-expect-error legacy DOM script has no TS declarations yet
  await import("./appCore.js");
}
