/** A unified diff as one tone per row. Fitting rows to a width is left to the app. */

import { visibleText } from "./sanitize.ts";

export type DiffTone = "add" | "del" | "hunk" | "meta" | "context";

export type DiffLine = {
  text: string;
  tone: DiffTone;
};

const TAB = "    ";

export function parseDiff(diff: string): DiffLine[] {
  if (diff === "") {
    return [];
  }
  const body = diff.endsWith("\n") ? diff.slice(0, -1) : diff;
  let inHunk = false;
  return body.split("\n").map((row) => {
    inHunk ||= row.startsWith("@@");
    return { text: visible(row), tone: toneOf(row, inHunk) };
  });
}

function visible(row: string): string {
  return visibleText(row.replaceAll("\t", TAB));
}

function toneOf(row: string, inHunk: boolean): DiffTone {
  if (row.startsWith("\\") || (!inHunk && (row.startsWith("+++") || row.startsWith("---")))) {
    return "meta";
  }
  if (row.startsWith("@@")) {
    return "hunk";
  }
  if (row.startsWith("+")) {
    return "add";
  }
  if (row.startsWith("-")) {
    return "del";
  }
  return "context";
}

export type DiffExcerpt = { lines: DiffLine[]; more: number };

const isCode = (line: DiffLine): boolean => line.tone === "add" || line.tone === "del" || line.tone === "context";

/**
 * The first rows of a parsed diff: the first hunk, from at most one context row before its first change,
 * without the file header or the `@@` rows. `more` counts the add, delete and context rows after the shown ones.
 */
export function diffExcerpt(rows: readonly DiffLine[], maxRows: number): DiffExcerpt {
  const code = rows.filter(isCode);
  const first = code.findIndex((line) => line.tone !== "context");
  const start = Math.max(0, first - 1);
  const lines = code.slice(start, start + Math.max(0, Math.floor(maxRows)));
  return { lines, more: code.length - start - lines.length };
}

/** The added and deleted rows of a parsed diff, and whether it makes a new file. */
export function diffCounts(rows: readonly DiffLine[]): { added: number; deleted: number; created: boolean } {
  return {
    added: rows.filter((line) => line.tone === "add").length,
    deleted: rows.filter((line) => line.tone === "del").length,
    created: rows.some((line) => line.tone === "meta" && line.text.startsWith("--- /dev/null")),
  };
}
