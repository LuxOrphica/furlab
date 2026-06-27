# inventory_voronoi_sa — Contract v3.0

**Файл реализации:** `furlab-web-plugin/src/services/solvers/voronoi_sa_solver.js`  
**Статус:** текущая рабочая версия  
**Дата:** 2026-06-12

---

## 1. Концепция

Солвер размещает скрап-куски в зону методом имитации отжига (SA), затем строит фрагменты по формуле:

```
fragment_i = piece_i ∩ voronoiCell_i
```

где `voronoiCell_i` — ячейка ближайшего центроида (Voronoi nearest-center) для куска `i`.

**Что это даёт:** границы фрагментов следуют ячейкам Вороного — эстетические прямолинейные швы между кусками. Дыры (где кусок не доходит до границы ячейки) закрываются gap-fill пассом.

---

## 2. Входные параметры

### `candidates[]` (обязательно)
Каждый элемент:
```js
{
  id | inventoryTag,           // идентификатор куска
  scrapContour,                // контур куска: [{x,y}...] или строка
  napDirectionDeg | napDirection, // направление ворса, градусы
}
```

### `options` (необязательно)
| Поле | Тип | По умолчанию | Описание |
|------|-----|-------------|----------|
| `napTarget` | number | 0 | Целевое направление ворса зоны, градусы |
| `napTol` | number | 15 | Допуск отклонения ворса, градусы |
| `maxSolveMs` | number | 60000 | Тайм-аут SA, мс |
| `seed` | number | 1 | Seed для воспроизводимости |
| `allowanceMm` | number | 0 | Запас припусков — инсет контура |
| `seamAllowanceReserveMm` | number | 0 | Синоним allowanceMm |
| `minWidthMm` | number | 0 | Мин. ширина куска (по core-bbox) |
| `minLengthMm` | number | 0 | Мин. длина куска (по core-bbox) |
| `zoneHoles` | Array\<Array\<{x,y}\>\> | [] | Дыры в зоне (вычитаются из маски) |
| `mosaicMode` | boolean | false | fragment = voronoiCell (без пересечения с куском) |
| `onProgress` | function | null | Колбэк прогресса |

### `_constraints` (необязательно, не используется в текущей версии)
Параметр зарезервирован. Preflight ограничений по числу кусков нет — SA получает все совместимые куски.

---

## 3. Алгоритм

### Этап 0 — Подготовка зоны
1. Rasterize `zonePoints` с шагом **3 мм** → `zoneMask: Uint8Array`
2. Вычесть `zoneHoles` из маски
3. `zoneArea = zoneCells × 9 мм²` (приближение площади зоны)

### Этап 1 — Подготовка кусков
Для каждого кандидата:
1. Парсинг `scrapContour` → `rawPts`
2. Центрирование: `centeredPts = rawPts - centroid(rawPts)`
3. Если `allowanceMm > 0`: `centeredCorePts = inset(centeredPts, allowanceMm)` через ClipperOffset
4. Фильтр по `minWidthMm` / `minLengthMm` (по bbox centeredCorePts)
5. `areaMm2 = bbox_width × bbox_height` (приближение площади)

**Ограничений по числу кусков нет** — в SA передаются все прошедшие фильтр.

### Этап 2 — Preflight (только статистика)
Вычисляется только для Monitor, не влияет на выборку:
- `Cmed` — медиана `areaMm2` всех кусков
- `Nbase = ceil(zoneArea / Cmed)` — оценка нужного числа кусков
- `selectionDebug` — передаётся в output для Monitor

### Этап 3 — IFP (Inner Fit Polygon)
Для каждого куска:
```
IFP = MinkowskiDiff(zonePoints, centeredCorePts)
```
через `ClipperLib.Clipper.MinkowskiDiff`. Кешируется в `ifpCache`. IFP — множество допустимых положений центроида куска внутри зоны.

### Этап 4 — Greedy Warm Start
Сортировка кусков по `areaMm2` DESC. Жадно размещает каждый кусок:
- 16 случайных попыток (угол ± napTol, позиция из IFP или случайная в зоне)
- Принимает позицию с максимальным приростом новых ячеек (`gain`)
- Угол: `normalizeDeg(napTarget - piece.napDeg) ± dAngle`

### Этап 5 — SA loop
**Энергия (минимизируем):**
```
E = 1000 × (zoneCells - coveredCells) + 8 × overlapCells + 1 × N
```
Приоритет лексикографический: покрытие > перекрытия > число кусков.

**Начальная температура:**
```
T0 = max(E × 0.05, zoneCells × 0.5)
Tmin = T0 × 0.0005
alpha = 0.9975
```

**Ходы** (вероятности при наличии кандидатов):
| Ход | Условие | Вероятность |
|-----|---------|------------|
| TRANSLATE | есть куски | 38% |
| ROTATE | есть куски | 20% |
| SWAP | есть неиспользованные | 14% |
| REMOVE | ≥2 куска | 12% |
| ADD | есть неиспользованные | остаток |

- **TRANSLATE:** случайный сдвиг ±stepMm (stepMm = 8% min(width, height) зоны)
- **ROTATE:** случайный поворот ±10°, с проверкой napTol
- **SWAP:** заменить кусок i на случайный из неиспользованных, сохранив позицию
- **REMOVE:** удалить случайный кусок
- **ADD:** добавить случайный неиспользованный кусок в случайную допустимую позицию

SA не ограничен по числу итераций, останавливается по `T < Tmin` или таймауту.

Сохраняется лучшее состояние `bestPlacements` по минимуму E.

### Этап 6 — Voronoi Assignment & Fragment Building
После SA: `finalPlacements = bestPlacements` (кусков с ненулевой маской).

**Voronoi (nearest-center):**
```
assignment[cell] = argmin_j dist(cell_center, placement[j].center)
```
Используется Euclidean distance по центроидам кусков.

**Построение voronoiCell_j:**
Union растровых ячеек с `assignment = j` через Clipper — получаем полигон.

**Fragment:**
```js
if (mosaicMode) {
  fragment_j = voronoiCell_j          // фрагмент = ячейка (100% покрытие, нет дыр)
} else {
  fragment_j = intersect(piece_j, voronoiCell_j)  // фрагмент = кусок ∩ ячейка
}
```
`piece_j` — трансформированный контур куска в текущей позиции (SA placement).

### Этап 7 — Gap Fill
Запускается если `!mosaicMode && resultPlacements.length > 0`.

**Шаг 1:** Rasterize все фрагменты → `coveredRaster`.

**Шаг 2 (assignment):** Для каждой непокрытой ячейки зоны:
1. **Physical check:** найти первый кусок `j`, у которого `placements[j].mask[idx] = 1` (кусок физически покрывает ячейку) → назначить ему
2. **Fallback (Voronoi):** если ни один кусок не покрывает — назначить ближайшему центру

**Шаг 3:** Для каждого куска `j` с gap-ячейками:
1. Union gap-ячеек → `gapTerritory` полигон
2. `gapFill = intersect(piece_j_contour, gapTerritory)`
3. Каждый связный компонент `gapFill` добавляется как отдельный placement с `phase = "gap_fill"`, `placementId = "{original}_gap{n}"`

**Почему gap-fill с physical check работает лучше nearest-center:**
- Кусок физически перекрывает свою Voronoi-границу → эти ячейки не покрыты fragment_j (срезаны Voronoi) но покрыты mask_j
- Physical check назначает их тому же куску → intersection non-empty → gap закрывается

---

## 4. Output

```ts
{
  ok: boolean,
  fullCoverageOk: boolean,      // realCoveredRatio >= 0.998
  coveredRatio: number,          // totalInZoneArea / zoneArea
  coveragePercent: number,
  residualAreaMm2: number,
  resultStatus: "ok" | "failed",
  failedReason: string | null,   // "zone_not_fully_covered" | "no_candidates"
  renderOrderPolicy: "solve_order",
  stackOrderPolicy: "solve_order",
  solveOrder: string[],          // placementId в порядке solve
  placements: Placement[],
  summary: { ... },
  algorithmTrace: { version: "voronoi-sa-v1", ... },
  selectionDebug: {
    zoneArea: number,            // мм², raster-приближение
    Cmed: number,                // медиана areaMm2 всех кусков
    Nbase: number,               // ceil(zoneArea / Cmed)
    reserveFactor: "N/A",        // не используется
    Nstart: number,              // = totalCandidates (все куски)
    targetCellArea: number,      // zoneArea / Nbase
    fragmentCountMode: "sa_auto",
    totalCandidates: number
  }
}
```

### Placement
```ts
{
  placementId: string,           // inventoryTag | "{tag}_gap{n}"
  scrapPieceId: string,
  inventoryTag: string,
  alignedContour: [{x,y}...],   // исходный контур куска в позиции SA
  inZoneContour: [{x,y}...],    // fragment = piece ∩ voronoiCell (или gap fill)
  alignedCoreContour: [{x,y}...],
  inZoneCoreContour: [{x,y}...],
  inZoneAreaMm2: number,
  gainAreaMm2: number,           // = inZoneAreaMm2
  overlapAreaMm2: 0,
  outsideAreaMm2: number,        // часть куска за пределами своей ячейки
  utilization: number,           // inZoneArea / pieceArea
  insideRatio: number,
  score: number,                 // = inZoneAreaMm2
  status: "matched",
  phase: "SA" | "gap_fill",
  solveIndex: number,
  solveOrder: number,
  renderIndex: number
}
```

---

## 5. Coverage метрика

```
coveredRatio = sum(placement.inZoneAreaMm2) / zoneArea
```

Измеряет долю зоны, покрытую фрагментами (пересечениями кусков с ячейками + gap fill).

**Не покрытые зоны** — где:
- ни один кусок физически не достигает
- кусок достигает, но пересечение с voronoiCell пустое (не должно происходить с physical gap-fill)

`coveredRatio = 1.0` достижимо если: суммарная площадь кусков ≥ площадь зоны И SA разместил куски без "пустых углов".

**SA metric (внутренняя):** `bestCoveredCells / zoneCells` — raster-coverage до Voronoi assignment. Эта метрика выше чем итоговый `coveredRatio` (Voronoi обрезает куски по границам ячеек).

---

## 6. Известные ограничения

1. **Raster grid = 3 мм** — `zoneArea` это приближение (погрешность ~1-3% для мелких/вогнутых зон). Аналогично `areaMm2` кусков — bbox, не реальная площадь полигона.

2. **Voronoi nearest-center** — не взвешенный (Power Diagram). Ячейки не пропорциональны размерам кусков. Крупный кусок получает такую же по геометрии ячейку как мелкий.

3. **Gap fill при nearest-center fallback** — если gap-ячейка не покрыта ни одним куском физически, gap-territory строится как рост от ближайшего центра, а intersection с куском может быть пустым → gap остаётся.

4. **Один кусок — один placementId** — SA не допускает один и тот же кусок дважды. Gap-fill создаёт `_{gap}` записи от того же inventoryTag.

5. **napTol проверяется только при ROTATE** — при SWAP и ADD угол вычисляется как `napTarget - piece.napDeg` без проверки tolerance.

6. **mosaicMode** — fragment = voronoiCell (не пересечение с куском). Даёт 100% geometric coverage, но фрагмент не является физической формой куска.

---

## 7. Что не реализовано (зарезервировано)

- Взвешенный Voronoi (Power Diagram) — ячейки пропорциональные areaMm2 кусков
- `fragmentCountMode` — управление числом фрагментов через constraints
- `fixedN`, `minN/maxN`, `targetFragmentAreaMm2` — параметры были в v2, удалены
- Remove-one post-opt pass
- Penalty за NAP-отклонение в энергетической функции
