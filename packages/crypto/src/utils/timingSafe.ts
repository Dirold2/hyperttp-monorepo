/**
 * @ru Сравнивает две hex-строки за постоянное время без раннего выхода из цикла.
 * @en Compares two hexadecimal strings in constant time without early loop exits.
 */
export function timingSafeEqualHex(a: string, b: string): boolean {
  if (a.length !== b.length) return false;

  let mismatch = 0;
  for (let i = 0; i < a.length; i++) {
    mismatch |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }

  return mismatch === 0;
}
