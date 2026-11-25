import type { ChangedFile, ChangesRevertTarget } from "@golem/client";
import { numberDiff, parseDiff, shellTrackingNote, type DiffLine, type DiffTone, type NumberedLine, type ReviewNote, type ShellTracking, type WorkerBlock } from "@golem/view";

import { layoutCommitBand, type CommitBand } from "./commit-band.ts";
import type { Press } from "./keys.ts";
import { emptyWorkerPane, layoutWorkerBlocks, layoutWorkerDiff, WORKER_HINT, WORKER_VIEW_HINT, type WorkerPane, type WorkerRow } from "./worker-changes.ts";

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
  /** The row of the diff the cursor is on, an index into its parsed lines. */
  row: number;
  /** A note being typed on a row, shown in the hint row. */
  input: NoteInput | null;
  /** The commit band, while it is open. */
  commit?: CommitBand | null;
  /** A line of news, such as the hash of a commit, shown in front of the key hint. */
  note?: string | null;
  /** An undo waits for `y` or `n` in the hint row. */
  confirm: ChangesRevertTarget | null;
  /** A line that replaces the hint until the next key. */
  message: string | null;
  /** The worker blocks' keys and notes. Left out, nothing is selected. */
  workers?: WorkerPane;
};

/** Where a note is being written: the row, as `addNote` wants it, and the text so far. */
export type NoteInput = { path: string; line: number; side: "new" | "old"; code: string; text: string };

export type ChangesData = {
  /** The review notes waiting for the next message. */
  notes?: readonly ReviewNote[];
  /** The list `changes.list` returned, or null while it is asked. */
  files: readonly ChangedFile[] | null;
  error: string | null;
  /** Diff text by path, for the files read so far. */
  diffs: Readonly<Record<string, string>>;
  /** Why a file's diff could not be read, by path. */
  failed?: Readonly<Record<string, string>>;
  /** How shell changes are found, from `changes.list`. Left out, they are. */
  shell?: ShellTracking;
  /** The worker blocks above the files, and the folder the footer names. Left out or empty, nothing is drawn. */
  workers?: { blocks: readonly WorkerBlock[]; folder: string };
};

export type ChangesKey =
  | "up"
  | "down"
  | "next-hunk"
  | "prev-hunk"
  | "page-up"
  | "page-down"
  | "row-up"
  | "row-down"
  | "note"
  | "remove-note"
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
  /** Enter on a note: the app adds it to the session's notes. */
  | { kind: "add-note"; note: Omit<ReviewNote, "id"> }
  /** `x`: the app removes these notes. */
  | { kind: "remove-notes"; ids: readonly string[] }
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
const HINT_PARTS = [
  "↑↓ file",
  "j/k row",
  "n/p hunk",
  "c note",
  "x remove note",
  "PgUp/Dn scroll",
  "u undo hunk",
  "U undo file",
  "g commit",
  "esc back",
];
/** What leaves the hint first on a narrow screen. `g commit` and `esc back` stay. */
const HINT_DROP = ["PgUp/Dn scroll", "U undo file", "u undo hunk", "x remove note", "c note", "n/p hunk", "j/k row"];

/** The key hint, with the least needed keys left out until it fits `width`. */
function hintFor(width: number, lead: string): string {
  const parts = [...HINT_PARTS];
  const text = (): string => [...(lead === "" ? [] : [lead]), ...parts].join(" · ");
  for (const drop of HINT_DROP) {
    if (text().length <= width) {
      break;
    }
    parts.splice(parts.indexOf(drop), 1);
  }
  return text();
}
export const WAIT_MESSAGE = "Wait for golem to finish.";
export const NO_NOTE_ROW_MESSAGE = "A note goes on an added, removed or unchanged line.";
/** The first column of a diff row: where the cursor is drawn. */
export const CURSOR = "▌";
const NOTE_MARK = "💬";
const BARE_HINT = "esc back";

export const closedChangesManager: ChangesManagerState = {
  open: false,
  file: 0,
  hunk: 0,
  offset: 0,
  row: 0,
  input: null,
  confirm: null,
  message: null,
};

export function openChangesManager(): ChangesManagerState {
  return { ...closedChangesManager, open: true };
}

export function changesKeyOf(press: Press): ChangesKey | null {
  if (press.name === "up" || press.name === "down") {
    if (press.shift === true) {
      return press.name === "up" ? "row-up" : "row-down";
    }
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
    if (press.input === "j") {
      return "row-down";
    }
    if (press.input === "k") {
      return "row-up";
    }
    if (press.input === "c") {
      return "note";
    }
    if (press.input === "x") {
      return "remove-note";
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
    const moved = { ...state, file: next, hunk: 0, offset: 0, row: 0 };
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
  const last = Math.max(0, lines.length - 1);
  const row = Math.min(Math.max(state.row, 0), last);
  const at = (offset: number, onRow: number): ChangesManagerState => {
    const clamped = Math.max(0, Math.min(offset, last));
    const cursor = Math.max(0, Math.min(onRow, last));
    return { ...state, file, offset: clamped, row: cursor, hunk: Math.max(0, rows.filter((header) => header <= cursor).length - 1) };
  };
  if (key === "row-up" || key === "row-down") {
    const cursor = Math.max(0, Math.min(row + (key === "row-up" ? -1 : 1), last));
    // The window follows the cursor, so it never leaves the screen.
    const room = Math.max(1, page);
    const offset = cursor < state.offset ? cursor : cursor >= state.offset + room ? cursor - room + 1 : state.offset;
    return { state: at(offset, cursor), action: none };
  }
  if (key === "note") {
    const here = numberDiff(lines)[row];
    const place = placeOf(here);
    if (here === undefined || place === null) {
      return { state: { ...state, file, row, message: NO_NOTE_ROW_MESSAGE }, action: none };
    }
    return { state: { ...state, file, row, input: { path, ...place, code: here.text.slice(1), text: "" } }, action: none };
  }
  if (key === "remove-note") {
    const ids = notesOnRow(data, path, lines, row).map((note) => note.id);
    return { state: { ...state, file, row }, action: ids.length === 0 ? none : { kind: "remove-notes", ids } };
  }
  // The first changed row of each hunk: where `n` and `p` put the cursor.
  const starts = rows.map((header, index) => ({ header, row: firstChanged(lines, header, rows[index + 1] ?? lines.length) }));
  if (key === "next-hunk") {
    const target = starts.find((candidate) => candidate.row > row);
    return { state: target === undefined ? state : at(target.header, target.row), action: none };
  }
  if (key === "prev-hunk") {
    const target = [...starts].reverse().find((candidate) => candidate.row < row);
    return { state: target === undefined ? state : at(target.header, target.row), action: none };
  }
  const step = key === "page-up" ? -page : page;
  return { state: at(state.offset + step, row + step), action: none };
}

/** The first added or removed row after the `@@` row `header`, or the row after it when the hunk changes nothing. */
function firstChanged(lines: readonly DiffLine[], header: number, end: number): number {
  for (let index = header + 1; index < end; index += 1) {
    const tone = lines[index]?.tone;
    if (tone === "add" || tone === "del") {
      return index;
    }
  }
  return Math.min(header + 1, Math.max(0, lines.length - 1));
}

/** The side and line number a row carries, or null for a `@@` or meta row. */
function placeOf(numbered: NumberedLine | undefined): { side: "new" | "old"; line: number } | null {
  if (numbered === undefined || numbered.tone === "hunk" || numbered.tone === "meta") {
    return null;
  }
  const line = numbered.tone === "del" ? numbered.old : numbered.new;
  return line === null ? null : { side: numbered.tone === "del" ? "old" : "new", line };
}

function notesOnRow(data: ChangesData, path: string, lines: readonly DiffLine[], row: number): ReviewNote[] {
  const place = placeOf(numberDiff(lines)[row]);
  if (place === null) {
    return [];
  }
  return (data.notes ?? []).filter((note) => note.path === path && note.side === place.side && note.line === place.line);
}

/**
 * A key while a note is typed: text goes in, Backspace takes it back, Enter saves
 * and Escape drops it. An empty note is not saved.
 */
export function pressNoteInput(
  state: ChangesManagerState,
  press: Press,
): { state: ChangesManagerState; action: ChangesAction } {
  const input = state.input;
  const none = { kind: "none" } as const;
  if (input === null) {
    return { state, action: none };
  }
  if (press.name === "escape") {
    return { state: { ...state, input: null }, action: none };
  }
  if (press.name === "return") {
    const text = input.text.trim();
    const cleared = { ...state, input: null };
    if (text === "") {
      return { state: cleared, action: none };
    }
    const { path, line, side, code } = input;
    return { state: cleared, action: { kind: "add-note", note: { path, line, side, code, text } } };
  }
  if (press.name === "backspace") {
    return { state: { ...state, input: { ...input, text: Array.from(input.text).slice(0, -1).join("") } }, action: none };
  }
  if (press.name === null && !press.ctrl && !press.meta && press.input !== "") {
    const typed = press.input.replace(/[\r\n]+/g, " ");
    return { state: { ...state, input: { ...input, text: input.text + typed } }, action: none };
  }
  return { state, action: none };
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
  const space = Math.max(0, rows - 1 - (band === null ? 1 : band.length));
  const pane = state.workers ?? emptyWorkerPane;
  const blocks = data.workers?.blocks ?? [];
  const view = blocks.length > 0 && pane.focus ? pane.view : null;
  const workerRows =
    view !== null || data.workers === undefined ? [] : layoutWorkerBlocks(blocks, pane, data.workers.folder, width).map((row) => workerLine(row));
  const room = Math.max(0, space - workerRows.length);
  let title = "changes";
  let body: ChangesLine[];
  let hint = BARE_HINT;
  const asked = state.confirm;
  if (view !== null) {
    title = `changes · ${view.label}`;
    body = layoutWorkerDiff(view, space, width).map((row) => workerLine(row));
  } else if (data.error !== null) {
    body = [plain(data.error)];
  } else if (files === null) {
    body = [plain("asking the daemon…", { dim: true })];
  } else if (files.length === 0) {
    body = [plain("No changes yet."), ...noteLines];
  } else {
    title = titleOf(files);
    const lead = [...(state.note === undefined || state.note === null ? [] : [state.note]), ...(blocks.length > 0 ? ["tab workers"] : [])];
    hint = hintFor(width, lead.join(" · "));
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
    const right = diffRows(data, path, state, diffRoom, Math.max(1, rightWidth));
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
  if (view !== null) {
    hint = WORKER_VIEW_HINT;
  } else if (blocks.length > 0 && pane.focus) {
    hint = WORKER_HINT;
  } else if (blocks.length > 0 && hint === BARE_HINT) {
    hint = `tab workers · ${BARE_HINT}`;
  }
  if (asked !== null) {
    hint = confirmText(asked);
  } else if (state.input !== null) {
    hint = `note on ${state.input.path}:${state.input.line} › ${state.input.text}_`;
  } else if (state.message !== null) {
    hint = state.message;
  }
  const lines = [
    plain(title, { bold: true }),
    ...workerRows,
    ...body.slice(0, view === null ? room : space),
    ...Array.from({ length: Math.max(0, (view === null ? room : space) - body.length) }, () => plain("")),
    ...(band ?? [plain(hint, { dim: true })]),
  ];
  return lines.slice(0, Math.max(0, rows));
}

function workerLine(row: WorkerRow): ChangesLine {
  return { left: null, text: row.text, tone: row.tone, bold: row.bold === true, dim: row.dim === true };
}

/** The file column from the top, scrolled so the selected file shows. */
function leftRows(files: readonly ChangedFile[], selected: number, room: number): { text: string; selected: boolean }[] {
  const start = Math.max(0, Math.min(selected - room + 1, files.length - room));
  return files.slice(start, start + room).map((file, index) => ({
    text: fileRow(file),
    selected: start + index === selected,
  }));
}

function diffRows(data: ChangesData, path: string, state: ChangesManagerState, room: number, width: number): ChangesLine[] {
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
  const numbered = numberDiff(lines);
  const cursor = Math.min(Math.max(state.row, 0), lines.length - 1);
  // Each diff row, then the text of its notes on rows of their own. `at` is the diff row they belong to.
  const shown: { at: number; line: ChangesLine }[] = [];
  const textWidth = Math.max(0, width - 1);
  lines.forEach((line, index) => {
    const place = placeOf(numbered[index]);
    const here = place === null ? [] : (data.notes ?? []).filter((candidate) => candidate.path === path && candidate.side === place.side && candidate.line === place.line);
    const hunk = rows.indexOf(index);
    let body: string;
    if (hunk >= 0) {
      const tag = `hunk ${hunk + 1}/${rows.length}`;
      const cutText = cut(line.text, Math.max(0, textWidth - tag.length - 1));
      body = `${cutText.padEnd(Math.max(0, textWidth - tag.length))}${tag}`.slice(-textWidth);
    } else if (here.length > 0) {
      body = `${cut(line.text, Math.max(0, textWidth - 3)).padEnd(Math.max(0, textWidth - 3))} ${NOTE_MARK}`;
    } else {
      body = cut(line.text, textWidth);
    }
    const mark = index === cursor ? CURSOR : " ";
    shown.push({ at: index, line: { left: null, text: `${mark}${body}`, tone: line.tone } });
    for (const saved of here) {
      shown.push({ at: index, line: { left: null, text: cut(`   ${saved.text.split("\n").join(" ")}`, width), tone: "plain", dim: true } });
    }
  });
  // The window starts at the offset, and moves only as far as the cursor needs.
  let start = shown.findIndex((entry) => entry.at >= Math.max(0, Math.min(state.offset, lines.length - 1)));
  start = Math.max(0, Math.min(start < 0 ? 0 : start, shown.length - room));
  const cursorAt = shown.findIndex((entry) => entry.at === cursor);
  if (cursorAt < start) {
    start = cursorAt;
  } else if (room > 0 && cursorAt >= start + room) {
    start = cursorAt - room + 1;
  }
  return shown.slice(start, start + room).map((entry) => entry.line);
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
