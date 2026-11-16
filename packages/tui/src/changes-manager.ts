import type { ChangedFile, ChangesRevertTarget } from "@golem/client";
import { parseDiff, shellTrackingNote, type DiffLine, type DiffTone, type ShellTracking } from "@golem/view";

import { layoutCommitBand, type CommitBand } from "./commit-band.ts";
import { clampDiffOffset } from "./diff-view.ts";
import type { Press } from "./keys.ts";

/**
 * `/changes`: the files this session changed on the left, the diff of the
 * selected one on the right. The files and the diffs are the app's data; this
 * state only says which file, which hunk, and how far down the diff the user is.
 */
export type ChangesManagerState = {
  open: boolean;
  file: number;
  hunk: number;
  offset: number;
  /** The commit band, while it is open. */
  commit?: CommitBand | null;
  /** A line of news, such as the hash of a commit, shown in front of the key hint. */
  note?: string | null;
  /** An undo waits for `y` or `n` in the hint row. */
  confirm: ChangesRevertTarget | null;
  /** A line that replaces the hint until the next key. */
  message: string | null;
};

export type ChangesData = {
  /** The list `changes.list` returned, or null while it is asked. */
  files: readonly ChangedFile[] | null;
  error: string | null;
  /** Diff text by path, for the files read so far. */
  diffs: Readonly<Record<string, string>>;
  /** Why a file's diff could not be read, by path. */
  failed?: Readonly<Record<string, string>>;
  /** How shell changes are found, from `changes.list`. Left out, they are. */
  shell?: ShellTracking;
};

export type ChangesKey =
  | "up"
  | "down"
  | "next-hunk"
  | "prev-hunk"
  | "page-up"
  | "page-down"
  | "back"
  | "undo-hunk"
  | "undo-file"
  | "yes"
  | "commit";

export type ChangesAction =
  | { kind: "none" }
  | { kind: "close" }
  | { kind: "load"; path: string }
  | { kind: "revert"; target: ChangesRevertTarget }
  /** `g`: ask git about the folder, then open the commit band. */
  | { kind: "commit-info" };

export type ChangesTone = DiffTone | "plain";

/**
 * One row. `left` is the file column, already padded to its width, or null
 * when the screen is too narrow for one. `text` is cut to the width that is left.
 */
export type ChangesLine = {
  left: string | null;
  leftSelected?: boolean;
  text: string;
  tone: ChangesTone;
  bold?: boolean;
  dim?: boolean;
};

/** From this many columns the files sit beside the diff. */
export const WIDE_COLUMNS = 100;
const LEFT_WIDTH = 28;
const PAGE = 10;
const HINT = "↑↓ file · n/p hunk · PgUp/PgDn scroll · u undo hunk · U undo file · g commit · esc back";
export const WAIT_MESSAGE = "Wait for golem to finish.";
const BARE_HINT = "esc back";

export const closedChangesManager: ChangesManagerState = {
  open: false,
  file: 0,
  hunk: 0,
  offset: 0,
  confirm: null,
  message: null,
};

export function openChangesManager(): ChangesManagerState {
  return { ...closedChangesManager, open: true };
}

export function changesKeyOf(press: Press): ChangesKey | null {
  if (press.name === "up" || press.name === "down") {
    return press.name;
  }
  if (press.name === "page-up" || press.name === "page-down") {
    return press.name;
  }
  if (press.name === "escape") {
    return "back";
  }
  if (press.name === null && !press.ctrl && !press.meta) {
    if (press.input === "n") {
      return "next-hunk";
    }
    if (press.input === "p") {
      return "prev-hunk";
    }
    if (press.input === "g") {
      return "commit";
    }
    if (press.input === "u") {
      return "undo-hunk";
    }
    if (press.input === "U") {
      return "undo-file";
    }
    if (press.input === "y") {
      return "yes";
    }
  }
  return null;
}

/** The row numbers of the `@@` rows. */
export function hunkRows(lines: readonly DiffLine[]): number[] {
  const rows: number[] = [];
  lines.forEach((line, index) => {
    if (line.tone === "hunk") {
      rows.push(index);
    }
  });
  return rows;
}

/**
 * `page` is how many rows PgUp and PgDn move: the app passes the room it has.
 * `busy` is a run in progress: an undo then only says to wait.
 */
export function pressChanges(
  state: ChangesManagerState,
  data: ChangesData,
  key: ChangesKey,
  page = PAGE,
  busy = false,
): { state: ChangesManagerState; action: ChangesAction } {
  const none = { kind: "none" } as const;
  if (state.confirm !== null) {
    // `y` asks the daemon. Any other key, `n` and esc included, only drops the question.
    const cleared = { ...state, confirm: null, message: null };
    return key === "yes"
      ? { state: cleared, action: { kind: "revert", target: state.confirm } }
      : { state: cleared, action: none };
  }
  if (state.message !== null) {
    state = { ...state, message: null };
  }
  if (key === "yes") {
    return { state, action: none };
  }
  if (key === "back") {
    return { state: closedChangesManager, action: { kind: "close" } };
  }
  const files = data.files ?? [];
  const file = clamp(state.file, files.length);
  const path = files[file]?.path;
  if (path === undefined) {
    return { state, action: none };
  }
  if (key === "commit") {
    return { state, action: { kind: "commit-info" } };
  }
  if (key === "up" || key === "down") {
    const next = clamp(file + (key === "up" ? -1 : 1), files.length);
    if (next === file) {
      return { state: { ...state, file }, action: none };
    }
    const target = files[next]?.path;
    const moved = { ...state, file: next, hunk: 0, offset: 0 };
    const load = target !== undefined && data.diffs[target] === undefined;
    return { state: moved, action: load ? { kind: "load", path: target } : none };
  }
  if (key === "undo-file" || key === "undo-hunk") {
    if (busy) {
      return { state: { ...state, message: WAIT_MESSAGE }, action: none };
    }
    if (key === "undo-file") {
      return { state: { ...state, file, confirm: { kind: "file", path } }, action: none };
    }
    const hunks = hunkRows(parseDiff(data.diffs[path] ?? "")).length;
    if (hunks === 0) {
      return { state, action: none };
    }
    const hunk = Math.min(state.hunk, hunks - 1);
    return { state: { ...state, file, confirm: { kind: "hunk", path, hunk } }, action: none };
  }
  const lines = parseDiff(data.diffs[path] ?? "");
  const rows = hunkRows(lines);
  const at = (offset: number): ChangesManagerState => {
    const clamped = Math.max(0, Math.min(offset, lines.length - 1));
    return { ...state, file, offset: clamped, hunk: Math.max(0, rows.filter((row) => row <= clamped).length - 1) };
  };
  if (key === "next-hunk") {
    const row = rows.find((candidate) => candidate > state.offset);
    return { state: row === undefined ? state : at(row), action: none };
  }
  if (key === "prev-hunk") {
    const row = [...rows].reverse().find((candidate) => candidate < state.offset);
    return { state: row === undefined ? state : at(row), action: none };
  }
  return { state: at(state.offset + (key === "page-up" ? -page : page)), action: none };
}

function confirmText(target: ChangesRevertTarget): string {
  if (target.kind === "hunk") {
    return `undo hunk ${target.hunk + 1} of ${target.path}? y/n`;
  }
  return `undo ${"path" in target ? target.path : "this change"}? y/n`;
}

/** `changes · 3 files +43 −4`. */
function titleOf(files: readonly ChangedFile[]): string {
  const added = files.reduce((sum, file) => sum + file.added, 0);
  const removed = files.reduce((sum, file) => sum + file.removed, 0);
  return `changes · ${files.length} ${files.length === 1 ? "file" : "files"} ${counts(added, removed)}`;
}

function counts(added: number, removed: number): string {
  return `+${added} −${removed}`;
}

const LETTER = { created: "A", modified: "M", deleted: "D" } as const;

/** One row of the file column: status letter, the path cut from the left, the counts. */
function fileRow(file: ChangedFile): string {
  const tally = counts(file.added, file.removed);
  const room = Math.max(1, LEFT_WIDTH - 2 - tally.length - 1);
  return `${LETTER[file.status]} ${cutLeft(file.path, room).padEnd(room)} ${tally}`.padEnd(LEFT_WIDTH);
}

/** The rows of the whole frame: a title, the body, and the key hint. */
export function layoutChanges(
  state: ChangesManagerState,
  data: ChangesData,
  columns: number,
  rows: number,
): ChangesLine[] {
  const width = Math.max(1, columns);
  const wide = width >= WIDE_COLUMNS;
  const plain = (text: string, extra: Partial<ChangesLine> = {}): ChangesLine => ({
    left: null,
    text: cut(text, width),
    tone: "plain",
    ...extra,
  });
  const files = data.files;
  const note = shellTrackingNote(data.shell ?? "git");
  const noteLines = note === null ? [] : wrapWords(note, width).map((line) => plain(line, { dim: true }));
  const band =
    state.commit === null || state.commit === undefined
      ? null
      : layoutCommitBand(state.commit, width).map(
          (row): ChangesLine => ({ left: null, text: row.text, tone: row.tone === "del" ? "del" : "plain", bold: row.bold === true, dim: row.dim === true }),
        );
  // The band takes the rows of the key hint and more.
  const room = Math.max(0, rows - 1 - (band === null ? 1 : band.length));
  let title = "changes";
  let body: ChangesLine[];
  let hint = BARE_HINT;
  const asked = state.confirm;
  if (data.error !== null) {
    body = [plain(data.error)];
  } else if (files === null) {
    body = [plain("asking the daemon…", { dim: true })];
  } else if (files.length === 0) {
    body = [plain("No changes yet."), ...noteLines];
  } else {
    title = titleOf(files);
    hint = state.note === undefined || state.note === null ? HINT : `${state.note} · ${HINT}`;
    const file = clamp(state.file, files.length);
    const chosen = files[file];
    const path = chosen?.path ?? "";
    const rightWidth = wide ? width - LEFT_WIDTH - 1 : width;
    const head: ChangesLine[] = [...noteLines];
    if (!wide && chosen !== undefined) {
      const label = `‹ ${file + 1}/${files.length} ${chosen.path} ${counts(chosen.added, chosen.removed)} ›`;
      head.push(plain(label, { bold: true }));
    }
    const diffRoom = Math.max(0, room - head.length);
    const right = diffRows(data, path, state.offset, diffRoom, Math.max(1, rightWidth));
    const left = wide ? leftRows(files, file, diffRoom) : null;
    body = [
      ...head,
      ...right.map((row, index) => ({
        ...row,
        left: left === null ? null : (left[index]?.text ?? " ".repeat(LEFT_WIDTH)),
        leftSelected: left?.[index]?.selected === true,
      })),
    ];
    // A short diff leaves the file column with more rows than the diff has.
    for (let index = right.length; left !== null && index < Math.min(left.length, diffRoom); index += 1) {
      body.push({ left: left[index]?.text ?? "", leftSelected: left[index]?.selected === true, text: "", tone: "plain" });
    }
  }
  if (asked !== null) {
    hint = confirmText(asked);
  } else if (state.message !== null) {
    hint = state.message;
  }
  const lines = [
    plain(title, { bold: true }),
    ...body.slice(0, room),
    ...Array.from({ length: Math.max(0, room - body.length) }, () => plain("")),
    ...(band ?? [plain(hint, { dim: true })]),
  ];
  return lines.slice(0, Math.max(0, rows));
}

/** The file column from the top, scrolled so the selected file shows. */
function leftRows(files: readonly ChangedFile[], selected: number, room: number): { text: string; selected: boolean }[] {
  const start = Math.max(0, Math.min(selected - room + 1, files.length - room));
  return files.slice(start, start + room).map((file, index) => ({
    text: fileRow(file),
    selected: start + index === selected,
  }));
}

function diffRows(data: ChangesData, path: string, offset: number, room: number, width: number): ChangesLine[] {
  const text = data.diffs[path];
  const note = (words: string, dim = true): ChangesLine[] => [
    { left: null, text: cut(words, width), tone: "plain", dim },
  ];
  if (text === undefined) {
    const why = data.failed?.[path];
    return why === undefined ? note("loading the diff…") : note(why, false);
  }
  const lines = parseDiff(text);
  if (lines.length === 0) {
    return note("No text diff.");
  }
  const rows = hunkRows(lines);
  const start = clampDiffOffset(offset, lines.length, room);
  return lines.slice(start, start + room).map((line, index) => {
    const hunk = rows.indexOf(start + index);
    if (hunk < 0) {
      return { left: null, text: cut(line.text, width), tone: line.tone };
    }
    const tag = `hunk ${hunk + 1}/${rows.length}`;
    const cutText = cut(line.text, Math.max(0, width - tag.length - 1));
    return { left: null, text: `${cutText.padEnd(Math.max(0, width - tag.length))}${tag}`.slice(-width), tone: line.tone };
  });
}

/** Keep the end of a path, with a `…` where the start was cut. */
function cutLeft(text: string, width: number): string {
  return text.length <= width ? text : `…${text.slice(text.length - Math.max(0, width - 1))}`;
}

function cut(text: string, width: number): string {
  return text.length <= width ? text : `${text.slice(0, Math.max(0, width - 1))}…`;
}

function clamp(index: number, count: number): number {
  return Math.min(Math.max(index, 0), Math.max(0, count - 1));
}

/** The words of ``text`` in lines of at most ``width`` characters. */
function wrapWords(text: string, width: number): string[] {
  const lines: string[] = [];
  let line = "";
  for (const word of text.split(" ")) {
    if (line !== "" && line.length + 1 + word.length > width) {
      lines.push(line);
      line = word;
    } else {
      line = line === "" ? word : `${line} ${word}`;
    }
  }
  return line === "" ? lines : [...lines, line];
}
