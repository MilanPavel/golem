import type { DiffLine } from "@golem/view";

/** One displayed line of a change. `old` and `new` are line numbers; a missing side has none. */
export type CodeRow = {
  kind: "line";
  tone: "add" | "del" | "context";
  sign: "+" | "-" | " ";
  old?: number;
  new?: number;
  text: string;
};

/** A hunk header or a `\ No newline at end of file` note: no number, no sign. */
export type NoteRow = { kind: "hunk" | "meta"; text: string };

export type UnifiedRow = CodeRow | NoteRow;

/** One side of a split row. */
export type Cell = { tone: "add" | "del" | "context"; sign: "+" | "-" | " "; n?: number; text: string };

export type SplitRow = NoteRow | { kind: "pair"; left: Cell | null; right: Cell | null };

export type DiffFile = {
  /** The new file's path, or the old one for a deleted file. Null when the diff names none. */
  path: string | null;
  added: boolean;
  deleted: boolean;
};

const HUNK = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/;

function firstHunk(lines: readonly DiffLine[]): number {
  return lines.findIndex((line) => line.tone === "hunk");
}

function clean(path: string, prefix: string): string {
  const trimmed = path.trimEnd();
  return trimmed.startsWith(prefix) ? trimmed.slice(prefix.length) : trimmed;
}

/** The file named by the `--- ` and `+++ ` lines before the first hunk. */
export function diffFile(lines: readonly DiffLine[]): DiffFile {
  const end = firstHunk(lines);
  const header = end < 0 ? lines : lines.slice(0, end);
  const oldName = header.find((line) => line.text.startsWith("--- "))?.text.slice(4).trimEnd();
  const newName = header.find((line) => line.text.startsWith("+++ "))?.text.slice(4).trimEnd();
  const added = oldName === "/dev/null";
  const deleted = newName === "/dev/null";
  let path: string | null = null;
  if (deleted) {
    path = oldName === undefined ? null : clean(oldName, "a/");
  } else if (newName !== undefined) {
    path = clean(newName, "b/");
  }
  return { path, added, deleted };
}

/** The rows of a diff, numbered from its hunk headers. The file header is left out. */
export function unifiedRows(lines: readonly DiffLine[]): UnifiedRow[] {
  const start = firstHunk(lines);
  // Text with no hunk header at all has no numbers to give, so every line shows unnumbered.
  const body = start < 0 ? lines.filter((line) => line.tone !== "meta" || line.text.startsWith("\\")) : lines.slice(start);
  const rows: UnifiedRow[] = [];
  let oldNo: number | undefined;
  let newNo: number | undefined;
  for (const line of body) {
    switch (line.tone) {
      case "hunk": {
        const match = HUNK.exec(line.text);
        oldNo = match ? Number(match[1]) : undefined;
        newNo = match ? Number(match[2]) : undefined;
        rows.push({ kind: "hunk", text: line.text });
        break;
      }
      case "meta":
        rows.push({ kind: "meta", text: line.text });
        break;
      case "add":
        rows.push({ kind: "line", tone: "add", sign: "+", ...(newNo === undefined ? {} : { new: newNo }), text: line.text.slice(1) });
        if (newNo !== undefined) newNo += 1;
        break;
      case "del":
        rows.push({ kind: "line", tone: "del", sign: "-", ...(oldNo === undefined ? {} : { old: oldNo }), text: line.text.slice(1) });
        if (oldNo !== undefined) oldNo += 1;
        break;
      default:
        rows.push({
          kind: "line",
          tone: "context",
          sign: " ",
          ...(oldNo === undefined ? {} : { old: oldNo }),
          ...(newNo === undefined ? {} : { new: newNo }),
          text: line.text.slice(1),
        });
        if (oldNo !== undefined) oldNo += 1;
        if (newNo !== undefined) newNo += 1;
    }
  }
  return rows;
}

function cell(row: CodeRow, side: "old" | "new"): Cell {
  const n = row[side];
  return { tone: row.tone, sign: row.sign, ...(n === undefined ? {} : { n }), text: row.text };
}

/** The same rows with each run of removed lines beside the run of added lines that follows it. */
export function splitRows(lines: readonly DiffLine[]): SplitRow[] {
  const out: SplitRow[] = [];
  let dels: CodeRow[] = [];
  let adds: CodeRow[] = [];
  const flush = () => {
    const count = Math.max(dels.length, adds.length);
    for (let i = 0; i < count; i += 1) {
      const del = dels[i];
      const add = adds[i];
      out.push({ kind: "pair", left: del ? cell(del, "old") : null, right: add ? cell(add, "new") : null });
    }
    dels = [];
    adds = [];
  };
  for (const row of unifiedRows(lines)) {
    if (row.kind !== "line") {
      flush();
      out.push(row);
    } else if (row.tone === "del") {
      if (adds.length > 0) flush();
      dels.push(row);
    } else if (row.tone === "add") {
      adds.push(row);
    } else {
      flush();
      out.push({ kind: "pair", left: cell(row, "old"), right: cell(row, "new") });
    }
  }
  flush();
  return out;
}
