import { describe, expect, it } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  getClaudeDefaultArgs,
  getCodexDefaultArgs,
  getConfigFilePath,
  loadConfigOrDefault,
} from "../src/config.ts";

function withTempConfigHome<T>(fn: (dir: string) => T): T {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "resumer-config-"));
  const prev = process.env.XDG_CONFIG_HOME;
  process.env.XDG_CONFIG_HOME = dir;
  try {
    return fn(dir);
  } finally {
    if (prev === undefined) {
      delete process.env.XDG_CONFIG_HOME;
    } else {
      process.env.XDG_CONFIG_HOME = prev;
    }
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

describe("config", () => {
  it("loads defaults when config file is missing", () => {
    withTempConfigHome(() => {
      const config = loadConfigOrDefault();
      expect(config.codex?.args).toEqual(["--yolo"]);
      expect(config.claude?.args).toEqual(["--dangerously-skip-permissions"]);
    });
  });

  it("merges config file values", () => {
    withTempConfigHome((dir) => {
      const filePath = path.join(dir, "resumer", "config.json");
      fs.mkdirSync(path.dirname(filePath), { recursive: true });
      fs.writeFileSync(
        filePath,
        JSON.stringify({ codex: { args: ["--foo"] }, claude: { args: ["--bar"] } }),
      );
      const config = loadConfigOrDefault();
      expect(config.codex?.args).toEqual(["--foo"]);
      expect(config.claude?.args).toEqual(["--bar"]);
    });
  });

  it("rejects invalid config file contents", () => {
    withTempConfigHome((dir) => {
      const filePath = path.join(dir, "resumer", "config.json");
      fs.mkdirSync(path.dirname(filePath), { recursive: true });
      fs.writeFileSync(filePath, JSON.stringify({ codex: { args: [1] } }));
      expect(() => loadConfigOrDefault()).toThrow();
    });
  });

  it("supports RESUMER_CONFIG override path", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "resumer-config-override-"));
    const prev = process.env.RESUMER_CONFIG;
    try {
      const configPath = path.join(dir, "config.json");
      fs.writeFileSync(configPath, JSON.stringify({ codex: { args: ["--x"] } }));
      process.env.RESUMER_CONFIG = configPath;
      expect(getConfigFilePath()).toBe(configPath);
      const config = loadConfigOrDefault();
      expect(config.codex?.args).toEqual(["--x"]);
    } finally {
      if (prev === undefined) delete process.env.RESUMER_CONFIG;
      else process.env.RESUMER_CONFIG = prev;
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("expands codex args and env overrides", () => {
    const prev = process.env.RESUMER_CODEX_ARGS;
    try {
      process.env.RESUMER_CODEX_ARGS = '["--yolo","--foo"]';
      const args = getCodexDefaultArgs({ codex: { args: ["--bar"] }, claude: {} });
      expect(args).toEqual(["--dangerously-bypass-approvals-and-sandbox", "--foo"]);
    } finally {
      if (prev === undefined) delete process.env.RESUMER_CODEX_ARGS;
      else process.env.RESUMER_CODEX_ARGS = prev;
    }
  });

  it("honors claude args env override", () => {
    const prev = process.env.RESUMER_CLAUDE_ARGS;
    try {
      process.env.RESUMER_CLAUDE_ARGS = "--a --b";
      const args = getClaudeDefaultArgs({ claude: { args: ["--c"] }, codex: {} });
      expect(args).toEqual(["--a", "--b"]);
    } finally {
      if (prev === undefined) delete process.env.RESUMER_CLAUDE_ARGS;
      else process.env.RESUMER_CLAUDE_ARGS = prev;
    }
  });
});
