import { listProjects } from "../state.ts";
import { nowIso } from "../time.ts";
import { writeState } from "../state.ts";
import type { TuiContext, TuiRuntime } from "./tui-types.ts";
import { openProjectPicker } from "./tui-projects.ts";
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
