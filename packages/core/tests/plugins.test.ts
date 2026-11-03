import { describe, expect, expectTypeOf, it, vi } from "vitest";
import { HyperClientError, HyperCore } from "../src/index.js";
import type { CorePluginFactory } from "../src/index.js";
import type { HyperClientOptions, HyperPlugin, HyperTransport } from "@hyperttp/types";

function makeTransport(): HyperTransport {
  return {
    async execute(request) {
      return {
        status: 200,
        headers: { "content-type": "application/json" },
        url: request.url,
        body: new TextEncoder().encode("{}"),
      };
    },
  };
}

describe("plugin factories and ownership", () => {
  it("accepts optional readonly factory lists without changing existing plugin options", () => {
    const factory: CorePluginFactory = () => ({ name: "factory-plugin" });
    const factories: readonly CorePluginFactory[] = [factory];
    const options: HyperClientOptions = { pluginFactories: factories };

    expectTypeOf(options.pluginFactories).toEqualTypeOf<
      readonly (() => HyperPlugin)[] | undefined
    >();
    expectTypeOf<HyperPlugin["shared"]>().toEqualTypeOf<boolean | undefined>();
    const legacyOptions: HyperClientOptions = {};
    expect(legacyOptions.pluginFactories).toBeUndefined();
    expect(options.pluginFactories).toBe(factories);
  });

  it("creates a fresh plugin per constructor, extend(), and create()", async () => {
    const instances: HyperPlugin[] = [];
    const setup = vi.fn();
    const counts: number[] = [];
    const factory = vi.fn((): HyperPlugin => {
      const index = instances.length;
      counts.push(0);
      const plugin: HyperPlugin = {
        name: "stateful",
        setup,
        onRequest() {
          counts[index] = counts[index]! + 1;
        },
      };
      instances.push(plugin);
      return plugin;
    });
    const config: HyperClientOptions = { pluginFactories: [factory] };
    const first = new HyperCore(config, makeTransport());
    const second = new HyperCore(config, makeTransport());
    const extended = first.extend({});
    const created = first.create({ customTransport: makeTransport() });

    expect(factory).toHaveBeenCalledTimes(4);
    expect(new Set(instances).size).toBe(4);
    expect(setup).toHaveBeenCalledTimes(4);
    expect(setup.mock.calls.map(([context]) => context.core)).toEqual([
      first,
      second,
      extended,
      created,
    ]);

    await first.rest.get("/first");
    await first.rest.get("/first-again");
    await second.rest.get("/second");
    await extended.rest.get("/extended");
    await created.rest.get("/created");

    expect(counts).toEqual([2, 1, 1, 1]);
  });

  it("allows derived cores to override inherited factories with an empty list", () => {
    const factory = vi.fn((): HyperPlugin => ({ name: "factory-plugin" }));
    const core = new HyperCore({ pluginFactories: [factory] }, makeTransport());

    core.extend({ pluginFactories: [] });
    core.create({ pluginFactories: [] });

    expect(factory).toHaveBeenCalledOnce();
  });

  it("rejects factories that return the same non-shared instance to different cores", () => {
    const plugin: HyperPlugin = { name: "singleton" };
    const config: HyperClientOptions = { pluginFactories: [() => plugin] };
    new HyperCore(config, makeTransport());

    expect(() => new HyperCore(config, makeTransport())).toThrow(HyperClientError);
  });

  it("allows explicitly shared stateless plugins across constructors and derived cores", async () => {
    const onRequest = vi.fn();
    const plugin: HyperPlugin = { name: "shared", shared: true, onRequest };
    const first = new HyperCore({ plugins: [plugin] }, makeTransport());
    const second = new HyperCore({ plugins: [plugin] }, makeTransport());
    const extended = first.extend({});
    const created = first.create({ customTransport: makeTransport() });

    await first.rest.get("/first");
    await second.rest.get("/second");
    await extended.rest.get("/extended");
    await created.rest.get("/created");

    expect(onRequest).toHaveBeenCalledTimes(4);
    expect(onRequest.mock.calls.map(([, context]) => context.core)).toEqual([
      first,
      second,
      extended,
      created,
    ]);
  });

  it("rejects shared plugins with setup before executing setup", () => {
    const setup = vi.fn();
    const plugin: HyperPlugin = { name: "invalid-shared", shared: true, setup };
    const core = new HyperCore({}, makeTransport());

    expect(() => core.use(plugin)).toThrow(HyperClientError);
    expect(() => new HyperCore({ plugins: [plugin] }, makeTransport())).toThrow(HyperClientError);
    expect(() => new HyperCore({ pluginFactories: [() => plugin] }, makeTransport())).toThrow(
      HyperClientError,
    );
    expect(setup).not.toHaveBeenCalled();
  });

  it("keeps duplicate registration of the same instance idempotent", async () => {
    const setup = vi.fn();
    const onRequest = vi.fn();
    const plugin: HyperPlugin = { name: "once", setup, onRequest };
    const core = new HyperCore(
      { plugins: [plugin, plugin], pluginFactories: [() => plugin] },
      makeTransport(),
    );

    expect(core.use(plugin)).toBe(core);
    expect(core.use(plugin)).toBe(core);
    await core.rest.get("/once");

    expect(setup).toHaveBeenCalledOnce();
    expect(onRequest).toHaveBeenCalledOnce();
  });

  it("does not implicitly share legacy plugins or plugins with shared: false", () => {
    for (const shared of [undefined, false]) {
      const plugin: HyperPlugin = { name: "owned", shared };
      const core = new HyperCore({ plugins: [plugin] }, makeTransport());
      const other = new HyperCore({}, makeTransport());

      expect(() => other.use(plugin)).toThrow(HyperClientError);
      expect(() => new HyperCore({ plugins: [plugin] }, makeTransport())).toThrow(HyperClientError);
      expect(() => core.extend({})).toThrow(HyperClientError);
      expect(() => core.create({})).toThrow(HyperClientError);
    }
  });
});
