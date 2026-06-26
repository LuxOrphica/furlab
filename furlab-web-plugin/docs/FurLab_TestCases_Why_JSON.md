# FurLab Test Cases (JSON) - зачем и как использовать (v0.2)

## 1. Зачем нужны JSON-кейсы

JSON-кейсы нужны, чтобы:
- воспроизводить баги 1-в-1 на фиксированном входе;
- делать регрессию после изменений solver/геометрии;
- синхронизировать команды разных режимов на одном baseline.

## 2. Что такое кейс

Кейс - это снимок входа в solver:
- `layoutType`;
- `zone`;
- `candidates` (или их snapshot);
- `options/constraints`;
- `seed`;
- expected-инварианты (`fullCoverageOk`, диапазоны метрик, warnings).

## 3. Минимальный формат

```json
{
  "layoutType": "inventory_direct",
  "seed": 1772711509013,
  "zone": { "id": 6, "points": [{"x":0,"y":0}] },
  "candidates": [
    { "id":"...", "inventoryTag":"...", "scrapContour":"{...}" }
  ],
  "options": {
    "strictCoverage": true,
    "coverageEps": 0.0005
  },
  "expected": {
    "fullCoverageOk": true
  }
}
```

## 4. Что обязательно проверять в CI

- Preview-путь без side effects.
- Детерминизм на фиксированном `seed`.
- Инварианты режима (из mode-contract).
- Стабильность ключевых метрик (coverage, residual, pieces, overlap).

## 5. Рекомендации по набору

- На каждый режим минимум:
  - 1 easy-case,
  - 1 typical-case,
  - 1 edge-case (узкие карманы/сложный контур/таймаут).
- Для `inventory_direct` отдельный кейс с `pieceSeamReserveMm > 0` и проверкой `seamCheck`.
