import { describe, expect, it, vi } from "vitest";
import type { RequestContext } from "@hyperttp/types";
import { decodeGrpcFrame, encodeGrpcFrame, GrpcSender, GrpcTestTransport } from "../src/index.js";

const context = (): RequestContext => ({
  requestId: "grpc-test",
  startTime: 0,
  meta: {},
  state: {},
});
const bytes = new Uint8Array([0, 1, 127, 255]);

describe("gRPC framing", () => {
  it.each([false, true])("round-trips binary payload (compressed=%s)", (compressed) => {
    const frame = encodeGrpcFrame(bytes, compressed);
    expect([...frame.subarray(0, 5)]).toEqual([Number(compressed), 0, 0, 0, 4]);
    expect(decodeGrpcFrame(frame)).toEqual({ compressed, payload: bytes });
  });
  it("supports an empty payload and an offset Uint8Array", () => {
    expect(decodeGrpcFrame(encodeGrpcFrame(new Uint8Array())).payload).toHaveLength(0);
    const frame = encodeGrpcFrame(bytes);
    const buffer = new Uint8Array(frame.length + 6);
    buffer.set(frame, 3);
    expect(decodeGrpcFrame(buffer.subarray(3, 3 + frame.length)).payload).toEqual(bytes);
  });
  it.each([0, 1, 4])("rejects a %s-byte header", (length) => {
    expect(() => decodeGrpcFrame(new Uint8Array(length))).toThrow(/too short/);
  });
});

describe("gRPC sender pipeline", () => {
  it("prepares, sends through a test transport and decodes the response", async () => {
    const sender = new GrpcSender({ baseUrl: "https://grpc.example/" });
    const ctx = context();
    const decode = vi.fn((payload: Uint8Array) => [...payload]);
    const signal = new AbortController().signal;
    const prepared = sender.prepare(
      {
        protocol: "grpc",
        signal,
        input: {
          service: "api.Echo",
          method: "Call",
          message: bytes,
          encode: () => bytes,
          decode,
        },
        metadata: { headers: { authorization: "Bearer test" } },
      },
      ctx,
    );
    expect(prepared).toMatchObject({
      method: "POST",
      protocol: "grpc",
      url: "https://grpc.example/api.Echo/Call",
      signal,
      headers: { "content-type": "application/grpc", te: "trailers", authorization: "Bearer test" },
    });
    const handler = vi.fn((_service: string, _method: string, payload: Uint8Array) => ({
      body: payload,
    }));
    const transport = new GrpcTestTransport(handler);
    const raw = await sender.send(prepared, transport, ctx);
    const result = sender.parse(raw, ctx);
    expect(handler).toHaveBeenCalledWith("api.Echo", "Call", bytes);
    expect(decode).toHaveBeenCalledWith(bytes);
    expect(result).toMatchObject({
      ok: true,
      status: 200,
      protocol: "grpc",
      data: { grpcStatus: 0, data: [...bytes] },
    });
    expect(result.raw).toBe(raw);
  });
  it("returns grpc errors without trying to decode a payload", () => {
    const sender = new GrpcSender();
    const result = sender.parse(
      {
        status: 200,
        headers: { "Grpc-Status": "7", "Grpc-Message": "Permission%20denied" },
        body: null,
      },
      context(),
    );
    expect(result).toMatchObject({
      ok: false,
      data: { ok: false, grpcStatus: 7, grpcMessage: "Permission denied" },
    });
  });
  it("marks HTTP failures unsuccessful and preserves malformed message escaping", () => {
    const result = new GrpcSender().parse(
      { status: 503, headers: { "grpc-message": "%invalid" }, body: null },
      context(),
    );
    expect(result.ok).toBe(false);
    expect(result.data.grpcMessage).toBe("%invalid");
  });
  it("propagates transport failures", async () => {
    const error = new Error("connection failed");
    await expect(
      new GrpcSender().send(
        { method: "POST", url: "/", protocol: "grpc", headers: {} },
        {
          execute: async () => {
            throw error;
          },
        },
        context(),
      ),
    ).rejects.toBe(error);
  });
});
