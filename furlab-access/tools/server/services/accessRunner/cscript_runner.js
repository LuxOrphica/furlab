"use strict";

function createCscriptRunner(deps) {
  const { spawnSync, cwd, defaultTimeoutMs = 8000 } = deps;
  const cscriptCommand = (() => {
    const fromEnv = String(process.env.FURLAB_CSCRIPT_PATH || "").trim();
    if (fromEnv) return fromEnv;
    const winDir = String(process.env.WINDIR || "C:\\Windows");
    // Prefer 64-bit host by default because this environment uses Office x64.
    return `${winDir}\\System32\\cscript.exe`;
  })();

  function runCscript(scriptPath, args = [], options = {}) {
    const useUnicode = options.unicode !== false;
    const encoding = options.encoding || (useUnicode ? "utf16le" : "utf8");
    const timeoutMs = Number(options.timeoutMs || defaultTimeoutMs);
    const cscriptArgs = useUnicode
      ? ["//nologo", "//U", scriptPath, ...args]
      : ["//nologo", scriptPath, ...args];
    let run = spawnSync(cscriptCommand, cscriptArgs, {
      cwd,
      encoding,
      timeout: timeoutMs
    });
    if (run && run.error && String(run.error.code || "").toUpperCase() === "ENOENT" && cscriptCommand.toLowerCase() !== "cscript") {
      run = spawnSync("cscript", cscriptArgs, { cwd, encoding, timeout: timeoutMs });
    }
    if (run && run.error) {
      const winDir = String(process.env.WINDIR || "C:\\Windows");
      const alt = cscriptCommand.toLowerCase().includes("\\system32\\")
        ? `${winDir}\\SysWOW64\\cscript.exe`
        : `${winDir}\\System32\\cscript.exe`;
      run = spawnSync(alt, cscriptArgs, { cwd, encoding, timeout: timeoutMs });
    }
    const stdout = String(run.stdout || "").replace(/^\uFEFF/, "").trim();
    const stderr = String(run.stderr || "").replace(/^\uFEFF/, "").trim();
    return { run, stdout, stderr };
  }

  function runWithRetry(scriptPath, args = [], options = {}) {
    const retries = Math.max(0, Number(options.retries || 0));
    const retryOnError = options.retryOnError !== false;
    const retryOnNonZero = options.retryOnNonZero === true;
    let last = null;
    for (let attempt = 0; attempt <= retries; attempt++) {
      last = runCscript(scriptPath, args, options);
      const hasRunError = !!last.run.error;
      const hasNonZero = Number(last.run.status || 0) !== 0;
      if (hasRunError && retryOnError && attempt < retries) continue;
      if (hasNonZero && retryOnNonZero && attempt < retries) continue;
      return last;
    }
    return last || runCscript(scriptPath, args, options);
  }

  function runReaderWithFallback(scriptPath, args = [], options = {}) {
    let exec = runWithRetry(scriptPath, args, { ...options, unicode: false, encoding: "utf8" });
    if (exec.run.status === 0 && !exec.stdout) {
      exec = runWithRetry(scriptPath, args, options);
    }
    return exec;
  }

  return {
    runCscript,
    runWithRetry,
    runReaderWithFallback
  };
}

module.exports = {
  createCscriptRunner
};
