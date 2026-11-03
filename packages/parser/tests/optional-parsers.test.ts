import { describe, expect, it, vi } from "vitest";
import { ResponseConverter } from "../src/index.js";

vi.mock("fast-xml-builder", () => {
  throw new Error("XML builder dependency is not installed");
});
vi.mock("fast-xml-parser", () => {
  throw new Error("XML dependency is not installed");
});
vi.mock("node-html-parser", () => {
  throw new Error("HTML dependency is not installed");
});

describe("without optional parsers", () => {
  it("supports core response types without loading HTML or XML parsers", async () => {
    const converter = new ResponseConverter();
    await expect(converter.convert('{"value":42}', "json")).resolves.toEqual({ value: 42 });
    await expect(converter.convert("plain text", "text")).resolves.toBe("plain text");
    const bytes = new Uint8Array([1, 2, 3]);
    const result = await converter.convert(bytes, "buffer");
    expect(result).toBeInstanceOf(Uint8Array);
    expect(Array.from(result as Uint8Array)).toEqual([1, 2, 3]);

  });

  it("explains how to install the missing XML builder", async () => {
    const converter = new ResponseConverter();
    await expect(converter.convert({ root: "value" }, "xml")).rejects.toThrow(
      "npm install fast-xml-builder",
    );
  });

  it("returns HTML unchanged when parsing is disabled", async () => {
    const converter = new ResponseConverter({ parseHTML: false });
    await expect(converter.convert("<p>Hello</p>", "html")).resolves.toBe("<p>Hello</p>");
  });

  it.each([
    ["xml", "application/xml", "<root/>", "fast-xml-parser"],
    ["html", "text/html", "<p>Hello</p>", "node-html-parser"],
  ] as const)("explains how to install the missing %s parser", async (type, contentType, body, name) => {
    const converter = new ResponseConverter();
    await expect(converter.convert(body, type)).rejects.toThrow(`npm install ${name}`);
    await expect(converter.convert(body, "auto", { contentType })).rejects.toThrow(
      `npm install ${name}`,
    );
  });
});
