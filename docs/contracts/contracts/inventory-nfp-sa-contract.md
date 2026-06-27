# Inventory NFP+SA Contract v1.0

## 1. Scope

Контракт описывает режим автоматического подбора кусков меха методом No-Fit Polygon + Simulated Annealing (`inventory_nfp_sa`).

- Единицы: мм и мм².
- `MUST` = обязательно. `SHOULD` = рекомендуется. `MAY` = опционально.

---

## 2. Цель

Покрыть зону Z кусками из инвентаря так, чтобы:
- ядра кусков (после вычета припуска) покрывали зону без перекрытий
- направление ворса каждого куска не выходило за допуск φ
- количество кусков было минимальным при максимальном покрытии

---

## 3. Термины

| Термин | Определение |
|---|---|
| `Z` | Зона — произвольный полигон |
| `P` | Физический контур куска (scrapContour) после трансформации (x, y, θ) |
| `PcoreRaw` | Ядро куска = `inset(P, allowanceMm)`. Если inset схлопывается — `PcoreRaw = P` |
| `PcoreZ` | `intersect(PcoreRaw, Z)` — ядро, обрезанное по зоне |
| `fragment` | Часть `PcoreZ` после вычитания уже занятых ядер: `diff(PcoreZ, occupiedUnion)` |
| `occupiedUnion` | Объединение `PcoreZ` всех ранее размещённых кусков (без вычитания — для предотвращения дырок на стыках) |
| `allowanceMm` | Резерв припуска, мм. Производственный стандарт: 3 мм |
| `napTarget` | Целевое направление ворса зоны, градусы |
| `napTol` | Допуск ворса, градусы (дефолт: 15°) |
| `maxSolveMs` | Максимальное время SA-цикла, мс (дефолт: 90 000) |

---

## 4. Алгоритм (v1)

### 4.1 Растровая сетка

- Ячейка: 3 × 3 мм (фиксировано).
- Зона растеризуется в бинарную маску `zoneMask`.
- Каждый кандидат растеризуется в маску `pieceMask` при заданной позиции/угле.

### 4.2 Greedy Warm Start

1. Кандидаты сортируются по убыванию площади.
2. Для каждого кандидата: 16 случайных попыток размещения внутри зоны, выбирается лучший прирост покрытия (`countAnd(mask, uncovered)`).
3. Принятые размещения формируют начальное решение для SA.
4. Yield каждые 8 кандидатов (setImmediate) для не-блокирующего event loop.

### 4.3 Simulated Annealing

- Температура: `T₀ = 2.0`, `Tmin = 0.01`, `alpha = 0.9995`.
- Ходы: `TRANSLATE` (±stepMm), `ROTATE` (±napTol°), `SWAP` (замена на другой кусок), `ADD` (добавить новый кусок).
- Энергия: `E = -coveredCells + λ·overlapCells - μ·n` (покрытие максимизируется, перекрытия штрафуются).
- Принятие хода: `dE < 0` или `rand() < exp(-dE/T)`.
- Лучшее решение (`bestPlacements`) сохраняется на протяжении всего цикла.
- Yield каждые 300 мс (setImmediate) для телеметрии и event loop.

### 4.4 Постобработка (formatResult)

Для каждого размещённого куска:

1. `util = area(intersect(P, Z)) / area(P)` — если `< 0.15`, кусок пропускается.
2. Фильтр по размеру (`minWidthMm`, `minLengthMm`) проверяется по **исходному** ядру `PcoreZ` до вычитания.
3. `coreMp = diff(PcoreZ, occupiedUnion)` — вычитание занятого пространства.
4. Если `coreMp` пуст (кусок полностью перекрыт) — кусок всё равно включается в результат с исходным `PcoreZ` как `inZoneCoreContour` (для корректного подсчёта покрытия).
5. Если `coreMp` состоит из нескольких полигонов — каждый становится отдельным фрагментом (`placementId = "${id}_part${i}"`).
6. `occupiedUnion` пополняется **исходным** `PcoreZ` (не обрезанным) — предотвращает щели на границах.

---

## 5. Входные данные

```json
{
  "layoutType": "inventory_nfp_sa",
  "zone": { "id": 1, "points": [{"x": 0, "y": 0}] },
  "inputs": {
    "candidates": [
      {
        "scrapPieceId": "string",
        "scrapContour": [{"x": 0, "y": 0}],
        "napDirectionDeg": 0,
        "quantity": 1
      }
    ]
  },
  "options": {
    "maxSolveMs": 90000,
    "seed": 12345,
    "allowanceMm": 3,
    "napTarget": 0,
    "napTol": 15,
    "minWidthMm": 0,
    "minLengthMm": 0
  },
  "progressToken": "nfp_sa_1234567890"
}
```

---

## 6. Выходные данные

```json
{
  "ok": true,
  "layoutType": "inventory_nfp_sa",
  "resultStatus": "ok | failed",
  "coveredRatio": 0.97,
  "placements": [
    {
      "placementId": "piece_001",
      "scrapPieceId": "piece_001",
      "inventoryTag": "piece_001",
      "alignedContour": [{"x": 0, "y": 0}],
      "inZoneContour": [{"x": 0, "y": 0}],
      "alignedCoreContour": [{"x": 0, "y": 0}],
      "inZoneCoreContour": [{"x": 0, "y": 0}],
      "status": "matched",
      "phase": "SA",
      "solveIndex": 0,
      "solveOrder": 1,
      "renderIndex": 0
    }
  ],
  "render": {
    "items": [...]
  },
  "stats": {
    "coveredRatio": 0.97,
    "placementsTotal": 22
  }
}
```

---

## 7. Отображение на клиенте

| Слой | Источник | Описание |
|---|---|---|
| Голубая заливка (`visibleArea`) | `inZoneCoreContour` каждого фрагмента | Ядра — полезная площадь меха |
| Синие линии (границы) | `cutPoints = inZoneContour` | Линии реза (по припуску) |
| Оранжевые дырки (`coverageHoles`) | `zone \ union(inZoneCoreContour)` | Зоны без покрытия ядром |
| Швы (`seams`) | `computeSeamSegmentsFromAppliedFragments` | Границы между соседними фрагментами |

---

## 8. Ограничения v1

- Растровая сетка 3 мм — минимальная точность позиционирования.
- Отражение кусков не поддерживается (только вращение в пределах ±napTol).
- Лимит кандидатов: 300 (настраивается в UI).
- Время решения: до 90 с (настраивается через `maxSolveMs`).
- Результат не сохраняется на сервере — только в памяти клиента.
- Применение (`Apply`) фиксирует размещение в БД через стандартный механизм.

---

## 9. Файлы реализации

| Файл | Роль |
|---|---|
| `src/services/solvers/nfp_sa_solver.js` | Ядро алгоритма (raster, SA, formatResult) |
| `src/modes/inventory_nfp_sa/index.js` | Mode wrapper (previewWrapper, applyWrapper) |
| `src/modes/wrapper.js` | Общий wrapper с assertPlacements |
| `src/routes/layout.js` | HTTP endpoint `/api/layout/modes/preview` |
| `public/js/app.js` → `previewNfpSaLayout()` | Клиент: запуск, построение фрагментов, отображение |
| `public/js/core/layout-modes.js` | Регистрация режима, иконки |
| `public/js/core/property-editor-view.js` | Кнопка "Подобрать / Пересчитать" |
