# inventory_voronoi_sa — Контракт v2.2

> **История**: v2.1 → v2.2: устранены 20 неточностей. Ключевые: единое имя `zoneRegionArea`, исправлен `rawShapeUsability` / порог исключения, farthest-point sampling для sites, PolygonWithHoles в Power Diagram, запрет молчаливого уменьшения `fixedN`, gap-fill по всем инвариантам, remove-one только после полного solve, `failedSolve` по любому инварианту, запрет largest-ring как финального fragmentContour, численные лимиты solver, параметризуемый scale check, rotation candidates, запрет applied layout при `canApply = false`.

---

## 1. Назначение

Режим формирует **чистую мозаику Вороного** из инвентарных кусков меха внутри зоны.

Ключевые свойства результата:

- `fragment_i = voronoiCell_i` — фрагмент **равен** ячейке Вороного, не пересечению куска и ячейки
- Ячейки образуют **partition** zoneRegion: без дыр, без перекрытий
- Каждая ячейка **физически обоснована**: `transformedCore_i ⊇ voronoiCell_i`
- Coverage считается двумя независимыми метриками: геометрической и физической

---

## 2. Входные параметры

```ts
interface VoronoiSaInput {
  zonePoints: Point[]              // внешний контур зоны (CCW)
  zoneHoles?: Point[][]            // отверстия в зоне
  zoneMaterialId: string
  pileDirectionDeg: number         // эталонное направление ворса

  scrapPieces: ScrapPiece[]
  options: VoronoiSaOptions
}

interface VoronoiSaOptions {
  // Физика куска
  pieceSeamReserveMm: number       // единый резерв припуска (inset для core, offset для cutContour); дефолт 12
                                   // ПРИМЕЧАНИЕ: в v2.2 один резерв для всех границ.
                                   // Раздельные резервы (внешний край зоны, holes, декоративный срез)
                                   // не поддерживаются. Источник: options (UI override).

  napToleranceDeg: number          // допуск направления ворса; дефолт 30°
  rotationStepDeg?: number         // шаг перебора rotation candidates; дефолт 5°

  // Preflight / selection
  fragmentCountMode: "auto" | "fixed" | "range" | "targetArea"  // дефолт "auto"
  fixedN?: number                  // только при fragmentCountMode="fixed"
  minFragments?: number            // только при fragmentCountMode="range"
  maxFragments?: number
  targetFragmentAreaMm2?: number   // только при fragmentCountMode="targetArea"
  reserveFactor?: number           // Nstart = ceil(Nbase × reserveFactor); дефолт 1.25

  // Фильтры кусков
  minPieceCoreWidthMm?: number     // fallback, если материал не задаёт minCoreWidthMm; дефолт 10
  minCellAreaMm2?: number          // мин. допустимая площадь ячейки; дефолт 100

  // Scale check (§3.1)
  minZoneAreaMm2?: number          // если zoneRegionArea < minZoneAreaMm2 → suspectedScaleError; дефолт 500
  minZoneBBoxMm?: number           // мин. ожидаемый размер стороны bbox; дефолт 10

  // Lимиты solver (§12)
  epsilonMm2?: number              // площадь считается нулевой; дефолт 0.1
  areaEpsilonPercent?: number      // допуск invar №1, №11 в % от zoneRegionArea; дефолт 0.5
  maxWeightAdjustIterations?: number    // итерации adjustWeights (full); дефолт 40
  maxWeightAdjustTrialIter?: number     // итерации для trial-диаграмм; дефолт 12
  maxLevel3AttemptsPerCell?: number     // попыток Level 3 на ячейку; дефолт 80
  maxRecoveryAttemptsPerCell?: number   // повторных попыток recovery на ячейку; дефолт 3
  maxGapFillAttempts?: number      // всего попыток gap-fill; дефолт 15
  maxRemoveOneAttempts?: number    // попыток remove-one; дефолт (Nstart × 2)
  maxSolveTimeMs?: number          // общий таймаут; дефолт 90000

  safetyFactor?: number            // pre-check suммарной capacity; дефолт 1.05
  maxGapFillCandidates?: number    // дефолт 10
  minGapFillAreaMm2?: number       // дефолт 50
}

interface ScrapPiece {
  id: string
  inventoryTag: string
  contourPoints: Point[]
  napDirectionDeg: number
  materialId: string
  available: boolean
}
```

---

## 3. Алгоритмические определения

### 3.1 zoneRegion и площади

```
zoneOuterArea    = area(zoneOuter)
zoneHolesArea    = Σ area(zoneHoles_j)
zoneRegionArea   = zoneOuterArea - zoneHolesArea
```

**Единственное рабочее имя**: `zoneRegionArea`. Нигде ниже в контракте не используются `zoneArea` или `usableZoneArea` — только `zoneRegionArea`.

```
zoneRegion = zoneOuter − zoneHoles
```

Фрагменты, попадающие в отверстия, недопустимы. Все проверки partition выполняются по `zoneRegion`.

**Scale check до запуска**:
```
if zoneRegionArea < options.minZoneAreaMm2:
  → failedPreflight: suspectedScaleError
    reason включает: zoneRegionArea, zoneBBoxMm, zoneOuterArea

if min(zoneBBoxW, zoneBBoxH) < options.minZoneBBoxMm:
  → failedPreflight: suspectedScaleError
```

В Monitor всегда выводить: `zoneRegionArea`, `zoneBBoxMm`, `zoneOuterArea`, `zoneHolesArea`, `scalePxPerMm` (если доступен), `suspectedScaleErrorReason`.

### 3.2 Core куска

```
coreLocal_i = inset(centeredPieceContour_i, pieceSeamReserveMm)
```

Core — видимая допустимая область куска. Используется **только для проверки containment**.

Если `area(coreLocal_i) < epsilonMm2 × 500` (т.е. < ~50 мм² при дефолте) → кусок исключается на Preflight: `tooSmallAfterInset`.

### 3.3 Совместимость направления ворса

```
napValid(rotDeg) = absAngleDiff(napDirectionDeg + rotDeg, pileDirectionDeg) ≤ napToleranceDeg
```

**Pre-filtering**: кусок кандидат, если ∃ rotDeg: `napValid(rotDeg) = true`.

**Rotation candidates** строятся **до Level 3** для каждого куска:
```
rotationCandidates_i = { rotDeg ∈ [0°, 360°) с шагом rotationStepDeg : napValid(rotDeg) = true }
```
Level 3 перебирает **только** эти углы. Flip и mirror **запрещены**.

Конвенция: все углы в градусах CCW, диапазон [0°, 360°).

**Финальная валидация**: `napValid(finalRotDeg_i) = true` обязательно.

В Monitor для каждого фрагмента: `rotationCandidatesCount`, `selectedRotDeg`, `napDiffDeg`.

### 3.4 shapeUsability

```
perimeter       = Σ |edge_k|  (периметр coreLocal)
bboxW, bboxH    = размеры bbox coreLocal

compactnessScore = clamp(4π × area / perimeter², 0, 1)
bboxRatioScore   = clamp(min(bboxW, bboxH) / max(bboxW, bboxH), 0, 1)
minWidthApprox_i = min(bboxW(coreLocal_i), bboxH(coreLocal_i))
minWidthScore    = clamp(minWidthApprox_i / sqrt(area), 0, 1)

rawShapeUsability = mean(compactnessScore, bboxRatioScore, minWidthScore)
```

**Порог исключения применяется к rawShapeUsability ДО clamp**:
```
if rawShapeUsability < 0.15:
  reject: shapeUnusable    ← исключается на Preflight

shapeUsability = clamp(rawShapeUsability, 0.15, 1.0)
```

`capacity_i = area(coreLocal_i) × shapeUsability_i`

Кусок с `rawShapeUsability ∈ [0.15, 0.25]` включается только если нет лучших кандидатов (см. scored selection).

`napCompatibility` **не является множителем** capacity. Несовместимый кусок исключается фильтрацией.

### 3.5 minWidthMm — источник

```
minWidthMm =
  zoneMaterial.minCoreWidthMm
  ?? zoneMaterial.defaultFragmentMinWidthMm
  ?? options.minPieceCoreWidthMm
  ?? 10
```

Приоритет: материал зоны → свойства меха → options (UI override). В Monitor: `minWidthMm`, `source: "material" | "options" | "default"`.

Проверка:
```
if minWidthApprox_i < minWidthMm:
  reject: belowMinWidth
```

### 3.6 Target area ячейки

```
totalCap   = Σ capacity_j  (по selected)
targetArea_i = zoneRegionArea × capacity_i / totalCap
```

`targetArea` — желаемая площадь. **Не гарантирует физическую допустимость**: кусок с достаточной площадью может не накрыть ячейку по форме. Физическая допустимость проверяется на Level 3.

### 3.7 Core anchor

```
coreAnchorLocal_i = polylabel(coreLocal_i)
transformedAnchor_i = transform(coreAnchorLocal_i, tx_i, ty_i, rotDeg_i)
```

### 3.8 voronoiCell и MultiPolygon

```
voronoiCell_i = PowerDiagram(site_i, weight_i) ∩ zoneRegion
```

После пересечения с вогнутой зоной ячейка может стать MultiPolygon (несвязная).

**Правила для disconnectedCell**:
- Largest-region fallback допустим **только внутри recovery-попытки** (§8, п. 2) для смещения site
- Largest-ring fallback **запрещён** как финальный `fragmentContour`
- Если после всех recovery-попыток ячейка остаётся несвязной: `diagnosticCode = disconnectedCell`, placement invalid, `resultStatus = failedSolve`

### 3.9 desiredCutContour и cutContour

```
desiredCutContour_i = offset(voronoiCell_i, pieceSeamReserveMm)
validCut_i          = transformedPiece_i ⊇ desiredCutContour_i
cutContour_i        = desiredCutContour_i   // только при validCut_i = true
                    = []                     // при validCut_i = false
```

**Жёсткий запрет**: `cutContour_i ≠ offset(cell) ∩ piece`. Пересечение с piece допустимо **только в диагностическом оверлее** для показа недостающей области.

---

## 4. Power Diagram с PolygonWithHoles

### 4.1 Граница ячеек

```
|x - p_i|² - w_i = |x - p_j|² - w_j
→  2x·(p_j - p_i) = |p_j|² - w_j - |p_i|² + w_i
```

### 4.2 Построение ячейки — PolygonWithHoles обязателен

**Запрещено**: превращать `zoneRegion` в один внешний ring — holes теряются.

```
Для каждого site_i:
  clipRegion = zoneRegion  // PolygonWithHoles, holes сохранены
  для каждого site_j (j ≠ i):
    clipRegion = halfPlaneClip(clipRegion, halfplane(site_i, site_j, weight_i, weight_j))
  voronoiCell_i = clipRegion
```

`halfPlaneClip` работает с PolygonWithHoles, применяя Sutherland-Hodgman к внешнему ring **и** к каждому hole ring, затем пересекает результат с исходными holes.

**Обязательные тесты** при реализации:
- `fragmentContour` не попадает в `zoneHoles`
- `geometricCoverage = area(union(voronoiCell_i)) / zoneRegionArea` ≈ 1.0
- `union(voronoiCell_i) == zoneRegion` (с допуском `areaEpsilonPercent`)
- holes не заполняются фрагментами

### 4.3 Итеративная подстройка весов

```
инициализация: weight_i = 0

повторяем до maxWeightAdjustIterations (full) или maxWeightAdjustTrialIter (trial):
  cells = buildPowerDiagramCells(sites, weights, zoneRegion)   // PolygonWithHoles
  для каждой ячейки i:
    actualArea = area(cells_i)
    if actualArea < epsilonMm2:
      weight_i += largeStep
      site_i → centroid(largest component of zoneRegion)
    else:
      delta = targetArea_i - actualArea
      step = clamp(learningRate × delta, -maxWeightStep, +maxWeightStep)
      weight_i += step
  weights -= mean(weights)   // нормализация
  если все |actualArea_i - targetArea_i| < zoneRegionArea × areaEpsilonPercent / 100 → стоп
```

---

## 5. Stage 0 — Preflight

Preflight выполняется **до** Power Diagram. Если не находит реалистичного плана — возвращает `failedPreflight` без построения Вороного.

### 5.1 Scale check

```
if zoneRegionArea < options.minZoneAreaMm2 OR min(bboxW, bboxH) < options.minZoneBBoxMm:
  → failedPreflight: suspectedScaleError
```

### 5.2 Подготовка кусков

```
для каждого кандидата c:
  rawPts = parse(c.contourPoints)
  if |rawPts| < 3:               → reject: invalidContour

  centeredPts = rawPts - centroid(rawPts)
  coreLocal   = inset(centeredPts, pieceSeamReserveMm)
  if area(coreLocal) < 50:       → reject: tooSmallAfterInset

  minWidthApprox = min(bboxW(coreLocal), bboxH(coreLocal))
  if minWidthApprox < minWidthMm: → reject: belowMinWidth

  rawSU = mean(compactnessScore, bboxRatioScore, minWidthScore)  // §3.4
  if rawSU < 0.15:               → reject: shapeUnusable
  shapeUsability = clamp(rawSU, 0.15, 1.0)
  capacity = area(coreLocal) × shapeUsability

  if !napPreFilter(c.napDeg):    → reject: napIncompatible
  if !materialCompatible(c):     → reject: materialIncompatible
  if !c.available:               → reject: notAvailable

  usablePieces << { id, coreArea, capacity, shapeUsability, napDeg, coreLocal, ... }
```

### 5.3 Ранние выходы

```
if usablePieces.length == 0:
  → failedPreflight: no_usable_pieces

if Σ capacity_i < zoneRegionArea × safetyFactor:
  → failedPreflight: insufficientInventoryCapacity

Cmed  = median(capacity_i по usablePieces)
Nbase = ceil(zoneRegionArea / Cmed)

if Cmed < zoneRegionArea / (options.maxFragments || 200):
  → failedPreflight: piecesTooSmallForZone
```

### 5.4 Расчёт Nstart по fragmentCountMode

```
reserveFactor = options.reserveFactor || 1.25
Nstart_auto   = ceil(Nbase × reserveFactor)

switch fragmentCountMode:
  "auto":
    Nstart = min(Nstart_auto, usablePieces.length)

  "fixed":
    if options.fixedN > usablePieces.length:
      → failedPreflight: notEnoughPiecesForFixedN
    Nstart = options.fixedN

  "range":
    lo = options.minFragments || 1
    hi = options.maxFragments || usablePieces.length
    if usablePieces.length < lo:
      → failedPreflight: notEnoughPiecesForMinFragments
    Nstart = clamp(Nstart_auto, lo, min(hi, usablePieces.length))

  "targetArea":
    Nbase_t = ceil(zoneRegionArea / options.targetFragmentAreaMm2)
    Nstart  = min(ceil(Nbase_t × reserveFactor), usablePieces.length)
```

Молчаливое уменьшение `fixedN` **запрещено** — только явный `failedPreflight`.

### 5.5 Scored selection

```
targetCellArea = zoneRegionArea / Nstart

для каждого p ∈ usablePieces:
  ratio   = p.coreArea / targetCellArea
  areaFit = ratio >= 1
    ? clamp(1 - (ratio - 1) × 0.4, 0.1, 1.0)   // большой — мягкий штраф
    : clamp(ratio, 0.0, 1.0)                      // маленький — жёсткий штраф
  selScore = areaFit × 0.55 + p.shapeUsability × 0.45

отсортировать по selScore desc
selected = top Nstart кусков
```

**selected — стартовый план, не финальный результат**. Level 1 обязан при ошибках пробовать замену кусков, увеличение N, альтернативный состав (§7.1).

---

## 6. Stage 1 — Initial Plan (инициализация)

### 6.1 Инициализация sites — farthest-point sampling

**Запрещено**: сдвигать все невалидные grid-точки в одну `polylabel` — это скучивает sites.

```
1. Сгенерировать gridN×gridN поверх zoneBBox.
2. Оставить только точки внутри zoneRegion (вне holes).
3. Если valids < Nstart:
   Добрать недостающие sites методом farthest-point sampling:
     - выбирать точку внутри zoneRegion, максимально удалённую от уже помещённых sites
     - повторять пока |sites| < Nstart
4. Соблюдать minDistance = sqrt(zoneRegionArea / Nstart) × 0.5
5. Запрещено иметь два sites в одной точке.
```

Итог: `sites` = массив из Nstart точек, все внутри zoneRegion, без скучивания.

### 6.2 Инициализация весов

```
weights_i = 0   для всех i
```

### 6.3 targetArea

```
totalCap     = Σ capacity_j  (по selected)
targetArea_i = zoneRegionArea × capacity_i / totalCap
```

---

## 7. Алгоритм solve (три уровня)

### 7.1 Level 1 — Assignment (1–3% итераций)

- переменные: `pieceId_i`
- действия: замена куска / добавление gap-fill куска
- стоимость: пересчёт capacity, targetArea, Power Diagram

**Recovery через Level 1** (обязательно, не опционально):
```
if badPlacement или shapeCannotContainCell:
  заменить кусок i на следующий по selScore кандидат из usablePieces \ selected
  или увеличить N (если Nstart < usablePieces.length)
  или запустить gap-fill (§9)
```

### 7.2 Level 2 — Territory (8–18% итераций)

- переменные: `siteX_i, siteY_i, weight_i`
- действия: изменение генератора или веса ячейки
- стоимость: полный пересчёт Power Diagram (PolygonWithHoles)

### 7.3 Level 3 — Placement (80–90% итераций)

- переменные: `tx_i, ty_i, rotDeg_i`
- действия: физическое размещение куска
- стоимость: только containment-проверка
- rotation: **только из `rotationCandidates_i`** (§3.3), не произвольный угол
- попыток: до `maxLevel3AttemptsPerCell`

### 7.4 Связь site ↔ transform

```
siteAnchorPenalty_i    = dist(site_i, transformedAnchor_i)²
siteOutsideCellPenalty = большой штраф, если site_i ∉ voronoiCell_i
```

### 7.5 Целевая функция

```
E = Σ_i [
  w_containment × physicalMissing_i
  + w_cutCheck  × area(diff(desiredCutContour_i, transformedPiece_i))
  + w_area      × |area(voronoiCell_i) - targetArea_i|
  + w_anchor    × siteAnchorPenalty_i
  + w_siteCell  × siteOutsideCellPenalty_i
  + w_nap       × napViolationPenalty_i    // soft во время поиска
  + w_shape     × badShapeCellPenalty_i
  + w_disconnect × disconnectedCellPenalty_i
] + w_empty × Σ_i emptyCellPenalty_i

physicalMissing_i = area(diff(voronoiCell_i, transformedCore_i))
```

Веса: `w_containment >> w_cutCheck >> w_area > остальные`.

---

## 8. Stage 2 — Solve Recovery

Solver исправляет ошибки **в порядке приоритета**:

| Приоритет | Код | Условие | Recovery |
|---|---|---|---|
| 1 | `emptyCell` | area(cell) ≈ 0 | двигать site внутрь zoneRegion; увеличить weight |
| 2 | `disconnectedCell` | MultiPolygon после recovery | 1) сдвинуть site к centroid largest-component; 2) уменьшить weight на 20%; 3) добавить вспомогательный ограничитель; если не помогло → `unresolvedGap` |
| 3 | `pieceTooSmall` | `coreArea_i < cellArea_i` | Level 2: уменьшить вес ячейки; Level 1: добавить site (gap-fill) |
| 4 | `shapeCannotContainCell` | `coreArea_i ≥ cellArea_i` AND `physicalMissing > ε` | Level 2: перестроить territory; Level 1: заменить кусок |
| 5 | `badPlacement` | Level 3 не нашёл (tx,ty,rot) за maxLevel3AttemptsPerCell | +попытки Level 3; если нет → Level 1: заменить кусок |
| 6 | `napViolation` | нет допустимого rotDeg | Level 1: заменить кусок на napCompatible |
| 7 | `cutContourOutsidePiece` | piece ⊅ cutContour | Level 3: лучший tx/ty; Level 1: заменить кусок |

Каждая ячейка: до `maxRecoveryAttemptsPerCell` попыток recovery в порядке приоритетов.

---

## 9. Gap-fill

### 9.1 Когда запускается

Gap-fill запускается при **любом провале финальных инвариантов**:

```
invalidCells = cells где хотя бы один инвариант нарушен:
  - physicalMissing_i > epsilonMm2
  - cutContourOutsidePiece
  - napViolation
  - disconnectedCell (после recovery)
  - badPlacement (Level 3 исчерпан)
  - shapeCannotContainCell
```

### 9.2 candidatePool

```
candidatePool = usablePieces \ selected
  фильтр: shapeUsability > 0.2
          area(coreLocal) >= minGapFillAreaMm2
  limit: maxGapFillCandidates
```

Если `candidatePool.length == 0` → gap-fill невозможен; вывести в Monitor.

### 9.3 Алгоритм

```
для каждой invalidCell_i:
  для candidate в candidatePool (до maxGapFillAttempts суммарно):
    добавить site рядом с centroid(invalidCell_i)
    пересчитать Power Diagram (PolygonWithHoles) по zoneRegion
    Level 3 для затронутых ячеек
    если все финальные инварианты PASS → принять
    иначе → откатить, записать rejectReason, следующий candidate

  если candidate не найден → unresolvedGap
```

### 9.4 Обязательная диагностика gap-fill

```
gapFillCandidatePoolCount
gapFillAttempts
gapFillAcceptedCount
gapFillRejectReasons:
  materialIncompatible, napIncompatible, tooSmallAfterInset, shapeUnusable,
  belowMinWidth, cannotContainCell, cutContourOutsidePiece, badPlacement,
  disconnectedAfterInsert, worsensOtherCells
```

---

## 10. Post-opt — Remove-one

После первого solve, где **все финальные инварианты pass**:

```
попытки: до maxRemoveOneAttempts (default: Nstart × 2)
ri = selected.length - 1  // удалять с наименьшим selScore первым

пока ri >= 0 AND |selected| > 1 AND время позволяет:
  trySelected = selected \ {selected[ri]}

  // Быстрый pre-check: отсеять заведомо плохие попытки
  для каждого j in trySelected:
    если trySelected[j].coreArea < estimatedCellArea_j × 0.9:
      ri--; continue

  // Полный solve для trySelected:
  1. initSites(trySelected)
  2. adjustWeightsToTargetAreas(maxWeightAdjustIterations)
  3. Level 3 placement (maxLevel3AttemptsPerCell)
  4. проверить все финальные инварианты (§11)

  если все инварианты PASS:
    selected = trySelected
    removedPiecesCount++
    ri = min(ri, selected.length - 1)  // не сдвигаться ниже нового конца
  else:
    ri--
```

**Remove-one принимается только после полного solve + validation**. Быстрая площадная проверка `coreArea >= cellArea × 0.9` — только pre-check для экономии времени, не критерий принятия.

---

## 11. Coverage — два слоя

```
geometricCoverage = area(union(voronoiCell_i)) / zoneRegionArea
physicalMissing_total = Σ area(diff(voronoiCell_i, transformedCore_i))
physicalCoverage  = (zoneRegionArea - physicalMissing_total) / zoneRegionArea
```

В выходных данных **оба поля обязательны**:
- `geometricPartitionCoveragePercent` — ≈100% при правильно работающем Power Diagram
- `physicalCoveragePercent` — реальная метрика качества

---

## 12. Финальные инварианты

```
1.  area(diff(zoneRegion, union(voronoiCell_i)))     ≤ zoneRegionArea × areaEpsilonPercent / 100
2.  area(intersect(voronoiCell_i, voronoiCell_j))    ≤ epsilonMm2
3.  fragmentContour_i = voronoiCell_i (связный polygon, не MultiPolygon)
4.  fragmentId_i ↔ scrapPieceId_i заполнен
5.  physicalMissing_i                                ≤ epsilonMm2
6.  area(diff(desiredCutContour_i, transformedPiece_i)) ≤ epsilonMm2
7.  napValid(rotDeg_i) = true
8.  flip_i = false, mirror_i = false
9.  area(cutContour_i)                               > 0
10. disconnectedCell_i = false
11. geometricCoverage                                ≥ 1 - areaEpsilonPercent / 100
```

---

## 13. Stage 3 — Result Gating

### 13.1 resultStatus

```
ok           = все инварианты 1–11 pass
failedPreflight = Preflight вернул ранний выход до запуска Вороного
failedSolve  = solve завершён, но хотя бы один из инвариантов 1–11 не pass
```

**`failedSolve` ставится при провале ЛЮБОГО финального инварианта** — не только 5/6/7/10.

```ts
canApply = (resultStatus === "ok")
```

`partial` **не является финальным статусом**. Он допустим только как внутренняя отладочная метка во время solve, не в выходных данных.

### 13.2 Запрет applied layout при canApply = false

```
Если canApply = false:
  - не создавать рабочий LayoutRun
  - не обновлять applied fragments
  - не запускать export / spec / report
  - на холсте показывать только debugPreview с явной пометкой "failedPreflight" / "failedSolve"
  - кнопка Apply заблокирована
```

Diagnostic-слои не должны выглядеть как готовая выкладка.

### 13.3 Выходной формат

```ts
interface VoronoiSaResult {
  ok: boolean
  layoutType: "inventory_voronoi_sa"
  resultStatus: "ok" | "failedPreflight" | "failedSolve"
  canApply: boolean
  failReason?: string

  placements: VoronoiPlacement[]
  unresolvedGaps: UnresolvedGap[]
  diagnostics: DiagnosticEntry[]

  stats: {
    // Preflight
    zoneRegionArea: number          // единственное имя рабочей площади
    zoneOuterArea: number
    zoneHolesArea: number
    zoneBBoxMm: string              // "W×H"
    scalePxPerMm?: number
    medianCapacity: number          // Cmed
    nBase: number
    reserveFactor: number
    nStart: number
    targetCellArea: number
    fragMode: string
    totalScrapPiecesInput: number
    totalUsablePieces: number
    rejectedPiecesCount: number
    selectedPiecesCount: number     // = Nstart
    removedPiecesCount: number
    finalFragmentsCount: number

    // Coverage
    geometricPartitionCoveragePercent: number
    physicalCoveragePercent: number
    physicalMissingTotalMm2: number
    fragmentsTotal: number
    gapFillFragments: number
    unresolvedGapAreaMm2: number

    // Gap-fill
    gapFillCandidatePoolCount: number
    gapFillAttempts: number
    gapFillAcceptedCount: number
    gapFillRejectReasons: Record<string, number>

    // Параметры
    pieceSeamReserveMm: number
    pieceSeamReserveMmSource: "material" | "options" | "default"
    minWidthMm: number
    minWidthMmSource: "material" | "options" | "default"
    napToleranceDeg: number
  }

  selectionDebug: {
    selectedPieces: Array<{
      id, tag, coreArea, capacity, shapeUsability, rawShapeUsability,
      areaFit, selScore, targetArea,
      site: {x, y}, weight,
      rotationCandidatesCount,
      removedByPostOpt: boolean
    }>
    prepareRejected: Array<{ id, reason, detail? }>
    unselectedUsablePieces: Array<{ id, tag, capacity, coreArea, selScore }>
  }

  fragmentDiag?: Array<{       // для каждого фрагмента
    fragmentId, scrapPieceId,
    selectedRotDeg, napDiffDeg,
    cellAreaMm2, coreAreaMm2,
    physicalMissingMm2,
    diagnosticCode
  }>
}

interface VoronoiPlacement {
  fragmentId: string
  scrapPieceId: string
  inventoryTag: string
  fragmentContour: Point[]     // = voronoiCell, всегда связный polygon
  cutContour: Point[]          // = offset(cell, reserve), только если validCut = true
  alignedContour: Point[]
  inZoneCoreContour: Point[]
  sitePoint: Point
  tx: number
  ty: number
  rotDeg: number
  isGapFill: boolean
  diagnosticCode?: string
}
```

### 13.4 Renderer

| Слой | Источник | Условие |
|------|---------|---------|
| **фрагмент** | `fragmentContour` (= voronoiCell) | всегда |
| **крой** | `cutContour` | только при `validCut = true` |
| **physicalMissing** | `diff(cell, core)` | только debug-оверлей |
| `alignedContour` | весь кусок | только при включённом оверлее |
| `inZoneCoreContour` | `core ∩ cell` | только при включённом оверлее |

При `canApply = false`: только debug-превью с явной пометкой `failedPreflight` / `failedSolve`. Никакой отрисовки как applied layout.

---

## 14. Диагностические коды

| Код | Условие |
|-----|---------|
| `pieceTooSmall` | `coreArea_i < cellArea_i` |
| `shapeCannotContainCell` | `coreArea_i ≥ cellArea_i` AND `physicalMissing_i > ε` |
| `badCellShape` | ячейка слишком узкая/вытянутая (независимо от площади) |
| `badPlacement` | Level 3 исчерпан, допустимый (tx,ty,rot) не найден |
| `napViolation` | нет допустимого rotDeg для финального placement |
| `emptyCell` | `area(voronoiCell_i) < epsilonMm2` |
| `disconnectedCell` | MultiPolygon после recovery, largest-ring fallback запрещён |
| `cutContourOutsidePiece` | `piece ⊅ desiredCutContour` |
| `unresolvedGap` | gap-fill не закрыл ячейку |
| `tooSmallAfterInset` | `area(coreLocal) < 50 мм²` |
| `shapeUnusable` | `rawShapeUsability < 0.15` |
| `napIncompatible` | нет rotDeg при котором napValid |
| `belowMinWidth` | `minWidthApprox < minWidthMm` |
| `materialIncompatible` | materialId не совместим с zoneMaterialId |
| `suspectedScaleError` | zoneRegionArea или bbox ниже порога |
| `notEnoughPiecesForFixedN` | `fixedN > usablePieces.length` |
| `notEnoughPiecesForMinFragments` | `usablePieces.length < minFragments` |
| `piecesTooSmallForZone` | `Cmed < zoneRegionArea / maxFragments` |
| `insufficientInventoryCapacity` | `Σ capacity < zoneRegionArea × safetyFactor` |
| `no_usable_pieces` | usablePieces пуст после фильтрации |

---

## 15. Monitor (обязательные блоки)

**Preflight блок**:
```
status / failReason
zoneRegionArea / zoneOuterArea / zoneHolesArea / zoneBBoxMm / scalePxPerMm
totalScrapPiecesInput / totalUsablePieces / rejectedPiecesCount / rejectReasons
Cmed / Nbase / reserveFactor / Nstart / fragmentCountMode / targetCellArea
```

**Solve блок**:
```
geometricPartitionCoveragePercent / physicalCoveragePercent
finalFragmentsCount / removedPiecesCount
invalidFragmentsCount / failedInvariants
gapFillAttempts / gapFillAcceptedCount / gapFillRejectReasons
canApply
```

**Параметры**:
```
pieceSeamReserveMm + source / minWidthMm + source / napToleranceDeg
```

---

## 16. Порядок реализации

1. `buildPowerDiagramCells` с PolygonWithHoles + тесты §4.2
2. `adjustWeightsToTargetAreas`
3. Preflight: `computeCore`, `computeRawShapeUsability`, reject по rawSU, Nbase/Nstart, failedPreflight коды
4. Stage 1: `initSitesWithFarthestPointSampling` (§6.1)
5. Scored selection (§5.5)
6. Containment check: `physicalMissing_i`, `shapeCannotContainCell` (§3.4)
7. Cut check: `diff(desiredCutContour, piece)`
8. Level 3 placement (только `rotationCandidates_i`)
9. Stage 2 Recovery table (§8), все 7 приоритетов
10. Gap-fill по всем инвариантам (§9)
11. Post-opt Remove-one с полным solve + validation (§10)
12. Stage 3 Result Gating, `failedSolve` по всем инвариантам (§13)
13. Monitor блоки Preflight + Solve (§15)

---

## 17. Что не меняется

`mosaicMode = true` — декоративный режим без привязки к инвентарю. Данный контракт его не затрагивает.
