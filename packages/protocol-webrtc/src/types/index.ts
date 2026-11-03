import type { ServerRequestContext, TransportRequest, UniversalResponse } from "@hyperttp/types";

export type WebRtcAction = "connect" | "stream" | "datachannel" | "offer" | "answer" | "candidate";

/** Opaque media handle: interpreted by the selected browser or server transport. */
export interface WebRtcLocalStream {
  getTracks(): readonly { readonly kind: string; readonly id?: string | undefined }[];
}

export interface WebRtcInput {
  readonly action: WebRtcAction;
  readonly peerUrl: string;
  readonly sessionId?: string | undefined;
  readonly offer?: RTCSessionDescriptionInit | undefined;
  readonly answer?: RTCSessionDescriptionInit | undefined;
  readonly candidate?: RTCIceCandidateInit | undefined;
  readonly iceServers?: RTCIceServer[] | undefined;
  readonly localStream?: WebRtcLocalStream | undefined;
  readonly dataChannelPayload?: unknown;
  readonly channelLabel?: string | undefined;
  readonly timeout?: number | undefined;
  readonly signal?: AbortSignal | undefined;
  receiveAudio?: boolean;
  receiveVideo?: boolean;
}

/** Extra fields must be interpreted by a WebRTC-aware transport, not serialized as media. */
export interface WebRtcTransportRequest extends TransportRequest {
  readonly peerUrl: string;
  readonly timeout?: number | undefined;
  readonly iceServers?: RTCIceServer[] | undefined;
  readonly localStream?: WebRtcLocalStream | undefined;
  readonly receiveAudio?: boolean | undefined;
  readonly receiveVideo?: boolean | undefined;
  readonly dataChannelPayload?: unknown;
  readonly channelLabel?: string | undefined;
}

export type WebRtcRequestOptions = Omit<WebRtcInput, "action" | "peerUrl">;

export interface WebRtcServerInput {
  readonly action: WebRtcAction;
  readonly peerId: string;
  readonly sessionId?: string | undefined;
  readonly answer?: RTCSessionDescriptionInit | undefined;
  readonly headers: Readonly<Record<string, string | string[]>>;
  readonly offer?: RTCSessionDescriptionInit | undefined;
  readonly candidate?: RTCIceCandidateInit | undefined;
  readonly payload?: unknown;
}

export interface WebRtcServerResponse {
  readonly sessionId?: string | undefined;
  readonly status?: number | undefined;
  readonly answer?: RTCSessionDescriptionInit | undefined;
  readonly candidate?: RTCIceCandidateInit | undefined;
  readonly payload?: unknown;
  readonly headers?: Record<string, string> | undefined;
}

export type WebRtcServerHandler = (
  request: WebRtcServerInput,
  ctx: ServerRequestContext,
) => WebRtcServerResponse | Promise<WebRtcServerResponse>;

export interface WebRtcClientMethods {
  connect<T = unknown>(
    peerUrl: string,
    options?: WebRtcRequestOptions,
    signal?: AbortSignal,
  ): Promise<UniversalResponse<T>>;

  receive<T = unknown>(
    peerUrl: string,
    options?: Omit<WebRtcRequestOptions, "localStream">,
    signal?: AbortSignal,
  ): Promise<UniversalResponse<T>>;

  stream<T = unknown>(
    peerUrl: string,
    localStream: WebRtcLocalStream,
    options?: Omit<WebRtcRequestOptions, "localStream">,
    signal?: AbortSignal,
  ): Promise<UniversalResponse<T>>;

  dataChannel<T = unknown>(
    peerUrl: string,
    payload: unknown,
    options?: Omit<WebRtcRequestOptions, "dataChannelPayload">,
    signal?: AbortSignal,
  ): Promise<UniversalResponse<T>>;
}

declare module "@hyperttp/types" {
  interface ProtocolInputMap {
    webrtc: WebRtcInput;
  }

  interface ProtocolServerRequestMap {
    webrtc: WebRtcServerInput;
  }

  interface ProtocolServerResponseMap {
    webrtc: WebRtcServerResponse;
  }

  interface HyperProtocols {
    readonly webrtc: WebRtcClientMethods;
  }
}
