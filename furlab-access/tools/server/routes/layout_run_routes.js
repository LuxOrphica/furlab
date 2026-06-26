"use strict";

async function handleLayoutRunRoutes(ctx) {
  const { req, reqUrl, reply, readBodyJson, commitManualPlacements } = ctx;

  if (req.method === "POST" && reqUrl.pathname === "/api/layout-runs/commit") {
    const body = await readBodyJson(req);
    const result = commitManualPlacements(body && typeof body === "object" ? body : {});
    return reply(result.ok ? 200 : 400, result);
  }

  return false;
}

module.exports = { handleLayoutRunRoutes };
