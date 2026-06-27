# Экспорт в CLO 3D — статус и выводы

_Последнее обновление: 2026-05-22_

---

## Текущий статус: РАБОТАЕТ (MVP)

Pipeline полностью функционален через Python-скрипт (`scripts/clo_import_furlab.py`).

### Что работает ✅

| Функция | Реализация |
|---|---|
| Создание паттернов из контуров фрагментов | `CreatePatternWithPoints` — CLO screen coords, CCW winding |
| Направление ворса на паттерне | `SetPatternPieceGrainDirection(pat_idx, deg)` |
| Назначение материала на паттерн | `SetPatternPieceFabricIndex(pat_idx, fab_idx)` |
| Загрузка материала с типом Fur | `AddFabric(Fur_Mink_Skin.zfab)` → `ExportFabric` → patch → `AddFabric(patched.jfab)` |
| Имя материала | из `qsNameUTF8` в jfab (читается из имени файла при `AddFabric`) |
| Цвет материала (`v3BaseColor`) | патчится из FURLAB jfab поверх нативной CLO-структуры |
| Параметры ворса (length, density, bend, taper, etc.) | патчатся из FURLAB jfab |
| Construction: Fur | из `.zfab` шаблона |
| Свежий ZIP | скрипт скачивает с сервера `http://127.0.0.1:5600/api/export/latest-zip` |
| Фильтрация мелких фрагментов | `areaMm2 < 100` пропускается |
| Упрощение контуров | удаление близких точек (<1.5мм) + spike-vertices (<8°) |

### Чего нет / известные ограничения ❌

| Проблема | Причина | Обходной путь |
|---|---|---|
| `Created by` / `Data State` в Physical Property | CLO не читает `listFabricFileInfo` при `AddFabric` — устанавливает сам | вручную |
| Тип материала — `Fur (Render Only)`, не `Fur_Strand` | `Fur_Mink_Skin.zfab` из CLO-библиотеки — Render Only | см. ниже |
| Параметры физики (stretch, weight, bending) | патчатся, но CLO может игнорировать при загрузке | проверить |
| Зависимость от CLO-библиотеки | путь `C:\Users\Public\Documents\CLO\Assets\Materials\Fabric\` захардкожен | стандартная установка CLO |
| `fur_strand_template.jfab` привязан к машине | генерируется `clo_export_test_jfab.py` на конкретной установке CLO | при переезде — регенерировать |

---

## Ключевые открытия (CLO Python API)

### `AddFabric(.jfab)` игнорирует `iFurType`
Даже с `"iFurType": 9` в jfab — CLO загружает материал как `Fabric_Matte`. Поле читается только при экспорте, не при импорте. Не задокументировано.

### `ChangeFabricWithJson` — только для rollWidth/styleChipList
Принимает только `{ "rollWidth": N, "styleChipList": [...] }`. Все другие форматы (fur params, color, mapMaterial2D) возвращают `False`. Не позволяет менять тип или свойства материала.

### Рабочий путь для Fur-типа
```
AddFabric(CLO_LIBRARY/Fur_Mink_Skin.zfab)  → индекс temp_idx
ExportFabric(temp_path, temp_idx)           → нативный .jfab с правильной структурой
patch(temp_path, наши параметры)            → модифицированный .jfab
AddFabric(patched_path)                     → финальный материал с типом Fur
```
`DeleteFabric` между шагами — вызывает краш CLO. Не использовать.

### `Fur (Render Only)` vs `Fur_Strand`
В CLO 2025.2 `Fur_Strand` помечен как Beta. `Fur (Render Only)` — стабильный тип, достаточен для кроя и рендера. Разница в физической симуляции ткани: Render Only не симулирует волос отдельно.

---

## Файлы

| Файл | Назначение |
|---|---|
| `scripts/clo_import_furlab.py` | основной скрипт импорта, запускать в CLO Python Editor |
| `public/scripts/clo_import_furlab.py` | источник правды — копировать в `scripts/` после каждого изменения |
| `scripts/clo_export_test_jfab.py` | экспортирует fabric[0] из CLO в `.jfab` для изучения структуры |
| `src/services/clo_gltf_generator.js` | генерирует `.jfab` для ZIP (template-based от `fur_strand_template.jfab`) |
| `src/services/fur_strand_template.jfab` | нативный CLO Fur_Strand jfab, используется как шаблон генератором |

---

## Что вернуться и доделать

1. **`Fur_Strand` тип вместо `Fur (Render Only)`** — найти `.zfab` с Fur_Strand в библиотеке CLO или создать вручную и добавить в `scripts/`
2. **Физические свойства** — проверить, применяются ли наши `fSuK`/`fBvK`/`fDensity` патчи
3. **Множество материалов** — сейчас один материал на всё изделие; нужно по зонам (разные цвета)
4. **`DeleteFabric`** — найти безопасный момент для удаления плейсхолдера `Fur_Mink_Skin`
5. **C++ плагин** — заменить Python-скрипт на встроенный UI-плагин (QWebEngineView)
6. **Зависимость от CLO-библиотеки** — либо бандлить нужный `.zfab` в ZIP, либо обнаруживать путь динамически
