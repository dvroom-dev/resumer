import { describe, expect, it } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { listClaudeSessions } from "../src/external/claude.ts";
import { listCodexSessions } from "../src/external/codex.ts";

function withTempDir<T>(fn: (dir: string) => T): T {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "resumer-external-"));
  try {
    return fn(dir);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

describe("external session parsers", () => {
  it("parses Codex sessions and filters command prompts", () => {
    withTempDir((dir) => {
      const prev = process.env.RESUMER_CODEX_HOME;
      process.env.RESUMER_CODEX_HOME = dir;
      try {
        const history = [
          { session_id: "s1", ts: 5, text: "real prompt" },
          { session_id: "s1", ts: 10, text: "/exit" },
          { session_id: "s2", ts: 10, text: "! ls" },
        ];
        fs.writeFileSync(path.join(dir, "history.jsonl"), history.map((h) => JSON.stringify(h)).join("\n"));

        const sessionsRoot = path.join(dir, "sessions", "2024", "01", "01");
        fs.mkdirSync(sessionsRoot, { recursive: true });
        const s1Path = path.join(sessionsRoot, "s1.jsonl");
        const s2Path = path.join(sessionsRoot, "s2.jsonl");

        const head = [
          { type: "session_meta", payload: { id: "s1", cwd: "/tmp/s1", timestamp: "2024-01-01T00:00:00.000Z", cli_version: "0.1.0" } },
          { type: "turn_context", payload: { model: "gpt-5.2" } },
        ];
        fs.writeFileSync(s1Path, head.map((l) => JSON.stringify(l)).join("\n") + "\n" + JSON.stringify({
          type: "response_item",
          payload: { type: "message", role: "user" },
        }));

        const head2 = [
          { type: "session_meta", payload: { id: "s2", cwd: "/tmp/s2", timestamp: "2024-01-01T00:00:00.000Z", cli_version: "0.1.0" } },
          { type: "turn_context", payload: { model: "gpt-5.2" } },
          { type: "event_msg", payload: { type: "turn_aborted", reason: "interrupted" } },
        ];
        fs.writeFileSync(s2Path, head2.map((l) => JSON.stringify(l)).join("\n"));

        const sessions = listCodexSessions();
        const s1 = sessions.find((s) => s.id === "s1")!;
        const s2 = sessions.find((s) => s.id === "s2")!;
        expect(s1.lastPrompt).toBe("real prompt");
        expect(s2.lastPrompt).toBe("(no prompt yet)");
        expect(s2.lastMessageType).toBe("assistant");
      } finally {
        if (prev === undefined) delete process.env.RESUMER_CODEX_HOME;
        else process.env.RESUMER_CODEX_HOME = prev;
      }
    });
  });

  it("parses Claude sessions and filters command prompts", () => {
    withTempDir((dir) => {
      const prev = process.env.RESUMER_CLAUDE_HOME;
      process.env.RESUMER_CLAUDE_HOME = dir;
      try {
        const history = [
          { sessionId: "c1", timestamp: 5, project: "/tmp/dot.project", display: "/exit " },
          { sessionId: "c1", timestamp: 6, project: "/tmp/dot.project", display: "do the thing" },
          { sessionId: "c2", timestamp: 10, project: "/tmp/other", display: "! ls" },
        ];
        fs.writeFileSync(path.join(dir, "history.jsonl"), history.map((h) => JSON.stringify(h)).join("\n"));

        const projectDir1 = path.join(dir, "projects", "-tmp-dot-project");
        const projectDir2 = path.join(dir, "projects", "-tmp-other");
        fs.mkdirSync(projectDir1, { recursive: true });
        fs.mkdirSync(projectDir2, { recursive: true });

        const c1File = path.join(projectDir1, "c1.jsonl");
        const c2File = path.join(projectDir2, "c2.jsonl");

        fs.writeFileSync(c1File, JSON.stringify({
          type: "assistant",
          message: { content: [{ type: "text", text: "done" }] },
        }));

        fs.writeFileSync(c2File, JSON.stringify({
          type: "assistant",
          message: { content: [{ type: "thinking", thinking: "still working" }] },
        }));

        const now = new Date();
        fs.utimesSync(c1File, now, now);

        const sessions = listClaudeSessions();
        const c1 = sessions.find((s) => s.id === "c1")!;
        const c2 = sessions.find((s) => s.id === "c2")!;
        expect(c1.lastPrompt).toBe("do the thing");
        expect(c2.lastPrompt).toBe("(no prompt yet)");
        expect(c1.lastMessageType).toBe("user"); // recent assistant message => treated as running
        expect(c2.lastMessageType).toBe("user"); // thinking content => running
      } finally {
        if (prev === undefined) delete process.env.RESUMER_CLAUDE_HOME;
        else process.env.RESUMER_CLAUDE_HOME = prev;
      }
    });
  });
});
