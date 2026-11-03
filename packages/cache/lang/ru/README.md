# @hyperttp/cache

> [English](https://github.com/IT-IF-OR/hyperttp-cache) | Русский

Высокопроизводительный plugin LRU-кэширования для Hyperttp с TTL и дедупликацией
конкурентных запросов.

## Возможности

- In-memory LRU-кэш с настраиваемыми TTL и ограничением размера.
- Дедупликация конкурентных запросов и защита от cache stampede.
- HTTP revalidation через `ETag` и `Last-Modified`.
- Интеграция с lifecycle plugin Core v2.

## Установка

```bash
npm install @hyperttp/cache
# или
bun add @hyperttp/cache
```

## Использование

```ts
import { HyperClient } from "hyperttp";
import { withCache } from "@hyperttp/cache";

const client = new HyperClient({
  plugins: [withCache()],
});

const response = await client.get("https://api.example.com/data");
```

Настройки передаются через экспортируемый тип `CacheOptions`. Основные параметры:
`enabled`, `ttl`, `maxSize`, `methods` и `touchOnGet`.

## Лицензия

MIT © dirold2
