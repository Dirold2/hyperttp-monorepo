import type { HyperProtocolName } from "./protocol.js";
import type { RequestContext } from "./sender.js";
import type { TransportSignalingOptions } from "./transport.js";

/**
 * @ru Контекст серверного запроса. Расширяет общий `RequestContext` информацией о соединении и пире.
 * @en Server request context. Extends the shared `RequestContext` with connection and peer information.
 */
export interface ProtocolServerRequestMap {}

/**
 * @ru Глобальный реестр типов ответов серверных протоколов. Расширяется через Module Augmentation.
 * @en Global map for server protocol response types. Extended via Module Augmentation.
 */
export interface ProtocolServerResponseMap {}

/**
 * @ru Выводит тип серверного запроса по идентификатору протокола.
 * @en Infers the server request type from a protocol identifier.
 */
export type InferProtocolServerRequest<P extends string> = P extends keyof ProtocolServerRequestMap
  ? ProtocolServerRequestMap[P]
  : unknown;

/**
 * @ru Выводит тип серверного ответа по идентификатору протокола.
 * @en Infers the server response type from a protocol identifier.
 */
export type InferProtocolServerResponse<P extends string> =
  P extends keyof ProtocolServerResponseMap ? ProtocolServerResponseMap[P] : unknown;

export interface ServerRequestContext extends RequestContext {
  /**
   * @ru Информация о входящем соединении (зависит от транспорта).
   * @en Incoming connection information (transport-specific).
   */
  readonly connection?: Readonly<Record<string, unknown>>;

  /**
   * @ru Данные удалённого пира (адрес, порт и т.д.).
   * @en Remote peer data (address, port, etc.).
   */
  readonly peer?: Readonly<Record<string, unknown>>;
}

/**
 * @ru Опции запуска сервера на уровне ядра. Ядро связывает транспорт, ресивер и application handler.
 * @en Server startup options at the core level. The core wires together transport, receiver, and application handler.
 * @template P - The protocol identifier.
 * @template TRequest - The type of the parsed protocol request.
 * @template TResponse - The type of the protocol response.
 */
export interface HyperServerListenOptions<
  P extends HyperProtocolName = HyperProtocolName,
  TRequest = InferProtocolServerRequest<P>,
  TResponse = InferProtocolServerResponse<P>,
> {
  /**
   * @ru Идентификатор протокола, который будет обслуживать сервер (например, 'rest', 'grpc').
   * @en Protocol identifier the server will serve (e.g. 'rest', 'grpc').
   */
  readonly protocol: P;

  /**
   * @ru Адрес интерфейса для прослушивания.
   * @en Interface address to listen on.
   */
  readonly host?: string;

  /**
   * @ru Порт для прослушивания.
   * @en Port to listen on.
   */
  readonly port?: number;

  /**
   * @ru Сигнал прерывания для остановки сервера.
   * @en Abort signal to stop the server.
   */
  readonly signal?: AbortSignal;
  readonly signaling?: TransportSignalingOptions;

  /**
   * @ru Application handler. Если передан, имеет приоритет над `HyperReceiver.handle`.
   * @en Application handler. If provided, it takes precedence over `HyperReceiver.handle`.
   * @param request - The parsed protocol request.
   * @param ctx - The server request context.
   * @returns The protocol response.
   */
  readonly handler?: (
    request: TRequest,
    ctx: ServerRequestContext,
  ) => TResponse | Promise<TResponse>;
}

/**
 * @ru Протокольный ресивер с трёхфазным циклом (receive → handle → respond), зеркальный к `HyperSender`.
 * @en Protocol receiver with a three-phase cycle (receive → handle → respond), mirroring `HyperSender`.
 * @template TRequest - The type of the parsed protocol request.
 * @template TResponse - The type of the protocol response.
 * @template TRawRequest - The type of the raw transport request.
 * @template TRawResponse - The type of the raw transport response.
 * @template P - The protocol identifier.
 */
export interface HyperReceiver<
  TRequest = unknown,
  TResponse = unknown,
  TRawRequest = unknown,
  TRawResponse = unknown,
  P extends HyperProtocolName = HyperProtocolName,
> {
  /**
   * @ru Идентификатор протокола, который обслуживает ресивер.
   * @en Protocol identifier served by the receiver.
   */
  readonly protocol: P;

  /**
   * @ru Фаза приёма: преобразует сырой запрос транспорта в формат, понятный протоколу.
   * @en Receive phase: transforms the raw transport request into a protocol-level format.
   * @param request - The raw transport request.
   * @param ctx - The server request context.
   * @returns The parsed protocol request.
   */
  receive(request: TRawRequest, ctx: ServerRequestContext): TRequest | Promise<TRequest>;

  /**
   * @ru Фаза обработки: выполняет application-логику над разобранным запросом.
   * @en Handle phase: runs application logic against the parsed request.
   * @param request - The parsed protocol request.
   * @param ctx - The server request context.
   * @returns The protocol response.
   */
  handle(request: TRequest, ctx: ServerRequestContext): TResponse | Promise<TResponse>;

  /**
   * @ru Фаза ответа: сериализует протокольный ответ в сырой формат транспорта.
   * @en Respond phase: serializes the protocol response into the raw transport format.
   * @param response - The protocol response.
   * @param ctx - The server request context.
   * @returns The raw transport response.
   */
  respond(response: TResponse, ctx: ServerRequestContext): TRawResponse | Promise<TRawResponse>;
}

export type AnyHyperReceiver<P extends HyperProtocolName = HyperProtocolName> = HyperReceiver<
  any,
  any,
  any,
  any,
  P
>;

/**
 * @ru Контракт реестра ресиверов для управления зарегистрированными ресиверами.
 * @en Receiver registry contract for managing registered receivers.
 */
export interface ReceiverRegistry {
  /**
   * @ru Регистрирует ресивер в реестре.
   * @en Registers a receiver in the registry.
   * @param receiver - The receiver to register.
   */
  register<P extends HyperProtocolName>(receiver: AnyHyperReceiver<P>): void;

  /**
   * @ru Возвращает ресивер по идентификатору протокола.
   * @en Returns the receiver for the given protocol identifier.
   * @param protocol - The protocol identifier.
   * @returns The receiver, or undefined if the protocol is not registered.
   */
  get<P extends HyperProtocolName>(protocol: P): AnyHyperReceiver<P> | undefined;

  /**
   * @ru Проверяет, зарегистрирован ли протокол.
   * @en Checks whether the protocol is registered.
   * @param protocol - The protocol identifier.
   * @returns true if the protocol is registered.
   */
  has(protocol: HyperProtocolName): boolean;

  /**
   * @ru Количество зарегистрированных ресиверов.
   * @en Number of registered receivers.
   */
  readonly size: number;
}
