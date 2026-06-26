# CLO 3D Plugin Integration — архитектура

Статус: исследование завершено, реализация отложена

## Выводы по CLO API

CLO Standalone имеет полноценный официальный SDK:
- **C++ Plugin SDK** — основной способ (.dll / .dylib, CMake, Qt)
- **Python API** — встроенный скриптинг и прототипирование
- **Library Window API** — интеграция собственных библиотек материалов
- **Event API** — подписка на события CLO
- **REST types** — `CloApiRestRequest` / `CloApiRestResponse`
- **QWebEngineView** — встроить HTML/JS UI официально через Qt

## Как web-plugin вписывается в C++ SDK

```
CLO 3D
└─ FurLab C++ Plugin
   ├─ QWebEngineView → загружает http://127.0.0.1:5600 (Node.js сервер)
   ├─ QWebChannel → предоставляет window.furlabApi в JS
   │   (переопределяет fetch-fallback на реальные вызовы CLO API)
   └─ При "Преобразовать в лекала":
       ├─ JS вызывает window.furlabApi("/api/export/patterns/run", ...)
       ├─ C++ получает JSON с fragment contours + seams + materials
       └─ CLO Geometry API → создаёт реальные лекала в сцене CLO
```

## Что уже готово со стороны Node.js сервера

- `window.furlabApi` — правильный хук, C++ плагин переопределит его через QWebChannel
- `POST /api/export/patterns/preview` — возвращает N лекал, M швов, статус зон
- `POST /api/export/patterns/run` — возвращает ZIP: DXF фрагменты + manifest.json + materials.json
- DXF как fallback — работает без C++ плагина

## Что нужно реализовать в C++ плагине

1. Зарегистрировать QWebChannel объект как `window.furlabApi`
2. Перехватывать `/api/export/patterns/run` → парсить JSON → CLO pattern creation API
3. Library Window API → подключить `/api/dicts/fur-materials` как источник библиотеки меха
4. Event API → реагировать на изменения проекта CLO (зоны устарели → `[Δ]`)

## Точки интеграции в существующем коде

| Сторона | Файл | Что делает |
|---------|------|------------|
| JS | `public/js/core/api.js` | `window.furlabApi` — override point для C++ bridge |
| Server | `src/routes/export.js` | `/api/export/patterns/run` — JSON пакет для C++ |
| Server | `src/routes/fur_materials.js` | Источник данных для Library Window API |
| Server | `src/routes/projects.js` | Синхронизация состояния проекта |

## Рекомендуемый стек C++ плагина

- C++17, CMake, Qt 5/6
- QWebEngineView для UI
- QWebChannel для JS↔C++ bridge
- CLO Geometry API для создания лекал
- SQLite для локального кэша (опционально)
