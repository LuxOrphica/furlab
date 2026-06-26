import { defineConfig } from "vitest/config";
import AllureVitest from "allure-vitest/reporter";

export default defineConfig({
  test: {
    globals: true,
    environment: "node",
    globalSetup: ["tests/allure-setup.js"],
    include: ["tests/unit/**/*.test.js", "tests/property/**/*.test.js"],
    exclude: ["tests/integration/**", "tests/e2e/**"],
    reporters: [
      "verbose",
      new AllureVitest({ resultsDir: "allure-results" }),
    ],
    coverage: {
      provider: "v8",
      include: ["src/services/**/*.js"],
      exclude: ["src/server.js"],
      reporter: ["text", "html"],
    },
  },
});
