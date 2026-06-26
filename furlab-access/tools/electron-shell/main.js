"use strict";

const path = require("path");
const { spawn } = require("child_process");
const http = require("http");
const { app, BrowserWindow, dialog } = require("electron");

const HOST = "127.0.0.1";
const PORT = Number(process.env.UI_LAB_PORT || 5500);
const START_TIMEOUT_MS = 30000;
const HEALTH_INTERVAL_MS = 350;

let serverProc = null;

function runtimeRoot() {
  if (app.isPackaged) {
    return path.join(process.resourcesPath, "runtime");
  }
  return path.resolve(__dirname, "..", "..");
}

function buildServerEnv(rootDir) {
  const env = { ...process.env };
  env.ELECTRON_RUN_AS_NODE = "1";
  env.UI_LAB_HOST = env.UI_LAB_HOST || HOST;
  env.UI_LAB_PORT = String(PORT);
  env.FURLAB_DB_PATH = env.FURLAB_DB_PATH || path.join(rootDir, "БД", "Furlab 1.accdb");
  return env;
}

function startServer(rootDir) {
  const entry = path.join(rootDir, "tools", "ui_lab_server.js");
  const env = buildServerEnv(rootDir);
  serverProc = spawn(process.execPath, [entry], {
    cwd: rootDir,
    env,
    stdio: "inherit",
    windowsHide: false
  });
}

function stopServer() {
  if (!serverProc || serverProc.killed) return;
  try {
    serverProc.kill();
  } catch (_) {}
}

function waitHealth(url, timeoutMs) {
  const startedAt = Date.now();
  return new Promise((resolve, reject) => {
    function probe() {
      const req = http.get(url, (res) => {
        res.resume();
        if (res.statusCode >= 200 && res.statusCode < 300) {
          resolve();
          return;
        }
        if (Date.now() - startedAt >= timeoutMs) {
          reject(new Error(`health_status_${res.statusCode}`));
          return;
        }
        setTimeout(probe, HEALTH_INTERVAL_MS);
      });
      req.on("error", () => {
        if (Date.now() - startedAt >= timeoutMs) {
          reject(new Error("health_timeout"));
          return;
        }
        setTimeout(probe, HEALTH_INTERVAL_MS);
      });
      req.setTimeout(2500, () => req.destroy(new Error("health_req_timeout")));
    }
    probe();
  });
}

async function createMainWindow() {
  const rootDir = runtimeRoot();
  startServer(rootDir);

  const healthUrl = `http://${HOST}:${PORT}/api/health`;
  const appUrl = `http://${HOST}:${PORT}/ui-lab/`;

  try {
    await waitHealth(healthUrl, START_TIMEOUT_MS);
  } catch (e) {
    dialog.showErrorBox("FurLab UI Lab", `Server failed to start: ${e.message}`);
    app.quit();
    return;
  }

  const win = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1100,
    minHeight: 700,
    autoHideMenuBar: true,
    title: "FurLab UI Lab",
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  win.loadURL(appUrl);
}

app.on("window-all-closed", () => {
  app.quit();
});

app.on("before-quit", () => {
  stopServer();
});

app.whenReady().then(createMainWindow);

