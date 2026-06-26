"use strict";

const fs = require("fs");
const path = require("path");
const http = require("http");
const https = require("https");
const {
  modeCaseSchema,
  assertValidJsonContract,
} = require("../src/contracts/furlab_case_contracts");
const {
  normalizeModePreviewResponse,
} = require("../src/contracts/golden_snapshot");

function parseArgs(argv) {
  const out = {
    api: "http://127.0.0.1:5600",
    casesDir: path.resolve(process.cwd(), "tests/cases/modes"),
    baseline: path.resolve(process.cwd(), "tests/baselines/mode_preview_golden.json"),
    update: false,
  };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    const b = argv[i + 1];
    if (a === "--api" && b) {
      out.api = String(b);
      i++;
    } else if (a === "--cases" && b) {
      out.casesDir = path.resolve(process.cwd(), b);
      i++;
    } else if (a === "--baseline" && b) {
      out.baseline = path.resolve(process.cwd(), b);
      i++;
    } else if (a === "--update") {
      out.update = true;
    }
  }
  return out;
}

function listJsonFiles(dir) {
  if (!fs.existsSync(dir)) return [];
  const out = [];
  for (const name of fs.readdirSync(dir)) {
    const full = path.join(dir, name);
    const st = fs.statSync(full);
    if (st.isDirectory()) out.push(...listJsonFiles(full));
    else if (name.toLowerCase().endsWith(".json")) out.push(full);
  }
  return out.sort();
}

function postJson(urlString, routePath, bodyObj) {
  const base = new URL(urlString);
  const data = JSON.stringify(bodyObj || {});
  const isHttps = base.protocol === "https:";
  const opts = {
    method: "POST",
    hostname: base.hostname,
    port: base.port || (isHttps ? 443 : 80),
    path: routePath,
    headers: {
      "Content-Type": "application/json",
      "Content-Length": Buffer.byteLength(data),
    },
    timeout: 60000,
  };
  const client = isHttps ? https : http;
  return new Promise((resolve, reject) => {
    const req = client.request(opts, (res) => {
      let raw = "";
      res.setEncoding("utf8");
      res.on("data", (chunk) => { raw += chunk; });
      res.on("end", () => {
        let parsed = null;
        try { parsed = raw ? JSON.parse(raw) : null; } catch (_) {}
        resolve({ statusCode: Number(res.statusCode || 0), body: parsed, rawBody: raw });
      });
    });
    req.on("timeout", () => req.destroy(new Error("request_timeout")));
    req.on("error", reject);
    req.write(data);
    req.end();
  });
}

function stableStringify(value) {
  return JSON.stringify(value, null, 2) + "\n";
}

function loadBaseline(filePath) {
  if (!fs.existsSync(filePath)) return null;
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function compareSnapshots(expected, actual, caseName) {
  const a = stableStringify(expected);
  const b = stableStringify(actual);
  if (a === b) return [];
  return [`${caseName}: golden snapshot mismatch`];
}

async function buildSnapshots(args) {
  const files = listJsonFiles(args.casesDir);
  const snapshots = {};
  const errors = [];

  for (const filePath of files) {
    const rel = path.relative(process.cwd(), filePath);
    let caseObj = null;
    try {
      caseObj = assertValidJsonContract(
        modeCaseSchema,
        JSON.parse(fs.readFileSync(filePath, "utf8")),
        rel
      );
    } catch (err) {
      errors.push(`${rel}: ${err && err.message ? err.message : String(err)}`);
      continue;
    }

    const res = await postJson(args.api, "/api/layout/modes/preview", caseObj.request);
    if (res.statusCode >= 500 || !res.body) {
      errors.push(`${caseObj.name}: HTTP ${res.statusCode}`);
      continue;
    }

    snapshots[caseObj.name] = normalizeModePreviewResponse(res.body);
  }

  return { snapshots, errors };
}

async function main() {
  const args = parseArgs(process.argv);
  const { snapshots, errors } = await buildSnapshots(args);
  if (errors.length) {
    for (const err of errors) console.log(`FAIL ${err}`);
    process.exit(1);
  }

  if (args.update) {
    fs.mkdirSync(path.dirname(args.baseline), { recursive: true });
    fs.writeFileSync(args.baseline, stableStringify(snapshots));
    console.log(`[golden] updated ${path.relative(process.cwd(), args.baseline)} cases=${Object.keys(snapshots).length}`);
    return;
  }

  const baseline = loadBaseline(args.baseline);
  if (!baseline) {
    console.log(`[golden] baseline missing: ${path.relative(process.cwd(), args.baseline)}`);
    console.log("[golden] create it with: npm run golden:mode-preview:update");
    process.exit(1);
  }

  const failures = [];
  const names = new Set([...Object.keys(baseline), ...Object.keys(snapshots)]);
  for (const name of Array.from(names).sort()) {
    if (!Object.prototype.hasOwnProperty.call(baseline, name)) {
      failures.push(`${name}: missing from baseline`);
      continue;
    }
    if (!Object.prototype.hasOwnProperty.call(snapshots, name)) {
      failures.push(`${name}: missing from current snapshots`);
      continue;
    }
    failures.push(...compareSnapshots(baseline[name], snapshots[name], name));
  }

  if (failures.length) {
    for (const failure of failures) console.log(`FAIL ${failure}`);
    console.log("[golden] refresh intentionally changed baselines with: npm run golden:mode-preview:update");
    process.exit(1);
  }

  console.log(`[golden] mode preview snapshots match cases=${Object.keys(snapshots).length}`);
}

main().catch((err) => {
  console.error("[golden] fatal:", err && err.stack ? err.stack : String(err));
  process.exit(1);
});
