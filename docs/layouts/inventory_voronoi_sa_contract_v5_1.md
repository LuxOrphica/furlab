# inventory_voronoi_sa — Контракт v5.1

**Файл реализации:** `furlab-web-plugin/src/services/solvers/voronoi_sa_solver.js`
(+ `voronoi_sa_output.js`, `voronoi_sa_search.js`, `voronoi_sa_postprocess.js`, `voronoi_sa_coverage.js`, `voronoi_sa_diagnostics.js`, `inventory_voronoi_sa/index.js`)

**Что это:** durable-определение КОРРЕКТНОГО поведения солвера. Рамки, инварианты, приёмка, запреты.

**Дата:** 2026-06-27 · Заменяет: v5.0

---

## 0. Что изменилось против v5.0

| Область | v5.0 | v5.1 |
|---|---|---|
| Ядро | `inset(scrapContour, allowanceMm)` — ядро меньше тела | ядро = тело (`scrapContour`) всегда |
| Припуск | `allowanceMm` в солвере: инсет scrap→core на входе | `allowanceMm` не в солвере — инструкция раскрою (grow наружу при экспорте) |
| Краевое кольцо | 12 мм, где ядро не дотягивается до границы → дыры | нет — ядро = тело, доходит до границы |
| Coverage при allowanceMm>0 | < 100% (краевое кольцо непокрыто ядром) | → 100% (ядро = тело, край покрыт) |
| INV4 | срабатывает при coreArea == pieceArea (если allowanceMm > 0) | убран — ядро = тело по определению |
| Pass 5 | нет | R2 safety-net — финальная проверка partition-gap |
| Fitness-based ADD | нет (случайный кусок) | ADD выбирает кусок по fitness к дыре |

---

## 1. Модель (определения)

Солвер раскладывает куски (`scrapContour`) в зону так, чтобы их фрагменты тайлили зону встык, без дыр, с эстетикой швов Вороного.

| Термин | Определение |
|---|---|
| Скрап | физический кусок меха, `scrapContour`. Уникален, используется ≤ 1 раза. Не вращается |
| Кусок = ядро = тело = `alignedCoreContour` = `alignedContour` | `scrapContour` после трансформации (сдвиг + угол). Единственная геометрия в солвере. Припуск не вычитается |
| Припуск `allowanceMm` | инструкция раскрою: «дорисовать N мм наружу от куска». В солвере отсутствует — применяется отдельной пост-операцией при экспорте плана кроя |
| Территория | дизъюнктная область разбиения зоны, назначенная одному куску. Строится по Вороному + коррекция: клетка назначается куску, чьё ядро её реально накрывает (R2) |
| Фрагмент = `inZoneCoreContour` | кусок ∩ территория ∩ zone. Единица покрытия, валидации, приёмки. Дизъюнктен в метрике |
| Шов | место, где два куска физически перекрываются. В раскрое — два припуска складываются на изнанку. В метрике — Union без двойного счёта |

```
piece_i = scrapContour_i (после трансформации) // единственная геометрия
territory_i = assigned by Voronoi + polygon-coverage (R2) + Pass 5 safety-net
fragment_i = piece_i ∩ territory_i ∩ zone       // дизъюнктен, тайлит, ЭТО покрытие
// припуск: в солвере отсутствует; при раскрое — grow(piece, allowanceMm) наружу
```

---

## 2. Инварианты (R)

| № | Инвариант | Нарушение |
|---|---|---|
| R1 | Каждый скрап используется ≤ 1 раза | `DUPLICATE_PIECE` |
| R2 | Территория куска ⊆ покрытия его ядром (ядро = тело) | partition-gap → Pass 5 |
| R3 | `fragment_i = piece_i ∩ territory_i ∩ zone` | phantom-fragment |
| R4 | `allowanceMm` не влияет на геометрию солвера | regression v5.0 |
| R5 | MBR фрагмента ≥ `minWidthMm × minLengthMm` | thin-fragment |
| R6 | Нет вращения кусков | rotation-forbidden |
| R7 | При фиксированном seed результат детерминирован | non-deterministic |
| R8 | absorb только если донор теряет < 30% или фрагмент < 300 мм² | over-absorb |

---

## 3. Статусы результата

| Статус | Условие |
|---|---|
| `ok` | coverage ≥ 97%, нет `interior` дыр > 200 мм², все R выполнены |
| `partial` | coverage 70–97% или есть мелкие interior дыры; размещение найдено |
| `insufficient_input` | горло зоны < `minWidthMm`, или кусков < 1, или зона пустая |
| `failed` | coverage < 70% или критическая ошибка солвера |

---

## 4. Coverage (покрытие)

```
coverage = Σ area(fragment_i) / area(zone)
```

- В v5.1: ядро = тело → coverage стремится к 100% при достаточном числе кусков.
- `residualInteriorMm2` — дыры > 2 мм от границы, не slivers, не raster-artifacts.
- `residualPerimeterMm2` — краевые дыры (≤ 2 мм от границы).

---

## 5. Эстетика (aesthetics)

### 5.1 Метрики шва

| Метрика | Порог |
|---|---|
| `seamStraightness` | ≥ 0.85 (TODO v5.2) |
| `seamBalance` | отношение длин швов ≤ 3× |

### 5.2 Метрики фрагмента

| Метрика | Порог |
|---|---|
| Заполнение MBR `area/MBR` | ≥ 0.55 |
| Доля языков `area \ buffer(−minWidth/2) / area` | ≤ 0.08 |
| Прямота швов | ≥ 0.85 (TODO v5.2) |

### 5.3 Классификация дыр

| Класс | Критерий | Считается в |
|---|---|---|
| `sliver` | эрозия дыры на −1.5 мм схлопывает (>60% съедено) | не считается (прощается) |
| `raster-artifact` | `fill_ratio = area/bbox_area < 0.3` и `area > 50 мм²` | не считается (растровый шум) |
| `interior` | dist до границы зоны > 2 мм, эрозия не схлопывает | `residualInteriorMm2` |
| `edge` | dist ≤ 2 мм, эрозия не схлопывает | `residualPerimeterMm2` |

---

## 6. Параметры

| Параметр | Роль |
|---|---|
| `allowanceMm` (UI 12) | **только раскрой** — не влияет на солвер (v5.1 R4) |
| `minWidthMm` / `minLengthMm` (UI 70) | R5 (MBR фрагмента) |
| `seed` | воспроизводимость (R7) |
| `maxIterations` (20000) | детерминированный потолок SA |
| `maxSolveMs` (90000) | страховочный cap по времени |
| `overhangMm` (75) | свес куска за зону (для IFP) |

---

## 7. Запрещено

- Покрытие по inset-ядрам (v5.0 модель — устарела).
- `allowanceMm` в солвере: инсет, min-size, валидация.
- Absorb без guard'ов R8.
- Вращение кусков.
- Латание (отдельные патч-фазы поверх готовой раскладки).
- NFP-перебор при больших N.
- Фантомные метрики.

---

## 8. Известные ограничения

- Под-сеточные слайверы (~0.05–0.1%) прощаются эрозией.
- `raster-artifact` (извилистые змейки по швам) — прощаются (fill_ratio < 0.3).
- Горло зоны < 70 → `insufficient_input`.
- При `allowanceMm > 0` coverage **не зависит** от припуска (v5.1) — край покрыт куском.

---

## 9. Файлы реализации

| Файл | Роль |
|---|---|
| `voronoi_sa_solver.js` | Главный `solve()`, подготовка кусков, SA/Lloyd ветки |
| `voronoi_sa_search.js` | SA-цикл, ADD/SWAP/TRANSLATE/REMOVE, fitness-based ADD |
| `voronoi_sa_output.js` | `buildTerritoryOutput`, PH-1a, BFS, Pass 4, **Pass 5**, PH-3, CPT-B |
| `voronoi_sa_postprocess.js` | absorb с guard'ами R8, dissolve |
| `voronoi_sa_coverage.js` | `computeResidualCoverage`, классификация дыр |
| `voronoi_sa_diagnostics.js` | `computeResultInvariants` (INV1/INV5; INV4 убран в v5.1) |
| `voronoi_sa_result.js` | `formatResult`, 4 статуса, aesthetics |
| `voronoi_sa_annealing.js` | energy, `pickMove` (без ROTATE) |
| `inventory_voronoi_sa/index.js` | mode wrapper (SA по умолчанию) |

---

## 10. История

| Версия | Дата | Суть |
|---|---|---|
| v2–v4.3 | 2026-06-01..22 | 7 версий, внутренние противоречия, фейк-PASS, SA отключён |
| v5.0 | 2026-06-27 | ядро = inset(тело), absorb с guard'ами, SA включён, 4 статуса, эстетика |
| **v5.1** | **2026-06-27** | **ядро = тело всегда, припуск = внешний. Pass 5 R2 safety-net. Fitness-based ADD. INV4 убран.** |
