"use strict";

async function handleRegistryRoutes(ctx) {
  const { req, reqUrl, reply, loadRegistryPage } = ctx;

  if (req.method === "GET" && reqUrl.pathname === "/api/registry") {
    const result = loadRegistryPage(reqUrl.searchParams);
    return reply(result.ok ? 200 : 400, result);
  }

  return false;
}

module.exports = {
  handleRegistryRoutes
};
