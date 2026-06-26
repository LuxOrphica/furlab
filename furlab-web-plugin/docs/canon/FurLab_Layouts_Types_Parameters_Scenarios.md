# Приложение Y. Выкладки FurLab: типы, параметры и сценарии выполнения

Канонические термины, сущности и имена полей определены в Приложении X ([FurLab_Data_Model_Glossary_v5.md](FurLab_Data_Model_Glossary_v5.md)).

## Y.2 Типы выкладок и формирование результата

### Таблица Y.1 — Типы выкладок и участие сущностей канона

| Тип выкладки (Layout.layoutType) | Источник геометрии | Результат | Фиксация в данных |
|---|---|---|---|
| RegularLayout | параметризация паттерна в пределах zoneContour | набор fragment внутри zone | Layout.params (X.7.2) → LayoutRun.paramsSnapshot → Fragment.fragmentContour |
| IrregularLayout | заданные контуры (импорт/рисование/трафарет) | набор fragment внутри zone | Layout.params (X.7.3) → LayoutRun.paramsSnapshot → Fragment.fragmentContour |
| FillRemainingAreaLayout | алгоритм заполнения остаточной области zoneContour | fragment в остаточной области | Layout.params (X.7.4) → LayoutRun.paramsSnapshot → Fragment.fragmentContour |
| InventoryLayout | scrapContour из ScrapPiece + правила размещения | fragment как производные от ScrapPiece | Layout.params (X.7.5) + InventoryLayoutConfig → LayoutRun.paramsSnapshot → LayoutRunScrapPlacement |

## Y.3 Общие принципы параметризации и воспроизводимости

Параметры выкладки хранятся в `Layout.params` как JSON-структуры, определяемые `layoutType`. При каждом выполнении создаётся запуск `LayoutRun`, который фиксирует полный снимок параметров в `LayoutRun.paramsSnapshot`. Это обеспечивает воспроизводимость результата независимо от последующих изменений настроек. Для сценариев с инвентарём факты использования ScrapPiece фиксируются отдельными записями `LayoutRunScrapPlacement`, включая привязку к `fragmentId` и сохранение итоговой геометрии в `resultContourSnapshot`.

## Y.4 RegularLayout: параметры и сценарий выполнения

### Таблица Y.2 — RegularLayoutParams

| Поле | Тип | Определение |
|---|---|---|
| patternId | string | Идентификатор паттерна из библиотеки |
| patternParams | JSON | Параметры выбранного паттерна |
| normalizeRules | JSON (NormalizeRules) | Правила нормализации результата (табл. Y.8) |

**Сценарий выполнения RegularLayout:**
1. Для zone выбирается паттерн (patternId) и задаются его параметры (patternParams).
2. Выполняется запуск LayoutRun с фиксацией paramsSnapshot.
3. Структура паттерна строится в пределах zoneContour.
4. Выполняется клиппинг результата по zoneContour.
5. Применяются normalizeRules, формируются fragmentContour и метрики фрагментов.
6. Результат используется для визуального контроля, отчётности и экспортных операций.

## Y.5 IrregularLayout: параметры и сценарий выполнения

### Таблица Y.3 — IrregularLayoutParams

| Поле | Тип | Определение |
|---|---|---|
| sourceType | enum | import / draw / stencil |
| contours | JSON | Набор замкнутых контуров, задающих границы фрагментов до клиппинга |
| stencilId | string (nullable) | Идентификатор трафарета |
| simplifyToleranceMm | number (nullable) | Допуск упрощения/сглаживания контуров, мм |
| normalizeRules | JSON (NormalizeRules) | Правила нормализации результата |

**Сценарий выполнения IrregularLayout:**
1. Контуры получаются импортом, созданием в проекте или редактированием через трафарет (sourceType).
2. Контуры приводятся к корректному виду: замкнутость, допустимые пересечения, упрощение при заданном simplifyToleranceMm.
3. Выполняется запуск LayoutRun с фиксацией paramsSnapshot.
4. Контуры клиппируются по zoneContour.
5. Применяются normalizeRules, формируются fragmentContour и метрики фрагментов.
6. При необходимости выполняется назначение ScrapPiece на сформированные fragment (режим B).

## Y.6 FillRemainingAreaLayout: параметры и сценарий выполнения

### Таблица Y.4 — FillRemainingAreaParams

| Поле | Тип | Определение |
|---|---|---|
| algorithm | enum | Voronoi / Grid |
| algorithmParams | JSON | Параметры выбранного алгоритма |
| normalizeRules | JSON (NormalizeRules) | Правила нормализации результата |

### Таблица Y.5 — VoronoiParams

| Поле | Тип | Определение |
|---|---|---|
| seedCount | int | Количество семян |
| relaxIters | int (nullable) | Итерации релаксации |
| minCellAreaMm2 | number (nullable) | Минимальная площадь ячейки, мм² |

### Таблица Y.6 — GridParams

| Поле | Тип | Определение |
|---|---|---|
| gridStepMm | number | Шаг сетки, мм |
| angleDeg | number (nullable) | Угол сетки, градусы |
| minCellAreaMm2 | number (nullable) | Минимальная площадь ячейки, мм² |

## Y.7 InventoryLayout: параметры и сценарий выполнения (режим A)

InventoryLayout формирует фрагменты как производные от оцифрованных кусков ScrapPiece. Параметры размещения разделяются на два уровня: (1) стратегия размещения хранится в `Layout.params`, (2) отбор кандидатов и ограничения совместимости хранятся в `InventoryLayoutConfig` (maxCandidates, filters, constraints).

### Таблица Y.7 — InventoryLayoutParams

| Поле | Тип | Определение |
|---|---|---|
| placementStrategy | enum | greedy / bestFit / manualAssist |
| normalizeRules | JSON (NormalizeRules) | Правила нормализации результата |

**Сценарий выполнения InventoryLayout (режим A):**
1. Формируется пул кандидатов ScrapPiece по filters и maxCandidates (InventoryLayoutConfig).
2. Применяются constraints для проверки совместимости и допустимых преобразований при размещении.
3. Выбирается placementStrategy и выполняется размещение кусков в зоне.
4. Выполняется клиппинг результирующих контуров по zoneContour и нормализация по normalizeRules.
5. Создаётся набор fragment как производных от использованных ScrapPiece.
6. Для каждого факта использования инвентаря фиксируется запись LayoutRunScrapPlacement с заполнением layoutRunId, fragmentId, scrapPieceId, rotationDeg, offsetXmm, offsetYmm и resultContourSnapshot.

## Y.8 Нормализация результата (общий блок)

### Таблица Y.8 — NormalizeRules

| Поле | Тип | Определение |
|---|---|---|
| minFragmentWidthMm | number (nullable) | Минимальная ширина фрагмента, мм |
| minFragmentLengthMm | number (nullable) | Минимальная длина фрагмента, мм |
| simplifyToleranceMm | number (nullable) | Допуск упрощения/сглаживания, мм |
| mergeSmallFragments | boolean (nullable) | Объединение малых фрагментов |
| seamAllowanceReserveMm | number (nullable) | Резерв на припуск/шов, мм |

## Y.9 Режим B: назначение ScrapPiece на сформированные fragment

Режим B применяется после получения целевой геометрии fragment в зоне (обычно в IrregularLayout). Формируется пул кандидатов ScrapPiece по maxCandidates и filters (InventoryLayoutConfig), применяются constraints, после чего выполняется назначение выбранных кусков на фрагменты. Результат фиксируется в LayoutRunScrapPlacement с заполнением layoutRunId, fragmentId, scrapPieceId и resultContourSnapshot.

## Y.10 Трассируемость и отчётность

Минимальный набор ключей для восстановления использования инвентаря:

1. `LayoutRun.id` — идентификатор запуска; `LayoutRun.paramsSnapshot` — снимок применённых параметров.
2. `LayoutRunScrapPlacement.fragmentId` — связь с фрагментом; `LayoutRunScrapPlacement.scrapPieceId` — связь с куском.
3. `ScrapPiece.inventoryTag` — связь с физической меткой куска.
4. `LayoutRunScrapPlacement.resultContourSnapshot` — итоговая геометрия кроя после размещения.
