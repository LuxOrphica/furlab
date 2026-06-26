"use strict";

const pino = require("pino");

function resolveLogLevel(env) {
  if (env && env.LOG_LEVEL) return String(env.LOG_LEVEL);
  if (env && env.NODE_ENV === "test") return "silent";
  return "info";
}

function createLogger(options = {}) {
  const env = options.env || process.env;
  const base = {
    service: options.service || "furlab-web-plugin",
    component: options.component || "app",
    ...(options.base && typeof options.base === "object" ? options.base : {}),
  };

  return pino({
    level: options.level || resolveLogLevel(env),
    base,
    timestamp: pino.stdTimeFunctions.isoTime,
    redact: {
      paths: [
        "req.headers.authorization",
        "req.headers.cookie",
        "headers.authorization",
        "headers.cookie",
        "*.apiKey",
        "*.token",
      ],
      remove: true,
    },
  });
}

const logger = createLogger();

module.exports = {
  createLogger,
  logger,
  resolveLogLevel,
};
