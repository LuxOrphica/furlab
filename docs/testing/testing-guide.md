# FurLab Testing Guide

Этот документ фиксирует, какие проверки есть в `furlab-web-plugin`, что они означают и когда их запускать.

## Быстрые Команды

### Базовый прогон

```bash
npm run test:suite
```

Что проверяет:
- encoding/mojibake/i18n guards;
- repo hygiene;
- oxlint error gate;
- unit/property tests;
- golden snapshots для mode preview и inventory direct;
- server smoke для solver timeout;
- mode cases smoke.

Ожидаемый результат сейчас:

```text
11 passed, 4 skipped
```

`4 skipped` - это e2e/browser проверки, которые намеренно не входят в быстрый базовый прогон.

### Полный локальный прогон

```bash
npm run test:full
```

То же самое, что:

```bash
npm run test:e2e
```

Что добавляет поверх `test:suite`:
- Fragment API smoke;
- Inventory manual e2e;
- Inventory direct e2e;
- Reports modal e2e.

Ожидаемый результат сейчас:

```text
13 passed
```

### Unit/property tests

```bash
npm run test:unit
```

Покрывает:
- geometry primitives;
- layout fragment generators;
- contracts;
- runtime invariants;
- golden snapshot normalization;
- logger/error monitor config;
- property-based проверки через `fast-check`.

Ожидаемый результат сейчас:

```text
200 passed
```

### Oxlint

```bash
npm run lint:js
```

Показывает весь список warnings/errors по `src`, `tests`, `scripts`.

```bash
npm run lint:js:ci
```

CI-режим: показывает только errors. Сейчас warnings есть, поэтому мы не включаем `--deny-warnings` в общий suite. Это намеренно: сначала используем lint как защиту от реальных ошибок, затем постепенно чистим warning backlog.

### Allure

```bash
npm run allure:ci
```

Делает:
- чистит `allure-results` и `allure-report`;
- запускает unit/property тесты с Allure reporter;
- генерирует `allure-report/index.html`.

Для локального открытия:

```bash
npm run allure:run
```

Обычный `npm run test:unit` не пишет Allure-артефакты. Allure включается только через `ALLURE=1`, это делает `scripts/run_unit_allure.js`.

## Server-Dependent Tests

Для server tests нужен работающий API на `127.0.0.1:5600`.

Старт:

```bash
npm start
```

Health check:

```bash
curl http://127.0.0.1:5600/api/health
```

В CI сервер стартует автоматически перед `npm run test:suite`.

## E2E Browser

Browser tests используют `playwright-core` и локальный Chromium/Edge/Chrome.

Поиск браузера:
- `PLAYWRIGHT_CHROMIUM_EXECUTABLE`, если задан;
- Windows Edge;
- Windows Chrome;
- Linux Chrome/Chromium.

Явно указать браузер:

```powershell
$env:PLAYWRIGHT_CHROMIUM_EXECUTABLE="C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe"
npm run test:full
```

Если браузер не найден, e2e тесты завершатся ошибкой с подсказкой.

## Golden Master

Golden snapshots фиксируют эталонные результаты для стабильных сценариев.

Проверить:

```bash
npm run golden:mode-preview
npm run golden:inventory-direct
```

Обновлять baseline только если изменение поведения ожидаемое:

```bash
npm run golden:mode-preview:update
npm run golden:inventory-direct:update
```

Перед обновлением baseline нужно понять, что изменилось: алгоритм, контракт ответа, нормализация или случайный порядок.

### Inventory Direct Golden Status

`golden:inventory-direct` is an experimental baseline, not a quality certificate for the direct solver.

Current baseline intentionally records:

- `resultStatus: "failed"`;
- `failedReason: "zone_not_fully_covered"`;
- `fullCoverageOk: false`.

So a passing `golden:inventory-direct` means the current experimental behavior stayed stable. It does not mean the direct solver is production-ready or produces a correct automatic layout.

Detailed status: `docs/direct-solver-test-status.md`.

## Solver Timeout Smoke

```bash
npm run test:solver-timeout
```

Проверяет, что тяжелый direct inventory/oracle запрос:
- получает `hardMaxSolveMs=5000`;
- возвращает контролируемый JSON;
- не держит HTTP-запрос дольше допустимого wall-clock лимита.

Это защита от возврата к состоянию, когда solver мог подвесить сервер на минуты.

This smoke test checks timeout behavior only. It does not check solver quality.

## CLO Import Mock

```bash
npm run test:clo-import
```

Runs `scripts/clo_import_furlab.py` outside CLO with fake `fabric_api` and `pattern_api` modules.

It checks:

- ZIP extraction and `manifest.json` loading;
- UTF-8/Cyrillic `.jfab` paths;
- material de-duplication and `AddFabric`;
- `CreatePatternWithPoints` payload shape;
- Y-axis conversion from FurLab canvas coordinates to CLO coordinates;
- DXF fallback via `FRAGMENT_CONTOUR`;
- clear error for ZIPs without `manifest.json`.

This test covers importer logic up to the CLO API boundary. Real CLO API compatibility still needs a manual smoke run in CLO, but failures should now be easier to localize.

## CI

GitHub Actions сейчас делает:
- `npm ci`;
- старт API server;
- `npm run test:suite`;
- `npm run allure:ci`;
- upload artifact: `allure-report` и `allure-results`.

E2E пока не включен в обычный CI job, потому что browser selftests тяжелее и требуют стабильного Chromium окружения. Локально их запускает:

```bash
npm run test:full
```

## Что Значат Результаты

`passed` - проверка выполнена и прошла.

`skipped` - проверка не запускалась в этом режиме. Это не ошибка.

`failed` - проверка запускалась и нашла проблему.

Если `golden:inventory-direct` падает только под сильной параллельной нагрузкой, сначала перепроверить отдельно:

```bash
npm run golden:inventory-direct
```

Если отдельно зеленый, это сигнал к будущей стабилизации snapshot/solver ordering, а не обязательно функциональная поломка.
Direct solver status reminder:

- current direct tests check API, contract, snapshot, and timeout stability;
- they do not prove automatic layout quality;
- direct solver quality work is tracked separately in `docs/direct-solver-test-status.md`.
