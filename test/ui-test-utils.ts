import { mock } from "bun:test";

export type FakeElement = {
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

export const created: FakeElement[] = [];

export function createElement(type: string, options: any = {}): FakeElement {
  const events = new Map<string, Array<(...args: any[]) => void>>();
  const keys = new Map<string, Array<(...args: any[]) => void>>();
  const baseStyle = { border: {}, selected: {}, scrollbar: {} };
  const el: FakeElement = {
    __type: type,
    options,
    style: { ...baseStyle, ...(options.style ?? {}) },
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
    focus() {},
    hide() {
      this.hidden = true;
    },
    show() {
      this.hidden = false;
    },
    destroy() {},
    setFront() {},
    render() {},
    realloc() {},
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

export const layout = await import("../src/ui/tui-layout.ts");
export const header = await import("../src/ui/tui-header.ts");
export const footer = await import("../src/ui/tui-footer.ts");
export const refresh = await import("../src/ui/tui-refresh.ts");
export const sessionDisplay = await import("../src/ui/tui-session-display.ts");
export const search = await import("../src/ui/tui-search.ts");
export const modals = await import("../src/ui/tui-modals.ts");
export const projects = await import("../src/ui/tui-projects.ts");
export const actionsRes = await import("../src/ui/tui-actions-res.ts");
export const actionsTmux = await import("../src/ui/tui-actions-tmux.ts");
export const bindings = await import("../src/ui/tui-bindings.ts");
export const picker = await import("../src/ui/picker.ts");

export function makeCtx() {
  const ui = layout.createTuiLayout();
  return {
    state: { version: 1, projects: {}, sessions: {} },
    actions: {
      listTmuxSessions: () => [],
      attachSession: (_: string) => {},
      deleteSession: (_: string) => {},
      unassociateSession: (_: string) => {},
      createSession: (_p: any, _c?: string) => ({ name: "s1", projectId: "p1", createdAt: "now" }) as any,
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
      refreshLiveSessions: () => {},
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
