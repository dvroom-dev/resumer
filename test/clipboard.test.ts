import { describe, expect, it, mock } from "bun:test";

type SpawnResult = { status?: number | null; error?: Error | null };

const spawnBehavior: { mode: "success" | "fail" } = { mode: "fail" };

mock.module("node:child_process", () => ({
  spawnSync: (_cmd: string, _args: string[]) => {
    if (spawnBehavior.mode === "success") {
      return { status: 0 } satisfies SpawnResult;
    }
    return { status: 1, error: new Error("not found") } satisfies SpawnResult;
  },
}));

const clipboard = await import("../src/clipboard.ts");

describe("clipboard", () => {
  it("returns failure when no helper is found", () => {
    spawnBehavior.mode = "fail";
    const res = clipboard.copyToSystemClipboard("hi");
    expect(res.ok).toBe(false);
  });

  it("returns success when helper succeeds", () => {
    spawnBehavior.mode = "success";
    const res = clipboard.copyToSystemClipboard("hello");
    expect(res.ok).toBe(true);
    if (res.ok) expect(["pbcopy", "clip", "wl-copy", "xclip", "xsel"]).toContain(res.method);
  });
});
