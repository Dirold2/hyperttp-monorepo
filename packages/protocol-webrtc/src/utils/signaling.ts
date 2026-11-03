import type { WebRtcAction } from "../types/index.js";
import { HyperClientError } from "./errors.js";

export function invalidSignal(message: string): never {
  throw new HyperClientError(message, "INVALID_WEBRTC_SIGNAL", 400);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function parseSignal(value: unknown) {
  if (!isRecord(value)) invalidSignal("WebRTC body must be an object.");
  const { action, sessionId, offer, answer, candidate } = value;
  if (
    action !== "connect" &&
    action !== "stream" &&
    action !== "datachannel" &&
    action !== "offer" &&
    action !== "answer" &&
    action !== "candidate"
  )
    invalidSignal("Invalid WebRTC action.");
  if (sessionId !== undefined && (typeof sessionId !== "string" || !sessionId.trim())) {
    invalidSignal("sessionId must be a non-empty string.");
  }
  for (const [name, description] of [
    ["offer", offer],
    ["answer", answer],
  ] as const) {
    if (
      description !== undefined &&
      (!isRecord(description) ||
        description.type !== name ||
        typeof description.sdp !== "string" ||
        !description.sdp.trim())
    )
      invalidSignal(`Invalid WebRTC ${name}.`);
  }
  if (candidate !== undefined) {
    if (!isRecord(candidate) || typeof candidate.candidate !== "string") {
      invalidSignal("Invalid ICE candidate.");
    }
    for (const key of ["sdpMid", "usernameFragment"] as const) {
      if (
        candidate[key] !== undefined &&
        candidate[key] !== null &&
        typeof candidate[key] !== "string"
      ) {
        invalidSignal(`Invalid ICE candidate ${key}.`);
      }
    }
    const index = candidate.sdpMLineIndex;
    if (
      index !== undefined &&
      index !== null &&
      (typeof index !== "number" || !Number.isInteger(index) || index < 0 || index > 65535)
    ) {
      invalidSignal("Invalid ICE candidate sdpMLineIndex.");
    }
  }
  if (action === "offer" && offer === undefined) invalidSignal("Offer action requires offer.");
  if (action === "answer" && answer === undefined) invalidSignal("Answer action requires answer.");
  if (action === "candidate" && candidate === undefined)
    invalidSignal("Candidate action requires candidate.");
  return {
    action: action as WebRtcAction,
    sessionId: sessionId as string | undefined,
    offer: offer as RTCSessionDescriptionInit | undefined,
    answer: answer as RTCSessionDescriptionInit | undefined,
    candidate: candidate as RTCIceCandidateInit | undefined,
    payload: value.payload,
  };
}
