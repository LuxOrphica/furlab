"use strict";

let client = null;
let enabled = false;

function resolveEnvironment(env) {
  return String((env && (env.SENTRY_ENVIRONMENT || env.NODE_ENV)) || "development");
}

function resolveRelease(env, pkg) {
  const value = env && (env.SENTRY_RELEASE || env.GITHUB_SHA);
  if (value) return String(value);
  if (pkg && pkg.name && pkg.version) return `${pkg.name}@${pkg.version}`;
  return undefined;
}

function initErrorMonitor(options = {}) {
  const env = options.env || process.env;
  const dsn = String((options.dsn !== undefined ? options.dsn : env.SENTRY_DSN) || "").trim();
  client = options.client || null;
  enabled = false;

  if (!dsn) {
    return { enabled: false, reason: "missing_dsn" };
  }

  if (!client) {
    try {
      client = require("@sentry/node");
    } catch (err) {
      return { enabled: false, reason: "sdk_unavailable", error: err };
    }
  }

  if (!client || typeof client.init !== "function") {
    return { enabled: false, reason: "invalid_client" };
  }

  client.init({
    dsn,
    environment: resolveEnvironment(env),
    release: resolveRelease(env, options.pkg),
    tracesSampleRate: Number(env.SENTRY_TRACES_SAMPLE_RATE || 0),
  });
  enabled = true;
  return { enabled: true };
}

function captureException(err, context) {
  if (!enabled || !client || typeof client.captureException !== "function") return null;
  try {
    return client.captureException(err, context && typeof context === "object" ? context : undefined);
  } catch (_) {
    return null;
  }
}

function addBreadcrumb(payload) {
  if (!enabled || !client || typeof client.addBreadcrumb !== "function") return;
  try {
    client.addBreadcrumb(payload && typeof payload === "object" ? payload : { message: String(payload || "") });
  } catch (_) {}
}

function isEnabled() {
  return enabled;
}

module.exports = {
  addBreadcrumb,
  captureException,
  initErrorMonitor,
  isEnabled,
  resolveEnvironment,
  resolveRelease,
};
