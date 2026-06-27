# Приложение В. Справочник терминов и атрибутов модели данных FurLab

---

## В.1. Основные сущности — сводная таблица

| Сущность | Назначение |
|----------|-----------|
| `FurMaterial` | Паспорт мехового материала |
| `Part` | Деталь изделия |
| `Zone` | Зона обработки на детали |
| `Fragment` | Геометрический фрагмент результата, сформированный в пределах зоны |
| `Layout` | Конфигурация выкладки для зоны |
| `LayoutRun` | Зафиксированный запуск выкладки с параметрами и результатом |
| `ScrapPiece` | Единица инвентаря меховых кусков |
| `StorageLocation` | Место физического хранения |
| `ScrapReservation` | Резервирование куска под выкладку |
| `ScrapTransaction` | Журнал операций с кусками |
| `InventoryLayoutConfig` | Конфигурация инвентарной выкладки |
| `LayoutRunScrapPlacement` | Запись применения инвентарного куска в результате выкладки |

---

## В.2. FurMaterial — паспорт материала

| Поле | Тип | Описание |
|------|-----|---------|
| `id` | UUID (PK) | Идентификатор материала |
| `name` | string | Наименование/код для UI и отчётов |
| `properties` | JSON | Набор свойств материала (см. В.2.1) |

### В.2.1. Атрибуты FurMaterial.properties

| Группа | Атрибут | Поле | Тип | Единица |
|--------|---------|------|-----|---------|
| Общие сведения | Название | `generalName` | string | — |
| Цвет и пигментация | Цвет | `color` | ColorValue | — |
| Цвет и пигментация | Меланин | `melanin` | float 0..1 | — |
| Цвет и пигментация | Феомеланин | `pheomelanin` | float 0..1 | — |
| Размеры заготовки | Ширина макс. | `blankWidthMaxMm` | float | мм |
| Размеры заготовки | Длина макс. | `blankLengthMaxMm` | float | мм |
| Размеры заготовки | Толщина основы | `thicknessMm` | float | мм |
| Эстетика | Блеск | `gloss` | float 0..1 | — |
| Эстетика | Мягкость | `softness` | float 0..1 | — |
| Эстетика | Опушённость | `fluffiness` | float 0..1 | — |
| Геометрия ворса | Длина ворса | `pileLengthMm` | float | мм |
| Геометрия ворса | Диаметр ворса | `pileDiameterMm` | float | мм |
| Геометрия ворса | Густота ворса | `pileDensityPerIn2` | float | шт/дюйм² |
| Геометрия ворса | Утончение | `tapering` | float 0..1 | — |
| Геометрия ворса | Сегментация | `segmentation` | int | кол-во |
| Ориентация и извитость | Изгиб ворса | `bend` | float 0..1 | — |
| Ориентация и извитость | Радиус извитости | `curlRadiusMm` | float | мм |
| Ориентация и извитость | Эффект скрученности | `twistEffect` | float 0..1 | — |
| Физика полотна | Упругость | `elasticity` | float 0..1 | — |
| Физика полотна | Растяжимость | `stretchability` | float 0..1 | — |
| Физика полотна | Вес полотна | `fabricWeightGm2` | float | г/м² |

---

## В.3. Part — деталь изделия

| Поле | Тип | Описание |
|------|-----|---------|
| `id` | UUID (PK) | Идентификатор детали |
| `name` | string | Наименование/код детали |

---

## В.4. Zone — зона обработки

| Поле | Тип | Описание |
|------|-----|---------|
| `id` | UUID (PK) | Идентификатор зоны |
| `partId` | UUID (FK → Part) | Родительская деталь |
| `materialId` | UUID (FK → FurMaterial) | Материал зоны |
| `zoneContour` | JSON | Граница зоны (замкнутая геометрия) |
| `pileDirectionMode` | enum | `AlongGrain` / `AcrossGrain` / `Custom` |
| `pileDirectionDeg` | float, NULL | Угол направления ворса 0–360°; заполняется при `Custom` |

### В.4.1. ZoneState — вычисляемое состояние зоны

> **Примечание.** `ZoneState` относится к вычисляемым состояниям интерфейса. Его значение определяется по наличию актуального `LayoutRun`, совпадению `paramsSnapshot` с текущими параметрами `Layout` и наличию результата экспорта. В базе данных отдельное поле `ZoneState` не сохраняется.

| Значение | Описание |
|---------|---------|
| `NoResult` | Результат отсутствует |
| `HasResult` | Результат сформирован и актуален |
| `Exported` | Результат конвертирован в выкройки CLO 3D |
| `NeedsRegeneration` | Параметры изменились; требуется пересчёт |

---

## В.5. Fragment — фрагмент выкладки

| Поле | Тип | Описание |
|------|-----|---------|
| `id` | UUID (PK) | Идентификатор фрагмента |
| `zoneId` | UUID (FK → Zone) | Родительская зона |
| `fragmentContour` | JSON | Итоговый контур, полученный после отсечения контуром зоны |
| `areaMm2` | float | Площадь фрагмента, мм² |

---

## В.6. Layout — конфигурация выкладки

| Поле | Тип | Описание |
|------|-----|---------|
| `id` | UUID (PK) | Идентификатор конфигурации выкладки |
| `zoneId` | UUID (FK → Zone) | Зона, для которой настроена выкладка |
| `layoutType` | enum | `RegularLayout` / `IrregularLayout` / `InventoryLayout` / `FillRemainingAreaLayout` |
| `params` | JSON | Параметры выкладки (структура зависит от `layoutType`) |

---

## В.7. LayoutRun — зафиксированный запуск выкладки

| Поле | Тип | Описание |
|------|-----|---------|
| `id` | UUID (PK) | Идентификатор прогона |
| `layoutId` | UUID (FK → Layout) | Ссылка на конфигурацию выкладки |
| `startedAt` | datetime | Время запуска |
| `paramsSnapshot` | JSON | Снимок параметров на момент запуска (для воспроизводимости) |
| `resultSnapshot` | JSON | Сводка результата (метрики, статус) |

---

## В.8. ScrapPiece — единица инвентаря

| Поле | Тип | Описание |
|------|-----|---------|
| `id` | UUID (PK) | Идентификатор куска |
| `inventoryTag` | string, UNIQUE | Инвентарная метка (формат `FL-SCR-XXXXXX`) |
| `materialId` | UUID (FK → FurMaterial) | Материал куска |
| `storageLocationId` | UUID (FK → StorageLocation), NULL | Место хранения |
| `scrapContour` | JSON | Оцифрованный контур куска (см. В.8.1) |
| `napDirection` | float 0..360°, NULL | Угол направления ворса |
| `metrics` | JSON | Метрические и учётные характеристики (см. В.8.2) |

### В.8.1. ScrapPiece.scrapContour (JSON)

| Ключ | Тип | Описание |
|------|-----|---------|
| `units` | string | Единицы геометрии (`"mm"`) |
| `path` | JSON | Замкнутый контур куска — массив точек `{x, y}` в мм |
| `sourceAssetRef` | string, NULL | Ссылка на исходный скан (опционально) |

### В.8.2. ScrapPiece.metrics — метрики и учётное состояние

| Ключ | Тип | Единица | Описание |
|------|-----|---------|---------|
| `areaMm2` | float | мм² | Площадь куска |
| `bboxWidthMm` | float, NULL | мм | Ширина описывающего прямоугольника |
| `bboxHeightMm` | float, NULL | мм | Высота описывающего прямоугольника |
| `maxSpanMm` | float, NULL | мм | Максимальная протяжённость (диагональ) |
| `scrapQuality` | enum, NULL | — | Качество куска (см. В.8.3) |
| `scrapStatus` | enum, NULL | — | Статус куска (см. В.8.3) |
| `note` | string, NULL | — | Комментарий / описание дефекта |
| `createdAt` | datetime, NULL | — | Дата регистрации |
| `updatedAt` | datetime, NULL | — | Дата последнего изменения |

### В.8.3. ScrapQuality и ScrapStatus

| Перечисление | Значение | Описание |
|-------------|---------|---------|
| ScrapQuality | `Good` | Кусок пригоден к использованию |
| ScrapQuality | `Limited` | Пригоден с ограничениями (требует комментария) |
| ScrapStatus | `Available` | Доступен для выбора |
| ScrapStatus | `Reserved` | Зарезервирован под проект / зону |
| ScrapStatus | `Used` | Использован (подтверждено) |
| ScrapStatus | `Discarded` | Списан (утрата, повреждение) |

---

## В.9. StorageLocation — место хранения

| Поле | Тип | Обяз. | Описание |
|------|-----|-------|---------|
| `id` | UUID (PK) | да | Идентификатор |
| `locCode` | string, UNIQUE | да | Код ячейки формата `BOX-01`…`BOX-99` |
| `description` | string, NULL | нет | Произвольное описание ячейки |

---

## В.10. ScrapReservation — журнал резервирования

| Поле | Тип | Обяз. | Описание |
|------|-----|-------|---------|
| `id` | UUID (PK) | да | Идентификатор записи |
| `scrapPieceId` | UUID (FK → ScrapPiece) | да | Кусок |
| `layoutRunId` | UUID, NULL | нет | Прогон выкладки, под который резерв |
| `fragmentId` | UUID, NULL | нет | Фрагмент, под который резерв |
| `reservedAt` | datetime | да | Дата/время резервирования |
| `releasedAt` | datetime, NULL | нет | Дата/время снятия резерва |
| `reservedBy` | string, NULL | нет | Пользователь / роль |

---

## В.11. ScrapTransaction — журнал операций

| Поле | Тип | Обяз. | Описание |
|------|-----|-------|---------|
| `id` | UUID (PK) | да | Идентификатор операции |
| `scrapPieceId` | UUID (FK → ScrapPiece) | да | Кусок |
| `transType` | enum | да | Тип операции (см. В.11.1) |
| `transAt` | datetime | да | Дата/время операции |
| `fromLocId` | UUID, NULL | нет | Откуда (NULL при поступлении) |
| `toLocId` | UUID, NULL | нет | Куда (NULL при списании) |
| `statusBefore` | ScrapStatus, NULL | нет | Статус до операции |
| `statusAfter` | ScrapStatus, NULL | нет | Статус после операции |
| `note` | string, NULL | нет | Комментарий / причина |
| `sourceRef` | string, NULL | нет | Ссылка на документ-основание |

### В.11.1. ScrapTransaction.transType

| Значение | Описание |
|---------|---------|
| `Receipt` | Поступление куска в инвентарь |
| `Move` | Перемещение между ячейками хранения |
| `Reserve` | Резервирование под выкладку |
| `Release` | Снятие резерва |
| `UseConfirm` | Подтверждение факта использования |
| `WriteOff` | Списание |

---

## В.12. InventoryLayoutConfig — конфигурация инвентарной выкладки

| Поле | Тип | Описание |
|------|-----|---------|
| `id` | UUID (PK) | Идентификатор конфигурации |
| `layoutId` | UUID (FK → Layout) | К какой выкладке относится |
| `maxCandidates` | int | Максимальный размер пула ScrapPiece на прогон |
| `filters` | JSON | Фильтры отбора кусков (материал, ворс, площадь, качество) |
| `constraints` | JSON | Геометрические ограничения (повороты, смещения, допуски) |

---

## В.13. LayoutRunScrapPlacement — запись применения куска

| Поле | Тип | Описание |
|------|-----|---------|
| `id` | UUID (PK) | Идентификатор записи размещения |
| `layoutRunId` | UUID (FK → LayoutRun) | Прогон выкладки |
| `fragmentId` | UUID (FK → Fragment) | Фрагмент |
| `scrapPieceId` | UUID (FK → ScrapPiece) | Использованный кусок |
| `rotationDeg` | float | Угол поворота куска при размещении, градусы |
| `offsetXmm` | float | Смещение по X, мм |
| `offsetYmm` | float | Смещение по Y, мм |
| `resultContourSnapshot` | JSON | Итоговая геометрия куска после отсечения |

Рекомендуемый первичный ключ: `id` или составной ключ `(layoutRunId, fragmentId, scrapPieceId)`. Уникальность пары `(layoutRunId, scrapPieceId)` не задаётся, поскольку один инвентарный кусок после отсечения или разбиения на связные компоненты может соответствовать нескольким `Fragment`.

---

## В.14. Схема связей сущностей

```
FurMaterial ──────────────────────────────────────────────┐
    │ 1                                                     │
    │ N                                                     │
  Zone ←── Part                                            │
    │ 1                                                     │
    │ N                                                     │
  Fragment ──────────────── LayoutRunScrapPlacement        │
    │ N         (fragmentId)        │ N (scrapPieceId)     │
    │                               │                      │
  Layout ──────────────────    ScrapPiece ────────────────►┘
    │ 1           (layoutId)        │ 1   (materialId)
    │ N                             │ N
  LayoutRun                   ScrapTransaction
    │ 1                             │
    │ N                        ScrapReservation
  LayoutRunScrapPlacement ◄────────┘
  (layoutRunId)

  ScrapPiece ──────────────── StorageLocation
             (storageLocationId)
```
