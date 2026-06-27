# FurLab Quality Stack

Этот документ описывает текущие слои качества FurLab и что еще осталось усилить.

## 1. Static Layer

Сейчас есть:
- encoding check;
- mojibake check;
- i18n structure check;
- repo hygiene check;
- oxlint error gate;
- TypeScript-style JSON contracts через `zod` для API boundaries.

Команда:

```bash
npm run test:static
```

Что добавить дальше:
- постепенно разгребать oxlint warnings;
- при необходимости добавить ESLint для правил, которых нет в oxlint;
- отдельные правила для frontend globals;
- проверку запрещенных served backup-файлов.

## 2. Unit And Property Layer

Сейчас есть:
- `Vitest`;
- `fast-check`;
- geometry unit tests;
- layout generator tests;
- runtime invariant tests;
- contract tests;
- error monitor/logger tests.

Команда:

```bash
npm run test:unit
```

Фокус этого слоя:
- маленькие чистые функции;
- геометрические свойства;
- API shape;
- deterministic normalization.

Что добавить дальше:
- больше stateful/model-based tests для layout state transitions;
- property tests для solver inputs;
- targeted tests для residual/pocket cases.

## 3. Golden Master Layer

Сейчас есть:
- `golden:mode-preview`;
- `golden:inventory-direct`.

Команды:

```bash
npm run golden:mode-preview
npm run golden:inventory-direct
```

Фокус:
- ловить регрессии в эталонных layout responses;
- нормализовать шумные runtime поля;
- сравнивать компактный stable snapshot.

Что добавить дальше:
- golden для split return;
- golden для manual apply/report;
- стабилизация inventory direct ordering под нагрузкой.

## 4. Server Smoke Layer

Сейчас есть:
- mode cases smoke;
- solver timeout smoke;
- fragment API smoke в full/e2e режиме.

Команды:

```bash
npm run test:suite
npm run test:solver-timeout
```

Фокус:
- API отвечает;
- базовые сценарии не падают;
- тяжелый solver не подвешивает сервер.

## 4A. Solver Quality Layer

Current status:

- not yet implemented as a blocking gate;
- required before declaring `inventory_direct` production-ready;
- separate from golden snapshots and timeout smoke.

Future command:

```bash
npm run test:solver-quality
```

Target metrics:

- `coveragePercent`;
- `fullCoverageOk`;
- `residualAreaMm2`;
- placement count;
- overlap/outside area;
- runtime/timeout.

Initial mode should be advisory/non-blocking. After algorithm stabilization it can become a required gate.

Important: current server smoke checks stability and safety, not direct solver quality. `inventory_direct` is experimental; see `docs/direct-solver-test-status.md`.

## 5. E2E Layer

Сейчас есть:
- Inventory manual e2e;
- Inventory direct e2e;
- Reports modal e2e.

Команда:

```bash
npm run test:full
```

Фокус:
- ключевые пользовательские сценарии;
- browser integration;
- smoke-level confidence, не главный ловец алгоритмических багов.

Что добавить дальше:
- manual/scheduled CI job для e2e;
- screenshots as artifacts;
- visual regression baselines.

## 5A. CLO Export/Import Boundary

Current status:

- `npm run test:clo-import` runs the CLO importer with fake CLO API modules;
- covered up to the CLO API boundary: ZIP, manifest, JFAB paths, DXF fallback, point conversion, material assignment calls;
- real CLO API calls still require manual smoke in CLO.

Focus:

- catch broken FurLab ZIP/importer contracts before opening CLO;
- make CLO failures diagnosable by logging the selected ZIP, fragment count, first contour point, material path, and available `pattern_api` functions.

## 6. Runtime Invariants

Сейчас есть проверки:
- fragments;
- placements;
- render output;
- duplicate ids;
- invalid geometry;
- negative area metrics.

Где живет:
- `src/contracts/runtime_invariants.js`;
- mode wrappers in `src/modes/wrapper.js`.

Фокус:
- падать рано на некорректной структуре;
- не отдавать UI полусломанный render model;
- ловить ошибки не только тестами, но и во время выполнения.

## 7. Observability

Сейчас есть:
- Pino structured logging;
- optional Sentry via `SENTRY_DSN`;
- HTTP breadcrumbs;
- uncaught/unhandled capture;
- request error capture.

Включить Sentry:

```powershell
$env:SENTRY_DSN="https://..."
$env:SENTRY_ENVIRONMENT="local"
npm start
```

Что добавить дальше:
- request id propagation;
- solver trace id in responses/logs;
- structured logs for solver timeout/fallback decisions.

## 8. Reporting And Automation

Сейчас есть:
- GitHub Actions;
- `test:suite` in CI;
- Allure unit/property report artifact.

Команды:

```bash
npm run allure:ci
npm run allure:run
```

Что добавить дальше:
- e2e artifact upload;
- scheduled full run;
- PR summary with test counts and links.

## Current Command Map

Use this for normal work:

```bash
npm run test:suite
```

Use this before bigger changes or release:

```bash
npm run test:full
```

Use this for report/debug:

```bash
npm run allure:ci
```

Use this after intentional output changes:

```bash
npm run golden:mode-preview:update
npm run golden:inventory-direct:update
```

## Next Recommended Work

1. Add solver quality fixtures and `test:solver-quality` in advisory mode.
2. Fix `inventory_direct` against those fixtures before treating it as production-ready.
3. Stabilize any golden snapshot sensitivity under parallel CPU load.
4. Add scheduled/manual e2e CI job.
5. Add visual regression for key screens.
6. Expand stateful/property tests around layout state and solver decisions.
