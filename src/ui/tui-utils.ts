import type { Widgets } from "blessed";

export function getSelectedIndex(list: Widgets.ListElement): number {
  const selected = (list as any).selected;
  return typeof selected === "number" ? selected : 0;
}
