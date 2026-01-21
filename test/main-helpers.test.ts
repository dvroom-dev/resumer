import { describe, expect, it, mock } from "bun:test";
import type { StateV1 } from "../src/types.ts";

mock.module("../src/tmux.ts", () => {
  return {
    listTmuxSessions: () => ["alpha"],
    getTmuxEnv: (_session: string, key: string) => {
      if (key === "RESUMER_PROJECT_PATH") return "/tmp/alpha";
      if (key === "RESUMER_PROJECT_ID") return "p1";
      if (key === "RESUMER_COMMAND") return "codex --yolo";
      if (key === "RESUMER_CREATED_AT") return "2024-01-01T00:00:00.000Z";
      if (key === "RESUMER_MANAGED") return "1";
      return null;
    },
  };
});

const helpers = await import("../src/main-helpers.ts");

describe("main helpers", () => {
  it("parses args and positionals", () => {
    const { opts, positionals } = helpers.parseArgs(["-c", "--delete", "--", "--weird"]);
    expect(opts.create).toBe(true);
    expect(opts.del).toBe(true);
    expect(positionals).toEqual(["--weird"]);
  });

  it("normalizes command args", () => {
    expect(helpers.normalizeCommandArgs([])).toBeUndefined();
    expect(helpers.normalizeCommandArgs(["", " "])).toBeUndefined();
    expect(helpers.normalizeCommandArgs(["echo", "hi"])).toBe("echo hi");
  });

  it("reconciles state with tmux env", () => {
    const state: StateV1 = { version: 1, projects: {}, sessions: {} };
    helpers.reconcileStateWithTmux(state);
    expect(state.projects.p1?.path).toBe("/tmp/alpha");
    expect(state.sessions.alpha?.kind).toBe("managed");
  });
});
