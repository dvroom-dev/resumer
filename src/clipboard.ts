import { spawnSync } from "node:child_process";

export type CopyResult =
  | { ok: true; method: string }
  | { ok: false; error: string };

export function copyToSystemClipboard(text: string): CopyResult {
  const trimmed = text ?? "";
  const candidates: Array<{ method: string; cmd: string; args: string[]; when?: boolean }> = [
    { method: "pbcopy", cmd: "pbcopy", args: [], when: process.platform === "darwin" },
    { method: "wl-copy", cmd: "wl-copy", args: [], when: process.platform === "linux" && Boolean(process.env.WAYLAND_DISPLAY) },
    { method: "xclip", cmd: "xclip", args: ["-selection", "clipboard"], when: process.platform === "linux" },
    { method: "xsel", cmd: "xsel", args: ["--clipboard", "--input"], when: process.platform === "linux" },
  ];

  for (const c of candidates) {
    if (c.when === false) continue;
    const res = spawnSync(c.cmd, c.args, { input: trimmed, encoding: "utf8" });
    if (res.error) continue;
    if (res.status === 0) return { ok: true, method: c.method };
  }

  return { ok: false, error: "No clipboard helper found (pbcopy/wl-copy/xclip/xsel)." };
}

