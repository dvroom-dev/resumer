import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export type CodexSessionSummary = {
  id: string;
  cwd?: string;
  startedAt?: string;
  lastActivityAt?: string;
  lastPrompt?: string;
  cliVersion?: string;
  model?: string;
  sessionFile?: string;
  /** "user" if waiting on LLM, "assistant" if waiting on user */
  lastMessageType?: "user" | "assistant";
};

type CodexHistoryLine = {
  session_id?: unknown;
  ts?: unknown;
  text?: unknown;
};

type CodexSessionMetaLine = {
  type?: unknown;
  timestamp?: unknown;
  payload?: unknown;
};

const NO_PROMPT_PLACEHOLDER = "(no prompt yet)";
const RECENT_ORPHAN_SCAN_LIMIT = 200;
const RECENT_ORPHAN_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;

function isObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object";
}

function isRealPrompt(text: string): boolean {
  const trimmed = text.trim();
  if (!trimmed) return false;
  if (trimmed.startsWith("!")) return false;

  const first = trimmed.split(/\s+/)[0] ?? "";
  if (first.startsWith("/") && first.length > 1 && !first.slice(1).includes("/")) {
    return false;
  }

  return true;
}

function normalizeSessionId(id: string): string {
  return id.toLowerCase();
}

function isoFromUnixSeconds(seconds: number): string {
  return new Date(seconds * 1000).toISOString();
}

function readFileHead(filePath: string, maxBytes: number): string {
  const fd = fs.openSync(filePath, "r");
  try {
    const buf = Buffer.allocUnsafe(maxBytes);
    const bytes = fs.readSync(fd, buf, 0, maxBytes, 0);
    return buf.subarray(0, bytes).toString("utf8");
  } finally {
    fs.closeSync(fd);
  }
}

function readFileTail(filePath: string, maxBytes: number): string {
  const stat = fs.statSync(filePath);
  const fd = fs.openSync(filePath, "r");
  try {
    const start = Math.max(0, stat.size - maxBytes);
    const buf = Buffer.allocUnsafe(Math.min(maxBytes, stat.size));
    const bytes = fs.readSync(fd, buf, 0, buf.length, start);
    return buf.subarray(0, bytes).toString("utf8");
  } finally {
    fs.closeSync(fd);
  }
}

function getLastMessageType(sessionFile: string): "user" | "assistant" | undefined {
  try {
    const tail = readFileTail(sessionFile, 256 * 1024);
    const lines = tail.split("\n").filter((l) => l.trim());
    for (let i = lines.length - 1; i >= 0; i--) {
      const parsed = safeJsonParse(lines[i]);
      if (!parsed || !isObject(parsed)) continue;
      const type = typeof parsed.type === "string" ? parsed.type : "";

      if (type === "event_msg" && isObject(parsed.payload)) {
        const payload = parsed.payload;
        const payloadType = typeof payload.type === "string" ? payload.type : "";
        if (payloadType === "turn_aborted") return "assistant";
      }

      if (type === "response_item" && isObject(parsed.payload)) {
        const payload = parsed.payload;
        const payloadType = typeof payload.type === "string" ? payload.type : "";
        const role = typeof payload.role === "string" ? payload.role : "";
        if (payloadType === "message" && (role === "user" || role === "assistant")) {
          return role;
        }
      }

      if (type === "event_msg" && isObject(parsed.payload)) {
        const payload = parsed.payload;
        const payloadType = typeof payload.type === "string" ? payload.type : "";
        if (payloadType === "user_message") return "user";
        if (payloadType === "assistant_message") return "assistant";
      }
    }
  } catch {
    // Ignore errors
  }
  return undefined;
}

function safeJsonParse(line: string): unknown {
  try {
    return JSON.parse(line);
  } catch {
    return null;
  }
}

function walkFiles(root: string, out: string[], maxFiles: number): void {
  if (out.length >= maxFiles) return;
  const entries = fs
    .readdirSync(root, { withFileTypes: true })
    // Session paths are date-encoded (YYYY/MM/DD + timestamp in filename).
    // Traverse newest-first so the maxFiles cap keeps recent sessions.
    .sort((a, b) => {
      if (a.name === b.name) return 0;
      return a.name < b.name ? 1 : -1;
    });
  for (const ent of entries) {
    if (out.length >= maxFiles) return;
    const full = path.join(root, ent.name);
    if (ent.isDirectory()) {
      walkFiles(full, out, maxFiles);
    } else if (ent.isFile() && ent.name.endsWith(".jsonl")) {
      out.push(full);
    }
  }
}

function extractSessionIdFromFilename(filePath: string): string | null {
  const fileName = path.basename(filePath);
  const matches = fileName.match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi);
  if (!matches?.length) return null;
  const id = matches[matches.length - 1];
  if (!id) return null;
  return normalizeSessionId(id);
}

function pickCandidateSessionFiles(
  sessionFiles: string[],
  promptSessionIds: Set<string>,
): string[] {
  const selected = new Set<string>();
  const orphanCandidates: Array<{ filePath: string; mtimeMs: number }> = [];
  const now = Date.now();

  for (const filePath of sessionFiles) {
    const fileSessionId = extractSessionIdFromFilename(filePath);
    if (fileSessionId && promptSessionIds.has(fileSessionId)) {
      selected.add(filePath);
      continue;
    }

    try {
      const stat = fs.statSync(filePath);
      if (now - stat.mtimeMs <= RECENT_ORPHAN_WINDOW_MS) {
        orphanCandidates.push({ filePath, mtimeMs: stat.mtimeMs });
      }
    } catch {
      // Ignore stat errors while gathering candidates.
    }
  }

  orphanCandidates
    .sort((a, b) => b.mtimeMs - a.mtimeMs)
    .slice(0, RECENT_ORPHAN_SCAN_LIMIT)
    .forEach((entry) => selected.add(entry.filePath));

  return Array.from(selected);
}

function getCodexHomeDir(): string {
  const override = process.env.CODEX_HOME?.trim() || process.env.RESUMER_CODEX_HOME?.trim();
  if (override) return override;
  return path.join(os.homedir(), ".codex");
}

function buildLastPromptIndex(codexHome: string): Map<string, { ts: number; text: string }> {
  const map = new Map<string, { ts: number; text: string }>();
  const historyPath = path.join(codexHome, "history.jsonl");
  if (!fs.existsSync(historyPath)) return map;

  const raw = fs.readFileSync(historyPath, "utf8");
  const lines = raw.split("\n");
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const parsed = safeJsonParse(trimmed) as CodexHistoryLine | null;
    if (!parsed || !isObject(parsed)) continue;
    const sessionId = typeof parsed.session_id === "string" ? parsed.session_id : null;
    const ts = typeof parsed.ts === "number" ? parsed.ts : null;
    const text = typeof parsed.text === "string" ? parsed.text : null;
    if (!sessionId || !ts || !text) continue;
    if (!isRealPrompt(text)) continue;
    const key = normalizeSessionId(sessionId);
    const prev = map.get(key);
    if (!prev || ts >= prev.ts) map.set(key, { ts, text });
  }
  return map;
}

function parseCodexSessionFile(filePath: string): Omit<CodexSessionSummary, "lastActivityAt" | "lastPrompt"> | null {
  // Session logs can be large. Only parse the start of the file for metadata.
  const head = readFileHead(filePath, 256 * 1024);
  const lines = head.split("\n");

  let id: string | undefined;
  let cwd: string | undefined;
  let startedAt: string | undefined;
  let cliVersion: string | undefined;
  let model: string | undefined;

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) continue;
    const parsed = safeJsonParse(line) as CodexSessionMetaLine | null;
    if (!parsed || !isObject(parsed)) continue;

    const type = typeof parsed.type === "string" ? parsed.type : "";
    if (type === "session_meta" && isObject(parsed.payload)) {
      const payload = parsed.payload;
      const pid = typeof payload.id === "string" ? payload.id : undefined;
      const pcwd = typeof payload.cwd === "string" ? payload.cwd : undefined;
      const pts = typeof payload.timestamp === "string" ? payload.timestamp : undefined;
      const pcli = typeof payload.cli_version === "string" ? payload.cli_version : undefined;
      id = id ?? pid;
      cwd = cwd ?? pcwd;
      startedAt = startedAt ?? pts ?? (typeof parsed.timestamp === "string" ? parsed.timestamp : undefined);
      cliVersion = cliVersion ?? pcli;
      continue;
    }

    if (type === "turn_context" && isObject(parsed.payload)) {
      const payload = parsed.payload;
      const m = typeof payload.model === "string" ? payload.model : undefined;
      model = model ?? m;
      continue;
    }

    if (id && cwd && startedAt && cliVersion && model) break;
  }

  if (!id) return null;
  return { id, cwd, startedAt, cliVersion, model, sessionFile: filePath };
}

export function listCodexSessions(): CodexSessionSummary[] {
  const codexHome = getCodexHomeDir();
  const sessionsRoot = path.join(codexHome, "sessions");
  if (!fs.existsSync(sessionsRoot) || !fs.statSync(sessionsRoot).isDirectory()) return [];

  const lastPrompt = buildLastPromptIndex(codexHome);
  const promptSessionIds = new Set(lastPrompt.keys());
  const recentActivityMs = 5 * 60 * 1000;

  const sessionFiles: string[] = [];
  walkFiles(sessionsRoot, sessionFiles, 5000);
  const candidateFiles = pickCandidateSessionFiles(sessionFiles, promptSessionIds);

  const out: CodexSessionSummary[] = [];
  for (const filePath of candidateFiles) {
    const parsed = parseCodexSessionFile(filePath);
    if (!parsed) continue;
    const last = lastPrompt.get(normalizeSessionId(parsed.id));
    const lastActivityAt = last ? isoFromUnixSeconds(last.ts) : undefined;
    let lastMessageType = getLastMessageType(filePath);
    if (lastMessageType === "user") {
      let isRecent = false;
      if (lastActivityAt) {
        const lastMs = Date.parse(lastActivityAt);
        if (!Number.isNaN(lastMs)) {
          isRecent = Date.now() - lastMs < recentActivityMs;
        }
      } else {
        try {
          const stat = fs.statSync(filePath);
          isRecent = Date.now() - stat.mtimeMs < recentActivityMs;
        } catch {
          // ignore
        }
      }
      if (!isRecent) lastMessageType = "assistant";
    }
    out.push({
      ...parsed,
      lastActivityAt,
      lastPrompt: last?.text ?? NO_PROMPT_PLACEHOLDER,
      lastMessageType,
    });
  }

  out.sort((a, b) => {
    const aKey = a.lastActivityAt ?? a.startedAt ?? "";
    const bKey = b.lastActivityAt ?? b.startedAt ?? "";
    return bKey.localeCompare(aKey);
  });
  return out;
}

export function formatCodexSessionDetails(session: CodexSessionSummary): string {
  const lines: string[] = [];
  lines.push(`id: ${session.id}`);
  if (session.cwd) lines.push(`cwd: ${session.cwd}`);
  if (session.startedAt) lines.push(`started: ${session.startedAt}`);
  if (session.lastActivityAt) lines.push(`last activity: ${session.lastActivityAt}`);
  if (session.cliVersion) lines.push(`cli version: ${session.cliVersion}`);
  if (session.model) lines.push(`model: ${session.model}`);
  if (session.sessionFile) lines.push(`session log: ${session.sessionFile}`);
  if (session.lastPrompt?.trim()) {
    lines.push("");
    lines.push("last prompt:");
    lines.push(session.lastPrompt.trim());
  }
  return lines.join("\n");
}
