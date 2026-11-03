import type { CryptoBody } from "../types/index.js";

const encoder = new TextEncoder();

function isJsonValue(value: unknown, ancestors = new Set<object>()): boolean {
  if (value === null || typeof value === "string" || typeof value === "boolean") return true;
  if (typeof value === "number") return Number.isFinite(value);
  if (typeof value !== "object" || ancestors.has(value)) return false;

  const prototype = Object.getPrototypeOf(value);
  if (!Array.isArray(value) && prototype !== Object.prototype && prototype !== null) return false;
  if ("toJSON" in value) return false;

  ancestors.add(value);
  const valid = (Array.isArray(value) ? Array.from(value) : Object.values(value)).every((item) =>
    isJsonValue(item, ancestors),
  );
  ancestors.delete(value);
  return valid;
}

/**
 * @ru Кодирует точное представление тела, поддерживаемое криптографическими плагинами.
 * @en Encodes the exact body representation supported by crypto plugins.
 */
export function bodyToBytes(body: CryptoBody | undefined): Uint8Array<ArrayBuffer> {
  if (body === undefined) return new Uint8Array();
  if (typeof body === "string") return encoder.encode(body);
  if (body instanceof ArrayBuffer) return new Uint8Array(body.slice(0));
  if (ArrayBuffer.isView(body)) {
    return Uint8Array.from(new Uint8Array(body.buffer, body.byteOffset, body.byteLength));
  }

  if (!isJsonValue(body)) {
    throw new TypeError("Unsupported crypto body: expected a string, binary data, or a JSON value");
  }
  return encoder.encode(JSON.stringify(body));
}

/**
 * @ru Кодирует байты в стандартную Base64-строку.
 * @en Encodes bytes as a standard Base64 string.
 */
export function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

/**
 * @ru Кодирует байты в hex-строку в нижнем регистре.
 * @en Encodes bytes as a lowercase hexadecimal string.
 */
export function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

/**
 * @ru Декодирует hex-строку в байты.
 * @en Decodes a hexadecimal string into bytes.
 */
export function hexToBytes(hex: string): Uint8Array {
  const bytes = new Uint8Array(hex.length / 2);
  for (let index = 0; index < bytes.length; index++) {
    bytes[index] = Number.parseInt(hex.slice(index * 2, index * 2 + 2), 16);
  }
  return bytes;
}
