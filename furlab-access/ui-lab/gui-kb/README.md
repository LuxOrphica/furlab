# GUI KB Web

Локальный веб-интерфейс для базы заметок Obsidian `GUI`.

## Что делает
- Строит единый JSON/JS с заметками из vault.
- Показывает навигацию по папкам.
- Поиск по заголовку/тексту.
- Переходы по `[[wikilinks]]`.

## Обновить данные
```powershell
node scripts/build_gui_kb_manifest.js
```

По умолчанию источник: `F:/Проекты Обсидиан/MD-файлы/GUI`.

Если путь другой:
```powershell
$env:GUI_KB_PATH='D:/MyVault/GUI'; node scripts/build_gui_kb_manifest.js
```

## Запуск
Откройте `ui-lab/gui-kb/index.html` в браузере.

Для локального сервера:
```powershell
cd ui-lab/gui-kb
python -m http.server <gui-kb-port>
```
и откройте корневой адрес поднятого статического сервера.

