import type {
  HyperSender,
  HyperTransport,
  RequestContext,
  SendRequest,
  TransportRequest,
  TransportResponse,
  UniversalResponse,
} from "@hyperttp/types";
import type { RestInput, RestClientMethods } from "./types.js";

export class RestSender
  implements HyperSender<RestInput, unknown, TransportRequest, TransportResponse>
{
  readonly protocol = "http";

  readonly methods?: RestClientMethods;

  constructor() {}

  prepare(request: SendRequest<RestInput, string>, _ctx: RequestContext): TransportRequest {
    const { input, signal } = request;
    let fullUrl = input.url;

    if (input.query) {
      const searchParams = new URLSearchParams();
      for (const [key, value] of Object.entries(input.query)) {
        if (Array.isArray(value)) {
          value.forEach((v) => searchParams.append(key, String(v)));
        } else if (value !== undefined) {
          searchParams.append(key, String(value));
        }
      }
      const queryString = searchParams.toString();
      if (queryString) {
        fullUrl += (fullUrl.includes("?") ? "&" : "?") + queryString;
      }
    }

    return {
      method: input.method,
      url: fullUrl,
      headers: input.headers ?? {},
      body: input.body,
      signal,
      protocol: this.protocol,
    };
  }

  async send(
    prepared: TransportRequest,
    transport: HyperTransport,
    _ctx: RequestContext,
  ): Promise<TransportResponse> {
    return transport.execute(prepared);
  }

  parse(
    raw: TransportResponse,
    _ctx: RequestContext,
  ): UniversalResponse<unknown> {
    const ok = raw.status >= 200 && raw.status < 300;

    return {
      protocol: this.protocol,
      ok,
      status: raw.status,
      headers: raw.headers,
      url: raw.url,
      data: raw.body,
      raw,
    };
  }
}
