# @hyperttp/ratelimit

> [English](https://github.com/IT-IF-OR/hyperttp-ratelimit) | Русский

Плагин ограничения частоты запросов для Hyperttp.

## Возможности

- Ограничивает пропускную способность запросов в pipeline Core v2.
- Поддерживает protocol-neutral значения `SendRequest`, `UniversalResponse` и `RequestContext`.
- Помогает соблюдать лимиты downstream-сервисов.

## Установка

```bash
npm install @hyperttp/ratelimit
# или
bun add @hyperttp/ratelimit
```

## Использование

```ts
import { HyperClient } from "hyperttp";
import { withRateLimit } from "@hyperttp/ratelimit";

const client = new HyperClient({
  plugins: [withRateLimit()],
});
```

Настройки передаются через экспортируемый тип `RateLimitOptions`.

## Лицензия

MIT © dirold2
