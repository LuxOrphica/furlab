# Сводка для нового агента: FurLab inventory_voronoi_sa v5.1

## Контекст проекта

**FurLab** — система цифрового проектирования меховых изделий (PhD тема, РГУ им. Косыгина). Солвер `inventory_voronoi_sa` размещает скрап-куски меха (обрезки) в зону методом Simulated Annealing + restricted Voronoi. Цель — покрыть зону на ~100% с эстетикой швов Вороного, припуск на шов 12 мм, мин. кусок 70×70 мм.

**Репозиторий:** https://github.com/LuxOrphica/furlab
- `furlab-web-plugin/` — Node.js backend (solver, server.js, modes)
- `furlab-access/` — Microsoft Access DB (VBA, хранение скрапов)
- `docs/layouts/inventory_voronoi_sa_contract_v5.md` — контракт v5 ( authoritative)

**Пользователь:** разработчик FurLab, ценит честное framing, не терпит приукрашивания. Русский основной.

## Архитектура solver

```
server.js (HTTP /api/layout/modes/preview)
  → modes/inventory_voronoi_sa/index.js (previewWrapper)
    → voronoi_sa_solver.js (solve)
      → voronoi_sa_search.js (SA loop: ADD/SWAP/TRANSLATE/ROTATE/REMOVE moves)
      → voronoi_sa_polygonal.js (buildPolygonalTerritoryOutput — power Voronoi)
      → voronoi_sa_postprocess.js (runInitialPostprocess — absorb, dissolve)
      → voronoi_sa_result.js (formatResult — инварианты, статусы)
      → voronoi_sa_diagnostics.js (computeResultInvariants — INV1/INV5/R5)
```

## Контракт v5 (ключевые правила)

Из `docs/layouts/inventory_voronoi_sa_contract_v5.md`:

- **§6**: `napTarget` / `napTolDeg` / `angleDeg` — **вестигиальные**, не трактовать как живые ограничения. **Вращение запрещено (R6)**.
- **§7**: thin fragment = failed (R5), **НЕ absorb'ится**.
- **§7**: absorb без guard'ов запрещён (R8).
- **§7**: возврат последнего состояния вместо лучшего — запрещён.
- **fragment = core_i ∩ territory_i**, полигонально (не растрово).
- **Ядро = тело** (при allowanceMm=0). `alignedContour` — только для рендера.

## Что сделано в этой сессии (v5.1)

### 1. `voronoi_sa_polygonal.js` — переписан

**Было (v5.0):**
- R2 partition-gap fix (стр. 514-603) — брал `residual = zone − Union(fragments)` и раздавал компоненты тому ядру, что накрывает centroid. Это был **скрытый absorb**, нарушающий R5/R8. Создавал overlap (INV1/INV5 FAIL).
- `clipperUnion` в inner j-loop — O(N²) по вершинам.

**Стало (v5.1):**
- R2 partition-gap fix **УБРАН**. Gap = physMissing, честно. Если SA не нашёл покрытие — это результат SA, не polygonal.
- `clipperUnion` → `clipperClean` (CleanPolygons + SimplifyPolygons) в inner j-loop. O(N). Корректно, т.к. `withoutContested` и `contestedKept` — оба подмножества `currentPaths`, соприкасаются по границе, не перекрываются по площади.
- `rawTerritoryContour` = наибольший компонент territory.
- Убрана неиспользуемая `clipperUnion` функция.
- Никакого 30-секундного deadline — функция отрабатывает за ~20ms на N=22.

### 2. `voronoi_sa_diagnostics.js` — добавлен R5 thin classifier

`computeResultInvariants` теперь принимает `minWidthMm`, `minLengthMm` и генерирует `R5_FAIL` warning если есть thin fragments:
- `status === "thin_fragment"` → thin
- `status === "under_threshold"` || `phase === "under_threshold"` → thin (dissolved в postprocess)
- MBR shorter side (rotating calipers) < `minWidthMm - 0.5` → thin
- MBR longer side < `minLengthMm - 0.5` → thin

### 3. `voronoi_sa_result.js` — 1 правка

Передача `minWidthMm, minLengthMm` в `computeResultInvariants({...})` (стр. ~380). `result.js:399` уже проверяет `r5Fail = invWarnings.some(w => /^R5_/.test(w))` — теперь сработает.

## Тесты (oracle_case_zone_1, 3 seeds)

| seed | coverage | status | plc | inv_warn | R5 |
|---|---|---|---|---|---|
| 1111111 | 97.595% | failed | 27 | 1 | 5 sub-min |
| 1777777 | 98.747% | failed | 23 | 1 | 3 sub-min |
| 8888888 | 95.131% | failed | 23 | 3 | 1 sub-min |

- **R5 работает**: все 3 seeds корректно `failed` из-за thin fragments (раньше маскировались как `ok`/`partial`)
- **Детерминизм**: seed 1777777 run twice → cov=98.747068, plc=23, iters=17311, same IDs. PASS
- **Overlap ушёл**: 0 INV1/INV5 warnings на 2/3 seeds (на 1 — минорный 131 mm² от постпроцесса)

## Что НЕ сделано (открытые задачи)

### R6: вращение кусков — БАГ, не починен

Контракт §6/§7: вращение запрещено. Но `voronoi_sa_search.js` крутит:
- **ADD move (стр. 576):** `const angle = normalizeDeg(napTarget - newPiece.napDeg);`
- **SWAP move (стр. 537):** то же
- **ROTATE move (стр. 522-532):** крутит ±10° случайно

В UI runs `angleDeg` от 6.49° до 342.84° — куски повёрнуты. Пользователь сказал "пока не делай" — оставлено.

### UI vs harness расхождение — НЕ разрешено

На тех же данных/seed/коде:
- **UI**: 89 iters/sec, timeout на 5727 iter, covF 93.7%
- **harness**: 243 iters/sec, add_loop exit на 17801 iter, covF 99.9%

Проверено: onProgress/SSE не влияет, server.js окружение не влияет, solver детерминирован. Причина UI замедления **не найдена**. Возможные причины: параллельные запросы, Access DB connection, другой Node.js version.

### Multistart — не реализован

Variance SA по seed: 93.7% до 99.6% на zone_1. Нужен multistart с полным бюджетом на каждый seed (не деление бюджета — HANDOFF предупреждает).

## Файлы (где что)

- `/home/z/my-project/download/v51_files/voronoi_sa_polygonal.js` — v5.1 (заменить полностью)
- `/home/z/my-project/download/v51_files/voronoi_sa_diagnostics.js` — v5.1 (заменить полностью)
- `/home/z/my-project/download/v51_files/PATCH_voronoi_sa_result.js.txt` — инструкция (2 строки добавить)
- `/home/z/my-project/worklog.md` — полный лог сессии

## Команды для теста

```bash
cd furlab/furlab-web-plugin
npm install  # если ещё не установлен

# Прогон на zone_1 oracle case
node scripts/run_voronoi_sa.js oracle_case_zone_1_1772731193542.json \
  --seed 1777777 --max-solve-ms 60000 --max-iter 20000 \
  --out /tmp/test_v51.json

# Должно дать: cov ~98.7%, status=failed (R5), 23 plc, 0 overlap warnings
```

## Правила работы

1. **Не верить метрикам на слово** — пересчитывать pyclipper'ом (scale=1000)
2. **Каноническая метрика**: `area(Union(inZoneContour) ∩ zone) / zoneArea`
3. **Тройная сверка**: UI = harness = независимый pyclipper
4. **Не вводить оптимистичные версии метрики**
5. **HANDOFF.md** (`tests/voronoi-sa/voronoi_sa_HANDOFF.md`) — устарел, описывает старый растровый путь с absorption. Опираться на актуальный код v5.1 и контракт.
6. **Скрипты сохранять** в `/home/z/my-project/scripts/`, артефакты в `/home/z/my-project/download/`
7. **Worklog** — append-only, формат по Task ID

## Что делать дальше (приоритеты)

1. **Применить v5.1 правки** к репо (3 файла) — пользователь должен скопировать и закоммитить
2. **R6 фикс** — убрать вращение из ADD/SWAP/ROTATE в `voronoi_sa_search.js` (когда пользователь разрешит)
3. **Multistart** с полным бюджетом на seed
4. **Воспроизвести UI 89 iters/sec** в harness — нужен доступ к UI окружению
