/**
 * What the Config file editor shows before it saves: a unified diff of the two texts, in the shape
 * `git diff` prints, and what to make of the daemon's problems. Pure, so every UI shares it.
 */

type Op = { sign: " " | "-" | "+"; text: string };

function lines(text: string): string[] {
  if (text.length === 0) {
    return [];
  }
  const all = text.split("\n");
  if (all.at(-1) === "") {
    all.pop();
  }
  return all;
}

/** The lines both texts share, as an edit script (a longest common subsequence, so a moved line is a delete and an add). */
function script(before: readonly string[], after: readonly string[]): Op[] {
  const width = after.length + 1;
  const table = new Uint32Array((before.length + 1) * width);
  for (let i = before.length - 1; i >= 0; i -= 1) {
    for (let j = after.length - 1; j >= 0; j -= 1) {
      table[i * width + j] =
        before[i] === after[j] ? (table[(i + 1) * width + j + 1] ?? 0) + 1 : Math.max(table[(i + 1) * width + j] ?? 0, table[i * width + j + 1] ?? 0);
    }
  }
  const ops: Op[] = [];
  let i = 0;
  let j = 0;
  while (i < before.length && j < after.length) {
    if (before[i] === after[j]) {
      ops.push({ sign: " ", text: before[i] ?? "" });
      i += 1;
      j += 1;
    } else if ((table[(i + 1) * width + j] ?? 0) >= (table[i * width + j + 1] ?? 0)) {
      ops.push({ sign: "-", text: before[i] ?? "" });
      i += 1;
    } else {
      ops.push({ sign: "+", text: after[j] ?? "" });
      j += 1;
    }
  }
  for (; i < before.length; i += 1) ops.push({ sign: "-", text: before[i] ?? "" });
  for (; j < after.length; j += 1) ops.push({ sign: "+", text: after[j] ?? "" });
  return ops;
}

const CONTEXT = 3;

/** A unified diff of `before` to `after` for the file at `path`, or "" when they are the same. */
export function unifiedDiff(before: string, after: string, path: string): string {
  const ops = script(lines(before), lines(after));
  const changed = ops.flatMap((op, at) => (op.sign === " " ? [] : [at]));
  if (changed.length === 0) {
    return "";
  }
  // Each change keeps CONTEXT lines around it, and changes close together share a hunk.
  const hunks: { from: number; to: number }[] = [];
  for (const at of changed) {
    const from = Math.max(0, at - CONTEXT);
    const to = Math.min(ops.length, at + CONTEXT + 1);
    const last = hunks.at(-1);
    if (last !== undefined && from <= last.to) {
      last.to = to;
    } else {
      hunks.push({ from, to });
    }
  }
  const out = [`--- a/${path}`, `+++ b/${path}`];
  for (const { from, to } of hunks) {
    const before_ = ops.slice(0, from).filter((op) => op.sign !== "+").length;
    const after_ = ops.slice(0, from).filter((op) => op.sign !== "-").length;
    const slice = ops.slice(from, to);
    const oldCount = slice.filter((op) => op.sign !== "+").length;
    const newCount = slice.filter((op) => op.sign !== "-").length;
    out.push(`@@ -${oldCount === 0 ? before_ : before_ + 1},${oldCount} +${newCount === 0 ? after_ : after_ + 1},${newCount} @@`);
    for (const op of slice) {
      out.push(`${op.sign}${op.text}`);
    }
  }
  return `${out.join("\n")}\n`;
}

/** A problem `config.raw.set` found. `line` and `column` count from 1, when known. */
export type RawProblem = { line?: number | null; column?: number | null; path?: string | null; message: string };

/** The problem as a line: its place when it has one, then the message and the setting it is about. */
export function problemLine(problem: RawProblem): string {
  const where = problem.path ? ` (${problem.path})` : "";
  if (problem.line === undefined || problem.line === null) {
    return `${problem.message}${where}`;
  }
  const column = problem.column === undefined || problem.column === null ? "" : `:${problem.column}`;
  return `line ${problem.line}${column}: ${problem.message}${where}`;
}

/** Whether the file changed since it was read: the daemon refuses the save and says so. */
export function changedOnDisk(problems: readonly RawProblem[]): boolean {
  return problems.some((problem) => /changed on disk/.test(problem.message));
}

/** The lines that have a problem, for a mark in the gutter. */
export function problemLines(problems: readonly RawProblem[]): Set<number> {
  const marked = new Set<number>();
  for (const problem of problems) {
    if (problem.line !== undefined && problem.line !== null) {
      marked.add(problem.line);
    }
  }
  return marked;
}
