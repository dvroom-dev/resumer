import type { Widgets } from "blessed";
import type { Project, SessionRecord, StateV1 } from "../types.ts";
import type { TmuxSessionInfo } from "../tmux.ts";
import type { CodexSessionSummary } from "../external/codex.ts";
import type { ClaudeSessionSummary } from "../external/claude.ts";

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

export type TuiMode = "res" | "tmux" | "codex" | "claude";
export type TuiFocus = "projects" | "sessions";

export type TabPosition = { start: number; end: number; mode: TuiMode };

export type TuiContext = {
  state: StateV1;
  actions: TuiActions;
  screen: Widgets.Screen;
  header: Widgets.BoxElement;
  headerUrl: Widgets.BoxElement;
  projectsBox: Widgets.ListElement;
  sessionsBox: Widgets.ListElement;
  tmuxBox: Widgets.ListElement;
  footer: Widgets.BoxElement;
  prompt: Widgets.PromptElement;
  question: Widgets.QuestionElement;
  mode: TuiMode;
  focused: TuiFocus;
  projects: Project[];
  sessions: SessionRecord[];
  selectedProject: Project | null;
  selectedProjectIndex: number;
  tmuxSessions: TmuxSessionInfo[];
  selectedTmuxIndex: number;
  codexSessions: CodexSessionSummary[];
  selectedCodexIndex: number;
  claudeSessions: ClaudeSessionSummary[];
  selectedClaudeIndex: number;
  expandedSessionIndex: number | null;
  sessionTmuxInfo: Map<string, TmuxSessionInfo>;
  listIndexToSessionIndex: number[];
  updatingSessionDisplay: boolean;
  modalClose: (() => void) | null;
  footerTimer: ReturnType<typeof setTimeout> | null;
  searchActive: boolean;
  searchQuery: string;
  tabs: readonly TuiMode[];
  tabPositions: TabPosition[];
  hoveredTab: TuiMode | null;
};

export type TuiRuntime = {
  updateHeader(): void;
  updateFooter(): void;
  updateFocusedStyles(): void;
  updateSessionDisplay(): void;
  refresh(): void;
  refreshSessionsForSelectedProject(): void;
  setMode(mode: TuiMode): void;
  flashFooter(message: string, ms?: number): void;
  withPrompt(title: string, value: string, cb: (input: string | null) => void): void;
  withConfirm(text: string, cb: (ok: boolean) => void): void;
  showError(text: string): void;
  openTextViewer(title: string, content: string): void;
  showHelp(): void;
  fail(err: unknown): void;
  done(): void;
};

export type TuiHandlers = {
  attachSelectedSession(): void;
  attachSelectedTmuxSession(): void;
  deleteSelectedTmuxSession(): void;
  copySelectedTmuxSessionName(): void;
  captureSelectedTmuxSession(): void;
  viewSelectedCodexSession(): void;
  viewSelectedClaudeSession(): void;
  copySelectedCodexSessionId(): void;
  copySelectedClaudeSessionId(): void;
  createTmuxFromCodexSession(): void;
  createTmuxFromClaudeSession(): void;
  associateSelectedTmuxSession(): void;
  unassociateSelectedTmuxSession(): void;
  createSessionForSelectedProject(): void;
  deleteSelectedSession(): void;
  unlinkSelectedSession(): void;
  linkExistingSessionToSelectedProject(): void;
  deleteSelectedProject(): void;
  addProject(): void;
  startSearch(): void;
};
