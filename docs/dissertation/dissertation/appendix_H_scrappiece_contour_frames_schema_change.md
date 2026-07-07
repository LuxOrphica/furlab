# Приложение Н. Изменение семантики хранения контура ScrapPiece

## Н.1. Назначение изменения

`ScrapPiece` представляет физический кусок меха. В карточке Access, интерфейсе выкладки, solver и отчётах оператор должен видеть один и тот же нормализованный физический контур.

В текущих данных поле `scrapContour` часто хранит зеркальный контур `fur_up`, а нормализованный контур для раскладки вычисляется при чтении. Это создаёт риск повторного зеркалирования или поворота в разных модулях.

Изменение не вводит набор новых обязательных полей. Вместо этого меняется целевая семантика существующих полей:

- `ScrapPiece.scrapContour` хранит нормализованный контур для раскладки;
- `ScrapPiece.napDirectionDeg` для этого контура равен `90`;
- исходный скан и исходный угол остаются в `metricsJson` для аудита и пересчёта.

## Н.2. Система координат

Все контуры хранятся в системе координат FurLab:

- ось X направлена вправо;
- ось Y направлена вниз;
- углы отсчитываются по часовой стрелке от оси X;
- координаты задаются в миллиметрах (`units = "mm"`).

Производственный процесс сканирует куски одной стороной: `leather_up`. Это константа pipeline, а не новое поле каждой записи.

Преобразования для DXF/CLO относятся к границе импорта/экспорта и не меняют внутреннюю систему хранения контуров.

## Н.3. Существующие и целевые поля

| Поле | Текущая роль | Целевая роль |
|---|---|---|
| `scrapContour` | Часто хранит зеркальный `fur_up` / `contourCanonical` | Хранит нормализованный контур: `fur_up`, повернутый так, что ворс направлен вниз |
| `napDirectionDeg` | Часто хранит угол в `fur_up` кадре | Хранит `90` для нормализованного `scrapContour` |
| `metricsJson.contourRaw` | Исходный контур скана | Сохраняется как первоисточник |
| `metricsJson.napDirectionDegRaw` | Угол ворса на исходном скане | Сохраняется как первоисточник |
| `metricsJson.contourCanonical` | Зеркальный `fur_up` контур | Сохраняется как legacy/fallback |
| `metricsJson.napDirectionDegCanonical` | Угол ворса в `fur_up` кадре | Сохраняется как legacy/fallback |

Новые обязательные поля `contourFurUp`, `contourLayoutNorm`, `napDirectionDegFurUp`, `napDirectionDegLayoutNorm` не вводятся.

## Н.4. Правило нормализации

Так как сканирование выполняется `leather_up`, нормализация задаётся одной формулой:

1. `contourFurUp = mirrorVerticalByBBoxCenter(metricsJson.contourRaw)`.
2. `napFurUp = normalizeDeg360(180 - metricsJson.napDirectionDegRaw)`.
3. `scrapContour = rotate(contourFurUp, 90 - napFurUp)`.
4. `napDirectionDeg = 90`.

Поворот выполняется в системе FurLab: положительный угол соответствует вращению по часовой стрелке на экране, так как ось Y направлена вниз.

## Н.5. Контракт потребителей

Карточка Access:

- сохраняет `metricsJson.contourRaw` и `metricsJson.napDirectionDegRaw`;
- после миграции считает `scrapContour` основным нормализованным видом;
- может показывать raw/canonical диагностические слои, но не должна молча перезаписывать первоисточник.

Web-plugin и inventory solvers:

- используют `scrapContour` напрямую после миграции;
- не зеркалят и не поворачивают его повторно;
- для старых записей временно поддерживают fallback: `contourCanonical + napDirectionDegCanonical`.

Отчёты и экспорт:

- используют результат размещения как производную от нормализованного `scrapContour`;
- преобразование к CAD/CLO выполняют только на границе экспорта.

## Н.6. Миграция

1. Провести audit без изменения данных:
   - проверить наличие `metricsJson.contourRaw`;
   - проверить наличие `metricsJson.napDirectionDegRaw`;
   - сравнить текущий `scrapContour` с ожидаемым нормализованным контуром.
2. Создать резервную копию Access DB.
3. Обновить только существующие поля:
   - `scrapContour = normalized contour`;
   - `napDirectionDeg = 90`;
   - `metricsJson.contourRaw`, `metricsJson.napDirectionDegRaw`, `contourCanonical` оставить.
4. Обновить readers в Access и web-plugin под новую семантику.
5. Сохранять legacy fallback до подтверждения миграции всех рабочих DB.

## Н.7. Правила безопасности для FurLab Access

- Не удалять `metricsJson.contourRaw` и `metricsJson.napDirectionDegRaw`.
- Не менять рабочую `.accdb` без backup и audit-отчёта.
- Не удалять legacy-чтение `contourCanonical` в первом проходе.
- Не менять глобальный viewport web-plugin в рамках этой миграции.
- Не переписывать исторические `LayoutRun` snapshots.

## Н.8. Критерии приемки

- Один и тот же `ScrapPiece` имеет совпадающий нормализованный вид в Access и во входе solver.
- `scrapContour` уже является нормализованным контуром для раскладки.
- `napDirectionDeg = 90` для мигрированной записи.
- `inventory_voronoi_sa` не выполняет зеркалирование и поворот входных кусков.
- Старые записи читаются через fallback без потери совместимости.
