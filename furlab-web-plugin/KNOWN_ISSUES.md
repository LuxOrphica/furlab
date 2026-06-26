# Known Issues / Отложенные задачи

## [EDIT-VERTEX-FRAGMENT] Нельзя редактировать вершины promoted fragment-зон

**Симптом:** При попытке двинуть вершину зоны-фрагмента (created via intarsia promote) — ошибка `zone_partition_overlap`.

**Причина:** `findSharedBoundaryVertexLinks` (zone-lookups.js) ищет соседей только по совпадению вершин. Вершины fragment-зон лежат на **рёбрах** соседних зон (Clipper расставляет точки по пересечениям), а не в их вершинах. Поэтому соседняя зона (например Zone 4.1) не попадает в linkedMoves → при перемещении её ребро остаётся на месте → overlap.

**Правильный фикс:** Когда точка лежит на ребре соседней зоны (а не в вершине) — автоматически вставлять новую вершину в это ребро (`add-vertex` эквивалент), создавая vertex-to-vertex связь перед началом drag. Только тогда linkedMoves будет полным.

**Файлы:** `zone-lookups.js → findSharedBoundaryVertexLinks`, `stage-interactions.js → mousedown drag init`

**Временное состояние:** promoted fragment-зоны (sourceFragmentId != null) фактически нередактируемы по вершинам — валидатор блокирует. Remainder-зоны (sourceFragmentId == null) — аналогично если граничат с другими зонами по рёбрам.
