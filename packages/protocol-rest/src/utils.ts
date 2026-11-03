export const DEFAULT_STATUS_TEXTS: Readonly<Record<number, string>> = {
  200: "OK",
  201: "Created",
  204: "No Content",
  400: "Bad Request",
  401: "Unauthorized",
  403: "Forbidden",
  404: "Not Found",
  500: "Internal Server Error",
};

export function getHeaderValue(
  headers: Readonly<Record<string, string | string[]>>,
  name: string,
): string | undefined {
  const direct = headers[name] ?? headers[name.toLowerCase()];
  if (direct !== undefined) return Array.isArray(direct) ? direct[0] : direct;

  const target = name.toLowerCase();
  for (const key in headers) {
    if (key.toLowerCase() === target) {
      const value = headers[key];
      return Array.isArray(value) ? value[0] : value;
    }
  }
}
