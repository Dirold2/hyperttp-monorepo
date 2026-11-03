import type {
  HyperSender,
  HyperTransport,
  IHyperCore,
  RequestContext,
  SendRequest,
  TransportRequest,
  TransportResponse,
  UniversalResponse,
} from "@hyperttp/types";
import type { RestInput, RestRequestOptions, HttpMethod } from "./type.js";
import { TimeoutError } from "../../utils/errors.js";
import { applyTimeout } from "../../utils/abort.js";
import { DEFAULT_STATUS_TEXTS, getHeaderValue } from "./utils.js";

const STREAM_HINT = "rest:stream";
const TEXT_ENCODER = new TextEncoder();
const TEXT_DECODER = new TextDecoder();
const REQUEST_CLEANUPS = new WeakMap<TransportRequest, () => void>();

type RestTransportRequest = TransportRequest & {
  stealth?: boolean;
};

type RestTransportResponse = TransportResponse & {
  [STREAM_HINT]?: boolean;
};

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== "object") {
    return false;
  }
  const proto = Object.getPrototypeOf(value);
  return proto === null || proto === Object.prototype;
}

async function collectBody(body: unknown): Promise<unknown> {
  if (body instanceof Uint8Array) return body;
  if (body instanceof ArrayBuffer) return new Uint8Array(body);
  if (ArrayBuffer.isView(body)) {
    return new Uint8Array(body.buffer, body.byteOffset, body.byteLength).slice();
  }

  if (body && typeof body === "object" && "arrayBuffer" in body) {
    const arrayBuffer = (body as { arrayBuffer?: unknown }).arrayBuffer;
    if (typeof arrayBuffer === "function") {
      return new Uint8Array(await arrayBuffer.call(body));
    }
  }

  if (typeof ReadableStream !== "undefined" && body instanceof ReadableStream) {
    const reader = body.getReader();
    const chunks: Uint8Array[] = [];
    let totalLength = 0;

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        const chunk = value instanceof Uint8Array ? value : new Uint8Array(value);
        chunks.push(chunk);
        totalLength += chunk.byteLength;
      }
    } finally {
      reader.releaseLock();
    }

    const collected = new Uint8Array(totalLength);
    let offset = 0;
    for (const chunk of chunks) {
      collected.set(chunk, offset);
      offset += chunk.byteLength;
    }
    return collected;
  }

  return body;
}

function bindStream(
  body: ReadableStream,
  signal: AbortSignal | undefined,
  cleanup: () => void,
): ReadableStream {
  const reader = body.getReader();
  let finished = false;
  let controller: ReadableStreamDefaultController;
  const finish = () => {
    if (finished) return;
    finished = true;
    signal?.removeEventListener("abort", onAbort);
    reader.releaseLock();
    cleanup();
  };
  const cancel = async (reason: unknown) => {
    try {
      await reader.cancel(reason);
    } finally {
      finish();
    }
  };
  const onAbort = () => {
    controller.error(signal?.reason);
    void cancel(signal?.reason).catch(() => {});
  };
  return new ReadableStream({
    start(value) {
      controller = value;
      signal?.addEventListener("abort", onAbort, { once: true });
      if (signal?.aborted) onAbort();
    },
    async pull() {
      try {
        const result = await reader.read();
        if (finished) return;
        if (result.done) {
          controller.close();
          finish();
        } else {
          controller.enqueue(result.value);
        }
      } catch (error) {
        if (!finished) {
          controller.error(error);
          finish();
        }
      }
    },
    cancel,
  });
}

function bindIterable(
  body: AsyncIterable<unknown> & { destroy?: () => void },
  signal: AbortSignal | undefined,
  cleanup: () => void,
): AsyncIterableIterator<unknown> {
  const iterator = body[Symbol.asyncIterator]();
  let finished = false;
  let aborted = false;
  const finish = () => {
    if (finished) return;
    finished = true;
    signal?.removeEventListener("abort", onAbort);
    cleanup();
  };
  const onAbort = () => {
    aborted = true;
    finish();
    // Node streams can interrupt a pending read; generic iterators may only queue return().
    void (async () => {
      try {
        body.destroy?.();
      } finally {
        await iterator.return?.();
      }
    })().catch(() => {});
  };
  signal?.addEventListener("abort", onAbort, { once: true });
  if (signal?.aborted) onAbort();
  return {
    [Symbol.asyncIterator]() {
      return this;
    },
    async next() {
      if (aborted) throw signal?.reason;
      if (finished) return { done: true, value: undefined };
      let rejectRead!: () => void;
      const abort = new Promise<never>((_resolve, reject) => {
        rejectRead = () => reject(signal?.reason);
        signal?.addEventListener("abort", rejectRead, { once: true });
      });
      try {
        const result = await Promise.race([iterator.next(), abort]);
        if (aborted) throw signal?.reason;
        if (result.done) finish();
        return result;
      } catch (error) {
        finish();
        throw error;
      } finally {
        signal?.removeEventListener("abort", rejectRead);
      }
    },
    async return(value?: unknown) {
      try {
        return (await iterator.return?.(value)) ?? { done: true, value };
      } finally {
        finish();
      }
    },
    async throw(error?: unknown) {
      try {
        if (iterator.throw) return await iterator.throw(error);
        await iterator.return?.();
        throw error;
      } finally {
        finish();
      }
    },
  };
}

export class RestSender implements HyperSender<
  RestInput,
  unknown,
  TransportRequest,
  TransportResponse
> {
  readonly protocol = "rest";

  readonly methods: Readonly<Record<string, (...args: any[]) => any>> = {
    get: (core: IHyperCore, url: string, options?: RestRequestOptions, signal?: AbortSignal) =>
      this.dispatch(core, { method: "GET", url, ...options, signal: signal ?? options?.signal }),

    post: (
      core: IHyperCore,
      url: string,
      body?: unknown,
      options?: Omit<RestRequestOptions, "body">,
      signal?: AbortSignal,
    ) =>
      this.dispatch(core, {
        method: "POST",
        url,
        ...options,
        body,
        signal: signal ?? options?.signal,
      }),

    put: (
      core: IHyperCore,
      url: string,
      body?: unknown,
      options?: Omit<RestRequestOptions, "body">,
      signal?: AbortSignal,
    ) =>
      this.dispatch(core, {
        method: "PUT",
        url,
        ...options,
        body,
        signal: signal ?? options?.signal,
      }),

    patch: (
      core: IHyperCore,
      url: string,
      body?: unknown,
      options?: Omit<RestRequestOptions, "body">,
      signal?: AbortSignal,
    ) =>
      this.dispatch(core, {
        method: "PATCH",
        url,
        ...options,
        body,
        signal: signal ?? options?.signal,
      }),

    delete: (core: IHyperCore, url: string, options?: RestRequestOptions, signal?: AbortSignal) =>
      this.dispatch(core, { method: "DELETE", url, ...options, signal: signal ?? options?.signal }),

    head: (core: IHyperCore, url: string, options?: RestRequestOptions, signal?: AbortSignal) =>
      this.dispatch(core, { method: "HEAD", url, ...options, signal: signal ?? options?.signal }),

    options: (core: IHyperCore, url: string, options?: RestRequestOptions, signal?: AbortSignal) =>
      this.dispatch(core, {
        method: "OPTIONS",
        url,
        ...options,
        signal: signal ?? options?.signal,
      }),

    query: (
      core: IHyperCore,
      url: string,
      body?: unknown,
      options?: Omit<RestRequestOptions, "body">,
      signal?: AbortSignal,
    ) =>
      this.dispatch(core, {
        method: "QUERY",
        url,
        ...options,
        body,
        signal: signal ?? options?.signal,
      }),

    request: (
      core: IHyperCore,
      method: HttpMethod | (string & {}),
      url: string,
      options?: RestRequestOptions,
      signal?: AbortSignal,
    ) =>
      this.dispatch(core, {
        method: method as HttpMethod,
        url,
        ...options,
        signal: signal ?? options?.signal,
      }),

    stream: (
      core: IHyperCore,
      url: string,
      options?: Omit<RestRequestOptions, "stream">,
      signal?: AbortSignal,
    ) =>
      this.dispatch(core, {
        method: "GET",
        url,
        ...options,
        stream: true,
        signal: signal ?? options?.signal,
      }),
  };

  prepare(request: SendRequest<RestInput, string>, ctx: RequestContext): TransportRequest {
    const { input } = request;
    const inputSignal = request.signal ?? input.signal ?? ctx.signal;
    const timeout = input.timeout;
    let cleanupSignal: (() => void) | undefined;
    let signal = inputSignal;

    if (timeout != null && timeout > 0) {
      const timeoutMeta: { cleanupSignal?: () => void } = {};
      signal = applyTimeout(
        inputSignal,
        timeout,
        timeoutMeta,
        () => new TimeoutError(input.url, timeout),
      );
      cleanupSignal = timeoutMeta.cleanupSignal;
    }

    try {
      const headers: Record<string, string> = {};

      if (input.headers) {
        if (input.headers instanceof Headers) {
          input.headers.forEach((value, key) => {
            headers[key.toLowerCase()] = value;
          });
        } else if (Array.isArray(input.headers)) {
          for (const [key, value] of input.headers) {
            headers[key.toLowerCase()] = value;
          }
        } else {
          for (const [key, value] of Object.entries(input.headers)) {
            if (value != null) {
              headers[key.toLowerCase()] = String(value);
            }
          }
        }
      }

      let body = input.body;

      if (body !== undefined && body !== null && (isPlainObject(body) || Array.isArray(body))) {
        body = TEXT_ENCODER.encode(JSON.stringify(body));
        if (!headers["content-type"]) {
          headers["content-type"] = "application/json; charset=utf-8";
        }
      } else if (typeof body === "string") {
        body = TEXT_ENCODER.encode(body);
      }

      const prepared = {
        method: input.method.toUpperCase(),
        url: this.buildUrl(input.url, input.query),
        headers,
        body,
        signal,
        protocol: this.protocol,
        stream: input.stream,
        stealth: input.stealth,
        followRedirects: input.followRedirects,
        maxRedirects: input.maxRedirects,
      } as RestTransportRequest;

      if (cleanupSignal) REQUEST_CLEANUPS.set(prepared, cleanupSignal);
      return prepared;
    } catch (error) {
      cleanupSignal?.();
      throw error;
    }
  }

  async send(
    prepared: TransportRequest,
    transport: HyperTransport,
    _ctx: RequestContext,
  ): Promise<TransportResponse> {
    const restRequest = prepared as RestTransportRequest;
    const cleanup = () => {
      const release = REQUEST_CLEANUPS.get(prepared);
      REQUEST_CLEANUPS.delete(prepared);
      release?.();
    };
    let streaming = false;
    try {
      const response = await transport.execute(prepared);
      if (restRequest.stream) {
        if (typeof ReadableStream !== "undefined" && response.body instanceof ReadableStream) {
          const body = bindStream(response.body, prepared.signal, cleanup);
          streaming = true;
          return { ...response, body, [STREAM_HINT]: true } as RestTransportResponse;
        }
        if (
          response.body != null &&
          typeof response.body === "object" &&
          typeof (response.body as AsyncIterable<unknown>)[Symbol.asyncIterator] === "function"
        ) {
          const body = bindIterable(
            response.body as AsyncIterable<unknown>,
            prepared.signal,
            cleanup,
          );
          streaming = true;
          return { ...response, body, [STREAM_HINT]: true } as RestTransportResponse;
        }
        return { ...response, [STREAM_HINT]: true } as RestTransportResponse;
      }

      const body = await collectBody(response.body);
      return body === response.body ? response : { ...response, body };
    } finally {
      if (!streaming) cleanup();
    }
  }

  parse(raw: TransportResponse, _ctx: RequestContext): UniversalResponse<unknown> {
    const ok = raw.status >= 200 && raw.status < 300;
    let parsedData: unknown = raw.body;

    if (!(raw as RestTransportResponse)[STREAM_HINT] && raw.body instanceof Uint8Array) {
      const contentType = getHeaderValue(raw.headers, "content-type") ?? "";
      const text = TEXT_DECODER.decode(raw.body);

      if (contentType.includes("application/json")) {
        try {
          parsedData = JSON.parse(text);
        } catch {
          parsedData = text;
        }
      } else if (contentType.includes("text/") || contentType.includes("application/xml")) {
        parsedData = text;
      }
    }

    return {
      protocol: this.protocol,
      ok,
      status: raw.status,
      statusText: raw.statusText || DEFAULT_STATUS_TEXTS[raw.status] || "",
      headers: raw.headers,
      url: raw.url,
      data: parsedData,
      raw,
    };
  }

  private dispatch(core: IHyperCore, input: RestInput): Promise<UniversalResponse<unknown>> {
    return core.send<RestInput, unknown, "rest">({
      protocol: "rest",
      input,
      signal: input.signal,
    });
  }

  private buildUrl(baseUrl: string, query?: RestInput["query"]): string {
    if (!query) {
      return baseUrl;
    }

    const parts: string[] = [];

    for (const [key, value] of Object.entries(query)) {
      if (value === undefined || value === null) {
        continue;
      }

      const values = Array.isArray(value) ? value : [value];

      for (const v of values) {
        parts.push(`${encodeURIComponent(key)}=${encodeURIComponent(String(v))}`);
      }
    }

    if (parts.length === 0) {
      return baseUrl;
    }

    const queryString = parts.join("&");
    const hashIndex = baseUrl.indexOf("#");

    if (hashIndex !== -1) {
      const urlBeforeHash = baseUrl.slice(0, hashIndex);
      const hashPart = baseUrl.slice(hashIndex);
      const separator = urlBeforeHash.includes("?") ? "&" : "?";

      return `${urlBeforeHash}${separator}${queryString}${hashPart}`;
    }

    const separator = baseUrl.includes("?") ? "&" : "?";

    return `${baseUrl}${separator}${queryString}`;
  }
}
