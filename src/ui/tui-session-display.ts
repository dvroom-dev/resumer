import type { SessionRecord, Project } from "../types.ts";
import type { TmuxSessionInfo } from "../tmux.ts";
import type { ClaudeSessionSummary } from "../external/claude.ts";
import type { CodexSessionSummary } from "../external/codex.ts";
import { colors, modeColors } from "./tui-constants.ts";
import { disambiguateCommands, getBaseCommand, shortTimestamp, stateIndicator, truncate } from "./tui-labels.ts";
import type { TuiContext } from "./tui-types.ts";
import { getSelectedIndex } from "./tui-utils.ts";

const knownShells = new Set(["bash", "zsh", "fish", "sh", "nu", "tcsh", "csh"]);

function resolveCommandHint(session: SessionRecord, tmuxInfo?: TmuxSessionInfo): string {
  return session.command?.trim() || tmuxInfo?.currentCommand?.trim() || "";
}

function getLastMessageForSession(
  selectedProject: Project | null,
  session: SessionRecord,
  claudeSessions: ClaudeSessionSummary[],
  codexSessions: CodexSessionSummary[],
  tmuxInfo?: TmuxSessionInfo,
): string | null {
  const project = selectedProject;
  if (!project) return null;
  const cmd = resolveCommandHint(session, tmuxInfo).toLowerCase();

  if (cmd.includes("claude")) {
    // Find most recent claude session for this project
    const projectClaude = claudeSessions.filter(
      (cs) => cs.projectPath === project.path || cs.cwd === project.path,
    );
    if (projectClaude.length > 0) {
      projectClaude.sort((a, b) => (b.lastActivityAt ?? "").localeCompare(a.lastActivityAt ?? ""));
      return projectClaude[0].lastPrompt ?? null;
    }
  }

  if (cmd.includes("codex")) {
    // Find most recent codex session for this project
    const projectCodex = codexSessions.filter((cs) => cs.cwd === project.path);
    if (projectCodex.length > 0) {
      projectCodex.sort((a, b) => (b.lastActivityAt ?? "").localeCompare(a.lastActivityAt ?? ""));
      return projectCodex[0].lastPrompt ?? null;
    }
  }

  return null;
}

function getSessionStateIndicator(
  selectedProject: Project | null,
  session: SessionRecord,
  claudeSessions: ClaudeSessionSummary[],
  codexSessions: CodexSessionSummary[],
  tmuxInfo?: TmuxSessionInfo,
): string {
  const project = selectedProject;
  if (!project) return "";
  const cmd = resolveCommandHint(session, tmuxInfo).toLowerCase();

  if (cmd.includes("claude")) {
    const projectClaude = claudeSessions.filter(
      (cs) => cs.projectPath === project.path || cs.cwd === project.path,
    );
    if (projectClaude.length > 0) {
      projectClaude.sort((a, b) => (b.lastActivityAt ?? "").localeCompare(a.lastActivityAt ?? ""));
      return stateIndicator(projectClaude[0].lastMessageType);
    }
  }

  if (cmd.includes("codex")) {
    const projectCodex = codexSessions.filter((cs) => cs.cwd === project.path);
    if (projectCodex.length > 0) {
      projectCodex.sort((a, b) => (b.lastActivityAt ?? "").localeCompare(a.lastActivityAt ?? ""));
      return stateIndicator(projectCodex[0].lastMessageType);
    }
  }

  return "";
}

function generateExpandedSessionLines(
  session: SessionRecord,
  tmuxInfo: TmuxSessionInfo | undefined,
  selectedProject: Project | null,
  claudeSessions: ClaudeSessionSummary[],
  codexSessions: CodexSessionSummary[],
): string[] {
  const lines: string[] = [];
  const indent = "  ";
  const c = colors.secondary;

  const stateInd = getSessionStateIndicator(selectedProject, session, claudeSessions, codexSessions, tmuxInfo);
  const headerCmd = session.command?.trim() || tmuxInfo?.currentCommand?.trim() || "(shell)";
  lines.push(`${stateInd} {gray-fg}${headerCmd}{/gray-fg}`);

  // tmux session name
  lines.push(`${indent}{gray-fg}tmux:{/gray-fg} {${c}-fg}${session.name}{/}`);

  // Kind (managed/linked)
  if (session.kind) {
    const kindColor = session.kind === "linked" ? modeColors.tmux : modeColors.res;
    lines.push(`${indent}{gray-fg}type:{/gray-fg} {${kindColor}-fg}${session.kind}{/}`);
  }

  // Created date
  if (session.createdAt) {
    lines.push(`${indent}{gray-fg}created:{/gray-fg} ${shortTimestamp(session.createdAt)}`);
  }

  // Last attached
  if (session.lastAttachedAt) {
    lines.push(`${indent}{gray-fg}last attached:{/gray-fg} ${shortTimestamp(session.lastAttachedAt)}`);
  }

  // Tmux info if available
  if (tmuxInfo) {
    if (tmuxInfo.attached) {
      lines.push(`${indent}{gray-fg}attached:{/gray-fg} {${modeColors.codex}-fg}${tmuxInfo.attached} client(s){/}`);
    }
    if (tmuxInfo.windows > 1) {
      lines.push(`${indent}{gray-fg}windows:{/gray-fg} ${tmuxInfo.windows}`);
    }
    if (tmuxInfo.currentCommand && tmuxInfo.currentCommand !== session.command?.split(/\s+/)[0]) {
      lines.push(`${indent}{gray-fg}running:{/gray-fg} ${tmuxInfo.currentCommand}`);
    }
    if (tmuxInfo.currentPath) {
      lines.push(`${indent}{gray-fg}cwd:{/gray-fg} ${tmuxInfo.currentPath}`);
    }
  }

  // Last message from claude/codex
  const lastMsg = getLastMessageForSession(selectedProject, session, claudeSessions, codexSessions, tmuxInfo);
  if (lastMsg) {
    lines.push(`${indent}{gray-fg}last prompt:{/gray-fg} ${truncate(lastMsg, 70)}`);
  }

  lines.push("");

  return lines;
}

function truncateToWidth(s: string, maxWidth: number): string {
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

function generateSessionItems(ctx: TuiContext): string[] {
  ctx.listIndexToSessionIndex = [];

  if (!ctx.sessions.length) {
    ctx.listIndexToSessionIndex = [-1];
    return ["(no sessions)"];
  }

  const disambiguated = disambiguateCommands(ctx.sessions);
  const items: string[] = [];

  for (let i = 0; i < ctx.sessions.length; i++) {
    const session = ctx.sessions[i];
    const isExpanded = ctx.expandedSessionIndex === i;
    const tmuxInfo = ctx.sessionTmuxInfo.get(session.name);

    if (isExpanded) {
      const expandedLines = generateExpandedSessionLines(
        session,
        tmuxInfo,
        ctx.selectedProject,
        ctx.claudeSessions,
        ctx.codexSessions,
      );
      for (const line of expandedLines) {
        items.push(line);
        ctx.listIndexToSessionIndex.push(i);
      }
    } else {
      const stateInd = getSessionStateIndicator(
        ctx.selectedProject,
        session,
        ctx.claudeSessions,
        ctx.codexSessions,
        tmuxInfo,
      );
      const sessionCmd = session.command?.trim();
      let displayCmd = sessionCmd ? disambiguated.get(session.name) : undefined;
      if (!displayCmd) {
        if (sessionCmd) {
          displayCmd = getBaseCommand(sessionCmd);
        } else if (tmuxInfo?.currentCommand?.trim()) {
          const base = getBaseCommand(tmuxInfo.currentCommand.trim());
          displayCmd = knownShells.has(base) ? "(shell)" : base;
        } else {
          displayCmd = "(shell)";
        }
      }
      const lastMsg = getLastMessageForSession(
        ctx.selectedProject,
        session,
        ctx.claudeSessions,
        ctx.codexSessions,
        tmuxInfo,
      );
      const msgPart = lastMsg ? ` {gray-fg}▏${truncate(lastMsg, 60)}{/gray-fg}` : "";

      items.push(`${stateInd} {gray-fg}${displayCmd}{/gray-fg}${msgPart}`);
      ctx.listIndexToSessionIndex.push(i);
    }
  }

  return items;
}

export function updateSessionDisplay(ctx: TuiContext): void {
  if (ctx.updatingSessionDisplay) return;
  ctx.updatingSessionDisplay = true;

  try {
    const selectedListIdx = getSelectedIndex(ctx.sessionsBox);
    const items = generateSessionItems(ctx);

    const boxWidth = (ctx.sessionsBox as any).width;
    const totalWidth = (typeof boxWidth === "number" ? boxWidth : 80) - 3;
    const indicatorWidth = 7;
    const contentWidth = totalWidth - indicatorWidth;

    for (let i = 0; i < items.length; i++) {
      const sessionIdx = ctx.listIndexToSessionIndex[i];
      const isSelected = i === selectedListIdx;
      const isValidSession = sessionIdx !== undefined && sessionIdx >= 0;

      const paddedContent = truncateToWidth(items[i], contentWidth);

      if (ctx.focused === "sessions" && isSelected && isValidSession) {
        const isExpanded = ctx.expandedSessionIndex === sessionIdx;
        const indicator = isExpanded
          ? `{white-bg}{#000000-fg} cl{${colors.secondary}-fg}{underline}o{/underline}{/${colors.secondary}-fg}se {/#000000-fg}{/white-bg}`
          : `{white-bg}{#000000-fg}  {${colors.secondary}-fg}{underline}o{/underline}{/${colors.secondary}-fg}pen {/#000000-fg}{/white-bg}`;
        items[i] = paddedContent + indicator;
      } else {
        items[i] = paddedContent;
      }
    }

    ctx.sessionsBox.setItems(items);
    if (ctx.focused === "sessions") {
      ctx.sessionsBox.select(selectedListIdx);
    } else {
      (ctx.sessionsBox as any).selected = -1;
    }
  } finally {
    ctx.updatingSessionDisplay = false;
  }
}

export function getSelectedSessionIndex(ctx: TuiContext): number | null {
  if (!ctx.sessions.length) return null;
  const listIdx = getSelectedIndex(ctx.sessionsBox);
  const sessionIdx = ctx.listIndexToSessionIndex[listIdx];
  if (sessionIdx === undefined || sessionIdx < 0) return null;
  return sessionIdx;
}
