import { listProjects, listSessionsForProject } from "../state.ts";
import { modeColors } from "./tui-constants.ts";
import { abbreviatePath, claudeSessionLabel, codexSessionLabel, stateIndicator, tmuxSessionLabel } from "./tui-labels.ts";
import type { TuiContext, TuiRuntime } from "./tui-types.ts";
import { updateSessionDisplay } from "./tui-session-display.ts";

// Resolve command from session or tmux info (same as Sessions panel)
function resolveCommand(session: { command?: string }, tmuxInfo?: { currentCommand?: string }): string {
  return session.command?.trim() || tmuxInfo?.currentCommand?.trim() || "";
}

function padToWidth(s: string, maxWidth: number): string {
  const visible = s.replace(/\{[^}]+\}/g, "");
  if (visible.length <= maxWidth) {
    return s + " ".repeat(maxWidth - visible.length);
  }

  let result = "";
  let visibleCount = 0;
  let i = 0;
  while (i < s.length && visibleCount < maxWidth - 1) {
    if (s[i] === "{") {
      const end = s.indexOf("}", i);
      if (end !== -1) {
        result += s.slice(i, end + 1);
        i = end + 1;
      } else {
        break;
      }
    } else {
      result += s[i];
      visibleCount++;
      i++;
    }
  }
  return result + "…";
}

// Get session state indicators for a project's claude/codex sessions (max 5, with "…" if more)
// Each indicator is 3 chars wide visually (space + glyph + space), with 1 char space between
// Matches Sessions panel behavior exactly
function getProjectSessionIndicators(
  ctx: TuiContext,
  projectId: string,
  allTmuxSessions: ReturnType<TuiContext["actions"]["listTmuxSessions"]>,
): string {
  const sessions = listSessionsForProject(ctx.state, projectId);
  const projectPath = ctx.state.projects[projectId]?.path;
  const maxShow = 5;
  const indicatorWidth = 3; // Each indicator is " X " (3 chars visually)
  const spaceBetween = 1; // Space between indicators
  // Max width: 5 indicators * 3 chars + 4 spaces between = 19 chars
  const totalWidth = maxShow * indicatorWidth + (maxShow - 1) * spaceBetween;

  if (!projectPath) return " ".repeat(totalWidth);

  // Build tmux info map for this project's sessions
  const tmuxInfoMap = new Map<string, (typeof allTmuxSessions)[0]>();
  for (const info of allTmuxSessions) {
    if (sessions.some((s) => s.name === info.name)) {
      tmuxInfoMap.set(info.name, info);
    }
  }

  // Collect indicators for all sessions attached to this project
  const indicators: string[] = [];

  for (const session of sessions) {
    if (indicators.length >= maxShow) break;

    const tmuxInfo = tmuxInfoMap.get(session.name);
    const cmd = resolveCommand(session, tmuxInfo).toLowerCase();

    if (cmd.includes("claude")) {
      const projectClaude = ctx.claudeSessions.filter(
        (cs) => cs.projectPath === projectPath || cs.cwd === projectPath,
      );
      if (projectClaude.length > 0) {
        projectClaude.sort((a, b) => (b.lastActivityAt ?? "").localeCompare(a.lastActivityAt ?? ""));
        indicators.push(stateIndicator(projectClaude[0].lastMessageType));
      } else {
        indicators.push(stateIndicator(undefined)); // Unknown state
      }
    } else if (cmd.includes("codex")) {
      const projectCodex = ctx.codexSessions.filter((cs) => cs.cwd === projectPath);
      if (projectCodex.length > 0) {
        projectCodex.sort((a, b) => (b.lastActivityAt ?? "").localeCompare(a.lastActivityAt ?? ""));
        indicators.push(stateIndicator(projectCodex[0].lastMessageType));
      } else {
        indicators.push(stateIndicator(undefined)); // Unknown state
      }
    } else {
      // Non-claude/codex session - show unknown indicator
      indicators.push(stateIndicator(undefined));
    }
  }

  if (indicators.length === 0) return " ".repeat(totalWidth);

  // Build indicators with spaces between them
  const indicatorStr = indicators.join(" "); // Single space between indicators

  // Calculate visual width of indicators (each is 3 chars + 1 space between, except last)
  const indicatorVisualWidth = indicators.length * indicatorWidth + (indicators.length - 1) * spaceBetween;

  // Right-justify: add padding on the left
  const paddingNeeded = totalWidth - indicatorVisualWidth;
  const padding = " ".repeat(Math.max(0, paddingNeeded));

  return padding + indicatorStr;
}

// Update project display items (called when focus changes or data changes)
export function updateProjectDisplay(ctx: TuiContext): void {
  const allTmuxSessions = ctx.actions.listTmuxSessions();

  // Calculate box width for right-justifying indicators
  const boxWidth = (ctx.projectsBox as any).width;
  const totalWidth = (typeof boxWidth === "number" ? boxWidth : 80) - 2; // minus borders
  const indicatorColumnWidth = 19; // 5 indicators * 3 chars + 4 spaces between
  const minGap = 1; // Minimum space between left content and indicators

  const isActive = ctx.focused === "projects";

  const items = ctx.projects.map((p, idx) => {
    const indicators = getProjectSessionIndicators(ctx, p.id, allTmuxSessions);
    const abbrevPath = abbreviatePath(p.path);
    // Project name: white when active OR when this is the selected project. Path: always gray.
    const isSelected = idx === ctx.selectedProjectIndex;

    // Calculate max width available for left content (name + path)
    const maxLeftWidth = totalWidth - indicatorColumnWidth - minGap;

    // Build left content, truncating if needed to always show indicators
    const visibleLeft = `${p.name} ${abbrevPath}`;
    let leftContent: string;
    if (visibleLeft.length <= maxLeftWidth) {
      // Fits - use full content with styling
      const nameText = (isActive || isSelected) ? p.name : `{gray-fg}${p.name}{/gray-fg}`;
      leftContent = `${nameText} {gray-fg}${abbrevPath}{/gray-fg}`;
    } else {
      // Truncate - prioritize showing name, truncate path
      const nameText = (isActive || isSelected) ? p.name : `{gray-fg}${p.name}{/gray-fg}`;
      const nameLen = p.name.length;
      const pathMaxLen = maxLeftWidth - nameLen - 2; // -2 for space and ellipsis
      if (pathMaxLen > 0) {
        const truncPath = abbrevPath.slice(0, pathMaxLen) + "…";
        leftContent = `${nameText} {gray-fg}${truncPath}{/gray-fg}`;
      } else if (maxLeftWidth > 1) {
        // Not even room for path - truncate name
        const truncName = p.name.slice(0, maxLeftWidth - 1) + "…";
        leftContent = (isActive || isSelected) ? truncName : `{gray-fg}${truncName}{/gray-fg}`;
      } else {
        leftContent = "…";
      }
    }

    // Calculate visible length of left content for padding
    const leftVisible = leftContent.replace(/\{[^}]+\}/g, "").length;
    const paddingNeeded = totalWidth - leftVisible - indicatorColumnWidth;
    const padding = " ".repeat(Math.max(minGap, paddingNeeded));

    return `${leftContent}${padding}${indicators}`;
  });
  ctx.projectsBox.setItems(items);

  // Always restore selection after setItems (it resets to 0)
  // The visual highlight is controlled separately in updateFocusedStyles
  ctx.projectsBox.select(ctx.selectedProjectIndex);
}

export function refreshResMode(ctx: TuiContext, runtime: TuiRuntime): void {
  ctx.projects = listProjects(ctx.state);

  // Pre-fetch claude and codex sessions for state indicators
  ctx.claudeSessions = ctx.actions.listClaudeSessions();
  ctx.codexSessions = ctx.actions.listCodexSessions();

  ctx.selectedProjectIndex = Math.min(ctx.selectedProjectIndex, Math.max(0, ctx.projects.length - 1));
  ctx.selectedProject = ctx.projects[ctx.selectedProjectIndex] ?? null;

  updateProjectDisplay(ctx);
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
