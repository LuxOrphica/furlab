# Layout Modes: Short Handoff

## Что уже сделано

1. Каркас режимов:
- `src/modes/registry.js`
- `src/modes/inventory_direct/index.js`
- `src/modes/intarsia/index.js`
- `src/modes/inventory_manual/index.js`

2. Wrapper API:
- `POST /api/layout/modes/preview`
- `POST /api/layout/modes/apply` (пока stub без записи)

3. DTO/wrapper-утилиты:
- `src/modes/wrapper.js`

4. JSON testcases runner:
- `scripts/run_mode_cases.js`
- smoke кейсы: `tests/cases/modes/*.json`
- npm script: `npm run modes:testcases`

## Как подключать новый режим

1. Создать `src/modes/<modeId>/index.js`.
2. Экспортировать минимум:
- `modeId`
- `preview(...)`
3. Зарегистрировать режим в `src/modes/registry.js`.
4. Добавить ветку в `/api/layout/modes/preview`:
- маппинг `inputs/options` -> `mode.preview(...)`
- сборка wrapper-ответа (`render.solveOrder`, `render.items`, `resultStatus`)
5. Добавить минимум 1 JSON smoke-кейс в `tests/cases/modes/`.

## Минимальные правила

- Не ломать существующие публичные endpoint'ы (legacy).
- Все новые поля только additive.
- Preview без side-effects.
- Детерминизм при фиксированных input + seed.
- `preview` обязан возвращать: `modeVersion`, `resultStatus`, `failedReason|null`, `warnings[]`.
- `renderOrderPolicy` и `stackOrderPolicy` приходят от режима; UI их не вычисляет.
- `render.items` и `solveOrder` обязательны для UI.
- `/api/layout/modes/apply` сейчас `stub`: запись в БД не включена.

## Команды

```bash
npm run start
npm run modes:testcases
```
