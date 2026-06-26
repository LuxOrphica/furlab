"use strict";

function resolveDbPath(fs, path, rootDir, dbPathOverride) {
  const envPath = String(dbPathOverride || "").trim();
  if (envPath) return path.resolve(envPath);

  const dbDirCandidates = [
    path.join(rootDir, "BD"),
    path.join(rootDir, "БД"),
    path.join(rootDir, "Р‘Р”")
  ];

  for (let i = 0; i < dbDirCandidates.length; i++) {
    const dir = dbDirCandidates[i];
    const canonical = path.join(dir, "Furlab 1.accdb");
    if (fs.existsSync(canonical)) return canonical;
  }

  try {
    for (let i = 0; i < dbDirCandidates.length; i++) {
      const dir = dbDirCandidates[i];
      if (!fs.existsSync(dir)) continue;
      const candidates = fs.readdirSync(dir)
        .filter((f) => String(f).toLowerCase().endsWith(".accdb"))
        .sort((a, b) => String(a).localeCompare(String(b)));
      if (candidates.length > 0) return path.join(dir, candidates[0]);
    }
  } catch (_) {}

  return path.join(rootDir, "BD", "Furlab 1.accdb");
}

module.exports = {
  resolveDbPath
};
