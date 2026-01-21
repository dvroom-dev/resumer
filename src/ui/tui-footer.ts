import { colors, getModeColor } from "./tui-constants.ts";
import type { TuiContext, TuiRuntime } from "./tui-types.ts";

export function styledKey(key: string, action: string): string {
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

export function updateFooter(ctx: TuiContext, runtime: TuiRuntime): void {
  runtime.updateHeader();
  const sep = " · ";

  if (ctx.mode === "tmux") {
    ctx.footer.setContent(
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
  if (ctx.mode === "codex") {
    ctx.footer.setContent(
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
  if (ctx.mode === "claude") {
    ctx.footer.setContent(
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
  if (ctx.focused === "projects") {
    ctx.footer.setContent(
      "Projects" +
        sep +
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
    ctx.footer.setContent(
      "Sessions" +
        sep +
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

export function updateFocusedStyles(ctx: TuiContext): void {
  const modeColor = getModeColor(ctx.mode);

  if (ctx.mode !== "res") {
    // For non-res modes, update tmuxBox styling
    (ctx.tmuxBox as any).style.border.fg = modeColor;
    (ctx.tmuxBox as any).style.selected.bg = modeColor;
    (ctx.tmuxBox as any).style.selected.fg = "black";
    (ctx.tmuxBox as any).style.scrollbar.bg = modeColor;
    return;
  }

  // Update border colors based on focus
  const projectsBorderColor = ctx.focused === "projects" ? modeColor : colors.borderDim;
  const sessionsBorderColor = ctx.focused === "sessions" ? modeColor : colors.borderDim;

  (ctx.projectsBox as any).style.border.fg = projectsBorderColor;
  (ctx.sessionsBox as any).style.border.fg = sessionsBorderColor;

  // Update selected item styles based on focus
  const focusedSelected = { bg: modeColor, fg: "black", bold: true };
  const projectsSelected = ctx.focused === "projects" ? focusedSelected : colors.selectedDim;

  (ctx.projectsBox as any).style.selected.bg = projectsSelected.bg;
  (ctx.projectsBox as any).style.selected.fg = projectsSelected.fg;

  // When Projects is focused, don't show any selection styling in Sessions
  if (ctx.focused === "sessions") {
    (ctx.sessionsBox as any).style.selected.bg = modeColor;
    (ctx.sessionsBox as any).style.selected.fg = "black";
    (ctx.sessionsBox as any).style.selected.bold = true;
  } else {
    // Remove selection highlighting when not focused
    delete (ctx.sessionsBox as any).style.selected.bg;
    delete (ctx.sessionsBox as any).style.selected.fg;
    delete (ctx.sessionsBox as any).style.selected.bold;
  }

  // Update scrollbar colors
  (ctx.projectsBox as any).style.scrollbar.bg = ctx.focused === "projects" ? modeColor : colors.borderDim;
  (ctx.sessionsBox as any).style.scrollbar.bg = ctx.focused === "sessions" ? modeColor : colors.borderDim;

  // Update labels with focus indicator
  const projectsLabel =
    ctx.focused === "projects"
      ? ` {${modeColor}-fg}{bold}> Projects{/bold}{/} `
      : " {gray-fg}Projects{/gray-fg} ";
  const sessionsLabel =
    ctx.focused === "sessions"
      ? ` {${modeColor}-fg}{bold}> Sessions{/bold}{/} `
      : " {gray-fg}Sessions{/gray-fg} ";

  ctx.projectsBox.setLabel(projectsLabel);
  ctx.sessionsBox.setLabel(sessionsLabel);
}

export function flashFooter(ctx: TuiContext, runtime: TuiRuntime, message: string, ms = 1500): void {
  if (ctx.footerTimer) clearTimeout(ctx.footerTimer);
  ctx.footer.setContent(message);
  ctx.screen.render();
  ctx.footerTimer = setTimeout(() => {
    runtime.updateFooter();
    ctx.screen.render();
  }, ms);
}
