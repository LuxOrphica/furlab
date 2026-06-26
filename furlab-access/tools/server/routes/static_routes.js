"use strict";

function serveStaticRequest(ctx) {
  const {
    fs,
    path,
    reqUrl,
    res,
    rootDir,
    mime,
    requestId
  } = ctx;

  if (reqUrl.pathname === "/") {
    res.writeHead(302, { "Location": "http://localhost:5173/furlab-ac/inventory", "X-Request-Id": requestId });
    res.end();
    return { handled: true, statusCode: 302 };
  }
  const urlPath = reqUrl.pathname;
  const fsPath = path.normalize(path.join(rootDir, decodeURIComponent(urlPath)));
  if (!fsPath.startsWith(rootDir)) {
    res.writeHead(403, { "X-Request-Id": requestId });
    res.end("Forbidden");
    return { handled: true, statusCode: 403 };
  }
  if (!fs.existsSync(fsPath) || fs.statSync(fsPath).isDirectory()) {
    res.writeHead(404, { "X-Request-Id": requestId });
    res.end("Not found");
    return { handled: true, statusCode: 404 };
  }
  const ext = path.extname(fsPath).toLowerCase();
  res.writeHead(200, {
    "Content-Type": mime[ext] || "application/octet-stream",
    "X-Request-Id": requestId
  });
  fs.createReadStream(fsPath).pipe(res);
  return { handled: true, statusCode: 200 };
}

module.exports = {
  serveStaticRequest
};
