import { describe, expect, it } from "vitest";
import type { ServerRequestContext, TransportRequest } from "@hyperttp/types";
import { RestReceiver, RestProtocol, RestSender } from "../src/index.js";

const context = (): ServerRequestContext => ({
  requestId: "test",
  startTime: 0,
  meta: {},
  state: {},
});
const request = (body: unknown): TransportRequest => ({
  protocol: "rest",
  method: "POST",
  url: "/users?tag=a&tag=b",
  headers: { "content-type": "application/json" },
  body,
});

describe("standalone REST receiver", () => {
  it("exports both roles without depending on core", () => {
    expect(RestProtocol.protocol).toBe("rest");
    expect(RestProtocol.sender).toBeInstanceOf(RestSender);
    expect(RestProtocol.receiver).toBeInstanceOf(RestReceiver);
  });
  it("decodes JSON and repeated query values", () => {
    const parsed = new RestReceiver().receive(
      request(new TextEncoder().encode('{"name":"Ada"}')),
      context(),
    );
    expect(parsed.body).toEqual({ name: "Ada" });
    expect(parsed.path).toBe("/users");
    expect(parsed.query.tag).toEqual(["a", "b"]);
  });
  it("requires an application handler", () => {
    const receiver = new RestReceiver();
    expect(() =>
      receiver.handle(receiver.receive(request(undefined), context()), context()),
    ).toThrow("No application handler");
  });
  it("serializes application responses", () => {
    const response = new RestReceiver().respond({ status: 201, body: { ok: true } }, context());
    expect(response.status).toBe(201);
    expect(response.headers["content-type"]).toContain("application/json");
  });
});
