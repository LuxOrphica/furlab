"use strict";

const http = require("http");
const fs = require("fs");
const path = require("path");

const PROJECT_FILE = path.join(__dirname, "../data/projects/proj_1778695609374_4b97ee48.json");
const POCKET_ZONE_IDS = [19, 20];

function post(pathname, body) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify(body);
    const req = http.request({ host: "127.0.0.1", port: 5600, method: "POST", path: pathname,
      headers: { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(data) }
    }, (res) => {
      let buf = "";
      res.on("data", c => buf += c);
      res.on("end", () => { try { resolve(JSON.parse(buf)); } catch(e) { reject(e); } });
    });
    req.on("error", reject);
    req.write(data);
    req.end();
  });
}

async function main() {
  const project = JSON.parse(fs.readFileSync(PROJECT_FILE, "utf8"));

  for (const zoneId of POCKET_ZONE_IDS) {
    const zone = project.zones.find(z => z.id === zoneId);
    const layout = project.layouts.find(l => l.zoneId === zoneId || l.boundZoneId === zoneId);
    if (!zone || !layout) { console.log(`Зона ${zoneId} или выкладка не найдена`); continue; }

    console.log(`\nЗона ${zoneId}: запрашиваю preview (1×1)...`);
    const prevRes = await post("/api/layout/modes/preview", {
      layoutType: "longitudinal",
      zone: { id: zoneId, points: zone.points },
      options: { rows: 1, cols: 1, axisCount: 1, angleDeg: 0, bandStepMm: 120,
        shiftPercent: 0, ringCount: 4, sectorCount: 8, rotationDeg: 0,
        innerRadiusMm: 0, centerMode: "auto", centerX: 0, centerY: 0, gapX: 0, gapY: 0, cornerRadius: 0 },
      inputs: { normalizeRules: { seamAllowanceReserveMm: 12 } }
    });

    if (!prevRes.ok) { console.log(`  ОШИБКА preview:`, prevRes.error); continue; }
    const frags = prevRes.fragments || [];
    console.log(`  Получено фрагментов: ${frags.length}`);
    frags.forEach(f => {
      const pts = f.points || [];
      let minX=Infinity,maxX=-Infinity,minY=Infinity,maxY=-Infinity;
      pts.forEach(p=>{minX=Math.min(minX,p.x);maxX=Math.max(maxX,p.x);minY=Math.min(minY,p.y);maxY=Math.max(maxY,p.y);});
      console.log(`  frag ${f.id}: ${(maxX-minX).toFixed(0)}×${(maxY-minY).toFixed(0)} мм  area: ${f.areaMm2 ? f.areaMm2.toFixed(0) : "?"}mm²`);
    });

    // Update project layout runs with new result
    if (!Array.isArray(layout.runs)) layout.runs = [];
    const runId = `run_fix_${Date.now()}`;
    const existingRun = layout.runs[0];
    if (existingRun) {
      existingRun.resultSnapshot = { fragments: frags, stats: prevRes.stats || { fragmentsTotal: frags.length } };
      existingRun.startedAt = Date.now();
      console.log(`  Обновлён существующий run`);
    } else {
      layout.runs.push({ id: runId, startedAt: Date.now(),
        paramsSnapshot: { normalizeRules: { seamAllowanceReserveMm: 12 }, patternId: "longitudinal",
          patternParams: { options: { rows: 1, cols: 1 } } },
        resultSnapshot: { fragments: frags, stats: prevRes.stats || { fragmentsTotal: frags.length } },
        scrapPlacements: []
      });
      console.log(`  Добавлен новый run`);
    }
    // Update params too
    if (layout.params && layout.params.patternParams && layout.params.patternParams.options) {
      layout.params.patternParams.options.rows = 1;
      layout.params.patternParams.options.cols = 1;
    }
  }

  fs.writeFileSync(PROJECT_FILE, JSON.stringify(project, null, 2), "utf8");
  console.log("\nПроект сохранён.");
}

main().catch(e => console.error("Ошибка:", e.message));
