import type {
  HyperReceiver,
  ServerRequestContext,
  TransportRequest,
  TransportResponse,
} from "@hyperttp/types";
import type { RestServerHandler, RestServerInput, RestServerResponse } from "./type.js";
import { HyperClientError } from "../../utils/errors.js";
import { DEFAULT_STATUS_TEXTS, getHeaderValue } from "./utils.js";

const JSON_TYPE = "application/json";
const TEXT_DECODER = new TextDecoder();
const TEXT_ENCODER = new TextEncoder();
const HAS_BUFFER = typeof Buffer !== "undefined";

function decodeUtf8(bytes: Uint8Array): string {
  if (HAS_BUFFER) {
    return Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength).toString("utf8");
  }
  return TEXT_DECODER.decode(bytes);
}

function decodeArrayBuffer(ab: ArrayBuffer): string {
  if (HAS_BUFFER) {
    return Buffer.from(ab).toString("utf8");
  }
  return TEXT_DECODER.decode(ab);
}

function encodeUtf8(str: string): Uint8Array {
  if (HAS_BUFFER) {
    return Buffer.from(str);
  }
  return TEXT_ENCODER.encode(str);
}

/**
 * @ru Разбирает query-строку URL в словарь (поддерживает повторные ключи как массивы).
 * @en Parses a URL query string into a dictionary (supports repeated keys as arrays).
 */
function parseQuery(queryString: string): Record<string, string | string[]> {
  const out: Record<string, string | string[]> = Object.create(null);

  for (const [key, value] of new URLSearchParams(queryString)) {
    const existing = out[key];
    if (existing === undefined) {
      out[key] = value;
    } else if (Array.isArray(existing)) {
      existing.push(value);
    } else {
      out[key] = [existing, value];
    }
  }

  return out;
}

/**
 * @ru Декодирует тело запроса по content-type.
 * @en Decodes the request body based on content-type.
 */
function parseTextBody(
  headers: Readonly<Record<string, string | string[]>>,
  text: string,
): unknown {
  const contentType = getHeaderValue(headers, "content-type") ?? "";
  if (contentType.includes(JSON_TYPE)) {
    try {
      return JSON.parse(text);
    } catch {
      return text;
    }
  }
  return text;
}

function decodeBody(raw: TransportRequest): unknown {
  const body = raw.body;
  if (body == null) return undefined;
  const contentType = getHeaderValue(raw.headers, "content-type") ?? "";
  const textual =
    contentType.includes(JSON_TYPE) ||
    contentType.includes("text/") ||
    contentType.includes("application/xml") ||
    contentType.includes("application/x-www-form-urlencoded");
  if (body instanceof Uint8Array) {
    return textual ? parseTextBody(raw.headers, decodeUtf8(body)) : body;
  }
  if (body instanceof ArrayBuffer) {
    return textual ? parseTextBody(raw.headers, decodeArrayBuffer(body)) : new Uint8Array(body);
  }
  if (ArrayBuffer.isView(body)) {
    const bytes = new Uint8Array(body.buffer, body.byteOffset, body.byteLength);
    return textual ? parseTextBody(raw.headers, decodeUtf8(bytes)) : bytes;
  }
  if (typeof body === "string") return parseTextBody(raw.headers, body);
  return body;
}

/**
 * @ru REST/HTTP серверный адаптер. Зеркальная к `RestSender` реализация
 * трёхфазного цикла receive → handle → respond.
 * @en REST/HTTP server adapter. Mirror implementation of `RestSender` for the
 * three-phase receive → handle → respond cycle.
 */
export class RestReceiver implements HyperReceiver<
  RestServerInput,
  RestServerResponse,
  TransportRequest,
  TransportResponse
> {
  readonly protocol = "rest";
  protected readonly handler?: RestServerHandler;

  /**
   * @ru Создаёт REST-ресивер с необязательным application handler.
   * @en Creates a REST receiver with an optional application handler.
   * @param options - Настройки ресивера и его обработчик. @en Receiver settings and its handler.
   */
  constructor(options: { handler?: RestServerHandler } = {}) {
    this.handler = options.handler;
  }

  /**
   * @ru Фаза приёма: разбирает сырой запрос транспорта в REST-структуру.
   * @en Receive phase: parses raw transport request into REST input structure.
   */
  receive(raw: TransportRequest, _ctx: ServerRequestContext): RestServerInput {
    const url = new URL(raw.url, "http://hyperttp.local");

    return {
      method: raw.method,
      path: url.pathname,
      headers: raw.headers,
      query: parseQuery(url.search.slice(1)),
      body: decodeBody(raw),
    };
  }

  /**
   * @ru Фаза обработки: вызывает зарегистрированный handler.
   * @en Handle phase: executes the registered application handler.
   */
  handle(
    request: RestServerInput,
    ctx: ServerRequestContext,
  ): RestServerResponse | Promise<RestServerResponse> {
    if (ctx.signal?.aborted) {
      throw ctx.signal.reason ?? new Error("Request aborted");
    }

    if (!this.handler) {
      throw new HyperClientError(
        '[RestReceiver] No application handler registered for protocol "rest".',
      );
    }

    return this.handler(request, ctx);
  }

  /**
   * @ru Фаза ответа: сериализует протокольный ответ в транспортный формат.
   * @en Respond phase: serializes protocol response to raw transport format.
   */
  respond(response: RestServerResponse, _ctx: ServerRequestContext): TransportResponse {
    const headers: Record<string, string> = { ...response.headers };
    const status = response.status ?? 200;

    let body: unknown = response.body;
    const streaming =
      body != null &&
      typeof body === "object" &&
      ((typeof ReadableStream !== "undefined" && body instanceof ReadableStream) ||
        Symbol.asyncIterator in body);
    if (streaming) {
      return { status, statusText: DEFAULT_STATUS_TEXTS[status] ?? "", headers, body };
    }
    if (body instanceof ArrayBuffer) {
      body = new Uint8Array(body);
    } else if (ArrayBuffer.isView(body) && !(body instanceof Uint8Array)) {
      body = new Uint8Array(body.buffer, body.byteOffset, body.byteLength).slice();
    } else if (body != null && typeof body === "object" && !(body instanceof Uint8Array)) {
      body = JSON.stringify(body);
      const hasContentType = Object.keys(headers).some((k) => k.toLowerCase() === "content-type");
      if (!hasContentType) headers["content-type"] = JSON_TYPE;
    }

    return {
      status,
      statusText: DEFAULT_STATUS_TEXTS[status] ?? "",
      headers,
      body: body == null ? undefined : body instanceof Uint8Array ? body : encodeUtf8(String(body)),
    };
  }
}
