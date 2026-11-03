import type { HyperProtocol } from "@hyperttp/types";
import type {
  WebRtcInput,
  WebRtcServerInput,
  WebRtcServerResponse,
  WebRtcServerHandler,
} from "./types/index.js";
import { WebRtcReceiver } from "./receiver.js";
import { WebRtcSender } from "./sender.js";

export function createWebRtcProtocol(
  options: { handler?: WebRtcServerHandler } = {},
): HyperProtocol<WebRtcInput, unknown, WebRtcServerInput, WebRtcServerResponse, "webrtc"> {
  return {
    protocol: "webrtc",
    name: "WebRtcProtocol",
    sender: new WebRtcSender(),
    receiver: new WebRtcReceiver(options),
  };
}

export const WebRtcProtocol = createWebRtcProtocol();

export { WebRtcReceiver } from "./receiver.js";
export { WebRtcSender } from "./sender.js";

export type {
  WebRtcTransportRequest,
  WebRtcAction,
  WebRtcInput,
  WebRtcLocalStream,
  WebRtcRequestOptions,
  WebRtcServerInput,
  WebRtcServerResponse,
  WebRtcServerHandler,
  WebRtcClientMethods,
} from "./types/index.js";

/** Opt-in control ACK; application messages require a separately supplied handler. */
export const webRtcControlHandler: WebRtcServerHandler = (request) => {
  if (request.action === "connect" || request.action === "stream") {
    return { status: 200, sessionId: request.sessionId };
  }
  return { status: 501, payload: { error: "No application handler for this action." } };
};
