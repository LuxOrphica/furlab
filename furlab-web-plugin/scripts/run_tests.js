"use strict";
// FurLab test suite runner
// Usage: node scripts/run_tests.js [--skip-server-tests]
// Requires server on :5600 for server tests.

const { execSync, spawnSync } = require("child_process");
const http = require("http");

const SKIP_SERVER = process.argv.includes("--skip-server-tests");

// ---- helpers ----
const GREEN = "\x1b[32m", RED = "\x1b[31m", YELLOW = "\x1b[33m", RESET = "\x1b[0m", BOLD = "\x1b[1m";
const pass = (name) => console.log(`  ${GREEN}✓${RESET} ${name}`);
const fail = (name, err) => console.log(`  ${RED}✗${RESET} ${name}${err ? `\n    ${RED}${err}${RESET}` : ""}`);
const skip = (name) => console.log(`  ${YELLOW}–${RESET} ${name} (skipped)`);

function isServerUp() {
  return new Promise((resolve) => {
    const req = http.request({ method: "GET", hostname: "127.0.0.1", port: 5600, path: "/api/health", timeout: 2000 },
      (res) => resolve(res.statusCode < 500));
    req.on("error", () => resolve(false));
    req.on("timeout", () => { req.destroy(); resolve(false); });
    req.end();
  });
}

function runScript(label, script, timeoutMs = 180000) {
  const result = spawnSync("node", [script], { encoding: "utf8", timeout: timeoutMs });
  if (result.status === 0) {
    pass(label);
    return true;
  } else {
    const msg = (result.stderr || result.stdout || "").split("\n").find(l => l.trim()) || "exit " + result.status;
    fail(label, msg.slice(0, 120));
    return false;
  }
}

async function main() {
  console.log(`\n${BOLD}FurLab Test Suite${RESET}\n`);

  let passed = 0, failed = 0, skipped = 0;

  // --- Static checks (no server needed) ---
  console.log(`${BOLD}Static checks${RESET}`);
  const staticSuites = [
    ["Encoding check",    "scripts/encoding-check.js"],
    ["Mojibake check",    "scripts/mojibake-check.js"],
    ["i18n check",        "scripts/i18n-structure-check.js"],
    ["Repo hygiene",      "scripts/repo-hygiene-check.js"],
    ["Geometry unit",     "tests/unit/geometry/polygon_ops.test.js"],
    ["Piece working area","tests/unit/geometry/piece_working_area.test.js"],
    ["RDP simplify",      "tests/unit/geometry/rdp_simplify.test.js"],
    ["Nap deviation",     "tests/unit/geometry/nap_deviation.test.js"],
    ["Fragmentation",     "tests/unit/geometry/fragmentation.test.js"],
    ["Fragment generators","tests/unit/layout/fragment_generators.test.js"],
  ];
  for (const [label, script] of staticSuites) {
    runScript(label, script) ? passed++ : failed++;
  }

  // --- Server tests ---
  console.log(`\n${BOLD}Server tests${RESET}`);
  const serverTests = [
    ["Fragment oracle (zone_1)",  "scripts/check_fragments_oracle.js",        120000],
    ["Inventory manual e2e",      "scripts/selftest_inventory_manual_e2e.js",  240000],
    ["Inventory direct e2e",      "scripts/selftest_inventory_direct_e2e.js",  240000],
    ["Reports modal",             "scripts/selftest_reports_modal.js",         120000],
  ];

  const serverUp = await isServerUp();
  if (SKIP_SERVER || !serverUp) {
    const reason = SKIP_SERVER ? "--skip-server-tests" : "server not running on :5600";
    for (const [label] of serverTests) { skip(label); skipped++; }
    if (!SKIP_SERVER) console.log(`  ${YELLOW}Hint: start server with npm start, then re-run${RESET}`);
  } else {
    for (const [label, script, timeout] of serverTests) {
      runScript(label, script, timeout) ? passed++ : failed++;
    }
  }

  // --- Summary ---
  console.log(`\n${BOLD}Results:${RESET} ${GREEN}${passed} passed${RESET}` +
    (failed  ? `, ${RED}${failed} failed${RESET}` : "") +
    (skipped ? `, ${YELLOW}${skipped} skipped${RESET}` : "") + "\n");

  if (failed > 0) process.exit(1);
}

main().catch(e => { console.error(e); process.exit(1); });
