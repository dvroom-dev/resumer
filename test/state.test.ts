import { describe, expect, it } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  computeProjectId,
  findProject,
  formatNewSessionName,
  listProjects,
  listSessionsForProject,
  loadState,
  loadStateOrDefault,
  normalizeAndEnsureProject,
  removeProject,
  removeSession,
  touchSessionAttached,
  upsertSession,
  writeState,
} from "../src/state.ts";

function withTempStateHome<T>(fn: (stateHome: string) => T): T {
  const stateHome = fs.mkdtempSync(path.join(os.tmpdir(), "resumer-state-"));
  const prev = process.env.XDG_STATE_HOME;
  process.env.XDG_STATE_HOME = stateHome;
  try {
    return fn(stateHome);
  } finally {
    if (prev === undefined) {
      delete process.env.XDG_STATE_HOME;
    } else {
      process.env.XDG_STATE_HOME = prev;
    }
    fs.rmSync(stateHome, { recursive: true, force: true });
  }
}

describe("state helpers", () => {
  it("computeProjectId is stable", () => {
    expect(computeProjectId("/a/b/c")).toBe(computeProjectId("/a/b/c"));
    expect(computeProjectId("/a/b/c")).not.toBe(computeProjectId("/a/b/d"));
  });

  it("formatNewSessionName includes project id and prefix", () => {
    const name = formatNewSessionName("My Project", "abcd1234");
    expect(name.startsWith("res_")).toBe(true);
    expect(name.includes("_abcd1234_")).toBe(true);
  });

  it("normalizeAndEnsureProject registers a directory", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "resumer-test-"));
    try {
      const realDir = fs.realpathSync(dir);
      const state = { version: 1 as const, projects: {}, sessions: {} };
      const project = normalizeAndEnsureProject(state, dir, process.cwd());
      expect(project.path).toBe(realDir);
      expect(state.projects[project.id]?.path).toBe(realDir);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("loadStateOrDefault returns empty state when missing", () => {
    withTempStateHome(() => {
      const state = loadStateOrDefault();
      expect(state.version).toBe(1);
      expect(Object.keys(state.projects)).toHaveLength(0);
      expect(Object.keys(state.sessions)).toHaveLength(0);
    });
  });

  it("writeState persists and loadState reads it back", () => {
    withTempStateHome(() => {
      const state = {
        version: 1 as const,
        projects: {
          p1: {
            id: "p1",
            name: "Project One",
            path: "/tmp/project-one",
            createdAt: "2024-01-01T00:00:00.000Z",
            lastUsedAt: "2024-01-02T00:00:00.000Z",
          },
        },
        sessions: {},
      };
      writeState(state);
      const loaded = loadState();
      expect(loaded.projects.p1?.name).toBe("Project One");
      expect(loaded.projects.p1?.lastUsedAt).toBe("2024-01-02T00:00:00.000Z");
    });
  });

  it("loadState rejects invalid contents", () => {
    withTempStateHome((stateHome) => {
      const filePath = path.join(stateHome, "resumer", "state.json");
      fs.mkdirSync(path.dirname(filePath), { recursive: true });
      fs.writeFileSync(filePath, JSON.stringify({ version: 2 }), "utf8");
      expect(() => loadState()).toThrow();
    });
  });

  it("findProject matches by id, path, and realpath", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "resumer-proj-"));
    const link = path.join(os.tmpdir(), `resumer-link-${Date.now()}`);
    try {
      fs.symlinkSync(dir, link);
      const realDir = fs.realpathSync(dir);
      const state = {
        version: 1 as const,
        projects: {
          p1: {
            id: "p1",
            name: "Project One",
            path: realDir,
            createdAt: "2024-01-01T00:00:00.000Z",
            lastUsedAt: "2024-01-01T00:00:00.000Z",
          },
        },
        sessions: {},
      };
      expect(findProject(state, "p1", process.cwd())?.id).toBe("p1");
      expect(findProject(state, realDir, process.cwd())?.id).toBe("p1");
      expect(findProject(state, link, process.cwd())?.id).toBe("p1");
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
      fs.rmSync(link, { force: true });
    }
  });

  it("listProjects sorts by lastUsedAt then createdAt", () => {
    const state = {
      version: 1 as const,
      projects: {
        p1: {
          id: "p1",
          name: "First",
          path: "/tmp/a",
          createdAt: "2024-01-01T00:00:00.000Z",
          lastUsedAt: "2024-01-02T00:00:00.000Z",
        },
        p2: {
          id: "p2",
          name: "Second",
          path: "/tmp/b",
          createdAt: "2024-01-03T00:00:00.000Z",
          lastUsedAt: "2024-01-03T00:00:00.000Z",
        },
      },
      sessions: {},
    };
    const listed = listProjects(state);
    expect(listed[0]?.id).toBe("p2");
    expect(listed[1]?.id).toBe("p1");
  });

  it("listSessionsForProject sorts by lastAttachedAt then createdAt", () => {
    const state = {
      version: 1 as const,
      projects: {
        p1: { id: "p1", name: "Proj", path: "/tmp/x", createdAt: "2024-01-01T00:00:00.000Z" },
      },
      sessions: {
        s1: {
          name: "s1",
          projectId: "p1",
          createdAt: "2024-01-01T00:00:00.000Z",
          lastAttachedAt: "2024-01-02T00:00:00.000Z",
        },
        s2: {
          name: "s2",
          projectId: "p1",
          createdAt: "2024-01-03T00:00:00.000Z",
        },
      },
    };
    const listed = listSessionsForProject(state, "p1");
    expect(listed[0]?.name).toBe("s2");
    expect(listed[1]?.name).toBe("s1");
  });

  it("upsertSession merges fields", () => {
    const state = {
      version: 1 as const,
      projects: {},
      sessions: {
        s1: { name: "s1", projectId: "p1", createdAt: "2024-01-01T00:00:00.000Z" },
      },
    };
    upsertSession(state, { name: "s1", command: "bash", lastAttachedAt: "2024-01-02T00:00:00.000Z" });
    expect(state.sessions.s1?.command).toBe("bash");
    expect(state.sessions.s1?.createdAt).toBe("2024-01-01T00:00:00.000Z");
  });

  it("removeSession deletes by name", () => {
    const state = {
      version: 1 as const,
      projects: {},
      sessions: {
        s1: { name: "s1", projectId: "p1", createdAt: "2024-01-01T00:00:00.000Z" },
        s2: { name: "s2", projectId: "p1", createdAt: "2024-01-01T00:00:00.000Z" },
      },
    };
    removeSession(state, "s1");
    expect(state.sessions.s1).toBeUndefined();
    expect(state.sessions.s2).toBeDefined();
  });

  it("removeProject deletes project and its sessions", () => {
    const state = {
      version: 1 as const,
      projects: {
        p1: { id: "p1", name: "Proj", path: "/tmp/x", createdAt: "2024-01-01T00:00:00.000Z" },
        p2: { id: "p2", name: "Other", path: "/tmp/y", createdAt: "2024-01-01T00:00:00.000Z" },
      },
      sessions: {
        s1: { name: "s1", projectId: "p1", createdAt: "2024-01-01T00:00:00.000Z" },
        s2: { name: "s2", projectId: "p2", createdAt: "2024-01-01T00:00:00.000Z" },
      },
    };
    removeProject(state, "p1");
    expect(state.projects.p1).toBeUndefined();
    expect(state.sessions.s1).toBeUndefined();
    expect(state.sessions.s2).toBeDefined();
  });

  it("touchSessionAttached updates timestamps", () => {
    const state = {
      version: 1 as const,
      projects: {
        p1: {
          id: "p1",
          name: "Proj",
          path: "/tmp/x",
          createdAt: "2024-01-01T00:00:00.000Z",
          lastUsedAt: "2000-01-01T00:00:00.000Z",
        },
      },
      sessions: {
        s1: {
          name: "s1",
          projectId: "p1",
          createdAt: "2024-01-01T00:00:00.000Z",
          lastAttachedAt: "2000-01-01T00:00:00.000Z",
        },
      },
    };
    touchSessionAttached(state, "s1");
    expect(state.sessions.s1?.lastAttachedAt).not.toBe("2000-01-01T00:00:00.000Z");
    expect(state.projects.p1?.lastUsedAt).not.toBe("2000-01-01T00:00:00.000Z");
  });
});
