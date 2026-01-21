import {
  computeProjectId,
} from "./state.ts";
import type { Project, StateV1 } from "./types.ts";
import { nowIso } from "./time.ts";
import { getTmuxEnv, listTmuxSessions } from "./tmux.ts";

export type CliOptions = {
  help: boolean;
  create: boolean;
  del: boolean;
  delAll: boolean;
  session?: string;
  unregister: boolean;
  reset: boolean;
  yes: boolean;
  link: boolean;
};

export function usage(): string {
  return [
    "resumer (res) - tmux sessions per project",
    "",
    "Usage:",
    "  res                           Open TUI",
    "  res <path>                    Register/open project session",
    "  res <path> <command...>        Match/create session by command (partial match)",
    "  res --link <path> -s <name>    Associate an existing tmux session with a project",
    "",
    "Options:",
    "  -c, --create                   Force new session creation",
    "  -d, --delete                   Delete session(s) (interactive unless -s used)",
    "  -a, --all                      With -d and <path>, delete all project sessions",
    "  -s, --session <name>           Target tmux session (for -d)",
    "  -u, --unregister               Remove project + kill its sessions",
    "  -l, --link                     Associate an existing tmux session with a project",
    "      --reset                    Remove all projects/sessions (requires --yes)",
    "  -y, --yes                      Skip confirmation for destructive ops",
    "  -h, --help                     Show help",
    "",
  ].join("\n");
}

export function parseArgs(argv: string[]): { opts: CliOptions; positionals: string[] } {
  const opts: CliOptions = {
    help: false,
    create: false,
    del: false,
    delAll: false,
    unregister: false,
    reset: false,
    yes: false,
    link: false,
  };
  const positionals: string[] = [];

  let stop = false;
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (!stop && arg === "--") {
      stop = true;
      continue;
    }
    if (!stop && (arg === "-h" || arg === "--help")) {
      opts.help = true;
      continue;
    }
    if (!stop && (arg === "-c" || arg === "--create")) {
      opts.create = true;
      continue;
    }
    if (!stop && (arg === "-d" || arg === "--delete" || arg === "--del")) {
      opts.del = true;
      continue;
    }
    if (!stop && (arg === "-a" || arg === "--all")) {
      opts.delAll = true;
      continue;
    }
    if (!stop && (arg === "-u" || arg === "--unregister")) {
      opts.unregister = true;
      continue;
    }
    if (!stop && (arg === "-l" || arg === "--link")) {
      opts.link = true;
      continue;
    }
    if (!stop && arg === "--reset") {
      opts.reset = true;
      continue;
    }
    if (!stop && (arg === "-y" || arg === "--yes")) {
      opts.yes = true;
      continue;
    }
    if (!stop && (arg === "-s" || arg === "--session")) {
      const value = argv[i + 1];
      if (!value) throw new Error(`${arg} requires a value`);
      opts.session = value;
      i++;
      continue;
    }
    positionals.push(arg);
  }

  return { opts, positionals };
}

export function normalizeCommandArgs(commandArgs: string[]): string | undefined {
  if (!commandArgs.length) return undefined;
  const joined = commandArgs.join(" ").trim();
  return joined.length ? joined : undefined;
}

export function reconcileStateWithTmux(state: StateV1): void {
  const liveNames = new Set(listTmuxSessions());

  for (const name of Object.keys(state.sessions)) {
    if (!liveNames.has(name)) delete state.sessions[name];
  }

  for (const name of liveNames) {
    if (state.sessions[name]) continue;
    const projectPath = getTmuxEnv(name, "RESUMER_PROJECT_PATH");
    if (!projectPath) continue;
    const projectId = getTmuxEnv(name, "RESUMER_PROJECT_ID") ?? computeProjectId(projectPath);
    const cmdRaw = getTmuxEnv(name, "RESUMER_COMMAND");
    const cmd = cmdRaw && cmdRaw.trim().length ? cmdRaw : undefined;
    const createdAt = getTmuxEnv(name, "RESUMER_CREATED_AT") ?? nowIso();
    const managed = getTmuxEnv(name, "RESUMER_MANAGED") === "1";

    const projectName = projectPath.split("/").filter(Boolean).at(-1) ?? projectPath;
    const project: Project = state.projects[projectId] ?? {
      id: projectId,
      path: projectPath,
      name: projectName,
      createdAt,
      lastUsedAt: createdAt,
    };
    state.projects[projectId] = project;

    state.sessions[name] = {
      name,
      projectId,
      projectPath,
      createdAt,
      command: cmd,
      kind: managed ? "managed" : "linked",
    };
  }
}
