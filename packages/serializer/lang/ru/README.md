# @hyperttp/serializer

> [English](https://github.com/IT-IF-OR/hyperttp-serializer) | Русский

Плагин сериализации тела запроса для Hyperttp.

## Возможности

- Сериализует payload запросов в pipeline Core v2.
- Поддерживает protocol-neutral значения `SendRequest`, `UniversalResponse` и `RequestContext`.
- Работает как отдельный опциональный plugin.

## Установка

```bash
npm install @hyperttp/serializer
# или
bun add @hyperttp/serializer
```

## Использование

```ts
import { HyperClient } from "hyperttp";
import { withSerializer } from "@hyperttp/serializer";

const client = new HyperClient({
  plugins: [withSerializer()],
});
```

Настройки передаются через экспортируемый тип `SerializerOptions`.

## Лицензия

MIT © dirold2
