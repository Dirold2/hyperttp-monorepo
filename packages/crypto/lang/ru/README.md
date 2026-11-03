# @hyperttp/crypto

[English](../../README.md) | Русский

Криптографические плагины для [HyperTTP](https://github.com/dirold2/hyperttp): HTTP `Content-Digest`, HMAC-подпись запросов, проверка подписи и защита от повторного воспроизведения (replay).

## Возможности

- `contentDigest()` — формирует HTTP-заголовок `Content-Digest` по телу запроса.
- `hmacSigner()` — подписывает каноническое представление метода, origin, пути с query, тела, timestamp, nonce и выбранных заголовков.
- `withCrypto()` — единый HyperTTP-плагин, который сначала рассчитывает Digest, затем опционально создаёт HMAC-подпись.
- `verifyHmac()` — проверяет HMAC и давность timestamp на сервере.
- `verifyIncomingRequest()` — дополнительно атомарно использует nonce, предотвращая replay-атаки.

Используются Web Crypto API и `SHA-256`, `SHA-384` либо `SHA-512`.

## Установка

```bash
npm install @hyperttp/crypto @hyperttp/types
```

`@hyperttp/types` является peer dependency; установите основной пакет HyperTTP, с которым работает приложение.

## Быстрый старт

### Только проверка целостности тела

`withCrypto()` без аргументов добавляет Digest с `SHA-256`, но не добавляет HMAC: у подписи не может быть безопасного значения секрета по умолчанию.

```ts
import { withCrypto } from "@hyperttp/crypto";

client.use(withCrypto());
```

### Digest и HMAC-подпись

Передавайте секрет из защищённой серверной конфигурации, а не из клиентского bundle.

```ts
import { withCrypto } from "@hyperttp/crypto";

client.use(
  withCrypto({
    hmac: {
      secret: process.env.HMAC_SECRET!,
      nonceHeaderName: "x-nonce",
      includeHeaders: ["content-digest", "content-type"],
    },
  }),
);
```

Плагин добавляет следующие заголовки по умолчанию:

| Заголовок     | Назначение                                        |
| ------------- | ------------------------------------------------- |
| `content-digest`      | Хеш тела в формате HTTP Content-Digest.                   |
| `x-timestamp` | Unix-время в миллисекундах, включённое в подпись. |
| `x-signature` | HMAC в hex-формате.                               |
| `x-nonce`     | Случайный UUID, если указан `nonceHeaderName`.    |

Если включить `content-digest` в `includeHeaders`, HMAC защитит и значение Digest. Список и порядок `includeHeaders` должны совпадать у отправителя и проверяющей стороны.

`withCrypto()`, `contentDigest()` и `hmacSigner()` обрабатывают только запросы с `protocol: "rest"`. Остальные протоколы (включая WebRTC, gRPC и `http`) проходят без изменений, без подписи и генерации digest.

## Настройка

```ts
import { withCrypto } from "@hyperttp/crypto";

client.use(
  withCrypto({
    digest: {
      algorithm: "SHA-512",
      headerName: "content-digest",
    },
    hmac: {
      secret: process.env.HMAC_SECRET!,
      algorithm: "SHA-512",
      headerName: "x-signature",
      timestampHeaderName: "x-timestamp",
      nonceHeaderName: "x-nonce",
      includeHeaders: ["content-digest", "content-type"],
    },
  }),
);
```

Чтобы отключить Digest, задайте `digest: false`:

```ts
client.use(
  withCrypto({
    digest: false,
    hmac: { secret: process.env.HMAC_SECRET! },
  }),
);
```

Для отдельных плагинов используйте `contentDigest(options)` и `hmacSigner(options)`.

Все криптоплагины запросов работают в фазе `FORMAT`. Регистрируйте их после преобразований тела и подписываемых заголовков; при раздельном использовании — сначала `contentDigest()`, затем `hmacSigner()`. После подписи эти данные менять нельзя. Реализация конвейера ядра отсутствует в этом пакете: порядок выполнения необходимо проверить в интеграции с HyperTTP.

**Миграция:** заголовок по умолчанию изменён с `Digest` на `Content-Digest` (RFC 9530). Обновите чтение заголовка и `includeHeaders` до `content-digest` на обеих сторонах. `headerName` меняет только имя заголовка, но не формат структурированного значения.

## Проверка на сервере

### HMAC и давность запроса

Получите значения заголовков из входящего HTTP-запроса и передайте исходные URL, method, body и headers в `verifyHmac()`.

```ts
import { verifyHmac } from "@hyperttp/crypto";

const headers = new Headers(request.headers);
const valid = await verifyHmac(
  {
    url: request.url,
    method: request.method,
    body: await request.text(),
    headers,
  },
  {
    secret: process.env.HMAC_SECRET!,
    timestamp: headers.get("x-timestamp") ?? "",
    nonce: headers.get("x-nonce") ?? undefined,
    signature: headers.get("x-signature") ?? "",
    includeHeaders: ["content-digest", "content-type"],
    maxAgeMs: 5 * 60 * 1000,
  },
);

if (!valid) {
  return new Response("Unauthorized", { status: 401 });
}
```

`maxAgeMs` по умолчанию — `300_000` (5 минут). Проверка допускает часы отправителя, отличающиеся от серверного времени не более чем на это значение.

### Защита от повторного воспроизведения

Для запросов с nonce используйте `verifyIncomingRequest()`. `NonceStore.consume()` обязан **атомарно** сохранить nonce с TTL и вернуть `false`, если nonce уже был использован.

```ts
import { verifyIncomingRequest } from "@hyperttp/crypto";
import type { NonceStore } from "@hyperttp/crypto";

const nonceStore: NonceStore = {
  async consume(nonce, ttlMs) {
    // Пример для Redis: SET nonce:<nonce> 1 NX PX <ttlMs>
    const result = await redis.set(`nonce:${nonce}`, "1", {
      NX: true,
      PX: ttlMs,
    });
    return result === "OK";
  },
};

const valid = await verifyIncomingRequest(
  {
    url: request.url,
    method: request.method,
    body: await request.text(),
    headers: request.headers,
  },
  {
    secret: process.env.HMAC_SECRET!,
    nonceStore,
    includeHeaders: ["content-digest", "content-type"],
    maxAgeMs: 5 * 60 * 1000,
  },
);

if (!valid) {
  return new Response("Unauthorized", { status: 401 });
}
```

Не реализуйте nonce-store через раздельные `has()` и `set()`: два конкурентных запроса смогут пройти проверку до записи nonce. Для распределённого приложения используйте атомарную операцию хранилища, например Redis `SET ... NX PX` или таблицу с уникальным ключом и TTL.

## Каноническая строка HMAC

`buildCanonicalString()` создаёт текст в следующем порядке:

```text
hyperttp-hmac-v1
<METHOD>
<ORIGIN>
<PATH_AND_QUERY>
<TIMESTAMP>
<NONCE>
<BASE64_EXACT_BODY_BYTES>
<SELECTED_HEADER_NAME>:<VALUE>
...
```

- Метод приводится к верхнему регистру.
- Origin и путь с query берутся из абсолютного URL.
- Имена выбранных заголовков приводятся к нижнему регистру.
- Порядок `includeHeaders` является частью протокола.
- `string`, `ArrayBuffer` и `ArrayBufferView` подписываются как переданные байты; JSON-значения сериализуются через `JSON.stringify()`.

Для межъязыковых интеграций передавайте готовое строковое или бинарное тело. `JSON.stringify()` не является стандартом канонизации JSON между различными реализациями.

Неподдерживаемые тела (`FormData`, `Blob`, потоки, циклические объекты, значения вне JSON и объекты с `toJSON`) приводят к `TypeError`. Сначала сериализуйте их в точные байты отправляемого тела.

## Публичный API

```ts
export { contentDigest, hmacSigner, verifyHmac, verifyIncomingRequest, withCrypto };
export { bodyToBytes, buildCanonicalString, timingSafeEqualHex };
export type {
  CanonicalOptions,
  ContentDigestOptions,
  CryptoBody,
  DigestAlgorithm,
  HmacSignerOptions,
  HmacVerificationOptions,
  HttpRequestInput,
  IncomingHmacVerificationOptions,
  JsonPrimitive,
  JsonValue,
  NonceStore,
  WithCryptoOptions,
};
```

## Безопасность

- Никогда не передавайте HMAC-секрет в браузерный код, мобильный bundle или публичный репозиторий.
- Сравнивайте timestamp, используйте nonce и реализуйте атомарное `consume()` для всех запросов, где replay недопустим.
- Передавайте одинаковые алгоритм, имена заголовков и `includeHeaders` на клиенте и сервере.
- Подписывайте `content-digest` и критичные бизнес-заголовки через `includeHeaders`.
- Ротируйте секреты при подозрении на компрометацию.

## Лицензия

[MIT](../../LICENSE)
