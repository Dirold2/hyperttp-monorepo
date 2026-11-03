import type { HyperReceiver } from "./receiver.js";
import type { HyperSender, ProtocolInputMap } from "./sender.js";

/**
 * @ru Нейтральный идентификатор протокола, общий для sender, receiver и transport контрактов.
 * @en Protocol-neutral identifier shared by sender, receiver, and transport contracts.
 */
export type HyperProtocolName = keyof ProtocolInputMap | (string & {});

/**
 * @ru Единый модуль протокола, объединяющий клиентский Sender и серверный Receiver.
 * Одна из частей может отсутствовать: модуль может быть только клиентским или только серверным.
 * @en Unified protocol module combining a client Sender and a server Receiver.
 * Either side may be omitted: a module can be client-only or server-only.
 * @template TInput - The type of the client request input.
 * @template TOutput - The type of the client response data.
 * @template TReq - The type of the server request.
 * @template TRes - The type of the server response.
 * @template P - The protocol identifier.
 */
export type HyperProtocol<
  TInput = unknown,
  TOutput = unknown,
  TReq = unknown,
  TRes = unknown,
  P extends HyperProtocolName = HyperProtocolName,
> = HyperProtocolIdentity<P> &
  (
    | {
        readonly sender: HyperSender<TInput, TOutput, any, any, P>;
        readonly receiver?: HyperReceiver<TReq, TRes, any, any, P>;
      }
    | {
        readonly sender?: HyperSender<TInput, TOutput, any, any, P>;
        readonly receiver: HyperReceiver<TReq, TRes, any, any, P>;
      }
  );

export type AnyHyperProtocol<P extends HyperProtocolName = HyperProtocolName> = HyperProtocol<
  any,
  any,
  any,
  any,
  P
>;

/**
 * @ru Общие свойства модуля протокола.
 * @en Common protocol module properties.
 * @template P - The protocol identifier.
 */
interface HyperProtocolIdentity<P extends HyperProtocolName> {
  /**
   * @ru Идентификатор протокола (например, 'rest', 'grpc', 'ws').
   * @en Protocol identifier (e.g. 'rest', 'grpc', 'ws').
   */
  readonly protocol: P;

  /**
   * @ru Отображаемое имя модуля для интроспекции (например, 'RestProtocol').
   * Если не задано, ядро использует `constructor.name` либо идентификатор протокола.
   * @en Display name of the module for introspection (e.g. 'RestProtocol').
   * When omitted, the core falls back to `constructor.name` or the protocol identifier.
   */
  readonly name?: string;
}

/**
 * @ru Контракт реестра протоколов для управления зарегистрированными модулями.
 * @en Protocol registry contract for managing registered protocol modules.
 */
export interface ProtocolRegistry {
  /**
   * @ru Регистрирует протокол в реестре.
   * @en Registers a protocol in the registry.
   * @param protocol - The protocol module to register.
   */
  register<P extends HyperProtocolName>(protocol: AnyHyperProtocol<P>): void;

  /**
   * @ru Возвращает протокол по идентификатору.
   * @en Returns the protocol for the given identifier.
   * @param protocol - The protocol identifier.
   * @returns The protocol module, or undefined if not registered.
   */
  get<P extends HyperProtocolName>(protocol: P): AnyHyperProtocol<P> | undefined;

  /**
   * @ru Проверяет, зарегистрирован ли протокол.
   * @en Checks whether the protocol is registered.
   * @param protocol - The protocol identifier.
   * @returns true if the protocol is registered.
   */
  has(protocol: HyperProtocolName): boolean;

  /**
   * @ru Количество зарегистрированных протоколов.
   * @en Number of registered protocols.
   */
  readonly size: number;
}
