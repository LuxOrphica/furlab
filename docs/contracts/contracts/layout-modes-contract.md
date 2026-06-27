# FurLab Layout Modes - Team Integration Contract (v0.2)

Цель документа: дать единый командный каркас интеграции режимов выкладки, чтобы команды могли работать параллельно без конфликтов API, UI и БД.

Этот документ не заменяет режимные контракты. Для каждого режима действуют свои режимные правила. Для `inventory_direct` источником истины является `Inventory Direct Cover Contract v1.3`.

## 1. Термины

- Layout Mode: независимый режим выкладки (`longitudinal`, `transverse`, `intarsia`, `inventory_direct`, `inventory_manual`).
- Preview: расчет без side effects (без записи в БД и без смены статусов).
- Apply: фиксация результата в БД.
- Z (Zone): геометрия зоны, solver ее не модифицирует.
- P: контур размещенного куска (после rotation + translation).
- Pz: `P ∩ Z`.
- Visible: UI-производная (видимая область по stack/render порядку), не обязательный acceptance-критерий.

## 2. Обязательные инварианты

### 2.1 Side effects
- Preview MUST быть чистым.
- Apply MUST быть единственной точкой записи run/placements/резервов.

### 2.2 Determinism
- При одинаковом входе + seed режим MUST быть воспроизводим.

### 2.3 Shared geometry
- Общая геометрия живет в shared-модулях.
- Изменения shared-геометрии только с регресс-тестами.

### 2.4 Render/stack
- Каждый режим MUST возвращать:
  - `solveOrder`;
  - `renderOrderPolicy`/`stackOrderPolicy` и/или `renderIndex`.
- UI MUST не угадывать порядок слоев.

## 3. Wrapper API (командный)

### 3.1 Preview request
```json
{
  "layoutType": "longitudinal|transverse|intarsia|inventory_direct|inventory_manual",
  "zone": { "id": 0, "points": [{"x":0,"y":0}] },
  "inputs": {},
  "options": {},
  "seed": 0
}
```

### 3.2 Preview response
```json
{
  "ok": true,
  "layoutType": "inventory_direct",
  "modeVersion": "v1.3",
  "resultStatus": "ok|needs_attention|failed",
  "warnings": ["string"],
  "failedReason": null,
  "stats": {},
  "render": {
    "renderOrderPolicy": "phase_priority|solve_order|last_on_top|first_on_top",
    "stackOrderPolicy": "phase_priority|solve_order|last_on_top|first_on_top",
    "solveOrder": ["placementId"],
    "items": []
  },
  "debug": {}
}
```

### 3.3 Apply
- Apply получает `previewToken` или preview snapshot.
- Apply MUST быть идемпотентным в рамках `layoutRunId`.

## 4. Source-of-truth и приоритеты

- Team contract (этот документ) задает только общий wrapper/границы.
- Mode contract задает математику, acceptance и метрики конкретного режима.
- При конфликте Team vs Mode приоритет у Mode-контракта.
- Для `inventory_direct` приоритет у `Inventory Direct Cover Contract v1.3`.

## 5. Ownership map

- `routes/`: интеграция wrapper и валидация запросов.
- `modes/<modeId>/`: владелец режима (`solver`, `contract`, `diagnostics`).
- `services/geom/*`: shared, меняется только по согласованию.
- `tests/cases/*`: регресс-наборы.

## 6. Минимальные acceptance-проверки для всех режимов

- Preview не пишет в БД.
- UI строит слой только из `render.items` + order policy.
- Если режим декларирует strict acceptance, должен быть `fullCoverageOk` и понятный `failedReason`.
- Flip/mirror запрещены для физического инвентаря, если режим работает со ScrapPiece.

## 7. Подключение нового режима (чеклист)

1. Создать `modes/<modeId>/`.
2. Добавить режимный `contract.md`.
3. Добавить solver + diagnostics.
4. Добавить минимум 1-3 JSON-кейса.
5. Зарегистрировать режим в реестре.
