# @hyperttp/interceptors

> [English](https://github.com/IT-IF-OR/hyperttp-interceptors) | Русский

Плагин перехватчиков запросов и ответов для Hyperttp.

## Возможности

- Выполняет пользовательские обработчики вокруг жизненного цикла Core v2.
- Поддерживает перехват запросов, ответов и ошибок.
- Использует protocol-neutral значения `SendRequest`, `UniversalResponse` и `RequestContext`.

## Установка

```bash
npm install @hyperttp/interceptors
# или
bun add @hyperttp/interceptors
```

## Использование

```ts
import { HyperClient } from "hyperttp";
import { withInterceptors } from "@hyperttp/interceptors";

const client = new HyperClient({
  plugins: [withInterceptors({
    onRequest: (request) => request,
  })],
});
```

Доступные callbacks описаны в экспортируемом типе `InterceptorsOptions`.

## Лицензия

MIT © dirold2
