#!/usr/bin/env node

/**
 * Visual regression tests for furlab-access UI.
 * Captures screenshots of key screens and compares against baselines.
 *
 * Usage:
 *   node scripts/visual_regression.js              # compare against baselines
 *   node scripts/visual_regression.js --update     # update baselines
 *
 * Requires running dev server: npm run dev (port 5173)
 */

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { chromium } from "playwright-core";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const BASE_URL = process.env.VR_URL || "http://localhost:5173/furlab-ac";
const UPDATE = process.argv.includes("--update");
const BASELINES_DIR = path.join(__dirname, "..", "tests", "visual-baselines");
const DIFF_DIR = path.join(__dirname, "..", "tmp", "visual-diff");

fs.mkdirSync(BASELINES_DIR, { recursive: true });
fs.mkdirSync(DIFF_DIR, { recursive: true });

function resolveChromium() {
  const fromEnv = String(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE || "").trim();
  if (fromEnv) return fromEnv;
  const candidates = [
    "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
    "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe",
    "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  ];
  return candidates.find((p) => fs.existsSync(p)) || "";
}

const SCREENS = [
  {
    name: "registry",
    path: "/inventory",
    waitFor: ".ant-table-wrapper, .ant-spin, [data-testid='registry']",
    description: "Реестр лоскута",
  },
  {
    name: "history",
    path: "/history",
    waitFor: ".ant-table-wrapper, .ant-spin, [data-testid='history']",
    description: "История размещений",
  },
];

async function takeScreenshot(page, screen) {
  const url = `${BASE_URL}${screen.path}`;
  console.log(`  → ${screen.description} (${url})`);

  await page.goto(url, { waitUntil: "networkidle", timeout: 15000 });

  // Wait for content or spinner to appear
  try {
    await page.waitForSelector(screen.waitFor, { timeout: 8000 });
    // Extra wait for data to load
    await page.waitForTimeout(1500);
  } catch (_) {
    console.log(`    ⚠ waitFor selector not found, taking screenshot anyway`);
  }

  return page.screenshot({ fullPage: true });
}

function compareScreenshots(name, current) {
  const baselinePath = path.join(BASELINES_DIR, `${name}.png`);

  if (!fs.existsSync(baselinePath)) {
    if (UPDATE) {
      fs.writeFileSync(baselinePath, current);
      console.log(`    ✔ baseline created`);
      return { status: "created" };
    }
    console.log(`    ✖ no baseline found — run with --update to create`);
    return { status: "missing" };
  }

  const baseline = fs.readFileSync(baselinePath);

  if (UPDATE) {
    fs.writeFileSync(baselinePath, current);
    console.log(`    ✔ baseline updated`);
    return { status: "updated" };
  }

  // Simple size comparison first
  if (baseline.length === current.length && baseline.equals(current)) {
    console.log(`    ✔ identical`);
    return { status: "pass" };
  }

  // Size difference as rough proxy for visual change
  const diffPct = Math.abs(baseline.length - current.length) / baseline.length * 100;
  const diffPath = path.join(DIFF_DIR, `${name}_current.png`);
  fs.writeFileSync(diffPath, current);

  if (diffPct < 1) {
    console.log(`    ✔ within tolerance (${diffPct.toFixed(2)}% size diff)`);
    return { status: "pass" };
  }

  console.log(`    ✖ visual diff detected (${diffPct.toFixed(2)}% size diff)`);
  console.log(`    → current screenshot saved to: ${diffPath}`);
  return { status: "fail", diffPct };
}

async function run() {
  const executablePath = resolveChromium();
  if (!executablePath) {
    console.error("✖ Chromium not found. Set PLAYWRIGHT_CHROMIUM_EXECUTABLE.");
    process.exit(1);
  }

  console.log(`\nVisual Regression — furlab-access UI`);
  console.log(`Mode: ${UPDATE ? "UPDATE BASELINES" : "COMPARE"}`);
  console.log(`URL:  ${BASE_URL}\n`);

  const browser = await chromium.launch({ executablePath, headless: true });
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();

  const results = [];

  for (const screen of SCREENS) {
    console.log(`[${screen.name}]`);
    try {
      const screenshot = await takeScreenshot(page, screen);
      const result = compareScreenshots(screen.name, screenshot);
      results.push({ name: screen.name, ...result });
    } catch (err) {
      console.log(`    ✖ error: ${err.message}`);
      results.push({ name: screen.name, status: "error", error: err.message });
    }
  }

  await browser.close();

  // Summary
  console.log("\n─────────────────────────────────");
  const passed = results.filter((r) => ["pass", "created", "updated"].includes(r.status)).length;
  const failed = results.filter((r) => ["fail", "missing", "error"].includes(r.status)).length;
  console.log(`${passed} passed, ${failed} failed\n`);

  if (failed > 0) {
    console.log("Failed screens:");
    results.filter((r) => !["pass", "created", "updated"].includes(r.status))
      .forEach((r) => console.log(`  ✖ ${r.name}: ${r.status}`));
    process.exit(1);
  }
}

run().catch((err) => {
  console.error("Fatal:", err.message);
  process.exit(1);
});
