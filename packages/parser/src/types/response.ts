import type { RequestContext, SendRequest, UniversalResponse } from "@hyperttp/types";

export type ResponseType = "auto" | "json" | "text" | "html" | "xml" | "buffer" | "stream";
export interface ConversionMeta {
  contentType?: string;
  contentEncoding?: string;
  url?: string;
}

export type ParserCallback<T> = (
  response: UniversalResponse,
  request?: SendRequest,
  ctx?: RequestContext,
) => T | Promise<T>;

export type ParserDataExtractor = ParserCallback<unknown>;
export type ParserResponseTypeDetector = ParserCallback<ResponseType>;
export type ParserPredicate = ParserCallback<boolean>;

export interface ResponseConverterOptions {
  charset?: BufferEncoding;
  maxBodySize?: number;
  parseHTML?: boolean;
  htmlMode?: "simple" | "full";
  xmlParserOptions?: Record<string, unknown>;
  xmlBuilderOptions?: Record<string, unknown>;
  parseErrors?: boolean;
  shouldParse?: ParserPredicate;
  getData?: ParserDataExtractor;
  /** Alias for `getData`. */
  bodyExtractor?: ParserDataExtractor;
  getResponseType?: ParserResponseTypeDetector;
  /** Alias for `getResponseType`. */
  detectResponseType?: ParserResponseTypeDetector;
  isEmptyResponse?: ParserPredicate;
}

export type ParsedResponse = string | Buffer | Record<string, any> | any[] | null | any;

export interface ParsableRequest extends SendRequest {
  metadata?: Readonly<Record<string, unknown>>;
}

export type ParserRequestContext = RequestContext;
export type ParserResponseType = ResponseType;
