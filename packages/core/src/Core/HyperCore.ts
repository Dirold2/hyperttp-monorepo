import type {
  AnyHyperSender,
  AnyHyperProtocol,
  AnyHyperReceiver,
  InferProtocolInput,
  HyperClientOptions,
  HyperPlugin,
  HyperProtocol,
  HyperProtocols,
  HyperReceiver,
  HyperSender,
  HyperServerListenOptions,
  HyperTransport,
  IHyperCore,
  PluginContext,
  ProtocolRegistry,
  RequestContext,
  RequestOutcome,
  ServerRequestOutcome,
  SenderProtocol,
  SendRequest,
  ServerRequestContext,
  TransportRequest,
  TransportResponse,
  TransportServer,
  UniversalResponse,
} from "@hyperttp/types";
import { dynamicImport } from "../utils/modules.js";
import { defaultCoreConfig } from "../defaultConfig.js";
import { KNOWN_PROTOCOLS, resolveProtocol } from "../protocols/manager.js";
import { evictCachedTransport, resolveTransport } from "../transports/manager.js";
import { HyperClientError } from "../utils/errors.js";

let requestCounter = 0;
let requestIdBase = Date.now().toString(36) + "-";

const PLUGIN_PHASE_ORDER: Readonly<Record<string, number>> = Object.freeze({
  START: 0,
  PREPARE: 1,
  CONTROL: 2,
  FORMAT: 3,
  NETWORK: 4,
  DATA: 5,
});

/**
 * @ru Генерирует уникальный идентификатор запроса без аллокаций на каждый вызов:
 * базовый таймстемп пересчитывается при переполнении счётчика, а уникальность
 * обеспечивает инкрементальный битовый счётчик (общий для всех ядер).
 * @en Generates a unique request identifier without per-call allocations:
 * the base timestamp is recalculated when the counter wraps around, and uniqueness
 * is ensured by an incremental bitwise counter (shared across all cores).
 * @returns A compact unique string identifier.
 */
function createRequestId(): string {
  requestCounter = (requestCounter + 1) >>> 0;
  if (requestCounter === 0) {
    requestIdBase = Date.now().toString(36) + "-";
  }
  return requestIdBase + (requestCounter >>> 0).toString(36);
}

/**
 * @ru Счётчик активных удержаний транспорта. Позволяет нескольким ядрам
 * (например, через `extend()`) разделять один транспорт, закрывая его только
 * после освобождения последней ссылки.
 * @en Active transport hold count. Lets multiple cores (e.g. via `extend()`)
 * share one transport, closing it only after the last reference is released.
 */
const transportRefs = new WeakMap<HyperTransport, number>();
const pluginOwners = new WeakMap<HyperPlugin, HyperCore>();

function retainTransport(transport: HyperTransport): void {
  transportRefs.set(transport, (transportRefs.get(transport) ?? 0) + 1);
}

function releaseTransport(transport: HyperTransport): number {
  const next = (transportRefs.get(transport) ?? 1) - 1;
  if (next <= 0) {
    transportRefs.delete(transport);
  } else {
    transportRefs.set(transport, next);
  }
  return next;
}

/**
 * @ru Создаёт RequestContext на один цикл выполнения (prepare → send → parse).
 * `meta` и `state` инициализируются лениво при первом обращении, чтобы не
 * аллоцировать объекты для запросов, которые их не используют.
 * @en Creates a RequestContext for a single execution cycle (prepare → send → parse).
 * `meta` and `state` are initialized lazily on first access to avoid allocating
 * objects for requests that never use them.
 * @param req - The universal request being dispatched.
 * @returns A new RequestContext.
 */
class DefaultRequestContext implements RequestContext {
  public readonly requestId = createRequestId();
  public readonly startTime = performance.now();
  public readonly signal?: AbortSignal;
  private requestMeta?: Record<string, unknown>;
  private requestState?: Record<string, unknown>;
  private settlementCallbacks: ((outcome: RequestOutcome) => void | Promise<void>)[] = [];
  private finalized = false;
  private acceptedResponse?: UniversalResponse;

  public onSettled(callback: (outcome: RequestOutcome) => void | Promise<void>): void {
    if (this.finalized) throw new Error("[HyperCore] Request settlement has already started.");
    this.settlementCallbacks.push(callback);
  }

  public acceptFinalResponse<T>(response: UniversalResponse<T>): UniversalResponse<T> {
    if (this.finalized) throw new Error("[HyperCore] Request has already settled.");
    this.acceptedResponse = response;
    return response;
  }

  public isFinalResponse(response: UniversalResponse): boolean {
    return this.acceptedResponse === response;
  }

  public async settle(outcome: RequestOutcome, report: (error: unknown) => void): Promise<void> {
    if (this.finalized) return;
    this.finalized = true;
    const callbacks = this.settlementCallbacks;
    this.settlementCallbacks = [];
    for (const callback of callbacks) {
      try {
        await callback(outcome);
      } catch (error) {
        report(error);
      }
    }
  }

  constructor(signal?: AbortSignal) {
    this.signal = signal;
  }

  public get meta(): Record<string, unknown> {
    return (this.requestMeta ??= {});
  }

  public set meta(value: Record<string, unknown>) {
    this.requestMeta = value;
  }

  public get state(): Record<string, unknown> {
    return (this.requestState ??= {});
  }

  public set state(value: Record<string, unknown>) {
    this.requestState = value;
  }
}

function createRequestContext(req: SendRequest<unknown, string>): DefaultRequestContext {
  return new DefaultRequestContext(req.signal);
}

/**
 * @ru Создаёт ServerRequestContext на один серверный цикл (receive → handle → respond).
 * `meta` и `state` инициализируются лениво, как и в клиентском контексте.
 * @en Creates a ServerRequestContext for a single server cycle (receive → handle → respond).
 * `meta` and `state` are initialized lazily, like in the client context.
 * @param raw - The raw transport request being received.
 * @returns A new ServerRequestContext.
 */
function createServerRequestContext(raw: TransportRequest): ServerRequestContext {
  return new DefaultRequestContext(raw.signal) as ServerRequestContext;
}

/**
 * @ru Проверяет, является ли значение UniversalResponse (а не SendRequest).
 * @en Checks whether the value is a UniversalResponse (rather than a SendRequest).
 * @param value - The value to inspect.
 * @returns True if the value carries response shape (data + status).
 */
function isUniversalResponse(value: unknown): value is UniversalResponse {
  return (
    typeof value === "object" &&
    value !== null &&
    "data" in value &&
    "status" in value &&
    !("input" in value)
  );
}

/**
 * @ru Внутренний реестр протоколов: хранит единые модули (Sender + Receiver).
 * @en Internal protocol registry: stores unified modules (Sender + Receiver).
 */
class DefaultProtocolRegistry implements ProtocolRegistry {
  private readonly protocols = new Map<SenderProtocol, AnyHyperProtocol>();

  public register<P extends SenderProtocol>(protocol: AnyHyperProtocol<P>): void {
    this.protocols.set(protocol.protocol, protocol);
  }

  public get<P extends SenderProtocol>(
    protocol: P,
  ): HyperProtocol<unknown, unknown, unknown, unknown, P> | undefined {
    return this.protocols.get(protocol) as
      | HyperProtocol<unknown, unknown, unknown, unknown, P>
      | undefined;
  }

  public has(protocol: SenderProtocol): boolean {
    return this.protocols.has(protocol);
  }

  public get size(): number {
    return this.protocols.size;
  }
}

// oxlint-disable-next-line no-unsafe-declaration-merging
export interface HyperCore extends HyperProtocols {}

/**
 * @ru Универсальное ядро v2.0.0. Протокол-независимый диспетчер: регистрирует
 * единые модули протоколов (Sender + Receiver), выполняет клиентский цикл
 * prepare → send → parse и серверный цикл receive → handle → respond через
 * физический транспорт, а также прогоняет хуки плагинов.
 * @en Universal core v2.0.0. Protocol-agnostic dispatcher: registers unified
 * protocol modules (Sender + Receiver), runs the client cycle prepare → send → parse
 * and the server cycle receive → handle → respond through the physical transport,
 * and executes plugin hooks.
 */
export class HyperCore implements IHyperCore {
  public readonly config: HyperClientOptions;

  private readonly registry = new DefaultProtocolRegistry();
  private readonly pluginCtx: PluginContext;
  private plugins: HyperPlugin[] = [];
  private readonly servers = new Set<TransportServer>();
  private readonly pendingListeners = new Set<Promise<TransportServer>>();
  private readonly flatMethodOwners = new Map<string, string>();
  private readonly flatMethodValues = new Map<string, unknown>();
  private readonly protocolNamespaces = new Set<string>();
  private readonly generatedFlatMethods = new Set<string>();
  private readonly transportPromises = new Map<SenderProtocol, Promise<HyperTransport>>();
  private readonly transports = new Map<SenderProtocol, HyperTransport>();
  private readonly listenTransportPromises = new Map<SenderProtocol, Promise<HyperTransport>>();
  private readonly listenTransports = new Map<SenderProtocol, HyperTransport>();
  private readonly retainedTransports = new Set<HyperTransport>();
  private readonly fixedTransport: HyperTransport | null;
  private destroyPromise: Promise<void> | null = null;
  private state: "initializing" | "running" | "destroying" | "destroyed" = "initializing";
  private readonly activeRequests = new Set<Promise<void>>();

  private get isDestroyed(): boolean {
    return this.state === "destroying" || this.state === "destroyed";
  }

  constructor(
    config: Partial<HyperClientOptions> = {},
    transport?: HyperTransport,
    sharedTransportPromises?: ReadonlyMap<SenderProtocol, Promise<HyperTransport>>,
  ) {
    this.config = {
      ...defaultCoreConfig,
      ...config,
      retry: {
        ...defaultCoreConfig.retry,
        ...config.retry,
      },
    };
    this.fixedTransport = transport ?? null;
    this.pluginCtx = { config: this.config, core: this };

    for (const plugin of this.config.plugins ?? []) {
      if (typeof plugin !== "string" && !plugin.shared && pluginOwners.has(plugin)) {
        throw new HyperClientError(
          "[HyperCore] Plugin instances cannot be shared across cores. Supply fresh plugins when extending or creating a core.",
        );
      }
    }

    const protocols = this.config.protocols;
    if (protocols) {
      for (let i = 0; i < protocols.length; i++) {
        this.registerProtocol(protocols[i]!);
      }
    }

    const senders = this.config.senders;
    if (senders) {
      for (let i = 0; i < senders.length; i++) {
        this.registerSender(senders[i]!);
      }
    }

    const customSender = this.config.customSender;
    if (customSender) {
      this.registerSender(customSender);
    }

    const receivers = this.config.receivers;
    if (receivers) {
      for (let i = 0; i < receivers.length; i++) {
        this.registerReceiver(receivers[i]!);
      }
    }

    const plugins = this.config.plugins;
    if (plugins) {
      for (let i = 0; i < plugins.length; i++) {
        const plugin = plugins[i]!;
        if (typeof plugin === "string") {
          throw new HyperClientError(
            `[HyperCore] Plugin module "${plugin}" cannot be loaded by the synchronous constructor. Import it and pass the plugin instance instead.`,
          );
        }
        try {
          this.use(plugin);
        } catch (error) {
          for (const registered of this.plugins) pluginOwners.delete(registered);
          throw error;
        }
      }
    }

    try {
      for (const factory of this.config.pluginFactories ?? []) this.use(factory());
    } catch (error) {
      for (const registered of this.plugins) {
        if (pluginOwners.get(registered) === this) pluginOwners.delete(registered);
      }
      throw error;
    }

    const namespaces = this as unknown as Record<string, unknown>;
    for (let i = 0; i < KNOWN_PROTOCOLS.length; i++) {
      const protocol = KNOWN_PROTOCOLS[i]!;
      if (!this.registry.has(protocol) && namespaces[protocol] === undefined) {
        namespaces[protocol] = this.createLazyNamespace(protocol);
        this.protocolNamespaces.add(protocol);
      }
    }
    if (transport && !this.retainedTransports.has(transport)) {
      retainTransport(transport);
      this.retainedTransports.add(transport);
    }
    if (sharedTransportPromises) {
      for (const [protocol, sharedPromise] of sharedTransportPromises) {
        this.transportPromises.set(
          protocol,
          sharedPromise.then((sharedTransport) =>
            this.retainResolvedTransport(protocol, sharedTransport),
          ),
        );
      }
    }
    this.state = "running";
  }

  /**
   * @ru Получает зарегистрированный модуль протокола (Sender + Receiver).
   * @en Gets a registered protocol module (Sender + Receiver).
   */
  public getProtocol<P extends SenderProtocol>(
    protocol: P,
  ): HyperProtocol<unknown, unknown, unknown, unknown, P> | undefined {
    return this.registry.get(protocol);
  }

  /**
   * @ru Получает зарегистрированный сендер протокола.
   * @en Gets a registered protocol sender.
   */
  public getSender<P extends SenderProtocol>(
    protocol: P,
  ): HyperSender<unknown, unknown, unknown, unknown, P> | undefined {
    return this.registry.get(protocol)?.sender;
  }

  /**
   * @ru Получает зарегистрированный ресивер протокола.
   * @en Gets a registered protocol receiver.
   */
  public getReceiver<P extends SenderProtocol>(
    protocol: P,
  ): HyperReceiver<unknown, unknown, unknown, unknown, P> | undefined {
    return this.registry.get(protocol)?.receiver;
  }

  /**
   * @ru Возвращает имя текущего транспорта.
   * @en Returns the name of the current transport.
   * @returns Transport constructor name.
   */
  public async getTransportName(): Promise<string> {
    this.assertRunning();
    const t = await this.acquireTransport();
    return t.constructor.name;
  }

  /**
   * @ru Возвращает имя сендера протокола (по умолчанию — "rest").
   * Протокол резолвится лениво, если ещё не зарегистрирован.
   * @en Returns the sender constructor name for a protocol (default "rest").
   * The protocol is resolved lazily if not registered yet.
   * @param protocol - The protocol to inspect.
   * @returns Sender constructor name.
   */
  public async getSenderName(protocol: SenderProtocol = "rest"): Promise<string> {
    const resolved = await this.resolveRegisteredProtocol(protocol);
    const sender = resolved.sender;
    if (!sender) {
      throw new HyperClientError(`[HyperCore] Protocol "${protocol}" has no sender (client role).`);
    }
    return sender.constructor.name;
  }

  /**
   * @ru Возвращает имя ресивера протокола (по умолчанию — "rest").
   * Протокол резолвится лениво, если ещё не зарегистрирован.
   * @en Returns the receiver constructor name for a protocol (default "rest").
   * The protocol is resolved lazily if not registered yet.
   * @param protocol - The protocol to inspect.
   * @returns Receiver constructor name.
   */
  public async getReceiverName(protocol: SenderProtocol = "rest"): Promise<string> {
    const resolved = await this.resolveRegisteredProtocol(protocol);
    const receiver = resolved.receiver;
    if (!receiver) {
      throw new HyperClientError(
        `[HyperCore] Protocol "${protocol}" has no receiver (server role).`,
      );
    }
    return receiver.constructor.name;
  }

  /**
   * @ru Возвращает имя модуля протокола (по умолчанию — "rest"): предпочитает
   * `name`, затем `constructor.name`, затем идентификатор протокола.
   * Протокол резолвится лениво, если ещё не зарегистрирован.
   * @en Returns the protocol module name (default "rest"): prefers `name`, then
   * `constructor.name`, then the protocol identifier.
   * The protocol is resolved lazily if not registered yet.
   * @param protocol - The protocol to inspect.
   * @returns The protocol module display name.
   */
  public async getProtocolName(protocol: SenderProtocol = "rest"): Promise<string> {
    const resolved = await this.resolveRegisteredProtocol(protocol);
    if (resolved.name) return resolved.name;
    const ctor = resolved.constructor;
    return ctor && ctor.name && ctor.name !== "Object" ? ctor.name : String(resolved.protocol);
  }

  /**
   * @ru Регистрирует единый модуль протокола и раскрывает методы его сендера
   * на ядре (например, `core.rest` для REST).
   * @en Registers a unified protocol module and exposes its sender methods on the
   * core (e.g., `core.rest` for REST).
   * @param protocol - The protocol module to register.
   * @returns This instance for chaining.
   */
  public registerProtocol<P extends SenderProtocol>(protocol: AnyHyperProtocol<P>): this {
    this.assertActive();
    const protocolName = String(protocol.protocol);
    const namespaces = this as unknown as Record<string, unknown>;
    const isReserved =
      protocolName === "__proto__" ||
      protocolName === "prototype" ||
      protocolName === "constructor" ||
      protocolName in HyperCore.prototype ||
      (protocolName in this && !this.protocolNamespaces.has(protocolName));

    if (isReserved) {
      throw new HyperClientError(
        `[HyperCore] Protocol name "${protocolName}" conflicts with the core API.`,
      );
    }

    for (const [name, owner] of this.flatMethodOwners) {
      if (owner === protocolName) {
        if (
          Object.getOwnPropertyDescriptor(this, name)?.value === this.flatMethodValues.get(name)
        ) {
          delete namespaces[name];
        }
        this.flatMethodValues.delete(name);
        this.flatMethodOwners.delete(name);
        this.generatedFlatMethods.delete(name);
      }
    }
    if (this.protocolNamespaces.has(protocolName)) {
      delete namespaces[protocolName];
      this.protocolNamespaces.delete(protocolName);
    }
    this.registry.register(protocol);

    const methods = protocol.sender?.methods;
    if (methods && typeof methods === "object") {
      const namespace: Record<string, unknown> = Object.create(null);

      for (const name in methods) {
        if (!Object.hasOwn(methods, name)) continue;

        const method = methods[name] as ((...args: unknown[]) => unknown) | undefined;
        if (typeof method !== "function") continue;

        const boundMethod = (...args: unknown[]) => method.apply(methods, [this, ...args]);
        namespace[name] = boundMethod;

        const stillGenerated =
          this.generatedFlatMethods.has(name) &&
          Object.getOwnPropertyDescriptor(this, name)?.value === this.flatMethodValues.get(name);
        if (stillGenerated) {
          namespaces[name] = boundMethod;
          this.flatMethodOwners.set(name, protocolName);
          this.flatMethodValues.set(name, boundMethod);
        } else if (!(name in HyperCore.prototype) && !(name in this)) {
          namespaces[name] = boundMethod;
          this.generatedFlatMethods.add(name);
          this.flatMethodOwners.set(name, protocolName);
          this.flatMethodValues.set(name, boundMethod);
        }
      }

      namespaces[protocolName] = namespace;
      this.protocolNamespaces.add(protocolName);
    }

    return this;
  }

  /**
   * @ru Регистрирует сендер протокола, оборачивая его в модуль протокола.
   * Существующий ресивер того же протокола сохраняется.
   * @en Registers a protocol sender, wrapping it into a protocol module.
   * An existing receiver for the same protocol is preserved.
   * @param sender - The protocol sender to register.
   * @returns This instance for chaining.
   */
  public registerSender<P extends SenderProtocol>(sender: AnyHyperSender<P>): this {
    const existing = this.registry.get(sender.protocol);
    return this.registerProtocol({
      protocol: sender.protocol,
      sender,
      receiver: existing?.receiver,
    });
  }

  /**
   * @ru Регистрирует ресивер протокола, оборачивая его в модуль протокола.
   * Существующий сендер того же протокола сохраняется.
   * @en Registers a protocol receiver, wrapping it into a protocol module.
   * An existing sender for the same protocol is preserved.
   * @param receiver - The protocol receiver to register.
   * @returns This instance for chaining.
   */
  public registerReceiver<P extends SenderProtocol>(receiver: AnyHyperReceiver<P>): this {
    const existing = this.registry.get(receiver.protocol);
    return this.registerProtocol({
      protocol: receiver.protocol,
      sender: existing?.sender,
      receiver,
    });
  }

  /**
   * @ru Создаёт ленивый namespace методов протокола: методы доступны ещё до
   * регистрации протокола и резолвятся по требованию при первом вызове.
   * @en Creates a lazy protocol methods namespace: methods are reachable before
   * the protocol is registered and are resolved on first call.
   * @param protocol - The protocol to expose lazily.
   * @returns A Proxy that dispatches method calls to the resolved protocol sender.
   */
  private createLazyNamespace(protocol: SenderProtocol): Record<string, unknown> {
    const handler: ProxyHandler<Record<string, unknown>> = {
      get: (_target, name) => {
        if (typeof name !== "string" || name === "then") return undefined;
        return (...args: unknown[]) => this.dispatchLazyMethod(protocol, name, args);
      },
    };
    return new Proxy({}, handler);
  }

  /**
   * @ru Разрешает протокол по требованию и вызывает метод `methods`-поверхности
   * его сендера, биндя ядро первым аргументом.
   * @en Resolves the protocol on demand and calls a method on its sender
   * `methods` surface, binding the core as the first argument.
   * @param protocol - The protocol identifier.
   * @param name - The method name on the sender surface.
   * @param args - Arguments forwarded after the core instance.
   * @returns The result of the sender method call.
   */
  private async dispatchLazyMethod(
    protocol: SenderProtocol,
    name: string,
    args: unknown[],
  ): Promise<unknown> {
    const resolved = await this.resolveRegisteredProtocol(protocol);

    const sender = resolved.sender;
    if (!sender) {
      throw new HyperClientError(`[HyperCore] Protocol "${protocol}" has no sender (client role).`);
    }

    const methods = sender.methods as
      | Record<string, (...callArgs: unknown[]) => unknown>
      | undefined;
    const method = methods && Object.hasOwn(methods, name) ? methods[name] : undefined;
    if (typeof method !== "function") {
      throw new TypeError(`[HyperCore] Protocol "${protocol}" has no method "${name}".`);
    }
    return method.apply(methods, [this, ...args]);
  }

  /**
   * @ru Основной метод диспетчеризации: выбирает сендер по протоколу и выполняет
   * трёхфазный цикл с поддержкой плагинов.
   * @en Main dispatch method: resolves the sender by protocol and runs the three-phase
   * cycle with plugin support.
   * @param req - The universal request envelope.
   * @returns A promise resolving to the normalized universal response.
   */
  public send<TOutput = unknown, P extends SenderProtocol = SenderProtocol>(
    req: SendRequest<InferProtocolInput<P>, P>,
  ): Promise<UniversalResponse<TOutput>>;
  public send<TInput = unknown, TOutput = unknown, P extends SenderProtocol = SenderProtocol>(
    req: SendRequest<TInput, P>,
  ): Promise<UniversalResponse<TOutput>>;
  public async send<TInput = unknown, TOutput = unknown, P extends string = string>(
    req: SendRequest<TInput, P>,
  ): Promise<UniversalResponse<TOutput>> {
    this.assertRunning();
    let complete!: () => void;
    const completion = new Promise<void>((resolve) => {
      complete = resolve;
    });
    this.activeRequests.add(completion);
    const ctx = createRequestContext(req as SendRequest<unknown, string>);
    try {
      const response = await this.executeRequest<TInput, TOutput, P>(req, ctx);
      await ctx.settle({ ok: true, response }, (error) =>
        this.log("error", "[HyperCore] Settlement callback failed", error),
      );
      return response;
    } catch (error) {
      await ctx.settle({ ok: false, error }, (diagnostic) =>
        this.log("error", "[HyperCore] Settlement callback failed", diagnostic),
      );
      throw error;
    } finally {
      complete();
      this.activeRequests.delete(completion);
    }
  }

  private async executeRequest<TInput, TOutput, P extends string>(
    req: SendRequest<TInput, P>,
    ctx: DefaultRequestContext,
  ): Promise<UniversalResponse<TOutput>> {
    const plugins = this.plugins;
    let currentReq = req as SendRequest<any, any>;
    const hookRequests = new Map<HyperPlugin, SendRequest<any, any>>();
    let responseHooksStarted = false;

    if (plugins.length === 0) {
      const sender = this.registry.get(req.protocol)?.sender;
      if (sender) {
        return this.runSender<TInput, TOutput>(sender, req as SendRequest<TInput, string>, ctx);
      }
    }

    try {
      let response: UniversalResponse<TOutput> | undefined;

      for (let i = 0; i < plugins.length; i++) {
        const plugin = plugins[i]!;
        if (typeof plugin.onRequest !== "function") continue;

        hookRequests.set(plugin, currentReq);
        const result = await plugin.onRequest(currentReq, this.pluginCtx, ctx);
        if (result == null) continue;

        if (isUniversalResponse(result)) {
          response = result as UniversalResponse<TOutput>;
          break;
        }

        currentReq = result as SendRequest<any, any>;
        (ctx as { signal?: AbortSignal }).signal = currentReq.signal;
      }

      if (!response) {
        const sender = await this.resolveRequestSender(currentReq.protocol);
        response = await this.runSender<unknown, TOutput>(sender, currentReq, ctx);
      }

      if (ctx.isFinalResponse(response)) return response;
      responseHooksStarted = true;
      return await this.runResponseHooks(response, currentReq, ctx, plugins, hookRequests);
    } catch (err) {
      let recovery: UniversalResponse<TOutput> | undefined;
      for (const plugin of plugins) {
        if (typeof plugin.onError !== "function") continue;
        try {
          const recovered = await plugin.onError(
            err,
            hookRequests.get(plugin) ?? currentReq,
            this.pluginCtx,
            ctx,
          );
          if (!recovery && recovered != null && isUniversalResponse(recovered)) {
            recovery = recovered as UniversalResponse<TOutput>;
          }
        } catch (hookError) {
          this.log("error", "[HyperCore] Error hook failed", hookError);
        }
      }
      if (recovery) {
        // A response-hook failure already triggered cleanup; do not repeat those hooks.
        if (responseHooksStarted) return recovery;
        try {
          return await this.runResponseHooks(recovery, currentReq, ctx, plugins, hookRequests);
        } catch (responseError) {
          // Report the new failure and finish cleanup without starting another recovery cycle.
          for (const plugin of plugins) {
            if (typeof plugin.onError !== "function") continue;
            try {
              await plugin.onError(
                responseError,
                hookRequests.get(plugin) ?? currentReq,
                this.pluginCtx,
                ctx,
              );
            } catch (hookError) {
              this.log("error", "[HyperCore] Error hook failed", hookError);
            }
          }
          throw responseError;
        }
      }
      throw err;
    }
  }

  private assertRunning(): void {
    if (this.state === "initializing") {
      throw new HyperClientError(
        "[HyperCore] Operations cannot start during setup initialization.",
      );
    }
    this.assertActive();
  }

  private assertActive(): void {
    if (this.isDestroyed) {
      throw new HyperClientError("[HyperCore] Core instance has been destroyed.");
    }
  }

  private async resolveRegisteredProtocol<P extends SenderProtocol>(
    protocol: P,
  ): Promise<AnyHyperProtocol<P>> {
    this.assertActive();
    const existing = this.registry.get(protocol);
    if (existing) return existing;
    const loaded = await resolveProtocol(protocol);
    this.assertActive();
    // Explicit registration during the import has priority over its late result.
    const registered = this.registry.get(protocol);
    if (registered) return registered;
    this.registerProtocol(loaded);
    return loaded;
  }

  private async resolveRequestSender(
    protocol: SenderProtocol,
  ): Promise<HyperSender<any, any, any, any>> {
    const resolved = await this.resolveRegisteredProtocol(protocol);

    const sender = resolved.sender;
    if (!sender) {
      throw new HyperClientError(`[HyperCore] Protocol "${protocol}" has no sender (client role).`);
    }
    return sender;
  }

  private async runResponseHooks<TOutput>(
    initialResponse: UniversalResponse<TOutput>,
    req: SendRequest<any, any>,
    ctx: RequestContext,
    plugins: readonly HyperPlugin[],
    hookRequests: ReadonlyMap<HyperPlugin, SendRequest<any, any>>,
  ): Promise<UniversalResponse<TOutput>> {
    let response = initialResponse;

    for (let i = 0; i < plugins.length; i++) {
      const plugin = plugins[i]!;
      if (typeof plugin.onResponse !== "function") continue;

      const hookRequest = hookRequests.get(plugin) ?? req;
      if (plugin.mode === "background") {
        const snapshot = { ...response, headers: { ...response.headers } };
        void Promise.resolve()
          .then(() => plugin.onResponse!(snapshot, hookRequest, this.pluginCtx, ctx))
          .catch((err: unknown) => this.reportBackgroundPluginError(err));
        continue;
      }

      const result = await plugin.onResponse(response, hookRequest, this.pluginCtx, ctx);
      if (result != null && isUniversalResponse(result)) {
        response = result as UniversalResponse<TOutput>;
      }
    }

    return response;
  }

  private reportBackgroundPluginError(err: unknown): void {
    const customOnError = (this.config as Record<string, unknown>).onError;
    if (typeof customOnError === "function") {
      try {
        (customOnError as (error: unknown) => void)(err);
        return;
      } catch (handlerError) {
        this.log("error", "[HyperCore] Background error handler failed", handlerError);
      }
    }
    this.log("error", "[HyperCore] Background plugin error", err);
  }

  private log(level: "debug" | "info" | "warn" | "error", message: string, meta?: unknown): void {
    try {
      if (this.config.logger) {
        this.config.logger(level, message, meta);
        return;
      }
      if (!this.config.verbose && level !== "error") return;
      const output = level === "debug" ? console.debug : console[level];
      output(message, meta);
    } catch {
      // Diagnostics must never interrupt lifecycle cleanup.
    }
  }

  /**
   * @ru Атомарно получает транспорт для конкретного протокола и удерживает
   * каждый физический экземпляр ровно один раз за время жизни ядра.
   * @en Atomically acquires a transport for a protocol and retains each physical
   * instance exactly once for the lifetime of this core.
   */
  private async acquireTransport(
    protocol: SenderProtocol = "rest",
    requireListen = false,
  ): Promise<HyperTransport> {
    if (this.isDestroyed) {
      throw new HyperClientError(
        "[HyperCore] Cannot acquire transport on a destroyed core instance.",
      );
    }

    const transports = requireListen ? this.listenTransports : this.transports;
    const transportPromises = requireListen ? this.listenTransportPromises : this.transportPromises;
    const existing = transports.get(protocol);
    if (existing) return existing;

    let pending = transportPromises.get(protocol);
    if (!pending) {
      pending = this.resolveAndRetainTransport(protocol, requireListen);
      let tracked!: Promise<HyperTransport>;
      tracked = pending.catch((err: unknown) => {
        if (transportPromises.get(protocol) === tracked) {
          transportPromises.delete(protocol);
        }
        throw err;
      });
      transportPromises.set(protocol, tracked);
      pending = tracked;
    }

    const transport = await pending;
    if (this.isDestroyed) {
      throw new HyperClientError(
        "[HyperCore] Core instance was destroyed while resolving transport.",
      );
    }

    return transport;
  }

  private async resolveAndRetainTransport(
    protocol: SenderProtocol,
    requireListen = false,
  ): Promise<HyperTransport> {
    const transport =
      this.fixedTransport && (!requireListen || typeof this.fixedTransport.listen === "function")
        ? this.fixedTransport
        : await resolveTransport(protocol, {
            ...this.config,
            cacheKey: this.config,
            customTransport: this.fixedTransport ?? this.config.customTransport,
            requireListen,
            logger: this.config.logger,
            verbose: this.config.verbose,
          });
    const supportsProtocol =
      typeof transport.supports === "function"
        ? transport.supports(protocol)
        : (transport.protocols?.includes(protocol) ?? true);

    if (!supportsProtocol) {
      throw new HyperClientError(
        `[HyperCore] Transport "${transport.constructor.name}" does not support protocol "${protocol}".`,
      );
    }

    return this.retainResolvedTransport(protocol, transport, requireListen);
  }

  private retainResolvedTransport(
    protocol: SenderProtocol,
    transport: HyperTransport,
    requireListen = false,
  ): HyperTransport {
    if (!this.retainedTransports.has(transport)) {
      retainTransport(transport);
      this.retainedTransports.add(transport);
    }

    (requireListen ? this.listenTransports : this.transports).set(protocol, transport);
    return transport;
  }

  /**
   * @ru Выполняет ядро цикла запроса: prepare → send → parse через физический
   * транспорт. Транспорт получается через `acquireTransport()`.
   * @en Runs the core request cycle: prepare → send → parse through the physical
   * transport. The transport is acquired via `acquireTransport()`.
   * @param sender - The resolved protocol sender.
   * @param req - The (possibly plugin-modified) universal request.
   * @param ctx - The per-request execution context.
   * @returns The normalized universal response.
   */
  private async runSender<TInput, TOutput>(
    sender: HyperSender<any, any, any, any>,
    req: SendRequest<TInput, string>,
    ctx: RequestContext,
  ): Promise<UniversalResponse<TOutput>> {
    this.assertActive();
    const transport =
      this.transports.get(req.protocol) ?? (await this.acquireTransport(req.protocol));
    const prepared = sender.prepare(req, ctx);
    const raw = await sender.send(prepared, transport, ctx);
    return sender.parse(raw, ctx) as UniversalResponse<TOutput>;
  }

  /**
   * @ru Запускает сервер для указанного протокола: связывает транспорт, ресивер и
   * application handler в цепочку receive → handle → respond.
   * @en Starts a server for the given protocol, wiring transport, receiver, and
   * application handler into the receive → handle → respond pipeline.
   * @template P - The protocol identifier.
   * @param options - The server listen options.
   * @returns A promise resolving to the transport server handle.
   */
  public async listen<P extends SenderProtocol = SenderProtocol>(
    options: HyperServerListenOptions<P>,
  ): Promise<TransportServer> {
    this.assertRunning();
    const pending = this.startListening(options);
    this.pendingListeners.add(pending);
    try {
      return await pending;
    } finally {
      this.pendingListeners.delete(pending);
    }
  }

  private async startListening<P extends SenderProtocol>(
    options: HyperServerListenOptions<P>,
  ): Promise<TransportServer> {
    const transport = await this.acquireTransport(options.protocol, true);

    if (typeof transport.listen !== "function") {
      throw new HyperClientError(
        `[HyperCore] Transport "${transport.constructor.name}" does not support listen() (server role).`,
      );
    }

    const resolved = await this.resolveRegisteredProtocol(options.protocol);

    const receiver = resolved.receiver as
      | HyperReceiver<unknown, unknown, TransportRequest, TransportResponse, P>
      | undefined;
    if (!receiver) {
      throw new HyperClientError(
        `[HyperCore] Protocol "${options.protocol}" has no receiver (server role).`,
      );
    }

    const handler = options.handler as
      | ((request: unknown, ctx: ServerRequestContext) => unknown)
      | undefined;

    const onRequest = async (raw: TransportRequest): Promise<TransportResponse> => {
      const ctx = Object.assign(createServerRequestContext(raw), { protocol: options.protocol });
      const plugins = this.plugins;
      let currentRequest = raw;
      let outcome: ServerRequestOutcome;
      let responseHooksStarted = false;
      const responseHooks = async (initial: TransportResponse): Promise<TransportResponse> => {
        let response = initial;
        for (const plugin of plugins) {
          const result = await plugin.onServerResponse?.(
            response,
            currentRequest,
            this.pluginCtx,
            ctx,
          );
          if (result !== undefined) response = result;
        }
        return response;
      };
      const errorHooks = async (error: unknown): Promise<TransportResponse | undefined> => {
        let recovery: TransportResponse | undefined;
        for (const plugin of plugins) {
          try {
            const result = await plugin.onServerError?.(error, currentRequest, this.pluginCtx, ctx);
            if (recovery === undefined && result !== undefined) recovery = result;
          } catch (diagnostic) {
            this.log("error", "[HyperCore] Server error hook failed", diagnostic);
          }
        }
        return recovery;
      };
      try {
        for (const plugin of plugins) {
          const result = await plugin.onServerRequest?.(currentRequest, this.pluginCtx, ctx);
          if (result !== undefined) {
            currentRequest = result;
            (ctx as { signal?: AbortSignal }).signal = currentRequest.signal;
          }
        }
        const request = await receiver.receive(currentRequest, ctx);
        const response = handler
          ? await handler(request, ctx)
          : await receiver.handle(request, ctx);
        const serialized = await receiver.respond(response, ctx);
        responseHooksStarted = true;
        outcome = { ok: true, response: await responseHooks(serialized) };
      } catch (error) {
        const recovery = await errorHooks(error);
        if (recovery === undefined) outcome = { ok: false, error };
        else if (responseHooksStarted) outcome = { ok: true, response: recovery };
        else {
          try {
            outcome = { ok: true, response: await responseHooks(recovery) };
          } catch (responseError) {
            await errorHooks(responseError);
            outcome = { ok: false, error: responseError };
          }
        }
      }
      for (const plugin of plugins) {
        try {
          await plugin.onServerSettled?.(outcome, currentRequest, this.pluginCtx, ctx);
        } catch (diagnostic) {
          this.log("error", "[HyperCore] Server settlement hook failed", diagnostic);
        }
      }
      if (!outcome.ok) throw outcome.error;
      return outcome.response;
    };

    const server = await transport.listen!({
      host: options.host,
      port: options.port,
      signal: options.signal,
      onRequest,
    });

    if (this.isDestroyed) {
      await server.close();
      throw new HyperClientError(
        "[HyperCore] Core instance was destroyed while starting the server.",
      );
    }

    let closing: Promise<void> | undefined;
    const tracked: TransportServer = {
      close: () => {
        closing ??= Promise.resolve()
          .then(() => server.close())
          .then(() => {
            this.servers.delete(tracked);
          });
        return closing;
      },
    };
    this.servers.add(tracked);
    return tracked;
  }

  /**
   * @ru Регистрирует плагин. Пропускает отключённые плагины.
   * @en Registers a plugin. Skips disabled plugins.
   * @param plugin - The plugin instance to register.
   * @returns This instance for chaining.
   */
  /**
   * Creates a core asynchronously and resolves plugin module paths before construction.
   */
  public static async create(config: Partial<HyperClientOptions> = {}): Promise<HyperCore> {
    const plugins = config.plugins;
    if (!plugins?.some((plugin) => typeof plugin === "string")) {
      return new HyperCore(config);
    }

    const resolvedPlugins: HyperPlugin[] = [];
    for (const plugin of plugins) {
      if (typeof plugin !== "string") {
        resolvedPlugins.push(plugin);
        continue;
      }
      const module = await dynamicImport(plugin);
      const candidate = module.default ?? module.plugin;
      if (!candidate || typeof candidate !== "object") {
        throw new HyperClientError(
          `[HyperCore] Plugin module "${plugin}" must export a plugin object as default or "plugin".`,
        );
      }
      resolvedPlugins.push(candidate as HyperPlugin);
    }

    return new HyperCore({ ...config, plugins: resolvedPlugins });
  }

  public use(plugin: HyperPlugin): this {
    this.assertActive();
    if (this.plugins.includes(plugin)) return this;
    if (this.plugins.some((existing) => existing.name === plugin.name)) {
      throw new HyperClientError(`[HyperCore] Plugin "${plugin.name}" is already registered.`);
    }
    const owner = pluginOwners.get(plugin);
    if (!plugin.shared && owner && owner !== this) {
      throw new HyperClientError(
        "[HyperCore] Plugin instances cannot be shared across cores. Supply a fresh instance.",
      );
    }
    if (plugin.shared && plugin.setup) {
      throw new HyperClientError("[HyperCore] Shared stateless plugins cannot define setup().");
    }
    const enabled = plugin.enabled ? plugin.enabled(this.config) : true;
    if (!enabled) return this;

    plugin.setup?.(this.pluginCtx);
    if (!plugin.shared) pluginOwners.set(plugin, this);
    this.plugins = [...this.plugins, plugin].sort(
      (a, b) => (PLUGIN_PHASE_ORDER[a.phase ?? ""] ?? 0) - (PLUGIN_PHASE_ORDER[b.phase ?? ""] ?? 0),
    );
    return this;
  }

  /**
   * @ru Создаёт новый экземпляр ядра с расширенной/переопределённой конфигурацией,
   * переиспользуя текущий транспорт.
   * @en Creates a new core instance with extended/overridden configuration,
   * reusing the current transport.
   * @param options - Partial configuration overrides.
   * @returns A new IHyperCore instance.
   */
  public extend(options: Partial<HyperClientOptions>): IHyperCore {
    this.assertActive();
    const transport = options.customTransport ?? this.fixedTransport ?? undefined;
    const sharedTransports = options.customTransport ? undefined : this.transportPromises;
    return new HyperCore({ ...this.config, ...options }, transport, sharedTransports);
  }

  /**
   * @ru Создаёт полностью независимый экземпляр ядра на основе текущей
   * конфигурации: не переиспользует текущий транспорт и по умолчанию не
   * наследует `customTransport`.
   * @en Creates a fully independent core instance based on the current config:
   * it does not reuse the current transport and does not inherit
   * `customTransport` by default.
   * @param options - Partial configuration overrides.
   * @returns A new IHyperCore instance.
   */
  public create(options: Partial<HyperClientOptions>): IHyperCore {
    this.assertActive();
    const base: Partial<HyperClientOptions> = { ...this.config };
    delete base.customTransport;
    return new HyperCore({ ...base, ...options });
  }

  /**
   * @ru Завершает работу ядра и освобождает ресурсы: закрывает активные серверы,
   * затем освобождает удержание транспорта. Graceful-дренирование активных запросов
   * определяется реализацией `TransportServer.close()`.
   * @en Shuts down the core and releases resources: closes active servers, then
   * releases the transport hold. Graceful draining of in-flight requests is defined
   * by the `TransportServer.close()` implementation.
   * @param graceful - If true, prefers `transport.close()`; otherwise prefers `transport.destroy()`.
   * @returns Promise that resolves when shutdown is complete.
   */
  public destroy(graceful = true): Promise<void> {
    if (this.state === "initializing") {
      return Promise.reject(
        new HyperClientError("[HyperCore] Cannot destroy during setup initialization."),
      );
    }
    if (!this.destroyPromise) {
      this.destroyPromise = this.performDestroy(graceful);
    }
    return this.destroyPromise;
  }

  private async performDestroy(graceful: boolean): Promise<void> {
    this.state = "destroying";
    // Accepted calls finish or reject at the next admission check before resources close.
    if (graceful) await Promise.allSettled(this.activeRequests);

    await Promise.allSettled(this.pendingListeners);
    for (const server of this.servers) {
      try {
        await server.close();
      } catch {
        // Continue releasing the remaining resources.
      }
    }
    this.servers.clear();

    await Promise.allSettled([
      ...this.transportPromises.values(),
      ...this.listenTransportPromises.values(),
    ]);
    this.transportPromises.clear();
    this.transports.clear();
    this.listenTransportPromises.clear();
    this.listenTransports.clear();

    const transports = [...this.retainedTransports];
    this.retainedTransports.clear();

    for (const transport of transports) {
      if (releaseTransport(transport) > 0) continue;

      evictCachedTransport(transport);

      try {
        if (graceful && typeof transport.close === "function") {
          await transport.close();
        } else if (typeof transport.destroy === "function") {
          await transport.destroy();
        } else if (typeof transport.close === "function") {
          await transport.close();
        }
      } catch (err) {
        this.log("error", "[HyperCore] Error closing transport during destroy", err);
      }
    }
    this.state = "destroyed";
  }
}
