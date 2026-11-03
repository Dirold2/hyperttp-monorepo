/**
 * @ru Упаковывает Protobuf-байты в 5-байтовый gRPC фрейм.
 */
export function encodeGrpcFrame(payload: Uint8Array, compressed = false): Uint8Array {
  const frame = new Uint8Array(5 + payload.byteLength);
  frame[0] = compressed ? 1 : 0;

  const view = new DataView(frame.buffer, frame.byteOffset, frame.byteLength);
  view.setUint32(1, payload.byteLength, false); // Big-Endian length

  frame.set(payload, 5);
  return frame;
}

/**
 * @ru Распаковывает 5-байтовый gRPC фрейм в сырые Protobuf-байты.
 */
export function decodeGrpcFrame(frame: Uint8Array): { compressed: boolean; payload: Uint8Array } {
  if (frame.byteLength < 5) {
    throw new Error("Invalid gRPC frame: buffer too short");
  }

  const compressed = frame[0] === 1;
  const view = new DataView(frame.buffer, frame.byteOffset, frame.byteLength);
  const length = view.getUint32(1, false);

  const payload = frame.subarray(5, 5 + length);
  return { compressed, payload };
}
