import { colors, modeColors } from "./tui-constants.ts";
import type { TuiContext, TuiRuntime, TuiMode } from "./tui-types.ts";

export function updateHeader(ctx: TuiContext): void {
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
  ctx.tabPositions = [];

  for (let i = 0; i < ctx.tabs.length; i++) {
    const tab = ctx.tabs[i];
    const tabColor = modeColors[tab];
    const num = i + 1;
    const isActive = ctx.mode === tab;
    const isHovered = ctx.hoveredTab === tab && !isActive;
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
    ctx.tabPositions.push({ start, end: pos, mode: tab });
  }

  ctx.header.setContent(content);
}

export function bindHeaderEvents(ctx: TuiContext, runtime: TuiRuntime): void {
  ctx.header.on("click", (_mouse: any) => {
    const x = _mouse.x;
    for (const tab of ctx.tabPositions) {
      if (x >= tab.start && x < tab.end) {
        runtime.setMode(tab.mode as TuiMode);
        return;
      }
    }
  });

  ctx.header.on("mousemove", (_mouse: any) => {
    const x = _mouse.x;
    let newHovered: TuiMode | null = null;
    for (const tab of ctx.tabPositions) {
      if (x >= tab.start && x < tab.end) {
        newHovered = tab.mode;
        break;
      }
    }
    if (newHovered !== ctx.hoveredTab) {
      ctx.hoveredTab = newHovered;
      runtime.updateHeader();
      ctx.screen.render();
    }
  });

  ctx.header.on("mouseout", () => {
    if (ctx.hoveredTab !== null) {
      ctx.hoveredTab = null;
      runtime.updateHeader();
      ctx.screen.render();
    }
  });
}
