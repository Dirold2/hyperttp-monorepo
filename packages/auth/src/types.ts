import type { HyperProtocolName, RequestContext, SendRequest } from "@hyperttp/types";

export type MaybePromise<T> = T | Promise<T>;
export type ValueProvider = () => MaybePromise<string | null | undefined>;

export interface AuthPluginOptions {
  /** Restrict a custom adapter to one protocol. Built-in credentials support REST only. */
  protocol?: HyperProtocolName;
  /**
   * Trusted HTTP(S) origins. Required and non-empty for built-in credentials.
   * Requests with relative or unparseable URLs are skipped when configured.
   */
  allowedOrigins?: readonly string[];
  /**
   * Stable, non-secret identity used by cache or inflight plugins to scope their
   * keys. Never return an access token or another credential here.
   */
  getCacheKey?: ValueProvider;
  /** Additional predicate used to skip authentication for an individual request. */
  shouldAuthenticate?: (request: SendRequest, context?: RequestContext) => MaybePromise<boolean>;
  /** Apply protocol-specific credentials to a request. */
  apply?: AuthApply;
  /** Built-in REST credential configuration. */
  credentials?: AuthCredentials;
  /** Convenience configuration for REST-like inputs with `url` and `headers`. */
  rest?: RestCredentials;
  /** Shorthand for a Bearer credential. */
  bearer?: BearerCredentials;
}

export interface AuthApplyContext {
  readonly requestContext?: RequestContext;
}

export type AuthApply = (
  request: SendRequest,
  context: AuthApplyContext,
) => MaybePromise<SendRequest | void>;

export interface BearerCredentials {
  readonly type?: "bearer";
  readonly getToken: ValueProvider;
  readonly getCacheKey?: ValueProvider;
}

export interface BasicCredentials {
  readonly type: "basic";
  readonly username: string | ValueProvider;
  readonly getPassword: ValueProvider;
  readonly getCacheKey?: ValueProvider;
}

export interface ApiKeyCredentials {
  readonly type: "api-key";
  readonly name: string;
  readonly getValue: ValueProvider;
  readonly getCacheKey?: ValueProvider;
}

export type AuthCredentials = BearerCredentials | BasicCredentials | ApiKeyCredentials;

export type RestCredentials =
  | BearerCredentials
  | BasicCredentials
  | (ApiKeyCredentials & { readonly location: "header" | "query" });
