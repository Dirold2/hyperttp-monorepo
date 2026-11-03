import type {
  HyperReceiver,
  ServerRequestContext,
  TransportRequest,
  TransportResponse,
} from "@hyperttp/types";
import type {
  WebRtcServerHandler,
  WebRtcServerInput,
  WebRtcServerResponse,
} from "./types/index.js";
import { invalidSignal, parseSignal } from "./utils/signaling.js";
import { HyperClientError } from "./utils/errors.js";
import { DEFAULT_STATUS_TEXTS } from "./utils/utils.js";

export class WebRtcReceiver implements HyperReceiver<
  WebRtcServerInput,
  WebRtcServerResponse,
  TransportRequest,
  TransportResponse
> {
  readonly protocol = "webrtc";
  protected readonly handler: WebRtcServerHandler | undefined;

  constructor(options: { handler?: WebRtcServerHandler } = {}) {
    this.handler = options.handler;
  }

  receive(raw: TransportRequest, _ctx: ServerRequestContext): WebRtcServerInput {
    const body = parseSignal(raw.body);
    const peerHeader = Object.entries(raw.headers).find(
      ([name]) => name.toLowerCase() === "x-peer-id",
    )?.[1];
    if (peerHeader !== undefined && (typeof peerHeader !== "string" || !peerHeader.trim())) {
      invalidSignal("x-peer-id must be a non-empty string.");
    }
    return {
      ...body,
      peerId: peerHeader ?? "unknown",
      headers: raw.headers,
    };
  }

  handle(
    request: WebRtcServerInput,
    ctx: ServerRequestContext,
  ): WebRtcServerResponse | Promise<WebRtcServerResponse> {
    if (ctx.signal?.aborted) {
      throw ctx.signal.reason ?? new Error("Request aborted");
    }

    if (!this.handler) {
      throw new HyperClientError(
        '[WebRtcReceiver] No application handler registered for protocol "webrtc".',
      );
    }

    return this.handler(request, ctx);
  }

  respond(response: WebRtcServerResponse, _ctx: ServerRequestContext): TransportResponse {
    const status = response.status ?? 200;
    return {
      status,
      statusText: DEFAULT_STATUS_TEXTS[status] ?? "",
      headers: { "content-type": "application/json", ...response.headers },
      body: {
        sessionId: response.sessionId,
        answer: response.answer,
        candidate: response.candidate,
        payload: response.payload,
      },
    };
  }
}
