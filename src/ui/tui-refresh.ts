import { listProjects, listSessionsForProject } from "../state.ts";
import { modeColors } from "./tui-constants.ts";
import { claudeSessionLabel, codexSessionLabel, tmuxSessionLabel } from "./tui-labels.ts";
import type { TuiContext, TuiRuntime } from "./tui-types.ts";
import { updateSessionDisplay } from "./tui-session-display.ts";

export function refreshResMode(ctx: TuiContext, runtime: TuiRuntime): void {
  ctx.projects = listProjects(ctx.state);
  const items = ctx.projects.map((p) => `${p.name} {gray-fg}${p.path}{/}`);
  ctx.projectsBox.setItems(items);

  ctx.selectedProjectIndex = Math.min(ctx.selectedProjectIndex, Math.max(0, ctx.projects.length - 1));
  ctx.projectsBox.select(ctx.selectedProjectIndex);

  ctx.selectedProject = ctx.projects[ctx.selectedProjectIndex] ?? null;
  runtime.refreshSessionsForSelectedProject();
}

export function refreshTmuxMode(ctx: TuiContext): void {
  ctx.tmuxSessions = ctx.actions.listTmuxSessions();
  const items = ctx.tmuxSessions.map((s) => tmuxSessionLabel(s, ctx.state));
  ctx.tmuxBox.setLabel(` {${modeColors.tmux}-fg}{bold}tmux Sessions{/bold}{/} `);
  ctx.tmuxBox.setItems(items.length ? items : ["(no tmux sessions)"]);
  ctx.selectedTmuxIndex = Math.min(ctx.selectedTmuxIndex, Math.max(0, ctx.tmuxSessions.length - 1));
  ctx.tmuxBox.select(ctx.selectedTmuxIndex);
}

export function refreshCodexMode(ctx: TuiContext): void {
  ctx.codexSessions = ctx.actions.listCodexSessions();
  ctx.tmuxBox.setLabel(` {${modeColors.codex}-fg}{bold}Codex Sessions{/bold}{/} `);
  ctx.selectedCodexIndex = Math.min(ctx.selectedCodexIndex, Math.max(0, ctx.codexSessions.length - 1));
  updateCodexItems(ctx);
}

export function updateCodexItems(ctx: TuiContext): void {
  const items = ctx.codexSessions.map((s) => codexSessionLabel(s));
  ctx.tmuxBox.setItems(items.length ? items : ["(no Codex sessions found)"]);
  ctx.tmuxBox.select(ctx.selectedCodexIndex);
}

export function refreshClaudeMode(ctx: TuiContext): void {
  ctx.claudeSessions = ctx.actions.listClaudeSessions();
  ctx.tmuxBox.setLabel(` {${modeColors.claude}-fg}{bold}Claude Sessions{/bold}{/} `);
  ctx.selectedClaudeIndex = Math.min(ctx.selectedClaudeIndex, Math.max(0, ctx.claudeSessions.length - 1));
  updateClaudeItems(ctx);
}

export function updateClaudeItems(ctx: TuiContext): void {
  const items = ctx.claudeSessions.map((s) => claudeSessionLabel(s));
  ctx.tmuxBox.setItems(items.length ? items : ["(no Claude sessions found)"]);
  ctx.tmuxBox.select(ctx.selectedClaudeIndex);
}

export function refresh(ctx: TuiContext, runtime: TuiRuntime): void {
  try {
    ctx.actions.refreshLiveSessions();
  } catch (err) {
    runtime.showError(err instanceof Error ? err.message : String(err));
    return;
  }
  if (ctx.mode === "tmux") refreshTmuxMode(ctx);
  else if (ctx.mode === "codex") refreshCodexMode(ctx);
  else if (ctx.mode === "claude") refreshClaudeMode(ctx);
  else refreshResMode(ctx, runtime);
  runtime.updateHeader();
  runtime.updateFocusedStyles();
  ctx.screen.render();
}

export function refreshSessionsForSelectedProject(ctx: TuiContext): void {
  ctx.expandedSessionIndex = null;

  if (!ctx.selectedProject) {
    ctx.sessions = [];
    ctx.listIndexToSessionIndex = [-1];
    ctx.sessionsBox.setItems(["(no projects)"]);
    ctx.sessionsBox.select(0);
    return;
  }

  ctx.sessions = listSessionsForProject(ctx.state, ctx.selectedProject.id);

  if (!ctx.sessions.length) {
    ctx.listIndexToSessionIndex = [-1];
    ctx.sessionsBox.setItems(["(no sessions)"]);
    ctx.sessionsBox.select(0);
    return;
  }

  const allTmuxInfo = ctx.actions.listTmuxSessions();
  ctx.sessionTmuxInfo.clear();
  for (const info of allTmuxInfo) {
    if (ctx.sessions.some((s) => s.name === info.name)) {
      ctx.sessionTmuxInfo.set(info.name, info);
    }
  }

  ctx.claudeSessions = ctx.actions.listClaudeSessions();
  ctx.codexSessions = ctx.actions.listCodexSessions();

  updateSessionDisplay(ctx);
}
