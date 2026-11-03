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

## Известные ограничения миграции

- `protocol-grpc`: сборка включает `vitest.config.ts` вне `rootDir: src` (TS6059).
- Остальные дополнительные пакеты требуют отдельного полного прогона; зелёный основной
  CI не означает их готовность к выпуску.
- Пакетные README пока содержат инструкции для отдельных репозиториев; для монорепо
  используйте команды из этого файла.
