import { beforeAll, afterAll, describe, expect, it, mock } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

type FakeElement = {
  __type: string;
  options: any;
  style: any;
  content?: string;
  label?: string;
  items?: string[];
  selected?: number;
  hidden?: boolean;
  height?: number | string;
  width?: number | string;
  value?: string;
  children: FakeElement[];
  events: Map<string, Array<(...args: any[]) => void>>;
  keys: Map<string, Array<(...args: any[]) => void>>;
  on: (event: string, cb: (...args: any[]) => void) => void;
  key: (keys: string[] | string, cb: (...args: any[]) => void) => void;
  emit: (event: string, ...args: any[]) => void;
  pressKey: (key: string) => void;
  setContent: (content: string) => void;
  getContent: () => string;
  setLabel: (label: string) => void;
  setItems: (items: string[]) => void;
  select: (idx: number) => void;
  focus: () => void;
  hide: () => void;
  show: () => void;
  destroy: () => void;
  setFront: () => void;
  render: () => void;
  realloc: () => void;
  getValue: () => string;
};

const created: FakeElement[] = [];

function createElement(type: string, options: any = {}): FakeElement {
  const events = new Map<string, Array<(...args: any[]) => void>>();
  const keys = new Map<string, Array<(...args: any[]) => void>>();
  const el: FakeElement = {
    __type: type,
    options,
    style: options.style ?? {},
    content: options.content ?? "",
    label: options.label ?? "",
    items: options.items ?? [],
    selected: 0,
    hidden: options.hidden ?? false,
    height: options.height,
    width: options.width,
    value: options.value ?? "",
    children: [],
    events,
    keys,
    on(event, cb) {
      const list = events.get(event) ?? [];
      list.push(cb);
      events.set(event, list);
    },
    key(keysArg, cb) {
      const list = Array.isArray(keysArg) ? keysArg : [keysArg];
      for (const key of list) {
        const handlers = keys.get(key) ?? [];
        handlers.push(cb);
        keys.set(key, handlers);
      }
    },
    emit(event, ...args) {
      const list = events.get(event) ?? [];
      for (const cb of list) cb(...args);
    },
    pressKey(key) {
      const list = keys.get(key) ?? [];
      for (const cb of list) cb();
    },
    setContent(content) {
      this.content = content;
    },
    getContent() {
      return this.content ?? "";
    },
    setLabel(label) {
      this.label = label;
    },
    setItems(items) {
      this.items = items;
    },
    select(idx) {
      this.selected = idx;
    },
    focus() {
      // no-op
    },
    hide() {
      this.hidden = true;
    },
    show() {
      this.hidden = false;
    },
    destroy() {
      // no-op
    },
    setFront() {
      // no-op
    },
    render() {
      // no-op
    },
    realloc() {
      // no-op
    },
    getValue() {
      return this.value ?? "";
    },
  };
  if (options.parent && options.parent.children) {
    options.parent.children.push(el);
  }
  created.push(el);
  return el;
}

mock.module("../src/ui/blessed.ts", () => ({
  blessed: {
    screen: (options: any) => {
      const el = createElement("screen", options);
      el.height = 24;
      el.width = 80;
      return el;
    },
    box: (options: any) => createElement("box", options),
    scrollableBox: (options: any) => createElement("scrollableBox", options),
    list: (options: any) => createElement("list", options),
    prompt: (options: any) => createElement("prompt", options),
    question: (options: any) => createElement("question", options),
    textbox: (options: any) => createElement("textbox", options),
  },
}));

let stateHome = "";
let prevStateHome: string | undefined;

beforeAll(() => {
  stateHome = fs.mkdtempSync(path.join(os.tmpdir(), "resumer-ui-state-"));
  prevStateHome = process.env.XDG_STATE_HOME;
  process.env.XDG_STATE_HOME = stateHome;
});

afterAll(() => {
  if (prevStateHome === undefined) delete process.env.XDG_STATE_HOME;
  else process.env.XDG_STATE_HOME = prevStateHome;
  fs.rmSync(stateHome, { recursive: true, force: true });
});

const layout = await import("../src/ui/tui-layout.ts");
const header = await import("../src/ui/tui-header.ts");
const footer = await import("../src/ui/tui-footer.ts");
const refresh = await import("../src/ui/tui-refresh.ts");
const sessionDisplay = await import("../src/ui/tui-session-display.ts");
const search = await import("../src/ui/tui-search.ts");
const modals = await import("../src/ui/tui-modals.ts");
const projects = await import("../src/ui/tui-projects.ts");
const actionsRes = await import("../src/ui/tui-actions-res.ts");
const actionsTmux = await import("../src/ui/tui-actions-tmux.ts");
const bindings = await import("../src/ui/tui-bindings.ts");
const picker = await import("../src/ui/picker.ts");

function makeCtx() {
  const ui = layout.createTuiLayout();
  return {
    state: { version: 1, projects: {}, sessions: {} },
    actions: {
      listTmuxSessions: () => [],
      attachSession: (_: string) => {},
      deleteSession: (_: string) => {},
      unassociateSession: (_: string) => {},
      createSession: (_p: any, _c?: string) => ({ name: "s1", projectId: "p1", createdAt: "now" } as any),
      linkSession: (_p: any, _n: string, _y: boolean) => {},
      captureSessionPane: (_: string) => "capture",
      copyText: (_: string) => ({ method: "stub" }),
      codexSessionDetails: (_: any) => "codex-details",
      claudeSessionDetails: (_: any) => "claude-details",
      codexResumeCommand: (_: string) => "codex resume",
      claudeResumeCommand: (_: string) => "claude resume",
      listClaudeSessions: () => [],
      listCodexSessions: () => [],
      listTmuxSessionsInfo: () => [],
    },
    screen: ui.screen,
    header: ui.header,
    headerUrl: ui.headerUrl,
    projectsBox: ui.projectsBox,
    sessionsBox: ui.sessionsBox,
    tmuxBox: ui.tmuxBox,
    footer: ui.footer,
    prompt: ui.prompt,
    question: ui.question,
    mode: "res",
    focused: "projects",
    projects: [],
    sessions: [],
    selectedProject: null,
    selectedProjectIndex: 0,
    tmuxSessions: [],
    selectedTmuxIndex: 0,
    codexSessions: [],
    selectedCodexIndex: 0,
    claudeSessions: [],
    selectedClaudeIndex: 0,
    expandedSessionIndex: null,
    sessionTmuxInfo: new Map(),
    listIndexToSessionIndex: [],
    updatingSessionDisplay: false,
    modalClose: null,
    footerTimer: null,
    searchActive: false,
    searchQuery: "",
    tabs: ["res", "tmux", "codex", "claude"] as const,
    tabPositions: [],
    hoveredTab: null,
  };
}

describe("ui modules with mocked blessed", () => {
  it("creates layout and updates header", () => {
    const ctx = makeCtx();
    header.updateHeader(ctx as any);
    expect((ctx.header as any).content).toContain("res");
    header.bindHeaderEvents(ctx as any, { setMode: (mode: string) => (ctx.mode = mode), updateHeader: () => header.updateHeader(ctx as any), updateFooter: () => {}, updateFocusedStyles: () => {}, refresh: () => {}, refreshSessionsForSelectedProject: () => {}, updateSessionDisplay: () => {}, flashFooter: () => {}, withPrompt: () => {}, withConfirm: () => {}, showError: () => {}, openTextViewer: () => {}, showHelp: () => {}, done: () => {}, fail: () => {} } as any);
    (ctx.header as any).emit("click", { x: 14 });
    expect(ctx.mode).toBe("res");
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
  });

  it("handles modals", () => {
    const ctx = makeCtx();
    const runtime = {
      refresh: () => {},
      showError: () => {},
      flashFooter: () => {},
    } as any;

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

  it("opens project picker and actions", () => {
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

    projects.addProject(ctx as any, runtime);
    expect(Object.keys(ctx.state.projects).length).toBeGreaterThan(0);

    ctx.selectedProject = ctx.projects[0];
    ctx.state.sessions = {
      s1: { name: "s1", projectId: "p1", createdAt: "now" } as any,
    };
    projects.deleteSelectedProject(ctx as any, runtime);
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
    actionsTmux.copySelectedTmuxSessionName(ctx as any, runtime);
    actionsTmux.viewSelectedCodexSession(ctx as any, runtime);
    actionsTmux.viewSelectedClaudeSession(ctx as any, runtime);

    bindings.bindKeyHandlers(ctx as any, runtime);
    (ctx.screen as any).pressKey("tab");
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
});
