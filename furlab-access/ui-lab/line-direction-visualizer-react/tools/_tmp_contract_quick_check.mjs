import { chromium } from "playwright-core";
import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import process from "node:process";

const SCANS_DIR = "F:/FURLAB/dev/furlab-access/ui-lab/assets/uploads";
const PORT = 4173;
const SAMPLE_LIMIT = 12;

const files = fs.readdirSync(SCANS_DIR)
  .filter((n) => /^FL-SCR-[0-9]{6}.*\.png$/i.test(n))
  .sort((a, b) => a.localeCompare(b, "en"))
  .slice(0, SAMPLE_LIMIT);

if (!files.length) {
  console.log("No scans found.");
  process.exit(0);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitHttpOk(url, timeoutMs = 45000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    try {
      const r = await fetch(url);
      if (r.ok) return true;
    } catch (_) {}
    await sleep(500);
  }
  return false;
}

const preview = spawn("npm", ["run", "preview", "--", "--host", "127.0.0.1", "--port", String(PORT)], {
  cwd: path.resolve("."),
  shell: true,
  stdio: ["ignore", "pipe", "pipe"]
});
preview.stdout.on("data", (d) => process.stdout.write(String(d)));
preview.stderr.on("data", (d) => process.stderr.write(String(d)));

const rootUrl = `http://127.0.0.1:${PORT}/`;
if (!(await waitHttpOk(rootUrl))) {
  preview.kill("SIGTERM");
  throw new Error("preview_not_ready");
}

const browser = await chromium.launch({
  headless: true,
  executablePath: "C:/Program Files/Google/Chrome/Application/chrome.exe"
});
const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
await page.goto(rootUrl, { waitUntil: "domcontentloaded", timeout: 45000 });
await page.waitForTimeout(1200);

if ((await page.locator("#fileInput").count()) < 1) {
  const uploadMenu = page.locator(".menu-item-upload").first();
  if ((await uploadMenu.count()) > 0) {
    await uploadMenu.click();
    await page.waitForTimeout(800);
  }
}

if ((await page.locator("#fileInput").count()) < 1) {
  await browser.close();
  preview.kill("SIGTERM");
  throw new Error("scan_screen_not_loaded");
}

const rows = [];
for (const fileName of files) {
  const fullPath = path.join(SCANS_DIR, fileName);
  console.log(`processing: ${fileName}`);
  await page.locator("#fileInput").setInputFiles(fullPath);
  await page.locator(".scan-upload-actions .toolbar-btn").nth(1).click();
  await page.waitForTimeout(5200);

  const row = await page.evaluate(() => {
    const s = window.__ldvLastState || {};
    const ld = s.lineDetection || {};
    return {
      status: String(ld.status || "not_found"),
      confidence: Number.isFinite(ld.confidence) ? Number(ld.confidence) : null,
      source: String(ld.source || "-"),
      angleDeg: Number.isFinite(ld.angleDeg) ? Number(ld.angleDeg) : null,
      hasLine: !!ld.hasLine
    };
  });
  rows.push({ fileName, ...row });
}

const statusCounts = rows.reduce((acc, r) => {
  acc[r.status] = Number(acc[r.status] || 0) + 1;
  return acc;
}, {});

console.log(`Checked: ${rows.length}`);
console.log(`Status counts: ${JSON.stringify(statusCounts)}`);
for (const r of rows) {
  const c = r.confidence == null ? "-" : `${(r.confidence * 100).toFixed(1)}%`;
  const a = r.angleDeg == null ? "-" : `${r.angleDeg.toFixed(1)}deg`;
  console.log(`${r.fileName} | status=${r.status} | conf=${c} | angle=${a} | source=${r.source} | hasLine=${r.hasLine ? "yes" : "no"}`);
}

await browser.close();
preview.kill("SIGTERM");
