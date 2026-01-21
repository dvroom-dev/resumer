import { listProjects, listSessionsForProject } from "../state.ts";
import { modeColors } from "./tui-constants.ts";
import { abbreviatePath, claudeSessionLabel, codexSessionLabel, stateIndicator, tmuxSessionLabel } from "./tui-labels.ts";
import type { TuiContext, TuiRuntime } from "./tui-types.ts";
import { updateSessionDisplay } from "./tui-session-display.ts";

// Get session state indicators for a project's claude/codex sessions (max 5, with "…" if more)
// Each indicator is 3 chars wide visually (space + glyph + space), with 1 char space between
// Only shows indicators for sessions that have claude/codex commands (matching Sessions panel behavior)
function getProjectSessionIndicators(
  ctx: TuiContext,
  projectId: string,
): string {
  const sessions = listSessionsForProject(ctx.state, projectId);
  const maxShow = 5;
  const indicatorWidth = 3; // Each indicator is " X " (3 chars visually)
  const spaceBetween = 1; // Space between indicators
  // Max width: 5 indicators * 3 chars + 4 spaces between + 1 for "…" = 20 chars
  const totalWidth = maxShow * indicatorWidth + (maxShow - 1) * spaceBetween + 1;

  // Filter to only sessions with claude/codex commands
  const relevantSessions: Array<{ messageType: "user" | "assistant" | "exited" | undefined }> = [];

  for (const session of sessions) {
    const cmd = session.command?.toLowerCase() ?? "";

    if (cmd.includes("claude")) {
      const projectClaude = ctx.claudeSessions.filter(
        (cs) => cs.projectPath === ctx.state.projects[projectId]?.path || cs.cwd === ctx.state.projects[projectId]?.path,
      );
      if (projectClaude.length > 0) {
        projectClaude.sort((a, b) => (b.lastActivityAt ?? "").localeCompare(a.lastActivityAt ?? ""));
        relevantSessions.push({ messageType: projectClaude[0].lastMessageType });
      }
    } else if (cmd.includes("codex")) {
      const projectCodex = ctx.codexSessions.filter((cs) => cs.cwd === ctx.state.projects[projectId]?.path);
      if (projectCodex.length > 0) {
        projectCodex.sort((a, b) => (b.lastActivityAt ?? "").localeCompare(a.lastActivityAt ?? ""));
        relevantSessions.push({ messageType: projectCodex[0].lastMessageType });
      }
    }

    if (relevantSessions.length >= maxShow) break;
  }

  if (relevantSessions.length === 0) return " ".repeat(totalWidth);

  // Build indicators with spaces between them
  const indicators = relevantSessions.slice(0, maxShow).map((s) => stateIndicator(s.messageType));
  const indicatorStr = indicators.join(" "); // Single space between indicators

  // Calculate visual width of indicators (each is 3 chars + 1 space between, except last)
  const indicatorVisualWidth = indicators.length * indicatorWidth + (indicators.length - 1) * spaceBetween;

  // Add suffix for overflow
  const hasMore = relevantSessions.length > maxShow || sessions.some((s) => {
    const cmd = s.command?.toLowerCase() ?? "";
    return (cmd.includes("claude") || cmd.includes("codex")) && !relevantSessions.some(() => true);
  });
  const suffix = hasMore ? "…" : " ";

  // Right-justify: add padding on the left
  const paddingNeeded = totalWidth - indicatorVisualWidth - 1; // -1 for suffix
  const padding = " ".repeat(Math.max(0, paddingNeeded));

  return padding + indicatorStr + suffix;
}

export function refreshResMode(ctx: TuiContext, runtime: TuiRuntime): void {
  ctx.projects = listProjects(ctx.state);

  // Pre-fetch claude and codex sessions for state indicators
  ctx.claudeSessions = ctx.actions.listClaudeSessions();
  ctx.codexSessions = ctx.actions.listCodexSessions();

  // Calculate box width for right-justifying indicators
  const boxWidth = (ctx.projectsBox as any).width;
  const totalWidth = (typeof boxWidth === "number" ? boxWidth : 80) - 3; // minus borders and scrollbar
  const indicatorColumnWidth = 20; // 5 indicators * 3 chars + 4 spaces between + 1 for "…"

  const items = ctx.projects.map((p) => {
    const indicators = getProjectSessionIndicators(ctx, p.id);
    const abbrevPath = abbreviatePath(p.path);
    // Use gray text (not bold) so it appears correctly when inactive
    const leftContent = `{gray-fg}${p.name}{/gray-fg} {gray-fg}${abbrevPath}{/gray-fg}`;

    // Calculate padding to right-justify indicators
    const visibleLeft = `${p.name} ${abbrevPath}`.length;
    const availableForPadding = totalWidth - visibleLeft - indicatorColumnWidth;
    const padding = " ".repeat(Math.max(1, availableForPadding));

    return `${leftContent}${padding}${indicators}`;
  });
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
