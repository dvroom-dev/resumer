export const modeColors = {
  res: "#44AADA",
  tmux: "#6AB244",
  codex: "#E88E2D",
  claude: "#DFD33F",
} as const;

export const colors = {
  secondary: "#44AADA",
  error: "#CD3731",
  selectedDim: {
    bg: "#374151",
    fg: "#9ca3af",
  },
  border: "#6AB244",
  borderDim: "#4b5563",
} as const;

export function getModeColor(mode: keyof typeof modeColors): string {
  return modeColors[mode];
}
