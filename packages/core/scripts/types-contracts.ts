// This consumer intentionally imports no Core declarations or augmentations.
import type {
  CorePluginFactory,
  HyperClientOptions,
  HyperPlugin,
  RequestContext,
  RequestOutcome,
  ServerPluginContext,
  ServerRequestOutcome,
} from "@hyperttp/types";

export const factory: CorePluginFactory = () => ({
  name: "contract-check",
  shared: true,
  onServerRequest(request, _plugin, context) {
    const server: ServerPluginContext = context;
    void server;
    return request;
  },
  onServerResponse: (response) => response,
  onServerError: () => undefined,
  onServerSettled(outcome) {
    const final: ServerRequestOutcome = outcome;
    if (final.ok) void final.response.status;
    else void final.error;
  },
});

export const options: HyperClientOptions = { pluginFactories: [factory] };
export const plugin: HyperPlugin = factory();

export function settlement(context: RequestContext, outcome: RequestOutcome): void {
  context.onSettled?.((final) => {
    const result: RequestOutcome = final;
    void result;
  });
  if (outcome.ok) context.acceptFinalResponse?.(outcome.response);
}
