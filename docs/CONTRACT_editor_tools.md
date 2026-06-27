# CONTRACT: Zone Editor Tools

**Версия:** 0.6  
**Дата:** 2026-06-09  
**Область:** `furlab-web-plugin` — инструменты редактирования зон  
**История версий:** 0.1 черновик → 0.2 → 0.3 → 0.4 утверждён → 0.5 §3.6 curve-vertex sharedBoundary → 0.6 §3.9 Precision Aids  
**Статус:** partBoundary BLOCK ✅, curve-vertex atomic sharedBoundary sync ✅, smooth-vertex скрыт. BoundaryRef, vertexOnlyContact, zoneContour, Precision Aids — незакрытые tasks (см. §6).

---

## 1. Назначение

Все инструменты редактирования зон (`edit-vertex`, `add-vertex`, `curve-vertex`, `smooth-vertex`, `split-zone`) работают через единый **interaction pipeline**. Контракт описывает обязательные инварианты на каждом этапе — от hit-test до commit/rollback.

Нарушение любого пункта **MUST** считается багом и блокирует приёмку фичи.

---

## 2. Interaction Pipeline

```
mousedown
  └─ hit-test                     → RingRef | miss
       └─ BoundaryRef classify
            ├─ partBoundary        → BLOCK: part_boundary_locked
            ├─ vertexOnlyContact   → BLOCK: boundary_not_editable [vertex_only_contact_not_supported]
            ├─ sharedBoundary      → resolve affectedZones via BoundaryRef
            │    ├─ affectedZones found  → sharedBoundaryLock = true, proceed
            │    └─ affectedZones empty  → BLOCK: shared_boundary_mismatch
            ├─ interior (committed) → BLOCK: boundary_classification_failed
            └─ draftEdge           → normal, proceed

mousemove  (только при proceed)
  └─ apply preview (in-place, NO persist)
       ├─ sharedBoundaryLock → move ALL affectedZone vertices синхронно
       └─ curve-handle       → applyCurveEditPreview(strength)

mouseup    (только при proceed)
  └─ validate
       └─ partitionValid?
            ├─ PASS → commit (pushCommand + persist, все affectedZones атомарно)
            └─ FAIL → rollback ALL affectedZones + user message, stateChanged=false
```

---

## 3. Инварианты

### 3.1 partBoundary: жёсткая блокировка

**Правило:** Вершина или ребро, классифицированные как `partBoundary`, **не редактируются** через drag. Slide вдоль контура — **запрещён** в текущей редакции инструмента.

**Мотивация:** slide по внешней границе без синхронизации `sharedBoundary` стабильно производит gap/overlap. Partition gate не может быть основным защитным механизмом — он страховка, а не нормальный сценарий.

**Поведение при попытке drag:**
- drag не начинается;
- `workspaceInfo`: `"part_boundary_locked"`;
- `stateChanged = false`;
- `state.drag.mode` не устанавливается.

**Допускается:** техническая вставка точки на существующий сегмент `partContour` инструментом `add-vertex` — без изменения формы детали. Последующий drag этой точки **запрещён** (она немедленно получает классификацию `partBoundary`).

**Затронутые originType:** `base`, `split`, `promoted` — для всех без исключения.  
Базовая зона (`originType = "base"`) дополнительно блокирует весь zone-level drag целиком.

**MUST NOT:** Использовать partition gate как замену блокировке. Блокировать нужно на mousedown, до любых изменений state.

---

### 3.2 sharedBoundary редактируется только синхронно

**Правило:** Вершина или ребро, классифицированные как `sharedBoundary`, редактируются только при наличии явно разрешённого `BoundaryRef` с полным списком `affectedZones`. Все зоны из `affectedZones` изменяются атомарно.

**Терминология зон в BoundaryRef:**

| Поле | Значение |
|---|---|
| `primaryZoneId` | зона, которую редактирует пользователь |
| `adjacentZoneIds` | соседние зоны, которые должны измениться синхронно |
| `affectedZoneIds` | `primaryZoneId` + `adjacentZoneIds` (все участники операции) |

**Pipeline при mousedown:**
1. `BoundaryRef.classify(zone, vertexIndex)` → тип + `adjacentZoneIds[]`
2. Для `sharedBoundary`: если `adjacentZoneIds.length === 0` → **BLOCK**: `shared_boundary_mismatch`, drag не начинается
3. Если `adjacentZoneIds.length >= 1` → `sharedBoundaryLock = true`, `affectedZoneIds = [primaryZoneId, ...adjacentZoneIds]`, proceed

**Ожидаемое количество зон по типу:**

| Тип | `adjacentZoneIds.length` | `affectedZoneIds.length` |
|---|---|---|
| `sharedBoundary` | ≥ 1 | ≥ 2 |
| `holeSharedBoundary` | ≥ 1 | ≥ 2 |
| `interior` / `draftEdge` | 0 | 1 |
| `partBoundary` | 0 | 1 (но операция заблокирована) |
| `vertexOnlyContact` | 0 | 1 (но операция заблокирована) |

**Matching:** геометрический — `distance-to-segment + projection + segment-overlap`. Proximity threshold недостаточен. Reversed order учитывается явно (флаг `reversed` в BoundaryRef.ref).

**Fallback `ensureSharedBoundaryVertex`:** допустим как recovery при обнаружении несинхронизированной вершины — но его результат должен быть валидирован: если вставка не прошла, операция блокируется.

**Commit:** undo-команда содержит `siblingChanges` для всех `affectedZones`. Undo откатывает все зоны за одну операцию.

**Текущий статус:** 🚧 PARTIAL

| Инструмент | Статус |
|---|---|
| `edit-vertex` drag | ✅ реализовано; требуется UI-smoke на reversed segment |
| `add-vertex` на sharedBoundary | ✅ реализовано (incl. hole rings) |
| `curve-vertex` на sharedBoundary | ❌ ЗАБЛОКИРОВАНО: `boundary_not_editable [curve_edit_requires_sibling_sync]` |
| `smooth-vertex` | ❌ ОТКЛЮЧЕНО: `boundary_not_editable [smooth_requires_atomic_boundary_sync]` |

---

### 3.3 addPoint на sharedBoundary: классификация ребра обязательна

**Правило:** При добавлении точки инструментом `add-vertex` ребро классифицируется **до** вставки. Поведение зависит от класса ребра:

| Класс ребра | Контекст | Действие |
|---|---|---|
| `draftEdge` | только draft-геометрия (до первого commit) | точка вставляется только в primary zone — допустимо |
| `interior` | committed zone | **BLOCK**: `boundary_classification_failed`. Для сохранённой зоны в валидном partition почти не существует истинно interior рёбер — это подозрительное состояние |
| `partBoundary` | любой | техническая вставка в partContour-сегмент без изменения формы; drag результирующей точки запрещён |
| `sharedBoundary` | любой | точка вставляется в primary zone И во все `adjacentZones` по `BoundaryRef`; если `adjacentZoneIds` пуст → **BLOCK**: `shared_boundary_mismatch` |
| `holeSharedBoundary` | любой | аналогично `sharedBoundary`, ring = `hole`, маршрутизация по `holeId` |
| `unknown` | любой | **BLOCK**: `boundary_classification_failed` |

**Мотивация блокировки `interior` для committed zone:** ребро committed zone в валидном partition является либо `partBoundary`, либо `sharedBoundary`, либо `holeSharedBoundary`. Классификация `interior` означает, что система не нашла соседа — если разрешить локальное движение, это тот же сценарий `shared_boundary_mismatch`, только без явной ошибки.

**Формулировка `edgeLinks = []` как "нормально" — недопустима.** Пустой список нормален только для `draftEdge`. Для committed zone — блокировка.

**MUST:** После успешной вставки: длина соответствующего ring у primary zone и у каждой зоны из `affectedZones` увеличивается ровно на 1.

**Текущий статус:** ✅ реализовано для `sharedBoundary` и `holeSharedBoundary`; классификация `interior` vs `boundary` перед вставкой — 🚧 требует явной проверки.

---

### 3.4 vertexOnlyContact: блокировка

**Правило:** Если вершина классифицирована как `vertexOnlyContact` (зоны касаются только в точке, без общего ребра) — drag **блокируется**.

**Поведение:**
- drag не начинается;
- `workspaceInfo`: `"boundary_not_editable [vertex_only_contact_not_supported]"`;
- `stateChanged = false`.

**Мотивация:** Независимое движение `vertexOnlyContact`-вершины нельзя защищать rollback-ом — rollback является страховкой, а не нормальным сценарием. Полная синхронизация требует BoundaryRef-анализа смежности рёбер (следующая редакция инструмента).

**Текущее состояние:** ⚠️ НЕ РЕАЛИЗОВАНО. `isZoneVertexOnSharedBoundary` использует proximity threshold и не различает `sharedBoundary` и `vertexOnlyContact` явно. Требуется добавить классификацию в BoundaryRef.

---

### 3.5 shared_boundary_mismatch: блокировка без fallback

**Правило:** Если `BoundaryRef.classify` возвращает `type: "sharedBoundary"` но `affectedZones = []` — операция **полностью блокируется**.

**Поведение:**
- drag / add-vertex / curve-edit не начинается;
- `workspaceInfo`: `"shared_boundary_mismatch: общая граница зон должна редактироваться синхронно."`;
- `stateChanged = false`.

**MUST NOT:** Продолжать операцию только для primary zone (локальный drag). Это нарушает топологию.

**Текущее состояние:** ✅ реализовано для drag (stage-interactions.js). Не проверено для `add-vertex` при пустом `edgeLinks` на boundary ребре.

---

### 3.6 curve-vertex на sharedBoundary: только atomic editSharedBoundaryCurve

**Правило:** curve-vertex на вершине `sharedBoundary` разрешён **только** через `editSharedBoundaryCurve` — операцию, которая строит единую геометрию общей границы и атомарно записывает её в обе зоны.

**Запрещено:**
- редактировать кривизну только в primary zone (локальный curve-edit);
- создавать отдельные безье-кривые в primary и sibling независимо;
- commit без `affectedZoneIds.length >= 2`;
- commit без partition gate.

**Обязательная геометрия:**  
sharedBoundary curve — **единый polyline A→B**.  
В primary zone записывается A→B.  
В adjacent zone записывается тот же polyline **B→A** (флаг `reversed = true` из BoundaryRef).

**Pipeline `editSharedBoundaryCurve`:**
1. Построить BoundaryRef → `adjacentZoneIds.length >= 1`, иначе BLOCK: `shared_boundary_mismatch`
2. `beginCurveEdit(primaryZone, vertexIndex)` + сохранить `state.curveEdit.siblingRef`
3. mousemove preview: применить bezier к primary zone + записать тот же polyline reversed в adjacent zone
4. mouseup commit: `commitSharedBoundaryCurveEdit` → `validatePartZonePartition` → при PASS: один pushCommand для всех `affectedZoneIds`; при FAIL: rollback всех affectedZones

**curve-vertex на partBoundary:** BLOCK — `"part_boundary_locked"`.  
**curve-vertex на vertexOnlyContact:** BLOCK — `"boundary_not_editable [vertex_only_contact_not_supported]"`.

**smooth-vertex — отключён (следующая редакция инструмента).**  
smooth без ручного контроля опаснее curve-vertex. При нажатии S: `boundary_not_editable [smooth_requires_atomic_boundary_sync]`. Клавиша S зарезервирована под **Quick Smooth** в следующей редакции (те же требования: atomic sharedBoundary, один undo, partition gate).

**Текущее состояние:** `curve-vertex` partBoundary — ✅ BLOCK. `curve-vertex` sharedBoundary — 🚧 реализуется. `smooth-vertex` — ✅ отключён.

---

### 3.7 Управляемый размер handles

**Правило:** Все визуальные радиусы берутся из `getHandleConfig()` — единственного источника, масштабируемого через `state.ui.handleScale`.

| Ключ | Назначение | Default (scale=1) |
|---|---|---|
| `vertexR` | обычная вершина | 4 px |
| `boundaryR` | вершина на partContour | 5.5 px |
| `hoveredR` | hover | 6.5 px |
| `activeR` | выбранная | 7.5 px |
| `activeGlowR` | glow вокруг active | 10 px |
| `dotR` / `dotHoveredR` / `dotActiveR` | внутренняя точка | 1.4 / 1.7 / 2 px |
| `curveHandleR` / `curveGlowR` | ручка кривой | 5.5 / 9 px |
| `curveCenterR` | центр curve-vertex | 5 px |
| `addVertexR` / `addVertexGlowR` | маркер add-vertex | 4.5 / 8 px |
| `draftDotR` | точка черновика зоны | 3 px |
| `strokeW` / `strokeWActive` | обводка | 1.4 / 1.6 px |

**Hit threshold:** `findVertexAt(worldPoint, 14 * handleScale)` — масштабируется вместе с визуалом. Размер остаётся стабильным в screen-px при zoom.

**UI контрол:** `#handleScaleSelect` (Малый=0.75, Средний=1.0, Крупный=1.5) в "Настройки отображения → Редактор".

**MUST:** Hardcoded числа в `renderScene` недопустимы.

**Текущее состояние:** ✅ реализовано.

---

### 3.8 Commit запрещён при partitionValid = false

**Правило:** Любая операция не может быть применена (persist + undo stack) если `validatePartZonePartition` возвращает хотя бы один issue с `severity: "error"`.

**Применяется к:** drag mouseup, `commitCurveEdit`, `commitZoneMutation` (split, create, promote, add-vertex).

**Rollback:** при FAIL — все затронутые зоны возвращаются к `beforePoints` / `beforeContour`. `stateChanged = false`.

**User feedback:** `workspaceInfo` показывает `partErrors[0].code` (например `"gap"`, `"overlap"`, `"zone_outside_part"`).

**MUST NOT:** `skipValidation: true` — только для системных операций (load, undo/redo). Никогда для user-initiated mutations.

**MUST NOT:** Считать partition gate основным защитным механизмом. Классификация на mousedown (§3.1–3.6) должна блокировать заведомо неверные операции до изменения state.

**Текущее состояние:**
- `commitZoneMutation` — ✅ реализовано
- drag с boundaryLock/sharedBoundaryLock mouseup — ✅ реализовано
- `commitCurveEdit` — ✅ реализовано (rollback при FAIL)
- `smooth-vertex` — ✅ отключён (нет commit)

---

### 3.9 Precision Aids: координаты, направляющие, размеры

**Назначение:** Средства точного редактирования отображают геометрическую информацию, но **не изменяют `state.zones` без явного действия пользователя**. Это отдельный визуально-измерительный слой поверх pipeline редактора.

**Ключевое правило:** Precision aids только отображают — координаты, расстояния, углы, snap-кандидаты, BoundaryRef status. Любое изменение координат проходит через обычный pipeline: hit-test → BoundaryRef → preview → validate → commit/rollback.

---

#### 3.9.1 Координаты точки

Отображаются в миллиметрах проекта (`coordinateMode: "partLocalMm"`).

| Параметр | Когда показывать |
|---|---|
| `hoverPoint {x, y}` | при наведении на любую точку |
| `selectedPoint {x, y}` | при выбранной вершине |
| `dragDelta {dx, dy}` | во время drag, относительно исходной позиции |

**HUD около курсора (минимальный):**
```
x: 124.35 mm
y:  82.10 mm
dx: +4.20 mm   ← только во время drag
dy: -1.50 mm
```

**Статус-строка редактора:**
```
Tool: edit-vertex | Zone: 4.3 | Ring: outer | x=124.35 y=82.10 mm | boundary=sharedBoundary | affectedZones=2
```

---

#### 3.9.2 Параметры активного сегмента

Для выбранного или hover-сегмента:

| Параметр | Описание |
|---|---|
| `lengthMm` | длина сегмента в мм |
| `angleDeg` | угол к горизонтали в градусах |
| `segmentStart` | координаты начальной вершины |
| `segmentEnd` | координаты конечной вершины |

---

#### 3.9.3 BoundaryRef status для выбранной точки

| Поле | Значение |
|---|---|
| `zoneId` | id зоны |
| `ring` | `outer` или `hole` |
| `holeId` | если `ring = hole` |
| `vertexIndex` | индекс в контуре |
| `BoundaryRef.type` | `partBoundary`, `sharedBoundary`, `holeSharedBoundary`, `vertexOnlyContact`, `interior`, `unknown` |
| `primaryZoneId` | зона, которую редактирует пользователь |
| `adjacentZoneIds` | соседние зоны |
| `affectedZoneIds` | все участники операции |

Это особенно полезно для диагностики: сразу видно, почему точка заблокирована или как она классифицирована.

---

#### 3.9.4 Направляющие (visual-only, первая редакция)

**Только visual overlay — никакого автоматического изменения координат.**

| Тип | Описание |
|---|---|
| `horizontal` | горизонталь от выбранной точки |
| `vertical` | вертикаль от выбранной точки |
| `segmentExtension` | продолжение активного сегмента |
| `nearestVertex` | линия до ближайшей вершины |
| `nearestSegment` | проекция на ближайший сегмент |

Отображаются как тонкие пунктирные линии поверх `layerOverlay`. Не влияют на drag.

---

#### 3.9.5 Snap (следующая редакция)

Snap **не смешивать** с visual guides. Snap изменяет итоговые координаты drag и должен явно отображать:

| Поле | Описание |
|---|---|
| `snapType` | `vertex` / `segment` / `partBoundary` / `grid` |
| `snapTargetId` | id зоны или сегмента-цели |
| `snappedPoint` | скоррректированная точка |
| `originalPoint` | исходная точка курсора |
| `snapDistancePx` | расстояние срабатывания |

**MUST:** snap-скорректированная точка проходит через тот же BoundaryRef + partition gate. Snap не может обойти commit pipeline.

**UI:** отдельный toggle "Snap" в настройках редактора. По умолчанию выключен, пока не реализован через BoundaryRef.

---

#### 3.9.6 DEV-блок precisionAid

```json
{
  "precisionAid": {
    "visible": true,
    "coordinateMode": "partLocalMm",
    "hoverPoint": { "x": 124.35, "y": 82.10 },
    "selectedPoint": { "x": 120.15, "y": 83.60 },
    "dragDelta": { "dx": 4.20, "dy": -1.50 },
    "boundaryType": "sharedBoundary",
    "snapType": "segment",
    "snapDistancePx": 3.4,
    "affectedZoneIds": ["43", "22"]
  }
}
```

---

#### 3.9.7 UI настройки "Точность"

```
☑ Координаты точки
☑ Размеры сегментов
☑ Направляющие
☐ Snap к вершинам      ← отложено
☐ Snap к сегментам     ← отложено
☐ Snap к сетке         ← отложено
```

**Текущее состояние:** ❌ НЕ РЕАЛИЗОВАНО. Первый шаг — HUD координат (§3.9.1) и BoundaryRef status (§3.9.3). Направляющие и snap — следующие редакции.

---

## 4. Минимальный BoundaryRef (обязателен в текущей редакции)

BoundaryRef — это явная классификация точки/ребра относительно геометрии раздела. Полный граф смежности — следующая редакция инструмента, но **operation-level BoundaryRef обязателен уже сейчас**. Без него классификация выполняется эвристиками и thresholds, что производит `vertexOnlyContact` vs `sharedBoundary` неоднозначно.

### 4.1 RingRef — результат hit-test

Hit-test обязан возвращать не только `zoneId` и `vertexIndex`, но и ring-level reference: `outer` или `hole`, а для hole — стабильный `holeId`. Индекс hole (`holeIndex`) использовать как источник истины **запрещено** — он нестабилен при вставке/удалении отверстий.

```typescript
type RingRef = {
  zoneId: string;
  ring: "outer" | "hole";
  holeId?: string;       // обязателен при ring = "hole"
  vertexIndex?: number;  // для vertex operations
  edgeIndex?: number;    // для edge operations (add-vertex)
  point?: Point;         // мировые координаты точки клика
};
```

Один `vertexIndex` без `ring + holeId` неоднозначен для зон с отверстиями: один и тот же индекс может ссылаться как на `outer`, так и на `holes[n].contour`. `RingRef` устраняет эту неоднозначность и делает `holeSharedBoundary` технически исполнимым.

---

### 4.2 BoundaryRef — результат классификации

```typescript
type BoundaryRefType =
  | "partBoundary"         // вершина/ребро на контуре детали
  | "sharedBoundary"       // ребро общее с другой зоной
  | "holeSharedBoundary"   // ребро — граница отверстия, смежного с другой зоной
  | "vertexOnlyContact"    // касание только в точке, без общего ребра
  | "interior"             // внутреннее ребро, не смежное ни с чем
  | "unknown";             // не удалось классифицировать → BLOCK

type BoundaryRef = {
  type: BoundaryRefType;
  primaryZoneId: string;       // зона, которую редактирует пользователь
  adjacentZoneIds: string[];   // соседние зоны, изменяются синхронно
  affectedZoneIds: string[];   // primaryZoneId + adjacentZoneIds
  refs: {
    zoneId: string;
    ring: "outer" | "hole";
    holeId?: string;           // hole.id из ZoneHole (не индекс — он нестабилен)
    vertexIndex?: number;
    segmentStartIndex?: number;
    segmentEndIndex?: number;
    reversed: boolean;         // true = порядок вершин в этой зоне обратный
  }[];
};
```

### 4.3 Функция классификации

```typescript
function classifyBoundary(ref: RingRef): BoundaryRef
```

**Алгоритм:**
1. Проверить proximity к `partContour` детали → `partBoundary`
2. Проверить `distance-to-segment + projection + segment-overlap` к рёбрам всех sibling зон (outer + holes) → `sharedBoundary` или `holeSharedBoundary`
3. Если нет совпадения по ребру, но есть совпадение по точке → `vertexOnlyContact`
4. Иначе → `interior`
5. При ошибке классификации → `unknown` → BLOCK

**MUST:** proximity threshold используется только для hit-test. Matching общей границы — геометрический: `distance-to-segment ≤ ε`, `segment-overlap ≥ minOverlap`.

### 4.4 Текущее состояние

⚠️ НЕ РЕАЛИЗОВАНО как явный тип. Сейчас эвристика: `isZoneVertexOnDetailBoundary` + `isZoneVertexOnSharedBoundary` (proximity только). Требует:
- реализовать hit-test, возвращающий `RingRef` (с `ring + holeId`, не только `vertexIndex`)
- добавить `segment-overlap` check для различия `sharedBoundary` vs `vertexOnlyContact`
- оформить результат классификации как `BoundaryRef` объект
- заменить разрозненные флаги (`boundaryLock`, `sharedBoundaryLock`) на единый `currentBoundaryRef` в `state.drag`

---

## 5. Модель геометрии зон

**Каноническая модель** (CONTRACT_zones v1.5):

```typescript
type ZoneHole = {
  id: string;      // стабильный идентификатор отверстия, сохраняется при редактировании
  contour: Point[];
};

zone.zoneContour.outer: Point[]    // внешний контур
zone.zoneContour.holes: ZoneHole[] // отверстия
```

**Legacy:** `holes as Point[][]` нормализуются при загрузке в `ZoneHole[]` (автогенерация `id`). Новый код редактора работает только с `ZoneHole[]` и **обязан сохранять `hole.id`** при любых изменениях контура отверстия. Без стабильного `holeId` невозможна синхронная синхронизация `holeSharedBoundary`.

**Legacy alias** (поддерживается, но не используется в новом коде):

```typescript
zone.points → zone.zoneContour.outer  // только чтение; запись запрещена
```

**MUST:** Все новые операции редактора работают с `zoneContour.outer` и `zoneContour.holes`. Ссылки на `zone.points` в новых commit-операциях недопустимы.

**Rollback** использует `beforeContour = { outer: [...], holes: ZoneHole[] }`, не `beforePoints`.

**Текущее состояние:** ⚠️ код использует `zone.points` как primary. Миграция на `zoneContour` — отдельная задача.

---

## 6. Статус реализации

| Пункт | Статус | Комментарий |
|---|---|---|
| 3.1 partBoundary: жёсткая блокировка | 🚧 PARTIAL | edit-vertex: slide реализован, нужен BLOCK; curve-vertex: ✅ блок на mousedown |
| 3.2 sharedBoundary sync drag (edit-vertex) | 🚧 PARTIAL | Работает; UI-smoke на reversed segment не пройден |
| 3.2 sharedBoundary sync (curve/smooth) | ❌ ЗАБЛОКИРОВАНО | Ждёт sibling sync |
| 3.3 addPoint: классификация ребра | 🚧 PARTIAL | sharedBoundary ✅; interior vs partBoundary — pending |
| 3.4 vertexOnlyContact: блокировка | ❌ НЕ РЕАЛИЗОВАНО | Нет различия с sharedBoundary в текущей эвристике |
| 3.5 shared_boundary_mismatch: drag | ✅ РЕАЛИЗОВАНО | add-vertex при пустом edgeLinks на boundary — не проверено |
| 3.6 curve-vertex: BLOCK на mousedown | ✅ РЕАЛИЗОВАНО | partBoundary + sharedBoundary |
| 3.6 smooth-vertex: отключён | ✅ РЕАЛИЗОВАНО | boundary_not_editable [smooth_requires_atomic_boundary_sync] |
| 3.7 управляемый handleScale | ✅ РЕАЛИЗОВАНО | getHandleConfig(), UI контрол |
| 3.8 commit gate partitionValid | ✅ РЕАЛИЗОВАНО | smooth-vertex нет commit |
| §4 BoundaryRef (operation-level) | ❌ НЕ РЕАЛИЗОВАНО | Эвристика; требует явный тип |
| §5 zoneContour canonical geometry | ❌ LEGACY | zone.points; миграция pending |

---

## 7. Глоссарий

| Термин | Определение |
|---|---|
| `partBoundary` | Canonical `partContour` детали. Источник: DXF/detail contour или registered partContour cache. **Не union текущих зон**: union допустим только как legacy recovery при загрузке; после редактирования не является источником boundary для commit-gate |
| `sharedBoundary` | Ребро (сегмент), общее для двух зон. Определяется геометрически: `distance-to-segment + projection + segment-overlap` |
| `holeSharedBoundary` | Ребро отверстия одной зоны, являющееся границей другой зоны |
| `vertexOnlyContact` | Зоны касаются только в точке, без общего ребра. Не редактируется в текущей редакции инструмента |
| `interior` | Ребро зоны, не смежное ни с `partBoundary`, ни с другой зоной |
| `draftEdge` | Ребро зоны до первого commit (draft-геометрия). Единственный случай, когда local-only операция допустима |
| `RingRef` | Результат hit-test: `{ zoneId, ring, holeId?, vertexIndex?, edgeIndex?, point? }`. Однозначно идентифицирует точку на outer или конкретном hole. `holeIndex` как источник истины запрещён |
| `BoundaryRef` | Результат классификации `RingRef`: тип + `primaryZoneId` + `adjacentZoneIds` + `affectedZoneIds` + `refs[]` с `reversed` |
| `affectedZones` | Список зон из `BoundaryRef.refs`, которые должны быть изменены синхронно |
| `candidateZones` | Массив зон, предлагаемый для commit до прохождения валидации |
| `commitZoneMutation` | Единый шлюз применения изменений: validate → `state.zones = candidates` → persist |
| `partitionValid` | `gapArea < ε && overlapArea < ε` для всех зон детали |
| `shared_boundary_mismatch` | Ошибка: вершина/ребро — `sharedBoundary`, но `affectedZones` пуст |
| `part_boundary_locked` | Ошибка: попытка drag вершины/ребра на `partBoundary` |
| `boundary_not_editable` | Ошибка: операция заблокирована. Reason codes: `curve_edit_requires_sibling_sync`, `smooth_requires_atomic_boundary_sync`, `vertex_only_contact_not_supported`, `boundary_ref_required` |
| `boundary_classification_failed` | Ошибка: ребро committed zone не удалось классифицировать |
| `handleScale` | Множитель размера визуальных элементов редактора (0.5–3.0, default 1.0) |
| `zoneContour` | Каноническая геометрия зоны: `{ outer: Point[], holes: ZoneHole[] }` |
| `ZoneHole` | `{ id: string; contour: Point[] }` — отверстие с стабильным id. Legacy `Point[][]` нормализуется при загрузке |
| `primaryZoneId` | Зона, которую непосредственно редактирует пользователь |
| `adjacentZoneIds` | Соседние зоны, участвующие в синхронном изменении |
| `affectedZoneIds` | `primaryZoneId + adjacentZoneIds` — полный список зон операции |

---

## 8. Acceptance Tests

### T1. partBoundary vertex drag
- Попытка drag вершины внешнего контура любой зоны.
- **Ожидается:** `part_boundary_locked`, drag не начался, `stateChanged = false`, `partitionValid = true`.

### T2. base zone drag
- Попытка drag вершины `originType: "base"` зоны.
- **Ожидается:** `part_boundary_locked`, `stateChanged = false`.

### T3. addPoint на sharedBoundary
- Добавить точку на ребро, общее для двух зон.
- **Ожидается:** точка появилась в обеих зонах, `affectedZoneIds.length >= 2`, `partitionValid = true`.

### T4. drag новой точки sharedBoundary
- Взять точку, добавленную в T3, и сдвинуть её.
- **Ожидается:** обе зоны движутся синхронно, `gapArea = 0`, `overlapArea = 0`, `partitionValid = true`.

### T5. reversed shared segment
- `sharedBoundary` записан в соседней зоне в обратном порядке вершин.
- **Ожидается:** add-vertex и drag работают корректно (`reversed = true` в BoundaryRef).

### T6. vertexOnlyContact
- Зоны касаются только в точке, попытка drag этой вершины.
- **Ожидается:** `boundary_not_editable [vertex_only_contact_not_supported]`, drag не начался, `stateChanged = false`.

### T7. shared_boundary_mismatch
- Соседняя зона существует, но matching segment геометрически не найден.
- **Ожидается:** локальный drag запрещён, `shared_boundary_mismatch`, `stateChanged = false`.

### T8. curve-vertex на sharedBoundary
- Активировать инструмент curve-vertex, выбрать вершину на sharedBoundary.
- **Ожидается:** блокировка на mousedown, `boundary_not_editable [curve_edit_requires_sibling_sync]`, ни preview ни commit не выполняются.

### T9. curve-vertex на partBoundary
- Активировать curve-vertex, выбрать вершину на partBoundary.
- **Ожидается:** `part_boundary_locked`, ручки не появляются.

### T10. smooth-vertex на committed zone
- Нажать S на любой committed zone.
- **Ожидается:** `boundary_not_editable [smooth_requires_atomic_boundary_sync]`, stateChanged = false, зона не изменена.

### T11. handleScale
- Переключить Малый / Средний / Крупный.
- **Ожидается:** visual radius и hit radius меняются пропорционально; при zoom размер стабилен в screen-px.

### T12. commit gate при partitionValid=false
- Вызвать любую операцию, приводящую к gap/overlap.
- **Ожидается:** commit не выполнен, все зоны возвращены в pre-operation state, user видит код ошибки.

### T13. curve-vertex на interior vertex
- Выбрать вершину, не лежащую на partBoundary и не на sharedBoundary.
- **Ожидается:** появились две ручки; drag ручки меняет preview; mouseup при PASS → одна undo-команда; при FAIL → rollback.

### T14. addPoint на draftEdge (до commit)
- Добавить точку на ребро draft-зоны, не смежное ни с чем.
- **Ожидается:** точка только в primary zone, `affectedZoneIds = [primaryZoneId]`, `partitionValid = true`.

### T15. addPoint на interior ребро committed zone
- Committed zone, система классифицировала ребро как `interior` (сосед не найден).
- **Ожидается:** `boundary_classification_failed`, операция заблокирована, `stateChanged = false`.

---

## 9. Открытые вопросы (ответы)

| Вопрос | Решение |
|---|---|
| curve-vertex на sharedBoundary: gate или block? | **BLOCK на mousedown.** `boundary_not_editable [curve_edit_requires_sibling_sync]`. Не "пусть gate откатит". |
| Proximity vs геометрический matching? | Proximity только для hit-test. Matching общей границы — `distance-to-segment + projection + segment-overlap`. |
| smooth-vertex без отдельного тест-плана? | Отключён. Вернётся как Quick Smooth после BoundaryRef + atomic sharedBoundary sync. |
| BoundaryRef — когда? | Operation-level BoundaryRef **нужен в текущей редакции**. Полный граф смежности — следующая редакция инструмента. |
