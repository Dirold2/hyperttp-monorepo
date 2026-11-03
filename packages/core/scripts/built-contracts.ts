import { HyperCore } from "../dist/index.js";
import type { CorePluginFactory } from "../dist/index.js";
import { withInflight } from "../../hyperttp-inflight/dist/index.js";
import { withQueue } from "../../hyperttp-queue/dist/index.js";
import type {
  HyperPlugin,
  RequestContext,
  RequestOutcome,
  UniversalResponse,
} from "@hyperttp/types";

const factories: readonly CorePluginFactory[] = [
  () => withQueue({ maxConcurrent: 2 }),
  () => withInflight(),
];

// Compile-only consumer: all four built declaration entry points share one type contract.
export function checkBuiltContracts(context: RequestContext, outcome: RequestOutcome): void {
  const shared: HyperPlugin = { name: "stateless", shared: true };
  const core = new HyperCore({ pluginFactories: factories, plugins: [shared] });
  const response: Promise<UniversalResponse<{ id: string }>> = core.send<{ id: string }>({
    protocol: "rest",
    input: { method: "GET", url: "/compile-only" },
  });
  void response;
  context.onSettled?.((result) => {
    const final: RequestOutcome = result;
    void final;
  });
  if (outcome.ok) context.acceptFinalResponse?.(outcome.response);
}
