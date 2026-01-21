import { describe, expect, it } from "bun:test";
import { getModeColor, colors, modeColors } from "../src/ui/tui-constants.ts";
import { getSelectedIndex } from "../src/ui/tui-utils.ts";
import { getBlessedTerminalOverride } from "../src/ui/term.ts";

describe("ui basics", () => {
  it("returns mode colors", () => {
    expect(getModeColor("res")).toBe(modeColors.res);
    expect(colors.error).toBeDefined();
  });

  it("gets selected index", () => {
    expect(getSelectedIndex({ selected: 2 } as any)).toBe(2);
    expect(getSelectedIndex({} as any)).toBe(0);
  });

  it("detects terminal override", () => {
    const prevTerm = process.env.TERM;
    try {
      process.env.TERM = "xterm-ghostty";
      expect(getBlessedTerminalOverride()).toBe("xterm-256color");
    } finally {
      if (prevTerm === undefined) delete process.env.TERM;
      else process.env.TERM = prevTerm;
    }
  });
});
