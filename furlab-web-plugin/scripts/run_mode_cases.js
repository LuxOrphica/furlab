"use strict";

const fs = require("fs");
const path = require("path");
const http = require("http");
const https = require("https");

function parseArgs(argv) {
  const out = {
    api: "http://127.0.0.1:5600",
    casesDir: path.resolve(process.cwd(), "tests/cases/modes")
  };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    const b = argv[i + 1];
    if (a === "--api" && b) {
      out.api = String(b);
      i++;
      continue;
    }
    if (a === "--cases" && b) {
      out.casesDir = path.resolve(process.cwd(), b);
      i++;
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
      "Content-Length": Buffer.byteLength(data)
    },
    timeout: 60000
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
        resolve({
          statusCode: Number(res.statusCode || 0),
          body: parsed,
          rawBody: raw
        });
      });
    });
    req.on("timeout", () => req.destroy(new Error("request_timeout")));
    req.on("error", reject);
    req.write(data);
    req.end();
  });
}

function checkCaseResult(caseObj, response) {
  const expect = caseObj && caseObj.expect && typeof caseObj.expect === "object" ? caseObj.expect : {};
  const body = response && response.body && typeof response.body === "object" ? response.body : null;
  const errors = [];

  if (expect.httpStatus && Number(response.statusCode) !== Number(expect.httpStatus)) {
    errors.push(`httpStatus expected=${expect.httpStatus} actual=${response.statusCode}`);
  }
  if (Object.prototype.hasOwnProperty.call(expect, "ok")) {
    const actual = !!(body && body.ok === true);
    if (actual !== !!expect.ok) errors.push(`ok expected=${!!expect.ok} actual=${actual}`);
  }
  if (expect.layoutType) {
    const actual = String(body && body.layoutType || "");
    if (actual !== String(expect.layoutType)) errors.push(`layoutType expected=${expect.layoutType} actual=${actual}`);
  }
  if (Array.isArray(expect.resultStatusIn) && expect.resultStatusIn.length) {
    const actual = String(body && body.resultStatus || "");
    if (!expect.resultStatusIn.includes(actual)) {
      errors.push(`resultStatus expected one of [${expect.resultStatusIn.join(",")}] actual=${actual}`);
    }
  }
  if (Number.isFinite(Number(expect.minRenderItems))) {
    const items = body && body.render && Array.isArray(body.render.items) ? body.render.items : [];
    if (items.length < Number(expect.minRenderItems)) {
      errors.push(`render.items length expected>=${Number(expect.minRenderItems)} actual=${items.length}`);
    }
  }
  return errors;
}

async function main() {
  const args = parseArgs(process.argv);
  const files = listJsonFiles(args.casesDir);
  if (!files.length) {
    console.error(`[modes:testcases] no json cases in ${args.casesDir}`);
    process.exit(2);
  }

  let passed = 0;
  let failed = 0;
  for (const f of files) {
    const raw = fs.readFileSync(f, "utf8");
    const obj = JSON.parse(raw);
    const req = obj && obj.request && typeof obj.request === "object" ? obj.request : {};
    if (!Number.isFinite(Number(req.seed))) {
      failed += 1;
      console.log(`FAIL ${path.basename(f)} status=SKIP`);
      console.log("  - request.seed is required for deterministic mode tests");
      continue;
    }
    const res = await postJson(args.api, "/api/layout/modes/preview", req);
    const errors = checkCaseResult(obj, res);
    if (errors.length === 0) {
      passed += 1;
      console.log(`PASS ${path.basename(f)} status=${res.statusCode}`);
    } else {
      failed += 1;
      console.log(`FAIL ${path.basename(f)} status=${res.statusCode}`);
      for (const e of errors) console.log(`  - ${e}`);
    }
  }

  console.log(`[modes:testcases] passed=${passed} failed=${failed} total=${passed + failed}`);
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error("[modes:testcases] fatal:", err && err.message ? err.message : err);
  process.exit(1);
});
