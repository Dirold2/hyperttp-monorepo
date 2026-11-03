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
