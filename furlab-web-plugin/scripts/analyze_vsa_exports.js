#!/usr/bin/env node
/**
 * Анализатор выгрузок inventory_voronoi_sa.
 *
 * Читает папку с экспортами прогонов (JSON из кнопки экспорта выкладки) и сводит
 * по каждому: параметры (припуск, мин.ширина куска, шаг сетки, seed, режим v1/v2),
 * покрытие, и — главное — РАЗБОР ДЫР по толщине: щель ≤0.5мм (допустимая, бридж­уется
 * припуском) против компактной дыры (брак). Толщина считается эрозией, а не площадью.
 *
 * Задача: гоняешь тесты с разными параметрами в интерфейсе, экспортируешь каждый
 * прогон в одну папку — этот скрипт сводит их в таблицу, по которой видно, ГДЕ и при
 * КАКИХ параметрах вылезают настоящие дыры.
 *
 * Usage:
 *   node scripts/analyze_vsa_exports.js "F:/FURLAB/Тест"
 *   node scripts/analyze_vsa_exports.js "F:/FURLAB/Тест" --csv > holes.csv
 */
"use strict";
const fs = require("fs");
const path = require("path");
const ClipperLib = require("clipper-lib");
const S = 1000;

// Порог допустимой щели — держать в синхроне с ACCEPTABLE_GAP_MM в voronoi_sa_coverage.js.
const ACCEPTABLE_GAP_MM = 0.5;

function erodedArea(pts, rMm) {
  if (!Array.isArray(pts) || pts.length < 3) return 0;
  const p = pts.map((q) => ({ X: Math.round(q.x * S), Y: Math.round(q.y * S) }));
  const co = new ClipperLib.ClipperOffset(2, 0.25 * S);
  co.AddPath(p, ClipperLib.JoinType.jtMiter, ClipperLib.EndType.etClosedPolygon);
  const out = new ClipperLib.Paths();
  co.Execute(out, -rMm * S);
  let a = 0;
  for (const q of out) a += Math.abs(ClipperLib.Clipper.Area(q)) / (S * S);
  return a;
}

// Максимальная толщина компоненты (2×наибольший радиус эрозии, оставляющий площадь).
function maxThicknessMm(pts) {
  let lo = 0, hi = 8;
  for (let i = 0; i < 22; i++) {
    const m = (lo + hi) / 2;
    if (erodedArea(pts, m) > 0.05) lo = m; else hi = m;
  }
  return lo * 2;
}

function analyzeFile(file) {
  let r;
  try { r = JSON.parse(fs.readFileSync(file, "utf8")); } catch (_) { return null; }
  if (!r || !Array.isArray(r.placements)) return null;
  const eff = r.effectiveOptions || {};
  const m = r.metrics || {};
  const comps = Array.isArray(r.uncoveredComponents) ? r.uncoveredComponents : [];

  let interiorDefectMm2 = 0, interiorAcceptableMm2 = 0, edgeMm2 = 0;
  let defectCount = 0, acceptableCount = 0;
  let worstInteriorThick = 0;
  for (const c of comps) {
    const pts = c.pts || c.points;
    const area = Number(c.areaMm2 || 0);
    if (!Array.isArray(pts) || pts.length < 3) continue;
    if (c.classification === "interior") {
      // ТА ЖЕ логика, что в voronoi_sa_coverage.js isAcceptableGap: эрозия на допуск/2,
      // остаток < 0.5мм² → щель допустима. Иначе — дефект (считается полностью).
      const remains = erodedArea(pts, ACCEPTABLE_GAP_MM / 2);
      if (remains < 0.5) { interiorAcceptableMm2 += area; acceptableCount++; }
      else {
        interiorDefectMm2 += area; defectCount++;
        const th = maxThicknessMm(pts);
        if (th > worstInteriorThick) worstInteriorThick = th;
      }
    } else {
      edgeMm2 += area;
    }
  }
  const verdict = (interiorDefectMm2 > 2) ? "ДЫРА" : (edgeMm2 > 2 ? "КРАЙ" : "ok");
  return {
    file: path.basename(file),
    zone: (r.zone && (r.zone.name || r.zone.id)) || "?",
    mode: eff.layoutMode === "inventory_voronoi_sa_v2" ? "v2" : "v1",
    allowance: eff.allowanceMm != null ? eff.allowanceMm : "?",
    minWidth: eff.minWidthMm != null ? eff.minWidthMm : "?",
    grid: eff.gridStepMm != null ? eff.gridStepMm : "?",
    seed: eff.seed != null ? String(eff.seed).slice(-6) : "?",
    cov: m.coveragePercent != null ? Number(m.coveragePercent).toFixed(2) : "?",
    intDefect: Math.round(interiorDefectMm2),
    defectN: defectCount,
    worstThick: worstInteriorThick ? worstInteriorThick.toFixed(1) : "-",
    intOk: Math.round(interiorAcceptableMm2),
    okN: acceptableCount,
    edge: Math.round(edgeMm2),
    verdict
  };
}

function main() {
  const args = process.argv.slice(2);
  const csv = args.includes("--csv");
  const dir = args.find((a) => !a.startsWith("--")) || ".";
  if (!fs.existsSync(dir)) { console.error("Нет папки: " + dir); process.exit(1); }
  const files = fs.readdirSync(dir).filter((f) => f.toLowerCase().endsWith(".json")).map((f) => path.join(dir, f));
  const rows = [];
  for (const f of files) { const row = analyzeFile(f); if (row) rows.push(row); }
  rows.sort((a, b) => b.intDefect - a.intDefect);

  if (csv) {
    console.log("file,zone,mode,allowance,minWidth,grid,seed,cov,intDefectMm2,defectN,worstThickMm,intAcceptableMm2,acceptableN,edgeMm2,verdict");
    for (const r of rows) console.log([r.file, r.zone, r.mode, r.allowance, r.minWidth, r.grid, r.seed, r.cov, r.intDefect, r.defectN, r.worstThick, r.intOk, r.okN, r.edge, r.verdict].join(","));
    return;
  }

  console.log("\nАнализ выгрузок VSA (порог допустимой щели " + ACCEPTABLE_GAP_MM + "мм)\n");
  const H = ["зона", "реж", "прип", "минШ", "сетк", "seed", "покр%", "ДЫРАмм²", "N", "толщ", "щельОК", "N", "краймм²", "вердикт"];
  const W = [6, 4, 4, 4, 4, 6, 6, 8, 3, 5, 7, 3, 8, 8];
  const pad = (s, w) => String(s).padEnd(w).slice(0, w);
  console.log(H.map((h, i) => pad(h, W[i])).join(" "));
  console.log(W.map((w) => "─".repeat(w)).join(" "));
  for (const r of rows) {
    console.log([r.zone, r.mode, r.allowance, r.minWidth, r.grid, r.seed, r.cov, r.intDefect, r.defectN, r.worstThick, r.intOk, r.okN, r.edge, r.verdict]
      .map((v, i) => pad(v, W[i])).join(" "));
  }
  const bad = rows.filter((r) => r.verdict === "ДЫРА");
  console.log("\nИтого выгрузок: " + rows.length + " | с настоящими дырами (>0.5мм): " + bad.length + " | годных по внутренним: " + (rows.length - bad.length));
  if (bad.length) {
    console.log("\nГде дыры (толщина > 0.5мм) — по параметрам:");
    const byParam = {};
    for (const r of bad) { const k = "прип=" + r.allowance + " минШ=" + r.minWidth; byParam[k] = (byParam[k] || 0) + 1; }
    for (const k of Object.keys(byParam).sort()) console.log("  " + k + ": " + byParam[k] + " выгрузок с дырами");
  }
}

main();
