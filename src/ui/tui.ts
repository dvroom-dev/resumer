import { blessed } from "./blessed.ts";
import type { Widgets } from "blessed";
import type { Project, SessionRecord, StateV1 } from "../types.ts";
import { listProjects, listSessionsForProject, normalizeAndEnsureProject, writeState } from "../state.ts";
import { nowIso } from "../time.ts";
import type { TmuxSessionInfo } from "../tmux.ts";
import { getBlessedTerminalOverride } from "./term.ts";
import type { CodexSessionSummary } from "../external/codex.ts";
import type { ClaudeSessionSummary } from "../external/claude.ts";

// Mode-specific colors
const modeColors = {
  res: "#44AADA",       // blue
  tmux: "#6AB244",      // green
  codex: "#E88E2D",     // orange
  claude: "#DFD33F",    // yellow
};

const colors = {
  secondary: "#44AADA",   // blue
  error: "#CD3731",       // red
  selectedDim: {
    bg: "#374151",
    fg: "#9ca3af",
  },
  border: "#6AB244",      // green (not blue since res uses blue)
  borderDim: "#4b5563",
};

function getModeColor(mode: keyof typeof modeColors): string {
  return modeColors[mode];
}

export type TuiActions = {
  refreshLiveSessions(): void;
  listTmuxSessions(): TmuxSessionInfo[];
  listCodexSessions(): CodexSessionSummary[];
  codexSessionDetails(session: CodexSessionSummary): string;
  codexResumeCommand(sessionId: string): string;
  listClaudeSessions(): ClaudeSessionSummary[];
  claudeSessionDetails(session: ClaudeSessionSummary): string;
  claudeResumeCommand(sessionId: string): string;
  createSession(project: Project, command?: string): SessionRecord;
  deleteSession(sessionName: string): void;
  unassociateSession(sessionName: string): void;
  captureSessionPane(sessionName: string): string;
  copyText(text: string): { method: string };
  linkSession(project: Project, sessionName: string, yes: boolean): void;
  attachSession(sessionName: string): void;
};

// Get base command (first word) from a command string
function getBaseCommand(cmd: string | undefined): string {
  if (!cmd?.trim()) return "(shell)";
  const parts = cmd.trim().split(/\s+/);
  return parts[0] || "(shell)";
}

// Disambiguate commands: returns the shortest unique prefix for each session's command
function disambiguateCommands(sessions: SessionRecord[]): Map<string, string> {
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
            const matches = fullCmds.filter(fc => fc.startsWith(prefix));
            if (matches.length === 1) break;
          }
          result.set(s.name, prefix);
        }
      }
    }
  }

  return result;
}

function tmuxSessionLabel(info: TmuxSessionInfo, state: StateV1): string {
  const tracked = state.sessions[info.name];
  const project = tracked ? state.projects[tracked.projectId] : undefined;
  const trackedCmd = tracked?.command?.trim().length ? tracked.command.trim() : "";
  const cmd = trackedCmd || info.currentCommand?.trim() || "(unknown)";
  const projectHint = project ? ` {gray-fg}·{/gray-fg} {${colors.secondary}-fg}${project.name}{/}` : "";
  const attachedHint = info.attached ? ` {gray-fg}·{/gray-fg} {${modeColors.codex}-fg}attached:${info.attached}{/}` : "";
  return `{bold}${info.name}{/bold} {gray-fg}${cmd}{/gray-fg}${projectHint}${attachedHint}`;
}

function truncate(text: string, max: number): string {
  const t = text.replace(/\s+/g, " ").trim();
  if (t.length <= max) return t;
  return t.slice(0, Math.max(0, max - 1)) + "…";
}

// Strip seconds from ISO timestamp: "2024-01-15T10:30:45Z" -> "2024-01-15 10:30"
function shortTimestamp(iso: string): string {
  // Match YYYY-MM-DDTHH:MM and drop the rest
  const match = iso.match(/^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2})/);
  if (match) return `${match[1]} ${match[2]}`;
  return iso;
}

// State indicator: user = waiting on LLM, assistant = waiting on user, exited = session ended
function stateIndicator(lastMessageType: "user" | "assistant" | "exited" | undefined, isSelected: boolean = false): string {
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
    color = "gray";
  } else {
    glyph = "○"; // Unknown state
    color = "gray";
  }

  if (isSelected) {
    return `{${color}-bg} {black-fg}${glyph}{/black-fg} {/${color}-bg}`;
  }
  return ` {${color}-fg}${glyph}{/${color}-fg} `;
}

function codexSessionLabel(info: CodexSessionSummary, isSelected: boolean = false): string {
  const state = stateIndicator(info.lastMessageType, isSelected);
  const cwd = info.cwd ? `{gray-fg}${info.cwd}{/gray-fg} ` : "";
  const when = info.lastActivityAt ? `{gray-fg}·{/gray-fg} {${modeColors.res}-fg}${shortTimestamp(info.lastActivityAt)}{/} ` : "";
  const prompt = info.lastPrompt ? `{gray-fg}·{/gray-fg} {gray-fg}${truncate(info.lastPrompt, 80)}{/gray-fg}` : "";
  const id = info.id.length > 12 ? info.id.slice(0, 12) : info.id;
  return `${state}{bold}${id}{/bold} ${cwd}${when}${prompt}`;
}

function claudeSessionLabel(info: ClaudeSessionSummary, isSelected: boolean = false): string {
  const state = stateIndicator(info.lastMessageType, isSelected);
  const project = info.projectPath ? `{gray-fg}${info.projectPath}{/gray-fg} ` : "";
  const when = info.lastActivityAt ? `{gray-fg}·{/gray-fg} {${modeColors.res}-fg}${shortTimestamp(info.lastActivityAt)}{/} ` : "";
  const prompt = info.lastPrompt ? `{gray-fg}·{/gray-fg} {gray-fg}${truncate(info.lastPrompt, 80)}{/gray-fg}` : "";
  const id = info.id.length > 12 ? info.id.slice(0, 12) : info.id;
  return `${state}{bold}${id}{/bold} ${project}${when}${prompt}`;
}

function getSelectedIndex(list: Widgets.ListElement): number {
  const selected = (list as any).selected;
  return typeof selected === "number" ? selected : 0;
}

export async function runMainTui(args: {
  state: StateV1;
  actions: TuiActions;
}): Promise<void> {
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    throw new Error("res TUI requires a TTY.");
  }

  return await new Promise<void>((resolve, reject) => {
    const term = getBlessedTerminalOverride();
    const screen = blessed.screen({ smartCSR: true, title: "resumer", terminal: term });

    const header = blessed.box({
      parent: screen,
      top: 0,
      left: 0,
      height: 1,
      width: "100%",
      content: "",
      tags: true,
      mouse: true,
      style: { bg: "default" },
    });

    const siteUrl = "https://dvroom.dev";
    const headerUrl = blessed.box({
      parent: screen,
      top: 0,
      right: 0,
      height: 1,
      width: siteUrl.length + 1,
      content: `{gray-fg}${siteUrl}{/gray-fg}`,
      tags: true,
      mouse: true,
      style: { bg: "default" },
    });

    headerUrl.on("mouseover", () => {
      headerUrl.setContent(`{underline}{white-fg}${siteUrl}{/white-fg}{/underline}`);
      screen.render();
    });
    headerUrl.on("mouseout", () => {
      headerUrl.setContent(`{gray-fg}${siteUrl}{/gray-fg}`);
      screen.render();
    });
    headerUrl.on("click", () => {
      // Try common openers - xdg-open (Linux), open (macOS)
      try {
        Bun.spawn(["xdg-open", siteUrl], { stdio: ["ignore", "ignore", "ignore"] });
      } catch {
        try {
          Bun.spawn(["open", siteUrl], { stdio: ["ignore", "ignore", "ignore"] });
        } catch {
          // Silently fail if no opener available
        }
      }
    });

    const projectsBox = blessed.list({
      parent: screen,
      top: 1,
      left: 0,
      width: "100%",
      height: "30%",
      keys: true,
      vi: true,
      mouse: true,
      border: "line",
      label: " Projects ",
      style: {
        border: { fg: colors.border },
        selected: { bg: modeColors.res, fg: "black", bold: true },
      },
      scrollbar: { style: { bg: modeColors.res } },
      tags: true,
    });

    const sessionsBox = blessed.list({
      parent: screen,
      top: "30%+1",
      left: 0,
      width: "100%",
      height: "70%-2",
      keys: true,
      vi: true,
      mouse: true,
      border: "line",
      label: " Sessions ",
      style: {
        border: { fg: colors.border },
        selected: { bg: colors.selectedDim.bg, fg: colors.selectedDim.fg, bold: true },
      },
      scrollbar: { style: { bg: colors.borderDim } },
      tags: true,
    });

    const tmuxBox = blessed.list({
      parent: screen,
      top: 1,
      left: 0,
      width: "100%",
      height: "100%-2",
      keys: true,
      vi: true,
      mouse: true,
      border: "line",
      label: " Sessions ",
      style: {
        border: { fg: colors.border },
        selected: { bg: modeColors.tmux, fg: "black", bold: true },
      },
      scrollbar: { style: { bg: modeColors.tmux } },
      tags: true,
      hidden: true,
    });

    const footer = blessed.box({
      parent: screen,
      bottom: 0,
      left: 0,
      height: 1,
      width: "100%",
      content: "",
      tags: true,
      style: { fg: "gray" },
    });

    const prompt = blessed.prompt({
      parent: screen,
      border: "line",
      height: 7,
      width: "60%",
      top: "center",
      left: "center",
      label: " Input ",
      tags: true,
      hidden: true,
      style: { border: { fg: colors.secondary } },
    });

    const question = blessed.question({
      parent: screen,
      border: "line",
      height: 7,
      width: "60%",
      top: "center",
      left: "center",
      label: " Confirm ",
      tags: true,
      hidden: true,
      style: { border: { fg: colors.secondary } },
    });

    let mode: "res" | "tmux" | "codex" | "claude" = "res";
    let focused: "projects" | "sessions" = "projects";
    let projects: Project[] = [];
    let sessions: SessionRecord[] = [];
    let selectedProject: Project | null = null;
    let selectedProjectIndex = 0;

    let tmuxSessions: TmuxSessionInfo[] = [];
    let selectedTmuxIndex = 0;

    let codexSessions: CodexSessionSummary[] = [];
    let selectedCodexIndex = 0;

    let claudeSessions: ClaudeSessionSummary[] = [];
    let selectedClaudeIndex = 0;

    // Session expand/collapse state
    let expandedSessionIndex: number | null = null;
    // Cache tmux info for current sessions
    let sessionTmuxInfo: Map<string, TmuxSessionInfo> = new Map();
    // Map from list item index to session index (for expanded views)
    let listIndexToSessionIndex: number[] = [];
    // Guard to prevent recursive updates
    let updatingSessionDisplay = false;

    let modalClose: (() => void) | null = null;

    let footerTimer: ReturnType<typeof setTimeout> | null = null;

    // Search state
    let searchActive = false;
    let searchQuery = "";

    // Tab definitions with their positions for mouse click detection
    const tabs = ["res", "tmux", "codex", "claude"] as const;
    let tabPositions: Array<{ start: number; end: number; mode: typeof tabs[number] }> = [];
    let hoveredTab: typeof tabs[number] | null = null;

    function updateHeader() {
      // Colored "resumer" title: res(blue) u(green) m(orange) e(yellow) r(red)
      const coloredTitle =
        `{${modeColors.res}-fg}{bold}res{/bold}{/}` +
        `{${modeColors.tmux}-fg}{bold}u{/bold}{/}` +
        `{${modeColors.codex}-fg}{bold}m{/bold}{/}` +
        `{${modeColors.claude}-fg}{bold}e{/bold}{/}` +
        `{${colors.error}-fg}{bold}r{/bold}{/}`;

      // Build tabs with position tracking
      let content = ` ${coloredTitle} {gray-fg}│{/gray-fg}`;
      let pos = 12; // " resumer │" = 12 chars
      tabPositions = [];

      for (let i = 0; i < tabs.length; i++) {
        const tab = tabs[i];
        const tabColor = modeColors[tab];
        const num = i + 1;
        const isActive = mode === tab;
        const isHovered = hoveredTab === tab && !isActive;
        const start = pos;
        const label = `(${num}) ${tab}`;

        if (isActive) {
          content += `{${tabColor}-bg}{black-fg}{bold} ${label} {/bold}{/black-fg}{/}`;
        } else if (isHovered) {
          content += `{${tabColor}-fg}{underline} ${label} {/underline}{/}`;
        } else {
          content += `{gray-fg} ${label} {/gray-fg}`;
        }

        // Calculate position (label + 2 spaces padding)
        pos += label.length + 2;
        tabPositions.push({ start, end: pos, mode: tab });
      }

      header.setContent(content);
    }

    // Handle mouse clicks on header tabs
    header.on("click", (_mouse: any) => {
      const x = _mouse.x;
      for (const tab of tabPositions) {
        if (x >= tab.start && x < tab.end) {
          setMode(tab.mode);
          return;
        }
      }
    });

    // Handle mouse hover on header tabs
    header.on("mousemove", (_mouse: any) => {
      const x = _mouse.x;
      let newHovered: typeof tabs[number] | null = null;
      for (const tab of tabPositions) {
        if (x >= tab.start && x < tab.end) {
          newHovered = tab.mode;
          break;
        }
      }
      if (newHovered !== hoveredTab) {
        hoveredTab = newHovered;
        updateHeader();
        screen.render();
      }
    });

    header.on("mouseout", () => {
      if (hoveredTab !== null) {
        hoveredTab = null;
        updateHeader();
        screen.render();
      }
    });

    // Helper for styled key in footer: if key is in action, underline it; otherwise "key: action"
    function styledKey(key: string, action: string): string {
      const c = colors.secondary;
      const lowerKey = key.toLowerCase();
      const lowerAction = action.toLowerCase();
      const keyIdx = lowerAction.indexOf(lowerKey);

      if (keyIdx >= 0 && key.length === 1) {
        // Key is in the action name - underline that character
        const before = action.slice(0, keyIdx);
        const char = action.slice(keyIdx, keyIdx + 1);
        const after = action.slice(keyIdx + 1);
        return `${before}{${c}-fg}{underline}${char}{/underline}{/}${after}`;
      }
      // Key not in action - format as "key: action" with key styled
      return `{${c}-fg}{underline}${key}{/underline}{/}: ${action}`;
    }

    function updateFooter() {
      updateHeader();
      const c = colors.secondary;
      const sep = " · ";

      if (mode === "tmux") {
        footer.setContent(
          [
            styledKey("?", "help"),
            styledKey("Enter", "attach"),
            styledKey("d", "delete"),
            styledKey("c", "capture"),
            styledKey("y", "copy"),
            styledKey("l", "link"),
            styledKey("u", "unlink"),
            styledKey("/", "search"),
            styledKey("r", "refresh"),
            styledKey("q", "quit"),
          ].join(sep),
        );
        return;
      }
      if (mode === "codex") {
        footer.setContent(
          [
            styledKey("?", "help"),
            styledKey("Enter", "view"),
            styledKey("c", "create tmux"),
            styledKey("y", "copy id"),
            styledKey("/", "search"),
            styledKey("r", "refresh"),
            styledKey("q", "quit"),
          ].join(sep),
        );
        return;
      }
      if (mode === "claude") {
        footer.setContent(
          [
            styledKey("?", "help"),
            styledKey("Enter", "view"),
            styledKey("c", "create tmux"),
            styledKey("y", "copy id"),
            styledKey("/", "search"),
            styledKey("r", "refresh"),
            styledKey("q", "quit"),
          ].join(sep),
        );
        return;
      }
      if (focused === "projects") {
        footer.setContent(
          "Projects" + sep +
          [
            styledKey("?", "help"),
            styledKey("Enter", "sessions"),
            styledKey("a", "add"),
            styledKey("x", "remove"),
            styledKey("/", "search"),
            styledKey("r", "refresh"),
            styledKey("q", "quit"),
          ].join(sep),
        );
      } else {
        footer.setContent(
          "Sessions" + sep +
          [
            styledKey("?", "help"),
            styledKey("Enter", "attach"),
            styledKey("o", "open/close"),
            styledKey("c", "create"),
            styledKey("d", "delete"),
            styledKey("l", "link"),
            styledKey("u", "unlink"),
            styledKey("/", "search"),
            styledKey("r", "refresh"),
            styledKey("q", "quit"),
          ].join(sep),
        );
      }
    }

    function updateFocusedStyles() {
      const modeColor = getModeColor(mode);

      if (mode !== "res") {
        // For non-res modes, update tmuxBox styling
        (tmuxBox as any).style.border.fg = modeColor;
        (tmuxBox as any).style.selected.bg = modeColor;
        (tmuxBox as any).style.selected.fg = "black";
        (tmuxBox as any).style.scrollbar.bg = modeColor;
        return;
      }

      // Update border colors based on focus
      const projectsBorderColor = focused === "projects" ? modeColor : colors.borderDim;
      const sessionsBorderColor = focused === "sessions" ? modeColor : colors.borderDim;

      (projectsBox as any).style.border.fg = projectsBorderColor;
      (sessionsBox as any).style.border.fg = sessionsBorderColor;

      // Update selected item styles based on focus
      const focusedSelected = { bg: modeColor, fg: "black" };
      const projectsSelected = focused === "projects" ? focusedSelected : colors.selectedDim;
      const sessionsSelected = focused === "sessions" ? focusedSelected : colors.selectedDim;

      (projectsBox as any).style.selected.bg = projectsSelected.bg;
      (projectsBox as any).style.selected.fg = projectsSelected.fg;
      (sessionsBox as any).style.selected.bg = sessionsSelected.bg;
      (sessionsBox as any).style.selected.fg = sessionsSelected.fg;

      // Update scrollbar colors
      (projectsBox as any).style.scrollbar.bg = focused === "projects" ? modeColor : colors.borderDim;
      (sessionsBox as any).style.scrollbar.bg = focused === "sessions" ? modeColor : colors.borderDim;

      // Update labels with focus indicator
      const projectsLabel = focused === "projects"
        ? ` {${modeColor}-fg}{bold}> Projects{/bold}{/} `
        : " {gray-fg}Projects{/gray-fg} ";
      const sessionsLabel = focused === "sessions"
        ? ` {${modeColor}-fg}{bold}> Sessions{/bold}{/} `
        : " {gray-fg}Sessions{/gray-fg} ";

      projectsBox.setLabel(projectsLabel);
      sessionsBox.setLabel(sessionsLabel);
    }

    function flashFooter(message: string, ms = 1500) {
      if (footerTimer) clearTimeout(footerTimer);
      footer.setContent(message);
      screen.render();
      footerTimer = setTimeout(() => {
        updateFooter();
        screen.render();
      }, ms);
    }

    // Get last message from claude/codex sessions for the current project
    function getLastMessageForSession(s: SessionRecord): string | null {
      const project = selectedProject;
      if (!project) return null;
      const cmd = s.command?.toLowerCase() ?? "";

      if (cmd.includes("claude")) {
        // Find most recent claude session for this project
        const projectClaude = claudeSessions.filter(
          (cs) => cs.projectPath === project.path || cs.cwd === project.path
        );
        if (projectClaude.length > 0) {
          // Sort by lastActivityAt descending
          projectClaude.sort((a, b) => (b.lastActivityAt ?? "").localeCompare(a.lastActivityAt ?? ""));
          return projectClaude[0].lastPrompt ?? null;
        }
      }

      if (cmd.includes("codex")) {
        // Find most recent codex session for this project
        const projectCodex = codexSessions.filter(
          (cs) => cs.cwd === project.path
        );
        if (projectCodex.length > 0) {
          projectCodex.sort((a, b) => (b.lastActivityAt ?? "").localeCompare(a.lastActivityAt ?? ""));
          return projectCodex[0].lastPrompt ?? null;
        }
      }

      return null;
    }

    // Get state indicator for a res session (based on claude/codex session state)
    function getSessionStateIndicator(s: SessionRecord, isSelected: boolean = false): string {
      const project = selectedProject;
      if (!project) return "";
      const cmd = s.command?.toLowerCase() ?? "";

      if (cmd.includes("claude")) {
        const projectClaude = claudeSessions.filter(
          (cs) => cs.projectPath === project.path || cs.cwd === project.path
        );
        if (projectClaude.length > 0) {
          projectClaude.sort((a, b) => (b.lastActivityAt ?? "").localeCompare(a.lastActivityAt ?? ""));
          return stateIndicator(projectClaude[0].lastMessageType, isSelected);
        }
      }

      if (cmd.includes("codex")) {
        const projectCodex = codexSessions.filter(
          (cs) => cs.cwd === project.path
        );
        if (projectCodex.length > 0) {
          projectCodex.sort((a, b) => (b.lastActivityAt ?? "").localeCompare(a.lastActivityAt ?? ""));
          return stateIndicator(projectCodex[0].lastMessageType, isSelected);
        }
      }

      return "";
    }

    // Generate session items for display (handles expand/collapse)
    // Also builds listIndexToSessionIndex mapping
    function generateSessionItems(selectedListIndex: number = 0): string[] {
      listIndexToSessionIndex = [];

      if (!sessions.length) {
        listIndexToSessionIndex = [-1]; // No valid session
        return ["(no sessions)"];
      }

      const disambiguated = disambiguateCommands(sessions);
      const items: string[] = [];
      let currentListIndex = 0;

      for (let i = 0; i < sessions.length; i++) {
        const s = sessions[i];
        const isExpanded = expandedSessionIndex === i;
        const tmuxInfo = sessionTmuxInfo.get(s.name);

        if (isExpanded) {
          // Expanded view - multiple lines
          const firstLineSelected = currentListIndex === selectedListIndex;
          const expandedLines = generateExpandedSessionLines(s, tmuxInfo, firstLineSelected);
          for (const line of expandedLines) {
            items.push(line);
            listIndexToSessionIndex.push(i);
            currentListIndex++;
          }
        } else {
          // Collapsed view - single line
          const isSelected = currentListIndex === selectedListIndex;
          const stateInd = getSessionStateIndicator(s, isSelected);
          const displayCmd = disambiguated.get(s.name) ?? getBaseCommand(s.command);
          const lastMsg = getLastMessageForSession(s);
          const msgPart = lastMsg ? ` {gray-fg}│{/gray-fg} {gray-fg}${truncate(lastMsg, 60)}{/gray-fg}` : "";

          items.push(`${stateInd}{bold}${displayCmd}{/bold}${msgPart}`);
          listIndexToSessionIndex.push(i);
          currentListIndex++;
        }
      }

      return items;
    }

    // Strip blessed tags to get visible text length
    function visibleLength(s: string): number {
      return s.replace(/\{[^}]+\}/g, "").length;
    }

    // Truncate visible text (preserving tags) to max length, add ellipsis if needed
    function truncateToWidth(s: string, maxWidth: number): string {
      const visible = s.replace(/\{[^}]+\}/g, "");
      if (visible.length <= maxWidth) {
        // Pad to exact width
        return s + " ".repeat(maxWidth - visible.length);
      }
      // Need to truncate - this is approximate since we can't easily split mid-tag
      // Just truncate the visible portion and hope tags are at the end
      let result = "";
      let visibleCount = 0;
      let i = 0;
      while (i < s.length && visibleCount < maxWidth - 1) {
        if (s[i] === "{") {
          // Skip tag
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

    // Update session items and add open/close indicators to selected item
    function updateSessionDisplay() {
      if (updatingSessionDisplay) return;
      updatingSessionDisplay = true;

      try {
        const selectedListIdx = getSelectedIndex(sessionsBox);
        const items = generateSessionItems(selectedListIdx);

        // Calculate column widths
        // sessionsBox width minus borders (2) minus scrollbar (1)
        const boxWidth = (sessionsBox as any).width;
        const totalWidth = (typeof boxWidth === "number" ? boxWidth : 80) - 3;
        const indicatorWidth = 7; // " open " or " close"
        const contentWidth = totalWidth - indicatorWidth;

        // Format all items to fixed width, add indicator only to selected
        for (let i = 0; i < items.length; i++) {
          const sessionIdx = listIndexToSessionIndex[i];
          const isSelected = i === selectedListIdx;
          const isValidSession = sessionIdx !== undefined && sessionIdx >= 0;

          // Truncate/pad content to fixed width
          const paddedContent = truncateToWidth(items[i], contentWidth);

          if (isSelected && isValidSession) {
            const isExpanded = expandedSessionIndex === sessionIdx;
            // White background, black text, with 'o' underlined in blue
            const indicator = isExpanded
              ? `{white-bg}{black-fg} cl{${colors.secondary}-fg}{underline}o{/underline}{/black-fg}se {/}`
              : `{white-bg}{black-fg} {${colors.secondary}-fg}{underline}o{/underline}{/black-fg}pen {/}`;
            items[i] = paddedContent + indicator;
          } else {
            items[i] = paddedContent;
          }
        }

        sessionsBox.setItems(items);
        sessionsBox.select(selectedListIdx);
      } finally {
        updatingSessionDisplay = false;
      }
    }

    // Generate expanded view lines for a session
    function generateExpandedSessionLines(s: SessionRecord, tmuxInfo: TmuxSessionInfo | undefined, isHeaderSelected: boolean = false): string[] {
      const lines: string[] = [];
      const indent = "  ";
      const c = colors.secondary;

      // Header line with state indicator
      const stateInd = getSessionStateIndicator(s, isHeaderSelected);
      lines.push(`${stateInd}{bold}${s.command?.trim() || "(shell)"}{/bold}`);

      // tmux session name
      lines.push(`${indent}{gray-fg}tmux:{/gray-fg} {${c}-fg}${s.name}{/}`);

      // Kind (managed/linked)
      if (s.kind) {
        const kindColor = s.kind === "linked" ? modeColors.tmux : modeColors.res;
        lines.push(`${indent}{gray-fg}type:{/gray-fg} {${kindColor}-fg}${s.kind}{/}`);
      }

      // Created date
      if (s.createdAt) {
        lines.push(`${indent}{gray-fg}created:{/gray-fg} ${shortTimestamp(s.createdAt)}`);
      }

      // Last attached
      if (s.lastAttachedAt) {
        lines.push(`${indent}{gray-fg}last attached:{/gray-fg} ${shortTimestamp(s.lastAttachedAt)}`);
      }

      // Tmux info if available
      if (tmuxInfo) {
        if (tmuxInfo.attached) {
          lines.push(`${indent}{gray-fg}attached:{/gray-fg} {${modeColors.codex}-fg}${tmuxInfo.attached} client(s){/}`);
        }
        if (tmuxInfo.windows > 1) {
          lines.push(`${indent}{gray-fg}windows:{/gray-fg} ${tmuxInfo.windows}`);
        }
        if (tmuxInfo.currentCommand && tmuxInfo.currentCommand !== s.command?.split(/\s+/)[0]) {
          lines.push(`${indent}{gray-fg}running:{/gray-fg} ${tmuxInfo.currentCommand}`);
        }
        if (tmuxInfo.currentPath) {
          lines.push(`${indent}{gray-fg}cwd:{/gray-fg} ${tmuxInfo.currentPath}`);
        }
      }

      // Last message from claude/codex
      const lastMsg = getLastMessageForSession(s);
      if (lastMsg) {
        lines.push(`${indent}{gray-fg}last prompt:{/gray-fg} ${truncate(lastMsg, 70)}`);
      }

      // Empty line for separation
      lines.push("");

      return lines;
    }

    function fail(err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      try {
        screen.destroy();
      } catch {
        // ignore
      }
      reject(new Error(message));
    }

    function showError(text: string) {
      const errorBox = blessed.box({
        parent: screen,
        top: "center",
        left: "center",
        width: "60%",
        height: 7,
        border: "line",
        label: ` {${colors.error}-fg}{bold}Error{/bold}{/} `,
        tags: true,
        style: {
          border: { fg: colors.error },
        },
        content: text,
      });

      const errorFooter = blessed.box({
        parent: errorBox,
        bottom: 0,
        left: 0,
        width: "100%-2",
        height: 1,
        tags: true,
        style: {
          bg: "#374151",
          fg: "white",
        },
        content: " Enter/Esc: close",
      });

      errorBox.focus();
      screen.render();

      function close() {
        errorBox.destroy();
        screen.realloc();
        screen.render();
        refresh();
      }

      errorBox.key(["enter", "escape", "q"], () => close());
    }

    function refreshResMode() {
      projects = listProjects(args.state);
      const items = projects.map((p) => `${p.name} {gray-fg}${p.path}{/}`);
      projectsBox.setItems(items);

      selectedProjectIndex = Math.min(selectedProjectIndex, Math.max(0, projects.length - 1));
      projectsBox.select(selectedProjectIndex);

      selectedProject = projects[selectedProjectIndex] ?? null;
      refreshSessionsForSelectedProject();
    }

    function refreshTmuxMode() {
      tmuxSessions = args.actions.listTmuxSessions();
      const items = tmuxSessions.map((s) => tmuxSessionLabel(s, args.state));
      tmuxBox.setLabel(` {${modeColors.tmux}-fg}{bold}tmux Sessions{/bold}{/} `);
      tmuxBox.setItems(items.length ? items : ["(no tmux sessions)"]);
      selectedTmuxIndex = Math.min(selectedTmuxIndex, Math.max(0, tmuxSessions.length - 1));
      tmuxBox.select(selectedTmuxIndex);
    }

    function refreshCodexMode() {
      codexSessions = args.actions.listCodexSessions();
      tmuxBox.setLabel(` {${modeColors.codex}-fg}{bold}Codex Sessions{/bold}{/} `);
      selectedCodexIndex = Math.min(selectedCodexIndex, Math.max(0, codexSessions.length - 1));
      updateCodexItems();
    }

    function updateCodexItems() {
      const items = codexSessions.map((s, i) => codexSessionLabel(s, i === selectedCodexIndex));
      tmuxBox.setItems(items.length ? items : ["(no Codex sessions found)"]);
      tmuxBox.select(selectedCodexIndex);
    }

    function refreshClaudeMode() {
      claudeSessions = args.actions.listClaudeSessions();
      tmuxBox.setLabel(` {${modeColors.claude}-fg}{bold}Claude Sessions{/bold}{/} `);
      selectedClaudeIndex = Math.min(selectedClaudeIndex, Math.max(0, claudeSessions.length - 1));
      updateClaudeItems();
    }

    function updateClaudeItems() {
      const items = claudeSessions.map((s, i) => claudeSessionLabel(s, i === selectedClaudeIndex));
      tmuxBox.setItems(items.length ? items : ["(no Claude sessions found)"]);
      tmuxBox.select(selectedClaudeIndex);
    }

    function refresh() {
      try {
        args.actions.refreshLiveSessions();
      } catch (err) {
        showError(err instanceof Error ? err.message : String(err));
        return;
      }
      if (mode === "tmux") refreshTmuxMode();
      else if (mode === "codex") refreshCodexMode();
      else if (mode === "claude") refreshClaudeMode();
      else refreshResMode();
      updateHeader();
      updateFocusedStyles();
      screen.render();
    }

    function refreshSessionsForSelectedProject() {
      // Reset expanded state when changing projects
      expandedSessionIndex = null;

      if (!selectedProject) {
        sessions = [];
        listIndexToSessionIndex = [-1];
        sessionsBox.setItems(["(no projects)"]);
        sessionsBox.select(0);
        return;
      }

      sessions = listSessionsForProject(args.state, selectedProject.id);

      if (!sessions.length) {
        listIndexToSessionIndex = [-1];
        sessionsBox.setItems(["(no sessions)"]);
        sessionsBox.select(0);
        return;
      }

      // Cache tmux info for sessions
      const allTmuxInfo = args.actions.listTmuxSessions();
      sessionTmuxInfo.clear();
      for (const info of allTmuxInfo) {
        if (sessions.some((s) => s.name === info.name)) {
          sessionTmuxInfo.set(info.name, info);
        }
      }

      // Also load claude/codex sessions for last message display
      claudeSessions = args.actions.listClaudeSessions();
      codexSessions = args.actions.listCodexSessions();

      updateSessionDisplay();
    }

    function done() {
      screen.destroy();
      resolve();
    }

    function setMode(nextMode: "res" | "tmux" | "codex" | "claude") {
      mode = nextMode;
      updateFooter();
      if (mode !== "res") {
        projectsBox.hide();
        sessionsBox.hide();
        tmuxBox.show();
        tmuxBox.focus();
      } else {
        tmuxBox.hide();
        projectsBox.show();
        sessionsBox.show();
        (focused === "projects" ? projectsBox : sessionsBox).focus();
      }
      updateFocusedStyles();
      // Force full screen redraw to clear any visual artifacts from mode switch
      screen.realloc();
      refresh();
    }

    function withPrompt(title: string, value: string, cb: (input: string | null) => void) {
      const modeColor = getModeColor(mode);
      const promptBox = blessed.box({
        parent: screen,
        top: "center",
        left: "center",
        width: "60%",
        height: 7,
        border: "line",
        label: ` {${modeColor}-fg}{bold}${title}{/bold}{/} `,
        tags: true,
        style: {
          border: { fg: modeColor },
        },
      });

      const inputBox = blessed.textbox({
        parent: promptBox,
        top: 1,
        left: 1,
        width: "100%-4",
        height: 1,
        inputOnFocus: true,
        style: {
          bg: "#374151",
          fg: "white",
        },
        value,
      });

      const promptFooter = blessed.box({
        parent: promptBox,
        bottom: 0,
        left: 0,
        width: "100%-2",
        height: 1,
        tags: true,
        style: {
          bg: "#374151",
          fg: "white",
        },
        content: " Enter: confirm · Esc: cancel",
      });

      inputBox.focus();
      screen.render();

      let submitted = false;

      function close(result: string | null) {
        if (submitted) return;
        submitted = true;
        promptBox.destroy();
        screen.realloc();
        screen.render();
        cb(result);
      }

      inputBox.key(["escape"], () => close(null));
      inputBox.key(["enter"], () => {
        const text = inputBox.getValue().trim();
        close(text);
      });
    }

    function withConfirm(text: string, cb: (ok: boolean) => void) {
      const modeColor = getModeColor(mode);
      const confirmBox = blessed.box({
        parent: screen,
        top: "center",
        left: "center",
        width: "60%",
        height: 7,
        border: "line",
        label: ` {${modeColor}-fg}{bold}Confirm{/bold}{/} `,
        tags: true,
        style: {
          border: { fg: modeColor },
        },
        content: text,
      });

      const confirmFooter = blessed.box({
        parent: confirmBox,
        bottom: 0,
        left: 0,
        width: "100%-2",
        height: 1,
        tags: true,
        style: {
          bg: "#374151",
          fg: "white",
        },
        content: " Enter: confirm · Esc: cancel",
      });

      confirmBox.focus();
      screen.render();

      function close(result: boolean) {
        confirmBox.destroy();
        screen.realloc();
        screen.render();
        cb(result);
      }

      confirmBox.key(["enter"], () => close(true));
      confirmBox.key(["escape", "q"], () => close(false));
    }

    function attachSelectedSession() {
      if (!selectedProject) return;
      if (!sessions.length) return;

      // Map list index to session index
      const listIdx = getSelectedIndex(sessionsBox);
      const sessionIdx = listIndexToSessionIndex[listIdx];
      if (sessionIdx === undefined || sessionIdx < 0) return;
      const sess = sessions[sessionIdx];
      if (!sess) return;

      try {
        writeState(args.state);
      } catch (err) {
        showError(err instanceof Error ? err.message : String(err));
        return;
      }

      screen.destroy();
      try {
        args.actions.attachSession(sess.name);
        resolve();
      } catch (err) {
        fail(err);
      }
    }

    function attachSelectedTmuxSession() {
      const idx = getSelectedIndex(tmuxBox);
      selectedTmuxIndex = idx;
      const sess = tmuxSessions[idx];
      if (!sess) return;
      screen.destroy();
      try {
        args.actions.attachSession(sess.name);
        resolve();
      } catch (err) {
        fail(err);
      }
    }

    function deleteSelectedTmuxSession() {
      const idx = getSelectedIndex(tmuxBox);
      selectedTmuxIndex = idx;
      const sess = tmuxSessions[idx];
      if (!sess) return;
      withConfirm(`Kill tmux session?\n${sess.name}`, (ok) => {
        if (!ok) return refresh();
        try {
          args.actions.deleteSession(sess.name);
          writeState(args.state);
          refresh();
        } catch (err) {
          showError(err instanceof Error ? err.message : String(err));
        }
      });
    }

    function copySelectedTmuxSessionName() {
      const idx = getSelectedIndex(tmuxBox);
      selectedTmuxIndex = idx;
      const sess = tmuxSessions[idx];
      if (!sess) return;
      try {
        const res = args.actions.copyText(sess.name);
        flashFooter(`Copied session name via ${res.method}`);
      } catch (err) {
        showError(err instanceof Error ? err.message : String(err));
      }
    }

    function openTextViewer(title: string, content: string) {
      const maxChars = 200_000;
      const truncated = content.length > maxChars;
      const visible = truncated ? content.slice(-maxChars) : content;
      const header = truncated ? "(truncated)\n\n" : "";

      const viewer = blessed.scrollableBox({
        parent: screen,
        top: 0,
        left: 0,
        width: "100%",
        height: "100%-1",
        border: "line",
        label: ` ${title} `,
        keys: true,
        vi: true,
        mouse: true,
        alwaysScroll: true,
        scrollable: true,
        scrollbar: { style: { bg: "blue" } },
        content: header + visible,
      });

      const c = colors.secondary;
      footer.setContent(`View · {${c}-fg}{underline}q{/underline}{/}/{${c}-fg}{underline}Esc{/underline}{/}: close · cop{${c}-fg}{underline}y{/underline}{/}`);
      viewer.focus();
      screen.render();

      function close() {
        modalClose = null;
        viewer.destroy();
        screen.realloc();
        refresh();
      }

      modalClose = close;
      viewer.key(["escape"], () => close());
      viewer.key(["y"], () => {
        try {
          const res = args.actions.copyText(content);
          flashFooter(`Copied capture via ${res.method}`);
        } catch (err) {
          showError(err instanceof Error ? err.message : String(err));
        }
      });
    }

    function showHelp() {
      const modeColor = getModeColor(mode);

      const globalKeys = [
        ["1-4", "Switch to mode (res/tmux/codex/claude)"],
        ["/", "Search in current list"],
        ["r", "Refresh data"],
        ["q", "Quit"],
        ["?", "Show this help"],
      ];

      const projectsKeys = [
        ["Tab", "Switch focus to Sessions panel"],
        ["Enter", "Switch focus to Sessions panel"],
        ["a", "Add new project by path"],
        ["x", "Remove project and kill all its sessions"],
      ];

      const sessionsKeys = [
        ["Tab", "Switch focus to Projects panel"],
        ["Enter", "Attach to selected session"],
        ["o", "Expand/collapse session details"],
        ["c", "Create new tmux session for selected project"],
        ["d", "Delete selected session (kills tmux session)"],
        ["l", "Link unlinked tmux session to selected project"],
        ["u", "Unlink session from project (keeps tmux running)"],
      ];

      const tmuxKeys = [
        ["Enter", "Attach to selected tmux session"],
        ["d", "Delete (kill) selected tmux session"],
        ["c", "Capture pane content from selected session"],
        ["y", "Copy session name to clipboard"],
        ["l", "Associate session with a project"],
        ["u", "Unassociate session from its project"],
      ];

      const codexKeys = [
        ["Enter", "View session details"],
        ["c", "Create tmux session to resume this Codex session"],
        ["y", "Copy session ID to clipboard"],
      ];

      const claudeKeys = [
        ["Enter", "View session details"],
        ["c", "Create tmux session to resume this Claude session"],
        ["y", "Copy session ID to clipboard"],
      ];

      const formatSection = (title: string, keys: string[][], color: string) => {
        const lines = keys.map(([key, desc]) => `  {bold}${key.padEnd(8)}{/bold} ${desc}`);
        return `{${color}-fg}{bold}${title}{/bold}{/}\n${lines.join("\n")}`;
      };

      let content = formatSection("Global", globalKeys, colors.secondary) + "\n\n";

      if (mode === "res") {
        content += formatSection("Projects Panel", projectsKeys, modeColor);
        content += "\n\n";
        content += formatSection("Sessions Panel", sessionsKeys, modeColor);
        content += "\n\n{gray-fg}Tip: 'Add' registers a project. 'Create' makes a tmux session. 'Link' associates an existing one.{/gray-fg}";
      } else if (mode === "tmux") {
        content += formatSection("Tmux Mode (All Sessions)", tmuxKeys, modeColor);
        content += "\n\n{gray-fg}Tip: 'Associate' links an untracked tmux session to a project.{/gray-fg}";
      } else if (mode === "codex") {
        content += formatSection("Codex Mode (Codex CLI Sessions)", codexKeys, modeColor);
        content += "\n\n{gray-fg}Tip: View shows conversation history. Create opens in tmux.{/gray-fg}";
      } else if (mode === "claude") {
        content += formatSection("Claude Mode (Claude Code Sessions)", claudeKeys, modeColor);
        content += "\n\n{gray-fg}Tip: View shows conversation history. Create opens in tmux.{/gray-fg}";
      }

      const helpBox = blessed.box({
        parent: screen,
        top: "center",
        left: "center",
        width: "70%",
        height: "70%",
        border: "line",
        label: ` {${modeColor}-fg}{bold}Help{/bold}{/} `,
        tags: true,
        keys: true,
        vi: true,
        mouse: true,
        scrollable: true,
        alwaysScroll: true,
        scrollbar: { style: { bg: modeColor } },
        style: { border: { fg: modeColor } },
        content,
      });

      const c = colors.secondary;
      footer.setContent(`Help · {${c}-fg}{underline}q{/underline}{/}/{${c}-fg}{underline}Esc{/underline}{/}: close`);
      helpBox.focus();
      screen.render();

      function close() {
        modalClose = null;
        helpBox.destroy();
        screen.realloc();
        refresh();
      }

      modalClose = close;
      helpBox.key(["escape", "q", "?"], () => close());
    }

    function captureSelectedTmuxSession() {
      const idx = getSelectedIndex(tmuxBox);
      selectedTmuxIndex = idx;
      const sess = tmuxSessions[idx];
      if (!sess) return;
      try {
        const captured = args.actions.captureSessionPane(sess.name);
        openTextViewer(`capture: ${sess.name}`, captured);
      } catch (err) {
        showError(err instanceof Error ? err.message : String(err));
      }
    }

    function viewSelectedCodexSession() {
      const idx = getSelectedIndex(tmuxBox);
      selectedCodexIndex = idx;
      const sess = codexSessions[idx];
      if (!sess) return;
      try {
        const content = args.actions.codexSessionDetails(sess);
        openTextViewer(`codex: ${sess.id}`, content);
      } catch (err) {
        showError(err instanceof Error ? err.message : String(err));
      }
    }

    function viewSelectedClaudeSession() {
      const idx = getSelectedIndex(tmuxBox);
      selectedClaudeIndex = idx;
      const sess = claudeSessions[idx];
      if (!sess) return;
      try {
        const content = args.actions.claudeSessionDetails(sess);
        openTextViewer(`claude: ${sess.id}`, content);
      } catch (err) {
        showError(err instanceof Error ? err.message : String(err));
      }
    }

    function copySelectedCodexSessionId() {
      const idx = getSelectedIndex(tmuxBox);
      selectedCodexIndex = idx;
      const sess = codexSessions[idx];
      if (!sess) return;
      try {
        const res = args.actions.copyText(sess.id);
        flashFooter(`Copied Codex session id via ${res.method}`);
      } catch (err) {
        showError(err instanceof Error ? err.message : String(err));
      }
    }

    function copySelectedClaudeSessionId() {
      const idx = getSelectedIndex(tmuxBox);
      selectedClaudeIndex = idx;
      const sess = claudeSessions[idx];
      if (!sess) return;
      try {
        const res = args.actions.copyText(sess.id);
        flashFooter(`Copied Claude session id via ${res.method}`);
      } catch (err) {
        showError(err instanceof Error ? err.message : String(err));
      }
    }

    function createTmuxFromCodexSession() {
      const idx = getSelectedIndex(tmuxBox);
      selectedCodexIndex = idx;
      const codexSession = codexSessions[idx];
      if (!codexSession) return;

      projects = listProjects(args.state);
      openProjectPicker(
        `tmux for codex ${codexSession.id.slice(0, 12)}`,
        codexSession.cwd ?? process.cwd(),
        (project) => {
          if (!project) return refresh();

          const command = args.actions.codexResumeCommand(codexSession.id);
          let sess: SessionRecord;
          try {
            sess = args.actions.createSession(project, command);
            sess.lastAttachedAt = nowIso();
            writeState(args.state);
          } catch (err) {
            showError(err instanceof Error ? err.message : String(err));
            return;
          }

          screen.destroy();
          try {
            args.actions.attachSession(sess.name);
            resolve();
          } catch (err) {
            fail(err);
          }
        },
      );
    }

    function createTmuxFromClaudeSession() {
      const idx = getSelectedIndex(tmuxBox);
      selectedClaudeIndex = idx;
      const claudeSession = claudeSessions[idx];
      if (!claudeSession) return;

      projects = listProjects(args.state);
      openProjectPicker(
        `tmux for claude ${claudeSession.id.slice(0, 12)}`,
        claudeSession.projectPath ?? claudeSession.cwd ?? process.cwd(),
        (project) => {
          if (!project) return refresh();

          const command = args.actions.claudeResumeCommand(claudeSession.id);
          let sess: SessionRecord;
          try {
            sess = args.actions.createSession(project, command);
            sess.lastAttachedAt = nowIso();
            writeState(args.state);
          } catch (err) {
            showError(err instanceof Error ? err.message : String(err));
            return;
          }

          screen.destroy();
          try {
            args.actions.attachSession(sess.name);
            resolve();
          } catch (err) {
            fail(err);
          }
        },
      );
    }

    function openProjectPicker(title: string, createPathDefault: string, onPick: (project: Project | null) => void) {
      const entries: Array<{ kind: "create" } | { kind: "project"; project: Project }> = [
        { kind: "create" },
        ...projects.map((project) => ({ kind: "project" as const, project })),
      ];

      const items = [
        "{green-fg}+{/green-fg} Create project by path…",
        ...projects.map((p) => `${p.name} {gray-fg}${p.path}{/gray-fg}`),
      ];

      const modeColor = getModeColor(mode);
      const picker = blessed.list({
        parent: screen,
        top: "center",
        left: "center",
        width: "80%",
        height: Math.min(18, Math.max(7, items.length + 4)),
        keys: true,
        vi: true,
        mouse: true,
        border: "line",
        label: ` {${modeColor}-fg}{bold}${title}{/bold}{/} `,
        style: {
          border: { fg: modeColor },
          selected: { bg: modeColor, fg: "black", bold: true },
        },
        scrollbar: { style: { bg: modeColor } },
        tags: true,
        items,
      });

      const previousFooter = footer.getContent();
      const c = colors.secondary;
      footer.setContent(`Picker · {${c}-fg}{underline}Enter{/underline}{/}: select · {${c}-fg}{underline}Esc{/underline}{/}/{${c}-fg}{underline}q{/underline}{/}: cancel`);
      picker.focus();
      screen.render();

      function cleanup() {
        modalClose = null;
        footer.setContent(previousFooter);
        picker.destroy();
        updateFooter();
        updateFocusedStyles();
        (mode === "res" ? (focused === "projects" ? projectsBox : sessionsBox) : tmuxBox).focus();
        screen.realloc();
        screen.render();
      }

      function cancel() {
        cleanup();
        onPick(null);
      }

      modalClose = cancel;
      picker.key(["escape", "q"], () => cancel());
      picker.on("select", (_: unknown, idx: number) => {
        const entry = entries[idx];
        if (!entry) return cancel();

        cleanup();

        if (entry.kind === "create") {
          withPrompt("New project path", createPathDefault, (p) => {
            if (!p) return onPick(null);
            try {
              const project = normalizeAndEnsureProject(args.state, p, process.cwd());
              writeState(args.state);
              onPick(project);
            } catch (err) {
              showError(err instanceof Error ? err.message : String(err));
              onPick(null);
            }
          });
          return;
        }

        onPick(entry.project);
      });
    }

    function associateSelectedTmuxSession() {
      const idx = getSelectedIndex(tmuxBox);
      selectedTmuxIndex = idx;
      const sess = tmuxSessions[idx];
      if (!sess) return;

      const existing = args.state.sessions[sess.name];
      if (existing) {
        const existingProject = args.state.projects[existing.projectId]?.name ?? existing.projectId;
        flashFooter(`Already associated with ${existingProject} (use u to unassociate)`);
        return;
      }

      projects = listProjects(args.state);
      openProjectPicker(`Associate ${sess.name}`, process.cwd(), (project) => {
        if (!project) return refresh();
        try {
          args.actions.linkSession(project, sess.name, false);
          writeState(args.state);
          flashFooter(`Associated ${sess.name} → ${project.name}`);
          refresh();
        } catch (err) {
          showError(err instanceof Error ? err.message : String(err));
        }
      });
    }

    function unassociateSelectedTmuxSession() {
      const idx = getSelectedIndex(tmuxBox);
      selectedTmuxIndex = idx;
      const sess = tmuxSessions[idx];
      if (!sess) return;

      const existing = args.state.sessions[sess.name];
      if (!existing) {
        flashFooter("Session is not associated with a project.");
        return;
      }

      const existingProject = args.state.projects[existing.projectId]?.name ?? existing.projectId;
      withConfirm(`Unassociate tmux session?\n${sess.name}\n(from ${existingProject})`, (ok) => {
        if (!ok) return refresh();
        try {
          args.actions.unassociateSession(sess.name);
          writeState(args.state);
          flashFooter(`Unassociated ${sess.name}`);
          refresh();
        } catch (err) {
          showError(err instanceof Error ? err.message : String(err));
        }
      });
    }

    function getConfiguredCommands(): string[] {
      const envCommands = process.env.RESUMER_COMMANDS?.trim();
      if (!envCommands) return [];
      // Support both comma-separated and JSON array format
      if (envCommands.startsWith("[")) {
        try {
          const parsed = JSON.parse(envCommands);
          if (Array.isArray(parsed)) return parsed.filter((c) => typeof c === "string" && c.trim());
        } catch {
          // Fall through to comma-separated
        }
      }
      return envCommands.split(",").map((c) => c.trim()).filter(Boolean);
    }

    function createSessionForSelectedProject() {
      if (!selectedProject) return;
      const project = selectedProject;

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

      const modeColor = getModeColor(mode);
      const items = [
        "{gray-fg}(default shell){/gray-fg}",
        ...allCommands.map((c) => `{bold}${c}{/bold}`),
        "{gray-fg}(custom command...){/gray-fg}",
      ];

      const modalHeight = Math.min(16, Math.max(8, items.length + 5));
      const modalContainer = blessed.box({
        parent: screen,
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
      footer.setContent(`{${c}-fg}{underline}Enter{/underline}{/}: select · {${c}-fg}{underline}Esc{/underline}{/}/{${c}-fg}{underline}q{/underline}{/}: cancel`);
      picker.focus();
      screen.render();

      function cleanup() {
        modalContainer.destroy();
        updateFooter();
        updateFocusedStyles();
        (focused === "projects" ? projectsBox : sessionsBox).focus();
        screen.realloc();
        screen.render();
      }

      function createSession(command: string | undefined) {
        let sess: SessionRecord;
        try {
          sess = args.actions.createSession(project, command);
          sess.lastAttachedAt = nowIso();
          writeState(args.state);
        } catch (err) {
          showError(err instanceof Error ? err.message : String(err));
          return;
        }

        screen.destroy();
        try {
          args.actions.attachSession(sess.name);
          resolve();
        } catch (err) {
          fail(err);
        }
      }

      picker.key(["escape", "q"], () => {
        cleanup();
        refresh();
      });

      picker.on("select", (_: unknown, idx: number) => {
        const entry = entries[idx];
        if (!entry) {
          cleanup();
          return refresh();
        }

        cleanup();

        if (entry.kind === "shell") {
          createSession(undefined);
        } else if (entry.kind === "command") {
          createSession(entry.command);
        } else if (entry.kind === "custom") {
          withPrompt("Custom command", "", (cmd) => {
            if (cmd === null || !cmd) return refresh();
            createSession(cmd);
          });
        }
      });
    }

    function deleteSelectedSession() {
      if (!selectedProject) return;
      if (!sessions.length) return;

      // Map list index to session index
      const listIdx = getSelectedIndex(sessionsBox);
      const sessionIdx = listIndexToSessionIndex[listIdx];
      if (sessionIdx === undefined || sessionIdx < 0) return;
      const sess = sessions[sessionIdx];
      if (!sess) return;

      withConfirm(`Kill tmux session?\n${sess.name}`, (ok) => {
        if (!ok) return refresh();
        try {
          args.actions.deleteSession(sess.name);
          writeState(args.state);
          expandedSessionIndex = null; // Reset expanded state
          refresh();
        } catch (err) {
          showError(err instanceof Error ? err.message : String(err));
        }
      });
    }

    function unlinkSelectedSession() {
      if (!selectedProject) return;
      if (!sessions.length) return;

      // Map list index to session index
      const listIdx = getSelectedIndex(sessionsBox);
      const sessionIdx = listIndexToSessionIndex[listIdx];
      if (sessionIdx === undefined || sessionIdx < 0) return;
      const sess = sessions[sessionIdx];
      if (!sess) return;

      withConfirm(`Unlink "${sess.name}" from ${selectedProject.name}? (tmux keeps running)`, (ok) => {
        if (!ok) return refresh();
        try {
          args.actions.unassociateSession(sess.name);
          writeState(args.state);
          expandedSessionIndex = null; // Reset expanded state
          flashFooter(`Unlinked ${sess.name}`);
          refresh();
        } catch (err) {
          showError(err instanceof Error ? err.message : String(err));
        }
      });
    }

    function linkExistingSessionToSelectedProject() {
      if (!selectedProject) return;
      const project = selectedProject;

      // Get all tmux sessions not already linked to a project
      const allTmuxSessions = args.actions.listTmuxSessions();
      const unlinkedSessions = allTmuxSessions.filter((s) => !args.state.sessions[s.name]);

      if (unlinkedSessions.length === 0) {
        flashFooter("No unlinked tmux sessions available");
        return;
      }

      const tmuxColor = modeColors.tmux; // green
      const items = unlinkedSessions.map((s) => {
        const cmd = s.currentCommand?.trim() || "(shell)";
        const path = s.currentPath ? ` {${colors.secondary}-fg}${s.currentPath}{/}` : "";
        const windows = s.windows > 1 ? ` {gray-fg}${s.windows} windows{/gray-fg}` : "";
        const attached = s.attached ? ` {${modeColors.codex}-fg}attached{/}` : "";
        return `{bold}${s.name}{/bold} {gray-fg}${cmd}{/gray-fg}${path}${windows}${attached}`;
      });

      const modalHeight = Math.min(20, Math.max(9, items.length + 6));
      const modalContainer = blessed.box({
        parent: screen,
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

      const previousFooter = footer.getContent();
      const c = colors.secondary;
      footer.setContent(`{${c}-fg}{underline}Enter{/underline}{/}: select · {${c}-fg}{underline}Esc{/underline}{/}/{${c}-fg}{underline}q{/underline}{/}: cancel`);
      picker.focus();
      screen.render();

      function cleanup() {
        modalClose = null;
        footer.setContent(previousFooter);
        modalContainer.destroy();
        updateFooter();
        updateFocusedStyles();
        (focused === "projects" ? projectsBox : sessionsBox).focus();
        screen.realloc();
        screen.render();
      }

      function cancel() {
        cleanup();
        refresh();
      }

      modalClose = cancel;
      picker.key(["escape", "q"], () => cancel());
      picker.on("select", (_: unknown, idx: number) => {
        const sess = unlinkedSessions[idx];
        if (!sess) return cancel();

        cleanup();

        try {
          args.actions.linkSession(project, sess.name, false);
          writeState(args.state);
          flashFooter(`Linked ${sess.name} → ${project.name}`);
          refresh();
        } catch (err) {
          showError(err instanceof Error ? err.message : String(err));
        }
      });
    }

    function deleteSelectedProject() {
      if (!selectedProject) return;
      const project = selectedProject;
      withConfirm(`Remove project and kill all its sessions?\n${project.name}\n${project.path}`, (ok) => {
        if (!ok) return refresh();
        try {
          const projectSessions = listSessionsForProject(args.state, project.id);
          for (const s of projectSessions) args.actions.deleteSession(s.name);
          delete args.state.projects[project.id];
          writeState(args.state);
          selectedProjectIndex = Math.max(0, selectedProjectIndex - 1);
          refresh();
        } catch (err) {
          showError(err instanceof Error ? err.message : String(err));
        }
      });
    }

    function addProject() {
      withPrompt("Add project path", process.cwd(), (p) => {
        if (!p) return refresh();
        try {
          normalizeAndEnsureProject(args.state, p, process.cwd());
          writeState(args.state);
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          withConfirm(`Failed to add project:\n${msg}\n\nOK?`, () => refresh());
          return;
        }
        refresh();
      });
    }

    // Get current list items as plain text for searching
    function getSearchableItems(): string[] {
      if (mode === "res") {
        if (focused === "projects") {
          return projects.map((p) => `${p.name} ${p.path}`);
        }
        return sessions.map((s) => `${s.name} ${s.command ?? ""}`);
      }
      if (mode === "tmux") {
        return tmuxSessions.map((s) => {
          const project = args.state.sessions[s.name]
            ? args.state.projects[args.state.sessions[s.name].projectId]?.name ?? ""
            : "";
          return `${s.name} ${s.currentCommand ?? ""} ${project}`;
        });
      }
      if (mode === "codex") {
        return codexSessions.map((s) => `${s.id} ${s.cwd ?? ""} ${s.lastPrompt ?? ""}`);
      }
      if (mode === "claude") {
        return claudeSessions.map((s) => `${s.id} ${s.projectPath ?? ""} ${s.lastPrompt ?? ""}`);
      }
      return [];
    }

    // Get current active list box
    function getActiveList(): Widgets.ListElement {
      if (mode === "res") {
        return focused === "projects" ? projectsBox : sessionsBox;
      }
      return tmuxBox;
    }

    // Find first matching item index
    function findFirstMatch(query: string, items: string[]): number {
      if (!query) return -1;
      const lowerQuery = query.toLowerCase();
      for (let i = 0; i < items.length; i++) {
        if (items[i].toLowerCase().includes(lowerQuery)) {
          return i;
        }
      }
      return -1;
    }

    function startSearch() {
      if (modalClose) return;
      searchActive = true;
      searchQuery = "";

      const modeColor = getModeColor(mode);
      const searchBox = blessed.box({
        parent: screen,
        bottom: 1,
        left: 0,
        width: "100%",
        height: 1,
        tags: true,
        style: {
          bg: "#374151",
          fg: "white",
        },
        content: ` {${modeColor}-fg}/{/} `,
      });

      const searchInput = blessed.textbox({
        parent: screen,
        bottom: 1,
        left: 3,
        width: "100%-4",
        height: 1,
        inputOnFocus: true,
        style: {
          bg: "#374151",
          fg: "white",
        },
      });

      footer.setContent("Search · " + styledKey("Enter", "select") + " · " + styledKey("Esc", "cancel"));
      searchInput.focus();
      screen.render();

      const items = getSearchableItems();
      const activeList = getActiveList();

      // Handle input changes
      (searchInput as any).on("keypress", (_ch: string, _key: any) => {
        // Defer to next tick to get updated value
        setTimeout(() => {
          const query = searchInput.getValue();
          searchQuery = query;

          const matchIdx = findFirstMatch(query, items);
          if (matchIdx >= 0) {
            activeList.select(matchIdx);
            // Update the selected index tracking
            if (mode === "res" && focused === "projects") {
              selectedProjectIndex = matchIdx;
              selectedProject = projects[matchIdx] ?? null;
              refreshSessionsForSelectedProject();
            } else if (mode === "tmux") {
              selectedTmuxIndex = matchIdx;
            } else if (mode === "codex") {
              selectedCodexIndex = matchIdx;
            } else if (mode === "claude") {
              selectedClaudeIndex = matchIdx;
            }
          }
          screen.render();
        }, 0);
      });

      function closeSearch() {
        searchActive = false;
        searchQuery = "";
        searchBox.destroy();
        searchInput.destroy();
        updateFooter();
        activeList.focus();
        screen.realloc();
        screen.render();
      }

      searchInput.key(["escape"], () => closeSearch());
      searchInput.key(["enter"], () => closeSearch());
    }

    screen.key(["C-c"], () => done());
    screen.key(["q"], () => {
      if (modalClose) return modalClose();
      done();
    });
    screen.key(["tab"], () => {
      if (modalClose) return;
      if (mode !== "res") return;
      focused = focused === "projects" ? "sessions" : "projects";
      (focused === "projects" ? projectsBox : sessionsBox).focus();
      updateFocusedStyles();
      updateFooter();
      screen.render();
    });

    screen.key(["t"], () => {
      if (modalClose) return;
      setMode("tmux");
    });
    screen.key(["p"], () => {
      if (modalClose) return;
      setMode("res");
    });
    screen.key(["1"], () => {
      if (modalClose) return;
      setMode("res");
    });
    screen.key(["2"], () => {
      if (modalClose) return;
      setMode("tmux");
    });
    screen.key(["3"], () => {
      if (modalClose) return;
      setMode("codex");
    });
    screen.key(["4"], () => {
      if (modalClose) return;
      setMode("claude");
    });
    screen.key(["m"], () => {
      if (modalClose) return;
      setMode(mode === "tmux" ? "res" : "tmux");
    });
    screen.key(["r"], () => {
      if (modalClose) return;
      refresh();
    });
    screen.key(["?"], () => {
      if (modalClose) return;
      showHelp();
    });
    screen.key(["/"], () => {
      if (modalClose) return;
      if (searchActive) return;
      startSearch();
    });
    screen.key(["o"], () => {
      if (modalClose) return;
      if (mode !== "res" || focused !== "sessions") return;
      if (!sessions.length) return;

      // Get the session index from the current list selection
      const listIdx = getSelectedIndex(sessionsBox);
      const sessionIdx = listIndexToSessionIndex[listIdx];
      if (sessionIdx === undefined || sessionIdx < 0) return;

      // Toggle expanded state
      if (expandedSessionIndex === sessionIdx) {
        expandedSessionIndex = null;
      } else {
        expandedSessionIndex = sessionIdx;
      }

      // Regenerate display and try to keep selection on the same session
      const items = generateSessionItems();

      // Find the first list index for this session
      let newListIdx = 0;
      for (let i = 0; i < listIndexToSessionIndex.length; i++) {
        if (listIndexToSessionIndex[i] === sessionIdx) {
          newListIdx = i;
          break;
        }
      }

      // Add indicator to selected item
      const isExpanded = expandedSessionIndex === sessionIdx;
      const indicator = isExpanded
        ? `  {${colors.secondary}-fg}cl{underline}o{/underline}se{/}`
        : `  {${colors.secondary}-fg}{underline}o{/underline}pen{/}`;
      items[newListIdx] = items[newListIdx] + indicator;

      sessionsBox.setItems(items);
      sessionsBox.select(newListIdx);
      screen.render();
    });
    screen.key(["a"], () => {
      if (modalClose) return;
      if (mode !== "res") return;
      addProject();
    });
    screen.key(["c"], () => {
      if (modalClose) return;
      if (mode === "tmux") return captureSelectedTmuxSession();
      if (mode === "codex") return createTmuxFromCodexSession();
      if (mode === "claude") return createTmuxFromClaudeSession();
      if (mode !== "res") return;
      createSessionForSelectedProject();
    });
    screen.key(["d"], () => {
      if (modalClose) return;
      if (mode === "tmux") return deleteSelectedTmuxSession();
      if (mode !== "res") return;
      deleteSelectedSession();
    });
    screen.key(["l"], () => {
      if (modalClose) return;
      if (mode === "tmux") return associateSelectedTmuxSession();
      if (mode !== "res") return;
      linkExistingSessionToSelectedProject();
    });
    screen.key(["u"], () => {
      if (modalClose) return;
      if (mode === "tmux") return unassociateSelectedTmuxSession();
      if (mode === "res") return unlinkSelectedSession();
    });
    screen.key(["x"], () => {
      if (modalClose) return;
      if (mode !== "res") return;
      deleteSelectedProject();
    });
    screen.key(["y"], () => {
      if (modalClose) return;
      if (mode === "tmux") return copySelectedTmuxSessionName();
      if (mode === "codex") return copySelectedCodexSessionId();
      if (mode === "claude") return copySelectedClaudeSessionId();
    });

    projectsBox.on("select item", (_: unknown, idx: number) => {
      selectedProjectIndex = idx;
      selectedProject = projects[idx] ?? null;
      refreshSessionsForSelectedProject();
      screen.render();
    });

    sessionsBox.on("select item", () => {
      // Update display to move the open/close indicator to the selected item
      if (mode === "res" && sessions.length > 0) {
        updateSessionDisplay();
        screen.render();
      }
    });

    tmuxBox.on("select item", (_: unknown, idx: number) => {
      // Update display for codex/claude modes to show colored indicator on selected row
      if (mode === "codex") {
        selectedCodexIndex = idx;
        updateCodexItems();
        screen.render();
      } else if (mode === "claude") {
        selectedClaudeIndex = idx;
        updateClaudeItems();
        screen.render();
      } else if (mode === "tmux") {
        selectedTmuxIndex = idx;
      }
    });

    sessionsBox.key(["enter"], () => attachSelectedSession());
    tmuxBox.key(["enter"], () => {
      if (mode === "tmux") return attachSelectedTmuxSession();
      if (mode === "codex") return viewSelectedCodexSession();
      if (mode === "claude") return viewSelectedClaudeSession();
    });
    projectsBox.key(["enter"], () => {
      if (mode !== "res") return;
      focused = "sessions";
      sessionsBox.focus();
      updateFocusedStyles();
      updateFooter();
      screen.render();
    });

    updateFooter();
    updateFocusedStyles();
    projectsBox.focus();
    footer.setFront();
    header.setFront();
    headerUrl.setFront();
    refresh();
  });
}
