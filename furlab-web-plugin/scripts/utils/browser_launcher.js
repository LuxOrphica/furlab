"use strict";

const fs = require("fs");
const { chromium } = require("playwright-core");

function resolveChromiumExecutable() {
  const fromEnv = String(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE || "").trim();
  if (fromEnv) return fromEnv;

  const candidates = process.platform === "win32"
    ? [
        "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
        "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe",
        "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
        "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
      ]
    : [
        "/usr/bin/google-chrome",
        "/usr/bin/google-chrome-stable",
        "/usr/bin/chromium",
        "/usr/bin/chromium-browser",
      ];

  return candidates.find((filePath) => fs.existsSync(filePath)) || "";
}

async function launchChromium(options = {}) {
  const executablePath = resolveChromiumExecutable();
  if (!executablePath) {
    throw new Error(
      "Chromium executable not found. Set PLAYWRIGHT_CHROMIUM_EXECUTABLE to Edge/Chrome/Chromium path."
    );
  }
  return chromium.launch({
    executablePath,
    headless: options.headless !== false,
  });
}

module.exports = {
  launchChromium,
  resolveChromiumExecutable,
};
