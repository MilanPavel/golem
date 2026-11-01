/** A unified diff as rows for the approval band: one tone per row, cut to the width. */

import type { DiffLine } from "@golem/view";

export { parseDiff, type DiffLine, type DiffTone } from "@golem/view";

/** Rows that fit `rows` from `offset`, each cut to `columns`. */
export function diffWindow(lines: readonly DiffLine[], offset: number, rows: number, columns: number): DiffLine[] {
  const start = clampDiffOffset(offset, lines.length, rows);
  const width = Math.max(1, columns);
  return lines.slice(start, start + Math.max(0, rows)).map((line) => ({ ...line, text: fit(line.text, width) }));
}

/** The first row to show, so the window never runs past the end. */
export function clampDiffOffset(offset: number, total: number, rows: number): number {
  return Math.max(0, Math.min(Math.floor(offset), total - Math.max(0, rows)));
}

/** A line or a page toward `toward`, or the start or the end, kept inside the diff. */
export function moveDiffOffset(
  offset: number,
  toward: "up" | "down" | "start" | "end",
  line: boolean,
  total: number,
  rows: number,
): number {
  const step = line ? 1 : Math.max(1, rows - 1);
  const next =
    toward === "start" ? 0 : toward === "end" ? total : toward === "up" ? offset - step : offset + step;
  return clampDiffOffset(next, total, rows);
}

function fit(text: string, width: number): string {
  return text.length <= width ? text : `${text.slice(0, Math.max(0, width - 1))}…`;
}
