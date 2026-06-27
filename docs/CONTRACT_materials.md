# FurLab — CONTRACT_materials.md

Версия: v1.0  
Дата: 2026-06-06  
Статус: редакция для реализации и приёмки MVP  
Зависимость: `CONTRACT_zones.md v1.5` является старшим контрактом для `Zone`, `zoneContour`, `holes`, `originType`, partition-инварианта и `PromoteFragmentsToZones`.

---

## 0. Назначение контракта

Контракт фиксирует правила работы мехового материала в FurLab: назначение `FurMaterial` зоне, использование параметров волосяного покрова, hole-aware отображение материала, инвалидацию визуализации и критерии приёмки.

Материал в FurLab не создаёт зоны, не создаёт фрагменты и не изменяет разбиение детали. Материал является параметрическим слоем, назначенным на `Zone` и отображаемым только в пределах геометрического домена зоны.

Базовая логика:

```text
Part → Zone → FurMaterial
Part → Zone → Layout → LayoutRun → Fragment
```

Материал участвует в визуализации, фильтрации инвентаря, спецификации и экспорте, но не является геометрическим источником `Zone` или `Fragment`.

---

## 1. Архитектурное правило материала

### 1.1. Материал назначается зоне

Основная связь:

```ts
Zone.materialId → FurMaterial.id
```

`materialId` хранится у зоны. Название материала, цвет, длина волосяного покрова, блеск, плотность и другие характеристики подтягиваются из справочника `FurMaterial`.

Запрещено использовать `materialName` как источник истины. Допустимы только snapshot-поля для отчётов, истории и экспорта:

```ts
materialNameSnapshot
materialPropertiesSnapshot
```

### 1.2. Материал не меняет геометрию зоны

Назначение или изменение материала не должно:

- менять `zoneContour.outer`;
- менять `zoneContour.holes`;
- менять `holeBoundaryLinks`;
- создавать новую `Zone`;
- создавать `Fragment`;
- изменять partition-разбиение детали.

### 1.3. Материал работает по zoneDomain

Материал отображается не по внешнему контуру зоны, а по полному домену зоны:

```text
zoneDomain = zoneContour.outer - zoneContour.holes
```

Если зона содержит holes, материал не должен попадать в эти области.

---

## 2. Термины

| Термин | Каноническое имя | Определение |
|---|---|---|
| Меховой материал | `FurMaterial` | Паспорт материала с визуальными, геометрическими и технологическими свойствами |
| Материал зоны | `Zone.materialId` | Ссылка зоны на `FurMaterial` |
| Домен зоны | `zoneDomain` | Рабочая область зоны: `outer - holes` |
| Направление волосяного покрова зоны | `pileDirectionDeg` | Целевое направление волосяного покрова в зоне |
| Направление волосяного покрова куска | `napDirectionDeg` / `napDirection` | Направление волосяного покрова физического куска инвентаря |
| Материальный snapshot | `materialPropertiesSnapshot` | Снимок параметров материала на момент формирования результата |
| Material render | `materialRender` | Визуальное отображение меховой поверхности внутри зоны |

---

## 3. Модель данных

### 3.1. FurMaterial

```ts
type FurMaterial = {
  id: string;
  name: string;
  properties: FurMaterialProperties;
  schemaVersion?: number;
  updatedAt?: string;
};
```

Минимальный состав `properties`:

```ts
type FurMaterialProperties = {
  generalName?: string;
  color?: ColorValue;
  melanin?: number;
  pheomelanin?: number;

  blankWidthMaxMm?: number;
  blankLengthMaxMm?: number;
  thicknessMm?: number;

  gloss?: number;
  softness?: number;
  fluffiness?: number;

  pileLengthMm?: number;
  pileDiameterMm?: number;
  pileDensityPerIn2?: number;
  tapering?: number;
  segmentation?: number;

  bend?: number;
  curlRadiusMm?: number;
  twistEffect?: number;

  elasticity?: number;
  stretchability?: number;
  fabricWeightGm2?: number;
};
```

### 3.2. Zone material fields

```ts
type Zone = {
  id: string;
  partId: string;

  zoneContour: ZoneContour;

  materialId: string | null;

  pileDirectionMode: "Default" | "Custom";
  pileDirectionDeg: number;

  revision: number;
  updatedAt: string;
};
```

### 3.3. MaterialSnapshot

При создании `LayoutRun`, отчёта или экспорта допускается фиксировать снимок материала:

```ts
type MaterialSnapshot = {
  materialId: string;
  materialNameSnapshot: string;
  materialPropertiesSnapshot: FurMaterialProperties;
  pileDirectionMode: "Default" | "Custom";
  pileDirectionDeg: number;
  capturedAt: string;
};
```

Snapshot не заменяет справочник материалов. Он нужен только для воспроизводимости сформированного результата.

---

## 4. Назначение материала зоне

### 4.1. Предусловия

Перед назначением материала должны выполняться условия:

```text
zone exists
zone.zoneContour valid
material exists, если materialId != null
```

Если материал не найден:

```ts
material_not_found
```

Если зона не выбрана:

```ts
target_zone_not_selected
```

### 4.2. Операция assignMaterial

Операция выполняется как metadata mutation зоны:

```ts
commitZoneMetadataMutation({
  operationType: "assignMaterial",
  zoneId,
  beforeZone,
  candidateZone,
  affectedLayoutIds
})
```

Операция должна:

1. проверить существование зоны;
2. проверить существование материала;
3. обновить `Zone.materialId`;
4. увеличить `zone.revision`;
5. инвалидировать связанные выкладки, preview, отчёты и экспорт;
6. сохранить проект только после успешного commit.

### 4.3. Запрет silent assignment

Запрещено:

- записывать несуществующий `materialId`;
- оставлять старый material render cache после смены материала;
- менять материал без инвалидации Layout/Report/Export;
- считать визуализацию актуальной после изменения `materialId`.

---

## 5. Направление волосяного покрова зоны

### 5.1. Система координат

Во всех операциях применяется единая система координат:

```text
X — вправо
Y — вниз
углы — по часовой стрелке от оси X
диапазон — [0°, 360°)
```

### 5.2. pileDirectionMode

```ts
type PileDirectionMode = "Default" | "Custom";
```

Правила:

- при `Custom` используется `Zone.pileDirectionDeg`;
- при `Default` значение определяется правилом проекта/детали/материала, но результат должен быть приведён к числу в диапазоне `[0, 360)`;
- визуализация материала должна учитывать итоговое направление волосяного покрова зоны.

### 5.3. Ошибки направления

```ts
pile_direction_invalid
pile_direction_missing
pile_direction_mode_invalid
```

---

## 6. Hole-aware material render

### 6.1. Обязательное правило

Любой рендер материала обязан использовать:

```text
zoneDomain = zoneContour.outer - zoneContour.holes
```

Материал не должен отображаться внутри holes.

### 6.2. Canvas/SVG

Canvas/SVG должен использовать один из вариантов:

```text
evenodd fill-rule
clipPath with holes
precomputed polygon difference
```

Если рендерер временно не поддерживает holes, материал для такой зоны должен быть отключён или заменён плоской hole-aware заливкой.

Запрещено показывать меховую заливку по `outer`, если `holes.length > 0`.

### 6.3. GLTF / export material preview

Если создаётся GLTF/preview-объект мехового материала, геометрия визуализации должна строиться по `zoneDomain`, а не по `outer`.

Если GLTF-экспорт не поддерживает holes, экспорт должен:

- либо разбить `zoneDomain` на допустимые полигоны без hole-площадей;
- либо вернуть ошибку;
- либо пометить экспорт как неполный.

Нельзя экспортировать материал внутри holes.

---

## 7. Material render cache

### 7.1. Cache key

Кэш визуализации материала должен зависеть от:

```ts
{
  zoneId,
  zoneRevision,
  zoneContourHash,
  materialId,
  materialVersion,
  materialPropertiesHash,
  pileDirectionMode,
  pileDirectionDeg
}
```

### 7.2. Инвалидация кэша

Кэш сбрасывается при изменении:

- `zoneContour.outer`;
- `zoneContour.holes`;
- `materialId`;
- `FurMaterial.properties`;
- `pileDirectionDeg`;
- `pileDirectionMode`;
- `zone.revision`;
- `schemaVersion`.

Ошибка, если рендер показывает устаревший материал:

```ts
material_render_stale
```

---

## 8. Связь материала с Layout и Fragment

### 8.1. Материал зоны как вход Layout

При `PreviewLayout` и `RunLayout` материал зоны входит в контекст:

```ts
type ZoneContext = {
  zoneId: string;
  zoneRevision: number;
  zoneDomain: PolygonWithHoles;
  materialId: string | null;
  materialSnapshot?: MaterialSnapshot;
  pileDirectionDeg: number;
};
```

### 8.2. Snapshot в LayoutRun

При создании `LayoutRun` должен фиксироваться snapshot материала, если результат зависит от материала или направления волосяного покрова:

```ts
LayoutRun.paramsSnapshot.materialSnapshot
```

### 8.3. Fragment не является владельцем материала

`Fragment` наследует материал от зоны через `zoneId` и `LayoutRun.paramsSnapshot`.

Допустимы snapshot-поля в отчётах:

```ts
fragment.materialIdSnapshot
fragment.materialNameSnapshot
```

Но они не являются источником истины для редактирования.

---

## 9. Совместимость с инвентарём

### 9.1. materialId

Для инвентарной выкладки используется сопоставление:

```text
Zone.materialId == ScrapPiece.materialId
```

Если материал зоны не задан, автоматический подбор кусков блокируется:

```ts
inventory_material_missing
```

### 9.2. direction compatibility

Совместимость направления волосяного покрова проверяется по:

```text
Zone.pileDirectionDeg
ScrapPiece.napDirectionDeg / napDirection
napToleranceDeg
```

Материальный контракт не выполняет размещение кусков. Он только задаёт исходные данные для `CONTRACT_layouts.md`.

---

## 10. Инвалидация производных данных

Изменение материала или направления волосяного покрова зоны должно выполнять:

```ts
zone.revision += 1;
markLayoutsDirty(zone.id, "material_changed");
clearPreviewFragments(zone.id);
markGeneratedPatternsStale(zone.id);
markReportsStale(zone.id);
markExportsStale(zone.id);
invalidateMaterialRenderCache(zone.id);
persistProjectAfterCommit();
```

Если изменение материала не приводит к stale-состоянию связанных результатов, это ошибка:

```ts
material_assignment_without_invalidating_layouts
```

---

## 11. Ошибки

```ts
target_zone_not_selected
zone_not_found
zone_contour_invalid
material_id_missing
material_not_found
material_properties_invalid
material_uses_outer_without_holes
material_paints_hole
material_render_not_hole_aware
material_render_stale
material_cache_key_incomplete
pile_direction_invalid
pile_direction_missing
pile_direction_mode_invalid
inventory_material_missing
material_assignment_without_invalidating_layouts
material_snapshot_missing
```

---

## 12. Enforcement

### 12.1. Единый путь изменения материала

Все операции изменения `materialId`, `pileDirectionMode`, `pileDirectionDeg` должны проходить через:

```ts
commitZoneMetadataMutation()
```

Запрещены прямые записи:

```ts
zone.materialId = ...
zone.pileDirectionDeg = ...
state.zones[index].materialId = ...
```

в обход commit-функции.

### 12.2. Material render gate

Перед отрисовкой мехового материала должна выполняться проверка:

```ts
validateMaterialRenderInput({ zone, material, zoneDomain })
```

Минимальные проверки:

- зона существует;
- материал существует, если `materialId != null`;
- `zoneDomain` построен с учётом holes;
- `zoneDomain` не пустой;
- fill/clip поддерживает holes;
- cache key актуален.

---

## 13. Acceptance tests

### M1. Назначение материала зоне

1. Выбрать зону.
2. Назначить `FurMaterial`.
3. Проверить:
   - `Zone.materialId` обновлён;
   - `zone.revision` увеличен;
   - preview/layout/report/export помечены stale;
   - проект сохранён после commit.

### M2. Зона с hole

1. Создать зону с `zoneContour.holes.length > 0`.
2. Назначить материал.
3. Проверить:
   - материал отображается внутри `outer`;
   - материал не отображается внутри holes;
   - Canvas/SVG использует evenodd/clipPath/difference.

### M3. Запрет outer-only render

1. Создать remainder-зону с hole.
2. Принудительно включить renderer, использующий только `outer`.
3. Проверить ошибку:

```ts
material_uses_outer_without_holes
```

### M4. Инвалидация при смене материала

1. Создать LayoutRun для зоны.
2. Изменить `materialId`.
3. Проверить:
   - `ZoneState = NeedsRegeneration`;
   - старый preview очищен или помечен stale;
   - отчёты stale;
   - export stale.

### M5. Инвалидация при смене направления волосяного покрова

1. Создать зону с `pileDirectionDeg = 90`.
2. Создать preview.
3. Изменить `pileDirectionDeg = 120`.
4. Проверить:
   - material render пересчитан;
   - layout preview stale;
   - отчёты/export stale.

### M6. Reload

1. Назначить материал зоне с hole.
2. Сохранить проект.
3. Перезагрузить проект.
4. Проверить:
   - `materialId` сохранён;
   - `pileDirectionDeg` сохранён;
   - материал не попадает в holes после reload.

### M7. Material snapshot

1. Запустить `RunLayout` для зоны с материалом.
2. Изменить свойства материала в библиотеке.
3. Проверить:
   - старый `LayoutRun.paramsSnapshot.materialSnapshot` не изменился;
   - новый запуск использует новую версию материала.

---

## 14. Verification report для агента

После реализации агент обязан предоставить отчёт:

```md
## Material Contract Verification Report

### Scenario
Что проверялось.

### Expected
Что должно было произойти по контракту.

### Actual
Что произошло фактически.

### Zone state before
JSON зоны до операции.

### Material input
JSON материала.

### ZoneDomain metrics
- outerArea
- holesArea
- zoneDomainArea

### Render evidence
- renderer type
- fill rule / clipPath / polygon difference
- materialInHole: true/false

### Invalidation result
- zone.revision
- layoutsDirty
- previewClearedOrStale
- reportsStale
- exportsStale

### State after reload
JSON после reload.

### Tests
Список тестов.

### Verdict
PASS / FAIL.
```

Задача считается выполненной только при `PASS`.

---

## 15. Итоговое правило реализации

Материал FurLab обязан отображаться и использоваться только в пределах:

```text
zoneDomain = zoneContour.outer - zoneContour.holes
```

Если система не может гарантировать hole-aware отображение материала, операция должна быть заблокирована или переведена в безопасный fallback без заливки holes.
