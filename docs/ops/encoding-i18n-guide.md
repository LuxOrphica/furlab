# FurLab: Encoding + i18n Guard

## Цель
Исключить повторное появление кракозябр и откат UI к нецентрализованным литералам.

## Обязательные правила
1. Все текстовые файлы: UTF-8, LF, final newline.
2. Любые новые UI-подписи в `public/index.html` делаем через `data-i18n` + fallback.
3. Русские строки храним в `public/js/core/i18n-ru.js`.
4. `i18n-ru.js` и `i18n-hydrate.js` должны быть подключены до `app.js`.

## Автогейты
- `npm run encoding:check`
- `npm run mojibake:check`
- `npm run i18n:check`
- `npm run repo:check`

`npm test` запускает эти проверки последовательно.  
`pre-commit` блокирует коммит при провале любого из них.

## Мини-чек перед PR
1. `npm test --silent`
2. `npm run -s ui:smoke`
3. Проверить экран с панелью отображения: подписи читаемые, без `Р...`/`Ð...`.

