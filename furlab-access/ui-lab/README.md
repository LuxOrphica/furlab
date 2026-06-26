# UI Lab

Песочница для быстрых прототипов интерфейсов и визуальных тестов.

## Текущая структура

```text
ui-lab/
  index.html                    # стартовая страница со списком демо
  styles.css                    # базовые стили стартовой страницы
  assets/images/                # общие картинки для нескольких демо
  normal-visualizer/
    index.html                  # страница инструмента
    css/styles.css              # стили инструмента
    js/app.js                   # логика инструмента
    assets/images/              # картинки, используемые только этим демо
  line-direction-visualizer/
    index.html                  # направление ворса по отрезку P1-P2
    css/styles.css
    js/app.js
    assets/images/
```

## Как запускать

1. Быстро: открой `ui-lab/index.html` напрямую в браузере.
2. Для демо без записи в БД можно поднять простой статический сервер:

```bash
python -m http.server <static-preview-port>
```

Потом открой соответствующий маршрут `ui-lab/` на поднятом статическом сервере.

3. Для записи в Access запускай API-сервер (из корня репозитория):

```bash
node tools/ui_lab_server.js
```

По умолчанию база: `БД/Furlab 1.accdb`.
Загрузка исходного файла (если включен чекбокс в UI) сохраняет картинку в `ui-lab/assets/uploads/`.
Можно переопределить путь:

```bash
set FURLAB_DB_PATH=F:\path\to\your.accdb
node tools/ui_lab_server.js
```

4. Запуск из VS Code (без ручного ввода команд):

- `Terminal -> Run Task -> UI Lab API: start`
- или `Run and Debug -> UI Lab API (Node)`
- после запуска открой маршрут `ui-lab/normal-visualizer/index.html` на активном dev-сервере

## Принцип "как сейчас принято"

- Каждый интерфейс в отдельной папке.
- `HTML/CSS/JS` разделены по файлам.
- Картинки: общие в `ui-lab/assets/images`, специфичные в `*/assets/images`.
- Общая точка входа (`ui-lab/index.html`) для навигации.
- Без лишней инфраструктуры, пока не понадобится сборка.

