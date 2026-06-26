"use strict";

async function handleTrainingRoutes(ctx) {
  const {
    req,
    reqUrl,
    reply,
    denyWrite,
    readBodyJson,
    listTrainingAnnotations,
    saveTrainingAnnotation,
    loadTrainingStats
  } = ctx;

  if (req.method === "GET" && reqUrl.pathname === "/api/training/annotations") {
    const result = listTrainingAnnotations(reqUrl.searchParams);
    return reply(result.ok ? 200 : 400, result);
  }

  if (req.method === "POST" && reqUrl.pathname === "/api/training/annotations") {
    const denied = denyWrite();
    if (denied) return denied;
    const payload = await readBodyJson(req);
    const result = saveTrainingAnnotation(payload);
    return reply(result.ok ? 200 : 400, result);
  }

  if (req.method === "GET" && reqUrl.pathname === "/api/training/stats") {
    const result = loadTrainingStats();
    return reply(result.ok ? 200 : 400, result);
  }

  return false;
}

module.exports = {
  handleTrainingRoutes
};

