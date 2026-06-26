"use strict";

const {
  addBreadcrumb,
  captureException,
  initErrorMonitor,
  isEnabled,
  resolveEnvironment,
  resolveRelease,
} = require("../../../src/services/error_monitor");

describe("error monitor", () => {
  it("stays disabled without SENTRY_DSN", () => {
    const state = initErrorMonitor({ env: {} });

    expect(state.enabled).toBe(false);
    expect(state.reason).toBe("missing_dsn");
    expect(isEnabled()).toBe(false);
  });

  it("initializes sentry-compatible client when DSN is configured", () => {
    const calls = [];
    const client = {
      init(payload) { calls.push(["init", payload]); },
      captureException(err, context) { calls.push(["captureException", err, context]); return "event-id"; },
      addBreadcrumb(payload) { calls.push(["addBreadcrumb", payload]); },
    };
    const state = initErrorMonitor({
      env: {
        SENTRY_DSN: "https://public@example.test/1",
        NODE_ENV: "test",
        SENTRY_TRACES_SAMPLE_RATE: "0",
      },
      pkg: { name: "fur", version: "1.2.3" },
      client,
    });

    expect(state.enabled).toBe(true);
    expect(isEnabled()).toBe(true);
    expect(calls[0][0]).toBe("init");
    expect(calls[0][1].environment).toBe("test");
    expect(calls[0][1].release).toBe("fur@1.2.3");

    const err = new Error("boom");
    expect(captureException(err, { tags: { kind: "unit" } })).toBe("event-id");
    addBreadcrumb({ category: "unit", message: "hello" });
    expect(calls.map((x) => x[0])).toEqual(["init", "captureException", "addBreadcrumb"]);
  });

  it("resolves environment and release from env", () => {
    expect(resolveEnvironment({ SENTRY_ENVIRONMENT: "staging", NODE_ENV: "test" })).toBe("staging");
    expect(resolveRelease({ GITHUB_SHA: "abc123" }, { name: "fur", version: "1.0.0" })).toBe("abc123");
    expect(resolveRelease({}, { name: "fur", version: "1.0.0" })).toBe("fur@1.0.0");
  });
});
