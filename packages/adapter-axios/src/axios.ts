import axiosFactory, {
  AxiosError,
  type AxiosAdapter,
  type AxiosInstance,
  type AxiosRequestConfig,
  type AxiosStatic,
  type AxiosResponse,
  type InternalAxiosRequestConfig,
} from "axios";
import { HyperClient } from "hyperttp";
import type { HttpMethod, RestClientMethods, RestRequestOptions } from "@hyperttp/core/rest";
import type { HyperAdapter, IHyperCore, SendRequest, UniversalResponse } from "@hyperttp/types";
import type { HyperAxiosConfig } from "./types/index.js";

const responseTypeMap = {
  json: "json",
  text: "text",
  arraybuffer: "buffer",
  stream: "stream",
} as const;

/**
 * Creates an Axios-compatible client backed by a Hyperttp core instance.
 *
 * Axios keeps its normal request/response transforms, interceptors, cancellation,
 * status validation, and convenience methods; only the network adapter is replaced.
 */
export function createAxios(
  core: IHyperCore,
  config?: HyperAxiosConfig,
): AxiosInstance {
  const instanceConfig: AxiosRequestConfig = {
    ...config,
    adapter: createHyperttpAdapter(core),
  };

  return axiosFactory.create(instanceConfig);
}

/** Axios adapter descriptor for use with the generic HyperAdapter contract. */
export const adapter: HyperAdapter<AxiosStatic> = {
  name: "axios",
  version: "1.x",
  adapt(core): AxiosStatic {
    return createAxios(core) as AxiosStatic;
  },
};

/** A ready-to-use Axios-compatible client using a default Hyperttp core. */
export const axios = createAxios(new HyperClient() as unknown as IHyperCore);

export default axios;

function createHyperttpAdapter(core: IHyperCore): AxiosAdapter {
  const rest = (core as IHyperCore & { readonly rest: RestClientMethods }).rest;

  return async (config: InternalAxiosRequestConfig) => {
    const url = resolveUrl(config.baseURL, config.url ?? "");
    const options: RestRequestOptions = {
      headers: toHeaders(config.headers),
      query: config.params as RestRequestOptions["query"],
      body: config.data,
      timeout: config.timeout,
      signal: config.signal as AbortSignal | undefined,
    };

    const requestInput: RestRequestOptions & {
      method: HttpMethod;
      url: string;
      stream?: boolean;
    } = {
      ...options,
      method: (config.method ?? "get").toUpperCase() as HttpMethod,
      url,
      ...(config.responseType === "stream" ? { stream: true } : {}),
    };

    const response: UniversalResponse<unknown> =
      config.responseType && config.responseType in responseTypeMap
        ? await executeWithResponseType(core, requestInput, config.responseType)
        : await rest.request(
            requestInput.method,
            requestInput.url,
            options,
            config.signal as AbortSignal | undefined,
          );

    const responseData = await mapResponseData(
      response.data,
      config.responseType,
    );
    const axiosResponse: AxiosResponse = {
      data: responseData,
      status: response.status,
      statusText: response.statusText ?? "",
      headers: response.headers,
      config,
    };

    if (config.validateStatus && !config.validateStatus(axiosResponse.status)) {
      throw new AxiosError(
        `Request failed with status code ${axiosResponse.status}`,
        axiosResponse.status >= 400 && axiosResponse.status < 500
          ? AxiosError.ERR_BAD_REQUEST
          : AxiosError.ERR_BAD_RESPONSE,
        config,
        undefined,
        axiosResponse,
      );
    }

    return axiosResponse;
  };
}

function executeWithResponseType(
  core: IHyperCore,
  input: RestRequestOptions & { method: HttpMethod; url: string; stream?: boolean },
  responseType: string,
): Promise<UniversalResponse<unknown>> {
  if (typeof core.send !== "function") {
    const rest = (core as IHyperCore & { readonly rest: RestClientMethods }).rest;
    return rest.request(
      input.method,
      input.url,
      input,
      input.signal,
    ) as Promise<UniversalResponse<unknown>>;
  }

  const request: SendRequest = {
    protocol: "rest",
    input,
    signal: input.signal,
    metadata: { responseType },
  };

  return core.send(request) as Promise<UniversalResponse<unknown>>;
}

async function mapResponseData(
  data: unknown,
  responseType: InternalAxiosRequestConfig["responseType"],
): Promise<unknown> {
  switch (responseType) {
    case "text":
      return typeof data === "string" ? data : bytesToText(data);
    case "arraybuffer":
      return toArrayBuffer(data);
    case "stream":
      return toNodeReadable(data);
    default:
      return data;
  }
}

function toArrayBuffer(data: unknown): ArrayBuffer {
  if (data instanceof ArrayBuffer) return data.slice(0);
  if (ArrayBuffer.isView(data)) {
    const bytes = new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
    return bytes.slice().buffer;
  }
  throw new TypeError("Hyperttp did not return binary response data");
}

function bytesToText(data: unknown): string {
  if (typeof data === "string") return data;
  if (data instanceof ArrayBuffer) return new TextDecoder().decode(data);
  if (ArrayBuffer.isView(data)) {
    return new TextDecoder().decode(
      new Uint8Array(data.buffer, data.byteOffset, data.byteLength),
    );
  }
  return String(data);
}

async function toNodeReadable(data: unknown): Promise<unknown> {
  if (data && typeof data === "object" && "pipe" in data) return data;
  if (!data || typeof data !== "object" || !(Symbol.asyncIterator in data)) {
    throw new TypeError("Hyperttp did not return a streaming response");
  }

  const { Readable } = await import("node:stream");
  return Readable.from(data as AsyncIterable<Uint8Array>);
}

function resolveUrl(baseURL: string | undefined, url: string): string {
  if (!baseURL || isAbsoluteUrl(url)) return url;
  return new URL(url, baseURL).toString();
}

function isAbsoluteUrl(url: string): boolean {
  return /^[a-z][a-z\d+.-]*:/i.test(url) || url.startsWith("//");
}

function toHeaders(
  headers: InternalAxiosRequestConfig["headers"],
): Record<string, string> {
  const raw = headers?.toJSON?.() ?? headers;
  const result: Record<string, string> = {};

  if (!raw || typeof raw !== "object") return result;

  for (const [name, value] of Object.entries(raw)) {
    if (typeof value === "string") {
      result[name] = value;
    } else if (Array.isArray(value)) {
      result[name] = value.join(", ");
    } else if (value !== undefined && value !== null) {
      result[name] = String(value);
    }
  }

  return result;
}
