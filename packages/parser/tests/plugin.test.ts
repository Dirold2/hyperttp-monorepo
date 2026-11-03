import type {
  PluginContext,
  RequestContext,
  SendRequest,
  UniversalResponse,
} from "@hyperttp/types";
import { describe, expect, it, vi } from "vitest";
import { ResponseConverter, withParser } from "../src/index.js";

function setup(options: Parameters<typeof withParser>[0] = {}) {
  const plugin = withParser(options);
  plugin.setup?.({ config: {}, core: {} } as unknown as PluginContext);
  return plugin;
}

function response(
  overrides: Partial<UniversalResponse> = {},
): UniversalResponse {
  return {
    protocol: "rest",
    ok: true,
    status: 200,
    headers: {},
    data: "body",
    ...overrides,
  };
}

const restRequest: SendRequest = {
  protocol: "rest",
  input: { method: "GET" },
};

const requestContext: RequestContext = {
  requestId: "test",
  startTime: 0,
  meta: {},
  state: {},
};

describe("protocol-neutral parser callbacks", () => {
  it("extracts and detects custom-protocol payloads without mutating the response", async () => {
    const shouldParse = vi.fn(() => true);
    const original = response({
      protocol: "rpc",
      status: 204,
      headers: {},
      data: { untouched: true },
      metadata: { payload: '{"value":42}' },
    });
    const plugin = setup({
      shouldParse,
      getData: (res) => res.metadata?.payload,
      getResponseType: () => "json",
    });
    const request: SendRequest = { protocol: "rpc", input: { operation: "read" } };

    const parsed = await plugin.onResponse?.(original, request, undefined, requestContext);

    expect(parsed).toEqual({ ...original, data: { value: 42 } });
    expect(parsed).not.toBe(original);
    expect(original.data).toEqual({ untouched: true });
    expect(shouldParse).toHaveBeenCalledWith(original, request, requestContext);
  });

  it("supports bodyExtractor and custom empty-response predicates", async () => {
    const original = response({ protocol: "rpc", status: 7, data: "preserved" });
    const plugin = setup({
      bodyExtractor: () => "ignored",
      isEmptyResponse: (res) => res.status === 7,
    });

    const parsed = await plugin.onResponse?.(original);

    expect(parsed).toEqual({ ...original, data: null });
    expect(original.data).toBe("preserved");
  });
});

describe("REST defaults", () => {
  it("preserves stream responses without relying on metadata", async () => {
    const body = new ReadableStream();
    const original = response({ data: body });
    const shouldParse = vi.fn(() => true);
    const getData = vi.fn();
    const request: SendRequest = { protocol: "rest", input: { method: "GET", stream: true } };

    expect(await setup({ shouldParse, getData }).onResponse?.(original, request)).toBeUndefined();
    expect(original.data).toBe(body);
    expect(shouldParse).not.toHaveBeenCalled();
    expect(getData).not.toHaveBeenCalled();
  });

  it("does not parse HEAD responses", async () => {
    const original = response({ data: '{"value":1}', headers: { "content-type": "application/json" } });
    const request: SendRequest = { protocol: "rest", input: { method: "HEAD" } };

    expect(await setup().onResponse?.(original, request)).toBeUndefined();
    expect(original.data).toBe('{"value":1}');
  });

  it.each([204, 205, 304])("treats REST status %i as empty without mutation", async (status) => {
    const original = response({ status, data: "unexpected" });

    const parsed = await setup().onResponse?.(original, restRequest);

    expect(parsed).toEqual({ ...original, data: null });
    expect(original.data).toBe("unexpected");
  });

  it("uses REST content headers for automatic response type detection", async () => {
    const original = response({
      headers: { "Content-Type": "application/problem+json; charset=utf-8" },
      data: '{"message":"failed"}',
    });

    const parsed = await setup().onResponse?.(original, restRequest);

    expect(parsed?.data).toEqual({ message: "failed" });
    expect(original.data).toBe('{"message":"failed"}');
  });

  it("passes through already-converted automatic JSON without reading headers", async () => {
    const data = { value: 42 };
    const headers = new Proxy(
      {},
      {
        get() {
          throw new Error("headers accessed");
        },
      },
    );
    const original = response({ data, headers });

    expect(await setup().onResponse?.(original, restRequest)).toBeUndefined();
    expect(original.data).toBe(data);
  });

  it("passes through explicit text without reading headers", async () => {
    const headers = new Proxy(
      {},
      {
        get() {
          throw new Error("headers accessed");
        },
      },
    );
    const original = response({ data: "already text", headers });
    const request: SendRequest = {
      ...restRequest,
      metadata: { responseType: "text" },
    };

    expect(await setup().onResponse?.(original, request)).toBeUndefined();
  });

  it("preserves converted JSON objects containing transport-like fields", async () => {
    const data = { raw: "payload", body: "value", headers: {}, status: 200 };
    const original = response({ data });
    const request: SendRequest = {
      ...restRequest,
      metadata: { responseType: "json" },
    };

    expect(await setup().onResponse?.(original, request)).toBeUndefined();
    expect(original.data).toBe(data);
  });

  it("clones the response when an extractor returns converted data", async () => {
    const data = { value: 42 };
    const original = response({ data: "original" });
    const plugin = setup({
      getData: () => data,
      getResponseType: () => "json",
    });

    const parsed = await plugin.onResponse?.(original, restRequest);

    expect(parsed).toEqual({ ...original, data });
    expect(original.data).toBe("original");
  });
});

describe("optional parsers when installed", () => {
  it("builds XML from objects and parses the result back", async () => {
    const converter = new ResponseConverter();
    const data = { root: { "@_id": "1", value: "42" } };
    const xml = await converter.convert(data, "xml");
    expect(xml).toBe('<root id="1"><value>42</value></root>');
    await expect(converter.convert(xml, "xml")).resolves.toEqual(data);
    await expect(converter.convert(Buffer.from(xml as string), "xml")).resolves.toEqual(data);
  });

  it("supports arrays and XML builder options", async () => {
    const converter = new ResponseConverter({ xmlBuilderOptions: { arrayNodeName: "item" } });
    await expect(converter.convert(["a", "b"], "xml")).resolves.toBe(
      "<item>a</item><item>b</item>",
    );
  });

  it("applies per-request builder options without cache collisions", async () => {
    const plugin = setup();
    const original = response({ data: { root: "" } });
    for (const suppressEmptyNode of [true, false]) {
      const parsed = await plugin.onResponse?.(original, {
        ...restRequest,
        metadata: {
          responseType: "xml",
          responseConverter: { xmlBuilderOptions: { suppressEmptyNode } },
        },
      });
      expect(parsed?.data).toBe(suppressEmptyNode ? "<root/>" : "<root></root>");
    }
  });
  it("applies per-request parser options without cache collisions", async () => {
    const plugin = setup();
    const original = response({ data: "<root>42</root>" });
    for (const parseTagValue of [false, true]) {
      const parsed = await plugin.onResponse?.(original, {
        ...restRequest,
        metadata: {
          responseType: "xml",
          responseConverter: { xmlParserOptions: { parseTagValue } },
        },
      });
      expect(parsed?.data).toEqual({ root: parseTagValue ? 42 : "42" });
    }
    expect(original.data).toBe("<root>42</root>");
  });

  it("parses XML with configured options", async () => {
    const converter = new ResponseConverter({ xmlParserOptions: { parseTagValue: true } });
    await expect(converter.convert('<root id="1"><value>42</value></root>', "xml")).resolves.toEqual({
      root: { "@_id": "1", value: 42 },
    });
  });

  it("parses HTML in simple mode", async () => {
    const converter = new ResponseConverter({ htmlMode: "simple" });
    await expect(
      converter.convert("<html><head><title>Title</title></head><body>Hello</body></html>", "html"),
    ).resolves.toEqual({ title: "Title", text: "Hello" });
  });
});

describe("ResponseConverter fast paths", () => {
  it("lets an explicit response type override a conflicting content type", async () => {
    const converter = new ResponseConverter();

    await expect(
      converter.convert('{"value":42}', "text", { contentType: "application/json" }),
    ).resolves.toBe('{"value":42}');
  });

  it.each([42, true, false])("returns converted JSON primitive %p unchanged", async (value) => {
    const converter = new ResponseConverter();

    await expect(converter.convert(value, "json")).resolves.toBe(value);
  });
});
