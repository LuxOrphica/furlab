# Экспорт в CLO 3D — план и выводы

## Что уже есть

- `src/routes/export.js` — генерирует ZIP с DXF-фрагментами + `manifest.json` + `materials.json`
- `src/routes/import.js` + `server.js` — парсит `.zprj`/`.zpac`/`.dxf`/`.pac`/`.pos` при импорте из CLO
- UI: кнопка «Преобразовать в лекала», двухшаговый preview → commit
- Архитектурные схемы: `F:\FURLAB\Scheme\OLD\`

Текущий экспорт останавливается на DXF + манифесте. CLO плагин (C++) должен принять этот пакет и создать паттерны с материалами внутри CLO.

---

## CLO API — ключевые вызовы

```python
# Создать паттерн из точек
pattern_api.CreatePatternWithPoints(points)

# Добавить материал (zfab или jfab)
fabricIdx = fabric_api.AddFabric("material.jfab")

# Назначить материал на паттерн
fabric_api.AssignFabricToPattern(patternIdx, fabricIdx)

# Экспортировать материал как JSON для изучения структуры
fabric_api.ExportFabric("output.jfab", fabricIndex)

# Перезаписать все свойства материала из JSON
fabric_api.ChangeFabricWithJson(fabricIndex, "changes.jfab")
```

---

## Материалы: маппинг FURLAB → CLO Fur_Strand

CLO поддерживает два типа меха: **Fur (Render Only)** и **Fur_Strand (Beta)**.  
Наши данные покрывают все параметры процедурного рендера — PNG-текстура не нужна.

| Поле FURLAB | CLO свойство | Примечание |
|---|---|---|
| `melanin` (0–1) | Melanin | 1:1 |
| `pheomelanin` (0–1) | Pheomelanin | 1:1 |
| `pileLengthMm` | Length | мм → CLO units (уточнить масштаб) |
| `hairThicknessMm` | Thickness | 1:1 |
| `taper` (0–1) | Taper | 1:1 |
| `pileDensityPerIn2` | Density | нормализовать в диапазон CLO |
| `segmentationCount` | Segments | 1:1, макс 16 |
| `hairBend` (0–1) | Bend | 1:1 |
| `curlRadiusMm` + `curlEffect` | Curl (Radius + Number) | разделить на два поля |
| `gloss` (0–1) | Glossiness | 1:1 |
| `softness` (0–1) | Softness | 1:1 |
| `bendSpread` (0–1) | Variance | 1:1 |
| `colorHex` | Base Color | hex → RGB |
| `weightGm2`, `elasticity`, `stretch` | Physical Properties | отдельный блок физики |

Направление ворса (`napDirectionDeg`) задаётся на паттерне, не на материале.

---

## Формат .jfab

Структура не задокументирована публично. Способ получить:

1. Открыть CLO
2. Вручную создать Fur_Strand материал с любыми параметрами
3. Запустить в Python Editor CLO:
   ```python
   fabric_api.ExportFabric("C:/tmp/fur_test.jfab", 0)
   ```
4. Открыть `fur_test.jfab` в текстовом редакторе — получить реальную JSON-схему
5. Задокументировать поля и написать генератор на стороне FURLAB

---

## План реализации

### Шаг 1 — Получить схему .jfab
Экспортировать тестовый Fur_Strand материал из CLO и задокументировать JSON-структуру.

### Шаг 2 — Генератор jfab в FURLAB
В `src/routes/export.js` добавить функцию `buildJfabForMaterial(material)`:
- принимает объект из `fur_materials.json`
- возвращает JSON по схеме .jfab
- кладёт файл во временную папку при экспорте

### Шаг 3 — Обновить экспортный ZIP
Добавить в ZIP рядом с DXF-файлами:
- `materials/<materialId>.jfab` — по одному на каждый уникальный материал в проекте
- в `manifest.json` → поле `materialJfabPath` для каждого фрагмента/зоны

### Шаг 4 — CLO плагин (C++)
Плагин читает ZIP, для каждого фрагмента:
1. `pattern_api.CreatePatternWithPoints(fragment.points)`
2. `fabric_api.AddFabric(manifest.materialJfabPath)` — или reuse если материал уже добавлен
3. `fabric_api.AssignFabricToPattern(patternIdx, fabricIdx)`
4. Выставить направление ворса через grain direction API

### Шаг 5 — Архитектура плагина
- C++ плагин с QWebEngineView (HTML/React UI внутри CLO)
- Связь JS ↔ C++ через QWebChannel
- UI показывает список фрагментов, статус импорта, кнопку «Применить»
- Альтернатива для MVP: Python скрипт в CLO Python Editor (без UI, командная строка)

---

## Нерешённые вопросы

1. **Масштаб координат** — `CreatePatternWithPoints` принимает мм или другие единицы?
2. **Grain direction API** — есть `GetNestingPatternPieceGrainDirection`, нужно найти setter
3. **Fur_Strand (Beta)** — стабильность в текущей версии CLO, доступность через API
4. **Physical Properties через API** — есть ли setter для веса/эластичности или только через jfab
5. **Лицензия API** — CLO API доступен на каком плане подписки?
