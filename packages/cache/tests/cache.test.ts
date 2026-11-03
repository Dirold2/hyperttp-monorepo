import { describe, expect, it, vi } from "vitest";
import type {
  PluginContext,
  RequestContext,
  RequestOutcome,
  SendRequest,
  UniversalResponse,
} from "@hyperttp/types";
import { withCache } from "../src/index.js";

function context(id: string): RequestContext {
  return {
    requestId: id,
    startTime: 1,
    meta: { tenant: "one" },
    state: {},
  };
}

function request(id = "1"): SendRequest {
  return { protocol: "acme-rpc", input: { id } };
}

function response(data: unknown, ok = true): UniversalResponse {
  return {
    protocol: "acme-rpc",
    ok,
    status: ok ? 0 : 13,
    statusText: ok ? "OK" : "FAILED",
    headers: { version: "1" },
    data,
    metadata: { source: "network" },
  };
}

function authenticatedRequest(token: string): SendRequest {
  return {
    protocol: "rest",
    input: { method: "GET", url: "/me", headers: { Authorization: `Bearer ${token}` } },
  };
}

// This test endpoint uses header credentials only, matching the README example.
function authenticatedKey(req: SendRequest, ctx?: RequestContext): string | undefined {
  const identity = ctx?.state["@hyperttp/auth.identity"];
  if (typeof identity !== "string" || !identity || req.protocol !== "rest") return;
  const { method, url } = req.input as { method: string; url: string };
  return JSON.stringify({ protocol: req.protocol, method, url, identity });
}

const pluginContext = { config: {}, core: {} } as PluginContext;

describe("withCache", () => {
  it("does not call a custom cache key for auth without identity", async () => {
    const key = vi.fn(() => "unsafe-shared-key");
    const plugin = withCache({ key });
    plugin.setup?.(pluginContext);
    const ctx = context("anonymous-auth");
    ctx.state["@hyperttp/auth.applied"] = true;
    expect(
      await plugin.onRequest?.(authenticatedRequest("synthetic-secret"), pluginContext, ctx),
    ).toBeUndefined();
    expect(key).not.toHaveBeenCalled();
  });

  it("bypasses custom auth marked by the auth plugin without identity", async () => {
    const plugin = withCache();
    plugin.setup?.(pluginContext);
    const req: SendRequest = {
      protocol: "rest",
      input: { method: "GET", url: "/me?custom=synthetic-secret" },
    };
    for (let i = 0; i < 2; i++) {
      const ctx = context(String(i));
      ctx.state["@hyperttp/auth.applied"] = true;
      expect(await plugin.onRequest?.(req, pluginContext, ctx)).toBeUndefined();
      plugin.onResponse?.(response("private"), req, pluginContext, ctx);
    }
  });

  it("caches a custom protocol and passes RequestContext to callbacks", async () => {
    const key = vi.fn(
      (req: SendRequest, ctx?: RequestContext) =>
        `${req.protocol}:${(req.input as { id: string }).id}:${ctx?.meta.tenant}`,
    );
    const shouldCache = vi.fn((_req: SendRequest, ctx?: RequestContext) => !!ctx);
    const shouldStoreResponse = vi.fn(
      (_res: UniversalResponse, _req: SendRequest, ctx?: RequestContext) =>
        ctx?.meta.tenant === "one",
    );
    const plugin = withCache({ key, shouldCache, shouldStoreResponse });
    plugin.setup?.(pluginContext);
    const req = request();
    const firstContext = context("first");

    expect(await plugin.onRequest?.(req, pluginContext, firstContext)).toBeUndefined();
    plugin.onResponse?.(response({ value: 42 }), req, pluginContext, firstContext);

    const hitContext = context("hit");
    const hit = await plugin.onRequest?.(req, pluginContext, hitContext);
    expect(hit).toMatchObject({ protocol: "acme-rpc", data: { value: 42 } });
    expect(hit).not.toBe(response);
    expect(shouldCache).toHaveBeenCalledWith(req, firstContext);
    expect(key).toHaveBeenCalledWith(req, firstContext);
    expect(shouldStoreResponse).toHaveBeenCalledWith(expect.anything(), req, firstContext);
  });

  it("coalesces in-flight requests and gives listeners independent responses", async () => {
    const plugin = withCache({ shouldCache: () => true, key: () => "same" });
    plugin.setup?.(pluginContext);
    const req = request();
    const firstContext = context("first");
    const secondContext = context("second");

    await plugin.onRequest?.(req, pluginContext, firstContext);
    const waiting = plugin.onRequest?.(req, pluginContext, secondContext);
    plugin.onResponse?.(response({ value: 1 }), req, pluginContext, firstContext);

    await expect(waiting).resolves.toMatchObject({ data: { value: 1 } });
  });

  it("rejects in-flight listeners on error and permits a later retry", async () => {
    const plugin = withCache({ shouldCache: () => true, key: () => "same" });
    plugin.setup?.(pluginContext);
    const req = request();
    const firstContext = context("first");
    const secondContext = context("second");
    const error = new Error("transport failed");

    await plugin.onRequest?.(req, pluginContext, firstContext);
    const waiting = plugin.onRequest?.(req, pluginContext, secondContext);
    plugin.onError?.(error, req, pluginContext, firstContext);
    await expect(waiting).rejects.toBe(error);

    expect(await plugin.onRequest?.(req, pluginContext, context("retry"))).toBeUndefined();
  });

  it("bypasses requests and responses rejected by callbacks", async () => {
    const key = vi.fn(() => "never");
    const bypass = withCache({ shouldCache: () => false, key });
    bypass.setup?.(pluginContext);
    const req = request();
    expect(await bypass.onRequest?.(req, pluginContext, context("bypass"))).toBeUndefined();
    expect(key).not.toHaveBeenCalled();

    const noStore = withCache({
      shouldCache: () => true,
      key: () => "same",
      shouldStoreResponse: () => false,
    });
    noStore.setup?.(pluginContext);
    const firstContext = context("first");
    await noStore.onRequest?.(req, pluginContext, firstContext);
    noStore.onResponse?.(response("network"), req, pluginContext, firstContext);
    expect(await noStore.onRequest?.(req, pluginContext, context("second"))).toBeUndefined();
  });

  it("partitions explicit credential-free REST cache keys by the auth identity", async () => {
    const plugin = withCache({
      key: (req, ctx) =>
        JSON.stringify({
          protocol: req.protocol,
          url: (req.input as { url: string }).url,
          identity: ctx?.state["@hyperttp/auth.identity"],
        }),
    });
    plugin.setup?.(pluginContext);
    const req: SendRequest = { protocol: "rest", input: { method: "GET", url: "/me" } };
    const firstContext = context("first");
    const secondContext = context("second");
    firstContext.state["@hyperttp/auth.identity"] = "user:one";
    secondContext.state["@hyperttp/auth.identity"] = "user:two";

    await plugin.onRequest?.(req, pluginContext, firstContext);
    plugin.onResponse?.(
      { ...response({ user: "one" }), protocol: "rest" },
      req,
      pluginContext,
      firstContext,
    );

    expect(await plugin.onRequest?.(req, pluginContext, secondContext)).toBeUndefined();
    plugin.onResponse?.(
      { ...response({ user: "two" }), protocol: "rest" },
      req,
      pluginContext,
      secondContext,
    );

    const hitContext = context("hit");
    hitContext.state["@hyperttp/auth.identity"] = "user:one";
    expect(await plugin.onRequest?.(req, pluginContext, hitContext)).toMatchObject({
      data: { user: "one" },
    });
  });

  it("coalesces the same identity across token rotation with a credential-free key", async () => {
    const plugin = withCache({ key: authenticatedKey });
    plugin.setup?.(pluginContext);
    const first = context("first");
    const second = context("second");
    first.state["@hyperttp/auth.identity"] = "user:one";
    second.state["@hyperttp/auth.identity"] = "user:one";
    const original = authenticatedRequest("old-token");
    const rotated = authenticatedRequest("new-token");

    expect(authenticatedKey(original, first)).toBe(authenticatedKey(rotated, second));
    expect(authenticatedKey(original, first)).not.toContain("old-token");
    expect(authenticatedKey(rotated, second)).not.toContain("new-token");
    expect(plugin.onRequest?.(original, pluginContext, first)).toBeUndefined();
    const waiting = plugin.onRequest?.(rotated, pluginContext, second);
    expect(waiting).toBeInstanceOf(Promise);
    plugin.onResponse?.(response({ user: "one" }), original, pluginContext, first);
    await expect(waiting).resolves.toMatchObject({ data: { user: "one" } });

    const hit = context("hit");
    hit.state["@hyperttp/auth.identity"] = "user:one";
    expect(await plugin.onRequest?.(rotated, pluginContext, hit)).toMatchObject({
      data: { user: "one" },
    });
  });

  it("isolates concurrent identities even when they use the same credentials", async () => {
    const plugin = withCache({ key: authenticatedKey });
    plugin.setup?.(pluginContext);
    const req = authenticatedRequest("shared-token");
    const one = context("one");
    const two = context("two");
    one.state["@hyperttp/auth.identity"] = "user:one";
    two.state["@hyperttp/auth.identity"] = "user:two";

    expect(plugin.onRequest?.(req, pluginContext, one)).toBeUndefined();
    expect(plugin.onRequest?.(req, pluginContext, two)).toBeUndefined();
    const waitingOne = plugin.onRequest?.(req, pluginContext, { ...one, requestId: "wait-one" });
    const waitingTwo = plugin.onRequest?.(req, pluginContext, { ...two, requestId: "wait-two" });
    expect(waitingOne).toBeInstanceOf(Promise);
    expect(waitingTwo).toBeInstanceOf(Promise);
    plugin.onResponse?.(response({ user: "one" }), req, pluginContext, one);
    plugin.onResponse?.(response({ user: "two" }), req, pluginContext, two);
    await expect(waitingOne).resolves.toMatchObject({ data: { user: "one" } });
    await expect(waitingTwo).resolves.toMatchObject({ data: { user: "two" } });
  });

  it.each([undefined, "", 42])(
    "bypasses custom auth caching without a safe identity: %j",
    (identity) => {
      const plugin = withCache({ key: authenticatedKey });
      plugin.setup?.(pluginContext);
      const req = authenticatedRequest("token");
      const first = context("first");
      const second = context("second");
      first.state["@hyperttp/auth.identity"] = identity;
      second.state["@hyperttp/auth.identity"] = identity;

      expect(authenticatedKey(req, first)).toBeUndefined();
      expect(plugin.onRequest?.(req, pluginContext, first)).toBeUndefined();
      expect(plugin.onRequest?.(req, pluginContext, second)).toBeUndefined();
      plugin.onResponse?.(response("private"), req, pluginContext, first);
      expect(plugin.onRequest?.(req, pluginContext, second)).toBeUndefined();
    },
  );

  it.each(
    [
      { Authorization: "Bearer secret" },
      { "Proxy-Authorization": "Basic secret" },
      { Cookie: "session=secret" },
      { "X-API-Key": "secret" },
      new Headers({ Authorization: "Bearer secret" }),
      [["authorization", "Bearer secret"]],
    ].map((headers) => ({ headers })),
  )("bypasses credential headers with the default key: %j", async ({ headers }) => {
    const plugin = withCache();
    plugin.setup?.(pluginContext);
    const req: SendRequest = {
      protocol: "rest",
      input: { method: "GET", url: "/me", headers },
    };
    const first = context("first");
    expect(plugin.onRequest?.(req, pluginContext, first)).toBeUndefined();
    expect(plugin.onRequest?.(req, pluginContext, context("concurrent"))).toBeUndefined();
    plugin.onResponse?.(response("private"), req, pluginContext, first);
    expect(plugin.onRequest?.(req, pluginContext, context("later"))).toBeUndefined();
  });

  it("does not serialize authenticated input with the default key", () => {
    const plugin = withCache();
    plugin.setup?.(pluginContext);
    const toJSON = vi.fn(() => ({ token: "secret" }));
    const req: SendRequest = {
      protocol: "rest",
      input: { method: "GET", url: "/me?api_key=secret", toJSON },
    };
    const first = context("first");
    first.state["@hyperttp/auth.identity"] = "user:one";
    expect(plugin.onRequest?.(req, pluginContext, first)).toBeUndefined();
    plugin.onResponse?.(response("private"), req, pluginContext, first);
    expect(toJSON).not.toHaveBeenCalled();
  });

  it("preserves REST GET/HEAD success defaults and bypasses POST/error responses", async () => {
    const plugin = withCache();
    plugin.setup?.(pluginContext);
    const get: SendRequest = { protocol: "rest", input: { method: "get", url: "/items" } };
    const post: SendRequest = { protocol: "rest", input: { method: "POST", url: "/items" } };

    const getContext = context("get");
    await plugin.onRequest?.(get, pluginContext, getContext);
    plugin.onResponse?.(
      { ...response("failed", false), protocol: "rest" },
      get,
      pluginContext,
      getContext,
    );
    const successContext = context("get-again");
    expect(await plugin.onRequest?.(get, pluginContext, successContext)).toBeUndefined();
    plugin.onResponse?.(
      { ...response("ok"), protocol: "rest" },
      get,
      pluginContext,
      successContext,
    );
    expect(await plugin.onRequest?.(get, pluginContext, context("hit"))).toMatchObject({
      data: "ok",
    });
    expect(await plugin.onRequest?.(post, pluginContext, context("post"))).toBeUndefined();
  });
});

function settlingContext(id: string) {
  const callbacks: ((outcome: RequestOutcome) => void | Promise<void>)[] = [];
  const ctx: RequestContext = {
    ...context(id),
    onSettled: (callback) => {
      callbacks.push(callback);
    },
    acceptFinalResponse: vi.fn((response) => response),
  };
  return {
    ctx,
    settle: async (outcome: RequestOutcome) => {
      for (const callback of callbacks.splice(0)) await callback(outcome);
    },
  };
}

describe("Core3 settlement", () => {
  it("publishes only the final recovered/transformed response and accepts hits/followers", async () => {
    const store = vi.fn(() => true);
    const plugin = withCache({
      shouldCache: () => true,
      key: () => "same",
      shouldStoreResponse: store,
    });
    plugin.setup?.(pluginContext);
    const req = request();
    const leader = settlingContext("leader");
    const follower = settlingContext("follower");
    plugin.onRequest?.(req, pluginContext, leader.ctx);
    const waiting = plugin.onRequest?.(req, pluginContext, follower.ctx);
    plugin.onError?.(new Error("recovered later"), req, pluginContext, leader.ctx);
    plugin.onResponse?.(response("intermediate"), req, pluginContext, leader.ctx);
    expect(store).not.toHaveBeenCalled();
    const final = response({ value: "final" });
    await leader.settle({ ok: true, response: final });
    const received = await waiting;
    expect(received).toMatchObject({ data: { value: "final" } });
    expect(store).toHaveBeenCalledExactlyOnceWith(final, req, leader.ctx);
    expect(follower.ctx.acceptFinalResponse).toHaveBeenCalledWith(received);
    const hit = settlingContext("hit");
    const cached = await plugin.onRequest?.(req, pluginContext, hit.ctx);
    expect(cached).toMatchObject({ data: { value: "final" } });
    expect(cached).not.toBe(received);
    expect(hit.ctx.acceptFinalResponse).toHaveBeenCalledWith(cached);
  });

  it("rejects followers on final response-hook failure without caching preliminary success", async () => {
    const plugin = withCache({ shouldCache: () => true, key: () => "same" });
    plugin.setup?.(pluginContext);
    const req = request();
    const leader = settlingContext("leader");
    plugin.onRequest?.(req, pluginContext, leader.ctx);
    const waiting = plugin.onRequest?.(req, pluginContext, settlingContext("follower").ctx);
    plugin.onResponse?.(response("preliminary"), req, pluginContext, leader.ctx);
    const error = new Error("late transform failed");
    const rejected = expect(waiting).rejects.toBe(error);
    await leader.settle({ ok: false, error });
    await rejected;
    expect(plugin.onRequest?.(req, pluginContext, settlingContext("retry").ctx)).toBeUndefined();
  });

  it("does not let an old follower settle a newer producer for the same key", async () => {
    const plugin = withCache({
      shouldCache: () => true,
      key: () => "same",
      shouldStoreResponse: () => false,
    });
    plugin.setup?.(pluginContext);
    const req = request();
    const first = settlingContext("first");
    const oldFollower = settlingContext("old-follower");
    plugin.onRequest?.(req, pluginContext, first.ctx);
    const oldWaiting = plugin.onRequest?.(req, pluginContext, oldFollower.ctx);
    await first.settle({ ok: true, response: response("first") });
    await oldWaiting;
    const next = settlingContext("next");
    expect(plugin.onRequest?.(req, pluginContext, next.ctx)).toBeUndefined();
    const waiting = plugin.onRequest?.(req, pluginContext, settlingContext("next-follower").ctx);
    plugin.onResponse?.(response("old"), req, pluginContext, oldFollower.ctx);
    await oldFollower.settle({ ok: true, response: response("old") });
    await next.settle({ ok: true, response: response("next") });
    await expect(waiting).resolves.toMatchObject({ data: "next" });
  });

  it("releases followers even when the storage predicate throws", async () => {
    const error = new Error("storage policy failed");
    const plugin = withCache({
      shouldCache: () => true,
      key: () => "same",
      shouldStoreResponse: () => {
        throw error;
      },
    });
    plugin.setup?.(pluginContext);
    const req = request();
    const leader = settlingContext("leader");
    plugin.onRequest?.(req, pluginContext, leader.ctx);
    const waiting = plugin.onRequest?.(req, pluginContext, settlingContext("follower").ctx);
    await expect(leader.settle({ ok: true, response: response("final") })).rejects.toBe(error);
    await expect(waiting).resolves.toMatchObject({ data: "final" });
    expect(plugin.onRequest?.(req, pluginContext, settlingContext("retry").ctx)).toBeUndefined();
  });

  it("distinguishes a resolved non-ok protocol response from a rejected request", async () => {
    const plugin = withCache({ shouldCache: () => true, key: () => "same" });
    plugin.setup?.(pluginContext);
    const req = request();
    const leader = settlingContext("leader");
    plugin.onRequest?.(req, pluginContext, leader.ctx);
    const waiting = plugin.onRequest?.(req, pluginContext, settlingContext("follower").ctx);
    await leader.settle({ ok: true, response: response("denied", false) });
    await expect(waiting).resolves.toMatchObject({ ok: false, data: "denied" });
    expect(plugin.onRequest?.(req, pluginContext, settlingContext("retry").ctx)).toBeUndefined();
  });
});
