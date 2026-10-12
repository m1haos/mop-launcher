# Лаунчер

Electron + библиотеки @xmcl (установка NeoForge, загрузка файлов Mojang, запуск).
Пиратский: офлайн-ники, без входа в аккаунт.

Репозиторий лежит в папке `launcher/` проекта карты. Сам проект карты
(`pack/`, мир, документы) в Git не хранится: скрипты сборки ищут его
уровнем выше, в `../pack`.

## Запуск для разработки

Нужен [Node.js](https://nodejs.org) LTS (22 или новее).

```powershell
cd launcher
npm install      # один раз и после изменения package.json
npm start        # открыть лаунчер
```

Настройки игрока (ник) лежат в `%APPDATA%\MOP Launcher\settings.json`.
Удалите файл, чтобы снова увидеть первый запуск.

## Сборка карты (.mrpack)

Сборка игрока выходит в формате Modrinth (`.mrpack`): моды, шейдер и PBR-пак
внутри не лежат, это ссылки на Modrinth с sha1/sha512, а наши файлы
(kubejs, конфиги, ресурспак `mop2-resources`, профиль шейдера) лежат в `overrides/`.
Тот же файл импортируется в Prism Launcher, это запасной вариант для демо.

```powershell
cd launcher
npm run pack:lock    # дописать в pack/modlist.lock.json новые записи из modlist.json и хеши sha512
npm run pack:build   # собрать launcher/dist-pack/
```

В `launcher/dist-pack/` появляются `mop2-<версия>.mrpack`, `mop2-cover.png`
и `manifest.json`. Всё это загружается в один релиз GitHub.

- Название, описание, версия карты и версия NeoForge хранятся в `pack/pack.json`.
- Обложка лежит в `pack/cover.png` (16:9, например 1280×720). Сейчас там временная.
- `pack:lock` не трогает уже закреплённые версии. Обновить всё до свежих версий
  можно через `tools/sync-mods.ps1 -Update`.

## Манифест

Лаунчер читает список игр из адреса в `config.json`:

- `"manifest": "dev-manifest.json"` — локальный файл для разработки (сейчас);
- `"manifest": "https://github.com/<владелец>/<репо>/releases/latest/download/manifest.json"` — после первого релиза.

Ссылки внутри манифеста могут быть относительными: лаунчер считает их от адреса манифеста,
поэтому файлы просто должны лежать в том же релизе.

```json
{
  "formatVersion": 1,
  "maps": [{
    "id": "mop2",
    "title": "Mystery Of Pizzaplex",
    "subtitle": "Глава 2 — The Dark Corners",
    "description": "Абзацы через пустую строку",
    "players": "1–5 игроков",
    "tags": ["Хоррор", "Головоломки", "Кооп"],
    "version": "0.1.0",
    "minecraft": "1.21.1",
    "neoforge": "21.1.252",
    "cover": "mop2-cover.png",
    "pack": { "url": "mop2-0.1.0.mrpack", "sha1": "…", "size": 7556 },
    "world": null
  }]
}
```

## Устройство

```
launcher/
  config.json          откуда брать манифест
  dev-manifest.json    манифест для разработки
  scripts/             сборка карты: lock.js, build-pack.js
  src/main/            «мотор»: окно, настройки, манифест (дальше установка и запуск)
  src/preload.js       мост между интерфейсом и «мотором» (window.mop)
  src/renderer/        интерфейс: index.html, style.css, app.js, assets/
```

## План

| Шаг | Что | Статус |
|---|---|---|
| 0 | Сборка `.mrpack` и манифест | готово, ждёт проверки |
| 1 | Окно, ник с сохранением | готово, ждёт проверки |
| 2 | Список игр, страница игры: обложка, описание, кнопка «Установить / Играть» | готово, ждёт проверки |
| 3 | Java 21 | |
| 4 | Minecraft 1.21.1 + NeoForge | |
| 5 | Запуск без модов в своей папке | |
| 6 | Установка `.mrpack`: файлы с проверкой sha1, докачка изменившегося | |
| 7 | Мир: шаблон, «Играть» сразу в мир | |
| 8 | «Создать игру» (адрес e4mc из лога) и «Присоединиться» | |
| 9 | Музыка, иконка, установщик .exe | |
