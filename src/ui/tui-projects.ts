import { blessed } from "./blessed.ts";
import { normalizeAndEnsureProject, writeState } from "../state.ts";
import { colors, getModeColor } from "./tui-constants.ts";
import type { Project } from "../types.ts";
import type { TuiContext, TuiRuntime } from "./tui-types.ts";
import { listSessionsForProject } from "../state.ts";

export function openProjectPicker(
  ctx: TuiContext,
  runtime: TuiRuntime,
  title: string,
  createPathDefault: string,
  onPick: (project: Project | null) => void,
): void {
  const entries: Array<{ kind: "create" } | { kind: "project"; project: Project }> = [
    { kind: "create" },
    ...ctx.projects.map((project) => ({ kind: "project" as const, project })),
  ];

  const items = [
    "{green-fg}+{/green-fg} Create project by path…",
    ...ctx.projects.map((p) => `${p.name} {gray-fg}${p.path}{/gray-fg}`),
  ];

  const modeColor = getModeColor(ctx.mode);
  const picker = blessed.list({
    parent: ctx.screen,
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

  const previousFooter = ctx.footer.getContent();
  const c = colors.secondary;
  ctx.footer.setContent(
    `Picker · {${c}-fg}{underline}Enter{/underline}{/}: select · {${c}-fg}{underline}Esc{/underline}{/}/{${c}-fg}{underline}q{/underline}{/}: cancel`,
  );
  picker.focus();
  ctx.screen.render();

  function cleanup() {
    ctx.modalClose = null;
    ctx.footer.setContent(previousFooter);
    picker.destroy();
    runtime.updateFooter();
    runtime.updateFocusedStyles();
    (ctx.mode === "res" ? (ctx.focused === "projects" ? ctx.projectsBox : ctx.sessionsBox) : ctx.tmuxBox).focus();
    ctx.screen.realloc();
    ctx.screen.render();
  }

  function cancel() {
    cleanup();
    onPick(null);
  }

  ctx.modalClose = cancel;
  picker.key(["escape", "q"], () => cancel());
  picker.on("select", (_: unknown, idx: number) => {
    const entry = entries[idx];
    if (!entry) return cancel();

    cleanup();

    if (entry.kind === "create") {
      runtime.withPrompt("New project path", createPathDefault, (p) => {
        if (!p) return onPick(null);
        try {
          const project = normalizeAndEnsureProject(ctx.state, p, process.cwd());
          writeState(ctx.state);
          onPick(project);
        } catch (err) {
          runtime.showError(err instanceof Error ? err.message : String(err));
          onPick(null);
        }
      });
      return;
    }

    onPick(entry.project);
  });
}

export function deleteSelectedProject(ctx: TuiContext, runtime: TuiRuntime): void {
  if (!ctx.selectedProject) return;
  const project = ctx.selectedProject;
  runtime.withConfirm(`Remove project and kill all its sessions?\n${project.name}\n${project.path}`, (ok) => {
    if (!ok) return runtime.refresh();
    try {
      const projectSessions = listSessionsForProject(ctx.state, project.id);
      for (const s of projectSessions) ctx.actions.deleteSession(s.name);
      delete ctx.state.projects[project.id];
      writeState(ctx.state);
      ctx.selectedProjectIndex = Math.max(0, ctx.selectedProjectIndex - 1);
      runtime.refresh();
    } catch (err) {
      runtime.showError(err instanceof Error ? err.message : String(err));
    }
  });
}

export function addProject(ctx: TuiContext, runtime: TuiRuntime): void {
  runtime.withPrompt("Add project path", process.cwd(), (p) => {
    if (!p) return runtime.refresh();
    try {
      normalizeAndEnsureProject(ctx.state, p, process.cwd());
      writeState(ctx.state);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      runtime.withConfirm(`Failed to add project:\n${msg}\n\nOK?`, () => runtime.refresh());
      return;
    }
    runtime.refresh();
  });
}

export function getConfiguredCommands(): string[] {
  const envCommands = process.env.RESUMER_COMMANDS?.trim();
  if (!envCommands) return [];
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
