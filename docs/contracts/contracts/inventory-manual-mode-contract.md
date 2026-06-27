# FurLab — Контракт режима «Из инвентаря (ручной)» v1.1

## 1. Назначение
Режим предназначен для ручной выкладки кусков из инвентаря в выбранной зоне с последующей оценкой, применением и возможностью сброса результата.

## 2. Сценарий работы
1. Пользователь выбирает режим **«Из инвентаря (ручной)»** и работает в одной выбранной зоне.  
2. По кнопке **«Загрузить кандидаты из БД»** загружается пул доступных кусков в лоток.  
3. Пользователь вручную размещает куски в зоне, перемещает их, поворачивает и меняет их порядок по **Z**.  
4. По кнопке **«Оценить»** система пересчитывает текущую рабочую раскладку по фактическим позициям, поворотам и текущему z-order.  
5. По кнопке **«Применить»** текущая ручная раскладка фиксируется как утверждённый результат шага.  
6. После **«Применить»** должна быть доступна кнопка **«Сбросить»**, которая отменяет применённый результат текущего шага и возвращает режим в рабочее состояние редактирования.

## 3. Что видно до Apply
До нажатия **«Применить»** пользователь работает именно с **рабочей раскладкой**, а не с финальной мозаикой результата.

До Apply должны отображаться:
- контуры размещённых кусков;
- припуски кусков;
- направление ворса активного/выбранного куска;
- диагностические слои по необходимости:  
  - **использованная площадь**;  
  - **пересечения**;  
  - **выход за пределы зоны**;  
  - **полезность использования**.

До Apply итоговые фрагменты и швы не считаются финальным результатом и не должны подменять картину размещённых кусков.

## 3.1. Семантика слоёв (обязательно)
Чтобы исключить двусмысленность в ручном режиме, для каждого слоя фиксируется точная геометрия и момент появления.

### До Apply
- **Рабочие области**: `PcoreZ` (внутренняя область куска после вычета припуска, клиппинг в зону).
- **Использовано**: часть `PcoreZ`, которая реально участвует в покрытии при текущем состоянии раскладки.
- **Фрагменты**: не итоговые, как отдельный результат не показываются.
- **Швы**: не показываются.

### После Apply
- **Рабочие области**: опциональный диагностический слой.
- **Использовано**: итоговые использованные части утверждённой раскладки.
- **Фрагменты**: итоговые утверждённые площадные участки результата.
- **Швы**: только линии стыка между разными кусками.

Правило: название слоя в UI обязано соответствовать фактически рисуемой геометрии.

## 4. Припуск куска
Параметр припуска относится **к куску**, а не к зоне.  
Он влияет на расчёт рабочей геометрии куска и должен учитываться при **Оценить**.

Пользователь должен видеть слой **«Припуск куска»** как отдельную геометрию, отличную от полного контура куска.

## 5. Z-порядок
Пользователь должен иметь возможность менять порядок размещённых кусков по **Z** до Apply:
- выше / ниже;
- на передний план / на задний план.

Текущий z-order является частью рабочего состояния раскладки и должен учитываться при **Оценить**.

## 6. Кнопка «Оценить»
Кнопка **«Оценить»** обязана каждый раз пересчитывать актуальное текущее состояние раскладки.

После нажатия обновляются метрики:
- **покрытие**;
- **полезная площадь**;
- **перекрытие**;
- **выход за пределы зоны**;
- **полезность использования**;
- и другие показатели, зависящие от фактической геометрии и z-order.

Повторное нажатие всегда должно давать актуальную переоценку, без устаревших данных.

## 7. Кнопка «Применить»
Кнопка **«Применить»** фиксирует:
- текущие положения кусков;
- их повороты;
- текущий z-order;
- текущий утверждённый результат шага.

После Apply рабочая раскладка считается утверждённой для следующего этапа.

## 8. Кнопка «Сбросить»
После **«Применить»** пользователь должен иметь возможность **сбросить** результат текущего шага.

Сброс должен:
- отменять применённый результат текущего шага;
- убирать итоговые швы и итоговые фрагменты этого шага;
- возвращать режим в состояние ручного редактирования;
- позволять заново двигать куски, менять их z-order и снова выполнять **Оценить / Применить**.

## 9. Швы
Слой **«Швы»** строится **только после Apply**.

Швы определяются как границы между соседними итоговыми участками результата, принадлежащими разным кускам.  
Внешний контур зоны швом не является.

## 10. Правила слоёв
Чекбоксы слоёв влияют только на отображение, но не на математику расчёта.

На расчёт влияют только:
- геометрия кусков;
- их фактическое положение;
- поворот;
- z-order;
- параметр припуска.

## 11. Критерий корректной реализации
Режим считается реализованным корректно, если:
- до Apply пользователь видит и редактирует рабочую раскладку кусков;
- Evaluate пересчитывает текущее состояние с учётом припуска и z-order;
- после Apply фиксируется результат;
- после Apply становятся доступны итоговые швы;
- после Apply доступен сброс результата текущего шага.

## 12. Русские термины
- `outside` → **выход за пределы зоны**
- `utilization` → **полезность использования**

## 13. Terms: Pfull / Pcore / Final Working Region / Seam

### 13.1 Piece (Pfull)
Full physical contour of the piece.

### 13.2 Working area (Pcore)
Part of the piece inside seam allowance that can participate in coverage.

### 13.3 Final working region
Final working region is the part of a piece that after **Apply**:
- is inside the target zone;
- is inside this piece `Pcore`;
- belongs to this piece after overlap resolution by current `z-order`.

Short formula:

`final_region_i = (Pcore_i ? Zone) \ CoveredByHigherZ_i`

Where `CoveredByHigherZ_i` is coverage by pieces above this piece in current stack order.

### 13.4 Important note
A single piece after Apply can have:
- one final region;
- multiple final regions;
- zero final regions (fully covered by higher layers).

### 13.5 Seam
Seam is only a shared **internal** boundary between two neighboring final working regions that belong to **different** pieces.

Not a seam:
- external boundary of the zone;
- external boundary of full piece contour (`Pfull`);
- boundary with no neighboring region from another piece;
- raw intersection/overlap by itself.

### 13.6 Seam build rule
1. Build final working regions (after Apply) from `Pcore` with zone clipping and `z-order`.
2. Extract seams only as shared internal boundaries of neighboring regions with different owners.

## 14. Definition Of Fragment (InventoryLayout / Manual Mode)

### 14.1 Source vs Result
- `ScrapPiece` (piece contour) is the source geometry.
- `Fragment` (`fragmentContour` / `resultContourSnapshot`) is the resulting geometry after layout apply.

Rule:
**piece != fragment**.

### 14.2 Fragment Definition
A **fragment** is a final normalized in-zone result region produced from inventory pieces after Apply:
1. place pieces,
2. clip by zone,
3. resolve overlaps by current `z-order`,
4. normalize by `normalizeRules` (including `seamAllowanceReserveMm`, `mergeSmallFragments`).

### 14.3 Manual Mode Stages
- Before Apply:
  - show pieces, working areas, diagnostic layers,
  - no final fragments yet.
- After Apply:
  - final result is fixed,
  - fragments are built from resulting geometry (`Fragment.fragmentContour` / `resultContourSnapshot`).

### 14.4 No Entity Substitution
Fragments MUST NOT be built directly from `ScrapPiece.scrapContour` or full piece contour.
Fragments MUST be built from final result geometry after clipping and normalization.

### 14.5 Short Rule
**Piece is source. Fragment is result.**

