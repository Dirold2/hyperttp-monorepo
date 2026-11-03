export function safeHeader(headers: unknown, key: string): string | undefined {
  if (!headers) return undefined;

  const lookup = key.toLowerCase();

  if (typeof Headers !== "undefined" && headers instanceof Headers) {
    return headers.get(key) ?? headers.get(lookup) ?? undefined;
  }

  if (typeof headers !== "object") return undefined;

  const obj = headers as Record<string, unknown>;

  const direct =
    obj[key] ??
    obj[lookup] ??
    obj[key.toUpperCase()] ??
    obj[key.replace(/(^|-)(\w)/g, (_, p1, p2) => p1 + p2.toUpperCase())];

  if (typeof direct === "string") return direct;
  if (Array.isArray(direct) && typeof direct[0] === "string") return direct[0];

  for (const [k, v] of Object.entries(obj)) {
    if (k.toLowerCase() !== lookup) continue;

    if (typeof v === "string") return v;
    if (Array.isArray(v) && typeof v[0] === "string") return v[0];
    if (v != null) return String(v);
  }

  return undefined;
}

export function normalizeHeaders(headers: unknown): {
  contentType?: string;
  contentEncoding?: string;
} {
  return {
    contentType: safeHeader(headers, "content-type"),
    contentEncoding: safeHeader(headers, "content-encoding"),
  };
}
