import type { HyperProtocolName, IHyperCore, RequestContext, SendRequest } from "@hyperttp/types";
import { applyCredentials } from "../src/auth.js";
import { describe, expect, expectTypeOf, it } from "vitest";
import { AUTH_IDENTITY_STATE_KEY, withAuth } from "../src/index.js";
import type { AuthPluginOptions } from "../src/types.js";

function request(input: Record<string, unknown>, protocol = "rest"): SendRequest {
  return { protocol, input };
}

function context(): RequestContext {
  return {
    requestId: "request-1",
    startTime: Date.now(),
    meta: {},
    state: {},
  };
}

describe("withAuth", () => {
  it("accepts canonical custom protocol names and restricts the adapter to that protocol", async () => {
    expectTypeOf<AuthPluginOptions["protocol"]>().toEqualTypeOf<HyperProtocolName | undefined>();
    const protocol: HyperProtocolName = "custom-rpc";
    const plugin = withAuth({
      protocol,
      apply: (current) => ({ ...current, input: { authenticated: true } }),
    });

    expect(await plugin.onRequest?.(request({}, protocol))).toMatchObject({
      protocol,
      input: { authenticated: true },
    });
    expect(await plugin.onRequest?.(request({}, "other-rpc"))).toBeUndefined();
  });

  it("requires a trusted origin for built-in credentials", () => {
    expect(() => withAuth({ bearer: { getToken: () => "secret" } })).toThrow("allowedOrigins");
  });

  it("rejects built-in credentials on non-REST protocols", () => {
    expect(() =>
      withAuth({
        protocol: "grpc",
        allowedOrigins: ["https://api.example.com"],
        bearer: { getToken: () => "secret" },
      }),
    ).toThrow("REST only");
  });

  it("does not attach shorthand Bearer credentials to gRPC", async () => {
    const plugin = withAuth({
      allowedOrigins: ["https://api.example.com"],
      bearer: { getToken: () => "secret" },
    });
    expect(
      await plugin.onRequest?.(request({ url: "https://api.example.com" }, "grpc")),
    ).toBeUndefined();
  });

  it("loads config.auth during setup and prefers explicit options", async () => {
    const configured = {
      allowedOrigins: ["https://api.example.com"],
      bearer: { getToken: () => "config" },
    };
    const plugin = withAuth();
    plugin.setup?.({ config: { auth: configured }, core: {} as IHyperCore });
    expect(await plugin.onRequest?.(request({ url: "https://api.example.com" }))).toMatchObject({
      input: { headers: { authorization: "Bearer config" } },
    });
    const explicit = withAuth({ ...configured, bearer: { getToken: () => "explicit" } });
    explicit.setup?.({ config: { auth: configured }, core: {} as IHyperCore });
    expect(await explicit.onRequest?.(request({ url: "https://api.example.com" }))).toMatchObject({
      input: { headers: { authorization: "Bearer explicit" } },
    });
  });

  it("is inactive without explicit options or config.auth", async () => {
    const plugin = withAuth();
    plugin.setup?.({ config: {}, core: {} as IHyperCore });
    expect(await plugin.onRequest?.(request({ url: "https://api.example.com" }))).toBeUndefined();
  });

  it.each(["users", "./users", "../users", "/users"])(
    "preserves query API key path %s",
    async (path) => {
      const result = await applyCredentials(request({ url: `${path}?page=1#section` }), {
        type: "api-key",
        name: "key",
        getValue: () => "a b",
        location: "query",
      } as import("../src/types.js").RestCredentials);
      expect(result.input).toEqual({ url: `${path}?page=1&key=a+b#section` });
    },
  );
  it("adds a Bearer token without mutating the original request", async () => {
    const plugin = withAuth({
      allowedOrigins: ["https://api.example.com"],
      rest: { type: "bearer", getToken: () => "access-token" },
    });
    const original = request({
      url: "https://api.example.com/me",
      headers: { accept: "application/json" },
    });

    const result = await plugin.onRequest?.(original, undefined, context());

    expect(result).toMatchObject({
      input: {
        headers: {
          accept: "application/json",
          authorization: "Bearer access-token",
        },
      },
    });
    expect(original.input).toEqual({
      url: "https://api.example.com/me",
      headers: { accept: "application/json" },
    });
  });

  it.each([
    ["Headers", new Headers({ accept: "application/json" })],
    ["header tuples", [["accept", "application/json"]]],
  ] as const)("preserves %s when adding credentials", async (_kind, headers) => {
    const plugin = withAuth({
      allowedOrigins: ["https://api.example.com"],
      rest: { type: "bearer", getToken: () => "access-token" },
    });

    const result = await plugin.onRequest?.(
      request({ url: "https://api.example.com/me", headers }),
    );

    expect(result).toMatchObject({
      input: {
        headers: {
          accept: "application/json",
          authorization: "Bearer access-token",
        },
      },
    });
  });

  it("uses the latest Basic-auth password from its provider", async () => {
    const plugin = withAuth({
      allowedOrigins: ["https://api.example.com"],
      rest: {
        type: "basic",
        username: "service",
        getPassword: () => "secret",
      },
    });

    const result = await plugin.onRequest?.(request({ url: "https://api.example.com" }));

    expect(result).toMatchObject({
      input: { headers: { authorization: "Basic c2VydmljZTpzZWNyZXQ=" } },
    });
  });

  it("places a REST API key in the query string", async () => {
    const plugin = withAuth({
      allowedOrigins: ["https://api.example.com"],
      rest: {
        type: "api-key",
        location: "query",
        name: "api_key",
        getValue: () => "key value",
      },
    });

    const result = await plugin.onRequest?.(
      request({ url: "https://api.example.com/users?page=1" }),
    );

    expect(result).toMatchObject({
      input: { url: "https://api.example.com/users?page=1&api_key=key+value" },
    });
  });

  it("does not expose credentials to origins outside the allow-list", async () => {
    const plugin = withAuth({
      allowedOrigins: ["https://api.example.com"],
      rest: { type: "bearer", getToken: () => "access-token" },
    });

    const result = await plugin.onRequest?.(request({ url: "https://other.example.com/me" }));

    expect(result).toBeUndefined();
  });

  it("does not expose credentials for a relative URL when an allow-list is configured", async () => {
    const plugin = withAuth({
      allowedOrigins: ["https://api.example.com"],
      rest: { type: "bearer", getToken: () => "access-token" },
    });

    expect(await plugin.onRequest?.(request({ url: "/me" }))).toBeUndefined();
  });

  it("shares only the non-secret auth identity through request state", async () => {
    const plugin = withAuth({
      allowedOrigins: ["https://api.example.com"],
      bearer: {
        getToken: () => "do-not-store-me",
        getCacheKey: () => "tenant:7:user:42",
      },
    });
    const requestContext = context();

    const result = await plugin.onRequest?.(
      request({ url: "https://api.example.com/me" }),
      undefined,
      requestContext,
    );

    expect(requestContext.state).toEqual({
      "@hyperttp/auth.applied": true,
      [AUTH_IDENTITY_STATE_KEY]: "tenant:7:user:42",
    });
    expect(JSON.stringify(requestContext.state)).not.toContain("do-not-store-me");
    expect(result).toMatchObject({
      input: { headers: { authorization: "Bearer do-not-store-me" } },
    });
  });

  it("delegates non-REST protocols to a custom adapter", async () => {
    const plugin = withAuth({
      protocol: "grpc",
      apply: (current) => ({
        ...current,
        input: {
          ...(current.input as Record<string, unknown>),
          metadata: { authorization: "Bearer grpc-token" },
        },
      }),
    });

    const result = await plugin.onRequest?.(request({ method: "GetUser" }, "grpc"));

    expect(result).toMatchObject({
      input: { metadata: { authorization: "Bearer grpc-token" } },
    });
  });
});
