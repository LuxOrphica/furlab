# Приложение Г. Состав атрибутов и ER-схема инвентаря меховых кусков

> **Соотношение с Приложением В.** Приложение В описывает **логическую модель** данных (концептуальные сущности и их связи). Настоящее приложение описывает **физическую схему** хранения для сущности `ScrapPiece` и связанных таблиц — с конкретными именами полей БД, типами и ограничениями. Отличия в именах полей связаны с разными уровнями описания: логическим и физическим.

---

## Г.1. Сущность ScrapPiece — полный состав атрибутов

| Атрибут | Поле БД | Тип | Единица / Диапазон | Описание |
|---------|---------|-----|--------------------|----------|
| **Идентификация** |
| Уникальный идентификатор | `id` | UUID | — | Первичный ключ записи |
| Инвентарная метка | `inventoryTag` | TEXT(64), UNIQUE | — | Печатная метка формата `FL-SCR-XXXXXX`; основной ключ поиска |
| **Геометрия и метрики** |
| Контур куска | `scrapContour` | JSON (MEMO) | — | Оцифрованная граница куска: `{units:"mm", path:[{x,y},...]}` |
| Площадь | `areaMm2` | DOUBLE | мм² | Вычисляется из контура |
| Ширина габарита | `bboxWidthMm` | DOUBLE | мм | Ширина описывающего прямоугольника |
| Высота габарита | `bboxHeightMm` | DOUBLE | мм | Высота описывающего прямоугольника |
| Максимальный габарит | `maxSpanMm` | DOUBLE | мм | Максимальная протяжённость (диагональ) |
| Угол направления ворса | `napDirectionDeg` | DOUBLE | 0–360° | Угол метки ворса на мездре; ориентация стрелки от основания к концу. В логической модели (Приложение В) поле обозначено `napDirection` — физическое имя `napDirectionDeg` уточняет единицы измерения |
| **Качество и статус** |
| Статус куска | `scrapStatus` | TEXT(20) | Available / Reserved / Used / Discarded | Статус жизненного цикла |
| Качество куска | `scrapQuality` | TEXT(20) | Good / Limited | Оценка качества; Limited требует комментария |
| Комментарий | `note` | TEXT(255) | — | Описание дефекта (обязательно при Limited) |
| **Связи** |
| Материал | `materialId` | UUID (FK) | — | Ссылка на FurMaterial (паспорт материала) |
| Место хранения | `storageLocationId` | UUID (FK), NULL | — | Ссылка на StorageLocation (ячейка хранения) |
| **Аудит** |
| Дата создания | `createdAt` | DATETIME | — | Момент регистрации записи |
| Дата обновления | `updatedAt` | DATETIME | — | Момент последнего изменения |

---

## Г.2. Жизненный цикл статусов ScrapPiece

```
             reserve()                use()
Available ────────────► Reserved ──────────► Used
    ▲                      │                  │
    │      release()        │   use()          │
    └───────────────────────┘                  │
                                               │
Любой статус ─────────────────────────────► Discarded
              writeOff()
```

| Переход | Метод | Из статуса | В статус | Обратимость |
|---------|-------|-----------|---------|-------------|
| Резервирование | `reserve()` | Available | Reserved | Обратимый |
| Снятие резерва | `release()` | Reserved | Available | Обратимый |
| Подтверждение использования | `use()` | Available / Reserved | Used | Необратимый |
| Списание | `writeOff()` | Любой | Discarded | Необратимый |

Все переходы фиксируются в таблице `ScrapTransaction` с полями `statusBefore`, `statusAfter`, `transAt`, `transType`, `sourceRef`.

---

## Г.3. ER-схема связанных сущностей

```
┌─────────────────┐       ┌──────────────────┐
│   FurMaterial   │       │  StorageLocation  │
│─────────────────│       │──────────────────│
│ id (PK)         │       │ id (PK)           │
│ name            │       │ locCode (BOX-XX)  │
│ colorHex        │       │ description       │
│ pileLengthMm    │       └────────┬─────────┘
│ pileDensity...    │                │ 0..1
│ gloss           │                │
│ ...             │                │
└────────┬────────┘                │
         │ 1                       │
         │                         │
         │ N                       │
┌────────▼─────────────────────────▼────────────┐
│                  ScrapPiece                    │
│───────────────────────────────────────────────│
│ id (PK)                                        │
│ inventoryTag (UNIQUE)                          │
│ materialId (FK → FurMaterial)                  │
│ storageLocationId (FK → StorageLocation, NULL) │
│ scrapContour (JSON)                            │
│ areaMm2                                        │
│ bboxWidthMm, bboxHeightMm, maxSpanMm           │
│ napDirectionDeg                                │
│ scrapStatus                                    │
│ scrapQuality                                   │
│ note                                           │
│ createdAt, updatedAt                           │
└──────┬────────────────────────┬────────────────┘
       │ 1                      │ 1
       │ N                      │ N
┌──────▼──────────┐    ┌────────▼──────────────────┐
│ ScrapReservation│    │    ScrapTransaction        │
│─────────────────│    │───────────────────────────│
│ id (PK)         │    │ id (PK)                   │
│ scrapPieceId(FK)│    │ scrapPieceId (FK)          │
│ layoutRunId(FK) │    │ transType                  │
│ fragmentId(FK)  │    │ statusBefore               │
│ reservedAt      │    │ statusAfter                │
│ releasedAt      │    │ transAt                    │
│ reservedBy      │    │ fromLocId (FK)             │
└─────────────────┘    │ toLocId (FK)               │
                       │ note, sourceRef            │
                       └───────────────────────────┘
       │
       │ (ScrapPiece участвует в выкладках)
       │
┌──────▼──────────────────────────────┐
│     LayoutRunScrapPlacement         │
│─────────────────────────────────────│
│ id (PK)                             │
│ layoutRunId (FK → LayoutRun)        │
│ fragmentId  (FK → Fragment)         │
│ scrapPieceId (FK → ScrapPiece)      │
│ rotationDeg                         │
│ offsetXmm, offsetYmm                │
│ resultContourSnapshot (JSON)        │
└─────────────────────────────────────┘
```

---

## Г.4. Описание вспомогательных сущностей

**FurMaterial** — паспорт материала (сокращённый состав; полный перечень атрибутов см. В.2.1):
`id`, `name`, `colorHex`, `pileLengthMm`, `hairThicknessMm` (физический псевдоним `pileDiameterMm` логической модели), `pileDensityPerIn2`, `gloss`, `softness`, `stretchability`

**StorageLocation** — ячейка физического хранения:
`id`, `locCode` (формат BOX-01…BOX-99), `description`

**ScrapReservation** — журнал резервирования:
`id`, `scrapPieceId`, `layoutRunId`, `fragmentId`, `reservedAt`, `releasedAt`, `reservedBy`

**ScrapTransaction** — журнал полного аудита операций:
`id`, `scrapPieceId`, `transType` (Receipt / Move / Reserve / Release / UseConfirm / WriteOff), `statusBefore`, `statusAfter`, `transAt`, `fromLocId`, `toLocId`, `note`, `sourceRef`

**LayoutRunScrapPlacement** — трассируемость размещения:
`id`, `layoutRunId`, `fragmentId`, `scrapPieceId`, `rotationDeg`, `offsetXmm`, `offsetYmm`, `resultContourSnapshot`
