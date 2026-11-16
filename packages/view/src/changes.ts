/** What each turn changed: `file.changed` events folded per run, and the line that words it. */

import type { ChatEvent } from "@golem/client";

import type { ChatMessage } from "./chat-state.ts";

export type FileStatus = "created" | "modified" | "deleted";

export type TurnFile = {
  path: string;
  status: FileStatus;
  added: number;
  removed: number;
  changeIds: string[];
};

/**
 * `revertIds` are the change ids of the reverts that stand: undoing a revert (a redo) takes its id out
 * again. `reverted` is true while any stands.
 */
export type TurnChanges = { runId: string | null; files: TurnFile[]; reverted: boolean; revertIds: string[] };

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
  const turn: TurnChanges = state.turns[index] ?? { runId, files: [], reverted: false, revertIds: [] };
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

/** The turn that holds the change, or the one a revert marked, gains this revert, or loses the one it undoes. */
function markReverted(state: ChangesState, target: string | null, revertId: string): ChangesState {
  if (target === null) {
    return state;
  }
  const index =
    state.revertTurns[target] ?? state.turns.findIndex((turn) => turn.files.some((file) => file.changeIds.includes(target)));
  if (index < 0) {
    return state;
  }
  const turns = state.turns.map((turn, at) => {
    if (at !== index) {
      return turn;
    }
    // A revert of a standing revert is a redo: that revert no longer stands, and the redo is not one.
    const revertIds = turn.revertIds.includes(target) ? turn.revertIds.filter((id) => id !== target) : [...turn.revertIds, revertId];
    return { ...turn, revertIds, reverted: revertIds.length > 0 };
  });
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

/** Longest title of a turn card, in characters, the cut mark included. */
export const TURN_TITLE_MAX = 80;

/** One card of the by-turn view. */
export type TurnCard = {
  runId: string;
  /** Counts the turns that changed files, the first being 1. */
  number: number;
  /** The request that started the run, on one line and cut at {@link TURN_TITLE_MAX}. */
  title: string;
  /** When the request was sent, or null when the transcript does not hold it. */
  at: string | null;
  files: TurnFile[];
  /** `2 files +9 −3`. */
  line: string;
  reverted: boolean;
  /** The change ids of the reverts that stand. Reverting each of them is the redo. */
  revertIds: string[];
};

/** One line, cut at `max` characters with an ellipsis. */
export function cutTitle(text: string, max: number = TURN_TITLE_MAX): string {
  const line = text.replace(/\s+/g, " ").trim();
  return line.length <= max ? line : `${line.slice(0, max - 1).trimEnd()}…`;
}

/**
 * The turns that changed files, newest first. A title is the user message of the run. A change with
 * no run (an undo) has no card: it only marked another turn reverted.
 */
export function turnCards(state: ChangesState, messages: readonly ChatMessage[]): TurnCard[] {
  const requests = new Map<string, ChatMessage>();
  for (const message of messages) {
    if (message.role === "user" && message.runId !== undefined && !requests.has(message.runId)) {
      requests.set(message.runId, message);
    }
  }
  const cards: TurnCard[] = [];
  for (const turn of state.turns) {
    if (turn.runId === null || turn.files.length === 0) {
      continue;
    }
    const request = requests.get(turn.runId);
    cards.push({
      runId: turn.runId,
      number: cards.length + 1,
      title: request === undefined ? "" : cutTitle(request.text),
      at: request?.at ?? null,
      files: turn.files,
      line: changesLine(turn.files),
      reverted: turn.reverted,
      revertIds: turn.revertIds,
    });
  }
  return cards.reverse();
}

/** How a session finds the files its shell commands change, as `changes.list` says it. */
export type ShellTracking = "git" | "files" | "off";

/** The quiet line for when shell changes are not listed, or null when they are. */
export function shellTrackingNote(shell: ShellTracking): string | null {
  return shell === "off" ? "Changes made by shell commands are not listed: this folder is too big to watch and is not a git repository." : null;
}

/** The title of an undo button while a run is active. */
export const UNDO_WAIT = "Wait for golem to finish";

/** `⟲ rewound · 2 files put back`: the line under a turn that was taken back. Redo goes after it. */
export function rewoundLine(files: number): string {
  return `⟲ rewound · ${files} ${files === 1 ? "file" : "files"} put back`;
}

/** The question of the dialog that lists the files golem left alone. */
export const UNDO_CONFLICT_TITLE = "These files changed since golem wrote them";
export const UNDO_CONFLICT_QUESTION = "Overwrite them?";

/** What a rewind to before a turn takes back: that turn and every newer one still standing, and their files once each. */
export type RewindPlan = { turns: TurnCard[]; paths: string[] };

/** `cards` are newest first, as {@link turnCards} gives them. An unknown run takes back nothing. */
export function rewindPlan(cards: readonly TurnCard[], runId: string): RewindPlan {
  const at = cards.findIndex((card) => card.runId === runId);
  if (at < 0) {
    return { turns: [], paths: [] };
  }
  const turns = cards.slice(0, at + 1).filter((card) => !card.reverted);
  const paths = new Set<string>();
  for (const card of turns) {
    for (const file of card.files) {
      paths.add(file.path);
    }
  }
  return { turns, paths: [...paths] };
}
