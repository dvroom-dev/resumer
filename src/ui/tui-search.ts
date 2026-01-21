import { getModeColor } from "./tui-constants.ts";
import { styledKey } from "./tui-footer.ts";
import type { TuiContext, TuiRuntime } from "./tui-types.ts";
import { blessed } from "./blessed.ts";

function getSearchableItems(ctx: TuiContext): string[] {
  if (ctx.mode === "res") {
    if (ctx.focused === "projects") {
      return ctx.projects.map((p) => `${p.name} ${p.path}`);
    }
    return ctx.sessions.map((s) => `${s.name} ${s.command ?? ""}`);
  }
  if (ctx.mode === "tmux") {
    return ctx.tmuxSessions.map((s) => {
      const project = ctx.state.sessions[s.name]
        ? ctx.state.projects[ctx.state.sessions[s.name].projectId]?.name ?? ""
        : "";
      return `${s.name} ${s.currentCommand ?? ""} ${project}`;
    });
  }
  if (ctx.mode === "codex") {
    return ctx.codexSessions.map((s) => `${s.id} ${s.cwd ?? ""} ${s.lastPrompt ?? ""}`);
  }
  if (ctx.mode === "claude") {
    return ctx.claudeSessions.map((s) => `${s.id} ${s.projectPath ?? ""} ${s.lastPrompt ?? ""}`);
  }
  return [];
}

function getActiveList(ctx: TuiContext) {
  if (ctx.mode === "res") {
    return ctx.focused === "projects" ? ctx.projectsBox : ctx.sessionsBox;
  }
  return ctx.tmuxBox;
}

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

export function startSearch(ctx: TuiContext, runtime: TuiRuntime): void {
  if (ctx.modalClose) return;
  ctx.searchActive = true;
  ctx.searchQuery = "";

  const modeColor = getModeColor(ctx.mode);
  const searchBox = blessed.box({
    parent: ctx.screen,
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
    parent: ctx.screen,
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

  ctx.footer.setContent("Search · " + styledKey("Enter", "select") + " · " + styledKey("Esc", "cancel"));
  searchInput.focus();
  ctx.screen.render();

  const items = getSearchableItems(ctx);
  const activeList = getActiveList(ctx);

  (searchInput as any).on("keypress", (_ch: string, _key: any) => {
    setTimeout(() => {
      const query = searchInput.getValue();
      ctx.searchQuery = query;

      const matchIdx = findFirstMatch(query, items);
      if (matchIdx >= 0) {
        activeList.select(matchIdx);
        if (ctx.mode === "res" && ctx.focused === "projects") {
          ctx.selectedProjectIndex = matchIdx;
          ctx.selectedProject = ctx.projects[matchIdx] ?? null;
          runtime.refreshSessionsForSelectedProject();
        } else if (ctx.mode === "tmux") {
          ctx.selectedTmuxIndex = matchIdx;
        } else if (ctx.mode === "codex") {
          ctx.selectedCodexIndex = matchIdx;
        } else if (ctx.mode === "claude") {
          ctx.selectedClaudeIndex = matchIdx;
        }
      }
      ctx.screen.render();
    }, 0);
  });

  function closeSearch() {
    ctx.searchActive = false;
    ctx.searchQuery = "";
    searchBox.destroy();
    searchInput.destroy();
    runtime.updateFooter();
    activeList.focus();
    ctx.screen.realloc();
    ctx.screen.render();
  }

  searchInput.key(["escape"], () => closeSearch());
  searchInput.key(["enter"], () => closeSearch());
}
