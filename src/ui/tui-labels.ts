import type { SessionRecord, StateV1 } from "../types.ts";
import type { TmuxSessionInfo } from "../tmux.ts";
import type { CodexSessionSummary } from "../external/codex.ts";
import type { ClaudeSessionSummary } from "../external/claude.ts";
import { colors, modeColors } from "./tui-constants.ts";

// Get base command (first word) from a command string
export function getBaseCommand(cmd: string | undefined): string {
  if (!cmd?.trim()) return "(shell)";
  const parts = cmd.trim().split(/\s+/);
  return parts[0] || "(shell)";
}

// Disambiguate commands: returns the shortest unique prefix for each session's command
export function disambiguateCommands(sessions: SessionRecord[]): Map<string, string> {
  const result = new Map<string, string>();

  // Group by base command
  const byBase = new Map<string, SessionRecord[]>();
  for (const s of sessions) {
    const base = getBaseCommand(s.command);
    const group = byBase.get(base) ?? [];
    group.push(s);
    byBase.set(base, group);
  }

  for (const [base, group] of byBase) {
    if (group.length === 1) {
      // Only one session with this base command
      result.set(group[0].name, base);
    } else {
      // Multiple sessions - need to disambiguate
      // Group by full command to find truly ambiguous ones
      const byFullCmd = new Map<string, SessionRecord[]>();
      for (const s of group) {
        const full = s.command?.trim() || "(shell)";
        const subgroup = byFullCmd.get(full) ?? [];
        subgroup.push(s);
        byFullCmd.set(full, subgroup);
      }

      if (byFullCmd.size === 1) {
        // All have the same full command, just use base
        for (const s of group) {
          result.set(s.name, base);
        }
      } else {
        // Different full commands, show distinguishing args
        const fullCmds = Array.from(byFullCmd.keys());
        for (const s of group) {
          const full = s.command?.trim() || "(shell)";
          const parts = full.split(/\s+/);

          // Find the shortest prefix that distinguishes this from others
          let prefix = base;
          for (let i = 1; i < parts.length; i++) {
            prefix = parts.slice(0, i + 1).join(" ");
            // Check if this prefix is unique among fullCmds
            const matches = fullCmds.filter((fc) => fc.startsWith(prefix));
            if (matches.length === 1) break;
          }
          result.set(s.name, prefix);
        }
      }
    }
  }

  return result;
}

export function tmuxSessionLabel(info: TmuxSessionInfo, state: StateV1): string {
  const tracked = state.sessions[info.name];
  const project = tracked ? state.projects[tracked.projectId] : undefined;
  const trackedCmd = tracked?.command?.trim().length ? tracked.command.trim() : "";
  const cmd = trackedCmd || info.currentCommand?.trim() || "(unknown)";
  const projectHint = project ? ` {gray-fg}·{/gray-fg} {${colors.secondary}-fg}${project.name}{/}` : "";
  const attachedHint = info.attached ? ` {gray-fg}·{/gray-fg} {${modeColors.codex}-fg}attached:${info.attached}{/}` : "";
  return `{bold}${info.name}{/bold} {gray-fg}${cmd}{/gray-fg}${projectHint}${attachedHint}`;
}

export function truncate(text: string, max: number): string {
  const t = text.replace(/\s+/g, " ").trim();
  if (t.length <= max) return t;
  return t.slice(0, Math.max(0, max - 1)) + "…";
}

// Strip seconds from ISO timestamp: "2024-01-15T10:30:45Z" -> "2024-01-15 10:30"
export function shortTimestamp(iso: string): string {
  // Match YYYY-MM-DDTHH:MM and drop the rest
  const match = iso.match(/^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2})/);
  if (match) return `${match[1]} ${match[2]}`;
  return iso;
}

// State indicator: user = waiting on LLM, assistant = waiting on user, exited = session ended
// Always shows colored background with black glyph
export function stateIndicator(lastMessageType: "user" | "assistant" | "exited" | undefined): string {
  let glyph: string;
  let color: string;

  if (lastMessageType === "user") {
    glyph = "►"; // LLM is working (play)
    color = modeColors.codex;
  } else if (lastMessageType === "assistant") {
    glyph = "‖"; // Waiting for user (pause)
    color = modeColors.tmux;
  } else if (lastMessageType === "exited") {
    glyph = "×"; // Session exited
    color = colors.error; // Red
  } else {
    glyph = "○"; // Unknown state
    color = modeColors.claude; // Yellow
  }

  return `{${color}-bg}{#000000-fg} ${glyph} {/#000000-fg}{/${color}-bg}`;
}

export function codexSessionLabel(info: CodexSessionSummary): string {
  const state = stateIndicator(info.lastMessageType);
  const cwd = info.cwd ? `{gray-fg}${info.cwd}{/gray-fg} ` : "";
  const when = info.lastActivityAt ? `{gray-fg}·{/gray-fg} {${modeColors.res}-fg}${shortTimestamp(info.lastActivityAt)}{/} ` : "";
  const prompt = info.lastPrompt ? `{gray-fg}·{/gray-fg} {gray-fg}${truncate(info.lastPrompt, 80)}{/gray-fg}` : "";
  const id = info.id.length > 12 ? info.id.slice(0, 12) : info.id;
  return `${state} {bold}${id}{/bold} ${cwd}${when}${prompt}`;
}

export function claudeSessionLabel(info: ClaudeSessionSummary): string {
  const state = stateIndicator(info.lastMessageType);
  const project = info.projectPath ? `{gray-fg}${info.projectPath}{/gray-fg} ` : "";
  const when = info.lastActivityAt ? `{gray-fg}·{/gray-fg} {${modeColors.res}-fg}${shortTimestamp(info.lastActivityAt)}{/} ` : "";
  const prompt = info.lastPrompt ? `{gray-fg}·{/gray-fg} {gray-fg}${truncate(info.lastPrompt, 80)}{/gray-fg}` : "";
  const id = info.id.length > 12 ? info.id.slice(0, 12) : info.id;
  return `${state} {bold}${id}{/bold} ${project}${when}${prompt}`;
}

// Abbreviate paths with more than 4 parts: show first 2 and last dir in full,
// abbreviate middle dirs to first letter. e.g. /home/user/a/b/c/project -> /home/user/a/b/c/project (5 parts)
// /home/user/projects/deep/nested/stuff/myproject -> /home/user/p/d/n/s/myproject
export function abbreviatePath(path: string): string {
  const parts = path.split("/").filter((p) => p.length > 0);
  if (parts.length <= 4) return path;

  // Keep first 2 dirs, abbreviate middle, keep last dir
  const first2 = parts.slice(0, 2);
  const middle = parts.slice(2, -1);
  const last = parts[parts.length - 1];

  const abbreviated = middle.map((p) => p[0] || p);
  const prefix = path.startsWith("/") ? "/" : "";
  return prefix + [...first2, ...abbreviated, last].join("/");
}
