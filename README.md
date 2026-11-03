# Hyperttp monorepo

Bun workspaces для 22 пакетов Hyperttp. Имена npm-пакетов и независимые версии сохранены.

## Начало работы

Требуются Bun 1.4.4 и Node.js >=22.19.0.

```sh
bun install --frozen-lockfile --ignore-scripts
bun run build
bun run check
```

Сначала нужна сборка: публичные exports ссылаются на `dist`, а не на исходники.
Корневая команда `check` сама выполняет сборку перед проверками.

```sh
bun run test
bun run smoke:node
bun run smoke:bun
bun run smoke:deno
bun run smoke:browser
```

Для Deno нужен Deno 2; browser smoke требует установленный Chromium/Chrome.

## Пакеты и команды

Основной проверяемый набор: `types`, `core`, `hyperttp`, `auth`, `cache`, `crypto`,
`inflight`, `interceptors`, `metrics`, `parser`, `queue`, `ratelimit`, `retry`, `serializer`.

Дополнительные пакеты сохранены, но не включены в основной CI до завершения их миграции:
`adapter-axios`, `protocol-grpc`, `protocol-webrtc`, `sender-rest`, `transport-bun`,
`transport-undici`, `transport-webrtc`, `voice`.

```sh
# Проверка всех пакетов, включая дополнительные (пока может завершаться ошибкой).
bun run check:all
# Сборка выбранного пакета с локальными зависимостями.
node scripts/workspaces.mjs build transport-bun
# Только тесты выбранного пакета.
node scripts/workspaces.mjs test parser
```

Список источников и исходных версий — `migration.json`. Исходные репозитории не изменены.
Перенесены и незакоммиченные файлы. `.git`, зависимости, сборки, lockfiles пакетов и
`.env` не перенесены; секреты нужно настроить отдельно. Git-истории остаются в старых репозиториях.

## Зависимости и публикация

Внутренние зависимости используют `workspace:^`. Для разработки не нужны `bun link`
или публикация промежуточных версий. Общий lockfile находится в корне.
Версии пакетов остаются независимыми: меняйте версии только затронутых пакетов.
При изменении локальной версии `bun pm pack` подставляет новый диапазон зависимости.

```sh
bun run build
bun run pack types core hyperttp
```

Архивы создаются в `artifacts/` командой `bun pm pack`, которая заменяет `workspace:`
на npm-диапазоны. Публикуется архив целого пакета с `dist/`, а не отдельный `dist/`:

```sh
npm publish artifacts/hyperttp-core-<version>.tgz --access public --provenance --ignore-scripts
```

Не запускайте `npm publish packages/core` напрямую: npm не заменяет workspace-протокол.
Команда публикации с provenance предназначена для настроенного CI, не локального терминала.

Автоматический release пока намеренно не включён: сначала нужно определить GitHub
репозиторий монорепо, обновить `repository.url` и `repository.directory` пакетов,
настроить Trusted Publisher для каждого npm-пакета. Старые URL пока сохранены как
источник; публиковать их из нового репозитория с provenance нельзя.
Старые workflows сохранены в `packages/*/legacy-github/` только для справки.

## Разработка в монорепо и Git subtree

Основной рабочий каталог — этот монорепозиторий: изменения пакетов делаются в
`packages/` и коммитятся здесь. Отдельные репозитории можно использовать как зеркала
исходников, без переключения между рабочими папками.

Локально настроены SSH remotes для всех 22 пакетов: `hyperttp` указывает на
`git@github.com:Dirold2/hyperttp.git`, остальные — на
`git@github.com:IT-IF-OR/hyperttp-<имя-пакета>.git`.
Имя remote совпадает с каталогом пакета (`core`, `types`, `protocol-grpc` и т. д.).
Для каждого пакета создана локальная ветка `export/<имя-пакета>`.
Remotes не переносятся при клонировании; на новом рабочем месте добавьте их
по этой схеме. Например:

```sh
git remote add hyperttp git@github.com:Dirold2/hyperttp.git
git remote add core git@github.com:IT-IF-OR/hyperttp-core.git
git remote add protocol-grpc git@github.com:IT-IF-OR/hyperttp-protocol-grpc.git
git remote add protocol-webrtc git@github.com:IT-IF-OR/hyperttp-protocol-webrtc.git
git remote add transport-webrtc git@github.com:IT-IF-OR/hyperttp-transport-webrtc.git
```

Экспорт коммитов выбранного пакета (изменения сначала нужно закоммитить в монорепо):

```sh
git subtree split --prefix=packages/protocol-grpc -b export/protocol-grpc
git subtree split --prefix=packages/protocol-webrtc -b export/protocol-webrtc
git subtree split --prefix=packages/transport-webrtc -b export/transport-webrtc
```

При первом экспорте в существующие репозитории используйте отдельную ветку,
чтобы не перезаписать их независимую историю:

```sh
git push protocol-grpc export/protocol-grpc:monorepo
git push protocol-webrtc export/protocol-webrtc:monorepo
git push transport-webrtc export/transport-webrtc:monorepo
```

Автоматическая отправка только изменившихся пакетов:

```sh
# Проверить все пакеты без отправки.
bun run subtree:check
# Отправить все изменившиеся пакеты в ветки monorepo.
bun run subtree:push
# Проверить или отправить только выбранные пакеты.
bun run subtree:check core hyperttp
bun run subtree:push core hyperttp
```

Скрипт сравнивает subtree-коммит и содержимое с удалённой веткой. Если изменений
нет, выводит `[skip]` и не пушит. Используется снимок `HEAD`: незакоммиченные
изменения не отправляются, о них выводится предупреждение. Нужны настроенные
remotes и SSH-доступ к GitHub. `--dry-run` обращается к сети и может загружать
Git-объекты, но не изменяет удалённые ветки. Ошибки отдельных пакетов не мешают
проверке остальных; итоговый код возврата при ошибках — 1. Скрипт не публикует npm,
не создаёт коммиты и отказывается перезаписывать расходящуюся историю.

Последующие обновления этих веток вручную:

```sh
git subtree push --prefix=packages/protocol-grpc protocol-grpc monorepo
git subtree push --prefix=packages/protocol-webrtc protocol-webrtc monorepo
git subtree push --prefix=packages/transport-webrtc transport-webrtc monorepo
```

Не используйте `--force` для замены старой `main`. У первоначально экспортированных
веток нет общей истории со старыми репозиториями; обычный PR между ними может быть
недоступен. Переключение основной ветки на `monorepo` — отдельное решение.

Subtree экспортирует только каталог пакета. Такие зеркала пока не автономны:
`workspace:^` требует монорепо, а сборка использует `../../scripts/build-package.mjs`.
Разрабатывать и проверять пакеты следует здесь.

## Известные ограничения миграции

- `protocol-grpc`: сборка включает `vitest.config.ts` вне `rootDir: src` (TS6059).
- Остальные дополнительные пакеты требуют отдельного полного прогона; зелёный основной
  CI не означает их готовность к выпуску.
- Пакетные README пока содержат инструкции для отдельных репозиториев; для монорепо
  используйте команды из этого файла.
