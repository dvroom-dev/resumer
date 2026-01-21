import { blessed } from "./blessed.ts";
import { getBlessedTerminalOverride } from "./term.ts";
import { colors, modeColors } from "./tui-constants.ts";

export function createTuiLayout() {
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

  const body = blessed.box({
    parent: screen,
    top: 1,
    left: 0,
    width: "100%",
    height: "100%-2",
  });

  const projectsBox = blessed.list({
    parent: body,
    top: 0,
    left: 0,
    width: "100%",
    height: "50%",
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
    parent: body,
    top: "50%",
    left: 0,
    width: "100%",
    height: "50%",
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
    parent: body,
    top: 0,
    left: 0,
    width: "100%",
    height: "100%",
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

  return {
    screen,
    header,
    headerUrl,
    projectsBox,
    sessionsBox,
    tmuxBox,
    footer,
    prompt,
    question,
  };
}
