# Отчет исполнения контракта: внешний контур мездры

## Срез V3: до/после (edge-aware + guards)

| Метрика | До | После |
|---|---:|---:|
| avg processingTimeMs | 283.6 | 295.5 |
| p95 processingTimeMs | 604 | 607 |
| max processingTimeMs | 634 | 736 |
| fallbackUsed (count) | 1 | 2 |
| timeoutHit (count) | 2 | 2 |

## Критические кейсы

| Файл | area до -> после | bbox до -> после | fallback после | timeout после | bboxWRatio | bboxHRatio |
|---|---|---|---:|---:|---:|---:|
| FL-SCR-000123_0a5dd63f906809dc.png | 477386 -> 477430 | 840x896 -> 841x897 | False | True | 1.001 | 1.001 |
| FL-SCR-000123_1771405005490.png | 477386 -> 477470 | 840x896 -> 843x898 | True | True | 1.004 | 1.002 |
| Gemini_Generated_Image_z1y9llz1y9llz1y9.png | 5977 -> 5977 | 277x479 -> 277x479 | True | False | 1 | 1 |

## Артефакты

- overlay до: `ui-lab/line-direction-visualizer-react/docs/segmentation_overlays_before`
- overlay после: `ui-lab/line-direction-visualizer-react/docs/segmentation_overlays_after`
- метрики до: `ui-lab/line-direction-visualizer-react/docs/segmentation_benchmark_before.json`
- метрики после: `ui-lab/line-direction-visualizer-react/docs/segmentation_benchmark_after_guard.json`
