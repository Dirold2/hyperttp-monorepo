import { Readable } from "node:stream";
import { describe, it, expect, vi } from "vitest";
import { RestSender, RestReceiver } from "../src/index.js";
import type { RequestContext } from "@hyperttp/types";

function makeCtx(): RequestContext {
  return { requestId: "test", startTime: 0, meta: {}, state: {} };
}

describe("review regressions", () => {
  it("normalizes only own header keys", () => {
    const headers = Object.assign(Object.create({ "x-inherited": "secret" }), { "X-Own": "yes" });
    const prepared = new RestSender().prepare(
      {
        protocol: "rest",
        input: {
          method: "GET",
          url: "/",
          headers,
        },
      },
      makeCtx(),
    );
    expect(prepared.headers).toEqual({ "x-own": "yes" });
  });

  it.each(["end", "return", "error", "abort", "timeout"])(
    "cleans async iterable lifetime on %s",
    async (ending) => {
      vi.useFakeTimers();
      const external = new AbortController();
      const remove = vi.spyOn(external.signal, "removeEventListener");
      const failure = new Error("iteration failed");
      const returned = vi.fn(async () => ({ done: true as const, value: undefined }));
      const body = {
        [Symbol.asyncIterator]() {
          return this;
        },
        next: vi.fn((): Promise<IteratorResult<unknown>> => {
          if (ending === "end") return Promise.resolve({ done: true, value: undefined });
          if (ending === "error") return Promise.reject(failure);
          return new Promise(() => {});
        }),
        return: returned,
      };
      try {
        const sender = new RestSender();
        const ctx = makeCtx();
        const prepared = sender.prepare(
          {
            protocol: "rest",
            input: {
              method: "GET",
              url: "/",
              stream: true,
              timeout: 100,
              signal: external.signal,
            },
          },
          ctx,
        );
        const raw = await sender.send(
          prepared,
          { execute: async () => ({ status: 200, headers: {}, body }) },
          ctx,
        );
        const iterator = (raw.body as AsyncIterable<unknown>)[Symbol.asyncIterator]();
        expect(remove).not.toHaveBeenCalled();
        expect(vi.getTimerCount()).toBe(1);
        if (ending === "return") {
          await iterator.return?.();
          expect(returned).toHaveBeenCalledOnce();
        } else if (ending === "end") {
          expect((await iterator.next()).done).toBe(true);
        } else {
          const pending = expect(iterator.next()).rejects.toThrow();
          if (ending === "abort") external.abort(failure);
          if (ending === "timeout") await vi.advanceTimersByTimeAsync(100);
          await pending;
          if (ending !== "error") expect(returned).toHaveBeenCalledOnce();
        }
        expect(remove).toHaveBeenCalledWith("abort", expect.any(Function));
        expect(vi.getTimerCount()).toBe(0);
      } finally {
        vi.useRealTimers();
        remove.mockRestore();
      }
    },
  );

  it("destroys a Node stream and rejects a pending read on external abort", async () => {
    const source = new Readable({ read() {} });
    const external = new AbortController();
    const sender = new RestSender();
    const ctx = makeCtx();
    const prepared = sender.prepare(
      {
        protocol: "rest",
        input: {
          method: "GET",
          url: "/",
          stream: true,
          timeout: 10000,
          signal: external.signal,
        },
      },
      ctx,
    );
    const raw = await sender.send(
      prepared,
      { execute: async () => ({ status: 200, headers: {}, body: source }) },
      ctx,
    );
    const iterator = (raw.body as AsyncIterable<unknown>)[Symbol.asyncIterator]();
    const failure = new Error("stop stream");
    const pending = expect(iterator.next()).rejects.toBe(failure);
    external.abort(failure);
    await pending;
    expect(source.destroyed).toBe(true);
  });
  it("encodes JSON and text without a global Buffer", () => {
    vi.stubGlobal("Buffer", undefined);
    try {
      const sender = new RestSender();
      for (const body of ["héllo", { text: "héllo" }]) {
        const prepared = sender.prepare(
          { protocol: "rest", input: { method: "POST", url: "/", body } },
          makeCtx(),
        );
        expect(new TextDecoder().decode(prepared.body as Uint8Array)).toBe(
          typeof body === "string" ? body : JSON.stringify(body),
        );
      }
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("cleans timeout resources when preparation throws", () => {
    vi.useFakeTimers();
    const controller = new AbortController();
    const remove = vi.spyOn(controller.signal, "removeEventListener");
    const body: Record<string, unknown> = {};
    body.self = body;
    try {
      expect(() =>
        new RestSender().prepare(
          {
            protocol: "rest",
            input: {
              method: "POST",
              url: "/",
              body,
              timeout: 1000,
              signal: controller.signal,
            },
          },
          makeCtx(),
        ),
      ).toThrow();
      expect(vi.getTimerCount()).toBe(0);
      expect(remove).toHaveBeenCalledWith("abort", expect.any(Function));
    } finally {
      vi.useRealTimers();
      remove.mockRestore();
    }
  });

  it.each([false, true])("releases collected reader locks (failure=%s)", async (fail) => {
    const body = new ReadableStream({
      start(controller) {
        if (fail) controller.error(new Error("read failed"));
        else {
          controller.enqueue(new Uint8Array([1]));
          controller.close();
        }
      },
    });
    const sender = new RestSender();
    const ctx = makeCtx();
    const request = sender.prepare({ protocol: "rest", input: { method: "GET", url: "/" } }, ctx);
    const result = sender.send(
      request,
      { execute: async () => ({ status: 200, headers: {}, body }) },
      ctx,
    );
    if (fail) await expect(result).rejects.toThrow("read failed");
    else await expect(result).resolves.toMatchObject({ body: new Uint8Array([1]) });
    expect(body.locked).toBe(false);
  });

  it.each(["end", "cancel", "error", "abort"])(
    "keeps streaming abort binding until %s",
    async (ending) => {
      const sender = new RestSender();
      const ctx = makeCtx();
      const external = new AbortController();
      const remove = vi.spyOn(external.signal, "removeEventListener");
      let source!: ReadableStreamDefaultController;
      const cancel = vi.fn();
      const body = new ReadableStream({
        start(controller) {
          source = controller;
        },
        cancel,
      });
      const prepared = sender.prepare(
        {
          protocol: "rest",
          input: {
            method: "GET",
            url: "/",
            stream: true,
            timeout: 10000,
            signal: external.signal,
          },
        },
        ctx,
      );
      const raw = await sender.send(
        prepared,
        { execute: async () => ({ status: 200, headers: {}, body }) },
        ctx,
      );
      expect(remove).not.toHaveBeenCalled();
      const reader = (raw.body as ReadableStream).getReader();
      if (ending === "end") {
        source.close();
        await expect(reader.read()).resolves.toMatchObject({ done: true });
      } else if (ending === "cancel") {
        await reader.cancel("stop");
        expect(cancel).toHaveBeenCalledWith("stop");
      } else {
        const failure = new Error("stream stopped");
        if (ending === "abort") external.abort(failure);
        else source.error(failure);
        await expect(reader.read()).rejects.toBe(failure);
      }
      await vi.waitFor(() => expect(body.locked).toBe(false));
      expect(remove).toHaveBeenCalledWith("abort", expect.any(Function));
      remove.mockRestore();
    },
  );

  it("keeps a streaming timeout active after response headers", async () => {
    vi.useFakeTimers();
    try {
      const sender = new RestSender();
      const ctx = makeCtx();
      const cancel = vi.fn();
      const body = new ReadableStream({ cancel });
      const prepared = sender.prepare(
        {
          protocol: "rest",
          input: {
            method: "GET",
            url: "/slow",
            stream: true,
            timeout: 20,
          },
        },
        ctx,
      );
      const raw = await sender.send(
        prepared,
        { execute: async () => ({ status: 200, headers: {}, body }) },
        ctx,
      );
      const reader = (raw.body as ReadableStream).getReader();
      const read = expect(reader.read()).rejects.toThrow();
      await vi.advanceTimersByTimeAsync(20);
      await read;
      expect(prepared.signal?.aborted).toBe(true);
      expect(cancel).toHaveBeenCalled();
      expect(body.locked).toBe(false);
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it("preserves binary incoming bodies and prototype-like query keys", () => {
    const receiver = new RestReceiver();
    const bytes = new Uint8Array([0, 255, 128]);
    const input = receiver.receive(
      {
        protocol: "rest",
        method: "POST",
        url: "/?__proto__=a&__proto__=b&constructor=c&toString=d",
        headers: {
          "content-type": "application/octet-stream",
        },
        body: bytes,
      },
      {} as never,
    );
    expect(input.body).toBe(bytes);
    expect(Object.getPrototypeOf(input.query)).toBeNull();
    expect(input.query).toEqual({ ["__proto__"]: ["a", "b"], constructor: "c", toString: "d" });
    expect(input.query["__proto__"]).toEqual(["a", "b"]);
    expect(
      receiver.receive({ protocol: "rest", method: "GET", url: "/", headers: {} }, {} as never)
        .query,
    ).toEqual({});
  });

  it("passes web streams and async iterables through receiver responses", () => {
    const receiver = new RestReceiver();
    const stream = new ReadableStream();
    const iterable = (async function* () {
      yield "hello";
    })();
    for (const body of [stream, iterable]) {
      expect(receiver.respond({ body }, {} as never).body).toBe(body);
    }
  });
});

describe("RestSender.prepare", () => {
  it("builds a transport request from a RestInput descriptor", () => {
    const sender = new RestSender();
    const prepared = sender.prepare(
      { protocol: "rest", input: { method: "GET", url: "/users" } },
      makeCtx(),
    );

    expect(prepared.method).toBe("GET");
    expect(prepared.url).toBe("/users");
    expect(prepared.headers).toBeDefined();
    expect(prepared.protocol).toBe("rest");
  });

  it("appends query parameters", () => {
    const sender = new RestSender();
    const prepared = sender.prepare(
      {
        protocol: "rest",
        input: { method: "GET", url: "/users", query: { page: 1, tags: ["a", "b"] } },
      },
      makeCtx(),
    );

    expect(prepared.url).toBe("/users?page=1&tags=a&tags=b");
  });

  it("serializes plain-object bodies to a JSON buffer and sets content-type", () => {
    const sender = new RestSender();
    const prepared = sender.prepare(
      { protocol: "rest", input: { method: "POST", url: "/post", body: { ok: true } } },
      makeCtx(),
    );

    expect(prepared.method).toBe("POST");
    expect(new Uint8Array(prepared.body as Uint8Array)).toEqual(
      new TextEncoder().encode('{"ok":true}'),
    );
    expect(prepared.headers?.["content-type"]).toBe("application/json; charset=utf-8");
  });

  it("propagates the abort signal through", () => {
    const sender = new RestSender();
    const controller = new AbortController();
    const prepared = sender.prepare(
      {
        protocol: "rest",
        input: { method: "GET", url: "/users" },
        signal: controller.signal,
      },
      makeCtx(),
    );

    expect(prepared.signal).toBe(controller.signal);
    expect(prepared.signal?.aborted).toBe(false);

    controller.abort();
    expect(prepared.signal?.aborted).toBe(true);
  });

  it("wraps the signal with a timeout and aborts when it expires", async () => {
    const sender = new RestSender();
    const prepared = sender.prepare(
      { protocol: "rest", input: { method: "GET", url: "/slow", timeout: 5 } },
      makeCtx(),
    );

    expect(prepared.signal).toBeDefined();
    expect(prepared.signal?.aborted).toBe(false);

    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(prepared.signal?.aborted).toBe(true);
  });
});

describe("RestSender.send / parse", () => {
  const mockTransport = {
    async execute(req: unknown) {
      return {
        status: 200,
        headers: { "content-type": "application/json" },
        url: (req as { url: string }).url,
        body: new TextEncoder().encode('{"ok":true}'),
      };
    },
  };

  it("executes a full three-phase cycle", async () => {
    const sender = new RestSender();
    const ctx = makeCtx();

    const prepared = sender.prepare(
      { protocol: "rest", input: { method: "GET", url: "/users" } },
      ctx,
    );
    const raw = await sender.send(prepared, mockTransport as never, ctx);
    const universal = sender.parse(raw, ctx);

    expect(universal.protocol).toBe("rest");
    expect(universal.status).toBe(200);
    expect(universal.url).toBe("/users");
    expect(universal.data).toEqual({ ok: true });
    expect(universal.raw).toBe(raw);
  });

  it("carries statusText from the raw transport response", async () => {
    const sender = new RestSender();
    const raw = {
      status: 200,
      statusText: "OK",
      headers: {},
      url: "/users",
      body: new TextEncoder().encode('{"ok":true}'),
    };

    const universal = await sender.parse(raw, makeCtx());
    expect(universal.statusText).toBe("OK");
  });
});

describe("RestSender.methods", () => {
  it("dispatches through the core for core-first method calls", async () => {
    const sender = new RestSender();
    const send = vi.fn(async () => ({ ok: true, status: 200 }));
    const fakeCore = { send };

    await sender.methods.get!(fakeCore as never, "/users", { query: { page: 1 } });
    expect(send).toHaveBeenCalledWith({
      protocol: "rest",
      input: { method: "GET", url: "/users", query: { page: 1 } },
    });

    await sender.methods.post!(fakeCore as never, "/users", { ok: true });
    expect(send).toHaveBeenLastCalledWith({
      protocol: "rest",
      input: { method: "POST", url: "/users", body: { ok: true } },
    });
  });

  it("exposes head and options methods", async () => {
    const sender = new RestSender();
    const send = vi.fn(async () => ({ ok: true, status: 200 }));
    const fakeCore = { send };

    await sender.methods.head!(fakeCore as never, "/h");
    expect(send).toHaveBeenLastCalledWith({
      protocol: "rest",
      input: { method: "HEAD", url: "/h" },
    });

    await sender.methods.options!(fakeCore as never, "/o");
    expect(send).toHaveBeenLastCalledWith({
      protocol: "rest",
      input: { method: "OPTIONS", url: "/o" },
    });
  });

  it("exposes a generic request method with an arbitrary HTTP method", async () => {
    const sender = new RestSender();
    const send = vi.fn(async () => ({ ok: true, status: 200 }));
    const fakeCore = { send };

    await sender.methods.request!(fakeCore as never, "PATCH", "/r", { query: { page: 2 } });
    expect(send).toHaveBeenLastCalledWith({
      protocol: "rest",
      input: { method: "PATCH", url: "/r", query: { page: 2 } },
    });
  });

  it("preserves options.signal when no positional signal is supplied", async () => {
    const sender = new RestSender();
    const controller = new AbortController();
    const send = vi.fn(async () => ({ ok: true, status: 200 }));
    const fakeCore = { send };

    await sender.methods.get!(fakeCore as never, "/users", { signal: controller.signal });

    expect(send).toHaveBeenCalledWith({
      protocol: "rest",
      input: {
        method: "GET",
        url: "/users",
        signal: controller.signal,
      },
      signal: controller.signal,
    });
  });

  it("exposes a stream method that requests a raw (undecoded) body", async () => {
    const sender = new RestSender();
    const send = vi.fn(async () => ({ ok: true, status: 200 }));
    const fakeCore = { send };

    await sender.methods.stream!(fakeCore as never, "/s");
    expect(send).toHaveBeenLastCalledWith({
      protocol: "rest",
      input: { method: "GET", url: "/s", stream: true },
    });
  });
});

describe("RestSender stream mode", () => {
  it("keeps the body raw when stream is requested", async () => {
    const sender = new RestSender();
    const ctx = makeCtx();
    const body = new TextEncoder().encode('{"ok":true}');
    const transport = {
      execute: async () => ({
        status: 200,
        headers: { "content-type": "application/json" },
        url: "/s",
        body,
      }),
    };
    const prepared = sender.prepare(
      {
        protocol: "rest",
        input: { method: "GET", url: "/s", stream: true },
      },
      ctx,
    );

    const raw = await sender.send(prepared, transport, ctx);
    const universal = sender.parse(raw, ctx);

    expect(universal.data).toBe(body);
    expect(universal.data).toBeInstanceOf(Uint8Array);
  });

  it("decodes the body when stream is not requested", async () => {
    const sender = new RestSender();
    const ctx = makeCtx();
    const raw = {
      status: 200,
      headers: { "content-type": "application/json" },
      url: "/s",
      body: new TextEncoder().encode('{"ok":true}'),
    };
    const universal = sender.parse(raw, ctx);

    expect(universal.data).toEqual({ ok: true });
  });

  it("collects and decodes a stream-like body when stream is not requested", async () => {
    const sender = new RestSender();
    const ctx = makeCtx();

    const bytes = new TextEncoder().encode('{"ok":true}');

    const streamBody = {
      arrayBuffer: () => Promise.resolve(bytes.buffer),
    };

    const transport = {
      execute: async () => ({
        status: 200,
        headers: {
          "content-type": "application/json",
        },
        url: "/s",
        body: streamBody,
      }),
    };

    const prepared = sender.prepare(
      {
        protocol: "rest",
        input: {
          method: "GET",
          url: "/s",
        },
      },
      ctx,
    );

    const raw = await sender.send(prepared, transport, ctx);
    const universal = sender.parse(raw, ctx);

    expect(raw.body).toBeInstanceOf(Uint8Array);
    expect(universal.data).toEqual({ ok: true });
  });

  it("collects a binary stream-like body into bytes via send()", async () => {
    const sender = new RestSender();
    const ctx = makeCtx();

    const bytes = new TextEncoder().encode("raw-bytes");

    const streamBody = {
      arrayBuffer: () => Promise.resolve(bytes.buffer),
    };

    const transport = {
      execute: async () => ({
        status: 200,
        headers: {
          "content-type": "application/octet-stream",
        },
        url: "/s",
        body: streamBody,
      }),
    };

    const prepared = sender.prepare(
      {
        protocol: "rest",
        input: {
          method: "GET",
          url: "/s",
        },
      },
      ctx,
    );

    const raw = await sender.send(prepared, transport, ctx);

    expect(raw.body).toBeInstanceOf(Uint8Array);

    const universal = sender.parse(raw, ctx);

    expect(universal.data).toBeInstanceOf(Uint8Array);
    expect(universal.data).toBe(raw.body);

    expect(new TextDecoder().decode(universal.data as Uint8Array)).toBe("raw-bytes");
  });
});
