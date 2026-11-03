import type { IncomingMessage, OutgoingHttpHeaders, ServerResponse } from "node:http";
import { dynamicImport } from "../utils/modules.js";
import type {
  HyperTransport,
  LogLevel,
  SenderProtocol,
  TransportListenOptions,
  TransportRequest,
  TransportResponse,
  TransportServer,
} from "@hyperttp/types";

const DEFAULT_MAX_BODY_BYTES = 10 * 1024 * 1024;

export interface FetchTransportOptions {
  /**
   * @ru Кастомный список поддерживаемых протоколов.
   * @en Custom list of supported protocols.
   */
  protocols?: SenderProtocol[];
  /**
   * @ru Максимальный размер входящего серверного тела в байтах. Превышение
   * возвращает HTTP 413 до передачи тела обработчику.
   * @en Maximum incoming server request body size in bytes. Exceeding it returns
   * HTTP 413 before the body reaches the handler.
   */
  maxBodyBytes?: number;
  /**
   * @ru Обработчик ошибок входящих серверных запросов.
   * @en Error hook for incoming server requests.
   */
  onError?: (error: unknown, request: TransportRequest) => void;
  logger?: (level: LogLevel, message: string, meta?: unknown) => void;
}

type ExtendedTransportRequest = TransportRequest & {
  stream?: boolean;
  followRedirects?: boolean;
};

async function loadNodeHttp(): Promise<typeof import("node:http")> {
  if (typeof process === "undefined" || !process.versions?.node) {
    throw new Error("[FetchTransport] listen() is only available in Node.js.");
  }

  // Keep the specifier behind a module boundary so per-file minification cannot
  // turn it into a browser bundler's statically resolved Node import.
  return dynamicImport("node:http") as Promise<typeof import("node:http")>;
}

async function* readWebStream(
  stream: ReadableStream,
  signal: AbortSignal,
): AsyncGenerator<Uint8Array | string> {
  const reader = stream.getReader();
  let done = false;
  const cancel = () => {
    void reader.cancel(signal.reason).catch(() => {});
  };
  signal.addEventListener("abort", cancel, { once: true });
  if (signal.aborted) cancel();
  try {
    while (true) {
      const result = await reader.read();
      if (result.done) {
        done = true;
        return;
      }
      yield result.value;
    }
  } finally {
    signal.removeEventListener("abort", cancel);
    try {
      if (!done) await reader.cancel();
    } finally {
      reader.releaseLock();
    }
  }
}

/**
 * @ru Минимальный транспорт на базе нативного fetch. Гарантированный fallback,
 * когда ни один пакетный транспорт (@hyperttp/transport-undici/bun) не установлен.
 * @en Minimal native fetch-based transport. A guaranteed fallback used when no
 * packaged transport (@hyperttp/transport-undici/bun) is installed.
 */
export class FetchTransport implements HyperTransport {
  public readonly protocols: readonly SenderProtocol[];
  private readonly maxBodyBytes: number;
  private readonly onError?: FetchTransportOptions["onError"];
  private readonly logger?: FetchTransportOptions["logger"];

  /**
   * @ru Создаёт fallback-транспорт на базе глобального `fetch`.
   * @en Creates a fallback transport based on global `fetch`.
   * @param options - Поддерживаемые протоколы и серверный лимит тела. @en Supported protocols and server body limit.
   */
  constructor(options: FetchTransportOptions = {}) {
    this.protocols = Object.freeze(options.protocols ?? ["rest"]);
    this.maxBodyBytes = options.maxBodyBytes ?? DEFAULT_MAX_BODY_BYTES;
    if (!Number.isSafeInteger(this.maxBodyBytes) || this.maxBodyBytes < 0) {
      throw new RangeError("[FetchTransport] maxBodyBytes must be a non-negative safe integer.");
    }
    this.onError = options.onError;
    this.logger = options.logger;
  }

  public async execute(req: TransportRequest): Promise<TransportResponse> {
    const extendedRequest = req as ExtendedTransportRequest;
    const isBodyAllowed = req.method !== "GET" && req.method !== "HEAD";

    const res = await fetch(req.url, {
      method: req.method,
      headers: req.headers as Record<string, string>,
      body: isBodyAllowed ? ((req.body ?? null) as BodyInit | null) : null,
      signal: req.signal,
      redirect: extendedRequest.followRedirects === false ? "manual" : "follow",
    });

    const body = extendedRequest.stream ? res.body : new Uint8Array(await res.arrayBuffer());
    const headers: Record<string, string | string[]> = {};

    if (typeof res.headers.getSetCookie === "function") {
      const cookies = res.headers.getSetCookie();
      if (cookies.length > 0) {
        headers["set-cookie"] = cookies;
      }
    }

    res.headers.forEach((value, key) => {
      const lowerKey = key.toLowerCase();

      if (lowerKey === "set-cookie" && headers["set-cookie"]) {
        return;
      }

      if (headers[lowerKey]) {
        const existing = headers[lowerKey];
        headers[lowerKey] = Array.isArray(existing) ? [...existing, value] : [existing, value];
      } else {
        headers[lowerKey] = value;
      }
    });

    return {
      status: res.status,
      statusText: res.statusText,
      headers,
      url: res.url,
      body,
    };
  }

  public async listen(options: TransportListenOptions): Promise<TransportServer> {
    const { host, port, signal, onRequest } = options;
    if (signal?.aborted) {
      throw signal.reason ?? new DOMException("The operation was aborted", "AbortError");
    }

    const { createServer } = await loadNodeHttp();

    const server = createServer(async (req: IncomingMessage, res: ServerResponse) => {
      const requestController = new AbortController();
      const abortRequest = () => {
        if (!requestController.signal.aborted) {
          requestController.abort(new DOMException("Client disconnected", "AbortError"));
        }
      };
      const abortIncompleteRequest = () => {
        if (!req.complete) abortRequest();
      };
      const abortIncompleteResponse = () => {
        if (!res.writableEnded) abortRequest();
      };

      req.once("aborted", abortRequest);
      req.once("close", abortIncompleteRequest);
      res.once("close", abortIncompleteResponse);

      try {
        const contentLength = Number(req.headers["content-length"] ?? 0);
        if (Number.isFinite(contentLength) && contentLength > this.maxBodyBytes) {
          res.writeHead(413);
          res.end("Payload Too Large");
          return;
        }

        const chunks: Uint8Array[] = [];
        let receivedBytes = 0;

        for await (const chunk of req) {
          receivedBytes += chunk.byteLength;
          if (receivedBytes > this.maxBodyBytes) {
            res.writeHead(413);
            res.end("Payload Too Large");
            return;
          }
          chunks.push(chunk);
        }

        const body = chunks.length > 0 ? Buffer.concat(chunks) : undefined;
        const headers: Record<string, string | string[]> = {};

        for (const [key, value] of Object.entries(req.headers)) {
          if (value !== undefined) {
            headers[key] = value;
          }
        }

        const transportRequest: TransportRequest = {
          method: req.method ?? "GET",
          url: req.url ?? "/",
          headers,
          body,
          signal: requestController.signal,
          protocol: this.protocols[0] ?? "rest",
        };

        if (!onRequest) {
          res.writeHead(501);
          res.end("Not Implemented");
          return;
        }

        const response = await onRequest(transportRequest);
        const outgoingHeaders: OutgoingHttpHeaders = {};

        for (const [key, value] of Object.entries(response.headers)) {
          outgoingHeaders[key] = value;
        }

        res.writeHead(response.status, response.statusText ?? "", outgoingHeaders);

        const responseBody = response.body;
        if (
          responseBody != null &&
          typeof responseBody === "object" &&
          ((typeof ReadableStream !== "undefined" && responseBody instanceof ReadableStream) ||
            Symbol.asyncIterator in responseBody)
        ) {
          const [{ Readable }, { pipeline }] = await Promise.all([
            dynamicImport("node:stream") as Promise<Pick<typeof import("node:stream"), "Readable">>,
            dynamicImport("node:stream/promises") as Promise<typeof import("node:stream/promises")>,
          ]);
          const source =
            responseBody instanceof ReadableStream
              ? readWebStream(responseBody, requestController.signal)
              : (responseBody as AsyncIterable<Uint8Array | string>);
          await pipeline(Readable.from(source, { objectMode: false }), res, {
            signal: requestController.signal,
          });
        } else if (response.body != null) {
          if (response.body instanceof Uint8Array) {
            res.end(response.body);
          } else if (typeof response.body === "string") {
            res.end(response.body);
          } else {
            res.end(JSON.stringify(response.body));
          }
        } else {
          res.end();
        }
      } catch (error) {
        try {
          this.onError?.(error, {
            method: req.method ?? "GET",
            url: req.url ?? "/",
            headers: req.headers as Record<string, string | string[]>,
            signal: requestController.signal,
            protocol: this.protocols[0] ?? "rest",
          });
        } catch {
          // Error hooks must not prevent the HTTP error response or cleanup.
        }
        if (!res.headersSent) {
          res.writeHead(500);
          res.end("Internal Server Error");
        } else {
          res.destroy();
        }
      } finally {
        req.removeListener("aborted", abortRequest);
        req.removeListener("close", abortIncompleteRequest);
        res.removeListener("close", abortIncompleteResponse);
      }
    });

    let closePromise: Promise<void> | undefined;
    const close = (): Promise<void> => {
      if (closePromise) return closePromise;
      signal?.removeEventListener("abort", closeOnAbort);
      closePromise = new Promise<void>((resolveClose, rejectClose) => {
        server.close((error) => {
          server.removeListener("error", reportRuntimeError);
          if (error && (error as NodeJS.ErrnoException).code !== "ERR_SERVER_NOT_RUNNING") {
            rejectClose(error);
          } else resolveClose();
        });
      });
      return closePromise;
    };
    let abortStartup: (() => void) | undefined;
    const closeOnAbort = () => {
      if (abortStartup) abortStartup();
      else void close().catch(reportRuntimeError);
    };
    const reportRuntimeError = (error: Error) => {
      const message = "[FetchTransport] HTTP server error";
      try {
        if (this.logger) {
          this.logger("error", message, error);
        } else {
          console.error(`${message}:`, error);
        }
      } catch {
        // Diagnostics must not turn an already handled failure into a rejection.
      }
    };

    if (signal?.aborted) {
      throw signal.reason ?? new DOMException("The operation was aborted", "AbortError");
    }
    signal?.addEventListener("abort", closeOnAbort, { once: true });

    return new Promise<TransportServer>((resolve, reject) => {
      const rejectStartup = (error: unknown) => {
        abortStartup = undefined;
        signal?.removeEventListener("abort", closeOnAbort);
        server.removeListener("error", rejectStartup);
        reject(error);
      };
      abortStartup = () => {
        rejectStartup(
          signal?.reason ?? new DOMException("The operation was aborted", "AbortError"),
        );
        void close().catch(reportRuntimeError);
      };

      server.once("error", rejectStartup);
      server.listen({ host, port, signal }, () => {
        if (signal?.aborted) {
          void close().catch(reportRuntimeError);
          return;
        }
        abortStartup = undefined;
        server.removeListener("error", rejectStartup);
        server.on("error", reportRuntimeError);
        resolve({ close });
      });
      if (signal?.aborted) closeOnAbort();
    });
  }

  public async close(): Promise<void> {}
}
