import type { ConversionMeta, ResponseType } from "../types/response.js";
import type { ResponseConverterOptions } from "../types/response.js";

type ParsedResponse = unknown;

const MISS = Symbol("MISS");

type NativeBodyLike = {
  json?: () => Promise<unknown>;
  text?: () => Promise<string>;
  bytes?: () => Promise<Uint8Array | ArrayBuffer>;
  arrayBuffer?: () => Promise<ArrayBuffer>;
};

interface TransportResponseLike {
  body: unknown;
  headers?: unknown;
  status?: number;
  url?: string;
}

function normalizeCT(ct?: string): string | undefined {
  if (!ct) return undefined;
  const i = ct.indexOf(";");
  return (i === -1 ? ct : ct.slice(0, i)).trim().toLowerCase();
}

function extOf(url?: string): string {
  if (!url) return "";
  const i = url.lastIndexOf(".");
  return i === -1 ? "" : url.slice(i).toLowerCase();
}

function isBufferLike(v: unknown): v is Buffer {
  return typeof Buffer !== "undefined" && Buffer.isBuffer(v);
}

function isUint8ArrayLike(v: unknown): v is Uint8Array {
  return v instanceof Uint8Array;
}

function isArrayBufferLike(v: unknown): v is ArrayBuffer {
  return v instanceof ArrayBuffer;
}

function isBlobLike(v: unknown): v is Blob {
  return typeof Blob !== "undefined" && v instanceof Blob;
}

function isReadableStreamLike(v: unknown): v is ReadableStream<Uint8Array> {
  return typeof ReadableStream !== "undefined" && v instanceof ReadableStream;
}

function hasAsyncIterator(v: unknown): v is AsyncIterable<unknown> {
  return v != null && typeof v === "object" && Symbol.asyncIterator in v;
}

function hasNodeStreamAPI(v: unknown): v is {
  on: (event: string, cb: (...args: any[]) => void) => void;
  off?: (event: string, cb: (...args: any[]) => void) => void;
  destroy?: () => void;
  removeListener?: (event: string, cb: (...args: any[]) => void) => void;
} {
  return v != null && typeof v === "object" && "on" in v && typeof (v as any).on === "function";
}

function isPlainJsonValue(v: unknown): v is Record<string, unknown> | unknown[] {
  if (Array.isArray(v)) return true;
  if (!v || typeof v !== "object") return false;

  const proto = Object.getPrototypeOf(v);
  return proto === Object.prototype || proto === null;
}

function extractRaw<T>(target: T | { raw?: T }): T {
  if (target && typeof target === "object") {
    const raw = (target as Record<string, unknown>).raw;
    if (raw !== undefined) return raw as T;
  }
  return target as T;
}

export class ResponseConverter {
  private readonly options: ResponseConverterOptions;
  private readonly typeCache = new Map<string, ResponseType>();
  private readonly charset: string;
  private readonly decoder: TextDecoder;
  private readonly isBun = typeof (globalThis as any).Bun !== "undefined";

  private _xmlBuilderPromise: Promise<{ build(data: any): string }> | null = null;
  private _xmlParser: { parse(text: string): unknown } | null = null;
  private _xmlPromise: Promise<{ parse(text: string): unknown }> | null = null;
  private _htmlParser: ((html: string) => any) | null = null;
  private _htmlParserPromise: Promise<(html: string) => any> | null = null;

  constructor(options: ResponseConverterOptions = {}) {
    this.options = options;
    this.charset = options.charset ?? "utf-8";
    this.decoder = new TextDecoder("utf-8");
  }

  async convert(
    body: unknown,
    targetType: ResponseType,
    meta: ConversionMeta = {},
  ): Promise<ParsedResponse> {
    if (body == null) return null;

    const source = extractRaw(body);

    if (this.isTransportResponseLike(source)) {
      meta.url ??= source.url;

      if (targetType === "stream") {
        return source.body as ParsedResponse;
      }

      const type = targetType === "auto" ? this.detect(meta.contentType, meta.url) : targetType;
      return this.convertBody(source.body, type);
    }

    const type = targetType === "auto" ? this.detect(meta.contentType, meta.url) : targetType;
    return this.convertBody(source, type);
  }

  private async convertBody(body: unknown, type: ResponseType): Promise<ParsedResponse> {
    if (body == null) return null;

    const native = await this.tryNative(body, type);
    if (native !== MISS) return native;

    const fast = await this.fast(body, type);
    if (fast !== MISS) return fast;

    return this.slow(body, type);
  }

  private async tryNative(
    body: unknown,
    type: ResponseType,
  ): Promise<ParsedResponse | typeof MISS> {
    if (!body || typeof body !== "object") return MISS;

    const b = body as NativeBodyLike;

    if (type === "json" && typeof b.json === "function") return await b.json();
    if (type === "text" && typeof b.text === "function") return await b.text();
    if (type === "buffer" && typeof b.bytes === "function") {
      const bytes = await b.bytes();
      return bytes instanceof ArrayBuffer ? new Uint8Array(bytes) : bytes;
    }
    if (type === "buffer" && typeof b.arrayBuffer === "function") {
      return new Uint8Array(await b.arrayBuffer());
    }

    return MISS;
  }

  private async bodyToBytes(body: unknown): Promise<Uint8Array | typeof MISS> {
    if (isUint8ArrayLike(body)) return body;
    if (isArrayBufferLike(body)) return new Uint8Array(body);
    if (isBufferLike(body)) return body;
    if (isBlobLike(body)) return new Uint8Array(await body.arrayBuffer());
    if (isReadableStreamLike(body)) return await this.readReadableStream(body);
    if (hasAsyncIterator(body)) return await this.readAsyncIterable(body);
    if (hasNodeStreamAPI(body)) return await this.readNodeStream(body);
    return MISS;
  }

  private async fast(body: unknown, type: ResponseType): Promise<ParsedResponse | typeof MISS> {
    if (type === "buffer") {
      if (this.isBun || typeof Buffer === "undefined") {
        return this.bodyToBytes(body);
      } else {
        if (isBufferLike(body)) return body;
        const bytes = await this.bodyToBytes(body);
        return bytes !== MISS ? Buffer.from(bytes) : MISS;
      }
    }

    if (type === "text") {
      if (typeof body === "string") return body;
      const bytes = await this.bodyToBytes(body);
      return bytes !== MISS ? this.bytesToText(bytes) : MISS;
    }

    if (type === "xml" && isPlainJsonValue(body)) {
      const builder = await this.getXmlBuilder();
      return builder.build(body);
    }

    if (type === "json") {
      return this.resolveJsonBody(body);
    }

    return MISS;
  }

  private bytesToText(bytes: Uint8Array): string {
    return this.isBun || typeof Buffer === "undefined"
      ? (this.charset === "utf-8" || this.charset === "utf8"
          ? this.decoder
          : new TextDecoder(this.charset)
        ).decode(bytes)
      : Buffer.from(bytes).toString(this.charset as BufferEncoding);
  }

  private tryParseJson(text: string): ParsedResponse {
    try {
      return JSON.parse(text);
    } catch {
      return this.safeJsonParseFallback(text);
    }
  }

  private async resolveJsonBody(body: unknown): Promise<ParsedResponse | typeof MISS> {
    if (isPlainJsonValue(body) || typeof body === "number" || typeof body === "boolean") {
      return body;
    }
    if (typeof body === "string") return this.tryParseJson(body);

    const bytes = await this.bodyToBytes(body);
    return bytes !== MISS ? this.tryParseJson(this.bytesToText(bytes)) : MISS;
  }

  private async slow(body: unknown, type: ResponseType): Promise<ParsedResponse> {
    const text = await this.toText(body);
    if (text.length === 0) return null;

    switch (type) {
      case "buffer":
        if (
          typeof Buffer === "undefined" &&
          !["utf8", "utf-8"].includes(this.charset.toLowerCase())
        ) {
          throw new TypeError("Non-UTF-8 string-to-buffer encoding requires Buffer support");
        }
        return this.isBun || typeof Buffer === "undefined"
          ? new TextEncoder().encode(text)
          : Buffer.from(text, this.charset as BufferEncoding);

      case "text":
        return text;

      case "json":
        return this.tryParseJson(text);

      case "html":
        return this.htmlToJson(text);

      case "xml": {
        const parser = await this.getXmlParser();
        return parser.parse(text) as ParsedResponse;
      }

      default:
        return text;
    }
  }

  private async toText(body: unknown): Promise<string> {
    if (typeof body === "string") return body;

    const bytes = await this.bodyToBytes(body);
    if (bytes !== MISS) return this.bytesToText(bytes);

    const native = body as NativeBodyLike;
    if (typeof native.text === "function") return await native.text();
    if (typeof native.bytes === "function") {
      const b = await native.bytes();
      return this.bytesToText(b instanceof ArrayBuffer ? new Uint8Array(b) : b);
    }
    if (typeof native.arrayBuffer === "function") {
      return this.bytesToText(new Uint8Array(await native.arrayBuffer()));
    }

    return String(body);
  }

  private async readReadableStream(stream: ReadableStream<Uint8Array>): Promise<Uint8Array> {
    if (this.isBun) {
      return new Uint8Array(await new Response(stream).arrayBuffer());
    }

    const reader = stream.getReader();
    const chunks: Uint8Array[] = [];
    let total = 0;

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        if (!value) continue;

        chunks.push(value);
        total += value.byteLength;
      }
    } finally {
      reader.releaseLock();
    }

    if (chunks.length === 0) return new Uint8Array(0);
    if (chunks.length === 1) return chunks[0]!;

    const out = new Uint8Array(total);
    let offset = 0;
    for (const chunk of chunks) {
      out.set(chunk, offset);
      offset += chunk.byteLength;
    }
    return out;
  }

  private async readAsyncIterable(iterable: AsyncIterable<unknown>): Promise<Uint8Array> {
    const chunks: Uint8Array[] = [];
    let total = 0;

    for await (const chunk of iterable) {
      const bytes = this.chunkToBytes(chunk);
      if (!bytes.length) continue;
      chunks.push(bytes);
      total += bytes.byteLength;
    }

    if (chunks.length === 0) return new Uint8Array(0);
    if (chunks.length === 1) return chunks[0]!;

    const out = new Uint8Array(total);
    let offset = 0;

    for (const chunk of chunks) {
      out.set(chunk, offset);
      offset += chunk.byteLength;
    }

    return out;
  }

  private async readNodeStream(stream: any): Promise<Uint8Array> {
    return new Promise((resolve, reject) => {
      const chunks: Uint8Array[] = [];
      let total = 0;

      const onData = (chunk: any) => {
        const bytes = this.chunkToBytes(chunk);
        if (!bytes.length) return;
        chunks.push(bytes);
        total += bytes.byteLength;
      };

      const onEnd = () => {
        cleanup();

        if (chunks.length === 0) {
          resolve(new Uint8Array(0));
          return;
        }

        if (chunks.length === 1) {
          resolve(chunks[0]!);
          return;
        }

        const out = new Uint8Array(total);
        let offset = 0;

        for (const chunk of chunks) {
          out.set(chunk, offset);
          offset += chunk.byteLength;
        }

        resolve(out);
      };

      const onError = (err: unknown) => {
        cleanup();
        reject(err);
      };

      const cleanup = () => {
        if (typeof stream.off === "function") {
          stream.off("data", onData);
          stream.off("end", onEnd);
          stream.off("error", onError);
        } else {
          stream.removeListener?.("data", onData);
          stream.removeListener?.("end", onEnd);
          stream.removeListener?.("error", onError);
        }
      };

      stream.on("data", onData);
      stream.on("end", onEnd);
      stream.on("error", onError);
    });
  }

  private chunkToBytes(chunk: unknown): Uint8Array {
    if (chunk == null) return new Uint8Array(0);
    if (isUint8ArrayLike(chunk)) return chunk;
    if (isArrayBufferLike(chunk)) return new Uint8Array(chunk);
    if (typeof chunk === "string") return new TextEncoder().encode(chunk);
    if (typeof chunk === "object") return new TextEncoder().encode(JSON.stringify(chunk));
    return new TextEncoder().encode(String(chunk));
  }

  private isTransportResponseLike(obj: unknown): obj is TransportResponseLike {
    return (
      obj != null &&
      typeof obj === "object" &&
      "body" in obj &&
      ("headers" in obj || "status" in obj || "url" in obj)
    );
  }

  private detect(ct?: string, url?: string): ResponseType {
    const key = `${ct ?? ""}|${url ?? ""}`;
    const cached = this.typeCache.get(key);
    if (cached) return cached;

    let out: ResponseType = "text";
    const c = normalizeCT(ct);

    if (c) {
      if (c === "application/json" || c.endsWith("+json")) out = "json";
      else if (c === "text/html") out = "html";
      else if (c.includes("xml")) out = "xml";
      else if (
        c.startsWith("image/") ||
        c.startsWith("audio/") ||
        c.startsWith("video/") ||
        c === "application/octet-stream"
      ) {
        out = "buffer";
      }
    }

    if (out === "text") {
      const ext = extOf(url);
      if (ext === ".json") out = "json";
      else if (ext === ".xml") out = "xml";
      else if (ext === ".html" || ext === ".htm") out = "html";
    }

    if (this.typeCache.size > 128) {
      const first = this.typeCache.keys().next().value;
      if (first !== undefined) this.typeCache.delete(first);
    }

    this.typeCache.set(key, out);
    return out;
  }

  private safeJsonParseFallback(text: string): ParsedResponse {
    if (!text) return null;

    const firstBrace = text.indexOf("{");
    const firstBracket = text.indexOf("[");
    const start =
      firstBrace !== -1 && (firstBracket === -1 || firstBrace < firstBracket)
        ? firstBrace
        : firstBracket;

    if (start !== -1) {
      const lastBrace = text.lastIndexOf("}");
      const lastBracket = text.lastIndexOf("]");
      const end = lastBrace > lastBracket ? lastBrace : lastBracket;

      if (end > start) {
        try {
          return JSON.parse(text.slice(start, end + 1));
        } catch {
          //
        }
      }
    }

    return { data: text } as ParsedResponse;
  }

  private async htmlToJson(html: string): Promise<ParsedResponse> {
    if (this.options.parseHTML === false) return html;

    const parse = await this.getHtmlParser();
    const root = parse(html);

    if (this.options.htmlMode === "simple") {
      return {
        title: root.querySelector("title")?.textContent ?? "",
        text: root.querySelector("body")?.textContent?.trim() ?? "",
      };
    }

    const titleEl = root.querySelector("title");
    const metaEls = root.querySelectorAll("meta");
    const bodyEl = root.querySelector("body");

    const result = {
      title: titleEl?.textContent || undefined,
      meta: {} as Record<string, string>,
      body: {
        text: bodyEl?.textContent?.trim() ?? "",
      } as Record<string, unknown>,
    };

    for (const el of metaEls) {
      const name =
        el.getAttribute("name") || el.getAttribute("property") || el.getAttribute("charset");
      const content = el.getAttribute("content") || el.getAttribute("value") || "";
      if (name) result.meta[name] = content;
    }

    if (bodyEl) {
      for (const child of bodyEl.childNodes) {
        const tag = (child as any).tagName;
        if (!tag) continue;

        const text = (child as any).textContent?.trim();
        if (!text) continue;

        const bodyTarget = result.body as Record<string, string[]>;
        (bodyTarget[tag] ??= []).push(text);
      }
    }

    return result as ParsedResponse;
  }

  private getXmlBuilder(): Promise<{ build(data: any): string }> {
    if (!this._xmlBuilderPromise) {
      this._xmlBuilderPromise = import("fast-xml-builder")
        .catch((cause: unknown) => {
          throw new Error(
            '@hyperttp/parser: XML building requires "fast-xml-builder". Install it with: npm install fast-xml-builder',
            { cause },
          );
        })
        .then(
          ({ default: XMLBuilder }) =>
            new XMLBuilder({
              ignoreAttributes: false,
              attributeNamePrefix: "@_",
              ...this.options.xmlBuilderOptions,
            }),
        );
    }
    return this._xmlBuilderPromise;
  }

  private async getXmlParser(): Promise<{ parse(text: string): unknown }> {
    if (this._xmlParser) return Promise.resolve(this._xmlParser);
    if (!this._xmlPromise) {
      this._xmlPromise = import("fast-xml-parser")
        .catch((cause: unknown) => {
          throw new Error(
            '@hyperttp/parser: XML parsing requires "fast-xml-parser". Install it with: npm install fast-xml-parser',
            { cause },
          );
        })
        .then(({ XMLParser }) => {
          this._xmlParser = new XMLParser({
            ignoreAttributes: false,
            attributeNamePrefix: "@_",
            parseTagValue: false,
            parseAttributeValue: false,
            trimValues: true,
            ...this.options.xmlParserOptions,
          });
          return this._xmlParser;
        });
    }
    return this._xmlPromise;
  }

  private async getHtmlParser(): Promise<(html: string) => any> {
    if (this._htmlParser) return Promise.resolve(this._htmlParser);
    if (!this._htmlParserPromise) {
      this._htmlParserPromise = import("node-html-parser")
        .catch((cause: unknown) => {
          throw new Error(
            '@hyperttp/parser: HTML parsing requires "node-html-parser". Install it with: npm install node-html-parser',
            { cause },
          );
        })
        .then((mod) => {
          this._htmlParser = ((mod as any).parse ?? mod) as (html: string) => any;
          return this._htmlParser!;
        });
    }
    return this._htmlParserPromise;
  }
}
