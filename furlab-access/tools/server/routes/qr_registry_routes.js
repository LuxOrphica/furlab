"use strict";

async function handleQrRegistryRoutes(ctx) {
  const {
    req,
    reqUrl,
    reply,
    denyWrite,
    readBodyJson,
    loadQrRegistryStats,
    listQrRegistryRecords,
    checkQrRegistryTags,
    issueQrRegistryTags
  } = ctx;

  if (req.method === "GET" && reqUrl.pathname === "/api/qr-registry/stats") {
    const result = loadQrRegistryStats();
    return reply(result.ok ? 200 : 400, result);
  }

  if (req.method === "GET" && reqUrl.pathname === "/api/qr-registry/list") {
    const result = listQrRegistryRecords(reqUrl.searchParams);
    return reply(result.ok ? 200 : 400, result);
  }

  if (req.method === "POST" && reqUrl.pathname === "/api/qr-registry/check") {
    const payload = await readBodyJson(req);
    const result = checkQrRegistryTags(payload);
    return reply(result.ok ? 200 : 400, result);
  }

  if (req.method === "POST" && reqUrl.pathname === "/api/qr-registry/issue") {
    const denied = denyWrite();
    if (denied) return denied;
    const payload = await readBodyJson(req);
    const result = issueQrRegistryTags(payload);
    return reply(result.ok ? 200 : 400, result);
  }

  return false;
}

module.exports = {
  handleQrRegistryRoutes
};
