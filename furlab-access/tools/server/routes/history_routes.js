"use strict";

async function handleHistoryRoutes(ctx) {
  const { req, reqUrl, reply, loadUsageHistoryAll } = ctx;

  if (req.method === "GET" && reqUrl.pathname === "/api/history/usage") {
    const forceRefresh = reqUrl.searchParams.get("refresh") === "1";
    const result = loadUsageHistoryAll(forceRefresh);
    return reply(result.ok ? 200 : 400, result);
  }

  return false;
}

module.exports = {
  handleHistoryRoutes
};
