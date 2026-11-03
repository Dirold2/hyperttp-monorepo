import type { RequestContext, SendRequest } from "@hyperttp/types";
import { describe, expect, it, vi } from "vitest";
import { withSerializer } from "../src/index.js";

type RestInput = {
  body?: unknown;
  headers?: Record<string, string | string[]>;
};

function context(): RequestContext {
  return {
    requestId: "request-id",
    startTime: performance.now(),
    meta: {},
    state: {},
  };
}

async function serializeRest(input: RestInput): Promise<SendRequest<RestInput> | void> {
  const plugin = withSerializer<RestInput>();
  return plugin.onRequest?.({ protocol: "rest", input }) as
    | SendRequest<RestInput>
    | void
    | Promise<SendRequest<RestInput> | void>;
}

describe("withSerializer", () => {
  it("runs in the FORMAT phase in blocking mode", () => {
    const plugin = withSerializer();

    expect(plugin.name).toBe("hyperttp-serializer");
    expect(plugin.phase).toBe("FORMAT");
    expect(plugin.mode).toBe("blocking");
    expect(plugin.enabled?.({})).toBe(true);
  });
  it("serializes REST input.body as JSON and adds the default header", async () => {
    const input: RestInput = { body: { name: "Ada" }, headers: { accept: "application/json" } };
    const result = await serializeRest(input);

    expect(result?.input).toEqual({
      body: '{"name":"Ada"}',
      headers: { accept: "application/json", "content-type": "application/json" },
    });
    expect(input.body).toEqual({ name: "Ada" });
    expect(result?.metadata?.timings).toMatchObject({ serializationMs: expect.any(Number) });
  });

  it("preserves REST form serialization based on headers", async () => {
    const result = await serializeRest({
      body: { query: "hello world", page: "2" },
      headers: { "Content-Type": "application/x-www-form-urlencoded; charset=utf-8" },
    });

    expect(result?.input.body).toBe("query=hello+world&page=2");
    expect(result?.input.headers).toEqual({
      "Content-Type": "application/x-www-form-urlencoded; charset=utf-8",
    });
  });

  it("does not serialize non-REST requests or already serialized REST bodies by default", async () => {
    const plugin = withSerializer();

    expect(
      await plugin.onRequest?.({ protocol: "rpc", input: { body: { value: 1 } } }),
    ).toBeUndefined();
    expect(
      await plugin.onRequest?.({ protocol: "rest", input: { body: "already serialized" } }),
    ).toBeUndefined();
  });

  it("supports protocol-neutral body callbacks", async () => {
    type RpcInput = { payload: unknown; encoding?: string };
    const requestCtx = context();
    const shouldSerialize = vi.fn(
      (request: SendRequest<RpcInput>, ctx?: RequestContext): boolean => {
        expect(ctx).toBe(requestCtx);
        return request.protocol === "rpc";
      },
    );
    const getBody = vi.fn((request: SendRequest<RpcInput>) => request.input.payload);
    const serialize = vi.fn((body: unknown) => `encoded:${JSON.stringify(body)}`);
    const setBody = vi.fn(
      (request: SendRequest<RpcInput>, body: string): SendRequest<RpcInput> => ({
        ...request,
        input: { ...request.input, payload: body, encoding: "custom" },
      }),
    );
    const plugin = withSerializer<RpcInput, string>({
      shouldSerialize,
      getBody,
      serialize,
      setBody,
    });
    const request: SendRequest<RpcInput> = {
      protocol: "rpc",
      input: { payload: { id: 3 } },
    };

    const result = await plugin.onRequest?.(request, undefined, requestCtx);

    expect(result && "input" in result ? result.input : undefined).toEqual({
      payload: 'encoded:{"id":3}',
      encoding: "custom",
    });
    expect(shouldSerialize).toHaveBeenCalledWith(request, requestCtx);
    expect(getBody).toHaveBeenCalledWith(request, requestCtx);
    expect(serialize).toHaveBeenCalledWith({ id: 3 }, request, requestCtx);
    expect(setBody).toHaveBeenCalledWith(request, 'encoded:{"id":3}', requestCtx);
    expect(requestCtx.meta.serializationMs).toEqual(expect.any(Number));
  });

  it("keeps metadata returned by a custom setBody callback", async () => {
    type Input = { value: unknown };
    const plugin = withSerializer<Input, string>({
      shouldSerialize: () => true,
      getBody: (request) => request.input.value,
      serialize: String,
      setBody: (request, body) => ({
        ...request,
        input: { value: body },
        metadata: { source: "custom", timings: { beforeMs: 1 } },
      }),
    });

    const result = await plugin.onRequest?.({ protocol: "custom", input: { value: 42 } });

    expect(result && "metadata" in result ? result.metadata : undefined).toMatchObject({
      source: "custom",
      timings: { beforeMs: 1, serializationMs: expect.any(Number) },
    });
  });
});
