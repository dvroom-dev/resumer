import { beforeAll, afterAll, describe, expect, it } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  created,
  makeCtx,
  refresh,
  sessionDisplay,
  projects,
  actionsRes,
  actionsTmux,
  bindings,
} from "./ui-test-utils.ts";

let stateHome = "";
let prevStateHome: string | undefined;

beforeAll(() => {
  stateHome = fs.mkdtempSync(path.join(os.tmpdir(), "resumer-ui-actions-"));
  prevStateHome = process.env.XDG_STATE_HOME;
  process.env.XDG_STATE_HOME = stateHome;
});

afterAll(() => {
  if (prevStateHome === undefined) delete process.env.XDG_STATE_HOME;
  else process.env.XDG_STATE_HOME = prevStateHome;
  fs.rmSync(stateHome, { recursive: true, force: true });
});

describe("ui action modules", () => {
  it("adds and deletes projects", () => {
    const ctx = makeCtx();
    const tmpProj = fs.mkdtempSync(path.join(os.tmpdir(), "resumer-proj-"));
    ctx.projects = [{ id: "p1", name: "Proj", path: tmpProj, createdAt: "now" } as any];
    const runtime = {
      updateFooter: () => {},
      updateFocusedStyles: () => {},
      refresh: () => {},
      withPrompt: (_: string, _v: string, cb: (v: string | null) => void) => cb(tmpProj),
      withConfirm: (_: string, cb: (ok: boolean) => void) => cb(true),
      flashFooter: () => {},
      showError: () => {},
    } as any;

    projects.addProject(ctx as any, runtime);
    expect(Object.keys(ctx.state.projects).length).toBeGreaterThan(0);

    ctx.selectedProject = ctx.projects[0];
    ctx.state.sessions = { s1: { name: "s1", projectId: "p1", createdAt: "now" } as any };
    projects.deleteSelectedProject(ctx as any, runtime);

    process.env.RESUMER_COMMANDS = "claude --x,codex --y";
    try {
      const cmds = projects.getConfiguredCommands();
      expect(cmds.length).toBe(2);
    } finally {
      delete process.env.RESUMER_COMMANDS;
    }
  });

  it("runs res/tmux actions and bindings", () => {
    const ctx = makeCtx();
    ctx.selectedProject = { id: "p1", name: "Proj", path: "/tmp/proj", createdAt: "now" } as any;
    ctx.sessions = [{ name: "s1", projectId: "p1", createdAt: "now" } as any];
    ctx.tmuxSessions = [{ name: "tm1", attached: 0, windows: 1 } as any];
    ctx.codexSessions = [{ id: "c1" } as any];
    ctx.claudeSessions = [{ id: "a1" } as any];
    const runtime = {
      refresh: () => {},
      done: () => {},
      fail: () => {},
      showError: () => {},
      flashFooter: () => {},
      openTextViewer: () => {},
      withConfirm: (_: string, cb: (ok: boolean) => void) => cb(true),
      refreshSessionsForSelectedProject: () => {},
      updateSessionDisplay: () => {},
      updateFocusedStyles: () => {},
      updateFooter: () => {},
      setMode: (_: any) => {},
      showHelp: () => {},
    } as any;

    actionsRes.attachSelectedSession(ctx as any, runtime);
    actionsRes.deleteSelectedSession(ctx as any, runtime);
    actionsRes.unlinkSelectedSession(ctx as any, runtime);
    actionsTmux.copySelectedTmuxSessionName(ctx as any, runtime);
    actionsTmux.viewSelectedCodexSession(ctx as any, runtime);
    actionsTmux.viewSelectedClaudeSession(ctx as any, runtime);

    bindings.bindKeyHandlers(ctx as any, runtime);
    (ctx.screen as any).pressKey("tab");
    (ctx.screen as any).pressKey("1");
    (ctx.screen as any).pressKey("2");
    (ctx.screen as any).pressKey("3");
    (ctx.screen as any).pressKey("4");
    (ctx.screen as any).pressKey("m");
    (ctx.screen as any).pressKey("r");
    (ctx.screen as any).pressKey("?");
    (ctx.projectsBox as any).pressKey("enter");
  });

  it("renders expanded sessions and indices", () => {
    const ctx = makeCtx();
    const project = { id: "p1", name: "Proj", path: "/tmp/proj", createdAt: "2025-01-01T00:00:00Z" } as any;
    ctx.projects = [project];
    ctx.selectedProject = project;
    ctx.selectedProjectIndex = 0;
    ctx.sessions = [
      {
        name: "s1",
        projectId: "p1",
        command: "claude",
        createdAt: "2025-01-01T00:00:00Z",
        lastAttachedAt: "2025-01-02T00:00:00Z",
        kind: "managed",
      } as any,
      { name: "s2", projectId: "p1", createdAt: "2025-01-01T00:00:00Z" } as any,
    ];
    ctx.sessionTmuxInfo.set("s1", {
      name: "s1",
      attached: 1,
      windows: 2,
      currentCommand: "bash",
      currentPath: "/tmp/proj",
    } as any);
    ctx.sessionTmuxInfo.set("s2", {
      name: "s2",
      attached: 0,
      windows: 1,
      currentCommand: "bash",
      currentPath: "/tmp/proj",
    } as any);
    ctx.claudeSessions = [
      {
        id: "a1",
        projectPath: "/tmp/proj",
        lastPrompt: "hello there",
        lastActivityAt: "2025-01-03T00:00:00Z",
        lastMessageType: "assistant",
      } as any,
    ];
    ctx.codexSessions = [];
    ctx.focused = "sessions";
    ctx.expandedSessionIndex = 0;
    (ctx.sessionsBox as any).selected = 0;
    sessionDisplay.updateSessionDisplay(ctx as any);
    const items = (ctx.sessionsBox as any).items as string[];
    expect(items.some((item) => item.includes("last prompt"))).toBe(true);
    expect(items.join("\n")).toContain("(shell)");
    expect(items.join("\n")).toContain("running:");
    expect(items.join("\n")).toContain("colla");
    expect(sessionDisplay.getSelectedSessionIndex(ctx as any)).toBe(0);
  });

  it("refreshes session lists for empty and populated projects", () => {
    const ctx = makeCtx();
    ctx.selectedProject = null;
    refresh.refreshSessionsForSelectedProject(ctx as any);
    expect((ctx.sessionsBox as any).items?.[0]).toContain("(no projects)");

    const project = { id: "p1", name: "Proj", path: "/tmp/proj", createdAt: "now" } as any;
    ctx.state.projects = { p1: project };
    ctx.selectedProject = project;
    refresh.refreshSessionsForSelectedProject(ctx as any);
    expect((ctx.sessionsBox as any).items?.[0]).toContain("(no sessions)");
  });

  it("updates project indicators and refresh modes", () => {
    const ctx = makeCtx();
    const project = { id: "p1", name: "Proj", path: "/tmp/proj", createdAt: "now" } as any;
    ctx.state.projects = { p1: project };
    ctx.state.sessions = {
      s1: { name: "s1", projectId: "p1", createdAt: "now", command: "claude" } as any,
      s2: { name: "s2", projectId: "p1", createdAt: "now", command: "codex" } as any,
    };
    ctx.projects = [project];
    ctx.selectedProjectIndex = 0;
    ctx.selectedProject = project;
    ctx.actions.listTmuxSessions = () => [
      { name: "s1", currentCommand: "claude" } as any,
      { name: "s2", currentCommand: "codex" } as any,
    ];
    ctx.claudeSessions = [
      { id: "a1", projectPath: "/tmp/proj", lastMessageType: "assistant", lastActivityAt: "2025-01-02T00:00:00Z" } as any,
    ];
    ctx.codexSessions = [
      { id: "c1", cwd: "/tmp/proj", lastMessageType: "user", lastActivityAt: "2025-01-03T00:00:00Z" } as any,
    ];
    refresh.updateProjectDisplay(ctx as any);
    const projectItem = (ctx.projectsBox as any).items?.[0] ?? "";
    expect(projectItem).toContain("►");
    expect(projectItem).toContain("‖");

    ctx.mode = "tmux";
    ctx.actions.listTmuxSessions = () => [];
    refresh.refreshTmuxMode(ctx as any);
    expect((ctx.tmuxBox as any).items?.[0]).toContain("(no tmux sessions)");

    ctx.mode = "codex";
    ctx.actions.listCodexSessions = () => [];
    refresh.refreshCodexMode(ctx as any);
    expect((ctx.tmuxBox as any).items?.[0]).toContain("(no Codex sessions");

    ctx.mode = "claude";
    ctx.actions.listClaudeSessions = () => [];
    refresh.refreshClaudeMode(ctx as any);
    expect((ctx.tmuxBox as any).items?.[0]).toContain("(no Claude sessions");
  });

  it("handles res and tmux action flows", () => {
    const ctx = makeCtx();
    const project = { id: "p1", name: "Proj", path: "/tmp/proj", createdAt: "now" } as any;
    ctx.selectedProject = project;
    ctx.projects = [project];
    ctx.state.projects = { p1: project };
    ctx.sessions = [{ name: "s1", projectId: "p1", createdAt: "now", command: "claude" } as any];
    ctx.listIndexToSessionIndex = [0];
    ctx.focused = "sessions";
    (ctx.sessionsBox as any).selected = 0;

    const calls: string[] = [];
    ctx.actions.createSession = (_p: any, cmd?: string) => {
      calls.push(`create:${cmd ?? "shell"}`);
      return { name: "snew", projectId: "p1", createdAt: "now" } as any;
    };
    ctx.actions.attachSession = (name: string) => calls.push(`attach:${name}`);
    ctx.actions.deleteSession = (name: string) => calls.push(`delete:${name}`);
    ctx.actions.unassociateSession = (name: string) => calls.push(`unlink:${name}`);
    ctx.actions.linkSession = (_p: any, name: string) => calls.push(`link:${name}`);
    ctx.actions.listTmuxSessions = () => [{ name: "tm1", currentCommand: "bash", windows: 1, attached: 0 } as any];

    const runtime = {
      refresh: () => {},
      done: () => {},
      fail: () => {},
      showError: () => {},
      flashFooter: () => {},
      openTextViewer: () => {},
      withConfirm: (_: string, cb: (ok: boolean) => void) => cb(true),
      withPrompt: (_: string, _v: string, cb: (v: string | null) => void) => cb("echo hi"),
      refreshSessionsForSelectedProject: () => {},
      updateSessionDisplay: () => {},
      updateFocusedStyles: () => {},
      updateFooter: () => {},
      setMode: (_: any) => {},
      showHelp: () => {},
    } as any;

    actionsRes.attachSelectedSession(ctx as any, runtime);
    actionsRes.deleteSelectedSession(ctx as any, runtime);
    actionsRes.unlinkSelectedSession(ctx as any, runtime);
    actionsRes.linkExistingSessionToSelectedProject(ctx as any, runtime);
    const linkList = created.filter((e) => e.__type === "list").at(-1)!;
    linkList.emit("select", null, 0);

    actionsRes.createSessionForSelectedProject(ctx as any, runtime);
    const shellList = created.filter((e) => e.__type === "list").at(-1)!;
    shellList.emit("select", null, 0);

    actionsRes.createSessionForSelectedProject(ctx as any, runtime);
    const customList = created.filter((e) => e.__type === "list").at(-1)!;
    customList.emit("select", null, 3);

    actionsRes.toggleExpandedSession(ctx as any);

    ctx.mode = "tmux";
    ctx.tmuxSessions = [{ name: "tm1", attached: 0, windows: 1 } as any];
    (ctx.tmuxBox as any).selected = 0;
    actionsTmux.attachSelectedTmuxSession(ctx as any, runtime);
    actionsTmux.deleteSelectedTmuxSession(ctx as any, runtime);
    actionsTmux.copySelectedTmuxSessionName(ctx as any, runtime);
    actionsTmux.captureSelectedTmuxSession(ctx as any, runtime);

    ctx.state.sessions = {};
    ctx.projects = [project];
    actionsTmux.associateSelectedTmuxSession(ctx as any, runtime);
    const assocList = created.filter((e) => e.__type === "list").at(-1)!;
    assocList.emit("select", null, 1);

    ctx.state.sessions = { tm1: { name: "tm1", projectId: "p1", createdAt: "now" } as any };
    actionsTmux.unassociateSelectedTmuxSession(ctx as any, runtime);

    ctx.codexSessions = [{ id: "c1", cwd: "/tmp/proj" } as any];
    ctx.claudeSessions = [{ id: "a1", cwd: "/tmp/proj", projectPath: "/tmp/proj" } as any];
    actionsTmux.copySelectedCodexSessionId(ctx as any, runtime);
    actionsTmux.copySelectedClaudeSessionId(ctx as any, runtime);

    actionsTmux.createTmuxFromCodexSession(ctx as any, runtime);
    const codexPicker = created.filter((e) => e.__type === "list").at(-1)!;
    codexPicker.emit("select", null, 1);

    actionsTmux.createTmuxFromClaudeSession(ctx as any, runtime);
    const claudePicker = created.filter((e) => e.__type === "list").at(-1)!;
    claudePicker.emit("select", null, 1);

    expect(calls.length).toBeGreaterThan(0);
  });
});
