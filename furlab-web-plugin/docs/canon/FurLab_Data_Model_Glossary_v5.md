# Приложение X. Справочник терминов и атрибутов модели данных FurLab v5

## Таблица A. Термины предметной области

| Термин (RU) | Каноническое имя | Короткое определение |
|---|---|---|
| Деталь | part | Элемент изделия, содержащий одну или несколько зон обработки мехом |
| Зона | zone | Область внутри детали, в пределах которой выполняется выкладка и формируются фрагменты |
| Контур зоны | zoneContour | Граничный контур зоны (ограничитель для клиппинга результата) |
| Выкладка | layout | Операция/настройка, задающая способ формирования фрагментов внутри зоны |
| Запуск выкладки | layoutRun | Факт выполнения выкладки с фиксированными входными параметрами и полученным результатом |
| Фрагмент | fragment | Замкнутый участок внутри зоны, используемый в спецификации, отчётности и экспорте |
| Контур фрагмента | fragmentContour | Геометрия фрагмента после клиппинга по зоне и применения конструктивных правил |
| Инвентарь отходов | scrapInventory | Набор учтённых кусков меха, доступных для подбора/размещения |
| Кусок отхода | scrapPiece | Единица инвентаря: физический кусок меха с меткой, материалом и контуром |
| Контур куска | scrapContour | Оцифрованный контур scrapPiece |
| Инвентарная метка | inventoryTag | Уникальный код идентификации scrapPiece (печать/сканирование) |
| Паспорт материала | furMaterial | Описание материала, на которое ссылаются зона и scrapPiece |
| Направление ворса куска | napDirection | Ориентация ворса конкретного физического куска, фиксируется при оцифровке/по метке |
| Направление ворса зоны | pileDirectionDeg | Ориентация ворса на изделии для данной зоны; задаётся в локальной системе координат 2D детали/зоны |
| Единицы измерения | mm, mm2 | Линейные размеры в мм; площади в мм² |

## Таблица B. Типы выкладок и связь с инвентарём

| Тип (RU) | Каноническое имя | Результат | Связь с инвентарём |
|---|---|---|---|
| Регулярная выкладка | RegularLayout | fragment внутри zone | отсутствует |
| Нерегулярная выкладка | IrregularLayout | fragment внутри zone | используется в сценарии "Подбор под фрагменты" |
| Выкладка из инвентаря | InventoryLayout | fragment на основе scrapPiece | используется (scrapPiece → fragment) |
| Подбор под фрагменты | ScrapAssignment | назначение scrapPiece на fragment | используется (fragment → scrapPiece) |
| Заполнение остатка зоны | FillRemainingAreaLayout | fragment в остаточной области zone | отсутствует |

## Таблица C. Объекты модели данных и канонические поля

| Сущность | Канонические поля (кратко) |
|---|---|
| FurMaterial | id, name, properties |
| Part | id, name |
| Zone | id, partId, zoneContour, materialId, pileDirectionMode, pileDirectionDeg |
| Fragment | id, zoneId, fragmentContour, areaMm2 |
| Layout | id, zoneId, layoutType, params |
| LayoutRun | id, layoutId, startedAt, paramsSnapshot, resultSnapshot |
| ScrapPiece | id, inventoryTag, materialId, scrapContour, napDirection, metrics |
| InventoryLayoutConfig | id, layoutId, maxCandidates, filters, constraints |
| LayoutRunScrapPlacement | layoutRunId, fragmentId, scrapPieceId, rotationDeg, offsetXmm, offsetYmm, resultContourSnapshot |

## Таблица D. Канонические параметры алгоритмов/правил

| Параметр | Каноническое имя | Определение |
|---|---|---|
| Лимит кандидатов | maxCandidates | Максимальный размер пула scrapPiece, рассматриваемых алгоритмом в одном запуске |
| Фильтры совместимости | filters | Правила отбора scrapPiece (материал, ворс, площадь, качество и т. п.) |
| Ограничения размещения | constraints | Геометрические ограничения (разрешённые повороты, допуски, припуски и т. п.) |
| Снимок параметров запуска | paramsSnapshot | Фиксация параметров запуска для воспроизводимости |
| Снимок результата контура | resultContourSnapshot | Фиксация итоговой геометрии для отчётности/экспорта |

## Таблица E. Замены для приведения к канону

| Встречаемый вариант | Канон | Действие |
|---|---|---|
| materialRefId | materialId | заменить |
| materialRef | materialId | заменить |
| candidateLimit | maxCandidates | заменить |
| LayoutRunScrapPlacement без fragmentId | добавить fragmentId | ручная правка |

---

## Таблица C1. FurMaterial (паспорт материала)

| Поле | Тип | Описание |
|---|---|---|
| id | UUID (PK) | Идентификатор материала |
| name | string | Наименование/код материала для UI и отчётов |
| properties | JSON | Набор свойств материала |

### Таблица C1.1. FurMaterial.properties — атрибуты паспорта мехового материала

| Группа | Атрибут | Обозначение/тип | Ед. изм. | Описание |
|---|---|---|---|---|
| Общие сведения | Название | generalName: string | — | Наименование материала |
| Цвет и пигментация | Цвет | color: ColorValue | — | Базовый цвет |
| Цвет и пигментация | Меланин | melanin: float | — | Уровень меланина (0..1) |
| Цвет и пигментация | Феомеланин | pheomelanin: float | — | Уровень феомеланина (0..1) |
| Размеры заготовки | Ширина макс. | blankWidthMaxMm: float | мм | Максимальная ширина заготовки |
| Размеры заготовки | Длина макс. | blankLengthMaxMm: float | мм | Максимальная длина заготовки |
| Размеры заготовки | Толщина | thicknessMm: float | мм | Толщина основы |
| Эстетика | Блеск | gloss: float | — | Показатель блеска (0..1) |
| Эстетика | Мягкость | softness: float | — | Показатель мягкости (0..1) |
| Эстетика | Опушённость | fluffiness: float | — | Визуальная пышность (0..1) |
| Геометрия ворса | Длина ворса | pileLengthMm: float | мм | Средняя длина ворса |
| Геометрия ворса | Диаметр ворса | pileDiameterMm: float | мм | Средний диаметр ворса |
| Геометрия ворса | Густота ворса (CLO) | pileDensityPerIn2: float | волос/дюйм² | Плотность ворса |
| Геометрия ворса | Утончение | tapering: float | — | Степень утончения (0..1) |
| Геометрия ворса | Сегментация | segmentation: int | шт. | Число сегментов |
| Ориентация и извитость | Изгиб ворса | bend: float | — | Интенсивность изгиба/наклона (0..1) |
| Ориентация и извитость | Радиус извитости | curlRadiusMm: float | мм | Радиус завитка/извитости |
| Ориентация и извитость | Эффект скрученности | twistEffect: float | — | Интенсивность скрученности |
| Физика полотна | Упругость | elasticity: float | — | Упругость (0..1) |
| Физика полотна | Растяжимость | stretchability: float | — | Растяжимость (0..1) |
| Физика полотна | Вес полотна | fabricWeightGm2: float | г/м² | Поверхностная плотность полотна |

## Таблица C2. Part (деталь)

| Поле | Тип | Описание |
|---|---|---|
| id | UUID (PK) | Идентификатор детали |
| name | string | Имя/код детали |

## Таблица C3. Zone (зона)

| Поле | Тип | Описание |
|---|---|---|
| id | UUID (PK) | Идентификатор зоны |
| partId | UUID (FK → Part.id) | Родительская деталь |
| materialId | UUID (FK → FurMaterial.id) | Материал зоны |
| zoneContour | JSON | Контур зоны (замкнутая геометрия) |
| pileDirectionMode | enum | AlongGrain / AcrossGrain / Custom |
| pileDirectionDeg | number, NULL | Угол направления ворса зоны (0–360), при pileDirectionMode=Custom |

## Таблица C4. Fragment (фрагмент)

| Поле | Тип | Описание |
|---|---|---|
| id | UUID (PK) | Идентификатор фрагмента |
| zoneId | UUID (FK → Zone.id) | Родительская зона |
| fragmentContour | JSON | Итоговый контур фрагмента (после клиппинга по зоне) |
| areaMm2 | number | Площадь фрагмента в мм² |

## Таблица C5. Layout (выкладка, настройки)

| Поле | Тип | Описание |
|---|---|---|
| id | UUID (PK) | Идентификатор выкладки |
| zoneId | UUID (FK → Zone.id) | Зона, для которой задана выкладка |
| layoutType | enum | RegularLayout / IrregularLayout / InventoryLayout / FillRemainingAreaLayout |
| params | JSON | Параметры выкладки (структура зависит от layoutType) |

## Таблица C6. LayoutRun (запуск выкладки)

| Поле | Тип | Описание |
|---|---|---|
| id | UUID (PK) | Идентификатор запуска |
| layoutId | UUID (FK → Layout.id) | Ссылка на выкладку-настройку |
| startedAt | datetime | Время запуска |
| paramsSnapshot | JSON | Снимок параметров запуска (для воспроизводимости) |
| resultSnapshot | JSON | Свод результата (метрики, статус) |

## Таблица C7. ScrapPiece (кусок отхода)

| Поле | Тип | Описание |
|---|---|---|
| id | UUID (PK) | Идентификатор куска |
| inventoryTag | string | Уникальная инвентарная метка (код для печати/сканирования) |
| materialId | UUID (FK → FurMaterial.id) | Материал куска |
| storageLocationId | UUID (FK → StorageLocation.id), NULL | Место хранения куска |
| scrapContour | JSON | Контур куска (оцифрованная геометрия) |
| napDirection | number (float), 0…360°, NULL | Направление ворса |
| metrics | JSON | Измеримые характеристики |

### Таблица C7.2. Перечисления ScrapQuality и ScrapStatus

| Перечисление | Значение | Описание |
|---|---|---|
| ScrapQuality | Good | Кусок пригоден к использованию |
| ScrapQuality | Limited | Пригоден с ограничениями (дефект фиксируется в note) |
| ScrapStatus | Available | Доступен для подбора |
| ScrapStatus | Reserved | Зарезервирован под проект/зону |
| ScrapStatus | Used | Использован (назначен и подтверждён) |
| ScrapStatus | Discarded | Списан (утрата, повреждение и т.п.) |

### Таблица C7.3. Рекомендуемая структура ScrapPiece.scrapContour (JSON)

| Ключ | Тип | Описание |
|---|---|---|
| units | string | Единицы геометрии ("mm") |
| path | JSON | Замкнутый контур куска (точки/сегменты), заданный в мм |
| sourceAssetRef | string, NULL | Ссылка на исходное изображение/скан (опционально) |

### Таблица C7.4. Рекомендуемая структура ScrapPiece.metrics (JSON)

| Ключ | Тип | Ед. | Описание |
|---|---|---|---|
| areaMm2 | float | мм² | Площадь куска |
| bboxWidthMm | float, NULL | мм | Ширина ограничивающего прямоугольника |
| bboxHeightMm | float, NULL | мм | Высота ограничивающего прямоугольника |
| maxSpanMm | float, NULL | мм | Максимальный габарит |
| scrapQuality | ScrapQuality, NULL | — | Качество куска (см. C7.2) |
| scrapStatus | ScrapStatus, NULL | — | Статус куска (см. C7.2) |
| note | string, NULL | — | Комментарий/дефект |
| createdAt | datetime, NULL | — | Дата регистрации |
| updatedAt | datetime, NULL | — | Дата последнего изменения |

## Таблица C8. InventoryLayoutConfig

| Поле | Тип | Описание |
|---|---|---|
| id | UUID (PK) | Идентификатор набора настроек |
| layoutId | UUID (FK → Layout.id) | Для какой выкладки |
| maxCandidates | int | Лимит пула кандидатов scrapPiece |
| filters | JSON | Фильтры отбора scrapPiece |
| constraints | JSON | Ограничения размещения |

## Таблица C9. LayoutRunScrapPlacement

| Поле | Тип | Описание |
|---|---|---|
| layoutRunId | UUID (FK → LayoutRun.id) | Запуск |
| fragmentId | UUID (FK → Fragment.id) | Фрагмент |
| scrapPieceId | UUID (FK → ScrapPiece.id) | Использованный кусок отхода |
| rotationDeg | number | Поворот куска при размещении (градусы) |
| offsetXmm | number | Смещение по X (мм) |
| offsetYmm | number | Смещение по Y (мм) |
| resultContourSnapshot | JSON | Итоговый контур кроя после размещения и подрезки |

---

## Таблица C10. Ключи и ограничения

**ScrapPiece**

| Ограничение | Формулировка |
|---|---|
| PK | id |
| UNIQUE | inventoryTag |
| FK | materialId → FurMaterial.id |
| FK | storageLocationId → StorageLocation.id |

**LayoutRunScrapPlacement**

| Ограничение | Формулировка |
|---|---|
| PK (составной) | (layoutRunId, fragmentId) |
| FK | layoutRunId → LayoutRun.id |
| FK | fragmentId → Fragment.id |
| FK | scrapPieceId → ScrapPiece.id |
| UNIQUE | (layoutRunId, scrapPieceId) |
| INDEX | scrapPieceId |
| INDEX | fragmentId |

---

## F. Складской контур (учёт и трассируемость инвентаря)

### F.1 StorageLocation (место хранения)

| Поле | Тип | Обяз. | Описание |
|---|---|---|---|
| id | UUID (PK) | да | Идентификатор места хранения |
| locCode | string | да | UNIQUE; "BOX-01", "BOX-02" |
| descr | string, NULL | нет | "Короб №2, верхний слой" |

Правило: формат locCode — "BOX-" + двухзначный номер (01–99). Минимальный набор: BOX-01…BOX-10.

### F.2 ScrapReservation (резерв куска)

| Поле | Тип | Обяз. | Описание |
|---|---|---|---|
| id | UUID (PK) | да | Идентификатор записи резерва |
| scrapPieceId | UUID (FK → ScrapPiece.id) | да | Кусок отхода |
| layoutRunId | UUID, NULL (FK → LayoutRun.id) | нет | Резерв "под запуск" |
| fragmentId | UUID, NULL (FK → Fragment.id) | нет | Резерв "под фрагмент" |
| reservedAt | datetime | да | Дата/время резерва |
| releasedAt | datetime, NULL | нет | Дата/время снятия резерва |
| reservedBy | string, NULL | нет | Пользователь/роль |

| Режим резерва | layoutRunId | fragmentId |
|---|---|---|
| Под запуск | задан | NULL |
| Под фрагмент | NULL/задан | задан |
| Складская бронь без привязки | NULL | NULL |

### F.3 ScrapTransaction (журнал операций)

| Поле | Тип | Обяз. | Описание |
|---|---|---|---|
| id | UUID (PK) | да | Идентификатор операции |
| scrapPieceId | UUID (FK → ScrapPiece.id) | да | Кусок отхода |
| transType | enum | да | Receipt / Move / Reserve / Release / UseConfirm / WriteOff |
| transAt | datetime | да | Дата/время операции |
| fromLocId | UUID, NULL | нет | Откуда (NULL для Receipt) |
| toLocId | UUID, NULL | нет | Куда (NULL для WriteOff) |
| statusBefore | ScrapStatus, NULL | нет | Статус до операции |
| statusAfter | ScrapStatus, NULL | нет | Статус после операции |
| note | string, NULL | нет | Комментарий/причина |
| sourceRef | string, NULL | нет | Документ-основание |

---

## X.7 Параметры выкладок

### X.7.1 Общая структура Layout.params и LayoutRun.paramsSnapshot

| Контейнер | Поле | Тип | Определение |
|---|---|---|---|
| Layout | params | JSON | Типоспецифичные параметры выкладки |
| LayoutRun | paramsSnapshot | JSON | Полный снимок параметров запуска |
| LayoutRunScrapPlacement | resultContourSnapshot | JSON | Снимок итоговой геометрии кроя |

### X.7.2 RegularLayoutParams

| Поле | Тип | Определение |
|---|---|---|
| patternId | string | Идентификатор паттерна из библиотеки |
| patternParams | JSON | Параметры выбранного паттерна |
| normalizeRules | JSON (NormalizeRules) | Правила нормализации результата |

### X.7.3 IrregularLayoutParams

| Поле | Тип | Определение |
|---|---|---|
| sourceType | enum | import / draw / stencil |
| contours | JSON | Набор замкнутых контуров |
| stencilId | string (nullable) | Идентификатор трафарета |
| simplifyToleranceMm | number (nullable) | Допуск упрощения, мм |
| normalizeRules | JSON (NormalizeRules) | Правила нормализации результата |

### X.7.4 FillRemainingAreaParams

| Поле | Тип | Определение |
|---|---|---|
| algorithm | enum | Voronoi / Grid |
| algorithmParams | JSON | Параметры алгоритма |
| normalizeRules | JSON (NormalizeRules) | Правила нормализации результата |

### X.7.5 InventoryLayoutParams

| Поле | Тип | Определение |
|---|---|---|
| placementStrategy | enum | greedy / bestFit / manualAssist |
| normalizeRules | JSON (NormalizeRules) | Правила нормализации результата |

### X.7.6 NormalizeRules

| Поле | Тип | Определение |
|---|---|---|
| minFragmentWidthMm | number (nullable) | Минимальная ширина фрагмента, мм |
| minFragmentLengthMm | number (nullable) | Минимальная длина фрагмента, мм |
| simplifyToleranceMm | number (nullable) | Допуск упрощения/сглаживания, мм |
| mergeSmallFragments | boolean (nullable) | Объединение малых фрагментов |
| seamAllowanceReserveMm | number (nullable) | Резерв на припуск/шов, мм |

### X.7.7 VoronoiParams

| Поле | Тип | Определение |
|---|---|---|
| seedCount | int | Количество семян |
| relaxIters | int (nullable) | Итерации релаксации |
| minCellAreaMm2 | number (nullable) | Минимальная площадь ячейки, мм² |

### X.7.8 GridParams

| Поле | Тип | Определение |
|---|---|---|
| gridStepMm | number | Шаг сетки, мм |
| angleDeg | number (nullable) | Угол сетки, градусы |
| minCellAreaMm2 | number (nullable) | Минимальная площадь ячейки, мм² |
