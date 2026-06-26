"use strict";

const path = require("path");

async function handleDictRoutes(req, res, reqUrl, deps) {
  const jsonReply = deps && deps.jsonReply;
  const ROOT_DIR = deps && deps.ROOT_DIR;
  const DB_PATH = deps && deps.DB_PATH;
  const runCscript = deps && deps.runCscript;
  const parseScriptJson = deps && deps.parseScriptJson;
  if (typeof jsonReply !== "function" || typeof runCscript !== "function" || typeof parseScriptJson !== "function") {
    throw new Error("dict_route_deps_missing");
  }

  if (req.method === "GET" && reqUrl.pathname === "/api/dicts/materials") {
    try {
      const scriptPath = path.join(ROOT_DIR, "scripts", "access_read_materials.js");
      const exec = runCscript(scriptPath, [DB_PATH], 120000);
      if (exec.run.error) {
        return jsonReply(res, 500, { ok: false, error: `materials_run_failed: ${exec.run.error.message}` });
      }
      if (exec.run.status !== 0) {
        return jsonReply(res, 400, { ok: false, error: `materials_exit_${exec.run.status}`, stderr: exec.stderr });
      }
      const result = parseScriptJson(exec.stdout);
      if (!result || !result.ok) {
        return jsonReply(res, 400, result && typeof result === "object" ? result : { ok: false, error: "materials_parse_failed" });
      }
      return jsonReply(res, 200, { ok: true, items: Array.isArray(result.items) ? result.items : [] });
    } catch (e) {
      return jsonReply(res, 500, { ok: false, error: e && e.message ? e.message : "materials_failed" });
    }
  }

  return false;
}

module.exports = {
  handleDictRoutes
};
