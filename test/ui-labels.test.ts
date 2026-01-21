import { describe, expect, it } from "bun:test";
import {
  abbreviatePath,
  claudeSessionLabel,
  codexSessionLabel,
  disambiguateCommands,
  getBaseCommand,
  shortTimestamp,
  stateIndicator,
  truncate,
} from "../src/ui/tui-labels.ts";

describe("ui labels", () => {
  it("gets base command", () => {
    expect(getBaseCommand("")).toBe("(shell)");
    expect(getBaseCommand("bash -lc")).toBe("bash");
  });

  it("disambiguates commands", () => {
    const map = disambiguateCommands([
      { name: "a", command: "bash -lc" } as any,
      { name: "b", command: "bash -c" } as any,
    ]);
    expect(map.get("a")).toContain("bash");
    expect(map.get("b")).toContain("bash");
  });

  it("truncates and formats timestamps", () => {
    expect(truncate("a  b  c", 5)).toBe("a b c");
    expect(shortTimestamp("2024-01-15T10:30:45Z")).toBe("2024-01-15 10:30");
  });

  it("renders state indicators", () => {
    expect(stateIndicator("user")).toContain("►");
    expect(stateIndicator("assistant")).toContain("‖");
    expect(stateIndicator("exited")).toContain("×");
    expect(stateIndicator(undefined)).toContain("?");
  });

  it("formats session labels", () => {
    const codex = codexSessionLabel({
      id: "123456789012345",
      cwd: "/tmp",
      lastActivityAt: "2024-01-15T10:30:45Z",
      lastPrompt: "hello",
      lastMessageType: "assistant",
    } as any);
    expect(codex).toContain("123456789012");
    expect(codex).toContain("/tmp");

    const claude = claudeSessionLabel({
      id: "abc",
      projectPath: "/tmp/proj",
      lastActivityAt: "2024-01-15T10:30:45Z",
      lastPrompt: "hi",
      lastMessageType: "user",
    } as any);
    expect(claude).toContain("/tmp/proj");
  });

  it("abbreviates long paths", () => {
    const path = "/home/user/projects/deep/nested/stuff/myproject";
    expect(abbreviatePath(path)).toBe("/home/user/p/d/n/s/myproject");
  });
});
