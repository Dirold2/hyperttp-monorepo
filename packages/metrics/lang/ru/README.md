# @hyperttp/metrics

> [English](https://github.com/IT-IF-OR/hyperttp-metrics) | Русский

Плагин метрик для Hyperttp.

## Возможности

- Собирает метрики жизненного цикла запросов из pipeline Core v2.
- Поддерживает protocol-neutral значения `SendRequest`, `UniversalResponse` и `RequestContext`.
- Работает как отдельный опциональный plugin.

## Установка

```bash
npm install @hyperttp/metrics
# или
bun add @hyperttp/metrics
```

## Использование

```ts
import { HyperClient } from "hyperttp";
import { withMetrics } from "@hyperttp/metrics";

const client = new HyperClient({
  plugins: [withMetrics()],
});
```

Настройки передаются через экспортируемый тип `MetricsOptions`.

## Лицензия

MIT © dirold2
