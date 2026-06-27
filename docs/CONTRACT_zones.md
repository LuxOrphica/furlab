# FurLab — CONTRACT_zones.md

Версия: v1.5  
Дата: 2026-06-06  
Статус: редакция для реализации и приёмки MVP

---

## 0. Назначение контракта

Контракт фиксирует правила работы с зонами в прототипе FurLab: модель данных, инструменты зонирования, редактирование границ, split-операции, валидацию геометрии, undo/redo, persistence, инвалидацию производных данных и критерии приёмки.

Зона в FurLab не является произвольным пользовательским контуром. Зона представляет собой участок детали, в пределах которого назначаются меховой материал, направление волосяного покрова, параметры выкладки и формируются фрагменты.

Базовая логика FurLab:

```text
Part → Zone → Layout → LayoutRun → Fragment → Specification / Export
```

Для инвентарных сценариев добавляется связь:

```text
Fragment → ScrapPiece → LayoutRunScrapPlacement → resultContourSnapshot
```

---

## 1. Архитектурное правило зон

### 1.1. Зона как часть разбиения детали

Зоны одной детали образуют не набор независимых контуров, а разбиение контура детали на участки.

Для каждой детали должен выполняться инвариант:

```text
union(part.zones) == partContour
areaIntersection(zone_i, zone_j) == 0
```

Допускается только совпадение по общей границе смежных зон.

Это означает:

- зоны полностью покрывают контур детали;
- между зонами не должно быть пустот;
- зоны не должны пересекаться по площади;
- смежные зоны имеют общую согласованную границу;
- редактирование одной общей границы должно синхронно обновлять все смежные зоны.

### 1.2. Запрет независимых зон через UI

В MVP пользователь не создаёт независимые `manual`-зоны через UI.

Все инструменты рисования в режиме зонирования используются только для разделения выбранной зоны:

- линия зонирования;
- произвольный полигон;
- прямоугольник;
- эллипс.

Если родительская зона не выбрана, операция разделения не выполняется.

Ошибка:

```ts
target_zone_not_selected
```

### 1.3. Отличие зоны от фрагмента

Зона — область внутри детали, в пределах которой выполняется выкладка.

Фрагмент — результат выкладки внутри зоны.

Пользовательские или импортированные контуры, которые должны сформировать фрагменты внутри зоны, относятся не к `Zone`, а к `IrregularLayout.params.contours`.

---

## 2. Термины

| Термин | Каноническое имя | Определение |
|---|---|---|
| Деталь | `Part` | Элемент изделия, имеющий внешний контур и содержащий одну или несколько зон |
| Контур детали | `partContour` | Исходная граница детали в мм |
| Зона | `Zone` | Участок детали, в пределах которого выполняется выкладка и формируются фрагменты |
| Контур зоны | `zoneContour` | Геометрия зоны: внешний контур и, при необходимости, отверстия |
| Граница зоны | `zoneBoundary` | Ребро, дуга или участок кривой, ограничивающий зону |
| Общая граница | `sharedBoundary` | Граница, принадлежащая двум или более смежным зонам |
| Выкладка | `Layout` | Конфигурация/процедура формирования фрагментов внутри зоны |
| Запуск выкладки | `LayoutRun` | Факт выполнения выкладки с фиксацией параметров |
| Фрагмент | `Fragment` | Замкнутый участок внутри зоны, полученный выкладкой |
| Контур фрагмента | `fragmentContour` | Итоговая геометрия фрагмента после клиппинга и нормализации |
| Инвентарный кусок | `ScrapPiece` | Физический кусок меха с цифровой карточкой |
| Направление волосяного покрова зоны | `pileDirectionDeg` | Целевое направление волосяного покрова в зоне |
| Направление волосяного покрова куска | `napDirection` | Направление волосяного покрова физического куска |

---

## 3. Модель данных

### 3.1. Zone

```ts
type Point = {
  x: number;
  y: number;
};

type ZoneHole = {
  id: string;       // стабильный идентификатор; не меняется при редактировании
  contour: Point[];
};

type ZoneContour = {
  units: "mm";
  outer: Point[];
  holes: ZoneHole[];  // не Point[][], а ZoneHole[] для стабильных ID
};

type ZoneOriginType = "base" | "split" | "promoted" | "legacy";
// "promoted" — зона создана командой PromoteFragmentsToZones, источник: Layout result

type Zone = {
  id: string;
  partId: string;

  displayName: string;

  zoneContour: ZoneContour;

  materialId: string | null;

  pileDirectionMode: "Default" | "Custom";
  pileDirectionDeg: number;

  originType: ZoneOriginType;

  parentZoneId: string | null;
  parentZoneSnapshot: ZoneSnapshot | null;

  splitOperationId: string | null;
  splitDepth: number;

  // Только для promoted-зон:
  promoteOperationId: string | null;   // ID операции PromoteFragmentsToZones
  sourceLayoutRunId: string | null;    // LayoutRun из которого создана зона
  sourceFragmentId: string | null;     // Fragment из которого создана зона

  revision: number;
  schemaVersion: number;

  createdAt: string;
  updatedAt: string;
};
```

### 3.2. HoleBoundaryLink

Связь между дыркой remainder-зоны и соответствующей cut-зоной хранится явно:

```ts
type HoleBoundaryLink = {
  // Для split-операций (L/S/R/E):
  remainderZoneId: string;
  holeId: string;           // стабильный ID из ZoneHole.id
  adjacentZoneId: string;
  adjacentBoundary: "outer";
  splitOperationId: string;

  // Только для promoted-зон (PromoteFragmentsToZones):
  sourceLayoutRunId: string | null;
  sourceFragmentId: string | null;
};
```

**Примечание по holeIndex**: в текущей реализации holes хранятся как `Point[][]` без ID. До миграции на `ZoneHole[]` допустимо использовать `holeIndex: number` как временное поле. После миграции `holeIndex` удаляется, используется только `holeId`.

Хранится в `Zone.holeBoundaryLinks: HoleBoundaryLink[]` у remainder-зоны.

Создаётся:
- автоматически при split-операции L/S/R/E, которая порождает hole;
- командой PromoteFragmentsToZones (API возвращает явные связи с `sourceFragmentId`).

Используется при `editSharedBoundary` для синхронного обновления обеих сторон границы.

### 3.3. Legacy mapping

Если в старом коде используются прежние поля, они должны быть приведены к канону при загрузке:

```ts
detailId = partId
points = zoneContour.outer
holes = zoneContour.holes
napDirectionDeg = pileDirectionDeg
```

Основным источником геометрии является `zoneContour`.

`points` и `holes` как отдельные верхнеуровневые поля допускаются только как legacy-формат загрузки.

### 3.3. Fragment

```ts
type Fragment = {
  id: string;
  layoutRunId: string;
  zoneId: string;

  fragmentContour: {
    units: "mm";
    outer: Point[];
    holes: Point[][];
  };

  areaMm2: number;
  sourceContourId: string | null;   // контур из IrregularLayout.params.contours
};
```

### 3.4. LayoutRun и LayoutPreviewResult

```ts
type LayoutResultSnapshot = {
  fragments: Fragment[];
  remainingArea: { outer: Point[]; holes: Point[][] } | null;
  metrics: {
    totalFragmentAreaMm2: number;
    remainingAreaMm2: number;
  };
};

type LayoutRun = {
  id: string;
  layoutId: string;
  zoneId: string;
  zoneRevisionSnapshot: number;
  paramsSnapshot: object;
  resultSnapshot: LayoutResultSnapshot;
  createdAt: string;
};

type LayoutPreviewResult = {
  previewId: string;
  zoneId: string;
  zoneRevisionSnapshot: number;
  previewFragments: Fragment[];
  remainingArea: { outer: Point[]; holes: Point[][] } | null;
  issues: object[];
};
```

`remainingArea` хранится внутри `LayoutRun.resultSnapshot`, не в `state.zones`. Preview хранится в `state.layoutRun` как временное состояние, не персистируется.

### 3.5. Material fields

`materialId` является основным источником связи зоны с паспортом мехового материала.

`materialName` не должен быть источником истины. Название материала подтягивается из справочника материалов. Допустим `materialNameSnapshot` только для отчётов, истории или экспорта.

---

## 4. Типы происхождения зон

### 4.1. base

`base` — исходная зона, созданная по контуру детали.

Правила:

- создаётся автоматически при загрузке или импорте исходной геометрии детали;
- пользователь не рисует `base`-зону вручную;
- если деталь ещё не разделена, `base`-зона совпадает с `partContour`;
- `base`-зона не удаляется напрямую;
- `base`-зона может быть заменена split-операцией.

Ошибка при прямом удалении:

```ts
base_zone_cannot_be_deleted
```

### 4.2. split

`split` — зона, полученная в результате разделения существующей зоны.

Правила:

- имеет `parentZoneId`;
- имеет `parentZoneSnapshot`;
- имеет `splitOperationId`;
- имеет `splitDepth`;
- может участвовать в дальнейших split-операциях;
- при редактировании общей границы изменяются все смежные split-зоны, использующие эту границу.

### 4.3. promoted

`promoted` — зона, созданная командой PromoteFragmentsToZones из результата Layout.

Правила:

- имеет `parentZoneId` (исходная зона, которую заменяет);
- имеет `parentZoneSnapshot`;
- имеет `promoteOperationId`;
- имеет `sourceLayoutRunId` и `sourceFragmentId` (для remainder — `sourceFragmentId: null`);
- после создания подчиняется тем же правилам что и split-зона: shared boundaries, revision, undo/redo, validation;
- исходный `LayoutRun` становится историей, не управляет promoted-зонами;
- перезапуск Layout создаёт новый LayoutRun, но **не** изменяет уже promoted-зоны.

### 4.4. legacy

`legacy` — зона, загруженная из данных прежней версии проекта.

Правила:

- используется только для миграции;
- новые `legacy`-зоны через UI не создаются;
- при загрузке проходят валидацию;
- если невозможно однозначно восстановить `parentZoneSnapshot`, автоматический restore split запрещается.

Ошибка:

```ts
split_zone_parent_snapshot_missing
```

---

## 5. Именование зон

### 5.1. Общий принцип

`displayName` используется только для отображения в UI.

Логика операций не должна зависеть от имени зоны.

### 5.2. Рекомендуемый шаблон

Для исходной зоны:

```text
Зона {partIndex}
```

Для зон после split:

```text
Зона {partIndex}.{n}
```

Пример:

```text
Зона 6
Зона 6.1
Зона 6.2
```

### 5.3. Внутренние идентификаторы

Для логики используются только:

```ts
id
partId
splitOperationId
parentZoneId
revision
```

---

## 6. Инструменты зонирования

### 6.1. Общие правила

Инструменты зонирования не создают независимые зоны. Они разделяют выбранную родительскую зону.

Перед применением любого инструмента должна быть выбрана зона:

```ts
state.selectedZoneId
```

Если зона не выбрана, операция блокируется:

```ts
target_zone_not_selected
```

Все результаты создаются транзакционно:

```text
draft → validate → geometry operation → validate result → commit → persist
```

---

## 6.2. Линия зонирования (`L`)

Инструмент разделяет выбранную зону открытой линией.

### Требования

- линия должна начинаться на границе выбранной зоны;
- линия должна заканчиваться на границе выбранной зоны;
- допускается ломаная линия из нескольких сегментов;
- линия не должна самопересекаться;
- линия не должна выходить за пределы выбранной зоны;
- линия должна делить выбранную зону на две валидные области;
- результат не должен создавать multipolygon;
- каждая новая зона должна иметь площадь больше `minZoneAreaMm2`.

### Результат

- исходная зона удаляется из актуального состояния;
- создаются две `split`-зоны;
- обе зоны получают один `splitOperationId`;
- линия зонирования становится `sharedBoundary`;
- общая граница хранится согласованно в обеих зонах;
- независимая `manual`-зона не создаётся.

### Ошибки

```ts
target_zone_not_selected
zoning_line_outside_zone
zoning_line_not_touching_boundary
zoning_line_self_intersection
split_would_create_multipolygon
area_too_small
```

---

## 6.3. Произвольный полигон (`S`)

Инструмент формирует замкнутый cut-контур внутри выбранной зоны.

### Требования

- контур должен быть замкнутым;
- контур должен содержать не менее 3 точек;
- контур должен полностью находиться внутри выбранной зоны;
- контур не должен иметь самопересечений;
- результат не должен создавать multipolygon;
- зона-вырез и зона-остаток должны быть валидными.

### Результат

- исходная зона удаляется из актуального состояния;
- создаётся зона-вырез;
- создаётся зона-остаток;
- зона-остаток содержит `zoneContour.holes = [cutContour]`;
- зона-вырез и зона-остаток получают одинаковый `splitOperationId`;
- граница cut-контура становится общей границей между зоной-вырезом и зоной-остатком.

### Ошибки

```ts
target_zone_not_selected
drawn_contour_invalid
drawn_contour_outside_zone
self_intersection
split_would_create_multipolygon
area_too_small
```

---

## 6.4. Прямоугольник (`R`)

Инструмент работает как замкнутый cut-контур прямоугольной формы.

Правила, результат и ошибки совпадают с инструментом `Произвольный полигон`.

---

## 6.5. Эллипс (`E`)

Инструмент работает как замкнутый cut-контур эллиптической формы.

Перед передачей в geometry engine эллипс аппроксимируется полигоном.

Рекомендуемое значение для MVP:

```ts
ellipseSegments = 48
```

Правила, результат и ошибки совпадают с инструментом `Произвольный полигон`.

---

## 7. Инструменты редактирования границ

### 7.1. Общий принцип

Инструменты редактирования работают не с изолированным контуром одной зоны, а с границами разбиения детали.

Если редактируемая вершина, ребро или участок кривой принадлежит общей границе нескольких зон, изменение должно применяться ко всем зонам, использующим эту границу.

Прямое изменение только `selectedZone.zoneContour.outer` запрещено, если редактируемый участок является общей границей.

---

## 7.2. Добавить точку (`X`)

Инструмент добавляет новую точку на выбранное ребро.

### Правила

Если ребро принадлежит внешнему контуру детали, добавление точки допускается только как уточнение аппроксимации без изменения формы `partContour`.

Если ребро является общей границей двух зон, точка добавляется в обе смежные зоны в одинаковой позиции.

### Результат

- обновляются все `affectedZones`;
- общая граница остаётся согласованной;
- не возникает gap/overlap;
- выполняется валидация разбиения детали.

---

## 7.3. Редактировать точку кривой (`V`)

Инструмент редактирует выбранную точку кривой или её управляющие параметры.

### Правила

- если точка принадлежит общей границе, изменение применяется ко всем зонам, использующим эту точку;
- если точка находится на внешнем контуре детали, перемещение запрещено, если оно изменяет `partContour`;
- результат редактирования аппроксимируется в полигональную геометрию и проходит валидацию.

Ошибка:

```ts
part_boundary_locked
```

---

## 7.4. Изменить кривизну (`C`)

Инструмент изменяет кривизну выбранного сегмента или управляющие ручки кривой.

### Правила

- если сегмент является общей границей зон, кривизна меняется синхронно для всех смежных зон;
- после изменения кривая аппроксимируется в полигональный контур;
- результат проходит полную геометрическую валидацию.

Ошибка:

```ts
curve_edit_invalid
```

---

## 7.5. Сгладить кривую (`S`)

Инструмент сглаживает выбранный сегмент или точку кривой.

### Правила

Если сглаживаемый участок является общей границей, результат сглаживания применяется ко всем смежным зонам.

Сглаживание запрещено, если оно приводит к:

- самопересечению;
- выходу за контур детали;
- пересечению с соседними зонами;
- появлению зазора между зонами;
- площади зоны меньше `minZoneAreaMm2`;
- multipolygon-результату.

---

## 7.6. Конфликт горячих клавиш

Клавиша `S` используется в двух контекстах:

- в режиме создания split-контура: `S` = произвольный полигон;
- в режиме редактирования кривой: `S` = сгладить кривую.

Горячие клавиши действуют только в пределах активного режима.

Если режим не определён однозначно, действие не выполняется.

Ошибка:

```ts
ambiguous_tool_context
```

---

## 8. Редактирование смежных зон

### 8.1. Обязательное правило

Если редактируемая граница является общей для нескольких зон, система обязана определить все затронутые зоны (`affectedZones`) и применить изменение ко всем ним.

Редактирование одной зоны не должно создавать:

- зазор между зонами;
- наложение зон;
- рассогласованную общую границу;
- потерю покрытия `partContour`.

### 8.2. Алгоритм

```ts
const affectedZones = findAffectedZonesByBoundary({
  partId,
  selectedZoneId,
  editedBoundaryRef,
});

if (affectedZones.length === 0) {
  rejectEdit("shared_boundary_mismatch");
  return;
}

const beforeZones = clone(affectedZones);

const candidateZones = applySharedBoundaryEdit({
  affectedZones,
  editAction,
});

const issues = validatePartZonePartition({
  partContour,
  zonesForPart: replaceZones(zonesForPart, candidateZones),
});

if (issues.length > 0) {
  rejectEdit(issues);
  return;
}

commitZoneOperation({
  type: "editSharedBoundary",
  beforeZones,
  afterZones: candidateZones,
});

candidateZones.forEach(zone => zone.revision += 1);

invalidateDerivedData(candidateZones.map(z => z.id));

persistZonesCurrentNoReload();
```

### 8.3. Блокировка неоднозначных случаев

Если система не может однозначно определить смежные зоны или общую границу, операция блокируется.

Ошибки:

```ts
shared_boundary_mismatch
boundary_not_editable_mvp
```

---

## 9. Работа с holes

### 9.1. holes как часть геометрии

`zoneContour.holes` являются частью геометрии зоны.

Они должны учитываться при:

- отображении на canvas;
- SVG preview;
- расчёте площади;
- генерации выкладки;
- клиппинге фрагментов;
- спецификации;
- экспорте.

### 9.2. Редактирование hole-границ

`zoneContour.holes` не являются самостоятельными пользовательскими объектами.
Они представляют внутреннюю границу remainder-зоны, возникшую после split-операции.

Если hole соответствует соседней cut-зоне (связь зафиксирована в `holeBoundaryLinks`), его граница может редактироваться через инструменты редактирования общей границы:

- добавить точку;
- переместить точку;
- редактировать точку кривой;
- изменить кривизну;
- сгладить кривую.

При редактировании такой границы система обязана синхронно обновить:

1. `remainderZone.zoneContour.holes[holeIndex]`;
2. `cutZone.zoneContour.outer`.

Операция выполняется как `editSharedBoundary`, а не как прямое изменение `hole`.

После изменения выполняется `validatePartZonePartition`.

Запрещено:

- менять hole без изменения соответствующей cut-зоны;
- двигать hole как независимый объект;
- удалять hole без удаления/слияния соответствующей cut-зоны;
- создавать hole, которому не соответствует зона внутри детали.

---

## 10. Валидация геометрии

### 10.1. validateZoneGeometry

Каждая зона после изменения проходит проверку:

```ts
validateZoneGeometry(zone): ZoneIssue[]
```

Минимальный набор проверок:

- `outer.length >= 3`;
- все координаты конечные: no `NaN`, no `Infinity`;
- площадь зоны больше `minZoneAreaMm2`;
- внешний контур не имеет самопересечений;
- holes находятся внутри outer;
- holes не пересекаются между собой;
- holes не имеют самопересечений;
- зона находится внутри `partContour`;
- зона не является multipolygon.

### 10.2. validatePartZonePartition

После операций split/edit проверяется не только отдельная зона, но и всё разбиение детали:

```ts
validatePartZonePartition(partContour, zonesForPart): ZoneIssue[]
```

Проверки:

- все зоны принадлежат одной детали;
- объединение зон покрывает `partContour`;
- между зонами нет пустот;
- зоны не пересекаются по площади;
- общие границы совпадают;
- каждая зона валидна отдельно;
- на детали остаётся минимум одна зона.

### 10.3. Коды ошибок

```ts
invalid_outer_contour
self_intersection
area_too_small
hole_outside_outer
holes_intersect
zone_outside_part
zone_overlap
zone_partition_gap
zone_partition_overlap
shared_boundary_mismatch
last_zone_cannot_be_deleted
split_would_create_multipolygon
hole_boundary_unlinked
hole_boundary_edit_requires_adjacent_zone
hole_cut_zone_mismatch
```

---

## 11. Split-операции

### 11.1. Общий принцип

Split выполняется только над выбранной зоной.

Нарисованный контур или линия сначала существуют как draft-геометрия и не добавляются в основной список зон.

### 11.2. Порядок выполнения

```text
1. selectedZoneId is required
2. create draft geometry
3. validate draft
4. send to geometry worker/API
5. validate result
6. create candidate zones
7. validate part partition
8. commit
9. persist
```

### 11.3. Запрет частичного commit

Запрещено удалять parent zone до успешного создания и валидации новых зон.

Если geometry API возвращает ошибку, основное состояние проекта не изменяется.

### 11.4. Stale protection

Каждая split-операция содержит:

```ts
operationId
parentZoneId
parentZoneRevision
```

Перед commit система проверяет, что `revision` родительской зоны не изменился.

Если revision устарел:

```ts
stale_zone_revision
```

---

## 12. Multipolygon

В MVP multipolygon-зоны не поддерживаются.

Если результат геометрической операции создаёт несколько несвязанных областей, операция блокируется.

Ошибка:

```ts
split_would_create_multipolygon
```

Будущее расширение может создавать несколько зон с одним `splitOperationId`, но это не входит в MVP.

---

## 13. Транзакционная модель

### 13.1. Общее правило

Все операции с зонами выполняются транзакционно.

Запрещено напрямую изменять `zoneContour.outer`, `zoneContour.holes`, `points` или любые legacy-поля в основном state до валидации.

### 13.2. Схема операции

```text
beforeZones → candidateZones → validate → commit → persist
```

### 13.3. ZoneOperation

```ts
type ZoneOperation = {
  operationId: string;

  type:
    | "createBase"
    | "splitByLine"
    | "splitByPolygon"
    | "splitByRectangle"
    | "splitByEllipse"
    | "editSharedBoundary"
    | "editCurvePoint"
    | "changeCurvature"
    | "smoothCurve"
    | "assignMaterial"
    | "setPileDirection"
    | "delete"
    | "restore";

  beforeZones: ZoneSnapshot[];
  afterZones: ZoneSnapshot[];

  affectedLayoutIds: string[];

  timestamp: string;
};
```

---

## 14. Undo/redo

Undo/redo работает на уровне `ZoneOperation`, а не на уровне отдельных UI-событий.

Поддерживаются:

- split by line;
- split by polygon;
- split by rectangle;
- split by ellipse;
- edit shared boundary;
- add point;
- edit curve point;
- change curvature;
- smooth curve;
- assign material;
- set pile direction.

После undo/redo:

- восстанавливаются зоны из snapshot;
- обновляется `revision`;
- выполняется инвалидация производных данных;
- состояние сохраняется.

---

## 15. Инвалидация производных данных

Любое изменение зоны влияет на результаты, созданные на её основе.

Инвалидация выполняется при изменении:

- `zoneContour`;
- shared boundary;
- `materialId`;
- `pileDirectionDeg`;
- `pileDirectionMode`;
- split/restore/delete.

После изменения:

```ts
zone.revision += 1;

markLayoutsDirty(zone.id, "zone_changed");
clearPreviewFragments(zone.id);
markGeneratedPatternsStale(zone.id);
markReportsStale(zone.id);
markExportsStale(zone.id);
```

Если изменились несколько смежных зон, инвалидация применяется ко всем `affectedZones`.

---

## 16. Persistence и миграция

### 16.1. migrateLoadedZones

Все загружаемые зоны проходят миграцию:

```ts
zone.revision ??= 1;
zone.schemaVersion ??= 1;
zone.splitOperationId ??= null;
zone.splitDepth ??= 0;
zone.parentZoneId ??= null;
zone.parentZoneSnapshot ??= null;

zone.zoneContour ??= {
  units: "mm",
  outer: zone.points ?? [],
  holes: zone.holes ?? [],
};
```

### 16.2. Legacy split zones

Если старая split-зона не имеет `parentZoneSnapshot`, автоматическое восстановление split запрещается.

Ошибка:

```ts
split_zone_parent_snapshot_missing
```

### 16.3. Persistence after commit

Сохранение выполняется только после успешного commit.

Запрещено сохранять промежуточное состояние, в котором parent zone уже удалена, а новые split-зоны ещё не созданы.

---

## 17. DXF import

В MVP импорт DXF не должен создавать независимые пользовательские зоны внутри детали.

DXF используется для загрузки исходной геометрии деталей или для импорта контуров выкладки в `IrregularLayout`.

### 17.1. DXF для деталей

Закрытые контуры деталей импортируются как `Part`.

Для каждой детали создаётся `base`-зона по `partContour`.

### 17.2. DXF для IrregularLayout

Контуры, импортируемые как произвольная геометрия внутри зоны, относятся к:

```ts
IrregularLayout.params.contours
```

Они не создают новые `Zone`.

### 17.3. Preview

DXF import выполняется через preview-этап:

- показать найденные контуры;
- показать предполагаемый тип импорта: Part или Layout contours;
- проверить масштаб/единицы;
- выполнить валидацию;
- добавить данные только после подтверждения.

Ошибки:

```ts
dxf_units_unknown
dxf_contour_invalid
dxf_contour_too_small
dxf_zone_outside_part
dxf_zone_overlap
```

---

## 18. Rendering

Canvas/SVG/render должны использовать одну и ту же геометрию:

```ts
zone.zoneContour.outer
zone.zoneContour.holes
```

### 18.1. holes

Для зон с `holes` требуется корректный fill rule:

```text
evenodd
```

Если material render временно не поддерживает holes, он должен быть отключён для таких зон или заменён плоской заливкой.

Запрещено показывать меховой материал так, как будто holes отсутствуют.

### 18.2. Shared boundaries

Общие границы должны визуально отображаться как одна линия, а не как два рассинхронизированных ребра.

---

## 19. Intarsia / IrregularLayout и зоны

### 19.1. Разграничение слоёв

Intarsia-выкладка и zone partition — разные слои системы.

```text
Zone
  → IrregularLayout / IntarsiaLayout
      → Fragment[]
      → remainingArea (временная геометрия)
```

Результат intarsia-выкладки является результатом Layout, а не новым разбиением детали на Zone.

### 19.2. Что создаёт IntarsiaLayout / IrregularLayout

- `previewFragments` на этапе PreviewLayout;
- `Fragment[]` на этапе RunLayout;
- `remainingArea` — остаточная геометрия для визуального контроля, не сохраняется как Zone.

Эти объекты не являются Zone и не участвуют в partition-инварианте зон.

### 19.3. Запреты

Запрещено:

- автоматически превращать каждый intarsia-фрагмент в Zone;
- создавать remainderZones как постоянные Zone без явной команды пользователя;
- требовать `holeBoundaryLinks` для обычного результата Layout;
- редактировать сгенерированный Fragment как границу Zone;
- хранить `remainingArea` в `state.zones`.

`remainingArea` хранится в `state.layoutRun.remainingArea` и не персистируется вместе с зонами.

### 19.4. Редактирование результата Layout

Редактирование выполняется на уровне исходных контуров:

```text
IrregularLayout.params.contours → PreviewLayout → Fragment[]
```

Пользователь меняет источник → пересчитывает Fragment[].

Запрещено редактировать сгенерированный Fragment как границу Zone, двигать hole remainderZone в обход источника.

### 19.5. PromoteFragmentsToZones

Команда "Преобразовать фрагменты в зоны" — явный переход Layout result → Zone partition.

Нормальный режим intarsia **не** создаёт зоны. Эта команда — отдельное действие пользователя.

**До выполнения команды**: результат intarsia хранится как `Fragment[]` + `remainingArea`. Не влияет на `state.zones`.

**После выполнения команды**:

- каждый выбранный Fragment становится Zone с `originType: "promoted"`;
- `remainingArea` становится remainder Zone с `originType: "promoted"`;
- holes remainder-зоны связываются с outer fragment-зон через `holeBoundaryLinks` (API возвращает явные связи с `sourceFragmentId`, не по индексам);
- исходная parent Zone заменяется promoted-зонами (удаляется из partition);
- promoted-зоны участвуют в partition-инварианте: shared boundaries, no gap/overlap, revision, undo/redo, validation;
- исходный `LayoutRun` сохраняется как история (`sourceLayoutRunId`), но перестаёт быть управляющим слоем для created зон.

**Важно**: после Promote пользователь меняет зоны вручную. Перезапуск Layout создаёт новый `LayoutRun`, но **не** изменяет уже promoted-зоны автоматически.

**API**:

```text
POST /api/geometry/promote-fragments-to-zones
```

Request:
```ts
{
  parentZoneId: string;
  layoutRunId: string;
  fragmentIds: string[];    // какие фрагменты включить
}
```

Response:
```ts
type PromoteFragmentsToZonesResponse = {
  operationId: string;
  parentZoneId: string;

  createdZones: Zone[];

  holeBoundaryLinks: {
    id: string;
    remainderZoneId: string;
    holeId: string;
    adjacentZoneId: string;
    adjacentBoundary: "outer";
    sourceLayoutRunId: string;
    sourceFragmentId: string;
  }[];

  issues: ZoneIssue[];
};
```

Endpoint `/api/intarsia/apply-fragments` используется только для Layout (Fragment[]), не для создания Zone.

### 19.6. Геометрическое восстановление связей (fallback)

Автоматическое восстановление `holeBoundaryLinks` через геометрическое совпадение (`polygonArea(intersection) / polygonArea(hole) > 0.95`) допустимо только как аварийная функция для legacy/repair:

```ts
repairHoleBoundaryLinksForLegacyData(zones)
```

Не используется как основной механизм. Причины: floating point, упрощение контура, изменение порядка holes, один фрагмент → несколько частей после клиппинга.

### 19.7. Именование в API

| Старое (избегать) | Правильное |
|---|---|
| `subZones[]` | `fragmentDrafts[]` / `layoutFragments[]` |
| `remainderZones[]` | `remainingAreas[]` |

Названия `subZones` и `remainderZones` в ответе `/api/intarsia/apply-fragments` помечены как legacy и будут переименованы при рефакторинге.

---

## 20. UI states

Для зон отображаются состояния:

- зона без выкладки;
- зона с заданной выкладкой без генерации;
- зона с preview;
- зона с созданными фрагментами;
- зона с созданными лекалами;
- зона требует перегенерации после изменения.

После редактирования зоны все связанные результаты получают состояние stale.

---

## 21. MVP limitations

### 21.1. Поддерживается в MVP

- создание `base`-зоны по контуру детали;
- split выбранной зоны инструментами: линия зонирования, произвольный полигон, прямоугольник, эллипс;
- редактирование границ зоны инструментами: добавить точку, редактировать точку кривой, изменить кривизну, сгладить кривую;
- синхронное изменение смежных зон при редактировании общей границы;
- проверка отсутствия gap/overlap после каждого изменения;
- holes как часть геометрии;
- undo/redo для операций с зонами;
- revision;
- splitOperationId;
- миграция legacy-зон;
- инвалидация связанных выкладок, фрагментов, отчётов и экспорта.

### 21.2. Не поддерживается в MVP

- создание независимой `manual`-зоны через UI;
- редактирование только одной зоны, если изменяемая граница является общей;
- появление зазоров между зонами;
- появление наложений между зонами;
- ручное изменение внешнего контура детали через редактор зон;
- редактирование hole как независимого объекта в обход `editSharedBoundary` (допустимо только через синхронное изменение смежной cut-зоны, см. §9.2);
- multipolygon-зоны;
- split с частичным выходом cut-контура за пределы родительской зоны;
- автоматический clipping cut-контура;
- автоматическое исправление самопересечений;
- layer-based DXF import без preview и проверки;
- автоматическое превращение intarsia-фрагментов в Zone (допустимо только через явную команду Promote to zones, §19.5);
- `holeBoundaryLinks` для результата Layout — только для split-операций L/S/R/E.

---

## 22. Acceptance tests

### 21.1. Создание base-зоны

1. Загрузить деталь.
2. Проверить, что создана `base`-зона.
3. Проверить:
   - `originType = "base"`;
   - `zoneContour.outer.length >= 3`;
   - `revision = 1`;
   - `schemaVersion` установлен.

### 21.2. Запрет независимой зоны

1. Не выбирать родительскую зону.
2. Нарисовать полигон.
3. Проверить, что новая зона не создана.
4. Проверить ошибку:

```ts
target_zone_not_selected
```

### 21.3. Split линией зонирования

1. Выбрать base-зону.
2. Нарисовать линию от одной границы зоны до другой.
3. Проверить:
   - parent zone отсутствует в актуальном state;
   - созданы две split-зоны;
   - `splitOperationId` одинаковый;
   - union новых зон покрывает исходную зону;
   - gap отсутствует;
   - overlap отсутствует.

### 21.4. Split полигоном

1. Выбрать зону.
2. Нарисовать замкнутый cut-контур внутри зоны.
3. Проверить:
   - parent zone отсутствует;
   - создана cut-зона;
   - создана remainder-зона;
   - remainder имеет `zoneContour.holes.length >= 1`;
   - cut и remainder имеют одинаковый `splitOperationId`;
   - независимая manual-зона не создана.

### 21.5. Split прямоугольником

То же, что split полигоном, но cut-контур формируется инструментом `R`.

### 21.6. Split эллипсом

То же, что split полигоном, но cut-контур формируется инструментом `E`.

Проверить, что эллипс аппроксимирован в полигон и прошёл валидацию.

### 21.7. Контур за пределами зоны

1. Выбрать зону.
2. Нарисовать cut-контур, частично выходящий за пределы зоны.
3. Проверить, что операция заблокирована.
4. Проверить ошибку:

```ts
drawn_contour_outside_zone
```

### 21.8. Multipolygon

1. Выполнить split, который создаёт несколько несвязанных областей.
2. Проверить, что операция заблокирована.
3. Проверить ошибку:

```ts
split_would_create_multipolygon
```

### 21.9. Добавить точку на общей границе

1. Создать две смежные зоны.
2. Добавить точку на общей границе.
3. Проверить:
   - точка появилась в обеих зонах;
   - shared boundary совпадает;
   - gap отсутствует;
   - overlap отсутствует.

### 21.10. Переместить точку общей границы

1. Переместить точку общей границы.
2. Проверить:
   - изменились обе смежные зоны;
   - `revision` увеличился у обеих зон;
   - partition валиден;
   - связанные Layout помечены dirty.

### 21.11. Сгладить общую границу

1. Применить `Сгладить кривую` к общей границе.
2. Проверить:
   - результат применён ко всем смежным зонам;
   - нет самопересечения;
   - нет gap/overlap;
   - partition валиден.

### 21.12. Запрет редактирования внешнего контура детали

1. Попытаться переместить точку, лежащую на внешнем `partContour`.
2. Проверить, что изменение формы детали заблокировано.
3. Проверить ошибку:

```ts
part_boundary_locked
```

### 21.13. Undo split

1. Выполнить split.
2. Нажать undo.
3. Проверить:
   - split-зоны удалены;
   - parent zone восстановлена из snapshot;
   - partition валиден.

### 21.14. Redo split

1. После undo нажать redo.
2. Проверить:
   - split-зоны восстановлены;
   - parent zone отсутствует;
   - partition валиден.

### 21.15. Persistence

1. Выполнить split.
2. Перезагрузить проект.
3. Проверить, что состояние зон совпадает с состоянием после split.

### 21.16. Инвалидация

1. Создать выкладку для зоны.
2. Изменить границу зоны.
3. Проверить:
   - `zone.revision` увеличился;
   - Layout помечен dirty;
   - preview fragments очищены или stale;
   - отчёты stale;
   - export stale.

### 21.17. Редактирование границы hole

1. Выполнить split полигоном над base-зоной.
2. Получить remainder-зону с `zoneContour.holes.length >= 1` и cut-зону.
3. Проверить, что в remainder-зоне создан `holeBoundaryLinks[0]` с корректным `adjacentZoneId`.
4. Выбрать точку на границе hole.
5. Переместить точку.
6. Проверить:
   - изменился `remainderZone.zoneContour.holes[0]`;
   - изменился `cutZone.zoneContour.outer`;
   - границы hole и outer совпадают геометрически;
   - gap отсутствует;
   - overlap отсутствует;
   - partition валиден.

### 21.18. Запрет независимого редактирования hole

1. Попытаться изменить `remainderZone.zoneContour.holes[0]` без синхронизации с cut-зоной.
2. Проверить ошибку:

```ts
hole_boundary_edit_requires_adjacent_zone
```

---

## 22. Verification report для агента

После каждой итерации агент обязан предоставить отчёт:

```md
## Verification Report

### Scenario
Что проверялось.

### Expected
Что должно было произойти по контракту.

### Actual
Что произошло фактически.

### State before
JSON-снимок зон до операции.

### API / worker result
Ответ geometry worker/API.

### Candidate zones
JSON candidate зон перед commit.

### Validation issues
Список ошибок валидации.

### State after commit
JSON-снимок зон после commit.

### State after reload
JSON-снимок зон после persistence/reload.

### UI evidence
Скриншот canvas и дерева зон.

### Tests
Список пройденных тестов.

### Verdict
PASS / FAIL.
```

Задача считается выполненной только при `PASS`.

---

## 23. Debug protocol для split/edit bugs

Если после операции зоны исчезают, появляются независимые зоны, образуются дыры или не отображаются holes, агент обязан остановить реализацию и выполнить forensic debugging.

Обязательные точки логирования:

```ts
console.group("[ZONE DEBUG] before operation");
console.log({ mode, selectedZoneId, zonesBefore });
console.groupEnd();

console.group("[ZONE DEBUG] draft");
console.log({ draftGeometry });
console.groupEnd();

console.group("[ZONE DEBUG] geometry result");
console.log({ result, issues });
console.groupEnd();

console.group("[ZONE DEBUG] candidate");
console.log({ candidateZones, validationIssues });
console.groupEnd();

console.group("[ZONE DEBUG] after commit");
console.log({ zonesAfterCommit });
console.groupEnd();

console.group("[ZONE DEBUG] after reload");
console.log({ zonesAfterReload });
console.groupEnd();
```

Запрещено продолжать архитектурные изменения до выявления конкретной точки поломки.

---

## 24. Итоговое правило реализации

Задача модуля зон — поддерживать корректное разбиение детали на зоны.

Поэтому любое действие с зонами должно сохранять четыре инварианта:

```text
1. зоны покрывают всю деталь;
2. между зонами нет пустот;
3. зоны не пересекаются по площади;
4. общие границы согласованы.
```

Если операция не может сохранить эти инварианты, она должна быть заблокирована.
