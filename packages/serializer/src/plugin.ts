import type { HyperPlugin, RequestContext, SendRequest } from "@hyperttp/types";

type RestHeaders = Record<string, string | string[]>;
type RestInput = Record<string, unknown> & {
  body?: unknown;
  headers?: RestHeaders;
};

export interface SerializerOptions<TInput = unknown, TSerialized = unknown> {
  shouldSerialize?: (request: SendRequest<TInput>, ctx?: RequestContext) => boolean;
  getBody?: (request: SendRequest<TInput>, ctx?: RequestContext) => unknown;
  setBody?: (
    request: SendRequest<TInput>,
    body: TSerialized,
    ctx?: RequestContext,
  ) => SendRequest<TInput>;
  serialize?: (body: unknown, request: SendRequest<TInput>, ctx?: RequestContext) => TSerialized;
}

export interface SerializableRequest extends SendRequest<RestInput, "rest"> {}

declare module "@hyperttp/types" {
  interface HyperClientOptions {
    serializer?: SerializerOptions;
  }
}

function restInput<TInput>(request: SendRequest<TInput>): RestInput {
  return request.input !== null && typeof request.input === "object"
    ? (request.input as RestInput)
    : {};
}

function getHeader(headers: RestHeaders, name: string): string | undefined {
  const key = Object.keys(headers).find((candidate) => candidate.toLowerCase() === name);
  const value = key ? headers[key] : undefined;
  return Array.isArray(value) ? value[0] : value;
}

function isSerializableObject(body: unknown): body is Record<string, unknown> {
  return (
    typeof body === "object" &&
    body !== null &&
    !(body instanceof Uint8Array) &&
    !(body instanceof ArrayBuffer) &&
    !(typeof URLSearchParams !== "undefined" && body instanceof URLSearchParams) &&
    !(typeof FormData !== "undefined" && body instanceof FormData) &&
    !(typeof Blob !== "undefined" && body instanceof Blob) &&
    !("pipe" in body && typeof body.pipe === "function")
  );
}

function defaultGetBody<TInput>(request: SendRequest<TInput>): unknown {
  return request.protocol === "rest" ? restInput(request).body : undefined;
}

function defaultShouldSerialize<TInput>(request: SendRequest<TInput>): boolean {
  return request.protocol === "rest" && isSerializableObject(defaultGetBody(request));
}

function defaultSerialize<TInput>(body: unknown, request: SendRequest<TInput>): unknown {
  const contentType = getHeader(restInput(request).headers ?? {}, "content-type");
  if (!contentType || contentType.includes("application/json")) return JSON.stringify(body);
  if (contentType.includes("application/x-www-form-urlencoded")) {
    return new URLSearchParams(body as Record<string, string>).toString();
  }
  return body;
}

function defaultSetBody<TInput>(request: SendRequest<TInput>, body: unknown): SendRequest<TInput> {
  const input = restInput(request);
  const headers = { ...input.headers };
  const contentType = getHeader(headers, "content-type");
  if (!contentType || contentType.includes("application/json")) {
    headers["content-type"] = "application/json";
  }

  return {
    ...request,
    input: { ...input, headers, body } as TInput,
  };
}

export function withSerializer<TInput = unknown, TSerialized = unknown>(
  options: SerializerOptions<TInput, TSerialized> = {},
): HyperPlugin<TInput> {
  const shouldSerialize = options.shouldSerialize ?? defaultShouldSerialize;
  const getBody = options.getBody ?? defaultGetBody;
  const serialize = options.serialize ?? defaultSerialize;
  const setBody = options.setBody ?? defaultSetBody;

  return {
    name: "hyperttp-serializer",
    phase: "FORMAT",
    mode: "blocking",
    enabled: () => true,
    onRequest(request, _pluginCtx, requestCtx): SendRequest<TInput> | void {
      if (!shouldSerialize(request, requestCtx)) return;

      const start = performance.now();
      const serializedBody = serialize(getBody(request, requestCtx), request, requestCtx);
      const updatedRequest = setBody(request, serializedBody as TSerialized, requestCtx);
      const serializationMs = performance.now() - start;
      const metadata = {
        ...updatedRequest.metadata,
        timings: {
          ...((updatedRequest.metadata as Record<string, unknown> | undefined)?.timings as
            | object
            | undefined),
          serializationMs,
        },
      };
      if (requestCtx) requestCtx.meta.serializationMs = serializationMs;

      return { ...updatedRequest, metadata };
    },
  };
}
