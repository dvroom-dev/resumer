import { beforeAll, afterAll, describe, expect, it } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  created,
  makeCtx,
  header,
  footer,
  refresh,
  sessionDisplay,
  search,
  modals,
  projects,
  picker,
} from "./ui-test-utils.ts";

let stateHome = "";
let prevStateHome: string | undefined;

beforeAll(() => {
  stateHome = fs.mkdtempSync(path.join(os.tmpdir(), "resumer-ui-core-"));
  prevStateHome = process.env.XDG_STATE_HOME;
  process.env.XDG_STATE_HOME = stateHome;
});

afterAll(() => {
  if (prevStateHome === undefined) delete process.env.XDG_STATE_HOME;
  else process.env.XDG_STATE_HOME = prevStateHome;
  fs.rmSync(stateHome, { recursive: true, force: true });
});

describe("ui core modules", () => {
  it("creates layout and updates header", () => {
    const ctx = makeCtx();
    header.updateHeader(ctx as any);
    expect((ctx.header as any).content).toContain("res");
    header.bindHeaderEvents(ctx as any, {
      setMode: (mode: string) => (ctx.mode = mode),
      updateHeader: () => header.updateHeader(ctx as any),
      updateFooter: () => {},
      updateFocusedStyles: () => {},
      refresh: () => {},
      refreshSessionsForSelectedProject: () => {},
      updateSessionDisplay: () => {},
      flashFooter: () => {},
      withPrompt: () => {},
      withConfirm: () => {},
      showError: () => {},
      openTextViewer: () => {},
      showHelp: () => {},
      done: () => {},
      fail: () => {},
    } as any);
    (ctx.header as any).emit("click", { x: 14 });
    expect(ctx.mode).toBe("res");
    (ctx.header as any).emit("mousemove", { x: 14 });
    (ctx.header as any).emit("mouseout");
  });

  it("updates footer and focused styles", () => {
    const ctx = makeCtx();
    const runtime = {
      updateHeader: () => {},
      updateFooter: () => {},
      updateFocusedStyles: () => {},
      updateSessionDisplay: () => {},
      refreshSessionsForSelectedProject: () => {},
      refresh: () => {},
      flashFooter: () => {},
    } as any;
    footer.updateFooter(ctx as any, runtime);
    expect((ctx.footer as any).content).toContain("Projects");
    footer.updateFocusedStyles(ctx as any);
    expect((ctx.projectsBox as any).label).toContain("Projects");
    ctx.mode = "tmux";
    footer.updateFooter(ctx as any, runtime);
    expect((ctx.footer as any).content).toContain("attach");
    footer.updateFocusedStyles(ctx as any);
  });

  it("updates project and session displays", () => {
    const ctx = makeCtx();
    ctx.projects = [{ id: "p1", name: "Proj", path: "/tmp/proj", createdAt: "now" } as any];
    ctx.sessions = [{ name: "s1", projectId: "p1", createdAt: "now", command: "bash" } as any];
    ctx.selectedProject = ctx.projects[0];
    refresh.updateProjectDisplay(ctx as any);
    expect((ctx.projectsBox as any).items?.length).toBe(1);
    sessionDisplay.updateSessionDisplay(ctx as any);
    expect((ctx.sessionsBox as any).items?.length).toBeGreaterThan(0);
    ctx.mode = "codex";
    ctx.codexSessions = [{ id: "c1", cwd: "/tmp", lastPrompt: "hi" } as any];
    refresh.refresh(ctx as any, {
      refreshSessionsForSelectedProject: () => {},
      updateFooter: () => {},
      updateFocusedStyles: () => {},
      updateSessionDisplay: () => {},
      updateHeader: () => {},
    } as any);
  });

  it("supports search", async () => {
    const ctx = makeCtx();
    ctx.projects = [{ id: "p1", name: "Alpha", path: "/tmp/alpha" } as any];
    ctx.sessions = [{ name: "s1", projectId: "p1", command: "bash", createdAt: "now" } as any];
    const runtime = {
      refreshSessionsForSelectedProject: () => {},
      updateFooter: () => {},
    } as any;
    search.startSearch(ctx as any, runtime);
    const input = created.filter((e) => e.__type === "textbox").at(-1)!;
    input.value = "alpha";
    input.emit("keypress", "", {});
    await new Promise((r) => setTimeout(r, 0));
    expect(ctx.selectedProjectIndex).toBe(0);
    input.pressKey("enter");
    expect(ctx.searchActive).toBe(false);

    ctx.mode = "tmux";
    ctx.tmuxSessions = [{ name: "tm1", currentCommand: "bash" } as any];
    search.startSearch(ctx as any, runtime);
    const input2 = created.filter((e) => e.__type === "textbox").at(-1)!;
    input2.value = "tm1";
    input2.emit("keypress", "", {});
    await new Promise((r) => setTimeout(r, 0));
    input2.pressKey("escape");
  });

  it("handles modals", () => {
    const ctx = makeCtx();
    const runtime = { refresh: () => {}, showError: () => {}, flashFooter: () => {} } as any;

    let promptValue: string | null = null;
    modals.withPrompt(ctx as any, runtime, "Prompt", "value", (v) => (promptValue = v));
    const promptInput = created.filter((e) => e.__type === "textbox").at(-1)!;
    promptInput.value = " ok ";
    promptInput.pressKey("enter");
    expect(promptValue).toBe("ok");

    let confirmValue = false;
    modals.withConfirm(ctx as any, runtime, "Confirm?", (ok) => (confirmValue = ok));
    const confirmBox = created.findLast((e) => e.__type === "box" && (e.label ?? "").includes("Confirm"));
    if (!confirmBox) throw new Error("confirm box not found");
    confirmBox.pressKey("enter");
    expect(confirmValue).toBe(true);

    modals.showError(ctx as any, { refresh: () => {} } as any, "oops");
    const errorBox = created.filter((e) => e.__type === "box").at(-1)!;
    errorBox.pressKey("enter");

    modals.openTextViewer(ctx as any, { refresh: () => {}, flashFooter: () => {}, showError: () => {} } as any, "Title", "content");
    const viewer = created.filter((e) => e.__type === "scrollableBox").at(-1)!;
    viewer.pressKey("y");

    modals.showHelp(ctx as any, { refresh: () => {} } as any);
    const helpBox = created.filter((e) => e.__type === "box").at(-1)!;
    helpBox.pressKey("escape");
  });

  it("opens project picker", () => {
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

    let picked: any = null;
    projects.openProjectPicker(ctx as any, runtime, "Pick", tmpProj, (p) => (picked = p));
    const pickerList = created.filter((e) => e.__type === "list").at(-1)!;
    pickerList.emit("select", null, 1);
    expect(picked?.id).toBe("p1");
  });

  it("runs picker", async () => {
    const stdinDesc = Object.getOwnPropertyDescriptor(process.stdin, "isTTY");
    const stdoutDesc = Object.getOwnPropertyDescriptor(process.stdout, "isTTY");
    Object.defineProperty(process.stdin, "isTTY", { value: true, configurable: true });
    Object.defineProperty(process.stdout, "isTTY", { value: true, configurable: true });
    try {
      const promise = picker.runPicker({
        title: "Pick",
        items: [
          { label: "One", value: 1 },
          { label: "Two", value: 2 },
        ],
      });
      const list = created.filter((e) => e.__type === "list").at(-1)!;
      list.emit("select", null, 1);
      await expect(promise).resolves.toBe(2);
    } finally {
      if (stdinDesc) Object.defineProperty(process.stdin, "isTTY", stdinDesc);
      if (stdoutDesc) Object.defineProperty(process.stdout, "isTTY", stdoutDesc);
    }
  });

  it("handles picker cancel and resize", async () => {
    const stdinDesc = Object.getOwnPropertyDescriptor(process.stdin, "isTTY");
    const stdoutDesc = Object.getOwnPropertyDescriptor(process.stdout, "isTTY");
    Object.defineProperty(process.stdin, "isTTY", { value: true, configurable: true });
    Object.defineProperty(process.stdout, "isTTY", { value: true, configurable: true });
    try {
      const promise = picker.runPicker({
        title: "Pick",
        help: "custom help",
        items: [
          { label: "One", value: 1 },
          { label: "Two", value: 2 },
          { label: "Three", value: 3 },
        ],
      });
      const screen = created.filter((e) => e.__type === "screen").at(-1)!;
      const list = created.filter((e) => e.__type === "list").at(-1)!;
      screen.height = 10;
      screen.emit("resize");
      expect(list.height).toBeDefined();
      screen.pressKey("escape");
      await expect(promise).resolves.toBe(null);
    } finally {
      if (stdinDesc) Object.defineProperty(process.stdin, "isTTY", stdinDesc);
      if (stdoutDesc) Object.defineProperty(process.stdout, "isTTY", stdoutDesc);
    }
  });

  it("handles header URL events", () => {
    const ctx = makeCtx();
    (ctx.headerUrl as any).emit("mouseover");
    (ctx.headerUrl as any).emit("mouseout");
  });
});
