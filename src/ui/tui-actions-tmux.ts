import { blessed } from "./blessed.ts";
import { listProjects } from "../state.ts";
import { nowIso } from "../time.ts";
import { writeState } from "../state.ts";
import { colors, modeColors } from "./tui-constants.ts";
import type { TuiContext, TuiRuntime } from "./tui-types.ts";
import type { Project } from "../types.ts";
import { getConfiguredCommands, openProjectPicker } from "./tui-projects.ts";
import { getSelectedIndex } from "./tui-utils.ts";

export function attachSelectedTmuxSession(ctx: TuiContext, runtime: TuiRuntime): void {
  const idx = getSelectedIndex(ctx.tmuxBox);
  ctx.selectedTmuxIndex = idx;
  const sess = ctx.tmuxSessions[idx];
  if (!sess) return;
  ctx.screen.destroy();
  try {
    ctx.actions.attachSession(sess.name);
    runtime.done();
  } catch (err) {
    runtime.fail(err);
  }
}

export function deleteSelectedTmuxSession(ctx: TuiContext, runtime: TuiRuntime): void {
  const idx = getSelectedIndex(ctx.tmuxBox);
  ctx.selectedTmuxIndex = idx;
  const sess = ctx.tmuxSessions[idx];
  if (!sess) return;
  runtime.withConfirm(`Kill tmux session?\n${sess.name}`, (ok) => {
    if (!ok) return runtime.refresh();
    try {
      ctx.actions.deleteSession(sess.name);
      writeState(ctx.state);
      runtime.refresh();
    } catch (err) {
      runtime.showError(err instanceof Error ? err.message : String(err));
    }
  });
}

export function copySelectedTmuxSessionName(ctx: TuiContext, runtime: TuiRuntime): void {
  const idx = getSelectedIndex(ctx.tmuxBox);
  ctx.selectedTmuxIndex = idx;
  const sess = ctx.tmuxSessions[idx];
  if (!sess) return;
  try {
    const res = ctx.actions.copyText(sess.name);
    runtime.flashFooter(`Copied session name via ${res.method}`);
  } catch (err) {
    runtime.showError(err instanceof Error ? err.message : String(err));
  }
}

export function captureSelectedTmuxSession(ctx: TuiContext, runtime: TuiRuntime): void {
  const idx = getSelectedIndex(ctx.tmuxBox);
  ctx.selectedTmuxIndex = idx;
  const sess = ctx.tmuxSessions[idx];
  if (!sess) return;
  try {
    const captured = ctx.actions.captureSessionPane(sess.name);
    runtime.openTextViewer(`capture: ${sess.name}`, captured);
  } catch (err) {
    runtime.showError(err instanceof Error ? err.message : String(err));
  }
}

export function associateSelectedTmuxSession(ctx: TuiContext, runtime: TuiRuntime): void {
  const idx = getSelectedIndex(ctx.tmuxBox);
  ctx.selectedTmuxIndex = idx;
  const sess = ctx.tmuxSessions[idx];
  if (!sess) return;

  const existing = ctx.state.sessions[sess.name];
  if (existing) {
    const existingProject = ctx.state.projects[existing.projectId]?.name ?? existing.projectId;
    runtime.flashFooter(`Already associated with ${existingProject} (use u to unassociate)`);
    return;
  }

  ctx.projects = listProjects(ctx.state);
  openProjectPicker(ctx, runtime, `Associate ${sess.name}`, process.cwd(), (project) => {
    if (!project) return runtime.refresh();
    try {
      ctx.actions.linkSession(project, sess.name, false);
      writeState(ctx.state);
      runtime.flashFooter(`Associated ${sess.name} → ${project.name}`);
      runtime.refresh();
    } catch (err) {
      runtime.showError(err instanceof Error ? err.message : String(err));
    }
  });
}

export function unassociateSelectedTmuxSession(ctx: TuiContext, runtime: TuiRuntime): void {
  const idx = getSelectedIndex(ctx.tmuxBox);
  ctx.selectedTmuxIndex = idx;
  const sess = ctx.tmuxSessions[idx];
  if (!sess) return;

  const existing = ctx.state.sessions[sess.name];
  if (!existing) {
    runtime.flashFooter("Session is not associated with a project.");
    return;
  }

  const existingProject = ctx.state.projects[existing.projectId]?.name ?? existing.projectId;
  runtime.withConfirm(`Unassociate tmux session?\n${sess.name}\n(from ${existingProject})`, (ok) => {
    if (!ok) return runtime.refresh();
    try {
      ctx.actions.unassociateSession(sess.name);
      writeState(ctx.state);
      runtime.flashFooter(`Unassociated ${sess.name}`);
      runtime.refresh();
    } catch (err) {
      runtime.showError(err instanceof Error ? err.message : String(err));
    }
  });
}

export function viewSelectedCodexSession(ctx: TuiContext, runtime: TuiRuntime): void {
  const idx = getSelectedIndex(ctx.tmuxBox);
  ctx.selectedCodexIndex = idx;
  const sess = ctx.codexSessions[idx];
  if (!sess) return;
  try {
    const content = ctx.actions.codexSessionDetails(sess);
    runtime.openTextViewer(`codex: ${sess.id}`, content);
  } catch (err) {
    runtime.showError(err instanceof Error ? err.message : String(err));
  }
}

export function viewSelectedClaudeSession(ctx: TuiContext, runtime: TuiRuntime): void {
  const idx = getSelectedIndex(ctx.tmuxBox);
  ctx.selectedClaudeIndex = idx;
  const sess = ctx.claudeSessions[idx];
  if (!sess) return;
  try {
    const content = ctx.actions.claudeSessionDetails(sess);
    runtime.openTextViewer(`claude: ${sess.id}`, content);
  } catch (err) {
    runtime.showError(err instanceof Error ? err.message : String(err));
  }
}

export function copySelectedCodexSessionId(ctx: TuiContext, runtime: TuiRuntime): void {
  const idx = getSelectedIndex(ctx.tmuxBox);
  ctx.selectedCodexIndex = idx;
  const sess = ctx.codexSessions[idx];
  if (!sess) return;
  try {
    const res = ctx.actions.copyText(sess.id);
    runtime.flashFooter(`Copied Codex session id via ${res.method}`);
  } catch (err) {
    runtime.showError(err instanceof Error ? err.message : String(err));
  }
}

export function copySelectedClaudeSessionId(ctx: TuiContext, runtime: TuiRuntime): void {
  const idx = getSelectedIndex(ctx.tmuxBox);
  ctx.selectedClaudeIndex = idx;
  const sess = ctx.claudeSessions[idx];
  if (!sess) return;
  try {
    const res = ctx.actions.copyText(sess.id);
    runtime.flashFooter(`Copied Claude session id via ${res.method}`);
  } catch (err) {
    runtime.showError(err instanceof Error ? err.message : String(err));
  }
}

export function createTmuxFromCodexSession(ctx: TuiContext, runtime: TuiRuntime): void {
  const idx = getSelectedIndex(ctx.tmuxBox);
  ctx.selectedCodexIndex = idx;
  const codexSession = ctx.codexSessions[idx];
  if (!codexSession) return;

  ctx.projects = listProjects(ctx.state);
  openProjectPicker(
    ctx,
    runtime,
    `tmux for codex ${codexSession.id.slice(0, 12)}`,
    codexSession.cwd ?? process.cwd(),
    (project) => {
      if (!project) return runtime.refresh();

      const command = ctx.actions.codexResumeCommand(codexSession.id);
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
    },
  );
}

export function createTmuxFromClaudeSession(ctx: TuiContext, runtime: TuiRuntime): void {
  const idx = getSelectedIndex(ctx.tmuxBox);
  ctx.selectedClaudeIndex = idx;
  const claudeSession = ctx.claudeSessions[idx];
  if (!claudeSession) return;

  ctx.projects = listProjects(ctx.state);
  openProjectPicker(
    ctx,
    runtime,
    `tmux for claude ${claudeSession.id.slice(0, 12)}`,
    claudeSession.projectPath ?? claudeSession.cwd ?? process.cwd(),
    (project) => {
      if (!project) return runtime.refresh();

      const command = ctx.actions.claudeResumeCommand(claudeSession.id);
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
    },
  );
}

export function createNewTmuxSession(ctx: TuiContext, runtime: TuiRuntime): void {
  ctx.projects = listProjects(ctx.state);
  openProjectPicker(ctx, runtime, "New tmux session", process.cwd(), (project) => {
    if (!project) return runtime.refresh();
    showCommandPicker(ctx, runtime, project);
  });
}

function showCommandPicker(ctx: TuiContext, runtime: TuiRuntime, project: Project): void {
  const defaultCommands = ["claude --dangerously-skip-permissions", "codex --yolo"];
  const userCommands = getConfiguredCommands();
  const allCommands = [...userCommands, ...defaultCommands.filter((c) => !userCommands.includes(c))];

  type CommandEntry = { kind: "shell" } | { kind: "command"; command: string } | { kind: "custom" };
  const entries: CommandEntry[] = [
    { kind: "shell" },
    ...allCommands.map((command) => ({ kind: "command" as const, command })),
    { kind: "custom" },
  ];

  const modeColor = modeColors.tmux;
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
    style: { border: { fg: modeColor } },
  });

  const modalHeader = blessed.box({
    parent: modalContainer,
    top: 0,
    left: 0,
    width: "100%-2",
    height: 1,
    content: ` Select a command for {bold}${project.name}{/bold}`,
    tags: true,
    style: { bg: "#374151", fg: "white" },
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
    style: { selected: { bg: modeColor, fg: "black", bold: true } },
    scrollbar: { style: { bg: modeColor } },
    tags: true,
    items,
  });

  const c = colors.secondary;
  ctx.footer.setContent(`{${c}-fg}{underline}Enter{/underline}{/}: select · {${c}-fg}{underline}Esc{/underline}{/}/{${c}-fg}{underline}q{/underline}{/}: cancel`);
  picker.focus();
  ctx.screen.render();

  function cleanup() {
    ctx.modalClose = null;
    modalContainer.destroy();
    runtime.updateFooter();
    ctx.tmuxBox.focus();
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

  ctx.modalClose = () => {
    cleanup();
    runtime.refresh();
  };

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
