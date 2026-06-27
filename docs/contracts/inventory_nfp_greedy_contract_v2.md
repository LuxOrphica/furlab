# inventory_nfp_sa — Контракт v2.0

**Файл реализации:** `furlab-web-plugin/src/services/solvers/nfp_sa_solver.js`
**Что это:** durable-определение корректного поведения солвера "Из инвентаря (NFP+SA)".
**Дата:** 2026-06-27 · **Заменяет:** v1.0 (SA-based, баги с pts/corePts, нечёткая модель).

---

## 0. Что изменилось против v1.0

| Область | v1.0 | v2.0 |
|---|---|---|
| Алгоритм | Greedy warm start + SA | **Только Greedy** — SA убран |
| Единица вычислений | `pts` (тело) везде | **`corePts` везде**; `pts` только для рендера |
| `corePts` в placement | не хранился → double-inset баг | **хранится явно** |
| `alignedCoreContour` | `inset(pts, allowance)` — баг | `pl.corePts` напрямую |
| Статусы | 2 (`ok`/`failed`) | **4 статуса** (как voronoi_sa v5.0) |
| Детерминизм | частичный | **полный** при одном `seed` |

---

## 1. Модель (определения)

Солвер раскладывает **ядра** скрап-кусков в зону так, чтобы их объединение покрывало зону максимально, с учётом направления ворса.

| Термин | Определение |
|---|---|
| **Скрап** | физический кусок меха, `scrapContour`. Уникален, используется ≤ 1 раза |
| **Тело** `pts` | `scrapContour` после трансформации (позиция, угол). **Только для отображения** (`alignedContour`). В вычислениях не участвует |
| **Ядро** `corePts` | `inset(scrapContour, allowanceMm)` после трансформации. **Единственная геометрия вычислений** |
| **Припуск** `allowanceMm` | применяется один раз: при построении `centeredCorePts` из `scrapContour` на этапе подготовки. Больше нигде |
| **Фрагмент** `inZoneCoreContour` | `corePts ∩ zone \ occupiedUnion` — уникальная часть ядра внутри зоны |
| **occupiedUnion** | объединение `corePts ∩ zone` всех ранее размещённых кусков (без вычитания — предотвращает щели на стыках) |

```
centeredCorePts = inset(centeredPts, allowanceMm)   // один раз, на подготовке
corePts         = transform(centeredCorePts, angle, cx, cy)
mask            = rasterize(corePts)                // маска по ядру
fragment        = corePts ∩ zone \ occupiedUnion    // фрагмент — юнит покрытия

// pts = transform(centeredPts, angle, cx, cy) — только для alignedContour (рендер)
```

**Инвариант:** любое обращение к `pl.pts`, `pl.fullMask`, `offsetContourInward(pl.pts, ...)` внутри солвера — баг.

---

## 2. Входы / выходы

**Вход:** `candidates[]` (`id | inventoryTag`, `scrapContour`, `napDirectionDeg`), `options`.

**Выход (реплейабельно при одном `seed`):** `placements[]`, `metrics`, `resultStatus`.

**Placement:**

| Поле | Источник | Назначение |
|---|---|---|
| `alignedContour` | `pl.pts` | рендер тела (с припуском) |
| `alignedCoreContour` | `pl.corePts` | рендер ядра |
| `inZoneContour` | `pts ∩ zone` | рендер тела в зоне |
| `inZoneCoreContour` | фрагмент | **юнит покрытия и валидации** |
| `inZoneAreaMm2` | `area(fragment)` | площадь фрагмента |

---

## 3. Инварианты

| # | Требование |
|---|---|
| **R1 — единица вычислений** | Маска, покрытие, overlap, min-size, occupiedUnion — по `corePts`. `pts` — только `alignedContour` |
| **R2 — припуск один раз** | `allowanceMm` применяется только при построении `centeredCorePts`. Нигде больше |
| **R3 — уникальность** | Каждый `inventoryTag` ≤ 1 раза в выводе |
| **R4 — min-size** | MBR-short `inZoneCoreContour` ≥ `minWidthMm`. Фрагмент < минимума — не создаётся |
| **R5 — детерминизм** | Тот же `seed` → тот же вывод. Конструктивный порядок и тай-брейки фиксированы |
| **R6 — ворс** | Угол каждого куска: `|deltaDeg(napTarget - napDeg, angleDeg)| ≤ napTol` |
| **R7 — схлопывание inset** | Если `inset` схлопывается (< 3 точек) — кусок **отбрасывается**. Fallback к `pts` — запрещён |

---

## 4. Алгоритм

### Этап 0 — Подготовка кусков

1. Парсинг `scrapContour`, центрирование.
2. `centeredCorePts = inset(centeredPts, allowanceMm)`. Схлопнулся → кусок отброшен.
3. Фильтр min-size по MBR `centeredCorePts`.
4. Вычисление `areaMm2 = area(centeredCorePts)`.
5. IFP: `ifp = MinkowskiDiff(zone, centeredCorePts)` — допустимые позиции центроида.

### Этап 1 — Greedy Coverage

Повторяется до тех пор пока есть свободные куски И непокрытая площадь > `residualThreshold`:

1. Для каждого свободного куска — `K` попыток позиционирования:
   - 70% попыток: случайная точка внутри IFP (гарантированно помещается в зону).
   - 30% попыток: случайная точка внутри зоны (fallback если IFP пуст).
   - Угол: `normalizeDeg(napTarget - napDeg)` ± малый случайный шум в пределах `napTol`.
   - `gain = countAnd(mask, uncoveredMask)`.

2. Кусок с максимальным `gain` среди всех свободных — размещается.
   - Тай-брейк: `inventoryTag asc`.
   - Если `gain = 0` — ни один кусок не добавляет покрытия → стоп.

3. `uncoveredMask` обновляется, кусок помечается использованным.

**K попыток:** по умолчанию 32. Увеличение K улучшает качество, линейно увеличивает время.

### Этап 2 — Финализация фрагментов

Для каждого размещённого куска (в порядке размещения):

1. `coreMp = intersect(corePts, zone)`.
2. Фильтр min-size по `coreMp` (до вычитания).
3. `fragmentMp = diff(coreMp, occupiedUnion)`.
4. Если `fragmentMp` пуст → кусок включается с `inZoneCoreContour = mpToPoints(coreMp)` (для корректного подсчёта покрытия).
5. Если несколько компонент → каждая становится отдельной записью (`_part0`, `_part1`…).
6. `occupiedUnion = union(occupiedUnion, coreMp)`.

### Этап 3 — Метрики и статус

```
covF = area(union(inZoneCoreContour)) / area(zone)
```

---

## 5. Приёмка — 4 статуса

| `resultStatus` | Условие |
|---|---|
| `ok` | covF ≥ 99.5% ∧ R3–R6 PASS |
| `partial` | covF ∈ [95%, 99.5%) ∧ R3–R6 PASS |
| `insufficient_input` | physMissing > 1% и нет свободных подходящих кусков (нет инвентаря) |
| `failed` | R3 FAIL (дубли) ∨ R4 FAIL (суб-мин в выводе) ∨ R6 FAIL (ворс) ∨ covF < 95% при наличии свободных подходящих кусков |

---

## 6. Параметры

| Параметр | Роль |
|---|---|
| `allowanceMm` | только R2 (inset на входе) |
| `minWidthMm` / `minLengthMm` | R4 (MBR фрагмента) |
| `napTarget` / `napTol` | R6 (ворс) |
| `seed` | детерминизм (R5) |
| `K` | число попыток позиционирования (дефолт 32) |
| `residualThreshold` | порог остановки (дефолт 0.5% площади зоны) |

---

## 7. Запрещено

- Использование `pts`, `fullMask`, `offsetContourInward(pts, ...)` в любом вычислении внутри солвера.
- Fallback ядра к `pts` при схлопывании inset.
- Дубли `inventoryTag` в выводе.
- Суб-мин фрагменты (< `minWidthMm`) в выводе.
- SA-цикл (убран в v2.0 — источник недетерминизма и энергетических ловушек).
- Фильтрация по utilization ratio (≥ 0.15 из v1.0 — отбрасывала валидные большие куски).

---

## 8. Отличие от voronoi_sa v5.0

| Аспект | voronoi_sa v5.0 | nfp_sa v2.0 |
|---|---|---|
| Структура зоны | Вороной-территории | нет — куски перекрываются, фрагменты вычитаются |
| Вращение | запрещено (R6) | разрешено в пределах `napTol` |
| SA | да (20000 итераций) | **нет** |
| Выход | тайлинг (каждая точка зоны принадлежит ровно одному фрагменту) | покрытие (фрагменты дизъюнктны, но между ними могут быть physMissing) |
| Назначение | большие зоны, точное тайлирование | быстрый подбор из инвентаря |
