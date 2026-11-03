import { afterEach, describe, expect, it, vi } from "vitest";
import type { HyperTransport, RequestContext, TransportRequest } from "@hyperttp/types";
import {
  createWebRtcProtocol,
  WebRtcProtocol,
  WebRtcReceiver,
  WebRtcSender,
} from "../src/index.js";
import { TimeoutError } from "../src/utils/errors.js";

const context = (): RequestContext => ({ requestId: "test", startTime: 0, meta: {}, state: {} });
const response = { status: 200, headers: {}, body: { payload: "ok" } };
const incoming = (body: unknown, headers: TransportRequest["headers"] = {}): TransportRequest => ({
  method: "POST",
  url: "peer",
  protocol: "webrtc",
  headers,
  body,
});

afterEach(() => vi.useRealTimers());

describe("sender", () => {
  it("preserves signaling fields through prepare and receive", () => {
    const sender = new WebRtcSender();
    const offer: RTCSessionDescriptionInit = { type: "offer", sdp: "v=0" };
    const prepared = sender.prepare(
      {
        protocol: "webrtc",
        input: {
          action: "offer",
          peerUrl: "peer",
          offer,
          sessionId: "call",
        },
      },
      context(),
    );
    expect(new WebRtcReceiver().receive(prepared, context())).toMatchObject({
      action: "offer",
      offer,
      sessionId: "call",
      peerId: "unknown",
    });
  });

  it.each([false, true])(
    "cleans timeout and abort listener after execute (reject=%s)",
    async (reject) => {
      vi.useFakeTimers();
      const controller = new AbortController();
      const remove = vi.spyOn(controller.signal, "removeEventListener");
      const sender = new WebRtcSender();
      const prepared = sender.prepare(
        {
          protocol: "webrtc",
          input: {
            action: "connect",
            peerUrl: "peer",
            timeout: 1000,
            signal: controller.signal,
          },
        },
        context(),
      );
      expect(vi.getTimerCount()).toBe(0);
      const failure = new Error("transport failed");
      const transport: HyperTransport = {
        execute: vi.fn(async () => {
          if (reject) throw failure;
          return response;
        }),
      };
      if (reject) await expect(sender.send(prepared, transport, context())).rejects.toBe(failure);
      else await expect(sender.send(prepared, transport, context())).resolves.toBe(response);
      expect(vi.getTimerCount()).toBe(0);
      expect(remove).toHaveBeenCalledWith("abort", expect.any(Function));
    },
  );

  it("propagates timeout to a cooperative transport", async () => {
    vi.useFakeTimers();
    const sender = new WebRtcSender();
    const prepared = sender.prepare(
      {
        protocol: "webrtc",
        input: {
          action: "connect",
          peerUrl: "peer",
          timeout: 25,
        },
      },
      context(),
    );
    const transport: HyperTransport = {
      execute: (request) =>
        new Promise((_resolve, reject) => {
          request.signal!.addEventListener("abort", () => reject(request.signal!.reason), {
            once: true,
          });
        }),
    };
    const pending = expect(sender.send(prepared, transport, context())).rejects.toBeInstanceOf(
      TimeoutError,
    );
    await vi.advanceTimersByTimeAsync(25);
    await pending;
    expect(vi.getTimerCount()).toBe(0);
  });

  it("does not execute an already cancelled request", async () => {
    const sender = new WebRtcSender();
    const reason = new Error("cancelled");
    const prepared = sender.prepare(
      {
        protocol: "webrtc",
        input: {
          action: "connect",
          peerUrl: "peer",
          signal: AbortSignal.abort(reason),
        },
      },
      context(),
    );
    const execute = vi.fn(async () => response);
    await expect(sender.send(prepared, { execute }, context())).rejects.toBe(reason);
    expect(execute).not.toHaveBeenCalled();
  });

  it.each([{ supports: () => false }, { protocols: ["http"] }])(
    "rejects unsupported transport %j",
    async (capabilities) => {
      const sender = new WebRtcSender();
      const prepared = sender.prepare(
        { protocol: "webrtc", input: { action: "connect", peerUrl: "peer" } },
        context(),
      );
      const execute = vi.fn(async () => response);
      await expect(
        sender.send(prepared, { ...capabilities, execute }, context()),
      ).rejects.toMatchObject({ code: "UNSUPPORTED_PROTOCOL" });
      expect(execute).not.toHaveBeenCalled();
    },
  );

  it("normalizes successful and unsuccessful responses", () => {
    const sender = new WebRtcSender();
    expect(sender.parse(response, context())).toMatchObject({
      ok: true,
      data: response.body,
      raw: response,
    });
    expect(sender.parse({ ...response, status: 404 }, context())).toMatchObject({
      ok: false,
      status: 404,
    });
  });
});

describe("receiver", () => {
  it.each([
    null,
    [],
    "body",
    {},
    { action: "invalid" },
    { action: "offer" },
    { action: "answer", answer: { type: "offer", sdp: "v=0" } },
    { action: "candidate", candidate: { candidate: "a", sdpMLineIndex: -1 } },
    { action: "connect", sessionId: "" },
  ])("rejects invalid body %j", (body) => {
    expect(() => new WebRtcReceiver().receive(incoming(body), context())).toThrow();
  });

  it("accepts answer and end-of-candidates messages", () => {
    const receiver = new WebRtcReceiver();
    expect(
      receiver.receive(
        incoming({ action: "answer", answer: { type: "answer", sdp: "v=0" } }),
        context(),
      ).action,
    ).toBe("answer");
    expect(
      receiver.receive(incoming({ action: "candidate", candidate: { candidate: "" } }), context())
        .candidate,
    ).toEqual({ candidate: "" });
  });

  it("reads peer header case-insensitively and rejects ambiguous identity", () => {
    const receiver = new WebRtcReceiver();
    expect(
      receiver.receive(incoming({ action: "connect" }, { "X-Peer-Id": "alice" }), context()).peerId,
    ).toBe("alice");
    expect(() =>
      receiver.receive(
        incoming({ action: "connect" }, { "x-peer-id": ["alice", "bob"] }),
        context(),
      ),
    ).toThrow();
  });

  it("uses configured handler and responds", async () => {
    const handler = vi.fn(() => ({ payload: "hello" }));
    const receiver = new WebRtcReceiver({ handler });
    const request = receiver.receive(incoming({ action: "connect" }), context());
    expect(receiver.respond(await receiver.handle(request, context()), context())).toMatchObject({
      status: 200,
      body: { payload: "hello" },
    });
    expect(handler).toHaveBeenCalledWith(request, expect.any(Object));
    expect(() => new WebRtcReceiver().handle(request, context())).toThrow("No application handler");
    const reason = new Error("cancelled");
    expect(() =>
      receiver.handle(request, { ...context(), signal: AbortSignal.abort(reason) }),
    ).toThrow(reason);
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it("creates independent protocol instances", () => {
    const first = createWebRtcProtocol({ handler: () => ({ payload: "ok" }) });
    const second = createWebRtcProtocol();
    expect(first.sender).not.toBe(second.sender);
    expect(first.receiver).not.toBe(WebRtcProtocol.receiver);
  });
});
