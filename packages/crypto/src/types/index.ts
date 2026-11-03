export type DigestAlgorithm = "SHA-256" | "SHA-384" | "SHA-512";

export interface ContentDigestOptions {
  /**
   * @ru Алгоритм хеширования для вычисления HTTP Content-Digest.
   * @en Hash algorithm used to calculate the HTTP Content-Digest value.
   */
  algorithm?: DigestAlgorithm;
  /**
   * @ru Заголовок для структурированного значения digest.
   * @en Header used for the structured digest value.
   */
  headerName?: string;
}

export interface HmacSignerOptions {
  /**
   * @ru Секретный HMAC-ключ; строка кодируется в UTF-8.
   * @en Secret HMAC key, encoded as UTF-8 when supplied as a string.
   */
  secret: string | ArrayBuffer;
  algorithm?: DigestAlgorithm;
  headerName?: string;
  timestampHeaderName?: string;
  nonceHeaderName?: string;
  /**
   * @ru Заголовки, включаемые в подпись в переданном порядке.
   * @en Headers included in the signature in the provided order.
   */
  includeHeaders?: readonly string[];
}

export type CryptoBody = string | ArrayBuffer | ArrayBufferView | JsonValue;
export type JsonPrimitive = boolean | number | string | null;
export type JsonValue =
  | JsonPrimitive
  | readonly JsonValue[]
  | { readonly [key: string]: JsonValue };

export interface CanonicalOptions {
  url: string;
  method: string;
  body?: CryptoBody;
  timestamp: string;
  nonce?: string;
  headers?: HeadersInit;
  includeHeaders?: readonly string[];
}

/**
 * @ru Данные HTTP-запроса, поддерживаемые криптографическими плагинами.
 * @en HTTP request data supported by the crypto plugins.
 */
export interface HttpRequestInput {
  url: string;
  method: string;
  body?: CryptoBody;
  headers?: HeadersInit;
}

export interface HmacVerificationOptions extends HmacSignerOptions {
  timestamp: string;
  signature: string;
  nonce?: string;
  maxAgeMs?: number;
  now?: number;
}

export interface WithCryptoOptions {
  /**
   * @ru Включает генерацию HTTP Content-Digest; по умолчанию включено.
   * @en Enables HTTP Content-Digest generation. Defaults to true.
   */
  digest?: false | ContentDigestOptions;
  /**
   * @ru Включает HMAC-подпись; при настройке требуется секрет.
   * @en Enables HMAC signing. A secret is required when configured.
   */
  hmac?: HmacSignerOptions;
}

/**
 * @ru Атомарное хранилище replay-защиты, реализуемое сервером-потребителем.
 * @en Atomic replay-protection storage implemented by the consuming server.
 */
export interface NonceStore {
  /**
   * @ru Сохраняет nonce на ttlMs и возвращает false, если он уже использован.
   * @en Records nonce for ttlMs and returns false if it has already been consumed.
   */
  consume(nonce: string, ttlMs: number): Promise<boolean> | boolean;
}

export interface IncomingHmacVerificationOptions {
  secret: string | ArrayBuffer;
  nonceStore: NonceStore;
  algorithm?: DigestAlgorithm;
  headerName?: string;
  timestampHeaderName?: string;
  nonceHeaderName?: string;
  includeHeaders?: readonly string[];
  maxAgeMs?: number;
  now?: number;
}
