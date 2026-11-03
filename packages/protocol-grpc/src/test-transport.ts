import type {
  HyperTransport,
  HyperProtocolName,
  TransportRequest,
  TransportResponse,
} from "@hyperttp/types";
import { decodeGrpcFrame, encodeGrpcFrame } from "./framing.js";

export type GrpcHandler = (
  service: string,
  method: string,
  payload: Uint8Array,
) => { body: Uint8Array; grpcStatus?: number; grpcMessage?: string };

export interface GrpcTransportOptions {
  /**
   * @ru Кастомный список поддерживаемых протоколов.
   * @en Custom list of supported protocols.
   */
  protocols?: HyperProtocolName[];
}

/**
 * @ru Тестовый транспорт gRPC: вместо сети вызывает обработчик.
 * @en Test gRPC transport: invokes a handler instead of the network.
 */
export class GrpcTestTransport implements HyperTransport {
  readonly name = "grpc-test";
  readonly protocols: readonly HyperProtocolName[];
  private readonly handler: GrpcHandler;

  constructor(handler: GrpcHandler, options: GrpcTransportOptions = {}) {
    this.handler = handler;
    this.protocols = Object.freeze(options.protocols ?? ["grpc"]);
  }

  async execute(request: TransportRequest): Promise<TransportResponse> {
    const url = new URL(request.url, "http://localhost");
    const [, service, method] = url.pathname.split("/");

    // Извлекаем входящее Protobuf-сообщение из 5-байтового фрейма
    const reqBody = request.body as Uint8Array;
    const { payload: reqPayload } = decodeGrpcFrame(reqBody);

    // Вызываем обработчик тестов
    const result = this.handler(service, method, reqPayload);
    const grpcStatus = result.grpcStatus ?? 0;

    // Упаковываем ответный Protobuf в gRPC фрейм
    const resFramedBody = encodeGrpcFrame(result.body);

    return {
      status: 200,
      statusText: "OK",
      headers: {
        "content-type": "application/grpc",
        "grpc-status": String(grpcStatus),
        ...(result.grpcMessage ? { "grpc-message": result.grpcMessage } : {}),
      },
      body: resFramedBody,
    };
  }
}
