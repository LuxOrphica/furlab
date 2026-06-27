# Frontend / Backend Sync (2026-02-26)

## Статус
- Backend refactor выполнен: `ui_lab_server.js` разбит на `routes/*`, `services/*`, `utils/*`, `bootstrap/*`.
- Smoke API пройден (`/api/health`, `/api/dicts`, `/api/registry`).

## Для фронта
- Изменений в URL API нет.
- Изменений в структуре успешных JSON-ответов по основным read-эндпоинтам нет.
- Писать ничего не нужно по интеграции только из-за этого рефактора.
- Для ошибок добавлен унифицированный блок:
  - `error` (legacy string code),
  - `errorCode` (string),
  - `errorDetail: { code, message, statusCode, requestId }`.

## Что важно учесть
- Для write-эндпоинтов используется API key (`X-API-Key`), если включен `FURLAB_API_KEY`.
- В ответах присутствует `requestId` (полезно для трассировки ошибок).

## Рекомендация
- При удобном случае прогнать фронтовый smoke:
  - загрузка реестра,
  - открытие карточки куска (`/api/piece/:id`),
  - reserve/release/use и последующий refresh карточки.
