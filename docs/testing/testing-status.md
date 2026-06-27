# FurLab — статус тестов и direct solver

Дата фиксации: 2026-05-21.

## Главный вывод

Текущий набор тестов FurLab подтверждает стабильность инфраструктуры, контрактов, snapshot-ов и timeout-защиты. Он не подтверждает, что `Inventory Direct` / direct solver уже дает производственно пригодную автоматическую раскладку.

`inventory_direct` считается experimental до появления отдельного quality gate по solver-метрикам.

## Что Уже Проверяется

В `furlab-web-plugin` текущий основной прогон:

```bash
npm run test:suite
```

Проверяет:

- encoding / mojibake / i18n;
- repo hygiene;
- oxlint error gate;
- unit/property tests;
- runtime contracts and invariants;
- golden snapshots;
- server smoke;
- timeout boundary для тяжелых direct solver запросов.

Ожидаемый результат на 2026-05-21:

```text
11 passed, 4 skipped
```

Unit/property слой:

```bash
npm run test:unit
```

Ожидаемый результат:

```text
200 passed
```

## Как Читать `golden:inventory-direct`

`golden:inventory-direct` — это experimental regression baseline.

Он проверяет:

- ответ API стабилен;
- структура ответа не сломалась;
- timeout и wrapper-контракты не деградировали;
- текущий результат воспроизводим.

Он не проверяет:

- что зона полностью покрыта;
- что раскладка качественная;
- что количество кусков близко к ручной раскладке;
- что direct solver готов к production.

Текущий baseline intentionally фиксирует:

- `resultStatus: "failed"`;
- `failedReason: "zone_not_fully_covered"`;
- `fullCoverageOk: false`.

## Связь С Документацией Solver

См. также:

- `geometry-kernel.md`, раздел "Известные проблемы": `cover_grid_solver.js` не дает корректных результатов и находится в разработке.
- `solver.md`: текущий greedy/grid подход описан как ограниченный; документ фиксирует типичный провал на неудобных остатках и направление развития через global optimization / simulated annealing.

## Что Нужно Добавить

Следующий обязательный слой:

```bash
npm run test:solver-quality
```

Сначала advisory/non-blocking, затем blocking после стабилизации алгоритма.

Минимальные метрики:

- `coveragePercent`;
- `fullCoverageOk`;
- `residualAreaMm2`;
- количество placement-ов;
- overlap/outside area;
- runtime/timeout;
- warnings/failure reason.

Минимальные fixtures:

- easy-case, где solver обязан закрывать зону;
- typical-case с реальными остатками;
- hard residual/pocket case;
- timeout case.

## Рабочее Правило

Пока `test:solver-quality` не существует и не зеленый на согласованных кейсах:

- не считать `inventory_direct` production-ready;
- не трактовать `npm run test:suite` как подтверждение качества direct solver;
- не делать механическую чистку `inventory_direct_solver.js` ради lint без привязки к качественным regression cases.
