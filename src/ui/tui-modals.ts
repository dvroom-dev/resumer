import { blessed } from "./blessed.ts";
import { colors, getModeColor } from "./tui-constants.ts";
import type { TuiContext, TuiRuntime } from "./tui-types.ts";

export function showError(ctx: TuiContext, runtime: TuiRuntime, text: string): void {
  const errorBox = blessed.box({
    parent: ctx.screen,
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
  ctx.screen.render();

  function close() {
    errorBox.destroy();
    ctx.screen.realloc();
    ctx.screen.render();
    runtime.refresh();
  }

  void errorFooter;
  errorBox.key(["enter", "escape", "q"], () => close());
}

export function withPrompt(
  ctx: TuiContext,
  runtime: TuiRuntime,
  title: string,
  value: string,
  cb: (input: string | null) => void,
): void {
  const modeColor = getModeColor(ctx.mode);
  const promptBox = blessed.box({
    parent: ctx.screen,
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
  ctx.screen.render();

  let submitted = false;

  function close(result: string | null) {
    if (submitted) return;
    submitted = true;
    promptBox.destroy();
    ctx.screen.realloc();
    ctx.screen.render();
    cb(result);
  }

  void promptFooter;
  inputBox.key(["escape"], () => close(null));
  inputBox.key(["enter"], () => {
    const text = inputBox.getValue().trim();
    close(text);
  });
}

export function withConfirm(
  ctx: TuiContext,
  runtime: TuiRuntime,
  text: string,
  cb: (ok: boolean) => void,
): void {
  const modeColor = getModeColor(ctx.mode);
  const confirmBox = blessed.box({
    parent: ctx.screen,
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
  ctx.screen.render();

  function close(result: boolean) {
    confirmBox.destroy();
    ctx.screen.realloc();
    ctx.screen.render();
    cb(result);
  }

  void confirmFooter;
  confirmBox.key(["enter"], () => close(true));
  confirmBox.key(["escape", "q"], () => close(false));
}

export function openTextViewer(
  ctx: TuiContext,
  runtime: TuiRuntime,
  title: string,
  content: string,
): void {
  const maxChars = 200_000;
  const truncated = content.length > maxChars;
  const visible = truncated ? content.slice(-maxChars) : content;
  const header = truncated ? "(truncated)\n\n" : "";

  const viewer = blessed.scrollableBox({
    parent: ctx.screen,
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
  ctx.footer.setContent(`View · {${c}-fg}{underline}q{/underline}{/}/{${c}-fg}{underline}Esc{/underline}{/}: close · cop{${c}-fg}{underline}y{/underline}{/}`);
  viewer.focus();
  ctx.screen.render();

  function close() {
    ctx.modalClose = null;
    viewer.destroy();
    ctx.screen.realloc();
    runtime.refresh();
  }

  ctx.modalClose = close;
  viewer.key(["escape"], () => close());
  viewer.key(["y"], () => {
    try {
      const res = ctx.actions.copyText(content);
      runtime.flashFooter(`Copied capture via ${res.method}`);
    } catch (err) {
      runtime.showError(err instanceof Error ? err.message : String(err));
    }
  });
}

export function showHelp(ctx: TuiContext, runtime: TuiRuntime): void {
  const modeColor = getModeColor(ctx.mode);

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
    ["p", "Expand/collapse session details"],
    ["c", "Create new tmux session for selected project"],
    ["d", "Delete selected session (kills tmux session)"],
    ["l", "Link unlinked tmux session to selected project"],
    ["u", "Unlink session from project (keeps tmux running)"],
  ];

  const tmuxKeys = [
    ["Enter", "Attach to selected tmux session"],
    ["n", "Create new tmux session (pick project + command)"],
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

  if (ctx.mode === "res") {
    content += formatSection("Projects Panel", projectsKeys, modeColor);
    content += "\n\n";
    content += formatSection("Sessions Panel", sessionsKeys, modeColor);
    content += "\n\n{gray-fg}Tip: 'Add' registers a project. 'Create' makes a tmux session. 'Link' associates an existing one.{/gray-fg}";
  } else if (ctx.mode === "tmux") {
    content += formatSection("Tmux Mode (All Sessions)", tmuxKeys, modeColor);
    content += "\n\n{gray-fg}Tip: 'Associate' links an untracked tmux session to a project.{/gray-fg}";
  } else if (ctx.mode === "codex") {
    content += formatSection("Codex Mode (Codex CLI Sessions)", codexKeys, modeColor);
    content += "\n\n{gray-fg}Tip: View shows conversation history. Create opens in tmux.{/gray-fg}";
  } else if (ctx.mode === "claude") {
    content += formatSection("Claude Mode (Claude Code Sessions)", claudeKeys, modeColor);
    content += "\n\n{gray-fg}Tip: View shows conversation history. Create opens in tmux.{/gray-fg}";
  }

  const helpBox = blessed.box({
    parent: ctx.screen,
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
  ctx.footer.setContent(`Help · {${c}-fg}{underline}q{/underline}{/}/{${c}-fg}{underline}Esc{/underline}{/}: close`);
  helpBox.focus();
  ctx.screen.render();

  function close() {
    ctx.modalClose = null;
    helpBox.destroy();
    ctx.screen.realloc();
    runtime.refresh();
  }

  ctx.modalClose = close;
  helpBox.key(["escape", "q", "?"], () => close());
}
