import type {
  AnyHyperProtocol,
  HyperProtocol,
  HyperReceiver,
  HyperSender,
  SenderProtocol,
} from "@hyperttp/types";
import { HyperClientError } from "../utils/errors.js";
import { dynamicImport, isModuleNotFoundError } from "../utils/modules.js";
import { RestProtocol } from "./rest/index.js";

type ProtocolDef = {
  readonly protocol: SenderProtocol;
  readonly pkg: string;
  readonly export: string;
};

const PROTOCOL_DEFS: readonly ProtocolDef[] = [
  {
    protocol: "graphql",
    pkg: "@hyperttp/protocol-graphql",
    export: "GraphQLProtocol",
  },
  { protocol: "grpc", pkg: "@hyperttp/protocol-grpc", export: "GrpcProtocol" },
  { protocol: "trpc", pkg: "@hyperttp/protocol-trpc", export: "TrpcProtocol" },
  {
    protocol: "ws",
    pkg: "@hyperttp/protocol-websocket",
    export: "WebSocketProtocol",
  },
  {
    protocol: "websocket",
    pkg: "@hyperttp/protocol-websocket",
    export: "WebSocketProtocol",
  },
  { protocol: "sse", pkg: "@hyperttp/protocol-sse", export: "SseProtocol" },
  { protocol: "mqtt", pkg: "@hyperttp/protocol-mqtt", export: "MqttProtocol" },
  { protocol: "webrtc", pkg: "@hyperttp/protocol-webrtc", export: "WebRtcProtocol" },
];

/**
 * @ru Известные протоколы ядра: встроенный rest и пакетные модули.
 * @en Known core protocols: the built-in rest and packaged modules.
 */
export const KNOWN_PROTOCOLS: readonly SenderProtocol[] = Object.freeze([
  "rest",
  ...PROTOCOL_DEFS.map((d) => d.protocol),
]);

const protocolCache = new Map<string, AnyHyperProtocol>();
const pendingProtocols = new Map<string, Promise<AnyHyperProtocol>>();
let cacheGeneration = 0;

/**
 * @ru Разрешает модуль протокола. Встроенный rest возвращается статически,
 * остальные протоколы загружаются из пакетных модулей по требованию.
 * @en Resolves a protocol module. The built-in rest is returned statically,
 * other protocols are loaded from packaged modules on demand.
 */
export async function resolveProtocol<P extends SenderProtocol>(
  protocol: P,
  options?: { [key: string]: unknown },
): Promise<HyperProtocol<unknown, unknown, unknown, unknown, P>> {
  const cached = protocolCache.get(protocol);
  if (cached) {
    return cached as AnyHyperProtocol<P>;
  }

  if (protocol === "rest") {
    protocolCache.set(protocol, RestProtocol);
    return RestProtocol as AnyHyperProtocol<P>;
  }

  const pending = pendingProtocols.get(protocol);
  if (pending) return (await pending) as AnyHyperProtocol<P>;

  const generation = cacheGeneration;
  const resolution = loadProtocol(protocol, options)
    .then((instance) => {
      if (generation === cacheGeneration) protocolCache.set(protocol, instance);
      return instance;
    })
    .finally(() => {
      // A pre-reset resolution must not remove a newer pending load.
      if (pendingProtocols.get(protocol) === resolution) pendingProtocols.delete(protocol);
    });
  pendingProtocols.set(protocol, resolution);
  return (await resolution) as AnyHyperProtocol<P>;
}

async function loadProtocol(
  protocol: SenderProtocol,
  options?: { [key: string]: unknown },
): Promise<AnyHyperProtocol> {
  for (let i = 0; i < PROTOCOL_DEFS.length; i++) {
    const def = PROTOCOL_DEFS[i]!;
    if (def.protocol !== protocol) continue;

    try {
      const mod = await dynamicImport(def.pkg);
      const candidate = (mod[def.export] ?? mod.default) as
        | { new (opts?: unknown): AnyHyperProtocol }
        | AnyHyperProtocol
        | undefined;
      const instance =
        typeof candidate === "function" ? new candidate(options) : (candidate as AnyHyperProtocol);

      if (!instance || typeof instance.protocol !== "string") continue;

      return instance;
    } catch (err) {
      if (!isModuleNotFoundError(err)) throw err;
    }
  }

  const pkgDef = PROTOCOL_DEFS.find((d) => d.protocol === protocol);
  const hint = pkgDef ? ` Did you forget to install "${pkgDef.pkg}"?` : "";

  throw new HyperClientError(`[HyperCore] No protocol available for "${protocol}".${hint}`);
}

/**
 * @ru Разрешает клиентский сендер протокола.
 * @en Resolves the client sender of a protocol.
 */
export async function resolveSender<P extends SenderProtocol>(
  protocol: P,
  options?: { [key: string]: unknown },
): Promise<HyperSender<unknown, unknown, unknown, unknown, P>> {
  const resolved = await resolveProtocol(protocol, options);
  if (!resolved.sender) {
    throw new HyperClientError(`[HyperCore] Protocol "${protocol}" has no sender (client role).`);
  }
  return resolved.sender;
}

/**
 * @ru Разрешает серверный ресивер протокола.
 * @en Resolves the server receiver of a protocol.
 */
export async function resolveReceiver<P extends SenderProtocol>(
  protocol: P,
  options?: { [key: string]: unknown },
): Promise<HyperReceiver<unknown, unknown, unknown, unknown, P>> {
  const resolved = await resolveProtocol(protocol, options);
  if (!resolved.receiver) {
    throw new HyperClientError(`[HyperCore] Protocol "${protocol}" has no receiver (server role).`);
  }
  return resolved.receiver;
}

/**
 * @ru Очищает кэш загруженных модулей протоколов. Не выгружает уже импортированные
 * JavaScript-модули из runtime.
 * @en Clears the loaded protocol-module cache. It does not unload JavaScript
 * modules already imported by the runtime.
 */
export function resetCachedProtocols(): void {
  cacheGeneration++;
  protocolCache.clear();
  pendingProtocols.clear();
}
