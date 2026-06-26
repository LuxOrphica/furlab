#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { chromium } from "playwright-core";

function parseArgs(argv) {
  const out = {
    url: "http://localhost:5173",
    inputDir: "F:\\FURLAB\\dev\\furlab-access\\ui-lab\\assets\\uploads",
    outJson: "docs/segmentation_benchmark.json",
    outCsv: "docs/segmentation_benchmark.csv",
    overlayDir: "",
    v3EdgeAware: "on",
    v3MaterialAware: "off",
    v3GraphCut: "off",
  };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    const n = argv[i + 1];
    if ((a === "--url" || a === "-u") && n) { out.url = n; i++; continue; }
    if ((a === "--inputDir" || a === "-i") && n) { out.inputDir = n; i++; continue; }
    if ((a === "--outJson" || a === "-j") && n) { out.outJson = n; i++; continue; }
    if ((a === "--outCsv" || a === "-c") && n) { out.outCsv = n; i++; continue; }
    if ((a === "--overlayDir" || a === "-o") && n) { out.overlayDir = n; i++; continue; }
    if (a === "--v3EdgeAware" && n) { out.v3EdgeAware = String(n).toLowerCase(); i++; continue; }
    if (a === "--v3MaterialAware" && n) { out.v3MaterialAware = String(n).toLowerCase(); i++; continue; }
    if (a === "--v3GraphCut" && n) { out.v3GraphCut = String(n).toLowerCase(); i++; continue; }
  }
  // Positional fallback intentionally disabled to avoid ambiguity with flag values.
  return out;
}

function findBrowserExecutable() {
  const candidates = [
    "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
    "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
    "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe",
    "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
  ];
  return candidates.find((p) => fs.existsSync(p)) || null;
}

function listImages(dir) {
  const exts = new Set([".png", ".jpg", ".jpeg", ".bmp", ".tif", ".tiff", ".webp"]);
  const abs = path.resolve(dir);
  const all = fs.readdirSync(abs, { withFileTypes: true });
  return all
    .filter((e) => e.isFile() && exts.has(path.extname(e.name).toLowerCase()))
    .map((e) => path.join(abs, e.name));
}

async function waitForSegmentation(page, baseName, pipeline, minRunId, timeoutMs = 15000) {
  await page.waitForFunction(
    ({ name, p, minId }) => {
      const s = window.__ldvLastState;
      if (!s || !s.segmentation) return false;
      const file = String(s.fileName || "");
      const mode = String(s.segmentation.mode || "");
      const time = Number(s.segmentation.processingTimeMs || 0);
      const runId = Number(s.segmentation.runId || 0);
      return file.includes(name) && mode.includes(p) && time > 0 && runId > minId;
    },
    { name: baseName, p: pipeline, minId: minRunId },
    { timeout: timeoutMs }
  );
  return await page.evaluate(() => window.__ldvLastState);
}

function toCsv(rows) {
  const head = [
    "file",
    "pipeline",
    "mode",
    "processingTimeMs",
    "areaPx",
    "bboxW",
    "bboxH",
    "componentCount",
    "refineApplied",
    "fallbackUsed",
    "timeoutHit",
    "maskHash",
    "deterministic",
  ];
  const esc = (v) => `"${String(v ?? "").replace(/"/g, "\"\"")}"`;
  const lines = [head.join(",")];
  for (const r of rows) {
    lines.push([
      r.file,
      r.pipeline,
      r.mode,
      r.processingTimeMs,
      r.areaPx,
      r.bboxW,
      r.bboxH,
      r.componentCount,
      r.refineApplied,
      r.fallbackUsed,
      r.timeoutHit,
      r.maskHash,
      r.deterministic,
    ].map(esc).join(","));
  }
  return lines.join("\n");
}

function safeName(input) {
  return String(input || "").replace(/[^\w.\-]+/g, "_");
}

async function run() {
  const args = parseArgs(process.argv);
  const exe = findBrowserExecutable();
  if (!exe) {
    throw new Error("Chrome/Edge executable not found.");
  }
  const files = listImages(args.inputDir);
  if (!files.length) {
    throw new Error(`No images found in: ${args.inputDir}`);
  }

  const browser = await chromium.launch({
    headless: true,
    executablePath: exe,
    args: ["--disable-gpu", "--no-sandbox"],
  });
  const context = await browser.newContext();
  const page = await context.newPage();
  await page.goto(args.url, { waitUntil: "domcontentloaded", timeout: 30000 });
  const uploadMenu = page.locator(".menu-item-upload").first();
  if (await uploadMenu.count()) {
    await uploadMenu.click({ timeout: 10000 });
  }
  await page.waitForSelector("#fileInput", { timeout: 15000 });
  await page.waitForFunction(() => !!(window.__ldvBridge && window.__ldvBridge.setContourPipeline));
  const v3EdgeAwareEnabled = args.v3EdgeAware !== "off";
  const v3MaterialAwareEnabled = args.v3MaterialAware === "on";
  const v3GraphCutEnabled = args.v3GraphCut === "on";
  await page.evaluate((enabled) => {
    window.__ldvV3EdgeAware = !!enabled;
  }, v3EdgeAwareEnabled);
  await page.evaluate((enabled) => {
    window.__ldvV3MaterialAware = !!enabled;
  }, v3MaterialAwareEnabled);
  await page.evaluate((enabled) => {
    window.__ldvV3GraphCut = !!enabled;
  }, v3GraphCutEnabled);
  await page.evaluate(() => {
    if (!window.__ldvBridge) return;
    window.__ldvBridge.setDebugFlag?.("lineMask", true);
    window.__ldvBridge.setDebugFlag?.("bbox", true);
    window.__ldvBridge.setDebugFlag?.("controlPoints", true);
  });

  const pipelines = ["v1", "v2", "v3"];
  const rows = [];

  for (const file of files) {
    const name = path.basename(file);
    for (const p of pipelines) {
      const collect = [];
      for (let pass = 0; pass < 2; pass++) {
        const prevRunId = await page.evaluate(() => Number(window.__ldvLastState?.segmentation?.runId || 0));
        await page.evaluate((pipeline) => {
          window.__ldvBridge.setContourPipeline(pipeline);
        }, p);
        await page.setInputFiles("#fileInput", []);
        await page.setInputFiles("#fileInput", file);
        const state = await waitForSegmentation(page, name, p, prevRunId);
        collect.push(state?.segmentation || {});
        if (pass === 0 && args.overlayDir) {
          const rel = safeName(`${path.basename(name, path.extname(name))}_${p}.png`);
          const outPng = path.resolve(args.overlayDir, rel);
          fs.mkdirSync(path.dirname(outPng), { recursive: true });
          await page.screenshot({ path: outPng, fullPage: true });
        }
      }
      const a = collect[0] || {};
      const b = collect[1] || {};
      rows.push({
        file: name,
        pipeline: p,
        mode: String(a.mode || ""),
        processingTimeMs: Number(a.processingTimeMs || 0),
        areaPx: Number(a.areaPx || 0),
        bboxW: Number(a.bboxW || 0),
        bboxH: Number(a.bboxH || 0),
        componentCount: Number(a.componentCount || 0),
        refineApplied: !!a.refineApplied,
        fallbackUsed: !!a.fallbackUsed,
        timeoutHit: !!a.timeoutHit,
        maskHash: String(a.maskHash || ""),
        deterministic: String(a.maskHash || "") === String(b.maskHash || ""),
      });
    }
  }

  await browser.close();

  const outJsonAbs = path.resolve(args.outJson);
  const outCsvAbs = path.resolve(args.outCsv);
  fs.mkdirSync(path.dirname(outJsonAbs), { recursive: true });
  fs.mkdirSync(path.dirname(outCsvAbs), { recursive: true });
  fs.writeFileSync(outJsonAbs, JSON.stringify({ generatedAt: new Date().toISOString(), rows }, null, 2), "utf8");
  fs.writeFileSync(outCsvAbs, toCsv(rows), "utf8");
  console.log(`Benchmark rows: ${rows.length}`);
  console.log(`JSON: ${outJsonAbs}`);
  console.log(`CSV:  ${outCsvAbs}`);
}

run().catch((e) => {
  console.error(e?.stack || e?.message || e);
  process.exit(1);
});
