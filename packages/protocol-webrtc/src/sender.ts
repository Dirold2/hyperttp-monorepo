import type {
  HyperSender,
  HyperTransport,
  IHyperCore,
  RequestContext,
  SendRequest,
  TransportResponse,
  UniversalResponse,
} from "@hyperttp/types";
import type { WebRtcInput, WebRtcRequestOptions, WebRtcTransportRequest } from "./types/index.js";
import { HyperClientError, TimeoutError } from "./utils/errors.js";
import { applyTimeout } from "./utils/abort.js";
import { DEFAULT_STATUS_TEXTS } from "./utils/utils.js";

export class WebRtcSender implements HyperSender<
  WebRtcInput,
  unknown,
  WebRtcTransportRequest,
  TransportResponse
> {
  readonly protocol = "webrtc";

  readonly methods: Readonly<Record<string, (...args: any[]) => any>> = {
    connect: (
      core: IHyperCore,
      peerUrl: string,
      options?: WebRtcRequestOptions,
      signal?: AbortSignal,
    ) =>
      this.dispatch(core, {
        action: "connect",
        peerUrl,
        ...options,
        ...(signal || options?.signal ? { signal: signal ?? options?.signal } : {}),
      }),

    receive: (
      core: IHyperCore,
      peerUrl: string,
      options?: Omit<WebRtcRequestOptions, "localStream">,
      signal?: AbortSignal,
    ) =>
      this.dispatch(core, {
        action: "stream",
        peerUrl,
        receiveAudio: true,
        ...options,
        ...(signal || options?.signal ? { signal: signal ?? options?.signal } : {}),
      }),

    stream: (
      core: IHyperCore,
      peerUrl: string,
      localStream: NonNullable<WebRtcInput["localStream"]>,
      options?: Omit<WebRtcRequestOptions, "localStream">,
      signal?: AbortSignal,
    ) =>
      this.dispatch(core, {
        action: "stream",
        peerUrl,
        ...options,
        localStream,
        ...(signal || options?.signal ? { signal: signal ?? options?.signal } : {}),
      }),

    dataChannel: (
      core: IHyperCore,
      peerUrl: string,
      payload: unknown,
      options?: Omit<WebRtcRequestOptions, "dataChannelPayload">,
      signal?: AbortSignal,
    ) =>
      this.dispatch(core, {
        action: "datachannel",
        peerUrl,
        ...options,
        dataChannelPayload: payload,
        ...(signal || options?.signal ? { signal: signal ?? options?.signal } : {}),
      }),
  };

  prepare(request: SendRequest<WebRtcInput, string>, ctx: RequestContext): WebRtcTransportRequest {
    const { input } = request;
    const inputSignal = request.signal ?? input.signal ?? ctx.signal;

    return {
      method: "POST",
      url: input.peerUrl,
      headers: { "content-type": "application/json" },
      body: {
        action: input.action,
        payload: input.dataChannelPayload,
        sessionId: input.sessionId,
        offer: input.offer,
        answer: input.answer,
        candidate: input.candidate,
      },
      ...(inputSignal ? { signal: inputSignal } : {}),
      timeout: input.timeout,
      protocol: this.protocol,
      peerUrl: input.peerUrl,
      iceServers: input.iceServers,
      localStream: input.localStream,
      ...(input.receiveAudio !== undefined ? { receiveAudio: input.receiveAudio } : {}),
      ...(input.receiveVideo !== undefined ? { receiveVideo: input.receiveVideo } : {}),
      dataChannelPayload: input.dataChannelPayload,
      channelLabel: input.channelLabel,
    };
  }

  async send(
    prepared: WebRtcTransportRequest,
    transport: HyperTransport,
    _ctx: RequestContext,
  ): Promise<TransportResponse> {
    const timeoutMeta: { cleanupSignal?: () => void } = {};
    try {
      if (
        transport.supports
          ? !transport.supports(this.protocol)
          : transport.protocols && !transport.protocols.includes(this.protocol)
      ) {
        throw new HyperClientError('Transport does not support "webrtc".', "UNSUPPORTED_PROTOCOL");
      }
      const signal = applyTimeout(
        prepared.signal,
        prepared.timeout,
        timeoutMeta,
        () => new TimeoutError(prepared.peerUrl, prepared.timeout!),
      );
      signal?.throwIfAborted();
      return await transport.execute({ ...prepared, ...(signal ? { signal } : {}) });
    } finally {
      timeoutMeta.cleanupSignal?.();
    }
  }

  parse(raw: TransportResponse, _ctx: RequestContext): UniversalResponse<unknown> {
    const ok = raw.status >= 200 && raw.status < 300;
    return {
      protocol: this.protocol,
      ok,
      status: raw.status,
      statusText: raw.statusText || DEFAULT_STATUS_TEXTS[raw.status] || "",
      headers: raw.headers,
      ...(raw.url !== undefined ? { url: raw.url } : {}),
      data: raw.body,
      raw,
    };
  }

  private dispatch(core: IHyperCore, input: WebRtcInput): Promise<UniversalResponse<unknown>> {
    return core.send<WebRtcInput, unknown, "webrtc">({
      protocol: "webrtc",
      input,
      ...(input.signal ? { signal: input.signal } : {}),
    });
  }
}
