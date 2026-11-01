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
