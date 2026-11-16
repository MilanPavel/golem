/** What each turn changed: `file.changed` events folded per run, and the line that words it. */

import type { ChatEvent } from "@golem/client";

export type FileStatus = "created" | "modified" | "deleted";

export type TurnFile = {
  path: string;
  status: FileStatus;
  added: number;
  removed: number;
  changeIds: string[];
};

export type TurnChanges = { runId: string | null; files: TurnFile[]; reverted: boolean };

/** Turns in order of first change. `revertTurns` maps a revert's change id to the turn it marked. */
export type ChangesState = { turns: TurnChanges[]; revertTurns: Record<string, number> };

export const noChanges: ChangesState = { turns: [], revertTurns: {} };

/** Folds one event in. Anything but `file.changed` returns the same state object. */
export function reduceChanges(state: ChangesState, event: ChatEvent): ChangesState {
  if (event.type !== "file.changed") {
    return state;
  }
  const data = event.data;
  if (data.source === "revert") {
    return markReverted(state, data.reverts ?? null, data.change_id);
  }
  const runId = event.run_id ?? null;
  const index = state.turns.findIndex((turn) => turn.runId === runId);
  const turn: TurnChanges = state.turns[index] ?? { runId, files: [], reverted: false };
  const files = addChange(turn.files, {
    path: data.path,
    status: data.status,
    added: data.added,
    removed: data.removed,
    changeIds: [data.change_id],
  });
  const turns = [...state.turns];
  turns[index < 0 ? turns.length : index] = { ...turn, files };
  return { ...state, turns };
}

function addChange(files: readonly TurnFile[], change: TurnFile): TurnFile[] {
  const at = files.findIndex((file) => file.path === change.path);
  const first = files[at];
  if (first === undefined) {
    return [...files, change];
  }
  let status: FileStatus = "modified";
  if (change.status === "deleted") {
    status = "deleted";
  } else if (first.status === "created") {
    status = "created";
  }
  const merged: TurnFile = {
    path: first.path,
    status,
    added: first.added + change.added,
    removed: first.removed + change.removed,
    changeIds: [...first.changeIds, ...change.changeIds],
  };
  return files.map((file, index) => (index === at ? merged : file));
}

/** The turn that holds the change, or the one a revert marked, flips its mark. */
function markReverted(state: ChangesState, target: string | null, revertId: string): ChangesState {
  if (target === null) {
    return state;
  }
  const index =
    state.revertTurns[target] ?? state.turns.findIndex((turn) => turn.files.some((file) => file.changeIds.includes(target)));
  if (index < 0) {
    return state;
  }
  const turns = state.turns.map((turn, at) => (at === index ? { ...turn, reverted: !turn.reverted } : turn));
  return { turns, revertTurns: { ...state.revertTurns, [revertId]: index } };
}

/** The changes of one run, or null when it changed nothing. */
export function turnOf(state: ChangesState, runId: string): TurnChanges | null {
  return state.turns.find((turn) => turn.runId === runId) ?? null;
}

export function totals(files: readonly TurnFile[]): { files: number; added: number; removed: number } {
  return {
    files: files.length,
    added: files.reduce((sum, file) => sum + file.added, 0),
    removed: files.reduce((sum, file) => sum + file.removed, 0),
  };
}

/** `3 files +43 −4`, `1 file +2`, or an empty string for no files. A zero count is left out. */
export function changesLine(files: readonly TurnFile[]): string {
  const sum = totals(files);
  if (sum.files === 0) {
    return "";
  }
  const parts = [`${sum.files} ${sum.files === 1 ? "file" : "files"}`];
  if (sum.added > 0) {
    parts.push(`+${sum.added}`);
  }
  if (sum.removed > 0) {
    parts.push(`−${sum.removed}`);
  }
  return parts.join(" ");
}

/** Under this many columns the row keeps only the totals and `/changes`. */
export const CHANGES_ROW_WIDE = 70;

/**
 * The one dim row after a turn that changed files: `─ 3 files +43 −4 · /changes to review · /undo takes this turn back ─`.
 * Names only the commands in `commands`. Empty when the turn changed nothing.
 */
export function changesRow(turn: TurnChanges | null, columns: number, commands: readonly string[]): string {
  if (turn === null || turn.files.length === 0) {
    return "";
  }
  if (turn.reverted) {
    const count = turn.files.length;
    return `─ undone: ${count} ${count === 1 ? "file" : "files"} put back ─`;
  }
  const parts = [changesLine(turn.files)];
  const wide = columns >= CHANGES_ROW_WIDE;
  if (commands.includes("/changes")) {
    parts.push(wide ? "/changes to review" : "/changes");
  }
  if (wide && commands.includes("/undo")) {
    parts.push("/undo takes this turn back");
  }
  return `─ ${parts.join(" · ")} ─`;
}

/** Every changed path once, in the order it first changed. */
export function changedPaths(state: ChangesState): string[] {
  const seen = new Set<string>();
  for (const turn of state.turns) {
    for (const file of turn.files) {
      seen.add(file.path);
    }
  }
  return [...seen];
}
