import { describe, expect, it } from "vitest";
import type {
  HyperReceiver,
  HyperSender,
  IHyperCore,
  SendRequest,
  UniversalResponse,
} from "@hyperttp/types";
import { HyperCore } from "../src/index.js";

interface RegistrationInput {
  value: string;
}

class RegistrationSender<P extends string> implements HyperSender<
  RegistrationInput,
  string,
  RegistrationInput,
  string,
  P
> {
  constructor(
    readonly protocol: P,
    private readonly label: string,
  ) {}

  readonly methods = {
    identify: (_core: IHyperCore, suffix: string): string => `${this.label}:${suffix}`,
  };

  prepare(request: SendRequest<RegistrationInput, P>): RegistrationInput {
    return request.input;
  }

  async send(prepared: RegistrationInput): Promise<string> {
    return `${this.label}:${prepared.value}`;
  }

  parse(raw: string): UniversalResponse<string> {
    return { protocol: this.protocol, ok: true, status: 200, headers: {}, data: raw };
  }
}

class RegistrationReceiver<P extends string> implements HyperReceiver<
  string,
  string,
  string,
  string,
  P
> {
  constructor(readonly protocol: P) {}

  receive(raw: string): string {
    return raw;
  }

  handle(request: string): string {
    return request;
  }

  respond(response: string): string {
    return response;
  }
}

interface RegistrationSurface {
  registration?: { identify(suffix: string): string };
  identify?: (suffix: string) => string;
}

function surface(core: HyperCore): RegistrationSurface {
  // Registration creates these dynamic properties; they are not a static core API.
  return core as unknown as RegistrationSurface;
}

describe("protocol registration replacement", () => {
  it("replaces the full module with sender-only registration, removing the receiver", () => {
    const core = new HyperCore();
    const original = new RegistrationSender("registration", "original");
    const receiver = new RegistrationReceiver("registration");
    core.registerProtocol({ protocol: "registration", sender: original, receiver });
    const sender = new RegistrationSender("registration", "replacement");
    const replacement = { protocol: "registration", sender };

    expect(core.registerProtocol(replacement)).toBe(core);
    expect(core.getProtocol("registration")).toBe(replacement);
    expect(core.getSender("registration")).toBe(sender);
    expect(core.getReceiver("registration")).toBeUndefined();
    expect(surface(core).registration?.identify("namespace")).toBe("replacement:namespace");
    expect(surface(core).identify?.("flat")).toBe("replacement:flat");
  });

  it("replaces the full module with receiver-only registration, removing sender methods", () => {
    const core = new HyperCore();
    const sender = new RegistrationSender("registration", "original");
    core.registerProtocol({
      protocol: "registration",
      sender,
      receiver: new RegistrationReceiver("registration"),
    });
    const receiver = new RegistrationReceiver("registration");
    const replacement = { protocol: "registration", receiver };

    expect(core.registerProtocol(replacement)).toBe(core);
    expect(core.getProtocol("registration")).toBe(replacement);
    expect(core.getSender("registration")).toBeUndefined();
    expect(core.getReceiver("registration")).toBe(receiver);
    expect(Object.hasOwn(core, "registration")).toBe(false);
    expect(Object.hasOwn(core, "identify")).toBe(false);
  });

  it("registerSender preserves the existing receiver and refreshes generated methods", () => {
    const core = new HyperCore();
    const receiver = new RegistrationReceiver("registration");
    core.registerProtocol({
      protocol: "registration",
      sender: new RegistrationSender("registration", "original"),
      receiver,
    });
    const sender = new RegistrationSender("registration", "replacement");

    expect(core.registerSender(sender)).toBe(core);
    expect(core.getSender("registration")).toBe(sender);
    expect(core.getReceiver("registration")).toBe(receiver);
    expect(surface(core).registration?.identify("namespace")).toBe("replacement:namespace");
    expect(surface(core).identify?.("flat")).toBe("replacement:flat");
  });

  it("registerReceiver preserves the existing sender and its methods", () => {
    const core = new HyperCore();
    const sender = new RegistrationSender("registration", "original");
    core.registerProtocol({
      protocol: "registration",
      sender,
      receiver: new RegistrationReceiver("registration"),
    });
    const receiver = new RegistrationReceiver("registration");

    expect(core.registerReceiver(receiver)).toBe(core);
    expect(core.getSender("registration")).toBe(sender);
    expect(core.getReceiver("registration")).toBe(receiver);
    expect(surface(core).registration?.identify("namespace")).toBe("original:namespace");
    expect(surface(core).identify?.("flat")).toBe("original:flat");
  });

  it("preserves a user override of a generated flat method when replacing the sender", () => {
    const core = new HyperCore();
    core.registerSender(new RegistrationSender("registration", "original"));
    const override = (suffix: string): string => `user:${suffix}`;
    surface(core).identify = override;

    core.registerProtocol({
      protocol: "registration",
      sender: new RegistrationSender("registration", "replacement"),
    });

    expect(surface(core).identify).toBe(override);
    expect(surface(core).identify?.("flat")).toBe("user:flat");
    expect(surface(core).registration?.identify("namespace")).toBe("replacement:namespace");
  });

  it("preserves a user override when receiver-only replacement removes generated methods", () => {
    const core = new HyperCore();
    core.registerSender(new RegistrationSender("registration", "original"));
    const override = (suffix: string): string => `user:${suffix}`;
    surface(core).identify = override;

    core.registerProtocol({
      protocol: "registration",
      receiver: new RegistrationReceiver("registration"),
    });

    expect(surface(core).identify).toBe(override);
    expect(surface(core).identify?.("flat")).toBe("user:flat");
    expect(Object.hasOwn(core, "registration")).toBe(false);
  });

  it("does not overwrite a user override when another protocol exposes the same flat name", () => {
    const core = new HyperCore();
    core.registerSender(new RegistrationSender("registration", "original"));
    const override = (suffix: string): string => `user:${suffix}`;
    surface(core).identify = override;

    core.registerSender(new RegistrationSender("registration-other", "other"));

    expect(surface(core).identify).toBe(override);
    expect(surface(core).registration?.identify("namespace")).toBe("original:namespace");
  });
});
