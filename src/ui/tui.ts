import type { StateV1 } from "../types.ts";
import { createTuiLayout } from "./tui-layout.ts";
import { bindHeaderEvents, updateHeader } from "./tui-header.ts";
import { flashFooter, updateFocusedStyles, updateFooter } from "./tui-footer.ts";
import { updateSessionDisplay } from "./tui-session-display.ts";
import { refresh, refreshSessionsForSelectedProject } from "./tui-refresh.ts";
import { openTextViewer, showError, showHelp, withConfirm, withPrompt } from "./tui-modals.ts";
import { bindKeyHandlers } from "./tui-bindings.ts";
import type { TuiActions, TuiContext, TuiMode, TuiRuntime } from "./tui-types.ts";

export async function runMainTui(args: { state: StateV1; actions: TuiActions }): Promise<void> {
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    throw new Error("res TUI requires a TTY.");
  }

  return await new Promise<void>((resolve, reject) => {
    const ui = createTuiLayout();
    const tabs = ["res", "tmux", "codex", "claude"] as const;

    const ctx: TuiContext = {
      state: args.state,
      actions: args.actions,
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
      tabs,
      tabPositions: [],
      hoveredTab: null,
    };

    const runtime = {} as TuiRuntime;

    runtime.fail = (err: unknown) => {
      const message = err instanceof Error ? err.message : String(err);
      try {
        ctx.screen.destroy();
      } catch {
        // ignore
      }
      reject(new Error(message));
    };

    runtime.done = () => {
      ctx.screen.destroy();
      resolve();
    };

    runtime.updateHeader = () => updateHeader(ctx);
    runtime.updateFooter = () => updateFooter(ctx, runtime);
    runtime.updateFocusedStyles = () => updateFocusedStyles(ctx);
    runtime.updateSessionDisplay = () => updateSessionDisplay(ctx);
    runtime.refreshSessionsForSelectedProject = () => refreshSessionsForSelectedProject(ctx);
    runtime.refresh = () => refresh(ctx, runtime);
    runtime.flashFooter = (message: string, ms?: number) => flashFooter(ctx, runtime, message, ms);
    runtime.withPrompt = (title, value, cb) => withPrompt(ctx, runtime, title, value, cb);
    runtime.withConfirm = (text, cb) => withConfirm(ctx, runtime, text, cb);
    runtime.showError = (text) => showError(ctx, runtime, text);
    runtime.openTextViewer = (title, content) => openTextViewer(ctx, runtime, title, content);
    runtime.showHelp = () => showHelp(ctx, runtime);
    runtime.setMode = (nextMode: TuiMode) => {
      ctx.mode = nextMode;
      runtime.updateFooter();
      if (ctx.mode !== "res") {
        ctx.projectsBox.hide();
        ctx.sessionsBox.hide();
        ctx.tmuxBox.show();
        ctx.tmuxBox.focus();
      } else {
        ctx.tmuxBox.hide();
        ctx.projectsBox.show();
        ctx.sessionsBox.show();
        (ctx.focused === "projects" ? ctx.projectsBox : ctx.sessionsBox).focus();
      }
      runtime.updateFocusedStyles();
      ctx.screen.realloc();
      runtime.refresh();
    };

    bindHeaderEvents(ctx, runtime);
    bindKeyHandlers(ctx, runtime);

    runtime.updateFooter();
    runtime.updateFocusedStyles();
    ctx.projectsBox.focus();
    ctx.footer.setFront();
    ctx.header.setFront();
    ctx.headerUrl.setFront();
    runtime.refresh();
  });
}
