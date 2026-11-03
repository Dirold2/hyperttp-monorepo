import type { TransportRequest } from "@hyperttp/types";
import { BunTransport } from "../../src/index.js";
import type { BunTransportConfig } from "../../src/types/index.js";

export const BASE_URL = "http://127.0.0.1:3000";
export const COOKIE_BASE_URL = "http://localhost:3000";

type MockFetch = (
  input: RequestInfo | URL,
  init?: RequestInit | BunFetchRequestInit,
) => Promise<Response>;

export const defaultOptions: BunTransportConfig = {
  network: {
    timeout: 5000,
    rejectUnauthorized: true,
  },
};

export function createTransport(
  network: BunTransportConfig["network"] = defaultOptions.network,
) {
  return new BunTransport({ network });
}

export function createRequest(
  url: string,
  method = "GET",
  headers: TransportRequest["headers"] = {},
  body: BodyInit | null = null,
  signal: AbortSignal = new AbortController().signal,
): TransportRequest {
  return { url, method, headers, body, signal, protocol: "rest" };
}

export async function withMockedFetch<T>(
  impl: MockFetch,
  fn: () => Promise<T>,
): Promise<T> {
  const originalFetch = globalThis.fetch;

  globalThis.fetch = impl as unknown as typeof fetch;

  try {
    return await fn();
  } finally {
    globalThis.fetch = originalFetch;
  }
}
