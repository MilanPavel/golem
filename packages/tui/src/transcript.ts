import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

import { exportFileName } from "@golem/view";

import { expandHome, golemDir } from "./history.ts";

export { copyAnswer, copyCode, exportFileName, lastFencedCode, sessionMarkdown, type CopyMessage } from "@golem/view";

export type TailAnchor = {
  lines: number;
  /** Content width. A change here is a reflow, not new text. */
  columns: number;
  /** Rows that arrived after the view left the newest line. */
  fresh: number;
};

/** A given path wins. Otherwise `~/.golem/exports/<title>.md`, under `GOLEM_HOME` when that is set. */
export function exportDestination(input: {
  env?: NodeJS.ProcessEnv;
  home: string;
  title: string;
  given: string | null;
}): string {
  const given = input.given?.trim() ?? "";
  if (given.length > 0) {
    return expandHome(given, input.home);
  }
  return join(golemDir(input.env, input.home), "exports", exportFileName(input.title));
}

/** `14:02` today, `2026-10-16 14:02` on an earlier day. Local time. */
export function formatMessageTime(iso: string, nowMs: number): string {
  const at = Date.parse(iso);
  if (Number.isNaN(at) || !Number.isFinite(nowMs)) {
    return "";
  }
  const when = new Date(at);
  const now = new Date(nowMs);
  const clock = `${pad(when.getHours())}:${pad(when.getMinutes())}`;
  if (
    when.getFullYear() === now.getFullYear() &&
    when.getMonth() === now.getMonth() &&
    when.getDate() === now.getDate()
  ) {
    return clock;
  }
  return `${when.getFullYear()}-${pad(when.getMonth() + 1)}-${pad(when.getDate())} ${clock}`;
}

export function newLinesLabel(count: number): string {
  if (!Number.isFinite(count) || count <= 0) {
    return "";
  }
  const lines = Math.floor(count);
  return lines === 1 ? "\u2193 1 new line" : `\u2193 ${lines} new lines`;
}

/**
 * While the view is away from the newest line, rows that arrive stay below it.
 * A width change resets the baseline so a reflow is not counted as new text.
 * Offset 0 clears the count.
 */
export function followTail(
  anchor: TailAnchor | null,
  lineCount: number,
  columns: number,
  offset: number,
): { anchor: TailAnchor; offset: number; fresh: number } {
  const count = Math.max(0, Math.floor(lineCount));
  const width = Math.max(1, Math.floor(columns));
  const place = Math.max(0, Math.floor(offset));
  if (anchor === null || anchor.columns !== width) {
    const fresh = anchor !== null && place > 0 ? anchor.fresh : 0;
    return { anchor: { lines: count, columns: width, fresh }, offset: place, fresh };
  }
  if (place <= 0) {
    return { anchor: { lines: count, columns: width, fresh: 0 }, offset: 0, fresh: 0 };
  }
  const added = Math.max(0, count - anchor.lines);
  const fresh = anchor.fresh + added;
  return { anchor: { lines: count, columns: width, fresh }, offset: place + added, fresh };
}

export async function writeExport(file: string, markdown: string): Promise<void> {
  await mkdir(dirname(file), { recursive: true });
  await writeFile(file, markdown, "utf8");
}

function pad(value: number): string {
  return value < 10 ? `0${value}` : String(value);
}
