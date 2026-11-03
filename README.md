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

Общие скрипты в `scripts/` написаны на TypeScript и запускаются напрямую
через Node.js >=22.19, Bun или Deno 2 (через совместимые `node:` API):

```sh
node scripts/workspaces.ts build types
bun scripts/workspaces.ts build types
deno run --no-config --no-lock --node-modules-dir=manual --allow-read --allow-env --allow-run scripts/workspaces.ts build types

node scripts/update.ts protocol-webrtc
bun scripts/update.ts protocol-webrtc
deno run --no-config --no-lock --node-modules-dir=manual --allow-read --allow-env --allow-run scripts/update.ts protocol-webrtc
```

Deno требует разрешения на чтение, переменные окружения и дочерние процессы;
при прямом запуске `build-package.ts` и `pack.ts` также нужен `--allow-write`.
Команды обновления, упаковки и запуска package scripts пока используют Bun
как менеджер пакетов независимо от выбранной среды запуска скрипта.
Зависимости должны быть установлены (`bun install`); Deno использует существующий
`node_modules`, без собственного lockfile. Проверка типов скриптов:
`bun exec tsc -p scripts/tsconfig.json`.

```sh
bun run test
bun run smoke:node
bun run smoke:bun
bun run smoke:deno
bun run smoke:browser
```

Для Deno нужен Deno 2; browser smoke требует установленный Chromium/Chrome.

## Интерактивное меню

```sh
bun run tui
# Или напрямую выбранной средой:
node scripts/tui.ts
bun scripts/tui.ts
deno run --no-config --no-lock --node-modules-dir=manual --allow-read --allow-write --allow-env --allow-run scripts/tui.ts
```

Меню предлагает сборку dist, typecheck, тесты, lint, проверку форматирования,
обновление зависимостей, упаковку .tgz и subtree check/push. Выберите команду
по номеру, затем пакеты номерами через пробел или запятую. `all` выбирает все
пакеты, `stable` — основной CI-набор. При обновлении `all` включает и корневой
`package.json`. Обновление зависимостей и push требуют подтверждения `y`.
`0` возвращает назад или закрывает меню, Ctrl+C отменяет ввод.
Меню требует интерактивный терминал; команды выполняются выбранной средой
(Node/Bun/Deno), менеджером пакетов остаётся Bun. Для GitHub `__dist__` и npm
добавлены отдельные действия проверки (dry-run) и реальной отправки с подтверждением.

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
node scripts/workspaces.ts build transport-bun
# Только тесты выбранного пакета.
node scripts/workspaces.ts test parser
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
`workspace:^` требует монорепо, а сборка использует `../../scripts/build-package.ts`.
Разрабатывать и проверять пакеты следует здесь.

## Управляемый release

```sh
bun run release voice --dry-run
bun run release voice                  # patch по умолчанию
bun run release voice --bump minor      # 0.1.1 → 0.2.0
bun run release voice --bump major
bun run release --resume               # продолжить прерванную отправку
bun run release:test
```

`release` автоматически включает локальные runtime/peer зависимости выбранных
пакетов и показывает план. Версия повышается от большей из локальной и последней
стабильной npm-версии. Prerelease-версии пока не поддерживаются. `--dry-run`
запрашивает npm metadata и может собирать пакеты для сравнения архивов, но не
повышает версии, не выполняет полный набор проверок и не публикует.
При отсутствии сохранённого снимка пакет собирается и сравнивается с npm-архивом
последней стабильной версии. Версия, scripts/devDependencies, сведения о репозитории
и sourcemaps не учитываются; остальные файлы и публичный манифест сравниваются.
Одинаковое содержимое пропускается. Изменённые автоматически добавленные зависимости
получают patch; --bump применяется только к явно выбранным пакетам. После успешного
выпуска локально сохраняются хеши исходников; неизменившиеся пакеты пропускаются,
а потребители включённых зависимостей выпускаются заново для обновления диапазонов.

Реальный выпуск требует чистого закоммиченного дерева и подтверждения (`--yes`
для автоматизации). До повышения выполняются build, typecheck, lint, format:check
и test **всех** workspaces. Пакеты без соответствующего script пропускаются.
Любая ошибка блокирует повышение и отправку. Затем изменяются версии и bun.lock,
повторяются проверки и выполняются dist/pub в порядке зависимостей. `workspace:^`
остаётся в исходниках, а Bun подставляет новые версии в публикуемые архивы.

План и завершённые стадии хранятся локально в Git metadata, в
`hyperttp-release/plan.json`. После ошибки отправки используйте `--resume` без
пакетов и `--bump`: версии не повышаются повторно, завершённые стадии пропускаются.
Нельзя менять HEAD или исходники между попытками. Сбой во время записи версий
блокирует автоматическое продолжение и требует проверки манифестов/lockfile;
публикация к этому моменту ещё не началась. Не удаляйте pending-план без проверки
уже выполненных отправок. План не синхронизируется между компьютерами.

Автокоммитов, тегов и rollback npm нет. После успешного выпуска проверьте и
закоммитьте версии и lockfile. Обычные dist/pub не повышают версии.
Сейчас строгий release также выявит известные ошибки адаптации adapter-axios
и protocol-grpc; их нужно исправить, а не исключать из проверок.

## Дистрибутив GitHub и публикация npm

```sh
# Собрать и сравнить, не отправляя изменения.
bun run dist --dry-run types core
# Отправить содержимое dist в __dist__ соответствующих remotes.
bun run dist types core

# Проверить публикацию без отправки в реестр.
bun run pub --dry-run types core
# Опубликовать выбранные пакеты в npmjs.com.
bun run pub types core
```

Нужно явно выбрать пакеты; `--all` выбирает все, включая ещё не адаптированные.
Порядок выбранных пакетов учитывает локальные зависимости; сборка также собирает
их зависимости, но публикация затрагивает только явно выбранные пакеты.

`dist` готовит манифест с путями без `dist/` и npm-диапазонами вместо `workspace:`.
Используется временный Git-репозиторий: исходники, индекс и локальные ветки
не меняются, `main` не пушится. Ветка `__dist__` обновляется обычным fast-forward
push без `--force`; при одинаковом содержимом отправка пропускается.
Нужны SSH-доступ, настроенные remotes, Git identity и `tar`.

`pub` публикует архив **целого пакета**, подготовленный Bun, а не каталог `dist`.
Поэтому npm exports сохраняют пути `./dist/`, а `workspace:` заменяется на версии.
В Git-дистрибутиве манифест имеет `private: true`, чтобы не опубликовать его случайно.
Уже существующая npm-версия пропускается; ошибки сети и авторизации не трактуются
как отсутствие версии. Нужен предварительный `npm login`; OTP можно ввести при
публикации. Lifecycle scripts отключены. Provenance этой локальной командой
не добавляется — для него нужен отдельный доверенный CI release.

Оба `--dry-run` используют сеть и создают локальные сборки/временные файлы,
но не отправляют Git-ветки или npm-пакеты. Команды не повышают версии,
не коммитят исходники и не запускают тесты: перед реальным выпуском выполните
необходимые проверки. При ошибке выпуск останавливается; уже отправленные пакеты
автоматически не откатываются. Поддерживается запуск через Node, Bun и Deno,
как для остальных скриптов; Deno также нужны `--allow-write` и `--allow-run`.

## Известные ограничения миграции

- `protocol-grpc`: сборка включает `vitest.config.ts` вне `rootDir: src` (TS6059).
- Остальные дополнительные пакеты требуют отдельного полного прогона; зелёный основной
  CI не означает их готовность к выпуску.
- Пакетные README пока содержат инструкции для отдельных репозиториев; для монорепо
  используйте команды из этого файла.
