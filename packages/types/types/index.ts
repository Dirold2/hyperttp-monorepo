import type { HyperClientOptions } from "./options.js";
import type { HyperPlugin } from "./plugin.js";
import type { AnyHyperProtocol, HyperProtocolName } from "./protocol.js";
import type { AnyHyperReceiver, HyperServerListenOptions } from "./receiver.js";
import type {
  SendRequest,
  UniversalResponse,
  InferProtocolInput,
  AnyHyperSender,
} from "./sender.js";
import type { TransportServer } from "./transport.js";

/**
 * @ru Интерфейс-контейнер для пространств имён протоколов (например `core.rest`, `core.grpc`).
 * Расширяется сторонними пакетами протоколов через Module Augmentation.
 * @en Container interface for protocol client namespaces (e.g. `core.rest`, `core.grpc`).
 * Extended by external protocol packages (@hyperttp/rest, @hyperttp/grpc) using Module Augmentation.
 */
export interface HyperProtocols {}

/**
 * @ru Основной интерфейс ядра, предоставляющий мультипротокольную диспетчеризацию.
 * @en Core engine interface providing protocol-agnostic dispatch.
 */
export interface IHyperCore extends HyperProtocols {
  /**
   * @ru Текущая неизменяемая конфигурация инстанса.
   * @en The current immutable instance configuration.
   */
  readonly config: HyperClientOptions;

  /** Returns the registered protocol name, or the default protocol name. */
  getProtocolName<P extends HyperProtocolName = HyperProtocolName>(protocol?: P): Promise<string>;

  /** Returns the registered sender name, or the default sender name. */
  getSenderName<P extends HyperProtocolName = HyperProtocolName>(protocol?: P): Promise<string>;

  /** Returns the registered receiver name, or the default receiver name. */
  getReceiverName<P extends HyperProtocolName = HyperProtocolName>(protocol?: P): Promise<string>;

  /** Returns the configured transport name. */
  getTransportName(): Promise<string>;

  /**
   * @ru Отправляет запрос через зарегистрированный sender и автоматически выводит
   * тип входных данных из `ProtocolInputMap` по идентификатору протокола.
   * Используйте этот overload для протоколов, добавленных через Module Augmentation.
   *
   * @en Dispatches a request through a registered sender and automatically infers
   * the input type from `ProtocolInputMap` by protocol identifier.
   * Use this overload for protocols added through Module Augmentation.
   *
   * @example
   * const response = await core.send<{ id: string }>({
   *   protocol: "rest",
   *   input: { method: "GET", url: "https://api.example.test/users/1" },
   * });
   *
   * @template TOutput - The normalized response data type.
   * @template P - The protocol identifier inferred from `req.protocol`.
   * @param req - The universal request being dispatched.
   * @returns A promise resolving to the normalized universal response.
   */
  send<TOutput = unknown, P extends HyperProtocolName = HyperProtocolName>(
    req: SendRequest<InferProtocolInput<P>, P>,
  ): Promise<UniversalResponse<TOutput>>;

  /**
   * @ru Отправляет запрос через зарегистрированный sender с явно указанным типом
   * входных данных. Используйте для custom-протоколов без записи в `ProtocolInputMap`
   * либо когда тип входа требуется задать вручную.
   *
   * @en Dispatches a request through a registered sender with an explicitly
   * specified input type. Use this overload for custom protocols that do not
   * augment `ProtocolInputMap`, or when the input type must be provided manually.
   *
   * @example
   * interface RpcInput {
   *   method: "ping";
   * }
   *
   * const response = await core.send<RpcInput, { pong: true }, "rpc">({
   *   protocol: "rpc",
   *   input: { method: "ping" },
   * });
   *
   * @template TInput - The explicit protocol request input type.
   * @template TOutput - The normalized response data type.
   * @template P - The protocol identifier.
   * @param req - The universal request being dispatched.
   * @returns A promise resolving to the normalized universal response.
   */
  send<TInput = unknown, TOutput = unknown, P extends HyperProtocolName = HyperProtocolName>(
    req: SendRequest<TInput, P>,
  ): Promise<UniversalResponse<TOutput>>;

  /**
   * @ru Возвращает зарегистрированный сендер для указанного протокола.
   * @en Returns the registered sender for the given protocol.
   * @template P - The protocol identifier.
   * @param protocol - The protocol identifier.
   * @returns The sender, or undefined if the protocol is not registered.
   */
  getSender<P extends HyperProtocolName>(protocol: P): AnyHyperSender<P> | undefined;

  /**
   * @ru Регистрирует сендер в ядре.
   * @en Registers a sender into the core.
   * @param sender - The sender to register.
   * @returns The current instance for chaining.
   */
  registerSender<P extends HyperProtocolName>(sender: AnyHyperSender<P>): this;

  /**
   * @ru Возвращает зарегистрированный ресивер для указанного протокола.
   * @en Returns the registered receiver for the given protocol.
   * @template P - The protocol identifier.
   * @param protocol - The protocol identifier.
   * @returns The receiver, or undefined if the protocol is not registered.
   */
  getReceiver<P extends HyperProtocolName>(protocol: P): AnyHyperReceiver<P> | undefined;

  /**
   * @ru Регистрирует ресивер в ядре (серверная сторона).
   * @en Registers a receiver into the core (server side).
   * @param receiver - The receiver to register.
   * @returns The current instance for chaining.
   */
  registerReceiver<P extends HyperProtocolName>(receiver: AnyHyperReceiver<P>): this;

  /**
   * @ru Возвращает зарегистрированный модуль протокола.
   * @en Returns the registered protocol module.
   * @template P - The protocol identifier.
   * @param protocol - The protocol identifier.
   * @returns The protocol module, or undefined if the protocol is not registered.
   */
  getProtocol<P extends HyperProtocolName>(protocol: P): AnyHyperProtocol<P> | undefined;

  /**
   * @ru Регистрирует модуль протокола и его доступные sender и/или receiver.
   * @en Registers a protocol module and its available sender and/or receiver.
   * @param protocol - The protocol module to register.
   * @returns The current instance for chaining.
   */
  registerProtocol<P extends HyperProtocolName>(protocol: AnyHyperProtocol<P>): this;

  /**
   * @ru Запускает сервер для указанного протокола. Связывает транспорт, ресивер и application handler.
   * @en Starts a server for the given protocol. Wires together transport, receiver, and application handler.
   * @template P - The protocol identifier.
   * @param options - The server listen options.
   * @returns A promise resolving to the transport server handle.
   */
  listen<P extends HyperProtocolName = HyperProtocolName>(
    options: HyperServerListenOptions<P>,
  ): Promise<TransportServer>;

  /**
   * @ru Регистрирует плагин в экземпляре клиента.
   * @en Registers a plugin into the client instance.
   * @param plugin - The plugin instance to register.
   * @returns The current instance for chaining.
   */
  use(plugin: HyperPlugin): this;

  /**
   * @ru Создаёт новый экземпляр клиента, объединяя текущую конфигурацию с переданными опциями.
   * @en Creates a new client instance by merging the current configuration with provided options.
   * @param options - The partial configuration to extend with.
   * @returns A new IHyperCore instance.
   */
  extend(options: Partial<HyperClientOptions>): IHyperCore;

  /**
   * @ru Создаёт полностью новый экземпляр клиента на основе переданных опций.
   * @en Creates a completely new client instance based on provided options.
   * @param options - The partial configuration for the new instance.
   * @returns A new IHyperCore instance.
   */
  create(options: Partial<HyperClientOptions>): IHyperCore;

  /**
   * @ru Завершает работу клиента и освобождает ресурсы (соединения, пулы).
   * @en Shuts down the client and releases resources (connections, pools).
   * @param graceful - Requests graceful shutdown where supported by the transport. Actual request draining is transport-dependent.
   * @returns A promise that resolves when shutdown is complete.
   */
  destroy(graceful?: boolean): Promise<void>;
}

// Re-export standard universal types
export * from "./adapters.js";
export * from "./error.js";
export * from "./metrics.js";
export * from "./options.js";
export * from "./plugin.js";
export * from "./protocol.js";
export * from "./receiver.js";
export * from "./retry.js";
export * from "./sender.js";
export * from "./transport.js";
