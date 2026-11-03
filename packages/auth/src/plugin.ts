import type { HyperPlugin } from "@hyperttp/types";
import {
  AUTH_IDENTITY_STATE_KEY,
  applyCredentials,
  assertAuthConfiguration,
  isAllowedOrigin,
  normalizeOrigins,
  resolveAuthOptions,
} from "./auth.js";
import type { AuthPluginOptions } from "./types.js";

declare module "@hyperttp/types" {
  interface HyperClientOptions {
    /** Used by withAuth() when no explicit options are provided. */
    auth?: AuthPluginOptions;
  }
}

/** Creates a blocking START-phase plugin for outgoing authentication. */
export function withAuth(options?: AuthPluginOptions): HyperPlugin {
  function configure(config: AuthPluginOptions) {
    assertAuthConfiguration(config);
    const resolved = resolveAuthOptions(config);
    return {
      options: config,
      resolved,
      allowedOrigins: normalizeOrigins(config.allowedOrigins),
      protocol: resolved.credentials ? "rest" : config.protocol,
    };
  }

  let configuration = options ? configure(options) : undefined;

  return {
    name: "hyperttp-auth",
    phase: "START",
    mode: "blocking",
    setup(context) {
      // Resolve per core registration, so a reused plugin cannot retain another
      // core's fallback config when this core has no auth configuration.
      const config = options ?? context.config.auth;
      configuration = config ? configure(config) : undefined;
    },
    onRequest: async (request, _pluginContext, requestContext) => {
      const current = configuration;
      if (!current) return;
      const { options, resolved, protocol, allowedOrigins } = current;

      if (requestContext) {
        delete requestContext.state[AUTH_IDENTITY_STATE_KEY];
        delete requestContext.state["@hyperttp/auth.applied"];
      }
      if (protocol && request.protocol !== protocol) return;
      if (!isAllowedOrigin(request, allowedOrigins)) return;
      if (
        options.shouldAuthenticate &&
        !(await options.shouldAuthenticate(request, requestContext))
      )
        return;

      if (resolved.identityProvider && requestContext) {
        const identity = await resolved.identityProvider();
        if (identity) requestContext.state[AUTH_IDENTITY_STATE_KEY] = identity;
      }

      // Mark even custom adapters conservatively; no secret is stored in state.
      if (requestContext) requestContext.state["@hyperttp/auth.applied"] = true;
      let authenticatedRequest = request;
      if (resolved.credentials) {
        authenticatedRequest = await applyCredentials(authenticatedRequest, resolved.credentials);
      }
      if (options.apply) {
        const result = await options.apply(authenticatedRequest, { requestContext });
        authenticatedRequest = result ?? authenticatedRequest;
      }
      return authenticatedRequest;
    },
  };
}
