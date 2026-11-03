import type { UniversalResponse } from "@hyperttp/types";

/**
 * @ru Входные данные gRPC-вызова.
 * @en Input of a gRPC call.
 */
export interface GrpcInput<TReq = unknown, TRes = unknown> {
  /** @example "api.v1.UserService" */
  service: string;
  /** @example "GetUser" */
  method: string;
  message: TReq;
  /** Функция сериализации в Protobuf (например, из ts-proto или protobufjs) */
  encode: (msg: TReq) => Uint8Array;
  /** Функция десериализации из Protobuf */
  decode: (bytes: Uint8Array) => TRes;
  /** Базовый URL (например, "https://api.example.com") */
  baseUrl?: string;
}

/**
 * @ru Метаданные gRPC-запроса (заголовки и базовый URL).
 * @en gRPC request metadata (headers and base URL).
 */
export interface GrpcMetadata {
  headers?: Record<string, string>;
  baseUrl?: string;
}

/**
 * @ru Нормализованный ответ gRPC-вызова.
 * @en Normalized gRPC call response.
 */
export interface GrpcResponse<TRes = unknown> {
  /** Успешен ли вызов (HTTP 2xx и grpc-status === 0) */
  ok: boolean;
  grpcStatus: number;
  grpcMessage?: string;
  data: TRes;
  headers: Record<string, string>;
}

export interface GrpcRequestOptions {
  metadata?: GrpcMetadata;
  signal?: AbortSignal;
}

export type GrpcClientMethods = {
  call<TReq = unknown, TRes = unknown>(
    input: GrpcInput<TReq, TRes>,
    options?: GrpcRequestOptions,
  ): Promise<UniversalResponse<GrpcResponse<TRes>>>;
};

declare module "@hyperttp/types" {
  interface ProtocolInputMap {
    grpc: GrpcInput;
  }

  interface ProtocolMetadataMap {
    grpc: GrpcMetadata;
  }

  interface HyperProtocols {
    readonly grpc: GrpcClientMethods;
  }
}
