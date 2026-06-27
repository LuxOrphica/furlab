# FurLab - Режим выкладки: Inventory Split & Return (Prototype)
## Контракт v0.3 (approved-ready)

## 0. Назначение
Режим `inventory_split_return` выполняет выкладку из инвентаря с частичным использованием куска:
- в покрытие идет только полезная видимая часть;
- неиспользованный остаток автоматически возвращается в пул кандидатов в рамках текущего прогона.

Ограничения v0.3:
- без записи в БД;
- split-остатки существуют только в памяти текущего solve и в trace/экспорте.

## 1. Термины
- `Z` - зона выкладки.
- `P` - контур куска инвентаря (локальные координаты).
- `T` - трансформация (`rotation + translation`), `flip/mirror` запрещены.
- `PfullZ = T(P) ∩ Z` - часть куска внутри зоны.
- `Covered C` - уже покрытая область зоны.
- `Gain G = PfullZ \ C` - полезный прирост покрытия на текущем шаге.
- `Leftover L = P \ T^-1(G)` - остаток исходного куска после вычитания полезной части.

## 2. Ключевое правило слоев (MUST)
Фиксированная политика стека: `firstOnTop`.

Следствия:
- ранние размещения считаются верхними (видимыми);
- поздние размещения добавляют покрытие только там, где зона еще не покрыта;
- покрытие всегда растет только за счет `G`, не за счет полного `PfullZ`.

## 3. Входные параметры режима
Обязательные:
- `maxSolveMs`
- `maxPieces`
- `coverageEps` (по умолчанию `0.002`)
- `minVisibleFragmentAreaMm2`
- `minVisibleFragmentSpanMm`
- `minLeftoverAreaMm2`
- `minLeftoverSpanMm`
- `tailOversizeGuard`:
  - `enabled: boolean`
  - `kAreaRatio: number` (по умолчанию `4.0`)
  - `tailMinGainMm2: number` (по умолчанию = `minVisibleFragmentAreaMm2`)

Фильтры БД:
- `materialId`, `statuses`, `onlyAvailable`, и др. по текущему пайплайну.

## 4. Алгоритм
### 4.1 Инициализация
1. Загрузить `Z`.
2. Загрузить кандидатов.
3. Для каждого кандидата подготовить `P`, `area`, `bbox`.
4. Инициализировать:
   - `C = ∅`
   - `Pool = candidates`.

### 4.2 Основной цикл
На каждой итерации:
1. `R = Z \ C`; выбрать крупнейший карман `R`.
2. Сгенерировать anchors (граница, центроид, глубокие точки).
3. Перебрать размещения: `candidate × anchor × rotation × local shifts`.
4. Для каждого размещения:
   - `PfullZ = T(P) ∩ Z`
   - `G = PfullZ \ C`
   - reject если:
     - `area(G) < minVisibleFragmentAreaMm2`
     - `span(G) < minVisibleFragmentSpanMm`
     - oversize-tail: `area(PfullZ) > kAreaRatio * area(G)` и `area(G) < tailMinGainMm2`
5. Score (эвристика шага):
   - `score = area(G) - wOutside * outside - wOverlap * overlap - wOversize * oversizePenalty`
   - `overlap = area(PfullZ) - area(G)`
   - `outside = area(T(P)) - area(PfullZ)`
6. Принять лучший валидный вариант.
7. Обновить покрытие: `C := C ∪ G`.
8. Split & Return:
   - `UsedLocal = T^-1(G)`
   - `LeftoverLocal = P \ UsedLocal`
   - для каждой компоненты `Li`, если проходит пороги площади/спана, создать derived-кандидат и добавить в `Pool`;
   - исходный кандидат пометить `consumed`.

### 4.3 Завершение
Успех:
- `coveredRatio >= 1 - coverageEps`.

Неуспех:
- `time_budget_exceeded` или `exhaustive_no_gain`.

`exhaustive_no_gain` означает, что поиск действительно исчерпал валидные варианты (полный проход candidate × anchor × rotation × local shifts без приемлемого `gain`).

## 5. Выходные данные
`placements[]`:
- `candidateKey`, `inventoryTag`
- `candidateType: original | derived`
- `transform { rotationDeg, offsetX, offsetY }`
- `pfullZContours`
- `usedVisibleContours` (`G`) - обязательно
- `gainAreaMm2`, `overlapAreaMm2`, `outsideAreaMm2`
- `solveIndex`, `renderIndex`

`summary`:
- `coveragePercent`
- `coveredRatio`
- `residualAreaMm2`
- `fullCoverageOk`
- `piecesCount`

`splitEvents[]`:
- `parentCandidateKey`
- `usedLocalContours`
- `leftoverContoursLocal`
- `derivedCandidateKeys`

`algorithmTrace`:
- счетчики reject (`lowGain`, `oversize`, `noFit`, ...)
- лог принятых размещений
- `stopReason`.

## 6. Инварианты (MUST, проверяются автотестом)
1. `Covered_{k+1} ⊇ Covered_k` (монотонный рост покрытия).
2. `G_k ∩ Covered_k = ∅` (новый gain не включает уже покрытое).
3. `LeftoverLocal ∩ UsedLocal = ∅`.
4. `flip/mirror` запрещен на всех шагах.
5. При одинаковом входе + seed результат детерминирован.

## 7. Детерминизм
Обязательный порядок:
- кандидаты: стабильная сортировка по `candidateKey`;
- anchors: стабильная сортировка `(distanceToPocketCenter, x, y)`;
- rotations: фиксированный список;
- tie-break:
  1) больший `gain`,
  2) меньший `area(PfullZ)`,
  3) меньший `candidateKey`,
  4) меньший `rotationDeg`,
  5) меньший `anchorIndex`.

Для формирования `derivedCandidateKey` компоненты leftovers сортируются стабильно по:
1) `area` по убыванию,
2) `centroid.x` по возрастанию,
3) `centroid.y` по возрастанию.

## 8. Идентификация derived-кандидатов
Формат:
- `derivedCandidateKey = "{parentKey}#g{generation}#s{splitIndex}"`.

Где:
- `generation` начинается с `1`,
- `splitIndex` вычисляется из стабильной сортировки компонентов leftovers (см. раздел 7).

## 9. Визуализация UI
Для выбранного размещения показывать одновременно:
- `PfullZ` (контур исходного куска в зоне);
- `G` (использованная/видимая часть).

`renderIndex` обязан соответствовать политике `firstOnTop` (а не быть произвольным индексом).

## 10. Область v0.3 (что не входит)
- нет записи в БД;
- нет объединения остатков разных родительских кусков;
- нет ручного редактирования split-остатков.

## 11. Acceptance (гейт согласования)
Минимальные критерии:
1. На overlap-кейсе покрытие растет только по `G`.
2. После split исходный кандидат не переиспользуется.
3. Обязательно на `synthetic_reuse_required`: `derivedCreated > 0` и `derivedUsed > 0`.
4. Желательно минимум на одном oracle-кейсе: `derivedUsed > 0`.
5. JSON-regression кейсы проходят детерминированно при фиксированном seed.

## 12. Набор регрессионных JSON-кейсов
Обязательные:
1. `overlap_only_visible_gain`
2. `split_into_two_leftovers`
3. `tail_oversize_guard`
4. `synthetic_reuse_required`

---
Статус: `READY_FOR_APPROVAL`.
Версия: `v0.3 (approved-ready)`.
