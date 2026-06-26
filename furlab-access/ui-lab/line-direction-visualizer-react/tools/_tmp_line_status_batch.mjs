import { chromium } from "playwright-core";
import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import process from "node:process";

const baseDir = "F:/FURLAB/dev/furlab-access/ui-lab/assets/uploads";
const waitAfterScanMs = 6500;
const previewPort = 4173;

const files = fs.readdirSync(baseDir)
  .filter((name) => /^FL-SCR-[0-9]{6}.*\.png$/i.test(name))
  .sort((a, b) => a.localeCompare(b, "en"));

if (!files.length) {
  console.log("No scan files found.");
  process.exit(0);
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForPreview(url, timeoutMs = 30000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    try {
      const res = await fetch(url, { method: "GET" });
      if (res.ok) return true;
    } catch (_) {}
    await delay(500);
  }
  return false;
}

const preview = spawn("npm", ["run", "preview", "--", "--host", "127.0.0.1", "--port", String(previewPort)], {
  cwd: path.resolve("."),
  shell: true,
  stdio: ["ignore", "pipe", "pipe"]
});
preview.stdout.on("data", (d) => process.stdout.write(String(d)));
preview.stderr.on("data", (d) => process.stderr.write(String(d)));

const previewRoot = `http://127.0.0.1:${previewPort}/`;
const previewReady = await waitForPreview(previewRoot, 45000);
if (!previewReady) {
  preview.kill("SIGTERM");
  throw new Error("preview_server_not_ready");
}

const browser = await chromium.launch({
  headless: true,
  executablePath: "C:/Program Files/Google/Chrome/Application/chrome.exe"
});

const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
const candidateUrls = [
  previewRoot,
  `${previewRoot}furlab-ac/scan`,
  `${previewRoot}#line`,
  `${previewRoot}#scan`,
  `${previewRoot}#/line`,
  `${previewRoot}#/scan`,
  `${previewRoot}#/furlab-ac/scan`
];
let appUrl = candidateUrls[0];
for (const url of candidateUrls) {
  await page.goto(url, { waitUntil: "domcontentloaded", timeout: 45000 });
  await page.waitForTimeout(1200);
  const hasInput = await page.locator("#fileInput").count();
  if (hasInput > 0) {
    appUrl = url;
    break;
  }
}
await page.goto(appUrl, { waitUntil: "domcontentloaded", timeout: 45000 });
await page.waitForTimeout(1200);
if ((await page.locator("#fileInput").count()) < 1) {
  await browser.close();
  preview.kill("SIGTERM");
  throw new Error(`file_input_not_found_on_url: ${appUrl}`);
}

const rows = [];

for (const fileName of files) {
  const filePath = path.join(baseDir, fileName);
  await page.locator("#fileInput").setInputFiles(filePath);
  await page.getByRole("button", { name: /^Скан$/ }).first().click();
  await page.waitForTimeout(waitAfterScanMs);

  const out = await page.locator("#output").innerText().catch(() => "");
  const lines = String(out || "").split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
  const sourceLine = lines.find((s) => s.startsWith("Источник линии:")) || "";
  const statusLine =
    lines.find((s) => s.startsWith("Статус:")) ||
    lines.find((s) => s.startsWith("Статус направления:")) ||
    "";
  const confLine = lines.find((s) => s.startsWith("Уверенность:")) || "";
  const autoLine = lines.find((s) => s.startsWith("Авто:")) || "";

  const source = sourceLine.replace(/^Источник линии:\s*/u, "").trim() || "-";
  const status = statusLine.replace(/^Статус(?: направления)?:\s*/u, "").trim() || "not_reported";
  const confMatch = confLine.match(/([0-9]+(?:\.[0-9]+)?)%/);
  const confidencePct = confMatch ? Number(confMatch[1]) : null;
  const autoRejected = /не подтверждена/i.test(autoLine);

  rows.push({
    fileName,
    status,
    source,
    confidencePct,
    autoRejected
  });
}

await browser.close();
preview.kill("SIGTERM");

const counts = rows.reduce((acc, row) => {
  const k = row.status || "not_reported";
  acc[k] = Number(acc[k] || 0) + 1;
  return acc;
}, {});

console.log(`Files: ${rows.length}`);
console.log(`Status counts: ${JSON.stringify(counts)}`);
for (const row of rows) {
  const confText = row.confidencePct == null ? "-" : `${row.confidencePct.toFixed(1)}%`;
  const rejectText = row.autoRejected ? "auto_reject" : "auto_ok";
  console.log(`${row.fileName} | status=${row.status} | conf=${confText} | source=${row.source} | ${rejectText}`);
}
