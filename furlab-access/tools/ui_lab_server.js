const http = require("http");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const {
  buildCorsAllowedOrigins,
  resolveCorsOrigin,
  sendJson,
  getRequestId,
  checkWriteAuth
} = require("./server/http_helpers");
const { handleApiRequest } = require("./server/routes/api_routes");
const { serveStaticRequest } = require("./server/routes/static_routes");
const { loadServerConfig } = require("./server/utils/config");
const { resolveDbPath } = require("./server/utils/db_path");
const { readBodyJson } = require("./server/utils/request_body");
const { normalizeApiPayload } = require("./server/utils/api_error");
const { logStructured } = require("./server/utils/logger");
const { createAppServices } = require("./server/bootstrap/app_services");

const ROOT_DIR = path.resolve(__dirname, "..");
const SERVER_CONFIG = loadServerConfig(process.env);
const HOST = SERVER_CONFIG.host;
const PORT = SERVER_CONFIG.port;
const WRITE_API_KEY = SERVER_CONFIG.writeApiKey;
const CORS_ALLOWED_ORIGINS = buildCorsAllowedOrigins(SERVER_CONFIG.corsOriginsRaw);
const DB_PATH = resolveDbPath(fs, path, ROOT_DIR, SERVER_CONFIG.dbPathOverride);
const API_TMP_DIR = path.join(ROOT_DIR, "tmp", "access-api");
const UPLOADS_DIR = path.join(ROOT_DIR, "ui-lab", "assets", "uploads");

const SERVER_FILE = __filename;
const SERVER_CWD = process.cwd();
const SERVER_STARTED_AT = new Date().toISOString();
const ENABLE_HEAVY_PREWARM = String(process.env.FURLAB_PREWARM_HEAVY || "").trim() === "1";
const SERVER_BUILD_STAMP = (() => {
  try {
    const st = fs.statSync(__filename);
    return new Date(st.mtimeMs).toISOString();
  } catch (_) {
    return "unknown";
  }
})();

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
  ".gif": "image/gif",
  ".webp": "image/webp"
};

const app = createAppServices({
  fs,
  path,
  os: require("os"),
  crypto,
  spawnSync: require("child_process").spawnSync,
  rootDir: ROOT_DIR,
  dbPath: DB_PATH,
  apiTmpDir: API_TMP_DIR,
  uploadsDir: UPLOADS_DIR,
  ttl: SERVER_CONFIG.ttl,
  timeouts: SERVER_CONFIG.timeouts,
  mirror: SERVER_CONFIG.mirror
});

const health = {
  ok: true,
  dbPath: DB_PATH,
  server: {
    file: SERVER_FILE,
    cwd: SERVER_CWD,
    startedAt: SERVER_STARTED_AT,
    buildStamp: SERVER_BUILD_STAMP
  },
  cacheTtl: {
    dictsMs: SERVER_CONFIG.ttl.dictsMs,
    registryMs: SERVER_CONFIG.ttl.registryMs,
    pieceMs: SERVER_CONFIG.ttl.pieceMs,
    contourMs: SERVER_CONFIG.ttl.contourMs,
    historyMs: SERVER_CONFIG.ttl.historyMs
  }
};

const server = http.createServer(async (req, res) => {
  const requestId = getRequestId(req, crypto);
  const reqStartedAt = Date.now();
  const requestPath = (() => {
    try {
      const u = new URL(req.url, `http://${req.headers.host || `${HOST}:${PORT}`}`);
      return `${u.pathname}${u.search}`;
    } catch (_) {
      return String(req.url || "");
    }
  })();

  logStructured("info", "http_request", {
    requestId,
    method: req.method,
    path: requestPath
  });

  const reply = (code, payload) => sendJson(
    req,
    res,
    code,
    (() => {
      const body = normalizeApiPayload(code, payload, requestId);
      const durationMs = Date.now() - reqStartedAt;
      logStructured(code >= 500 ? "error" : (code >= 400 ? "warn" : "info"), "api_response", {
        requestId,
        method: req.method,
        path: requestPath,
        statusCode: code,
        durationMs,
        ok: body.ok === true,
        errorCode: body.errorCode || null,
        source: body.diag?.source || null,
        cached: body.cache?.cached === true,
        stale: body.cache?.stale === true
      });
      return body;
    })(),
    {
      requestId,
      allowedOrigins: CORS_ALLOWED_ORIGINS,
      contentType: MIME[".json"]
    }
  );

  const denyWrite = () => {
    const auth = checkWriteAuth(req, WRITE_API_KEY);
    if (auth.ok) return null;
    return reply(401, { ok: false, error: auth.error || "unauthorized" });
  };

  try {
    if (req.method === "OPTIONS") {
      res.writeHead(204, {
        "Access-Control-Allow-Origin": resolveCorsOrigin(req, CORS_ALLOWED_ORIGINS),
        "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type, Authorization, X-API-Key, X-Request-Id",
        "X-Request-Id": requestId
      });
      res.end();
      return;
    }

    const reqUrl = new URL(req.url, `http://${req.headers.host || `${HOST}:${PORT}`}`);

    if (reqUrl.pathname.startsWith("/api/")) {
      const apiHandled = await handleApiRequest({
        req,
        reqUrl,
        reply,
        denyWrite,
        readBodyJson,
        health,
        ...app
      });
      if (apiHandled !== false) return;
    }

    const staticResult = serveStaticRequest({
      fs,
      path,
      reqUrl,
      res,
      rootDir: ROOT_DIR,
      mime: MIME,
      requestId
    });
    logStructured("info", "static_response", {
      requestId,
      method: req.method,
      path: requestPath,
      statusCode: staticResult?.statusCode || 200,
      durationMs: Date.now() - reqStartedAt
    });
  } catch (err) {
    logStructured("error", "http_exception", {
      requestId,
      method: req.method,
      path: requestPath,
      durationMs: Date.now() - reqStartedAt,
      message: err?.message || String(err)
    });
    reply(500, { ok: false, error: err.message || String(err) });
  }
});

server.listen(PORT, HOST, () => {
  console.log(`[ui-lab] http://${HOST}:${PORT}/ui-lab/`);
  console.log(`[ui-lab] db: ${DB_PATH}`);
  console.log(`[ui-lab] write auth: ${WRITE_API_KEY ? "api_key_required" : "disabled (dev mode)"}`);
  console.log(`[ui-lab] cors origins: ${CORS_ALLOWED_ORIGINS.join(", ")}`);
  console.log(`[ui-lab] server file: ${SERVER_FILE}`);
  console.log(`[ui-lab] server cwd: ${SERVER_CWD}`);
  console.log(`[ui-lab] server build: ${SERVER_BUILD_STAMP}; started: ${SERVER_STARTED_AT}`);

  setImmediate(() => {
    try {
      const warm = app.loadDictsCached(true);
      if (warm.ok) {
        const meta = warm.data && warm.data.cache ? warm.data.cache : {};
        const mode = meta.cached ? "cache" : "fresh";
        const ms = meta.loadMs ? ` in ${meta.loadMs}ms` : "";
        console.log(`[ui-lab] dicts prewarmed (${mode}${ms})`);
      } else {
        console.warn(`[ui-lab] dicts prewarm failed: ${warm.error || "unknown"}`);
      }
    } catch (e) {
      console.warn(`[ui-lab] dicts prewarm exception: ${e?.message || e}`);
    }
  });

  if (ENABLE_HEAVY_PREWARM) {
    setImmediate(() => {
      try {
        const t0 = Date.now();
        const reg = app.loadRegistryRowsCached();
        if (reg.ok) {
          console.log(`[ui-lab] registry prewarmed (${Array.isArray(reg.items) ? reg.items.length : 0} rows in ${Date.now() - t0}ms)`);
        } else {
          console.warn(`[ui-lab] registry prewarm failed: ${reg.error || "unknown"}`);
        }
      } catch (e) {
        console.warn(`[ui-lab] registry prewarm exception: ${e?.message || e}`);
      }
    });

    setImmediate(() => {
      try {
        const t0 = Date.now();
        const usage = app.loadUsageHistoryAll(true);
        if (usage.ok) {
          const count = Array.isArray(usage.items) ? usage.items.length : 0;
          console.log(
            `[ui-lab] usage history prewarmed (${count} rows in ${Date.now() - t0}ms; source=${usage.diag?.source || "?"}; durationMs=${usage.diag?.durationMs ?? "?"})`
          );
        } else {
          console.warn(`[ui-lab] usage history prewarm failed: ${usage.error || "unknown"}`);
        }
      } catch (e) {
        console.warn(`[ui-lab] usage history prewarm exception: ${e?.message || e}`);
      }
    });
  } else {
    console.log("[ui-lab] heavy prewarm disabled (set FURLAB_PREWARM_HEAVY=1 to enable)");
  }
});
