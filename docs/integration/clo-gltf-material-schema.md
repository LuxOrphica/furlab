# CLO GLTF Material Schema

Получено реверс-инжинирингом из `F:\FURLAB\Examples\fur.gltf` (норка, экспорт из CLO).

## Структура файла

GLTF 2.0 + расширения:
- `CLO_materials_fabric_property` — физические свойства подложки
- `KHR_materials_specular` — зеркальность
- `KHR_texture_transform` — масштаб тайлинга текстуры

## Слои материала меха

CLO разделяет мех на два слоя:
1. **Подложка (Skin)** — физика, цвет, текстура → экспортируется в GLTF
2. **Ворс (Fur Strand)** — длина, плотность, меланин → только внутри CLO, через `.jfab` / API

## physicalProperty (CLO_materials_fabric_property)

| Поле | Пример (норка) | Наш аналог | Формула |
|---|---|---|---|
| `density` | 230.3 | `weightGm2` | `weightGm2` |
| `thickness` | 0.67 | `thicknessMm` | `thicknessMm` |
| `friction` | 0.03 | — | фиксированное 0.03 |
| `internalDamping` | 1e-4 | — | фиксированное 1e-4 |
| `stretchWarp` | 2200000.0 | `stretch` | `(1 - stretch) * 3000000 + 500000` |
| `stretchWeft` | 1700000.0 | `stretch` | `(1 - stretch) * 2500000 + 400000` |
| `bendingWarp` | 5969.0 | `softness` | `(1 - softness) * 10000 + 500` |
| `bendingWeft` | 5340.7 | `softness` | `(1 - softness) * 9000 + 500` |
| `bendingLeftBias` | 5654.9 | `softness` | среднее bending |
| `bendingRightBias` | 5654.9 | `softness` | среднее bending |
| `leftShear` | 1200000.0 | — | фиксированное 1200000 |
| `rightShear` | 1200000.0 | — | фиксированное 1200000 |
| `buckling*` | 0.0 | — | всегда 0 |
| `nonlinear*` | кривые | — | фиксированные дефолтные кривые (из примера) |

## pbrMetallicRoughness

| Поле | Пример | Наш аналог | Формула |
|---|---|---|---|
| `baseColorFactor` | [1.0, 0.924, 0.924, 1.0] | `colorHex` | hex → [R/255, G/255, B/255, 1.0] |
| `roughnessFactor` | 0.5 | `gloss` | `1.0 - gloss` |
| `metallicFactor` | 0.0 | — | всегда 0 |

## KHR_materials_specular

| Поле | Пример | Наш аналог | Формула |
|---|---|---|---|
| `specularFactor` | 0.15 | `gloss` | `gloss * 0.3` |

## Дефолтные nonlinear кривые (из норки)

```json
"nonlinearLeftShear": [
  { "lengthRatio": 1.0, "stiffnessRatio": 0.0436 },
  { "lengthRatio": 1.0746, "stiffnessRatio": 3.417 },
  { "lengthRatio": 1.1725, "stiffnessRatio": 9.491 },
  { "lengthRatio": 1.2485, "stiffnessRatio": 15.284 }
],
"nonlinearStretchWarp": [
  { "lengthRatio": 1.0, "stiffnessRatio": 0.1563 },
  { "lengthRatio": 1.07, "stiffnessRatio": 3.401 },
  { "lengthRatio": 1.1683, "stiffnessRatio": 8.112 },
  { "lengthRatio": 1.2443, "stiffnessRatio": 10.63 }
],
"nonlinearStretchWeft": [
  { "lengthRatio": 1.0, "stiffnessRatio": 0.0428 },
  { "lengthRatio": 1.0996, "stiffnessRatio": 2.761 },
  { "lengthRatio": 1.1953, "stiffnessRatio": 6.957 },
  { "lengthRatio": 1.2663, "stiffnessRatio": 9.194 }
]
```
(nonlinearRightShear = nonlinearLeftShear)

## Текстура

Большой файл (1MB) потому что текстура embedded как base64 PNG.
При генерации: если нет текстуры — убираем `baseColorTexture` и `normalTexture`, оставляем только `baseColorFactor`.

## Примечание по Fur Strand

Параметры ворса (pileLengthMm, melanin, pileDensityPerIn2, taper, curl и т.д.)
не присутствуют в GLTF — они задаются внутри CLO через `.jfab` или Python API:
```python
fabric_api.AddFabric("material.gltf")   # физика + цвет
# затем через ChangeFabricWithJson установить fur strand параметры
```
