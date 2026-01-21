import { describe, expect, it } from "bun:test";
import { shJoin, shQuote } from "../src/shell.ts";

describe("shell helpers", () => {
  it("quotes unsafe args", () => {
    expect(shQuote("simple")).toBe("simple");
    expect(shQuote("has space")).toBe("'has space'");
    expect(shQuote("it's")).toBe("'it'\"'\"'s'");
  });

  it("joins args", () => {
    expect(shJoin(["echo", "hi there"])).toBe("echo 'hi there'");
  });
});
