import { afterEach, describe, expect, it, vi } from "vitest";
import { ResponseConverter } from "../src/index.js";

afterEach(() => vi.unstubAllGlobals());
describe("without global Buffer", () => {
  it("decodes Unicode JSON and text", async () => {
    vi.stubGlobal("Buffer", undefined);
    const converter = new ResponseConverter();
    await expect(
      converter.convert(new TextEncoder().encode('{"text":"Привет 🌍"}'), "json"),
    ).resolves.toEqual({ text: "Привет 🌍" });
    await expect(converter.convert(new TextEncoder().encode("Привет 🌍"), "text")).resolves.toBe(
      "Привет 🌍",
    );
  });
  it("preserves binary bytes and encodes UTF-8 strings", async () => {
    vi.stubGlobal("Buffer", undefined);
    const converter = new ResponseConverter();
    const bytes = new Uint8Array([0, 255, 128]);
    expect(await converter.convert(bytes, "buffer")).toEqual(bytes);
    expect(await converter.convert("Привет 🌍", "buffer")).toEqual(
      new TextEncoder().encode("Привет 🌍"),
    );
  });
  it("honors supported decoding charsets and rejects unsupported string encoding", async () => {
    vi.stubGlobal("Buffer", undefined);
    const converter = new ResponseConverter({ charset: "latin1" });
    await expect(converter.convert(new Uint8Array([233]), "text")).resolves.toBe("é");
    await expect(converter.convert("é", "buffer")).rejects.toThrow("requires Buffer");
  });
});
