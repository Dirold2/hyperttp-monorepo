# @hyperttp/parser

> [English](https://github.com/IT-IF-OR/hyperttp-parser) | Русский

Официальный плагин преобразования ответов для Hyperttp.

## Возможности

- Автоматически определяет JSON, HTML, XML, текстовые и бинарные ответы.
- Поддерживает типы `auto`, `json`, `text`, `html`, `xml`, `buffer` и `stream`.
- Явно заданный тип ответа имеет приоритет над `Content-Type`.
- Поддерживает protocol-neutral callbacks для извлечения данных и определения типа ответа.
- Уже преобразованные значения передаются без повторной обработки.
- При изменении `data` возвращает новый `UniversalResponse`, не изменяя исходный объект.

## Установка

```bash
npm install @hyperttp/parser
# или
bun add @hyperttp/parser
```

## Опциональная поддержка HTML и XML

JSON, текстовые, бинарные и потоковые ответы работают без дополнительных зависимостей.
Установите только нужный парсер:

```bash
npm install node-html-parser # HTML
npm install fast-xml-builder # Построение XML (отдельный пакет)
npm install fast-xml-parser  # Разбор XML
```

Это опциональные peer-зависимости: они загружаются только при разборе соответствующего
формата, в том числе при определении через `auto`. Если нужный парсер не установлен,
преобразование завершается ошибкой с подсказкой по установке. При `parseHTML: false`
HTML возвращается строкой без `node-html-parser`; для получения исходного HTML/XML
можно также явно запросить `text`. `fast-xml-builder` тоже объявлен отдельной
опциональной peer-зависимостью для построения XML.

## Использование

Пакет `hyperttp` регистрирует parser автоматически:

```ts
import { HyperClient } from "hyperttp";

const client = new HyperClient({
  responseConverter: {
    parseHTML: true,
    htmlMode: "full",
  },
});

const user = await client.get<{ id: number }>(
  "https://api.example.com/users/1",
  "json",
);
```

Отключить встроенный parser можно через `responseConverter: false`:

```ts
const client = new HyperClient({
  responseConverter: false,
});
```

При прямом использовании `@hyperttp/core` зарегистрируйте plugin явно:

```ts
import { HyperCore } from "@hyperttp/core";
import { withParser } from "@hyperttp/parser";

const core = new HyperCore();
core.use(withParser({ htmlMode: "full" }));
```

Один только импорт `@hyperttp/parser` не регистрирует plugin.

## Типы ответа

| Тип | Результат |
| --- | --- |
| `auto` | Определение по `Content-Type` или расширению URL |
| `json` | JavaScript-значение после JSON-разбора |
| `text` | Строка |
| `html` | Объект HTML или исходная строка при `parseHTML: false` |
| `xml` | Объекты/массивы → XML через `fast-xml-builder`; строки/бинарные данные → объект через `fast-xml-parser` |
| `buffer` | `Buffer` в Node.js или `Uint8Array` в Bun |
| `stream` | Передача без преобразования |

## Преобразование XML

```ts
import { ResponseConverter } from "@hyperttp/parser";

const converter = new ResponseConverter({ xmlBuilderOptions: { format: true } });
const xml = await converter.convert({ root: { value: "42" } }, "xml");
const data = await converter.convert(xml, "xml"); // { root: { value: "42" } }
```

Обычные объекты и массивы преобразуются в XML, строки и бинарные данные разбираются как XML.
По умолчанию builder сохраняет атрибуты с префиксом `@_`, совместимым с настройками parser.
Загружается только зависимость для выбранного направления. `null`/`undefined` остаются `null`.

## Настройка

`withParser(options?)` поддерживает `charset`, `parseHTML`, `htmlMode`, `xmlParserOptions`, `xmlBuilderOptions`,
`shouldParse`, `getData`/`bodyExtractor`, `getResponseType`/`detectResponseType` и
`isEmptyResponse`. Callbacks могут быть синхронными или асинхронными и получают response,
request и request context.

Для REST ответы `HEAD` по умолчанию пропускаются, а статусы `204`, `205` и `304`
возвращаются с `data: null`. Для других протоколов поведение задаётся callbacks.

> `maxBodySize` и `parseErrors` зарезервированы в v2.0.0 и пока не применяются при преобразовании.

## Лицензия

MIT © dirold2
