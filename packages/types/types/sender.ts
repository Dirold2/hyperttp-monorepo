import type { HyperProtocolName } from "./protocol.js";
import type { HyperTransport } from "./transport.js";

/** A dynamically dispatched protocol method at the core/plugin boundary. */
export type HyperMethod = (...args: any[]) => unknown;

/** Method surface exposed by a protocol sender. */
export type HyperMethodSurface = Readonly<Record<string, HyperMethod>>;

/**
 * @ru Глобальный реестр типов входных данных для протоколов. Расширяется через Module Augmentation сторонними пакетами.
 * @en Global map for protocol input payload types. Extended via Module Augmentation by external protocol packages.
 */
export interface ProtocolInputMap {}

/**
 * @ru Глобальный реестр типов метаданных для протоколов. Расширяется через Module Augmentation сторонними пакетами.
 * @en Global map for protocol metadata types. Extended via Module Augmentation by external protocol packages.
 */
export interface ProtocolMetadataMap {}

/**
 * @ru Идентификатор протокола: ключи из ProtocolInputMap или любая кастомная строка.
 * @en Protocol identifier: either a known protocol key from ProtocolInputMap or any custom string.
 */
/**
 * @deprecated Use {@link HyperProtocolName} instead. This alias is kept for compatibility.
 */
export type SenderProtocol = HyperProtocolName;

/**
 * @ru Вспомогательный тип для автоматического вывода структуры input по имени протокола.
 * @en Utility type to automatically infer the input structure by protocol name.
 * @template P - The protocol identifier.
 */
export type InferProtocolInput<P extends string> = P extends keyof ProtocolInputMap
  ? ProtocolInputMap[P]
  : unknown;

/**
 * @ru Вспомогательный тип для автоматического вывода структуры metadata по имени протокола.
 * @en Utility type to automatically infer the metadata structure by protocol name.
 * @template P - The protocol identifier.
 */
export type InferProtocolMetadata<P extends string> = P extends keyof ProtocolMetadataMap
  ? ProtocolMetadataMap[P]
  : Record<string, unknown>;

/**
 * @ru Финальный результат логического запроса после всех блокирующих обработчиков ответа и восстановления.
 * @en Final logical request outcome after all blocking response and recovery handlers.
 */
export type RequestOutcome =
  | { readonly ok: true; readonly response: UniversalResponse }
  | { readonly ok: false; readonly error: unknown };

/**
 * @ru Контекст выполнения, передаваемый через весь жизненный цикл запроса (prepare → send → parse).
 * @en Execution context shared across the entire request lifecycle (prepare → send → parse).
 */
export interface RequestContext {
  /**
   * @ru Уникальный идентификатор запроса.
   * @en Unique request identifier.
   */
  readonly requestId: string;

  /**
   * @ru Временная метка начала выполнения запроса.
   * @en Start timestamp of the request execution.
   */
  readonly startTime: number;

  /**
   * @ru Сигнал прерывания для отмены текущей операции.
   * @en Abort signal to cancel the current operation.
   */
  readonly signal?: AbortSignal;

  /**
   * @ru Общая карта метаданных, доступная на протяжении всего жизненного цикла запроса.
   * @en Shared metadata map available across the entire request lifecycle.
   */
  readonly meta: Record<string, unknown>;

  /**
   * @ru Произвольное состояние, которым обмениваются фазы жизненного цикла запроса.
   * @en Arbitrary state shared between request lifecycle phases.
   */
  readonly state: Record<string, unknown>;

  /**
   * @ru Регистрирует callback, вызываемый один раз за логический запрос после всех блокирующих
   * обработчиков ответа и восстановления. Регистрация во время или после финализации отклоняется.
   * Ошибки callback служат только для диагностики и не могут изменить результат запроса.
   * @en Registers a callback invoked once per logical request after all blocking response and
   * recovery handlers. Registration during or after finalization is rejected.
   * Callback errors are diagnostic only and cannot change the request outcome.
   */
  onSettled?(callback: (outcome: RequestOutcome) => void | Promise<void>): void;

  /**
   * @ru Принимает уже финализированный ответ для запроса-последователя без повторного выполнения
   * блокирующих и фоновых преобразований ответа. Не выполняет сетевые операции.
   * @en Accepts an already finalized response for a follower request, skipping duplicate blocking
   * and background response transforms. Performs no network I/O.
   */
  acceptFinalResponse?<T>(response: UniversalResponse<T>): UniversalResponse<T>;
}

/**
 * @ru Универсальный конверт запроса с автоматическим выводом типов на основе протокола.
 * @en Universal request envelope with automatic type inference based on protocol.
 * @template TInput - The type of the request input.
 * @template P - The protocol identifier.
 */
export interface SendRequest<TInput = unknown, P extends string = string> {
  /**
   * @ru Идентификатор протокола (например, 'rest', 'grpc').
   * @en Protocol identifier (e.g. 'rest', 'grpc').
   */
  readonly protocol: P;

  /**
   * @ru Полезная нагрузка запроса в формате, ожидаемом протоколом.
   * @en Request payload in the protocol-specific format.
   */
  readonly input: unknown extends TInput ? InferProtocolInput<P> : TInput;

  /**
   * @ru Сигнал прерывания для отмены запроса.
   * @en Abort signal to cancel the request.
   */
  readonly signal?: AbortSignal;

  /**
   * @ru Метаданные запроса в формате, ожидаемом протоколом.
   * @en Request metadata in the protocol-specific format.
   */
  readonly metadata?: Readonly<InferProtocolMetadata<P>>;
}

/**
 * @ru Протокол-нейтральный ответ с уже нормализованными данными.
 * @en Protocol-neutral response carrying normalized data.
 * @template TOutput - The type of the response data.
 * @template TExtra - The type of additional response metadata.
 */
export interface UniversalResponse<TOutput = unknown, TExtra = Record<string, unknown>> {
  /**
   * @ru Идентификатор протокола, обработавшего запрос.
   * @en Protocol identifier that handled the request.
   */
  readonly protocol: HyperProtocolName;

  /**
   * @ru Признак успешного выполнения, определяемый протоколом или сендером.
   * @en Whether the operation succeeded, as determined by the protocol or sender.
   */
  readonly ok: boolean;

  /**
   * @ru Числовой код статуса ответа.
   * @en Numeric response status code.
   */
  readonly status: number;

  /**
   * @ru Текстовое описание статуса.
   * @en Status text associated with the status code.
   */
  readonly statusText?: string;

  /**
   * @ru Заголовки ответа.
   * @en Response headers.
   */
  readonly headers: Readonly<Record<string, string | string[]>>;

  /**
   * @ru Финальный URL ответа (после редиректов, если были).
   * @en Final response URL (after redirects, if any).
   */
  readonly url?: string;

  /**
   * @ru Нормализованные данные ответа.
   * @en Normalized response data.
   */
  readonly data: TOutput;

  /**
   * @ru Дополнительные метаданные ответа.
   * @en Additional response metadata.
   */
  readonly metadata?: Readonly<TExtra>;

  /**
   * @ru Сырое тело ответа до нормализации.
   * @en Raw response payload before normalization.
   */
  readonly raw?: unknown;
}

/**
 * @ru Интерфейс протокольного сендера с трёхфазным циклом (prepare → send → parse).
 * @en Protocol sender interface with a three-phase cycle (prepare → send → parse).
 * @template TInput - The type of the request input.
 * @template TOutput - The type of the response data.
 * @template TPrepared - The type of the prepared request.
 * @template TRaw - The type of the raw transport response.
 * @template P - The protocol identifier.
 */
export interface HyperSender<
  TInput = unknown,
  TOutput = unknown,
  TPrepared = unknown,
  TRaw = unknown,
  P extends HyperProtocolName = HyperProtocolName,
> {
  /**
   * @ru Идентификатор протокола, который обслуживает сендер.
   * @en Protocol identifier served by the sender.
   */
  readonly protocol: P;

  /**
   * @ru Поверхность методов протокола, через которую ядро выполняет вызовы в стиле core.get().
   * @en Protocol method surface used by the core to dispatch core.get()-style calls.
   */
  readonly methods?: HyperMethodSurface;

  /**
   * @ru Фаза подготовки: преобразует универсальный запрос в подготовленное представление сендера.
   * @en Prepare phase: transforms the universal request into a sender-specific prepared representation.
   * @param request - The universal request envelope.
   * @param ctx - The execution context.
   * @returns The prepared request.
   */
  prepare(request: SendRequest<TInput, P>, ctx: RequestContext): TPrepared;

  /**
   * @ru Фаза отправки: выполняет подготовленный запрос через транспорт.
   * @en Send phase: executes the prepared request through the transport.
   * @param prepared - The prepared request.
   * @param transport - The transport executing network I/O.
   * @param ctx - The execution context.
   * @returns The raw transport response.
   */
  send(prepared: TPrepared, transport: HyperTransport, ctx: RequestContext): Promise<TRaw>;

  /**
   * @ru Фаза парсинга: нормализует сырой ответ транспорта в универсальный ответ.
   * @en Parse phase: normalizes the raw transport response into a universal response.
   * @param raw - The raw transport response.
   * @param ctx - The execution context.
   * @returns The universal protocol response.
   */
  parse(
    raw: TRaw,
    ctx: RequestContext,
  ): UniversalResponse<TOutput> | Promise<UniversalResponse<TOutput>>;
}

export type AnyHyperSender<P extends HyperProtocolName = HyperProtocolName> = HyperSender<
  any,
  any,
  any,
  any,
  P
>;

/**
 * @ru Контракт реестра протоколов для управления зарегистрированными сендерами.
 * @en Protocol registry contract for managing registered senders.
 */
export interface SenderRegistry {
  /**
   * @ru Регистрирует сендер в реестре.
   * @en Registers a sender in the registry.
   * @param sender - The sender to register.
   */
  register<P extends HyperProtocolName>(sender: AnyHyperSender<P>): void;

  /**
   * @ru Возвращает сендер по идентификатору протокола.
   * @en Returns the sender for the given protocol identifier.
   * @param protocol - The protocol identifier.
   * @returns The sender, or undefined if the protocol is not registered.
   */
  get<P extends HyperProtocolName>(protocol: P): AnyHyperSender<P> | undefined;

  /**
   * @ru Проверяет, зарегистрирован ли протокол.
   * @en Checks whether the protocol is registered.
   * @param protocol - The protocol identifier.
   * @returns true if the protocol is registered.
   */
  has(protocol: HyperProtocolName): boolean;

  /**
   * @ru Количество зарегистрированных сендеров.
   * @en Number of registered senders.
   */
  readonly size: number;
}
