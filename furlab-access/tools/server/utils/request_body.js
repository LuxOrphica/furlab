"use strict";

function readBodyJson(req, maxBytes = 40_000_000) {
  return new Promise((resolve, reject) => {
    let raw = "";
    req.setEncoding("utf8");
    req.on("data", (chunk) => {
      raw += chunk;
      if (raw.length > maxBytes) {
        reject(new Error("request_too_large"));
      }
    });
    req.on("end", () => {
      try {
        resolve(JSON.parse(raw || "{}"));
      } catch (_) {
        reject(new Error("invalid_json"));
      }
    });
    req.on("error", reject);
  });
}

module.exports = {
  readBodyJson
};
