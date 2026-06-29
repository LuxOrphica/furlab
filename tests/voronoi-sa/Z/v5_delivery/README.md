# FurLab voronoi_sa v5.0 — delivery

## Что внутри

### Изменённые файлы (8 шт.)
Путь в твоём проекте: `furlab/furlab-web-plugin/src/...`

1. `services/solvers/voronoi_sa_solver.js` — P0: убран fallback ядра к полному контуру
2. `services/solvers/voronoi_sa_raster.js` — P3: партиция по накрытию ядром (R2)
3. `services/solvers/voronoi_sa_annealing.js` — P6: ROTATE отключён (R6)
4. `services/solvers/voronoi_sa_result.js` — P9: 4 статуса + 4 прокси эстетики
5. `services/solvers/voronoi_sa_coverage.js` — P8: честные метрики interior/edge
6. `services/solvers/voronoi_sa_postprocess.js` — P7: absorb с guard'ами R8
7. `services/solvers/voronoi_sa_search.js` — warm start (ОТКАТ, TODO v5.1)
8. `modes/inventory_voronoi_sa/index.js` — P5: SA по умолчанию

### Новые файлы
- `furlab-web-plugin/scripts/run_voronoi_sa.js` — harness для локального прогона
- `docs/layouts/inventory_voronoi_sa_contract_v5.md` — контракт v5.0
- `voronoi_sa_v5_overview.png` — схема-обзор v5.0
- `voronoi_sa_algorithm_schema.png` — схема багов v4
- `sweep_summary.py` — скрипт сводки сид-свипа

## Как применить

1. Распакуй этот архив в корень твоего furlab-репозитория (поверх существующих файлов).
2. Убедись, что npm-зависимости установлены: `cd furlab-web-plugin && npm install`
3. Прогон: `node scripts/run_voronoi_sa.js ../tests/voronoi-sa/oracle_case_zone_4_1781289061755.json --seed 1 --out run.json`
4. Проверка: `python3 ../tests/voronoi-sa/РобертТестер/verify_voronoi_sa.py run.json`

## Результаты сид-свипа (15 прогонов)

- Zone 4 (10 seed'ов): 6 PASS, 4 FAIL (все insufficient_input — краевая нехватка)
- Zone 6 (5 seed'ов): 4 PASS, 1 FAIL
- Все 15: R2/R3/R5/R6/R9 PASS во всех
- Coverage: zone_4 95.4-98.7%, zone_6 91.9-98.3%

## TODO v5.1

1. Подбор кусков по форме (fitness-based ADD в SA, не warm start)
2. Pre-flight горл < 70
3. Insufficient_inventory диагностика (отличать от failed)
4. Эстетика — штраф за тонкие фрагменты в SA-энергии (сейчас 0% pass из-за доли языков)
5. Прямота швов (4-й прокси)
6. Обновить верификатор под v5.0
