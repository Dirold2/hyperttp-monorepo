import type { SendRequest } from "@hyperttp/types";
import type { AuthCredentials, AuthPluginOptions, ValueProvider } from "./types.js";

/** Key used to expose a non-secret credential identity to cache/inflight plugins. */
export const AUTH_IDENTITY_STATE_KEY = "@hyperttp/auth.identity";

export interface ResolvedAuthOptions {
  readonly credentials?: AuthCredentials;
  readonly identityProvider?: ValueProvider;
}

export function resolveAuthOptions(options: AuthPluginOptions): ResolvedAuthOptions {
  const credentials = options.rest ?? options.credentials ?? options.bearer;
  return {
    credentials,
    identityProvider: options.getCacheKey ?? credentials?.getCacheKey,
  };
}

export function assertAuthConfiguration(options: AuthPluginOptions): void {
  const { credentials } = resolveAuthOptions(options);
  if (!credentials && !options.apply) {
    throw new TypeError("withAuth requires credentials, rest, bearer, or apply");
  }
  if (credentials && options.protocol && options.protocol !== "rest") {
    throw new TypeError("Built-in credentials support REST only; use apply for other protocols");
  }
  if (credentials && !options.allowedOrigins?.length) {
    throw new TypeError("Built-in credentials require a non-empty allowedOrigins list");
  }
}

export async function applyCredentials(
  request: SendRequest,
  credentials: AuthCredentials,
): Promise<SendRequest> {
  switch (credentials.type) {
    case "basic": {
      const username = await resolveValue(credentials.username);
      const password = await credentials.getPassword();
      if (!username || password == null) return request;
      return withHeader(
        request,
        "authorization",
        `Basic ${encodeBase64(`${username}:${password}`)}`,
      );
    }
    case "api-key": {
      const value = await credentials.getValue();
      if (!value) return request;
      if ("location" in credentials && credentials.location === "query") {
        return withQueryParameter(request, credentials.name, value);
      }
      return withHeader(request, credentials.name, value);
    }
    case "bearer":
    default: {
      const token = await credentials.getToken();
      return token ? withHeader(request, "authorization", `Bearer ${token}`) : request;
    }
  }
}

async function resolveValue(value: string | ValueProvider): Promise<string | null | undefined> {
  return typeof value === "function" ? value() : value;
}

function withHeader(request: SendRequest, name: string, value: string): SendRequest {
  if (!isRecord(request.input)) return request;

  const headers = cloneHeaders(request.input.headers);
  for (const headerName of Object.keys(headers)) {
    if (headerName.toLowerCase() === name.toLowerCase()) {
      delete headers[headerName];
    }
  }
  headers[name] = value;

  return {
    ...request,
    input: { ...request.input, headers },
  };
}

function withQueryParameter(request: SendRequest, name: string, value: string): SendRequest {
  if (!isRecord(request.input) || typeof request.input.url !== "string") return request;

  const url = request.input.url;
  const hashIndex = url.indexOf("#");
  const fragment = hashIndex < 0 ? "" : url.slice(hashIndex);
  const target = hashIndex < 0 ? url : url.slice(0, hashIndex);
  const queryIndex = target.indexOf("?");
  const path = queryIndex < 0 ? target : target.slice(0, queryIndex);
  const query = new URLSearchParams(queryIndex < 0 ? "" : target.slice(queryIndex + 1));
  query.set(name, value);

  return {
    ...request,
    input: {
      ...request.input,
      url: `${path}?${query}${fragment}`,
    },
  };
}

function cloneHeaders(value: unknown): Record<string, string> {
  const headers: Record<string, string> = {};

  if (typeof Headers !== "undefined" && value instanceof Headers) {
    value.forEach((headerValue, name) => {
      headers[name] = headerValue;
    });
    return headers;
  }

  if (Array.isArray(value)) {
    for (const header of value) {
      if (Array.isArray(header) && typeof header[0] === "string" && typeof header[1] === "string") {
        headers[header[0]] = header[1];
      }
    }
    return headers;
  }

  if (!isRecord(value)) return headers;

  for (const [name, headerValue] of Object.entries(value)) {
    if (headerValue != null) headers[name] = String(headerValue);
  }
  return headers;
}

export function normalizeOrigins(
  origins: readonly string[] | undefined,
): ReadonlySet<string> | undefined {
  if (!origins) return undefined;

  const normalized = new Set<string>();
  for (const origin of origins) {
    try {
      const parsed = new URL(origin);
      if (
        !["http:", "https:"].includes(parsed.protocol) ||
        parsed.username ||
        parsed.password ||
        parsed.pathname !== "/" ||
        parsed.search ||
        parsed.hash
      ) {
        throw new TypeError("Expected an HTTP(S) origin");
      }
      normalized.add(parsed.origin);
    } catch {
      throw new TypeError(`Invalid allowed origin: ${origin}`);
    }
  }
  return normalized;
}

export function isAllowedOrigin(
  request: SendRequest,
  allowedOrigins: ReadonlySet<string> | undefined,
): boolean {
  if (!allowedOrigins) return true;
  if (!isRecord(request.input) || typeof request.input.url !== "string") return false;

  try {
    return allowedOrigins.has(new URL(request.input.url).origin);
  } catch {
    return false;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function encodeBase64(value: string): string {
  const binary = Array.from(new TextEncoder().encode(value), (byte) =>
    String.fromCharCode(byte),
  ).join("");
  if (typeof btoa === "function") return btoa(binary);

  const nodeBuffer = (
    globalThis as {
      Buffer?: { from(value: string, encoding: string): { toString(encoding: string): string } };
    }
  ).Buffer;
  if (nodeBuffer) return nodeBuffer.from(value, "utf8").toString("base64");
  throw new Error("Basic authentication requires a base64 encoder in this runtime");
}
