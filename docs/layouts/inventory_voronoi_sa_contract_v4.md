# inventory_voronoi_sa — Contract v4.0

**Файл реализации:** `furlab-web-plugin/src/services/solvers/voronoi_sa_solver.js`  
**Предыдущая версия:** v3.0 (2026-06-12)  
**Дата:** 2026-06-12  
**Статус:** SPEC (до реализации)

---

## 0. Архитектурное решение: режимы работы солвера

Солвер вызывается двумя режимами. Поведение принципиально разное:

| Режим (`options.mode`) | layoutType | Алгоритм | Фрагмент |
|------------------------|------------|----------|----------|
| `"voronoi_sa"` (по умолчанию) | `inventory_voronoi_sa` | Только Фаза A (SA) + P.1 restricted Voronoi | `piece_j ∩ voronoiCell_j` |
| `"mosaic"` | `inventory_mosaic` | Фаза A (SA) + **Фаза B** (Power Diagram + Lloyd) | `powerCell_j` если `notContained_j=0`, иначе `piece_j ∩ powerCell_j` |

`inventory_mosaic/index.js` передаёт `options.mode = "mosaic"`.  
`inventory_voronoi_sa/index.js` не передаёт (или `options.mode = "voronoi_sa"`).

`mosaicMode: true` — устаревший флаг, заменён `mode: "mosaic"`. Принимается для совместимости, игнорируется, добавляет `"mosaicMode_ignored"` в `algorithmTrace.warnings`.

---

## 1. Концепция

**Режим `voronoi_sa`:** Фаза A размещает куски для максимального физического покрытия (SA). Фрагмент = P.1 restricted Voronoi (кусок ∩ ячейка). Без Фазы B.

**Режим `mosaic`:** Двухфазный. Фаза A — как выше. Фаза B уточняет размещение через Power Diagram + Lloyd-moves, добиваясь `powerCell_j ⊆ piece_j` там, где это физически достижимо.

Финальный фрагмент в режиме `mosaic`:
```
fragment_j = powerCell_j               если notContained_j = 0  (ячейка ⊆ кусок)
           = piece_j ∩ powerCell_j     иначе (P.1 fallback)
```

Оставшиеся непокрытые ячейки (куда не попал ни один кусок) → restricted gap-fill (P.1-логика).

---

## 2. Параметры

### Новые / изменённые относительно v3

| Поле | Тип | По умолчанию | Описание |
|------|-----|-------------|----------|
| `mode` | `"voronoi_sa"` \| `"mosaic"` | `"voronoi_sa"` | Режим работы солвера. `"mosaic"` включает Фазу B. |
| `maxSolveMs` | number | 60000 | Общий бюджет (обе фазы в mosaic, только Фаза A в voronoi_sa) |
| `phaseBReserveFraction` | number | 0.25 | Доля бюджета для Фазы B (min 5000 мс). Игнорируется в voronoi_sa. |

### Удалённые относительно v3

| Поле | Причина |
|------|---------|
| `mosaicMode` | Заменён `mode: "mosaic"`. Принимается для совместимости, игнорируется, добавляет `"mosaicMode_ignored"` в `algorithmTrace.warnings`. |

---

## 3. Тайм-бюджет

```
phaseBReserve = max(5000, floor(maxSolveMs × phaseBReserveFraction))
phaseADeadline = startTime + maxSolveMs − phaseBReserve
phaseBDeadline = startTime + maxSolveMs
```

**Фаза A** работает до `phaseADeadline`.  
Ранний выход из Фазы A: `uncoveredCells == 0` — весь остаток бюджета отходит Фазе B.

**Фаза B** запускается всегда, даже если Фаза A не достигла полного покрытия. В этом случае `fullCoverageOk = false` предрешён, Фаза B улучшит `notContained` но дыры не закроет.

---

## 4. Алгоритм

### Этап 0–4: без изменений относительно v3
(подготовка зоны, кусков, IFP, warm start)

Площадь куска: `areaReal_j = |ringAreaSigned(centeredPts)|` — реальная площадь полигона, не bbox.

### Этап 5 — Фаза A: SA (покрытие)

**Энергия Фазы A (без изменений):**
```
E_A = 1000 × (zoneCells − coveredCells) + 8 × overlapCells + 1 × N
```

Ходы: TRANSLATE, ROTATE, SWAP, REMOVE, ADD (с targeted ADD, кешированный каждые 500 итераций).

Остановка: `T < Tmin` ИЛИ `Date.now() >= phaseADeadline`.

### Этап 6 — Power Diagram (инициализация)

После Фазы A: вычислить начальные веса и Power Diagram assignment.

**Начальные веса:**
```
w_j = areaReal_j / π       (квадрат эквивалентного радиуса, размерность мм²)
```

**Power Diagram raster assignment:**
```
powerAssign[idx] = argmin_j (dx² + dy² − w_j)
  где dx = cx − placements[j].cx, dy = cy − placements[j].cy
```
Вычисляется за O(cellCount × N). Кешируется.

**notContained_j:** число ячеек где `powerAssign[idx] = j` И `mask_j[idx] = 0`.

### Этап 7 — Фаза B: Lloyd-refinement

**Энергия Фазы B (лексикографическая):**
```
E_B = (W1 × uncoveredCells, W2 × notContainedTotal)
```
Приоритет: `uncoveredCells` всегда дороже `notContained`. Практически: **ход отклоняется, если создаёт хоть одну новую непокрытую ячейку** (hard constraint).

**Lloyd-ход для куска j:**
1. Вычислить центроид ячейки `powerCell_j` → `(cx_cell, cy_cell)`
2. Вычислить главную ось ячейки (PCA по ячейкам → eigenvector) → угол `θ_cell`
3. Новая позиция куска: `(cx_new, cy_new) = lerp(старый центроид, (cx_cell, cy_cell), α)` где `α = 0.5`
4. Новый угол: `angleDeg_new = normalizeDeg(θ_cell − piece.napDeg)`, с проверкой napTol
5. Создать `newPlacement`, вычислить новую маску
6. Hard constraint: если `countBits(newMask ∩ zoneMask) < countBits(oldMask ∩ zoneMask)` → отклонить ход
7. Принять если `notContained_j_new < notContained_j_old` ИЛИ с вероятностью Больцмана (температура Фазы B независимая, убывает быстрее)

**Пересчёт Power Diagram при ходе j:**
Локальный — только в bbox(oldPos) ∪ bbox(newPos) + margin. Ячейки вне этого bbox не затрагиваются.

**Адаптация весов после каждого полного Lloyd-цикла (все N кусков):**
```
для каждого j:
  если notContained_j > 0: w_j *= 0.9    // ячейка больше чем кусок реально накрывает
  если notContained_j == 0 AND powerCellArea_j < areaReal_j × 0.5:
    w_j *= 1.05                           // ячейка сильно меньше куска — можно расширить
```
Сигнал — `notContained_j`, не сравнение площадей: вогнутый кусок с `areaReal > cellArea` может иметь нулевой `notContained` если клетки лежат в выпуклой части куска.

**Критерий сходимости (ранний выход из Фазы B):**
```
если полный Lloyd-цикл завершён И ΔnotContainedTotal < ε (=1) → остановиться
```
Не жечь время если улучшений нет.

Остановка: сходимость ИЛИ `Date.now() >= phaseBDeadline`.

### Этап 8 — Финальный вывод фрагментов

Для каждого куска j:
```
если notContained_j == 0:
  fragment_j = powerCell_j          (прямые швы, физически вырезаем из куска)
иначе:
  fragment_j = piece_j ∩ powerCell_j  (P.1 fallback, restricted intersection)
```

Остаток ячейки при P.1 fallback (`powerCell_j \ fragment_j`): назначается через restricted assignment к соседним кускам физически покрывающим эти ячейки.

Непокрытые ячейки (нет ни одного куска физически) → restricted gap-fill (P.1, как в v3).

---

## 5. Output (дополнения к v3)

### algorithmTrace (расширен)

```ts
algorithmTrace: {
  version: "voronoi-sa-v2",
  phaseA: {
    timeMs: number,          // фактически затрачено
    iterations: number,
    accepted: number,
    exitReason: "timeout" | "temperature" | "fullCoverage"
  },
  phaseB: {
    timeMs: number,
    lloydIterations: number, // число полных циклов по всем кускам
    exitReason: "timeout" | "converged" | "skipped_mode",  // skipped_mode = режим voronoi_sa, не mosaic
    notContainedTotal_start: number,   // до Фазы B (0 если skipped_mode)
    notContainedTotal_end: number,     // после (0 если skipped_mode)
    weightAdaptationCycles: number
  },
  warnings: string[],        // ["mosaicMode_ignored"] если передан mosaicMode
  fragmentStats: {
    perfectCells: number,    // фрагментов где notContained = 0 (fragment = cell)
    fallbackFragments: number, // фрагментов с P.1 intersection
    gapFillFragments: number
  }
}
```

### Placement (дополнение)

```ts
{
  // ...v3 поля...
  phase: "SA" | "lloyd" | "gap_fill",   // lloyd = улучшен в Фазе B
  fragmentType: "cell" | "intersection" | "gap_fill"  // новое поле
}
```

---

## 6. Инварианты (обновлены)

| # | Инвариант | Гарантия |
|---|-----------|---------|
| I1 | `coveredRatio = sum(inZoneAreaMm2) / zoneArea` | всегда |
| I2 | Нет перекрытий между фрагментами | по построению (disjoint assignment) |
| I3 | `fragment_j ⊆ piece_j` для fragmentType="cell" | по построению (notContained_j=0) |
| I4 | `fragment_j ⊆ piece_j` для fragmentType="intersection" | по определению intersect |
| I5 | `fullCoverageOk = true` iff `coveredRatio >= 0.998` | явно |

---

## 7. Удалённые из v3

| Элемент | Действие |
|---------|---------|
| `mosaicMode` option | принимается, игнорируется, warning в trace |
| `mosaicMode` ветка в formatResult | удалить (заменена Фазой B) |
| Глобальный nearest-center fallback в assignment | заменён Power Diagram |

---

## 8. Известные ограничения

1. **E_B = 0 недостижимо** для вытянутых/вогнутых кусков: `cell_j ⊆ piece_j` требует «кусок содержит выпуклый полигон сопоставимой площади». P.1 fallback гарантирует покрытие в любом случае.

2. **Raster = 3 мм**: Lloyd-ходы оперируют растровыми центроидами, погрешность позиционирования ±1.5 мм.

3. **PCA на растровых ячейках**: угол вращения из PCA — приближение. Для малых ячеек (<10 клеток) PCA нестабильна — использовать угол напрямую от `napTarget - piece.napDeg`.

4. **Локальный пересчёт Power Diagram**: при движении куска j пересчитываются ячейки в bbox(j) + margin. Ячейки дальних соседей могут быть несогласованы до следующего полного пересчёта. Полный пересчёт — раз в Lloyd-цикл.
