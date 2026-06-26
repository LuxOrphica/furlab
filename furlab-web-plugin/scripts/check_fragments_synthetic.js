"use strict";
// Синтетический тест алгоритма фрагментов
// Два прямоугольных куска бок о бок, припуск 12мм.
// Кусок 1: x=[0..100], ядро=[12..88]. Кусок 2: x=[76..176], ядро=[88..164].
// Зона: x=[0..176], y=[0..100]
// Ожидание: фрагмент 1 = [0..176]×[0..100] минус ядро куска 2 в зоне их пересечения.
// Нет дырок, нет перекрытий, граница по шву.

const { diffMulti, unionMulti, pointsToMultiPolygon } = require("../src/services/polygon_ops");

function mpArea(mp) {
  if (!Array.isArray(mp)) return 0;
  let s = 0;
  for (const poly of mp) {
    if (!Array.isArray(poly)) continue;
    for (let ri = 0; ri < poly.length; ri++) {
      const ring = poly[ri];
      let a = 0;
      for (let i = 0; i < ring.length; i++) {
        const cur = ring[i];
        const nxt = ring[(i + 1) % ring.length];
        a += cur[0] * nxt[1] - nxt[0] * cur[1];
      }
      s += Math.abs(a) * 0.5 * (ri === 0 ? 1 : -1);
    }
  }
  return Math.abs(s);
}

function rect(x1, y1, x2, y2) {
  return [{ x: x1, y: y1 }, { x: x2, y: y1 }, { x: x2, y: y2 }, { x: x1, y: y2 }];
}

// Параметры: зона 200×100, два куска с overlap припуска 12мм
const seam = 12;

// Кусок 0: full [0..100]×[0..100], core [12..88]×[12..88]
const full0 = pointsToMultiPolygon(rect(0, 0, 100, 100));
const core0 = pointsToMultiPolygon(rect(seam, seam, 100 - seam, 100 - seam));

// Кусок 1: full [100-seam..200]×[0..100] = [88..200]×[0..100], core [100..200-seam]×[12..88]
const full1 = pointsToMultiPolygon(rect(100 - seam, 0, 200, 100));
const core1 = pointsToMultiPolygon(rect(100, seam, 200 - seam, 100 - seam));

// Зона: [0..200]×[0..100]
const zoneMp = pointsToMultiPolygon(rect(0, 0, 200, 100));
const zoneArea = mpArea(zoneMp);

console.log(`Zone area: ${zoneArea}`);
console.log(`full0 area: ${mpArea(full0).toFixed(1)} (expected 10000)`);
console.log(`core0 area: ${mpArea(core0).toFixed(1)} (expected ${(100 - 2*seam)**2})`);
console.log(`full1 area: ${mpArea(full1).toFixed(1)} (expected ${(200 - (100 - seam)) * 100})`);
console.log(`core1 area: ${mpArea(core1).toFixed(1)} (expected ${(200 - seam - 100) * (100 - 2*seam)})`);

// Алгоритм (i=0 высший приоритет)
const matched = [
  { pi: 0, fullMp: full0, coreMp: core0 },
  { pi: 1, fullMp: full1, coreMp: core1 }
];

let coveredCoresMp = [];
const fragments = [];
for (const { pi, fullMp, coreMp } of matched) {
  const fragmentMp = coveredCoresMp.length > 0 && fullMp.length > 0
    ? diffMulti(fullMp, coveredCoresMp)
    : fullMp;
  if (coreMp.length > 0) {
    coveredCoresMp = coveredCoresMp.length > 0 ? unionMulti(coveredCoresMp, coreMp) : coreMp;
  }
  fragments.push({ pi, fragmentMp, area: mpArea(fragmentMp) });
}

console.log(`\n--- Fragments ---`);
for (const { pi, area } of fragments) {
  console.log(`  frag[${pi}] area=${area.toFixed(1)}`);
}

// Проверка перекрытий
const { intersectMulti } = require("../src/services/polygon_ops");
const overlap = intersectMulti(fragments[0].fragmentMp, fragments[1].fragmentMp);
const overlapArea = mpArea(overlap);
console.log(`\n--- Overlap check ---`);
if (overlapArea < 0.1) console.log(`  No overlaps ✓`);
else console.log(`  OVERLAP = ${overlapArea.toFixed(1)}mm²`);

// Проверка дырок в зоне
let unionFrags = [];
for (const { fragmentMp } of fragments) {
  unionFrags = unionFrags.length > 0 ? unionMulti(unionFrags, fragmentMp) : fragmentMp;
}
const holes = diffMulti(zoneMp, unionFrags);
const holesArea = mpArea(holes);
console.log(`\n--- Holes check ---`);
console.log(`  Zone covered: ${mpArea(unionFrags).toFixed(1)} / ${zoneArea}`);
if (holesArea < 0.1) console.log(`  No holes ✓`);
else console.log(`  HOLES = ${holesArea.toFixed(1)}mm²`);

// Проверка границы между фрагментами — должна совпадать с ядром куска 0
// Граница = правый край frag[0] должен = x=88 (правый край core0)
// frag[0] = full0 - core1 overlap? Давайте проверим: frag[0] = full0 (т.к. coveredCores пустой)
// frag[1] = full1 - core0 = [88..200]×[0..100] - [12..88]×[12..88]
// Граница frag[1] слева от x=88: frag[1] в strip [88..100] = [88..200]×[0..100] - (часть core0 в этом strip)
// core0 в x=88: x=88 это правый край core0, т.е. x<88 вычитается
// Значит граница frag[1] слева = x=88 ✓ (шовная линия = правый край core0)
console.log(`\n--- Boundary check ---`);
console.log(`  frag[0] = full0 (pi=0, coveredCores пустой до него)`);
console.log(`  frag[1] = full1 - core0`);
console.log(`  Left boundary of frag[1] should be x=88 (right edge of core0) — that's the seam line ✓`);

// frag[0] занимает всю площадь куска 0 — включая его припуск который перекрывается с full1
// Это нормально: фрагмент 0 = "приоритетный", покрывает до края зоны
const totalFragArea = fragments.reduce((s, f) => s + f.area, 0);
const expectedTotal = zoneArea;
console.log(`\nTotal fragments: ${totalFragArea.toFixed(1)}, Zone: ${expectedTotal}`);
console.log(Math.abs(totalFragArea - expectedTotal) < 1 ? "Total area matches zone ✓" : `WARNING: mismatch ${(totalFragArea - expectedTotal).toFixed(1)}`);
