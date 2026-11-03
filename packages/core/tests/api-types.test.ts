import { describe, expectTypeOf, it } from "vitest";
import type { IHyperCore, TransportServer, UniversalResponse } from "@hyperttp/types";
import { HyperCore } from "../src/index.js";

interface ApiInput {
  required: string;
}

interface ApiOutput {
  result: string;
}

interface ApiServerRequest {
  requestId: string;
}

interface ApiServerResponse {
  accepted: boolean;
}

declare module "@hyperttp/types" {
  interface ProtocolInputMap {
    "api-types-test": ApiInput;
  }
  interface ProtocolServerRequestMap {
    "api-types-test": ApiServerRequest;
  }
  interface ProtocolServerResponseMap {
    "api-types-test": ApiServerResponse;
  }
}

// These functions are checked by tsc but never invoked: no network or server is needed.
function classSendContracts(core: HyperCore): void {
  expectTypeOf(
    core.send<ApiOutput>({ protocol: "api-types-test", input: { required: "value" } }),
  ).toEqualTypeOf<Promise<UniversalResponse<ApiOutput>>>();
  expectTypeOf(
    core.send<ApiOutput, "api-types-test">({
      protocol: "api-types-test",
      input: { required: "value" },
    }),
  ).toEqualTypeOf<Promise<UniversalResponse<ApiOutput>>>();
  expectTypeOf(
    core.send<ApiInput, ApiOutput, "unmapped-api-types-test">({
      protocol: "unmapped-api-types-test",
      input: { required: "value" },
    }),
  ).toEqualTypeOf<Promise<UniversalResponse<ApiOutput>>>();

  // The explicit-input overload is intentionally an escape hatch; inferred calls
  // are not asserted to reject input that this inherited overload can accept.
  // @ts-expect-error The literal protocol's required field must be a string.
  core.send<ApiOutput, "api-types-test">({ protocol: "api-types-test", input: { required: 42 } });
  core.send<ApiInput, ApiOutput, "unmapped-api-types-test">({
    protocol: "unmapped-api-types-test",
    // @ts-expect-error An explicitly declared input still requires its field.
    input: {},
  });
}

function interfaceSendContracts(core: IHyperCore): void {
  expectTypeOf(
    core.send<ApiOutput>({ protocol: "api-types-test", input: { required: "value" } }),
  ).toEqualTypeOf<Promise<UniversalResponse<ApiOutput>>>();
  expectTypeOf(
    core.send<ApiOutput, "api-types-test">({
      protocol: "api-types-test",
      input: { required: "value" },
    }),
  ).toEqualTypeOf<Promise<UniversalResponse<ApiOutput>>>();
  expectTypeOf(
    core.send<ApiInput, ApiOutput, "unmapped-api-types-test">({
      protocol: "unmapped-api-types-test",
      input: { required: "value" },
    }),
  ).toEqualTypeOf<Promise<UniversalResponse<ApiOutput>>>();

  // @ts-expect-error The literal protocol's required field must be a string.
  core.send<ApiOutput, "api-types-test">({ protocol: "api-types-test", input: { required: 42 } });
  core.send<ApiInput, ApiOutput, "unmapped-api-types-test">({
    protocol: "unmapped-api-types-test",
    // @ts-expect-error An explicitly declared input still requires its field.
    input: {},
  });
}

function listenContracts(concrete: HyperCore, abstract: IHyperCore): void {
  for (const core of [concrete, abstract]) {
    expectTypeOf(
      core.listen({
        protocol: "api-types-test",
        handler(request, context) {
          expectTypeOf(request).toEqualTypeOf<ApiServerRequest>();
          expectTypeOf(context.requestId).toEqualTypeOf<string>();
          // @ts-expect-error Request fields come from the augmented request map.
          expectTypeOf(request.missing).toBeUnknown();
          return { accepted: request.requestId.length > 0 };
        },
      }),
    ).toEqualTypeOf<Promise<TransportServer>>();

    core.listen({
      protocol: "api-types-test",
      // @ts-expect-error Response fields come from the augmented response map.
      handler: () => ({ accepted: "yes" }),
    });
  }
}

describe("public API compile-time contracts", () => {
  it("checks class, interface, and augmented listen signatures without executing them", () => {
    expectTypeOf(classSendContracts).toBeFunction();
    expectTypeOf(interfaceSendContracts).toBeFunction();
    expectTypeOf(listenContracts).toBeFunction();
    expectTypeOf<HyperCore>().toExtend<IHyperCore>();
  });
});
