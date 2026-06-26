"use strict";

const fs = require("fs");
const os = require("os");
const path = require("path");

const {
  buildExportPayload,
  handleExportRoutes,
  getFragmentExportPoints,
  normalizeContourPoints,
} = require("../../../src/routes/export");

function makeExportBody(extra = {}) {
  return {
    zones: [{ id: 1, name: "Zone 1", materialId: "mat-1", detailId: 10, napDirectionDeg: 90 }],
    layouts: [{
      id: "layout-1",
      zoneId: 1,
      runs: [{
        resultSnapshot: {
          fragments: [{
            id: "frag-1",
            points: [{ x: 0, y: 0 }, { x: 40, y: 0 }, { x: 40, y: 20 }, { x: 0, y: 20 }],
            areaMm2: 800,
          }],
        },
      }],
    }],
    materials: { "mat-1": { id: "mat-1", name: "White Fur" } },
    ...extra,
  };
}

function makeReqRes(method, pathname, body) {
  const req = { method };
  const chunks = [];
  const headers = {};
  const res = {
    writableEnded: false,
    statusCode: 0,
    headers,
    body: null,
    writeHead(statusCode, nextHeaders) {
      this.statusCode = statusCode;
      Object.assign(headers, nextHeaders || {});
    },
    end(payload) {
      this.writableEnded = true;
      this.body = payload;
    },
  };
  const deps = {
    jsonReply(target, statusCode, payload) {
      target.writeHead(statusCode, { "Content-Type": "application/json" });
      target.end(JSON.stringify(payload));
    },
    readBodyJson: async () => body,
  };
  return { req, res, reqUrl: { pathname }, deps, chunks };
}

describe("export route payload builder", () => {
  it("keeps edge fragments that only have cutPoints", () => {
    const payload = buildExportPayload({
      zones: [{ id: 1, name: "edge", materialId: "mat-1", detailId: 10, napDirectionDeg: 90 }],
      layouts: [{
        id: "layout-1",
        zoneId: 1,
        runs: [{
          resultSnapshot: {
            fragments: [
              {
                id: "center",
                points: [{ x: 20, y: 20 }, { x: 80, y: 20 }, { x: 80, y: 80 }, { x: 20, y: 80 }],
                areaMm2: 3600,
              },
              {
                id: "edge-cut-only",
                points: [],
                cutPoints: [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 40 }, { x: 0, y: 40 }],
                areaMm2: 400,
              },
            ],
          },
        }],
      }],
      materials: { "mat-1": { id: "mat-1", name: "White" } },
    });

    expect(payload.fragments.map((f) => f.id)).toEqual(["center", "edge-cut-only"]);
    expect(payload.fragments[1].points).toEqual([
      { x: 0, y: 0 },
      { x: 10, y: 0 },
      { x: 10, y: 40 },
      { x: 0, y: 40 },
    ]);
    expect(payload.stats.fragmentsCount).toBe(2);
  });

  it("normalizes polygon-clipping rings and removes closing duplicate", () => {
    const points = normalizeContourPoints([[
      [[0, 0], [25, 0], [25, 10], [0, 10], [0, 0]],
    ]]);

    expect(points).toEqual([
      { x: 0, y: 0 },
      { x: 25, y: 0 },
      { x: 25, y: 10 },
      { x: 0, y: 10 },
    ]);
  });

  it("uses later geometry fallbacks when points are absent", () => {
    expect(getFragmentExportPoints({
      resultContourSnapshot: [[0, 0], [5, 0], [5, 5], [0, 5]],
    })).toEqual([
      { x: 0, y: 0 },
      { x: 5, y: 0 },
      { x: 5, y: 5 },
      { x: 0, y: 5 },
    ]);
  });
});

describe("export route handler", () => {
  it("returns a ZIP response for normal export run", async () => {
    const { req, res, reqUrl, deps } = makeReqRes(
      "POST",
      "/api/export/patterns/run",
      makeExportBody()
    );

    const handled = await handleExportRoutes(req, res, reqUrl, deps);

    expect(handled).toBe(true);
    expect(res.statusCode).toBe(200);
    expect(res.headers["Content-Type"]).toBe("application/zip");
    expect(Buffer.isBuffer(res.body)).toBe(true);
    expect(res.body.slice(0, 4).toString("hex")).toBe("504b0304");
  });

  it("uses SaveFileDialog dependencies when _saveDialog is requested", async () => {
    const calls = [];
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "furlab-export-route-"));
    const savedPath = path.join(tmpDir, "furlab_export_test.zip");
    const { req, res, reqUrl, deps } = makeReqRes(
      "POST",
      "/api/export/patterns/run",
      makeExportBody({ _saveDialog: true })
    );
    Object.assign(deps, {
      ROOT_DIR: tmpDir,
      TMP_DIR: tmpDir,
      psPathLiteral(value) {
        calls.push(["psPathLiteral", value]);
        return String(value).replace(/'/g, "''");
      },
      runPowerShell(commandText, timeoutMs) {
        calls.push(["runPowerShell", commandText, timeoutMs]);
        return {
          run: { status: 0, error: null },
          stdout: JSON.stringify({ ok: true, path: savedPath }),
          stderr: "",
        };
      },
    });

    const handled = await handleExportRoutes(req, res, reqUrl, deps);

    expect(handled).toBe(true);
    expect(calls.map((x) => x[0])).toContain("psPathLiteral");
    expect(calls.map((x) => x[0])).toContain("runPowerShell");
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(String(res.body))).toEqual({
      ok: true,
      savedTo: savedPath,
    });
    expect(fs.existsSync(savedPath)).toBe(true);
    expect(fs.existsSync(path.join(tmpDir, "last_export.zip"))).toBe(true);
  });

  it("reports missing SaveFileDialog dependencies explicitly", async () => {
    const { req, res, reqUrl, deps } = makeReqRes(
      "POST",
      "/api/export/patterns/run",
      makeExportBody({ _saveDialog: true })
    );

    const handled = await handleExportRoutes(req, res, reqUrl, deps);

    expect(handled).toBe(true);
    expect(res.statusCode).toBe(500);
    expect(JSON.parse(String(res.body))).toMatchObject({
      ok: false,
      error: "save_dialog_not_available",
    });
  });
});
