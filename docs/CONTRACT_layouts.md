# FurLab — CONTRACT_layouts.md

Версия: v1.0  
Дата: 2026-06-06  
Статус: редакция для реализации и приёмки MVP  
Зависимость: `CONTRACT_zones.md v1.5` является старшим контрактом для `Zone`, `zoneContour`, `holes`, partition-инварианта, `PromoteFragmentsToZones`, undo/redo и persistence зон.

---

## 0. Назначение контракта

Контракт фиксирует правила выполнения выкладок FurLab: создание `Layout`, предпросмотр, запуск `LayoutRun`, формирование `Fragment`, расчёт `remainingArea`, использование `ScrapPiece`, фиксацию `LayoutRunScrapPlacement`, hole-aware клиппинг и критерии приёмки.

Выкладка в FurLab не создаёт независимые зоны и не изменяет partition-разбиение детали.

Базовая цепочка:

```text
Part → Zone → Layout → LayoutRun → Fragment → Specification / Export
```

Для инвентарных сценариев:

```text
Fragment → ScrapPiece → LayoutRunScrapPlacement → resultContourSnapshot
```

---

## 1. Архитектурное правило выкладок

### 1.1. Layout не является Zone

`Layout` — конфигурация/процедура формирования фрагментов внутри выбранной зоны.

`Fragment` — результат выкладки внутри зоны.

`Layout` может создавать:

- `previewFragments`;
- `LayoutRun`;
- `Fragment[]`;
- `remainingArea`;
- `LayoutRunScrapPlacement` для инвентарных сценариев.

`Layout` не может создавать `Zone`.

Исключение: явная команда `PromoteFragmentsToZones`, которая не является выкладкой и регулируется `CONTRACT_zones.md`.

### 1.2. Запрет изменения state.zones

Любая операция выкладки запрещена к прямому изменению:

```ts
state.zones
zone.zoneContour
zone.zoneContour.outer
zone.zoneContour.holes
holeBoundaryLinks
```

Если в процессе выкладки нужно превратить фрагменты в зоны, используется только отдельная команда:

```text
PromoteFragmentsToZones
```

### 1.3. Все выкладки работают по zoneDomain

Перед любой генерацией строится рабочий домен зоны:

```text
zoneDomain = zoneContour.outer - zoneContour.holes
```

Все фрагменты, размещения, маски, остаточные области и метрики считаются по `zoneDomain`, а не по `outer`.

---

## 2. Термины

| Термин | Каноническое имя | Определение |
|---|---|---|
| Выкладка | `Layout` | Конфигурация формирования фрагментов внутри зоны |
| Запуск выкладки | `LayoutRun` | Факт выполнения выкладки с фиксацией параметров и результата |
| Предпросмотр | `LayoutPreviewResult` | Временный результат, не записывающий постоянные Fragment |
| Фрагмент | `Fragment` | Геометрический результат выкладки внутри зоны |
| Остаточная область | `remainingArea` | Часть `zoneDomain`, не покрытая фрагментами |
| Домен зоны | `zoneDomain` | Рабочая область зоны: `outer - holes` |
| Инвентарный кусок | `ScrapPiece` | Физический кусок меха с цифровой карточкой |
| Размещение куска | `LayoutRunScrapPlacement` | Запись связи `Fragment → ScrapPiece` с трансформацией и snapshot-геометрией |
| Назначение кусков | `ScrapAssignment` | Операционный сценарий назначения `ScrapPiece` на уже существующие `Fragment`; не `layoutType` |
| Split & Return | `inventory_split_return` | Инвентарный сценарий размещения, вырезания использованной видимой части и возврата остатков в инвентарь |

---

## 3. Модель данных

### 3.1. Layout

```ts
type LayoutType =
  | "RegularLayout"
  | "IrregularLayout"
  | "FillRemainingAreaLayout"
  | "InventoryLayout";

type Layout = {
  id: string;
  zoneId: string;
  layoutType: LayoutType;
  params: object;
  createdAt?: string;
  updatedAt?: string;
};
```

### 3.2. LayoutRun

```ts
type LayoutRun = {
  id: string;
  layoutId: string;
  zoneId: string;
  zoneRevisionSnapshot: number;
  paramsSnapshot: object;
  resultSnapshot: LayoutResultSnapshot;
  createdAt: string;
};
```

### 3.3. LayoutResultSnapshot

```ts
type LayoutResultSnapshot = {
  fragments: Fragment[];
  remainingArea: GeometryWithHoles | null;
  metrics: {
    totalFragmentAreaMm2: number;
    unionFragmentAreaMm2: number;
    remainingAreaMm2: number;
    zoneDomainAreaMm2: number;
    coveredRatio: number;
  };
  issues: LayoutIssue[];
};
```

### 3.4. LayoutPreviewResult

```ts
type LayoutPreviewResult = {
  previewId: string;
  layoutId: string;
  zoneId: string;
  zoneRevisionSnapshot: number;
  paramsSnapshot: object;
  previewFragments: FragmentDraft[];
  remainingArea: GeometryWithHoles | null;
  metrics: LayoutResultSnapshot["metrics"];
  issues: LayoutIssue[];
};
```

Preview хранится во временном состоянии UI/cache. Preview не является постоянным `Fragment[]` и не записывается в `state.zones`.

### 3.5. Fragment

```ts
type Fragment = {
  id: string;
  layoutRunId: string;
  zoneId: string;
  fragmentContour: GeometryWithHoles;
  areaMm2: number;
  sourceContourId: string | null;

  // Для инвентарных сценариев:
  sourceScrapPieceId?: string | null;
  stackOrder?: number | null;
};
```

`fragmentContour` — итоговая видимая/используемая геометрия после клиппинга по `zoneDomain` и применения правил перекрытия.

### 3.6. GeometryWithHoles

```ts
type GeometryWithHoles = {
  units: "mm";
  outer: Point[];
  holes: Point[][] | ZoneHole[];
};
```

Для новых данных предпочтителен формат `ZoneHole[]` со стабильными `id`. Для результата выкладки допустим `Point[][]`, если результат не редактируется как зона.

---

## 4. ZoneDomain

### 4.1. Построение домена

Перед любой операцией выкладки система обязана построить:

```ts
const zoneDomain = buildZoneDomain(zone.zoneContour);
```

где:

```text
zoneDomain = outer - holes
```

### 4.2. Требования

`zoneDomain` должен быть:

- валидным;
- непустым;
- без самопересечений;
- в единицах `mm`;
- согласованным с актуальной `zone.revision`.

Если `zoneDomain` пустой:

```ts
zone_domain_empty
```

Если holes проигнорированы:

```ts
layout_uses_outer_without_holes
```

### 4.3. Запреты

Запрещено:

- строить фрагменты внутри holes;
- считать holes доступной площадью;
- включать holes в `remainingArea`;
- экспортировать фрагменты внутри holes;
- рассчитывать `coveredRatio` по `outer` без вычитания holes.

---

## 5. Общий workflow Layout

### 5.1. CreateLayout

```ts
CreateLayout({ zoneId, layoutType }) → layoutId
```

Предусловия:

```text
zone exists
layoutType valid
```

Результат:

```text
создан Layout
Fragment не создан
state.zones не изменён
```

### 5.2. UpdateLayoutParams

```ts
UpdateLayoutParams({ layoutId, params })
```

Требования:

- параметры валидируются по `layoutType`;
- старый preview очищается или переводится в stale;
- существующие `LayoutRun` не изменяются;
- `Zone` не изменяется.

### 5.3. PreviewLayout

```ts
PreviewLayout({ layoutId, zoneId }) → LayoutPreviewResult
```

PreviewLayout:

- читает `Zone`, `Layout`, `FurMaterial`, `InventoryLayoutConfig` при необходимости;
- строит `zoneDomain`;
- формирует `previewFragments`;
- формирует `remainingArea`;
- считает метрики;
- не создаёт постоянные `Fragment`;
- не меняет `state.zones`;
- фиксирует `zoneRevisionSnapshot`.

### 5.4. RunLayout

```ts
RunLayout({ layoutId, zoneId, previewId? }) → LayoutRun
```

RunLayout разрешён только если:

- зона существует;
- `zoneRevisionSnapshot` совпадает с `zone.revision`;
- `Layout.params` валидны;
- результат проходит `validateLayoutResult`;
- все фрагменты клиппированы по `zoneDomain`.

RunLayout создаёт:

- `LayoutRun`;
- `Fragment[]`;
- `LayoutResultSnapshot`;
- при инвентарных сценариях — `LayoutRunScrapPlacement[]` после подтверждения размещений.

---

## 6. Layout result commit gate

### 6.1. Обязательная функция

Ни один результат выкладки не может попасть в постоянное состояние без:

```ts
commitLayoutResult({
  operationType,
  layout,
  zone,
  zoneDomain,
  candidateFragments,
  remainingArea,
  placementsDraft,
  paramsSnapshot
})
```

### 6.2. Внутренняя валидация

`commitLayoutResult` обязан вызвать:

```ts
validateLayoutResult({
  layoutType,
  zone,
  zoneDomain,
  candidateFragments,
  remainingArea,
  placementsDraft,
  paramsSnapshot
})
```

Проверки:

- каждый `Fragment` находится внутри `zoneDomain`;
- ни один `Fragment` не попадает в holes;
- `Fragment.areaMm2 > minFragmentAreaMm2`;
- `remainingArea` находится внутри `zoneDomain`;
- `remainingArea` не включает holes;
- `coveredRatio` считается по `zoneDomain`;
- `zoneRevisionSnapshot == zone.revision`;
- `Fragment` не является `Zone`;
- `state.zones` не изменяется.

### 6.3. Ошибка блокирует commit

Если есть ошибки:

- `LayoutRun` не создаётся;
- `Fragment` не создаётся;
- `LayoutRunScrapPlacement` не создаётся;
- `state.zones` не меняется;
- persistence не выполняется;
- возвращаются `issues` и метрики.

---

## 7. RegularLayout

### 7.1. Назначение

`RegularLayout` формирует регулярный паттерн в пределах `zoneDomain`.

Поддерживаемые варианты:

- продольная;
- поперечная;
- диагональная / ёлочка;
- смещение рядов;
- радиальная.

### 7.2. Параметры

```ts
type RegularLayoutParams = {
  patternId: string;
  patternParams: object;
  normalizeRules?: NormalizeRules;
};
```

### 7.3. Процесс

1. Построить candidate-паттерн в координатах зоны.
2. Выполнить clipping по `zoneDomain`.
3. Вычесть holes зоны.
4. Применить `normalizeRules`.
5. Удалить пустые и слишком малые фрагменты.
6. Сформировать `previewFragments` или `Fragment[]`.
7. Рассчитать `remainingArea = zoneDomain - union(fragments)`.

### 7.4. Запреты

Запрещено:

- строить фрагменты по `outer` без holes;
- создавать фрагменты внутри holes;
- считать hole остатком зоны;
- сохранять фрагмент без клиппинга по `zoneDomain`.

---

## 8. IrregularLayout / IntarsiaLayout

### 8.1. Назначение

`IrregularLayout` формирует фрагменты по произвольным контурам:

- импорт;
- рисование;
- трафарет;
- интарсия.

`IrregularLayout.params.contours` — источник фрагментов, а не источник зон.

### 8.2. Параметры

```ts
type IrregularLayoutParams = {
  sourceType: "import" | "draw" | "stencil";
  contours: SourceContour[];
  stencilId?: string | null;
  simplifyToleranceMm?: number | null;
  normalizeRules?: NormalizeRules;
};
```

### 8.3. Процесс

1. Получить исходные контуры из `params.contours`.
2. Привести контуры к координатам зоны.
3. Проверить замкнутость и отсутствие самопересечений.
4. Клиппировать каждый контур по `zoneDomain`.
5. Если контур полностью попал в hole — не создавать фрагмент.
6. Если контур пересекает hole — вычесть часть внутри hole.
7. Применить z-order / stack order, если контуры пересекаются между собой.
8. Сформировать `previewFragments` или `Fragment[]`.
9. Рассчитать `remainingArea = zoneDomain - union(fragments)`.

### 8.4. Запреты

Запрещено:

- автоматически превращать irregular/intarsia-фрагменты в `Zone`;
- писать `remainingArea` в `state.zones`;
- создавать `holeBoundaryLinks` для обычного результата Layout;
- редактировать сгенерированный `Fragment` как границу зоны;
- считать holes доступной областью для интарсии.

---

## 9. FillRemainingAreaLayout

### 9.1. Назначение

`FillRemainingAreaLayout` формирует фрагменты в остаточной области зоны.

Остаточная область считается так:

```text
remainingTarget = zoneDomain - union(existingFragments)
```

Holes зоны не являются остаточной областью.

### 9.2. Параметры

```ts
type FillRemainingAreaLayoutParams = {
  algorithm: "Voronoi" | "Grid";
  algorithmParams: object;
  sourceLayoutRunId?: string | null;
  normalizeRules?: NormalizeRules;
};
```

### 9.3. Процесс

1. Построить `zoneDomain`.
2. Получить `existingFragments`, если заполнение выполняется после другой выкладки.
3. Рассчитать `remainingTarget = zoneDomain - union(existingFragments)`.
4. Исключить holes зоны.
5. Выполнить Voronoi/Grid внутри `remainingTarget`.
6. Клиппировать ячейки по `remainingTarget`.
7. Применить `normalizeRules`.
8. Сформировать фрагменты.

### 9.4. Запреты

Запрещено:

- заполнять holes зоны;
- считать holes остаточной площадью;
- создавать ячейки вне `zoneDomain`;
- менять исходные `existingFragments`.

---

## 10. InventoryLayout

### 10.1. Назначение

`InventoryLayout` формирует фрагменты на основе физических кусков `ScrapPiece`.

Поддерживаемые стратегии:

```ts
placementStrategy:
  | "manualAssist"
  | "greedy"
  | "bestFit"
  | "nfp_sa"
  | "inventory_split_return"
```

`inventory_split_return` может быть реализован как отдельный режим внутри `InventoryLayout.params` или как значение стратегии. В любом случае он подчиняется правилам этого раздела.

### 10.2. Общие входные данные

```ts
type InventoryLayoutConfig = {
  layoutId: string;
  maxCandidates: number;
  filters: object;
  constraints: object;
};
```

Обязательные данные:

- `zoneDomain`;
- `Zone.materialId`;
- `Zone.pileDirectionDeg`;
- пул `ScrapPiece`;
- `scrapContour` каждого куска;
- `napDirectionDeg` / `napDirection` каждого куска;
- `constraints`.

### 10.3. Общие запреты

Запрещено:

- flip/mirror физического куска;
- игнорировать `napToleranceDeg`;
- размещать итоговый `Fragment` внутри holes;
- строить `resultContourSnapshot` по `outer` без holes;
- создавать `Fragment` с нулевой площадью;
- использовать кусок без `scrapContour`;
- считать hole доступной площадью зоны.

Допустимы только повороты и смещения:

```ts
T = rotate(rotationDeg) + translate(offsetXmm, offsetYmm)
```

### 10.4. manualAssist

Ручное размещение кусков создаёт `placementsDraft`.

До подтверждения:

- `Fragment` не сохраняется;
- `LayoutRunScrapPlacement` не создаётся;
- статус `ScrapPiece` не меняется.

После подтверждения:

1. transformed scrap contour клиппируется по `zoneDomain`;
2. holes зоны вычитаются;
3. результат становится `fragmentContour` или `resultContourSnapshot`;
4. создаётся `Fragment`;
5. создаётся `LayoutRunScrapPlacement`.

Если raw placements перекрываются, итоговая сохраняемая геометрия должна быть однозначной:

- либо перекрытие запрещается;
- либо применяется stack order и сохраняется visible contour;
- либо операция возвращает warning и не учитывает overlap в покрытии дважды.

### 10.5. greedy / bestFit

Для `greedy` и `bestFit` целевая область на каждом шаге:

```text
residual = zoneDomain - union(acceptedVisibleFragments)
```

Кусок принимается, если результат после clipping по `zoneDomain` и вычитания holes имеет положительную площадь и проходит ограничения.

Метрики покрытия считаются по union visible fragments.

### 10.6. nfp_sa

Для `nfp_sa` raster zoneMask строится по:

```text
zoneDomain = outer - holes
```

Запрещено строить `zoneMask` только по `outer`.

Параметры:

```ts
{
  maxSolveMs: number;
  seed?: number | null;
  seamAllowanceReserveMm: number;
  napTargetDeg: number;
  napToleranceDeg: number;
  minWidthMm?: number;
  minLengthMm?: number;
  maxCandidates: number;
}
```

Постобработка:

```text
core_i = T_i(inset(scrapContour_i, seamAllowanceReserveMm)) ∩ zoneDomain
frag_i = core_i - union(previousVisibleFragments)
uncoveredAreas = zoneDomain - union(core_i)
coveredRatio = Area(union(core_i)) / Area(zoneDomain)
```

Термин `holes` запрещено использовать для непокрытых областей результата NFP+SA. Использовать:

```text
uncoveredAreas
```

### 10.7. Inventory Split & Return

`inventory_split_return` — последовательное размещение кусков с вычислением видимой использованной области и возвратом остатков в инвентарь.

Правила:

1. Куски размещаются последовательно.
2. Каждый кусок трансформируется только поворотом и смещением.
3. Flip/mirror запрещены.
4. Видимая использованная часть считается внутри `zoneDomain`.
5. При перекрытии действует явный порядок stack order: последний сверху, если не задано иначе.
6. Использованная часть сохраняется как `usedVisibleContourSnapshot`.
7. Остатки куска сохраняются как `leftoverContoursSnapshot`.
8. Остатки не должны включать часть, реально использованную как visible fragment.

Минимальная модель результата:

```ts
type ScrapSplitEvent = {
  id: string;
  sourceScrapPieceId: string;
  layoutRunId: string;
  fragmentId: string;
  usedVisibleContourSnapshot: GeometryWithHoles;
  leftoverContoursSnapshot: GeometryWithHoles[];
  createdAt: string;
};
```

Если `ScrapSplitEvent` ещё не реализован, результат Split & Return считается частичным и не должен маркироваться как complete.

---

## 11. ScrapAssignment

### 11.1. Статус

`ScrapAssignment` — не `layoutType`.

Это операционный сценарий постобработки:

```text
существующие Fragment → назначение ScrapPiece → LayoutRunScrapPlacement
```

### 11.2. Правила

ScrapAssignment не создаёт новую геометрию фрагментов.

Перед назначением нужно проверить:

- `Fragment` существует;
- `Fragment.fragmentContour` находится внутри `zoneDomain`;
- `Fragment` не пересекает holes зоны;
- `ScrapPiece` существует;
- материал и направление волосяного покрова совместимы;
- поворот/смещение соответствуют constraints.

### 11.3. Результат

Создаётся:

```ts
LayoutRunScrapPlacement {
  layoutRunId,
  fragmentId,
  scrapPieceId,
  rotationDeg,
  offsetXmm,
  offsetYmm,
  resultContourSnapshot
}
```

`resultContourSnapshot` должен соответствовать фрагменту, а не outer зоны.

---

## 12. NormalizeRules

Общий блок:

```ts
type NormalizeRules = {
  minFragmentWidthMm?: number | null;
  minFragmentLengthMm?: number | null;
  simplifyToleranceMm?: number | null;
  mergeSmallFragments?: boolean | null;
  seamAllowanceReserveMm?: number | null;
};
```

NormalizeRules применяются только после клиппинга по `zoneDomain`.

Запрещено нормализовать фрагмент так, чтобы он:

- вышел за `zoneDomain`;
- попал в hole;
- получил самопересечение;
- стал multipolygon без явной обработки связных компонент.

Если после нормализации фрагмент состоит из нескольких связных компонент, каждая компонента становится отдельным `Fragment` или операция возвращает controlled issue.

---

## 13. Stale protection

### 13.1. zoneRevisionSnapshot

Каждый preview и run фиксирует:

```ts
zoneRevisionSnapshot = zone.revision
```

Если зона изменилась после preview:

```ts
zone_revision_mismatch
```

RunLayout блокируется до повторного preview/recompute.

### 13.2. paramsSnapshot

`LayoutRun.paramsSnapshot` должен хранить полный снимок:

- `Layout.params`;
- `InventoryLayoutConfig`, если применимо;
- material snapshot, если результат зависит от материала;
- `zoneRevisionSnapshot`;
- seed для детерминированных алгоритмов;
- version алгоритма.

---

## 14. Metrics

### 14.1. Area metrics

Все площади считаются по `zoneDomain`:

```ts
zoneDomainAreaMm2 = Area(zoneDomain)
unionFragmentAreaMm2 = Area(union(fragmentContours))
remainingAreaMm2 = Area(zoneDomain - union(fragmentContours))
coveredRatio = unionFragmentAreaMm2 / zoneDomainAreaMm2
```

`totalFragmentAreaMm2` допускается как сумма площадей фрагментов, но не используется для покрытия, если фрагменты могут пересекаться.

### 14.2. Holes

Площадь holes не входит в:

- доступную площадь зоны;
- остаточную область;
- coveredRatio;
- экспортируемую площадь фрагментов.

---

## 15. Persistence

### 15.1. Preview

Preview не сохраняется как постоянный результат.

Допускается временный cache:

```ts
state.layoutRun.previewFragments
state.layoutRun.remainingArea
```

но он должен очищаться при изменении зоны, материала или параметров выкладки.

### 15.2. Run

После успешного `commitLayoutResult` сохраняются:

- `LayoutRun`;
- `Fragment[]`;
- `LayoutRun.resultSnapshot`;
- `LayoutRunScrapPlacement[]`, если применимо.

Не сохраняются:

- `previewFragments` как постоянные фрагменты;
- `remainingArea` в `state.zones`;
- generated zones без `PromoteFragmentsToZones`.

---

## 16. Export / Specification

### 16.1. Specification

Спецификация строится по:

```text
Part → Zone → LayoutRun → Fragment
```

Для инвентаря добавляется:

```text
Fragment → LayoutRunScrapPlacement → ScrapPiece
```

Фрагменты, попадающие в holes, не должны попадать в спецификацию.

### 16.2. Export

DXF/экспорт использует:

```ts
Fragment.fragmentContour
```

а не `Zone.outer` и не raw placement contour.

`resultContourSnapshot` для инвентарных кусков должен быть уже клиппирован по `zoneDomain`.

---

## 17. Ошибки

```ts
zone_not_found
zone_domain_empty
zone_contour_invalid
layout_type_invalid
layout_params_invalid
layout_uses_outer_without_holes
fragment_outside_zone_domain
fragment_inside_hole
fragment_intersects_hole
fragment_self_intersection
fragment_area_too_small
fragment_overlap
remaining_area_invalid
remaining_area_includes_hole
zone_revision_mismatch
preview_missing
preview_stale
layout_result_invalid
layout_result_commit_failed
generated_zone_forbidden
state_zones_mutation_forbidden
inventory_material_missing
scrap_piece_missing
scrap_piece_not_available
scrap_contour_missing
nap_direction_missing
nap_tolerance_violation
inventory_piece_mirror_forbidden
placement_result_empty
result_snapshot_invalid
split_return_not_implemented
```

---

## 18. Enforcement

### 18.1. Единый commit gate

Все операции, которые сохраняют результат выкладки, проходят через:

```ts
commitLayoutResult()
```

Запрещены прямые записи:

```ts
state.fragments.push(...)
state.layoutRuns.push(...)
state.zones = ...
```

в обход commit-gate.

### 18.2. Audit прямых изменений

Агент обязан проверить кодовую базу на:

```text
state.zones =
state.fragments =
state.fragments.push
LayoutRun без validateLayoutResult
Fragment без clipping по zoneDomain
zoneContour.outer без zoneContour.holes
```

Каждое найденное место должно быть:

- удалено;
- переведено на `commitLayoutResult`;
- или явно обосновано как migration/read-only/test fixture.

---

## 19. Acceptance tests

### L1. RegularLayout with hole

1. Создать зону с hole.
2. Запустить `RegularLayout`.
3. Проверить:
   - ни один `Fragment` не попадает в hole;
   - `remainingArea` не включает hole;
   - `coveredRatio` считается по `zoneDomain`.

### L2. IrregularLayout contour crossing hole

1. Создать контур, пересекающий hole.
2. Запустить PreviewLayout.
3. Проверить:
   - часть внутри hole вычтена;
   - фрагмент остался только внутри `zoneDomain`.

### L3. IrregularLayout contour inside hole

1. Создать source contour полностью внутри hole.
2. Запустить PreviewLayout.
3. Проверить:
   - `Fragment` не создан;
   - issue содержит controlled warning или empty result.

### L4. FillRemainingAreaLayout with hole

1. Создать зону с hole.
2. Запустить `FillRemainingAreaLayout`.
3. Проверить:
   - ячейки Voronoi/Grid не попадают в hole;
   - hole не считается остаточной областью.

### L5. InventoryLayout manualAssist with hole

1. Разместить `ScrapPiece` поверх hole.
2. Подтвердить placement.
3. Проверить:
   - `resultContourSnapshot` не содержит площадь hole;
   - `Fragment.fragmentContour` внутри `zoneDomain`.

### L6. InventoryLayout nfp_sa with hole

1. Создать зону с hole.
2. Запустить `nfp_sa`.
3. Проверить:
   - `zoneMask` построен по `zoneDomain`;
   - coveredRatio не учитывает hole;
   - uncoveredAreas не включает hole.

### L7. ScrapAssignment

1. Взять существующий `Fragment`.
2. Назначить `ScrapPiece`.
3. Проверить:
   - новая геометрия фрагмента не создана;
   - создан `LayoutRunScrapPlacement`;
   - `resultContourSnapshot` соответствует `Fragment.fragmentContour`.

### L8. Inventory Split & Return

1. Разместить кусок в режиме `inventory_split_return`.
2. Проверить:
   - flip/mirror не применён;
   - usedVisibleContour внутри `zoneDomain`;
   - leftovers не включают использованную видимую часть;
   - created split event или controlled partial status.

### L9. Revision mismatch

1. Выполнить PreviewLayout.
2. Изменить зону.
3. Попытаться RunLayout по старому preview.
4. Проверить ошибку:

```ts
zone_revision_mismatch
```

### L10. Запрет записи в zones

1. Выполнить Regular/Irregular/Inventory layout.
2. Проверить:
   - `state.zones.length` не изменился;
   - `state.zones` не содержит `remainingArea`;
   - `state.zones` не содержит generated fragments.

### L11. Reload

1. Выполнить RunLayout.
2. Сохранить проект.
3. Перезагрузить проект.
4. Проверить:
   - `LayoutRun` восстановлен;
   - `Fragment[]` восстановлены;
   - фрагменты не попадают в holes;
   - `ZoneState` корректно пересчитан.

---

## 20. Verification report для агента

После реализации агент обязан предоставить отчёт:

```md
## Layout Contract Verification Report

### Scenario
Что проверялось.

### Expected
Что должно было произойти по контракту.

### Actual
Что произошло фактически.

### Inputs
- layoutType
- placementStrategy, если есть
- zoneId
- zoneRevision
- materialId

### ZoneDomain metrics
```json
{
  "outerArea": 0,
  "holesArea": 0,
  "zoneDomainArea": 0
}
```

### Preview result
```json
{
  "previewId": "...",
  "previewFragmentsCount": 0,
  "remainingAreaMm2": 0,
  "issues": []
}
```

### Validation metrics
```json
{
  "fragmentsCount": 0,
  "unionFragmentAreaMm2": 0,
  "remainingAreaMm2": 0,
  "coveredRatio": 0,
  "fragmentsInsideZoneDomain": true,
  "fragmentsIntersectHoles": false,
  "remainingAreaIncludesHoles": false,
  "partitionZonesMutated": false
}
```

### Commit result
```json
{
  "committed": true,
  "layoutRunId": "...",
  "fragmentsSaved": 0,
  "placementsSaved": 0
}
```

### State after reload
JSON после reload.

### Tests
Список тестов.

### Verdict
PASS / FAIL.
```

Задача считается выполненной только при `PASS`.

---

## 21. Итоговое правило реализации

Любая выкладка FurLab обязана выполнять все геометрические операции по:

```text
zoneDomain = zoneContour.outer - zoneContour.holes
```

Если алгоритм не умеет учитывать holes, он не должен создавать `Fragment`, `LayoutRun`, `LayoutRunScrapPlacement`, отчёт или экспортный результат.

Layout result не является Zone. Переход `Fragment → Zone` разрешён только через явную команду `PromoteFragmentsToZones` из `CONTRACT_zones.md`.
