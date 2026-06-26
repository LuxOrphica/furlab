"use strict";

async function handleSystemRoutes(ctx) {
  const { req, reqUrl, reply, health, loadDictsCached } = ctx;

  if (req.method === "GET" && reqUrl.pathname === "/api/health") {
    return reply(200, health);
  }

  if (req.method === "GET" && reqUrl.pathname === "/api/dicts") {
    const forceRefresh = reqUrl.searchParams.get("refresh") === "1";
    const result = loadDictsCached(forceRefresh);
    return reply(result.ok ? 200 : 400, result.ok ? result.data : result);
  }

  return false;
}

module.exports = {
  handleSystemRoutes
};
