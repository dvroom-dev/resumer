import { blessed } from "./blessed.ts";
import { nowIso } from "../time.ts";
import { writeState } from "../state.ts";
import { colors, getModeColor, modeColors } from "./tui-constants.ts";
import type { TuiContext, TuiRuntime } from "./tui-types.ts";
import { getSelectedSessionIndex, updateSessionDisplay } from "./tui-session-display.ts";
import { getConfiguredCommands } from "./tui-projects.ts";

export function attachSelectedSession(ctx: TuiContext, runtime: TuiRuntime): void {
  if (!ctx.selectedProject) return;
  if (!ctx.sessions.length) return;

  const sessionIdx = getSelectedSessionIndex(ctx);
  if (sessionIdx === null) return;
  const sess = ctx.sessions[sessionIdx];
  if (!sess) return;

  try {
    writeState(ctx.state);
  } catch (err) {
    runtime.showError(err instanceof Error ? err.message : String(err));
    return;
  }

  ctx.screen.destroy();
  try {
    ctx.actions.attachSession(sess.name);
    runtime.done();
  } catch (err) {
    runtime.fail(err);
  }
}

export function deleteSelectedSession(ctx: TuiContext, runtime: TuiRuntime): void {
  if (!ctx.selectedProject) return;
  if (!ctx.sessions.length) return;

  const sessionIdx = getSelectedSessionIndex(ctx);
  if (sessionIdx === null) return;
  const sess = ctx.sessions[sessionIdx];
  if (!sess) return;

  runtime.withConfirm(`Kill tmux session?\n${sess.name}`, (ok) => {
    if (!ok) return runtime.refresh();
    try {
      ctx.actions.deleteSession(sess.name);
      writeState(ctx.state);
      ctx.expandedSessionIndex = null;
      runtime.refresh();
    } catch (err) {
      runtime.showError(err instanceof Error ? err.message : String(err));
    }
  });
}

export function unlinkSelectedSession(ctx: TuiContext, runtime: TuiRuntime): void {
  if (!ctx.selectedProject) return;
  if (!ctx.sessions.length) return;

  const sessionIdx = getSelectedSessionIndex(ctx);
  if (sessionIdx === null) return;
  const sess = ctx.sessions[sessionIdx];
  if (!sess) return;

  runtime.withConfirm(`Unlink "${sess.name}" from ${ctx.selectedProject.name}? (tmux keeps running)`, (ok) => {
    if (!ok) return runtime.refresh();
    try {
      ctx.actions.unassociateSession(sess.name);
      writeState(ctx.state);
      ctx.expandedSessionIndex = null;
      runtime.flashFooter(`Unlinked ${sess.name}`);
      runtime.refresh();
    } catch (err) {
      runtime.showError(err instanceof Error ? err.message : String(err));
    }
  });
}

export function linkExistingSessionToSelectedProject(ctx: TuiContext, runtime: TuiRuntime): void {
  if (!ctx.selectedProject) return;
  const project = ctx.selectedProject;

  const allTmuxSessions = ctx.actions.listTmuxSessions();
  const unlinkedSessions = allTmuxSessions.filter((s) => !ctx.state.sessions[s.name]);

  if (unlinkedSessions.length === 0) {
    runtime.flashFooter("No unlinked tmux sessions available");
    return;
  }

  const tmuxColor = modeColors.tmux;
  const items = unlinkedSessions.map((s) => {
    const cmd = s.currentCommand?.trim() || "(shell)";
    const path = s.currentPath ? ` {${colors.secondary}-fg}${s.currentPath}{/}` : "";
    const windows = s.windows > 1 ? ` {gray-fg}${s.windows} windows{/gray-fg}` : "";
    const attached = s.attached ? ` {${modeColors.codex}-fg}attached{/}` : "";
    return `{bold}${s.name}{/bold} {gray-fg}${cmd}{/gray-fg}${path}${windows}${attached}`;
  });

  const modalHeight = Math.min(20, Math.max(9, items.length + 6));
  const modalContainer = blessed.box({
    parent: ctx.screen,
    top: "center",
    left: "center",
    width: "80%",
    height: modalHeight,
    border: "line",
    label: ` {${tmuxColor}-fg}{bold}tmux sessions{/bold}{/} `,
    tags: true,
    style: {
      border: { fg: tmuxColor },
    },
  });

  const modalHeader = blessed.box({
    parent: modalContainer,
    top: 0,
    left: 0,
    width: "100%-2",
    height: 1,
    content: ` Select a tmux session to link to {bold}${project.name}{/bold}`,
    tags: true,
    style: {
      bg: "#374151",
      fg: "white",
    },
  });

  const picker = blessed.list({
    parent: modalContainer,
    top: 1,
    left: 0,
    width: "100%-2",
    height: "100%-3",
    keys: true,
    vi: true,
    mouse: true,
    style: {
      selected: { bg: tmuxColor, fg: "black", bold: true },
    },
    scrollbar: { style: { bg: tmuxColor } },
    tags: true,
    items,
  });

  const previousFooter = ctx.footer.getContent();
  const c = colors.secondary;
  ctx.footer.setContent(`{${c}-fg}{underline}Enter{/underline}{/}: select · {${c}-fg}{underline}Esc{/underline}{/}/{${c}-fg}{underline}q{/underline}{/}: cancel`);
  picker.focus();
  ctx.screen.render();

  function cleanup() {
    ctx.modalClose = null;
    ctx.footer.setContent(previousFooter);
    modalContainer.destroy();
    runtime.updateFooter();
    runtime.updateFocusedStyles();
    (ctx.focused === "projects" ? ctx.projectsBox : ctx.sessionsBox).focus();
    ctx.screen.realloc();
    ctx.screen.render();
  }

  function cancel() {
    cleanup();
    runtime.refresh();
  }

  ctx.modalClose = cancel;
  picker.key(["escape", "q"], () => cancel());
  picker.on("select", (_: unknown, idx: number) => {
    const sess = unlinkedSessions[idx];
    if (!sess) return cancel();

    cleanup();

    try {
      ctx.actions.linkSession(project, sess.name, false);
      writeState(ctx.state);
      runtime.flashFooter(`Linked ${sess.name} → ${project.name}`);
      runtime.refresh();
    } catch (err) {
      runtime.showError(err instanceof Error ? err.message : String(err));
    }
  });

  void modalHeader;
}

export function createSessionForSelectedProject(ctx: TuiContext, runtime: TuiRuntime): void {
  if (!ctx.selectedProject) return;
  const project = ctx.selectedProject;

  const defaultCommands = [
    "claude --dangerously-skip-permissions",
    "codex --yolo",
  ];
  const userCommands = getConfiguredCommands();
  const allCommands = [...userCommands, ...defaultCommands.filter((c) => !userCommands.includes(c))];

  type CommandEntry = { kind: "shell" } | { kind: "command"; command: string } | { kind: "custom" };
  const entries: CommandEntry[] = [
    { kind: "shell" },
    ...allCommands.map((command) => ({ kind: "command" as const, command })),
    { kind: "custom" },
  ];

  const modeColor = getModeColor(ctx.mode);
  const items = [
    "{gray-fg}(default shell){/gray-fg}",
    ...allCommands.map((c) => `{bold}${c}{/bold}`),
    "{gray-fg}(custom command...){/gray-fg}",
  ];

  const modalHeight = Math.min(16, Math.max(8, items.length + 5));
  const modalContainer = blessed.box({
    parent: ctx.screen,
    top: "center",
    left: "center",
    width: "70%",
    height: modalHeight,
    border: "line",
    label: ` {${modeColor}-fg}{bold}New Session{/bold}{/} `,
    tags: true,
    style: {
      border: { fg: modeColor },
    },
  });

  const modalHeader = blessed.box({
    parent: modalContainer,
    top: 0,
    left: 0,
    width: "100%-2",
    height: 1,
    content: ` Select a command for {bold}${project.name}{/bold}`,
    tags: true,
    style: {
      bg: "#374151",
      fg: "white",
    },
  });

  const picker = blessed.list({
    parent: modalContainer,
    top: 1,
    left: 0,
    width: "100%-2",
    height: "100%-3",
    keys: true,
    vi: true,
    mouse: true,
    style: {
      selected: { bg: modeColor, fg: "black", bold: true },
    },
    scrollbar: { style: { bg: modeColor } },
    tags: true,
    items,
  });

  const c = colors.secondary;
  ctx.footer.setContent(`{${c}-fg}{underline}Enter{/underline}{/}: select · {${c}-fg}{underline}Esc{/underline}{/}/{${c}-fg}{underline}q{/underline}{/}: cancel`);
  picker.focus();
  ctx.screen.render();

  function cleanup() {
    modalContainer.destroy();
    runtime.updateFooter();
    runtime.updateFocusedStyles();
    (ctx.focused === "projects" ? ctx.projectsBox : ctx.sessionsBox).focus();
    ctx.screen.realloc();
    ctx.screen.render();
  }

  function createSession(command: string | undefined) {
    let sess;
    try {
      sess = ctx.actions.createSession(project, command);
      sess.lastAttachedAt = nowIso();
      writeState(ctx.state);
    } catch (err) {
      runtime.showError(err instanceof Error ? err.message : String(err));
      return;
    }

    ctx.screen.destroy();
    try {
      ctx.actions.attachSession(sess.name);
      runtime.done();
    } catch (err) {
      runtime.fail(err);
    }
  }

  picker.key(["escape", "q"], () => {
    cleanup();
    runtime.refresh();
  });

  picker.on("select", (_: unknown, idx: number) => {
    const entry = entries[idx];
    if (!entry) {
      cleanup();
      return runtime.refresh();
    }

    cleanup();

    if (entry.kind === "shell") {
      createSession(undefined);
    } else if (entry.kind === "command") {
      createSession(entry.command);
    } else if (entry.kind === "custom") {
      runtime.withPrompt("Custom command", "", (cmd) => {
        if (cmd === null || !cmd) return runtime.refresh();
        createSession(cmd);
      });
    }
  });

  void modalHeader;
}

export function toggleExpandedSession(ctx: TuiContext): void {
  if (ctx.mode !== "res" || ctx.focused !== "sessions") return;
  if (!ctx.sessions.length) return;

  const sessionIdx = getSelectedSessionIndex(ctx);
  if (sessionIdx === null) return;

  ctx.expandedSessionIndex = ctx.expandedSessionIndex === sessionIdx ? null : sessionIdx;

  const listIdx = ctx.listIndexToSessionIndex.findIndex((idx) => idx === sessionIdx);
  if (listIdx >= 0) ctx.sessionsBox.select(listIdx);

  updateSessionDisplay(ctx);
  ctx.screen.render();
}
