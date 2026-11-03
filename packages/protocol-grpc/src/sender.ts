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
import { decodeGrpcFrame, encodeGrpcFrame } from "./framing.js";
import type { GrpcInput, GrpcMetadata, GrpcRequestOptions, GrpcResponse } from "./types.js";

const GRPC_DECODE_KEY = "grpc:decode";

/**
 * @ru Опции инициализации gRPC-сендера.
 * @en Initialization options for the gRPC sender.
 */
export interface GrpcSenderOptions {
  /** Базовый URL по умолчанию для всех вызовов. */
  baseUrl?: string;
  transport?: HyperTransport;
  [key: string]: unknown;
}

function getHeader(headers: Record<string, string | string[]>, name: string): string | undefined {
  const key = name.toLowerCase();
  const value = headers[key] ?? headers[name];
  return Array.isArray(value) ? value[0] : value;
}

/**
 * @ru gRPC протокольный сендер. Реализует трёхфазный цикл prepare → send → parse:
 * кодирует Protobuf-сообщение в 5-байтовый gRPC фрейм, отправляет через транспорт
 * и декодирует ответ обратно.
 * @en gRPC protocol sender. Implements the three-phase cycle prepare → send → parse:
 * encodes the Protobuf message into a 5-byte gRPC frame, sends it through the
 * transport, and decodes the response back.
 */
export class GrpcSender implements HyperSender<
  GrpcInput,
  GrpcResponse,
  TransportRequest,
  TransportResponse
> {
  readonly protocol = "grpc";

  readonly methods: Readonly<Record<string, (...args: any[]) => any>> = {
    call: (core: IHyperCore, input: GrpcInput, options?: GrpcRequestOptions) =>
      this.dispatch(core, input, options),
  };

  private readonly options?: GrpcSenderOptions;

  constructor(options?: GrpcSenderOptions) {
    this.options = options;
  }

  /**
   * Фаза 1: PREPARE
   * Превращает gRPC Input в подготовленный бинарный TransportRequest.
   */
  prepare(request: SendRequest<GrpcInput, string>, ctx: RequestContext): TransportRequest {
    const { input, signal } = request;
    const metadata = request.metadata as GrpcMetadata | undefined;
    const rawProto = input.encode(input.message);
    const framedBody = encodeGrpcFrame(rawProto);

    // decode нужен на фазе PARSE, поэтому кладём его в состояние контекста
    ctx.state[GRPC_DECODE_KEY] = input.decode;

    const baseUrl = metadata?.baseUrl ?? input.baseUrl ?? this.options?.baseUrl ?? "";
    const path = `/${input.service}/${input.method}`;
    const url = baseUrl ? `${baseUrl.replace(/\/+$/, "")}${path}` : path;

    return {
      method: "POST",
      url,
      headers: {
        "content-type": "application/grpc",
        te: "trailers",
        ...metadata?.headers,
      },
      body: framedBody,
      signal,
      protocol: this.protocol,
    };
  }

  /**
   * Фаза 2: SEND
   */
  async send(
    prepared: TransportRequest,
    transport: HyperTransport,
    _ctx: RequestContext,
  ): Promise<TransportResponse> {
    return transport.execute(prepared);
  }

  /**
   * Фаза 3: PARSE
   * Распаковывает фрейм, проверяет grpc-status и декодирует Protobuf.
   */
  parse(raw: TransportResponse, ctx: RequestContext): UniversalResponse<GrpcResponse<unknown>> {
    const headers = this.flattenHeaders(raw.headers);
    const rawStatus = getHeader(headers, "grpc-status") ?? "0";
    const grpcStatus = parseInt(rawStatus, 10);
    const grpcMessage = this.decodeGrpcMessage(getHeader(headers, "grpc-message"));
    const httpOk = raw.status >= 200 && raw.status < 300;
    const ok = httpOk && grpcStatus === 0;

    let data: unknown;
    if (ok) {
      const decode = ctx.state[GRPC_DECODE_KEY] as ((bytes: Uint8Array) => unknown) | undefined;
      const body = this.toBytes(raw.body);
      const { payload } = decodeGrpcFrame(body);
      data = decode ? decode(payload) : payload;
    }

    return {
      protocol: this.protocol,
      ok,
      status: raw.status,
      statusText: raw.statusText,
      headers: raw.headers,
      url: raw.url,
      data: { ok, grpcStatus, grpcMessage, data, headers },
      raw,
    };
  }

  private dispatch(
    core: IHyperCore,
    input: GrpcInput,
    options?: GrpcRequestOptions,
  ): Promise<UniversalResponse<GrpcResponse<unknown>>> {
    return core.send<GrpcInput, GrpcResponse, "grpc">({
      protocol: "grpc",
      input,
      signal: options?.signal,
      metadata: options?.metadata,
    });
  }

  private flattenHeaders(headers: Record<string, string | string[]>): Record<string, string> {
    const out: Record<string, string> = {};
    for (const [key, value] of Object.entries(headers)) {
      out[key.toLowerCase()] = Array.isArray(value) ? value.join(",") : value;
    }
    return out;
  }

  private decodeGrpcMessage(message: string | undefined): string | undefined {
    if (!message) return undefined;
    try {
      return decodeURIComponent(message);
    } catch {
      return message;
    }
  }

  private toBytes(body: unknown): Uint8Array {
    if (body instanceof Uint8Array) return body;
    if (body instanceof ArrayBuffer) return new Uint8Array(body);
    if (ArrayBuffer.isView(body)) {
      return new Uint8Array(body.buffer, body.byteOffset, body.byteLength);
    }
    if (typeof body === "string") return new TextEncoder().encode(body);
    return new Uint8Array();
  }
}
