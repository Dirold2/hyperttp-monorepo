# Workspace tooling

Общие скрипты на TypeScript для Node, Bun и Deno. Для управления зависимостями
и упаковки по-прежнему требуется Bun; Git/npm используются соответствующими командами.

## Структура

- Корень `scripts/` — запускаемые команды; пути сохранены для package scripts.
- `lib/` — общие функции, без запуска CLI при импорте.
- `tests/` — тесты tooling на временных файлах и репозиториях.
- `tsconfig.json` — строгая проверка всех TypeScript-файлов, включая вложенные.

## Команды

| Файл | Назначение |
| --- | --- |
| `workspaces.ts` | Сборка и проверки выбранных пакетов или `--all` |
| `workspace.ts` | Подключение репозиториев, scan и status |
| `build-package.ts` | Сборка одного пакета из его рабочего каталога |
| `update.ts` | Обновление зависимостей workspaces |
| `pack.ts` | Создание npm-архивов |
| `dist.ts` | Отправка дистрибутива в Git `__dist__` |
| `pub.ts` | Публикация npm, авторизация и staged recovery |
| `release-command.ts` | Планирование версий, проверки и управление выпуском |
| `tui.ts` | Интерактивное меню |
| `subtree.ts` | Legacy export; заблокирован в submodule workspace |

## Общие модули

- `lib/format.ts` — вывод CLI и запуск команд.
- `lib/release.ts` — сборка, упаковка и подготовка dist.
- `lib/release-compare.ts` — сравнение с опубликованным пакетом.
- `lib/release-version.ts` — повышение SemVer.
- `lib/npm-registry.ts` — чтение версии из npm и ожидание видимости.
- `lib/npm-stage.ts` — проверка staged-публикаций.

```sh
bun run release:test
bun run workspace:test
bun exec tsc -p scripts/tsconfig.json
```

Пути команд намеренно не перемещены: сборки пакетов ссылаются на
`../../scripts/build-package.ts`. Перемещение внутренних модулей не требует
редактировать каждый независимый репозиторий пакета.
