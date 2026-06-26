"use strict";

const { createLogger, resolveLogLevel } = require("../../../src/services/logger");

describe("logger", () => {
  it("uses silent logging under NODE_ENV=test by default", () => {
    expect(resolveLogLevel({ NODE_ENV: "test" })).toBe("silent");
  });

  it("lets LOG_LEVEL override the default", () => {
    expect(resolveLogLevel({ NODE_ENV: "test", LOG_LEVEL: "debug" })).toBe("debug");
  });

  it("creates a pino-compatible child logger", () => {
    const log = createLogger({
      env: { NODE_ENV: "test" },
      component: "unit-test",
    });
    const child = log.child({ requestId: "req-1" });

    expect(typeof child.info).toBe("function");
    expect(typeof child.warn).toBe("function");
    expect(typeof child.error).toBe("function");
  });
});
