import type { HyperTransport, LogLevel, SenderProtocol } from "@hyperttp/types";
import { FetchTransport, type FetchTransportOptions } from "./fetch.js";
import { dynamicImport, isModuleNotFoundError } from "../utils/modules.js";

declare const Bun: unknown;
declare const Deno: unknown;

export type Runtime = "bun" | "node" | "deno" | "browser";

/**
 * @ru Опции разрешения транспорта. `customTransport` имеет приоритет над автовыбором.
 * @en Transport resolution options. `customTransport` takes priority over auto-selection.
 */
export interface ResolveTransportOptions {
  customTransport?: HyperTransport;
  /** Stable configuration identity for sharing automatic transports across calls. */
  cacheKey?: object;
  /**
   * @ru Требует серверную роль транспорта. При её отсутствии используется
   * встроенный `FetchTransport`.
   * @en Requires the transport server role. When unavailable, the built-in
   * `FetchTransport` is used.
   */
  requireListen?: boolean;
  logger?: (level: LogLevel, message: string, meta?: unknown) => void;
  verbose?: boolean;
  [key: string]: unknown;
}

export const CURRENT_RUNTIME: Runtime = (() => {
  if (typeof Bun !== "undefined") return "bun";
  if (typeof Deno !== "undefined") return "deno";
  if (typeof process !== "undefined" && process.versions?.node) return "node";
  return "browser";
})();

type TransportDef = {
  readonly runtime: readonly Runtime[];
  readonly pkg: string;
  readonly export: string;
  /** Protocols that require this transport family. Omitted for generic transports. */
  readonly protocols?: readonly SenderProtocol[];
};

const ALL_RUNTIMES: readonly Runtime[] = ["bun", "node", "deno", "browser"];

const TRANSPORT_DEFS: readonly TransportDef[] = [
  {
    protocols: ["webrtc"],
    runtime: ALL_RUNTIMES,
    pkg: "@hyperttp/transport-webrtc",
    export: "WebRtcTransport",
  },
  {
    protocols: ["ws", "websocket"],
    runtime: ALL_RUNTIMES,
    pkg: "@hyperttp/transport-websocket",
    export: "WebSocketTransport",
  },
  {
    protocols: ["mqtt"],
    runtime: ALL_RUNTIMES,
    pkg: "@hyperttp/transport-mqtt",
    export: "MqttTransport",
  },
  { runtime: ["bun"], pkg: "@hyperttp/transport-bun", export: "BunTransport" },
  { runtime: ["node"], pkg: "@hyperttp/transport-undici", export: "UndiciTransport" },
  { runtime: ["deno"], pkg: "@hyperttp/transport-deno", export: "DenoTransport" },
];

function getCandidates(protocol: SenderProtocol): readonly TransportDef[] {
  return TRANSPORT_DEFS.filter(
    (transport) =>
      transport.runtime.includes(CURRENT_RUNTIME) &&
      (!transport.protocols || transport.protocols.includes(protocol)),
  );
}

function getTransportInstallHint(protocol: SenderProtocol): string {
  const packages = new Set(
    getCandidates(protocol)
      .filter((transport) => transport.protocols?.includes(protocol))
      .map((transport) => transport.pkg),
  );
  if (packages.size === 0) return "";

  return ` Install ${[...packages].map((pkg) => `"${pkg}"`).join(" or ")}.`;
}

type TransportCache = {
  client: Map<SenderProtocol, HyperTransport>;
  listen: Map<SenderProtocol, HyperTransport>;
  clientResolutions: Map<SenderProtocol, Promise<HyperTransport>>;
  listenResolutions: Map<SenderProtocol, Promise<HyperTransport>>;
};

const defaultCacheKey = {};
let transportCaches = new WeakMap<object, TransportCache>();
let transportEntries = new WeakMap<HyperTransport, Set<Map<SenderProtocol, HyperTransport>>>();

function getCache(config?: ResolveTransportOptions): TransportCache {
  const identity = config?.cacheKey ?? config ?? defaultCacheKey;
  let cache = transportCaches.get(identity);
  if (!cache) {
    cache = {
      client: new Map(),
      listen: new Map(),
      clientResolutions: new Map(),
      listenResolutions: new Map(),
    };
    transportCaches.set(identity, cache);
  }
  return cache;
}

function supportsListen(transport: HyperTransport): boolean {
  return typeof transport.listen === "function";
}

function supportsProtocol(transport: HyperTransport, protocol: SenderProtocol): boolean {
  return typeof transport.supports === "function"
    ? transport.supports(protocol)
    : (transport.protocols?.includes(protocol) ?? true);
}

async function disposeUnusedTransport(transport: HyperTransport): Promise<void> {
  try {
    if (typeof transport.destroy === "function") {
      await transport.destroy();
    } else if (typeof transport.close === "function") {
      await transport.close();
    }
  } catch {
    //
  }
}

async function createFetchTransport(
  protocol: SenderProtocol,
  config?: ResolveTransportOptions,
): Promise<HyperTransport> {
  const fetchTransport = new FetchTransport(config as unknown as FetchTransportOptions);
  if (supportsProtocol(fetchTransport, protocol)) return fetchTransport;

  await disposeUnusedTransport(fetchTransport);
  throw new Error(
    `[HyperCore] No transport available for protocol "${protocol}" in runtime "${CURRENT_RUNTIME}".${getTransportInstallHint(protocol)}`,
  );
}

async function createTransport(
  protocol: SenderProtocol,
  config?: ResolveTransportOptions,
): Promise<HyperTransport> {
  const candidates = getCandidates(protocol);
  for (let i = 0; i < candidates.length; i++) {
    const t = candidates[i]!;
    let mod: Record<string, unknown>;
    try {
      mod = await dynamicImport(t.pkg);
    } catch (err) {
      if (!isModuleNotFoundError(err)) throw err;
      continue;
    }
    const candidate = (mod[t.export] ?? mod.default) as
      | { new (opts?: unknown): HyperTransport }
      | undefined;
    if (typeof candidate !== "function") continue;

    const instance = new candidate(config ?? {});
    if (
      !supportsProtocol(instance, protocol) ||
      (config?.requireListen && !supportsListen(instance))
    ) {
      await disposeUnusedTransport(instance);
      continue;
    }

    return instance;
  }

  const fetchTransport = await createFetchTransport(protocol, config);
  const message = `[HyperCore] Packaged transport unavailable or missing listen() for protocol "${protocol}" in runtime "${CURRENT_RUNTIME}". Falling back to FetchTransport.`;
  try {
    if (config?.logger) {
      config.logger("warn", message);
    } else if (config?.verbose) {
      console.warn(message);
    }
  } catch (err) {
    await disposeUnusedTransport(fetchTransport);
    throw err;
  }
  return fetchTransport;
}

/**
 * @ru Разрешает оптимальный транспорт для указанного протокола и текущей среды.
 * Кастомный транспорт из конфигурации имеет приоритет над автовыбором.
 * @en Resolves optimal transport for the given protocol and current runtime.
 * A custom transport from the config takes priority over auto-selection.
 */
export async function resolveTransport(
  protocol: SenderProtocol = "rest",
  config?: ResolveTransportOptions,
): Promise<HyperTransport> {
  const requireListen = config?.requireListen ?? false;

  if (config?.customTransport) {
    if (!supportsProtocol(config.customTransport, protocol)) {
      throw new Error(`[HyperCore] Custom transport does not support protocol "${protocol}".`);
    }

    return requireListen && !supportsListen(config.customTransport)
      ? createFetchTransport(protocol, config)
      : config.customTransport;
  }

  const cache = getCache(config);
  const transportCache = requireListen ? cache.listen : cache.client;
  const transportResolutions = requireListen ? cache.listenResolutions : cache.clientResolutions;
  const cached = transportCache.get(protocol);
  if (cached) return cached;

  const pending = transportResolutions.get(protocol);
  if (pending) return pending;

  const resolution = createTransport(protocol, config)
    .then((transport) => {
      transportCache.set(protocol, transport);
      let entries = transportEntries.get(transport);
      if (!entries) {
        entries = new Set();
        transportEntries.set(transport, entries);
      }
      entries.add(transportCache);
      return transport;
    })
    .finally(() => {
      transportResolutions.delete(protocol);
    });

  transportResolutions.set(protocol, resolution);
  return resolution;
}

/**
 * @ru Синхронно возвращает транспорт из кэша без создания Promise.
 * @en Synchronously returns a cached transport without creating a Promise.
 * @param protocol - Протокол, для которого запрашивается транспорт. @en Protocol whose transport is requested.
 * @returns Кэшированный транспорт или `undefined`. @en Cached transport or `undefined`.
 */
export function getCachedTransport(
  protocol: SenderProtocol = "rest",
  config?: ResolveTransportOptions,
): HyperTransport | undefined {
  const cache = getCache(config);
  return (config?.requireListen ? cache.listen : cache.client).get(protocol);
}

/**
 * @ru Удаляет все записи кэша, ссылающиеся на указанный транспорт.
 * @en Removes every cache entry that references the given transport.
 * @param transport - Экземпляр транспорта для удаления из кэша. @en Transport instance to evict from the cache.
 */
export function evictCachedTransport(transport: HyperTransport): void {
  for (const entries of transportEntries.get(transport) ?? []) {
    for (const [protocol, cached] of entries) {
      if (cached === transport) entries.delete(protocol);
    }
  }
  transportEntries.delete(transport);
}

/**
 * @ru Очищает кэш транспортов и ожидающих их разрешений. Не закрывает уже
 * созданные экземпляры транспорта.
 * @en Clears cached transports and pending resolutions. It does not close
 * already-created transport instances.
 */
export function resetCachedTransport(): void {
  transportCaches = new WeakMap();
  transportEntries = new WeakMap();
}
