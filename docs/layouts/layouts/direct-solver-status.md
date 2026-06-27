# Direct Solver Test Status

Дата фиксации: 2026-05-21.

## Статус

`inventory_direct` / `cover_grid_solver.js` считается experimental. Текущие автоматические тесты подтверждают, что API, контракты, golden snapshot и timeout-защита работают стабильно, но не подтверждают, что direct solver дает производственно пригодную автоматическую раскладку.

Это согласовано с продуктовой документацией:

- `F:\FURLAB\dev\docs\geometry-kernel.md`: в разделе "Известные проблемы" указано, что `cover_grid_solver.js` не дает корректных результатов и находится в разработке.
- `F:\FURLAB\dev\docs\solver.md`: текущий greedy/grid подход описан как ограниченный; документ фиксирует типичный провал на неудобных остатках и предлагает следующий класс решения через simulated annealing / global optimization.

## Что Сейчас Проверяют Тесты

`npm run test:suite` проверяет:

- encoding/mojibake/i18n/repo hygiene;
- oxlint error gate;
- unit/property tests;
- runtime contracts and invariants;
- golden snapshots;
- server smoke;
- timeout boundary for heavy direct solver calls.

Для `inventory_direct` это означает:

- запрос не должен падать HTTP 500;
- ответ должен иметь ожидаемую структуру;
- результат должен быть воспроизводимым на baseline;
- тяжелый кейс должен завершаться в пределах hard timeout;
- `failed` result status является допустимым и ожидаемым состоянием для текущего experimental solver.

## Что Тесты Пока Не Доказывают

Текущий набор НЕ доказывает:

- full coverage для произвольной зоны;
- отсутствие плохих остаточных областей;
- оптимальное или близкое к ручному число кусков;
- производственное качество automatic nesting;
- что `golden:inventory-direct` означает успешную раскладку.

Сейчас `tests/baselines/inventory_direct_golden.json` намеренно фиксирует experimental baseline:

- `resultStatus: "failed"`;
- `failedReason: "zone_not_fully_covered"`;
- `fullCoverageOk: false`.

## Интерпретация Результатов

Если `npm run test:suite` показывает `passed`, это означает:

> тестовый контур и текущие контракты не сломаны.

Это не означает:

> direct solver готов к производственному использованию.

Если `golden:inventory-direct` проходит, это означает:

> текущий experimental результат не изменился неожиданно.

Это не означает:

> solver нашел качественную раскладку.

## Следующий Нужный Слой Тестов

Перед большой переработкой solver нужно добавить отдельный quality layer:

1. `tests/solver-cases/` или `tests/cases/solver-quality/` с реальными проблемными зонами и инвентарем.
2. Метрики по каждому кейсу:
   - `coveragePercent`;
   - `fullCoverageOk`;
   - `residualAreaMm2`;
   - количество placement-ов;
   - overlap/outside area;
   - timeout/runtime.
3. Quality gate отдельно от `test:suite`, например:
   - `npm run test:solver-quality`
   - сначала advisory/non-blocking;
   - после стабилизации direct solver сделать blocking.
4. Golden/report snapshot для качества:
   - baseline текущего плохого поведения;
   - отдельный target baseline для ожидаемого поведения.

## План Исправления

1. Не чистить `inventory_direct_solver.js` механически ради oxlint, пока solver experimental.
2. Сначала зафиксировать диагностические кейсы и метрики.
3. Разделить regression tests и quality tests:
   - regression: "ответ стабилен и сервер не падает";
   - quality: "solver реально улучшает покрытие и остатки".
4. После этого двигать алгоритм:
   - residual-aware подбор;
   - best-so-far contract;
   - затем warm start + simulated annealing или другой global optimization слой.
