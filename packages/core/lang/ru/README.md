# @hyperttp/core

> Протокол-независимое ядро выполнения для клиентских и серверных коммуникаций.

**Русский** | [English](../../README.md)

[![CI](https://github.com/IT-IF-OR/hyperttp-core/actions/workflows/ci.yml/badge.svg)](https://github.com/IT-IF-OR/hyperttp-core/actions/workflows/ci.yml)
[![npm version](https://img.shields.io/npm/v/@hyperttp/core)](https://www.npmjs.com/package/@hyperttp/core)
[![npm downloads](https://img.shields.io/npm/dm/@hyperttp/core)](https://www.npmjs.com/package/@hyperttp/core)
[![bundle size](https://img.shields.io/bundlephobia/minzip/@hyperttp/core)](https://bundlephobia.com/package/@hyperttp/core)
[![license](https://img.shields.io/npm/l/@hyperttp/core)](../../LICENSE)
[![typescript](https://img.shields.io/badge/TypeScript-strict-blue)](https://www.typescriptlang.org/)

## Позиционирование

`@hyperttp/core` — небольшое оркестрационное ядро, а не очередная обёртка над `fetch` и не
HTTP-фреймворк «со всем из коробки». Оно связывает три независимые точки расширения:

- **Протоколы** определяют семантику коммуникации. Протокол может отправлять через `HyperSender`,
  принимать через `HyperReceiver` или реализовывать обе роли как `HyperProtocol`.
- **Транспорты** отвечают за физический I/O. Текущий контракт транспорта выполняет исходящие
  запросы и может дополнительно слушать входящие запросы.
- **Плагины** добавляют клиентские политики и явные серверные lifecycle hooks, не расширяя ядро.

Ядро отвечает за диспетчеризацию, lifecycle, выполнение плагинов и управление ресурсами. REST входит
в базовую поставку; дополнительные протоколы, оптимизированные транспорты и высокоуровневое поведение
живут в отдельных пакетах.

```text
Приложение
    │
    ├── Плагины: retry, cache, auth, tracing, metrics, logging, policy
    │
 HyperCore
    │
    ├── Протокол: prepare → send → parse
    │              receive → handle → respond
    │
    └── Транспорт: execute (клиент) / listen (сервер)
                   Node.js / Bun / Deno / Browser / custom runtime
```

Эта граница намеренная. Новые повторы клиентских запросов, кэши, способы аутентификации,
observability и другие политики запросов должны быть плагинами. Новая сетевая семантика должна
поставляться пакетами протоколов. Новые способы I/O должны поставляться пакетами транспортов.

> Нужен готовый HTTP-клиент с настроенными возможностями? Используйте
> [`hyperttp`](https://www.npmjs.com/package/hyperttp), который компонует ядро с прикладными плагинами
> и настройками по умолчанию.

## Свойства ядра

- Оркестрация клиентских и серверных ролей.
- Протокол-независимый конверт запроса и универсальная форма ответа.
- Клиентский lifecycle: `prepare → send → parse`.
- Серверный lifecycle: `receive → handle → respond`.
- Разрешение транспортов по протоколу и координированное владение ими.
- Блокирующие и фоновые клиентские hooks, отдельные блокирующие серверные hooks.
- Стабильный request context и final settlement для освобождения ресурсов.
- Выбор транспорта по runtime с browser-safe fetch fallback.
- Строгие TypeScript-контракты и module augmentation для типизированных namespace протоколов.
- Отсутствие встроенных runtime-зависимостей.

## Установка

```bash
npm install @hyperttp/core @hyperttp/types
```

Ядру требуется `@hyperttp/types@^0.5.0`. Общие контракты lifecycle и плагинов находятся
в этом пакете: `CorePluginFactory`, `RequestOutcome`, `ServerPluginContext`,
`ServerRequestOutcome`. Для идентификаторов протокола используйте `HyperProtocolName`;
`SenderProtocol` сохранён как deprecated alias для совместимости.

Оптимизированные транспорты опциональны; выбирайте версии, совместимые с текущими контрактами.
Встроенный `FetchTransport` по умолчанию поддерживает REST, а не произвольные протоколы.
Пакеты протоколов и транспортов решают разные задачи.

## Быстрый старт клиента

```ts
import { HyperCore } from "@hyperttp/core";

const core = new HyperCore();

const response = await core.rest.get("https://example.com/users", {
  query: { page: 1 },
});

console.log(response.status);
console.log(response.data);

await core.destroy();
```

Тот же запрос через протокол-независимый API:

```ts
const response = await core.send({
  protocol: "rest",
  input: {
    method: "GET",
    url: "https://example.com/users",
    query: { page: 1 },
  },
});
```

## Быстрый старт сервера

Транспорт также может предоставлять `listen()`. `HyperCore` связывает его с принимающей стороной
выбранного протокола:

```ts
import { HyperCore } from "@hyperttp/core";

const core = new HyperCore();

const server = await core.listen({
  protocol: "rest",
  host: "127.0.0.1",
  port: 3000,
  handler(request) {
    return {
      status: 200,
      body: {
        method: request.method,
        path: request.path,
      },
    };
  },
});

// Закрывает активные серверы и освобождает все транспорты ядра.
await core.destroy();
```

Протоколы могут быть только клиентскими, только серверными или предоставлять обе роли. Текущий
контракт транспорта всегда предоставляет клиентский `execute()` и может дополнительно предоставлять
серверный `listen()`.

Для закрытия одного listener используйте `await server.close()`, всех — `await core.destroy()`.
Маршруты `server.rest.get()` и типизированные services относятся к высокоуровневому пакету
`hyperttp`, а не к Core.

## Протоколы

REST — единственный протокол, реализованный внутри ядра. Внешние модули протоколов загружаются
лениво:

| Протокол  | Пакет                          | Namespace                    |
| --------- | ------------------------------ | ---------------------------- |
| REST      | встроен                        | `core.rest`                  |
| GraphQL   | `@hyperttp/protocol-graphql`   | `core.graphql`               |
| gRPC      | `@hyperttp/protocol-grpc`      | `core.grpc`                  |
| tRPC      | `@hyperttp/protocol-trpc`      | `core.trpc`                  |
| WebSocket | `@hyperttp/protocol-websocket` | `core.ws` / `core.websocket` |
| SSE       | `@hyperttp/protocol-sse`       | `core.sse`                   |
| MQTT      | `@hyperttp/protocol-mqtt`      | `core.mqtt`                  |
| WebRTC    | `@hyperttp/protocol-webrtc`    | `core.webrtc`                |

Если опциональный пакет протокола не установлен, разрешение завершается понятной подсказкой по
установке, а не молча выбирает другой протокол.

Явно зарегистрированный sender сразу предоставляет namespace, в том числе при регистрации
после создания ядра. Receiver-only модуль доступен через `listen()`, но не создаёт клиентские методы.
`registerProtocol()` заменяет модуль целиком, включая удаление отсутствующей роли.
`registerSender()` / `registerReceiver()` сохраняют противоположную роль. Устаревшие generated
flat methods удаляются, пользовательские переопределения сохраняются. Коллизии с API ядра
и prototype-sensitive имена отклоняются.

### Роли протокола

Единый модуль протокола может предоставлять одну или обе роли:

```ts
const protocol = {
  protocol: "my-protocol",
  sender: mySender, // опциональная клиентская роль
  receiver: myReceiver, // опциональная серверная роль
};

core.registerProtocol(protocol);
```

Sender переводит входные данные протокола в транспортный запрос и разбирает транспортный ответ.
Receiver переводит входящий транспортный запрос в данные протокола и сериализует ответ приложения.

Пакеты протоколов могут расширять типизированные входы и namespace через module augmentation
`@hyperttp/types`:

```ts
declare module "@hyperttp/types" {
  interface ProtocolInputMap {
    "my-protocol": MyProtocolInput;
  }

  interface HyperProtocols {
    "my-protocol": MyProtocolMethods;
  }

  interface ProtocolServerRequestMap {
    "my-protocol": MyServerRequest;
  }

  interface ProtocolServerResponseMap {
    "my-protocol": MyServerResponse;
  }
}
```

## Транспорты

Транспорт описывает свои клиентские возможности и опциональную серверную возможность:

```ts
interface HyperTransport {
  execute(request: TransportRequest): Promise<TransportResponse>;
  listen?(options: TransportListenOptions): Promise<TransportServer>;
  close?(): Promise<void> | void;
  destroy?(): Promise<void> | void;
}
```

- `execute()` — обязательная клиентская роль.
- `listen()` — опциональная серверная роль.
- `protocols` или `supports()` объявляет возможности протоколов.
- Ядро разрешает и удерживает транспорты по протоколу и закрывает общий экземпляр только после
  освобождения последнего владельца.

Выбор по runtime:

| Runtime        | Предпочтительный пакет       | Fallback                    |
| -------------- | ---------------------------- | --------------------------- |
| Node.js        | `@hyperttp/transport-undici` | встроенный `FetchTransport` |
| Bun            | `@hyperttp/transport-bun`    | встроенный `FetchTransport` |
| Deno           | `@hyperttp/transport-deno`   | встроенный `FetchTransport` |
| Browser / edge | custom transport             | встроенный `FetchTransport` |

Для WebRTC, WebSocket и MQTT сначала проверяются специализированные пакеты
`@hyperttp/transport-webrtc`, `@hyperttp/transport-websocket`, `@hyperttp/transport-mqtt`.
У каждого кандидата проверяется поддержка протокола: выбор по runtime не означает
поддержку любого протокола.

Client/listen caches разделены; автоматические транспорты изолированы по identity конфигурации.
Custom transport не попадает в default cache независимых ядер. Если REST-транспорт клиента
не имеет `listen()`, сервер использует встроенный fallback, не заменяя клиентский транспорт.
Серверный fallback динамически загружает `node:http`: browser-safe импорт не означает
возможность открыть сервер в браузере.

Транспорт можно передать явно:

```ts
import { HyperCore } from "@hyperttp/core";
import { UndiciTransport } from "@hyperttp/transport-undici";

const core = new HyperCore({
  customTransport: new UndiciTransport(),
});
```

## Плагины

Плагины — основной механизм расширения поведения клиентских запросов, которое не относится к
семантике протокола или физическому I/O. Текущие hooks выполняются в клиентском lifecycle `send()`:

```ts
core.use({
  name: "request-logger",
  phase: "DATA",
  onRequest(request) {
    console.log("request", request.protocol);
  },
  onResponse(response) {
    console.log("response", response.status);
  },
  onError(error) {
    console.error(error);
  },
});
```

Hooks:

- `onRequest` может изменить запрос или вернуть ранний ответ.
- `onResponse` может проверить или заменить ответ.
- `onError` может восстановить выполнение, вернув ответ.
- `mode: "background"` отделяет response-side работу от блокирующего пути.
- `enabled(config)` управляет регистрацией.
- `setup(context)` инициализирует плагин.

### Изоляция и завершение запроса

Stateful plugin instance принадлежит одному Core. Повторная регистрация того же экземпляра
идемпотентна; другое значение с тем же именем и неявное использование между Core отклоняются.
Используйте `pluginFactories: [() => withQueue(options), () => withInflight()]`: фабрики создают
новые экземпляры для конструктора, `extend()` и `create()`. При наследовании явного `plugins`
заменяйте stateful instances свежими или передавайте `plugins: []`.
Stateless-плагин может объявить `shared: true`, но не должен иметь `setup()` или разделять
состояние запросов/ядер через замыкания.

Фазы выполняются в порядке START → PREPARE → CONTROL → FORMAT → NETWORK → DATA;
без `phase` используется START. Response/error hooks сохраняют прямой порядок фаз.
Каждый получает request envelope, который видел его собственный `onRequest`, и стабильный
`RequestContext`. Все error hooks вызываются, даже если уже получен recovery response или
диагностический hook выбросил исключение. Recovery проходит response hooks, кроме случая,
когда ошибка возникла уже в response processing. Повторного цикла recovery нет.

Обязательный cleanup регистрируется через `requestContext.onSettled(callback)`, а не через
response/error hooks. Callbacks выполняются ровно один раз после blocking response/recovery
с итогом `{ ok: true, response }` или `{ ok: false, error }`. Ошибка callback диагностическая
и не мешает остальным; регистрировать новые callbacks после начала settlement нельзя.
Обновлённый queue освобождает slot на этом этапе, inflight завершает followers итогом primary.
`acceptFinalResponse(response)` позволяет follower не применять response transformations повторно.

Background hooks не ожидаются при settlement. Снимки response/headers поверхностные:
вложенные данные, streams и context остаются общими, их нельзя мутировать.

Примеры функциональности для плагинов:

- retries и circuit breakers;
- кэширование и дедупликация запросов;
- аутентификация и подпись запросов;
- tracing, metrics и структурированное логирование;
- rate limiting, concurrency control и scheduling;
- валидация схем и прикладные политики.

## Серверные плагины

Клиентские hooks не выполняются для входящих `listen()`-запросов. Серверные hooks
регистрируются отдельно через те же `core.use()` / `pluginFactories`:

```ts
core.use({
  name: "server-headers",
  onServerResponse(response) {
    return {
      ...response,
      headers: { ...response.headers, "x-powered-by": "hyperttp" },
    };
  },
});

await core.listen({
  protocol: "rest",
  port: 3000,
  handler: () => ({ body: { ok: true } }),
});
```

```text
onServerRequest → receiver.receive → handler/receiver.handle
→ receiver.respond → onServerResponse → transport
```

- `onServerRequest` может заменить сырой `TransportRequest` до декодирования.
- `onServerResponse` может заменить сериализованный `TransportResponse` до передачи транспорту.
  При изменении только заголовков сохраняйте body/stream.
- `onServerError`: вызываются все hooks; первый возвращённый сырой ответ восстанавливает
  выполнение. Recovery проходит outgoing hooks, если они ещё не завершились ошибкой.
  Ошибка при обработке recovery передаётся дальше без нового recovery-цикла.
- `onServerSettled` выполняется ровно один раз с окончательным результатом подготовки ответа;
  ошибки диагностические и не прерывают остальные cleanup hooks.

Все серверные hooks блокирующие, даже при клиентском `mode: "background"`. Используется
один snapshot плагинов на запрос, прямой порядок фаз и стабильный context с listen-bound
`protocol`, signal, state и metadata. Settlement означает готовность ответа к передаче
транспорту, **не** окончание stream или физическую доставку. Ошибки записи транспорта
находятся за этой границей. Для серверного cleanup используйте `onServerSettled`,
а не клиентский `onSettled`.

Outbound auth/cache/retry не превращаются автоматически в server authorization, server cache
или повторную отправку ответа. Плагин должен явно реализовать серверные hooks.

## Встроенный REST-протокол

REST предоставляет клиентскую и серверную роли через `RestProtocol`.

```ts
const getResponse = await core.rest.get("https://example.com/users", {
  query: { page: 1, tag: ["a", "b"] },
  headers: { accept: "application/json" },
  timeout: 5_000,
});

const postResponse = await core.rest.post("https://example.com/users", {
  name: "Ada",
});

const streamResponse = await core.rest.stream("https://example.com/events");
```

REST поддерживает:

- сериализацию query с повторяющимися параметрами массивов;
- нормализацию `Headers`, records и tuple arrays;
- JSON-сериализацию plain object и array request body;
- обработку JSON, text и binary response;
- UTF-8 кодирование без обязательного глобального `Buffer`;
- timeout и пользовательский abort до окончания чтения response stream;
- небуферизованный stream mode;
- сохранение binary request bodies и серверные streams с backpressure;
- prototype-safe query dictionaries с повторяющимися ключами;
- декодирование запросов и сериализацию ответов для серверной роли.

Встроенный сервер по умолчанию ограничивает тело запроса 10 MiB. `maxBodyBytes` —
неотрицательное безопасное целое; 0 допускает только пустое тело. Custom transports
отвечают за свои лимиты. REST не добавляет прикладную валидацию, авторизацию или политику
credentials при redirect: redirect и работа с credentials зависят от выбранного транспорта.

Core не добавляет клиентский base URL; со встроенным fetch-транспортом используйте абсолютные URL.

Публичные REST-типы доступны из `@hyperttp/core/rest`.

## Lifecycle

Состояния Core: initializing → running → destroying → destroyed. В `setup()` можно
регистрировать протоколы/плагины, но нельзя запускать send/listen или получать транспорт.
После начала shutdown новые операции отклоняются, включая short-circuit/cache-hit пути.
Graceful destroy ожидает принятые клиентские вызовы вместе с settlement, pending server startup
и закрытие серверов. Запрос, приостановленный до dispatch, может отклониться на следующей
проверке состояния. Принудительный destroy делегирует отмену транспорту и не ждёт client calls;
некооперативный транспорт может оставить запрос незавершённым.

Streams могут жить дольше send promise; signal/deadline действуют до completion/cancel/error.
Не ожидайте graceful `destroy()` внутри активного request hook: shutdown ждёт сам этот запрос.
Дренирование серверных запросов определяется `TransportServer.close()`.

```ts
const child = core.extend({ verbose: true }); // разделяет существующие и pending client transport leases
const isolated = core.create({}); // независимый lifecycle транспорта

await child.destroy();
await isolated.destroy();
await core.destroy();
```

- `extend()` создаёт связанное ядро и разделяет владение уже разрешёнными транспортами.
- `create()` создаёт независимое ядро и по умолчанию не наследует `customTransport`.
- `destroy()` идемпотентен, закрывает отслеживаемые серверы и освобождает транспорты.
- `destroy(false)` запрашивает принудительное завершение, если транспорт его поддерживает.

## Обработка ошибок

```ts
import { HyperClientError, TimeoutError } from "@hyperttp/core";

try {
  await core.rest.get("https://example.com/slow", { timeout: 1_000 });
} catch (error) {
  if (TimeoutError.isTimeoutError(error)) {
    console.error("Истёк таймаут запроса");
  } else if (HyperClientError.isHyperClientError(error)) {
    console.error(error.code, error.message);
  }
}
```

## Границы ядра

Стабильное ядро намеренно ограничено:

1. регистрацией и диспетчеризацией протоколов;
2. разрешением, разделением и завершением транспортов;
3. оркестрацией клиентского и серверного lifecycle;
4. выполнением плагинов;
5. базовым REST-протоколом и универсальными контрактами ошибок.

Развитие функциональности должно происходить через плагины, пакеты протоколов и пакеты транспортов.
Маленькая граница делает runtime-поведение предсказуемым и позволяет стабилизировать API ядра
независимо от окружающей экосистемы.

## Поддержка runtime

- Node.js 20 и новее;
- актуальный стабильный Bun;
- актуальный стабильный Deno;
- современные браузеры и edge runtime с Fetch и Web Streams.

## Разработка

```bash
bun install --frozen-lockfile
npm run format:check
npm run lint
npm run typecheck
npm run test
npm run build
```

Обязательный порядок: `lint → typecheck → test → build`. CI дополнительно проверяет browser bundle,
runtime smoke tests и установку собранного npm tarball.

## Лицензия

MIT
