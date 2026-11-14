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

export type NumberedLine = DiffLine & { old: number | null; new: number | null };

const HUNK = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/;

/** Each line with its old and new line number, from the `@@ -a,b +c,d @@` rows. Hunk and meta rows, and lines before any hunk, have none. */
export function numberDiff(lines: readonly DiffLine[]): NumberedLine[] {
  let oldNo: number | null = null;
  let newNo: number | null = null;
  return lines.map((line) => {
    switch (line.tone) {
      case "hunk": {
        const match = HUNK.exec(line.text);
        oldNo = match ? Number(match[1]) : null;
        newNo = match ? Number(match[2]) : null;
        return { ...line, old: null, new: null };
      }
      case "meta":
        return { ...line, old: null, new: null };
      case "add": {
        const numbered = { ...line, old: null, new: newNo };
        if (newNo !== null) newNo += 1;
        return numbered;
      }
      case "del": {
        const numbered = { ...line, old: oldNo, new: null };
        if (oldNo !== null) oldNo += 1;
        return numbered;
      }
      default: {
        const numbered = { ...line, old: oldNo, new: newNo };
        if (oldNo !== null) oldNo += 1;
        if (newNo !== null) newNo += 1;
        return numbered;
      }
    }
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
