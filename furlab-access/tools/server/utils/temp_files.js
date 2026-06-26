"use strict";

function createTempWriters(deps) {
  const { fs, path, apiTmpDir } = deps;

  function writeTempSql(sqlText) {
    fs.mkdirSync(apiTmpDir, { recursive: true });
    const stamp = Date.now();
    const rnd = Math.random().toString(16).slice(2, 8);
    const sqlPath = path.join(apiTmpDir, `save_${stamp}_${rnd}.sql`);
    const logPath = path.join(apiTmpDir, `save_${stamp}_${rnd}.log`);
    fs.writeFileSync(sqlPath, `\uFEFF${sqlText}`, "utf16le");
    return { sqlPath, logPath };
  }

  function writeTempJson(obj) {
    fs.mkdirSync(apiTmpDir, { recursive: true });
    const stamp = Date.now();
    const rnd = Math.random().toString(16).slice(2, 8);
    const jsonPath = path.join(apiTmpDir, `save_${stamp}_${rnd}.json`);
    const logPath = path.join(apiTmpDir, `save_${stamp}_${rnd}.log`);
    fs.writeFileSync(jsonPath, JSON.stringify(obj), "utf8");
    return { jsonPath, logPath };
  }

  return {
    writeTempSql,
    writeTempJson
  };
}

module.exports = {
  createTempWriters
};
