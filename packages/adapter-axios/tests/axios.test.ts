import type { IHyperCore, SendRequest, UniversalResponse } from "@hyperttp/types";
import type { RestClientMethods } from "@hyperttp/core/rest";
import { AxiosError } from "axios";
import { describe, expect, it, vi } from "vitest";
import { axios, createAxios } from "../src/index.js";

interface RecordedRequest {
  method: string;
  url: string;
  options: Parameters<RestClientMethods["request"]>[2];
}

function createCore(responseData: unknown = { ok: true }, status = 200): {
  core: IHyperCore;
  requests: RecordedRequest[];
} {
  const requests: RecordedRequest[] = [];
  const rest: Pick<RestClientMethods, "request"> = {
    request: vi.fn(
      async <T = unknown>(
        method: Parameters<RestClientMethods["request"]>[0],
        url: Parameters<RestClientMethods["request"]>[1],
        options: Parameters<RestClientMethods["request"]>[2],
        _signal: Parameters<RestClientMethods["request"]>[3],
      ): Promise<UniversalResponse<T>> => {
        requests.push({ method, url, options });

        return {
          protocol: "rest",
          ok: true,
          status,
          statusText: status === 200 ? "OK" : "Error",
          headers: { "content-type": "application/json" },
          url,
          data: responseData as T,
        };
      },
    ) as unknown as RestClientMethods["request"],
  };

  return {
    core: { rest } as IHyperCore,
    requests,
  };
}

function createResponseTypeCore(data: unknown): IHyperCore {
  const send = vi.fn(async (request: SendRequest) => {
    const responseType = request.metadata?.responseType;
    const responseData = responseType === "stream"
      ? (async function* () {
          yield new Uint8Array([1, 2]);
          await Promise.resolve();
          yield new Uint8Array([3, 4]);
        })()
      : data;

    return {
      protocol: "rest",
      ok: true,
      status: 200,
      statusText: "OK",
      headers: {
        "content-type": responseType === "text" ? "text/plain" : "application/octet-stream",
      },
      url: String(request.input && typeof request.input === "object" && "url" in request.input
        ? request.input.url
        : ""),
      data: responseData,
    } satisfies UniversalResponse<unknown>;
  });

  return { send } as unknown as IHyperCore;
}
function createRejectingCore(error: Error): IHyperCore {
  const rest: Pick<RestClientMethods, "request"> = {
    request: vi.fn(async () => {
      throw error;
    }),
  };

  return { rest } as IHyperCore;
}

describe("Axios-compatible Hyperttp client", () => {
  it("exports a ready-to-use Axios-compatible client", () => {
    expect(axios).toSatisfy((client) => typeof client === "function");
    expect(axios.defaults.adapter).toSatisfy((adapter) => typeof adapter === "function");
    expect(axios.interceptors.request.use).toBeTypeOf("function");
    expect(axios.interceptors.response.use).toBeTypeOf("function");
    expect(axios.get).toBeTypeOf("function");
    expect(axios.post).toBeTypeOf("function");
    expect(axios.put).toBeTypeOf("function");
    expect(axios.patch).toBeTypeOf("function");
    expect(axios.delete).toBeTypeOf("function");
  });

  it("supports the callable Axios API and returns an Axios response", async () => {
    const { core, requests } = createCore({ id: 42 });
    const axios = createAxios(core, { baseURL: "https://api.example.test" });

    const response = await axios<{ id: number }>("/users/42");

    expect(response).toMatchObject({
      data: { id: 42 },
      status: 200,
      statusText: "OK",
      headers: { "content-type": "application/json" },
    });
    expect(requests).toEqual([
      expect.objectContaining({
        method: "GET",
        url: "https://api.example.test/users/42",
      }),
    ]);
  });

  it("rejects 4xx responses with an AxiosError response", async () => {
    const { core } = createCore({ message: "not found" }, 404);
    const client = createAxios(core);

    const error = await client.get("/users/404").catch((reason: unknown) => reason);

    expect(error).toBeInstanceOf(AxiosError);
    expect(error).toMatchObject({
      code: AxiosError.ERR_BAD_REQUEST,
      response: expect.objectContaining({
        status: 404,
        data: { message: "not found" },
      }),
    });
  });

  it("rejects 5xx responses with an AxiosError response", async () => {
    const { core } = createCore({ message: "unavailable" }, 500);
    const client = createAxios(core);

    const error = await client.get("/health").catch((reason: unknown) => reason);

    expect(error).toBeInstanceOf(AxiosError);
    expect(error).toMatchObject({
      code: AxiosError.ERR_BAD_RESPONSE,
      response: expect.objectContaining({ status: 500 }),
    });
  });

  it("resolves a 4xx response when validateStatus allows it", async () => {
    const { core } = createCore({ message: "not found" }, 404);
    const client = createAxios(core);

    const response = await client.get("/users/404", {
      validateStatus: (status) => status === 404,
    });

    expect(response.status).toBe(404);
    expect(response.data).toEqual({ message: "not found" });
  });

  it("rejects a successful response when validateStatus disallows it", async () => {
    const { core } = createCore({ ok: true }, 200);
    const client = createAxios(core);

    await expect(
      client.get("/health", { validateStatus: () => false }),
    ).rejects.toMatchObject({
      code: AxiosError.ERR_BAD_RESPONSE,
      response: expect.objectContaining({ status: 200 }),
    });
  });
  it("passes Axios timeout to Hyperttp", async () => {
    const { core, requests } = createCore();
    const client = createAxios(core);

    await client.get("/slow", { timeout: 250 });

    expect(requests[0]?.options?.timeout).toBe(250);
  });

  it("passes AbortSignal to Hyperttp and returns Axios cancellation", async () => {
    const controller = new AbortController();
    let receivedSignal: AbortSignal | undefined;
    const rest: Pick<RestClientMethods, "request"> = {
      request: vi.fn(async (_method, _url, options, signal) => {
        receivedSignal = signal;
        await new Promise<never>((_resolve, reject) => {
          signal?.addEventListener("abort", () => reject(new Error("aborted")), {
            once: true,
          });
        });
        return undefined as never;
      }),
    };
    const client = createAxios({ rest } as IHyperCore);

    const promise = client.get("/slow", { signal: controller.signal });
    await Promise.resolve();
    controller.abort();
    const error = await promise.catch((reason: unknown) => reason);

    expect(receivedSignal).toBe(controller.signal);
    expect(error).toMatchObject({
      code: "ERR_CANCELED",
      __CANCEL__: true,
    });
  });

  it("propagates Hyperttp transport errors unchanged", async () => {
    const transportError = new Error("socket failure");
    const error = await createAxios(createRejectingCore(transportError))
      .get("/unavailable")
      .catch((reason: unknown) => reason);

    expect(error).toBe(transportError);
  });
  it("supports responseType text, json, and arraybuffer", async () => {
    const text = await createAxios(createResponseTypeCore("hello"))
      .get("/text", { responseType: "text" });
    expect(text.data).toBe("hello");

    const json = await createAxios(createResponseTypeCore({ ok: true }))
      .get("/json", { responseType: "json" });
    expect(json.data).toEqual({ ok: true });

    const binary = await createAxios(
      createResponseTypeCore(new Uint8Array([0, 1, 255]).subarray(1)),
    ).get("/binary", { responseType: "arraybuffer" });
    expect(binary.data).toBeInstanceOf(ArrayBuffer);
    expect(Array.from(new Uint8Array(binary.data))).toEqual([1, 255]);
  });

  it("maps Hyperttp async-iterable streams to a Node readable stream", async () => {
    const response = await createAxios(createResponseTypeCore(null)).get("/stream", {
      responseType: "stream",
    });

    expect(response.data).toHaveProperty("pipe");
    const chunks: number[] = [];
    for await (const chunk of response.data as AsyncIterable<Uint8Array>) {
      chunks.push(...chunk);
    }
    expect(chunks).toEqual([1, 2, 3, 4]);
  });
  it("supports Axios convenience methods, headers, params, and request data", async () => {
    const { core, requests } = createCore();
    const axios = createAxios(core);

    await axios.post(
      "https://api.example.test/users",
      { name: "Ada" },
      {
        headers: { Authorization: "Bearer token" },
        params: { page: 2 },
      },
    );

    expect(requests).toHaveLength(1);
    expect(requests[0]).toMatchObject({
      method: "POST",
      url: "https://api.example.test/users",
      options: {
        headers: expect.objectContaining({
          Authorization: "Bearer token",
        }),
        query: { page: 2 },
        body: JSON.stringify({ name: "Ada" }),
      },
    });
  });

  it("runs Axios request and response interceptors", async () => {
    const { core, requests } = createCore({ id: 7 });
    const axios = createAxios(core);

    axios.interceptors.request.use((config) => {
      config.headers.set("x-request-id", "request-1");
      return config;
    });
    axios.interceptors.response.use((response) => ({
      ...response,
      data: { ...response.data, intercepted: true },
    }));

    const response = await axios.get<{ id: number; intercepted: boolean }>(
      "https://api.example.test/users/7",
    );

    expect(requests[0]?.options?.headers).toMatchObject({
      "x-request-id": "request-1",
    });
    expect(response.data).toEqual({ id: 7, intercepted: true });
  });
});
