import { HELPER_CONFLICT, RpcError } from "@golem/client";
import { applyGreenLabel, copiesFooter, greenCount, parseDiff, workerDiffStat, type DiffLine, type DiffTone, type WorkerBlock, type WorkerStatus } from "@golem/view";

import type { Press } from "./keys.ts";

/**
 * The worker blocks of `/changes`: one per helper that works in its own copy of the project. The
 * blocks come from `workerBlocks` (the same as the web); this file holds the keys, the calls and the rows.
 * Keys act on the selected block while the workers have the focus (`tab` moves it between workers and files),
 * so `x` still removes a note when the files have it.
 */
export type WorkerView = { helperId: string; label: string; artifactId: string; text: string | null; error: string | null; offset: number };

export type WorkerPane = {
  /** The workers have the keys. */
  focus: boolean;
  index: number;
  /** A call is in flight: the keys wait. */
  busy: boolean;
  /** What each block says under it, by helper id: a conflict, or why a call failed. */
  notes: Readonly<Record<string, string>>;
  /** The diff of one worker, while it is open. */
  view: WorkerView | null;
};

export const emptyWorkerPane: WorkerPane = { focus: false, index: 0, busy: false, notes: {}, view: null };

export type WorkerKey = "tab" | "up" | "down" | "page-up" | "page-down" | "view" | "apply" | "apply-green" | "retry" | "discard" | "back";

export function workerKeyOf(press: Press): WorkerKey | null {
  if (press.name === "tab") {
    return press.shift === true ? null : "tab";
  }
  if (press.name === "up" || press.name === "down" || press.name === "page-up" || press.name === "page-down") {
    return press.name;
  }
  if (press.name === "escape") {
    return "back";
  }
  if (press.name === null && !press.ctrl && !press.meta) {
    if (press.input === "v") return "view";
    if (press.input === "a") return "apply";
    if (press.input === "A") return "apply-green";
    if (press.input === "r") return "retry";
    if (press.input === "x") return "discard";
  }
  return null;
}

/** A call for the app to make. */
export type WorkerCall =
  | { kind: "view"; helperId: string; label: string; artifactId: string }
  | { kind: "apply" | "retry" | "discard"; helperId: string }
  | { kind: "apply-green"; helperIds: readonly string[] };

/** The calls of the client that a worker key makes. */
export type WorkerApi = {
  applyHelper(sessionId: string, helperId: string): Promise<unknown>;
  discardHelper(sessionId: string, helperId: string): Promise<unknown>;
  retryHelper(sessionId: string, helperId: string): Promise<unknown>;
  readArtifact(sessionId: string, artifactId: string): Promise<{ text: string }>;
};

export const WAIT_WORKER = "Wait for the worker call to finish.";
export const NO_DIFF = "This worker has no diff to view.";

export function conflictLine(path: string): string {
  return path === "" ? "A file changed since the worker copied it" : `${path} changed since the worker copied it`;
}

function clampIndex(index: number, count: number): number {
  return Math.min(Math.max(index, 0), Math.max(0, count - 1));
}

function withNote(pane: WorkerPane, helperId: string, text: string): WorkerPane {
  return { ...pane, notes: { ...pane.notes, [helperId]: text } };
}

/**
 * A key. `tab` moves the focus between workers and files (it does nothing without blocks). With the workers
 * focused, the other keys act on the selected block, and only when its `actions` allow it. `pass` is true
 * when the key is not for the workers and the files should handle it.
 */
export function pressWorker(
  pane: WorkerPane,
  blocks: readonly WorkerBlock[],
  key: WorkerKey,
): { pane: WorkerPane; call: WorkerCall | null; pass: boolean } {
  const done = (next: WorkerPane, call: WorkerCall | null = null) => ({ pane: next, call, pass: false });
  if (blocks.length === 0) {
    return { pane, call: null, pass: true };
  }
  const index = clampIndex(pane.index, blocks.length);
  const block = blocks[index];
  if (key === "tab") {
    return done({ ...pane, index, focus: !pane.focus, view: null });
  }
  if (!pane.focus) {
    return { pane, call: null, pass: true };
  }
  if (pane.view !== null) {
    if (key === "back") {
      return done({ ...pane, view: null });
    }
    const lines = pane.view.text === null ? 0 : parseDiff(pane.view.text).length;
    const step = key === "up" ? -1 : key === "down" ? 1 : key === "page-up" ? -10 : key === "page-down" ? 10 : 0;
    return done({ ...pane, view: { ...pane.view, offset: Math.min(Math.max(pane.view.offset + step, 0), Math.max(0, lines - 1)) } });
  }
  if (key === "back") {
    return { pane, call: null, pass: true };
  }
  if (key === "up" || key === "down") {
    return done({ ...pane, index: clampIndex(index + (key === "up" ? -1 : 1), blocks.length) });
  }
  if (key === "page-up" || key === "page-down" || block === undefined) {
    return done({ ...pane, index });
  }
  if (pane.busy) {
    return done(withNote(pane, block.helperId, WAIT_WORKER));
  }
  const notes = Object.fromEntries(Object.entries(pane.notes).filter(([id]) => id !== block.helperId));
  const cleared = { ...pane, index, notes };
  if (key === "apply-green") {
    const helperIds = blocks.filter((item) => item.status === "green").map((item) => item.helperId);
    return helperIds.length === 0 ? done({ ...pane, index }) : done({ ...cleared, busy: true }, { kind: "apply-green", helperIds });
  }
  if (key === "view") {
    if (!block.actions.includes("view")) {
      return done({ ...pane, index });
    }
    if (block.diffArtifactId === null) {
      return done(withNote(cleared, block.helperId, NO_DIFF));
    }
    const view: WorkerView = { helperId: block.helperId, label: block.label, artifactId: block.diffArtifactId, text: null, error: null, offset: 0 };
    return done({ ...cleared, view }, { kind: "view", helperId: block.helperId, label: block.label, artifactId: block.diffArtifactId });
  }
  if (!block.actions.includes(key)) {
    return done({ ...pane, index });
  }
  return done({ ...cleared, busy: true }, { kind: key, helperId: block.helperId });
}

/** What a call changes: notes to set (null clears), and the diff text of a view. */
export type WorkerResult = { notes: [string, string | null][]; viewed?: { helperId: string; text: string | null; error: string | null } };

function failure(error: unknown, fallback: string): string {
  return error instanceof Error && error.message.length > 0 ? error.message : fallback;
}

/** Makes the call. `apply-green` applies in order and stops at the first one that does not go in. */
export async function runWorkerCall(api: WorkerApi, sessionId: string, call: WorkerCall): Promise<WorkerResult> {
  if (call.kind === "view") {
    try {
      const read = await api.readArtifact(sessionId, call.artifactId);
      return { notes: [], viewed: { helperId: call.helperId, text: read.text, error: null } };
    } catch (error) {
      return { notes: [], viewed: { helperId: call.helperId, text: null, error: failure(error, "Could not read the diff.") } };
    }
  }
  /** The words for why it did not go in, or undefined when it did. */
  const apply = async (helperId: string): Promise<string | undefined> => {
    try {
      await api.applyHelper(sessionId, helperId);
      return undefined;
    } catch (error) {
      if (error instanceof RpcError && error.code === HELPER_CONFLICT) {
        const path = error.data?.["path"];
        return conflictLine(typeof path === "string" ? path : "");
      }
      return failure(error, "Could not apply.");
    }
  };
  if (call.kind === "apply-green") {
    for (const helperId of call.helperIds) {
      const said = await apply(helperId);
      if (said !== undefined) {
        return { notes: [[helperId, said]] };
      }
    }
    return { notes: [] };
  }
  if (call.kind === "apply") {
    const said = await apply(call.helperId);
    return { notes: said === undefined ? [] : [[call.helperId, said]] };
  }
  try {
    if (call.kind === "retry") {
      await api.retryHelper(sessionId, call.helperId);
    } else {
      await api.discardHelper(sessionId, call.helperId);
    }
    return { notes: [] };
  } catch (error) {
    return { notes: [[call.helperId, failure(error, call.kind === "retry" ? "Could not start it again." : "Could not discard.")]] };
  }
}

/** The pane after a call: the notes set, the diff text in, the keys free again. */
export function workerDone(pane: WorkerPane, result: WorkerResult): WorkerPane {
  const notes = { ...pane.notes };
  for (const [id, text] of result.notes) {
    if (text === null) {
      delete notes[id];
    } else {
      notes[id] = text;
    }
  }
  const viewed = result.viewed;
  const view = viewed !== undefined && pane.view !== null && pane.view.helperId === viewed.helperId ? { ...pane.view, text: viewed.text, error: viewed.error } : pane.view;
  return { ...pane, busy: false, notes, view };
}

const STATUS_WORD: Record<WorkerStatus, string> = {
  running: "working",
  green: "checks pass",
  failed: "checks fail",
  stopped: "stopped",
  applied: "applied",
  discarded: "discarded",
};

export type WorkerRow = { text: string; tone: DiffTone | "plain"; bold?: boolean; dim?: boolean };

function cut(text: string, width: number): string {
  return text.length <= width ? text : `${text.slice(0, Math.max(0, width - 1))}…`;
}

/** The block rows, then the footer. Empty for no blocks. */
export function layoutWorkerBlocks(blocks: readonly WorkerBlock[], pane: WorkerPane, folder: string, width: number): WorkerRow[] {
  if (blocks.length === 0) {
    return [];
  }
  const rows: WorkerRow[] = [];
  const selected = clampIndex(pane.index, blocks.length);
  blocks.forEach((block, index) => {
    const mark = pane.focus && index === selected ? "›" : " ";
    const stat = block.files.length === 0 ? "" : ` · ${String(block.files.length)} ${block.files.length === 1 ? "file" : "files"} ${workerDiffStat(block)}`;
    const done = block.status === "applied" || block.status === "discarded";
    rows.push({ text: cut(`${mark} ${block.label} · ${STATUS_WORD[block.status]}${stat}`, width), tone: "plain", bold: pane.focus && index === selected, dim: done });
    if (block.checksLine !== "") {
      rows.push({ text: cut(`    ${block.checksLine}`, width), tone: "plain", dim: true });
    }
    const said = pane.notes[block.helperId];
    if (said !== undefined) {
      rows.push({ text: cut(`    ${said}`, width), tone: "del" });
    }
  });
  const footer = copiesFooter(blocks, folder);
  const green = applyGreenLabel(greenCount(blocks));
  if (footer !== null) {
    rows.push({ text: cut(green === null || !pane.focus ? footer : `${footer} · A ${green.toLowerCase()}`, width), tone: "plain", dim: true });
  }
  return rows;
}

/** The rows of an open diff, `room` of them from its offset. */
export function layoutWorkerDiff(view: WorkerView, room: number, width: number): WorkerRow[] {
  if (view.error !== null) {
    return [{ text: cut(view.error, width), tone: "plain" }];
  }
  if (view.text === null) {
    return [{ text: "loading the diff…", tone: "plain", dim: true }];
  }
  const lines: DiffLine[] = parseDiff(view.text);
  if (lines.length === 0) {
    return [{ text: "No text diff.", tone: "plain", dim: true }];
  }
  const start = Math.min(Math.max(view.offset, 0), Math.max(0, lines.length - Math.max(1, room)));
  return lines.slice(start, start + Math.max(0, room)).map((line) => ({ text: cut(line.text, width), tone: line.tone }));
}

export const WORKER_HINT = "↑↓ worker · v view · a apply · A apply green · r try again · x discard · tab files · esc back";
export const WORKER_VIEW_HINT = "↑↓ PgUp/Dn scroll · esc back to the workers";
