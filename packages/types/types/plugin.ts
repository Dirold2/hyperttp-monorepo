import type { IHyperCore } from "./index.js";
import type { HyperClientOptions } from "./options.js";
import type { HyperProtocolName } from "./protocol.js";
import type { ServerRequestContext } from "./receiver.js";
import type { RequestContext, SendRequest, UniversalResponse } from "./sender.js";
import type { TransportRequest, TransportResponse } from "./transport.js";

/** Creates a fresh plugin instance for each core, including extend() and create(). */
export type CorePluginFactory = () => HyperPlugin;

/**
 * @ru Фазы выполнения, доступные для перехвата плагином в конвейере запроса.
 * @en Execution phases available for plugin interception in the request pipeline.
 */
export type PluginPhase = "START" | "PREPARE" | "CONTROL" | "FORMAT" | "NETWORK" | "DATA";

/**
 * @ru Режимы выполнения, определяющие влияние плагина на поток запроса.
 * @en Execution modes determining how the plugin affects the request flow.
 */
export type PluginExecutionMode = "blocking" | "background";

/**
 * @ru Контекст, предоставляемый плагину, содержащий конфигурацию и доступ к ядру.
 * @en Context provided to plugins, containing configuration and core access.
 */
export interface PluginContext {
  /**
   * @ru Текущая конфигурация клиента.
   * @en Current client configuration options.
   */
  readonly config: HyperClientOptions;

  /**
   * @ru Ссылка на экземпляр ядра.
   * @en Reference to the core instance.
   */
  readonly core: IHyperCore;
}

/**
 * @ru Общий контекст входящего запроса; protocol задан привязкой listen, а не сырым вводом.
 * @en Shared incoming request context; protocol is the listen binding, not raw input.
 */
export interface ServerPluginContext extends ServerRequestContext {
  readonly protocol: HyperProtocolName;
}

/**
 * @ru Результат подготовки ответа, а не подтверждение физической доставки клиенту.
 * @en Final response preparation result, not confirmation of physical delivery to the peer.
 */
export type ServerRequestOutcome =
  | { readonly ok: true; readonly response: TransportResponse }
  | { readonly ok: false; readonly error: unknown };

type MaybePromise<T> = T | Promise<T>;

/**
 * @ru Результат выполнения хука `onRequest`: изменённый запрос, преждевременный ответ или отсутствие результата.
 * @en Result of the `onRequest` hook: a modified request, an early response, or no result.
 * @template TInput - The type of the request input.
 * @template TOutput - The type of the response data.
 */
export type PluginOnRequestResult<TInput = unknown, TOutput = unknown> =
  | UniversalResponse<TOutput>
  | SendRequest<TInput>
  | void;

/**
 * @ru Протокол-независимые хуки жизненного цикла плагинов.
 * @en Protocol-agnostic plugin lifecycle hooks.
 * Server hooks are always blocking, independent of the client mode, and all run in forward
 * phase order (START → PREPARE → CONTROL → FORMAT → NETWORK → DATA).
 * Client hooks and client authentication are not automatically applied to incoming requests.
 * @template TInput - The type of the request input.
 * @template TOutput - The type of the response data.
 */
export interface HyperPlugin<TInput = unknown, TOutput = unknown> {
  /**
   * @ru Уникальное имя плагина для отладки и дедупликации.
   * @en Unique plugin name for debugging and deduplication.
   */
  readonly name: string;

  /**
   * @ru Явно разрешает совместное использование stateless-плагина несколькими ядрами.
   * Плагины с shared: true не могут определять setup; для плагинов с состоянием используйте pluginFactories.
   * @en Explicitly allows a stateless plugin instance to be reused across cores.
   * Plugins with shared: true cannot define setup; use pluginFactories for stateful plugins.
   */
  readonly shared?: boolean;

  /**
   * @ru Фаза выполнения в конвейере запроса.
   * @en Pipeline execution phase where the plugin is invoked.
   */
  readonly phase?: PluginPhase;

  /**
   * @ru Режим выполнения плагина: блокирующий или фоновый.
   * @en Plugin execution mode: blocking or background.
   */
  readonly mode?: PluginExecutionMode;

  /**
   * @ru Предикат активации плагина на основе конфигурации клиента.
   * @en Predicate to enable or disable the plugin based on client configuration.
   * @param config - The client configuration.
   * @returns true if the plugin should be enabled.
   */
  enabled?: (config: HyperClientOptions) => boolean;

  /**
   * @ru Хук инициализации, вызываемый при регистрации плагина.
   * @en Initialization hook called when the plugin is registered.
   * @param ctx - The plugin context.
   */
  setup?: (ctx: PluginContext) => void;

  /**
   * @ru Хук, выполняемый перед отправкой запроса. Может изменить запрос или вернуть ответ досрочно.
   * @en Hook executed before the request is dispatched. Can modify the request or short-circuit execution.
   * @param req - The universal request.
   * @param ctx - The plugin context.
   * @param reqCtx - The per-request execution context (`state`/`meta` shared across phases).
   * @returns A modified request, an early response, or void.
   */
  onRequest?: (
    req: SendRequest<TInput>,
    ctx?: PluginContext,
    reqCtx?: RequestContext,
  ) => Promise<PluginOnRequestResult<TInput, TOutput>> | PluginOnRequestResult<TInput, TOutput>;

  /**
   * @ru Хук, выполняемый после получения ответа.
   * @en Hook executed after a response is received.
   * @param res - The universal response.
   * @param req - The original request.
   * @param ctx - The plugin context.
   * @param reqCtx - The per-request execution context (`state`/`meta` shared across phases).
   * @returns A modified response or void.
   */
  onResponse?: (
    res: UniversalResponse<TOutput>,
    req?: SendRequest<TInput>,
    ctx?: PluginContext,
    reqCtx?: RequestContext,
  ) => Promise<UniversalResponse<TOutput> | void> | UniversalResponse<TOutput> | void;

  /**
   * @ru Хук, выполняемый при ошибке в жизненном цикле запроса.
   * @en Hook executed when an error occurs during the request lifecycle.
   * @param err - The error that occurred.
   * @param req - The original request.
   * @param ctx - The plugin context.
   * @param reqCtx - The per-request execution context (`state`/`meta` shared across phases).
   * @returns A recovered response, or void to propagate the error.
   */
  onError?: (
    err: unknown,
    req?: SendRequest<TInput>,
    ctx?: PluginContext,
    reqCtx?: RequestContext,
  ) => Promise<UniversalResponse<TOutput> | void> | UniversalResponse<TOutput> | void;

  /**
   * @ru До receiver.receive; возвращает новый сырой запрос или void. Всегда блокирующий.
   * @en Before receiver.receive; return a replacement raw request or void. Always blocking.
   */
  onServerRequest?: (
    request: TransportRequest,
    ctx: PluginContext,
    requestCtx: ServerPluginContext,
  ) => MaybePromise<TransportRequest | void>;

  /**
   * @ru После receiver.respond, до передачи сериализованного ответа транспорту. Всегда блокирующий.
   * @en After receiver.respond, before handing the serialized response to the transport. Always blocking.
   */
  onServerResponse?: (
    response: TransportResponse,
    request: TransportRequest,
    ctx: PluginContext,
    requestCtx: ServerPluginContext,
  ) => MaybePromise<TransportResponse | void>;

  /**
   * @ru Вызываются все хуки ошибок; первый возвращённый сырой ответ восстанавливает выполнение.
   * @en All error hooks are attempted; the first returned raw response recovers the failure.
   */
  onServerError?: (
    error: unknown,
    request: TransportRequest,
    ctx: PluginContext,
    requestCtx: ServerPluginContext,
  ) => MaybePromise<TransportResponse | void>;

  /**
   * @ru Ровно один раз после подготовки/восстановления, не доставки; ошибки только диагностические.
   * @en Exactly once after preparation/recovery, not physical delivery; errors are diagnostic only.
   */
  onServerSettled?: (
    outcome: ServerRequestOutcome,
    request: TransportRequest,
    ctx: PluginContext,
    requestCtx: ServerPluginContext,
  ) => MaybePromise<void>;
}
