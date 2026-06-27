# Contract v4: inventory_voronoi_sa — двухфазный солвер

**Статус:** ДЕЙСТВУЮЩИЙ (заменяет v3)  
**Дата:** 2026-06-13  
**Связанные файлы:** `src/services/solvers/voronoi_sa_solver.js`, `src/modes/inventory_voronoi_sa/`

---

## 1. Архитектура: две фазы

### Фаза A — Simulated Annealing
- Размещает куски внутри зоны, максимизирует физическое покрытие ячеек (3 мм сетка)
- Ходы: TRANSLATE, ROTATE, SWAP, REMOVE, ADD
- Энергия: `1000 × uncovered + 8 × overlap + 1 × N`
- **Precondition для Фазы B:** `uncovered == 0` (полное физическое покрытие)
- Ранний выход: если `uncovered == 0` — немедленно передать оставшееся время Фазе B

### Фаза B — Lloyd + Power Diagram
- Улучшает containment: смещает куски к центроиду их ячейки Power Diagram
- **Инвариант:** ни один ход не должен создавать непокрытую ячейку
- Запускается всегда (даже если Фаза A не достигла полного покрытия) — containment улучшает, дыры не создаёт

---

## 2. Тайм-бюджет

Единый параметр `maxSolveMs`. Никаких отдельных `phaseAMs` / `phaseBMs`.

```
phaseB_reserve = max(5000, floor(maxSolveMs × 0.25))
phaseA_deadline = startTime + maxSolveMs − phaseB_reserve
phaseB_deadline = startTime + maxSolveMs
```

Если Фаза A завершила полное покрытие досрочно — весь остаток до `phaseB_deadline` уходит Фазе B.

---

## 3. Фаза B: энергия и hard constraint

**Вариант A (реализовать):** жёсткое ограничение (hard constraint)

> Ход отклоняется, если переносит кусок в позицию, где хотя бы одна ячейка, которую покрывал **только он**, перестаёт покрываться.

Это проще и надёжнее для Lloyd: нет температуры, нет весов энергии, нет ложных принятий.

**Вариант B (справочно):** мягкая энергия  
`E_B = W1 × uncovered + W2 × notContained`, лексикографически — `W1 >> W2`.  
Применять только если hard constraint слишком жёсткий и Lloyd не сходится.

**Критерий сходимости Фазы B:**  
- Полный цикл (все куски проверены) без принятых ходов, **или**
- `|notContained_prev − notContained_curr| < ε` (ε = 1 ячейка)
- По исчерпанию времени (fallback)

---

## 4. Адаптация весов Power Diagram

Сигнал: `notContained_j > 0` после каждого полного цикла Lloyd.

```
if notContained_j > 0:
    w_j *= 0.9          # ячейку не вмещает → сжать территорию
else if powerCellArea_j < areaReal_j × 0.5:
    w_j *= 1.05         # территория слишком мала → чуть расширить
```

**Почему не сравнение площадей:** вогнутый кусок может иметь `area > cellArea` и всё равно не вмещать ячейку (containable-площадь меньше реальной). `notContained_j` — прямой сигнал.

---

## 5. mosaicMode — устаревший флаг

`options.mode === "mosaic"` принимается, но **игнорируется** начиная с v4.

Обоснование: Фаза B уже реализует мозаику физически корректно — там где `notContained_j == 0`, `fragment = powerCell` (чистый геометрический шов). Старый mosaic-mode выдавал невырезаемые фрагменты (кусок вне ячейки), что является производственным браком.

В `algorithmTrace` добавляется:
```json
"warnings": ["mosaicMode_ignored"]
```

Режим `inventory_mosaic` в реестре: пометить `deprecated`, удалить следующим релизом после проверки тестов.

---

## 6. Выходной контракт: `algorithmTrace` (v4)

```json
{
  "version": "voronoi-sa-v4",
  "effectiveOptions": { ... },
  "phaseA": {
    "timeMs": 45230,
    "iterations": 12400,
    "accepted": 3100,
    "exitReason": "fullCoverage | Tmin | timeout",
    "uncoveredAtExit": 0
  },
  "phaseB": {
    "timeMs": 14770,
    "lloydIterations": 23,
    "exitReason": "converged | no_accepted | timeout",
    "notContainedTotal_start": 840,
    "notContainedTotal_end": 12,
    "weightAdaptationCycles": 23,
    "skipped": false,
    "skipReason": null
  },
  "targetedCycle": { ... },
  "fragmentStats": { ... },
  "warnings": []
}
```

**Новые поля:**
- `phaseA.uncoveredAtExit` — ячеек без покрытия при выходе из A (0 = precondition выполнен)
- `phaseB.skipped` — запускалась ли B
- `phaseB.skipReason` — если не запускалась: `"no_time"` / `"no_placements"`

---

## 7. Fragment = piece ∩ territory

Каждый фрагмент: `intersect(alignedContour, voronoiCell)`  
- Если пересечение пусто: `physicalMissingMm2 = territoryArea`, фрагмент = territory (placeholder)  
- Если непусто: `physicalMissingMm2 = territoryArea − intersectionArea`  
- `physicalMissingMm2 > 0` означает кусок не полностью закрывает свою территорию → отображается в мониторе (колонка `physMiss`)

---

## 8. Инварианты (без изменений)

| Инвариант | Проверка |
|---|---|
| `geometricPartition` | Union(fragments) = Zone, попарно нет пересечений |
| `noOverlaps` | Нет перекрытий |
| `pieceContainsCut` | `alignedContour` содержит `inZoneContour` |
| `coreContainsCells` | Core-контур содержит ячейки фрагмента |
| `noDisconnectedCells` | Нет изолированных ячеек |
| `napValid` | Угол ворса в допуске |
| `allFragmentsHavePiece` | Каждый фрагмент привязан к куску |
| `noFragmentsInHoles` | Нет фрагментов в дырках зоны |

---

## 9. Что НЕ меняется

- API вызова (`solve(zonePoints, candidates, constraints, options)`)
- Формат `placements[]` в ответе
- Логика Greedy warm start
- Targeted cycle (post-SA патчинг)
- Multi-restart wrapper (`solveMultiRestart`)
