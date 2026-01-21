import type { TuiContext, TuiRuntime } from "./tui-types.ts";
import { startSearch } from "./tui-search.ts";
import {
  attachSelectedSession,
  createSessionForSelectedProject,
  deleteSelectedSession,
  linkExistingSessionToSelectedProject,
  toggleExpandedSession,
  unlinkSelectedSession,
} from "./tui-actions-res.ts";
import {
  associateSelectedTmuxSession,
  attachSelectedTmuxSession,
  captureSelectedTmuxSession,
  copySelectedClaudeSessionId,
  copySelectedCodexSessionId,
  copySelectedTmuxSessionName,
  createTmuxFromClaudeSession,
  createTmuxFromCodexSession,
  deleteSelectedTmuxSession,
  unassociateSelectedTmuxSession,
  viewSelectedClaudeSession,
  viewSelectedCodexSession,
} from "./tui-actions-tmux.ts";
import { addProject, deleteSelectedProject } from "./tui-projects.ts";

export function bindKeyHandlers(ctx: TuiContext, runtime: TuiRuntime): void {
  ctx.screen.key(["C-c"], () => runtime.done());
  ctx.screen.key(["q"], () => {
    if (ctx.modalClose) return ctx.modalClose();
    runtime.done();
  });
  ctx.screen.key(["tab"], () => {
    if (ctx.modalClose) return;
    if (ctx.mode !== "res") return;
    ctx.focused = ctx.focused === "projects" ? "sessions" : "projects";
    (ctx.focused === "projects" ? ctx.projectsBox : ctx.sessionsBox).focus();
    runtime.updateFocusedStyles();
    runtime.updateFooter();
    if (ctx.sessions.length > 0) runtime.updateSessionDisplay();
    ctx.screen.render();
  });

  ctx.screen.key(["t"], () => {
    if (ctx.modalClose) return;
    runtime.setMode("tmux");
  });
  ctx.screen.key(["1"], () => {
    if (ctx.modalClose) return;
    runtime.setMode("res");
  });
  ctx.screen.key(["2"], () => {
    if (ctx.modalClose) return;
    runtime.setMode("tmux");
  });
  ctx.screen.key(["3"], () => {
    if (ctx.modalClose) return;
    runtime.setMode("codex");
  });
  ctx.screen.key(["4"], () => {
    if (ctx.modalClose) return;
    runtime.setMode("claude");
  });
  ctx.screen.key(["m"], () => {
    if (ctx.modalClose) return;
    runtime.setMode(ctx.mode === "tmux" ? "res" : "tmux");
  });
  ctx.screen.key(["r"], () => {
    if (ctx.modalClose) return;
    runtime.refresh();
  });
  ctx.screen.key(["?"], () => {
    if (ctx.modalClose) return;
    runtime.showHelp();
  });
  ctx.screen.key(["/"], () => {
    if (ctx.modalClose) return;
    if (ctx.searchActive) return;
    startSearch(ctx, runtime);
  });
  ctx.screen.key(["p"], () => {
    if (ctx.modalClose) return;
    if (ctx.mode !== "res" || ctx.focused !== "sessions") return;
    toggleExpandedSession(ctx);
  });

  ctx.screen.key(["a"], () => {
    if (ctx.modalClose) return;
    if (ctx.mode !== "res") return;
    addProject(ctx, runtime);
  });
  ctx.screen.key(["c"], () => {
    if (ctx.modalClose) return;
    if (ctx.mode === "tmux") return captureSelectedTmuxSession(ctx, runtime);
    if (ctx.mode === "codex") return createTmuxFromCodexSession(ctx, runtime);
    if (ctx.mode === "claude") return createTmuxFromClaudeSession(ctx, runtime);
    if (ctx.mode !== "res") return;
    createSessionForSelectedProject(ctx, runtime);
  });
  ctx.screen.key(["d"], () => {
    if (ctx.modalClose) return;
    if (ctx.mode === "tmux") return deleteSelectedTmuxSession(ctx, runtime);
    if (ctx.mode !== "res") return;
    deleteSelectedSession(ctx, runtime);
  });
  ctx.screen.key(["l"], () => {
    if (ctx.modalClose) return;
    if (ctx.mode === "tmux") return associateSelectedTmuxSession(ctx, runtime);
    if (ctx.mode !== "res") return;
    linkExistingSessionToSelectedProject(ctx, runtime);
  });
  ctx.screen.key(["u"], () => {
    if (ctx.modalClose) return;
    if (ctx.mode === "tmux") return unassociateSelectedTmuxSession(ctx, runtime);
    if (ctx.mode === "res") return unlinkSelectedSession(ctx, runtime);
  });
  ctx.screen.key(["x"], () => {
    if (ctx.modalClose) return;
    if (ctx.mode !== "res") return;
    deleteSelectedProject(ctx, runtime);
  });
  ctx.screen.key(["y"], () => {
    if (ctx.modalClose) return;
    if (ctx.mode === "tmux") return copySelectedTmuxSessionName(ctx, runtime);
    if (ctx.mode === "codex") return copySelectedCodexSessionId(ctx, runtime);
    if (ctx.mode === "claude") return copySelectedClaudeSessionId(ctx, runtime);
  });

  ctx.projectsBox.on("select item", (_: unknown, idx: number) => {
    ctx.selectedProjectIndex = idx;
    ctx.selectedProject = ctx.projects[idx] ?? null;
    runtime.refreshSessionsForSelectedProject();
    ctx.screen.render();
  });

  ctx.sessionsBox.on("select item", () => {
    if (ctx.mode === "res" && ctx.sessions.length > 0) {
      runtime.updateSessionDisplay();
      ctx.screen.render();
    }
  });

  ctx.tmuxBox.on("select item", (_: unknown, idx: number) => {
    if (ctx.mode === "codex") {
      ctx.selectedCodexIndex = idx;
    } else if (ctx.mode === "claude") {
      ctx.selectedClaudeIndex = idx;
    } else if (ctx.mode === "tmux") {
      ctx.selectedTmuxIndex = idx;
    }
  });

  ctx.sessionsBox.key(["enter"], () => attachSelectedSession(ctx, runtime));
  ctx.tmuxBox.key(["enter"], () => {
    if (ctx.mode === "tmux") return attachSelectedTmuxSession(ctx, runtime);
    if (ctx.mode === "codex") return viewSelectedCodexSession(ctx, runtime);
    if (ctx.mode === "claude") return viewSelectedClaudeSession(ctx, runtime);
  });
  ctx.projectsBox.key(["enter"], () => {
    if (ctx.mode !== "res") return;
    ctx.focused = "sessions";
    ctx.sessionsBox.focus();
    runtime.updateFocusedStyles();
    runtime.updateFooter();
    if (ctx.sessions.length > 0) runtime.updateSessionDisplay();
    ctx.screen.render();
  });
}
